import { arredondarDinheiro, arredondarPercentual } from '../calculo/arredondamento.js';
import type { EstoqueOmie, PedidoOmie } from '../calculo/tipos.js';
import { classificarEtapa, type EtapaFaturamento, type TipoDocumento } from '../omie/classificacaoDocumento.js';
import type { ProdutoOmie } from '../omie/cliente.js';
import { calcularPedidoCompleto } from './montarRelatorio.js';

export interface VendedorInfo {
  codigo: number;
  nome: string;
  inativo: boolean;
}

export interface ClienteInfo {
  codigo: number;
  razaoSocial: string;
  nomeFantasia: string;
}

/** Superfície do cliente Omie usada pelos relatórios agregados de Vendas/Orçamentos. */
export interface ClienteOmieParaRelatorioAgregado {
  listarPedidosCompletos(filtros: {
    pagina: number;
    registrosPorPagina: number;
    dataDe?: string;
    dataAte?: string;
  }): Promise<{ pedidos: PedidoOmie[]; pagina: number; totalDePaginas: number }>;
  listarEtapasVendaProduto(): Promise<EtapaFaturamento[]>;
  listarVendedores(): Promise<VendedorInfo[]>;
  consultarCliente(codigoCliente: number): Promise<ClienteInfo | null>;
  obterEstoqueProduto(codigoProduto: number, dataReferencia: string): Promise<EstoqueOmie>;
  consultarProduto(codigoProduto: number): Promise<ProdutoOmie>;
}

export interface FiltrosRelatorio {
  /** PEDIDO = Relatório de Vendas. ORCAMENTO = Relatório de Orçamentos. Nunca misturados (regra crítica). */
  tipoDocumento: TipoDocumento;
  dataDe?: string;
  dataAte?: string;
  codigoVendedor?: number;
}

export interface LinhaRelatorio {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  data?: string;
  codigoCliente: number;
  /** null quando o cliente não pôde ser localizado na Omie — nunca inventado. */
  nomeCliente: string | null;
  /** null quando o pedido não tem vendedor identificado (`informacoes_adicionais.codVend` ausente). */
  codigoVendedor: number | null;
  nomeVendedor: string | null;
  /** Valor bruto informado pela Omie (`total_pedido.valor_total_pedido`) — inclui impostos destacados; pode incluir frete/seguro/outras despesas. */
  valorBruto: number;
  /** Soma do valor de mercadoria dos itens — usada na análise de custo/margem já existente (não é a base do comissionamento). */
  receitaTotal: number;
  custoTotal: number;
  margemTotal: number;
  margemVendaPercentual: number | null;
  markupCustoPercentual: number | null;
  itensSemCusto: number;
  /** Campos de `pedido.frete` — usados exclusivamente pelo cálculo de margem de comissionamento (0 quando o pedido não os informa). */
  valorFrete: number;
  valorSeguro: number;
  outrasDespesasFrete: number;
  /** `total_pedido.valor_IPI` — único imposto somado "por fora" do valor dos produtos na nota, junto com `valorIcmsSt` (ver `TotalPedidoOmie`). */
  valorIPI: number;
  /** `total_pedido.valor_st` — ICMS-ST (Substituição Tributária), também somado "por fora". */
  valorIcmsSt: number;
  /** Impostos já embutidos no valor dos produtos (não somam à nota) — apenas informativo, nunca subtraído do total. */
  impostosEmbutidos: {
    icms: number;
    pis: number;
    cofins: number;
    ibs: number;
    cbs: number;
  };
  /** Itens do pedido (código do produto + receita) — usado para segregar comissão fixa por família (ver `relatorioComissionamento.ts`). */
  itens: Array<{ codigoProduto: number; receita: number }>;
}

export interface ResumoRelatorio {
  quantidadeDocumentos: number;
  valorBrutoTotal: number;
  valorLiquidoTotal: number;
  custoTotal: number;
  margemTotal: number;
  margemMediaPercentual: number | null;
  ticketMedio: number | null;
}

export interface ResultadoRelatorio {
  linhas: LinhaRelatorio[];
  resumo: ResumoRelatorio;
  /** Registros cuja etapa não pôde ser classificada com segurança (excluídos do relatório — nunca contabilizados por adivinhação). */
  documentosAmbiguosExcluidos: number;
  paginasOmieConsultadas: number;
  /** true se o limite de segurança de páginas foi atingido antes de esgotar os dados do período filtrado — o relatório pode estar incompleto. */
  limiteAtingido: boolean;
}

/** Limite de segurança de páginas da Omie por relatório, para nunca disparar um número ilimitado de chamadas. */
const MAX_PAGINAS_OMIE = 25;
const REGISTROS_POR_PAGINA_OMIE = 200;

function extrairCodigoVendedor(pedido: PedidoOmie): number | null {
  const bruto = pedido.informacoes_adicionais?.codVend;
  const numero = typeof bruto === 'number' ? bruto : Number(bruto);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function dataDeHojeFormatoOmie(): string {
  const agora = new Date();
  const dia = String(agora.getDate()).padStart(2, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${agora.getFullYear()}`;
}

/**
 * Consolida em UMA linha por `numeroPedido` os pedidos faturados parcialmente
 * (regra de negócio confirmada em 2026-09-10 contra a API real, pedido nº
 * 154): quando um pedido é faturado em mais de uma nota, a Omie mantém o
 * registro ORIGINAL (menor `codigo_pedido`, ainda na etapa de "PV Liberado")
 * — mas ZERA a quantidade/valor de cada item de linha assim que ele é movido
 * para uma fatura parcial — e cria um registro FILHO por fatura (etapa
 * "Faturado") contendo só os itens daquela fatura. `ListarPedidos` devolve
 * todos esses registros com o MESMO `numero_pedido`, então sem essa
 * consolidação o mesmo pedido apareceria duplicado (ou mais) no relatório —
 * e cada duplicata isolada mostraria só uma FRAÇÃO do pedido, nunca o total
 * real (confirmado: itens já movidos para uma fatura ficam com quantidade 0
 * no registro original, nunca duplicados nem perdidos entre os registros).
 * Somar os valores de todos os registros do grupo reconstrói o pedido
 * completo sem contar nada duas vezes. O registro de menor `codigoPedido`
 * (o original) é usado como base para os campos não somáveis (etapa, data,
 * cliente, vendedor) — os títulos financeiros continuam localizados por
 * `numeroPedido` em `relatorioComissionamento.ts`/`montarRelatorio.ts`,
 * então a consolidação aqui não afeta o rastreio de parcelas/faturamento.
 */
function consolidarFaturamentoParcial(linhas: LinhaRelatorio[]): LinhaRelatorio[] {
  const porNumeroPedido = new Map<string, LinhaRelatorio[]>();
  for (const linha of linhas) {
    const grupo = porNumeroPedido.get(linha.numeroPedido) ?? [];
    grupo.push(linha);
    porNumeroPedido.set(linha.numeroPedido, grupo);
  }

  const consolidadas: LinhaRelatorio[] = [];
  for (const grupo of porNumeroPedido.values()) {
    const primeiraLinha = grupo[0];
    if (grupo.length === 1 && primeiraLinha !== undefined) {
      consolidadas.push(primeiraLinha);
      continue;
    }

    const base = grupo.reduce((menor, atual) => (atual.codigoPedido < menor.codigoPedido ? atual : menor));
    const somar = (selecionar: (l: LinhaRelatorio) => number) => grupo.reduce((soma, l) => soma + selecionar(l), 0);

    const receitaTotal = arredondarDinheiro(somar((l) => l.receitaTotal));
    const custoTotal = arredondarDinheiro(somar((l) => l.custoTotal));
    const margemTotal = arredondarDinheiro(somar((l) => l.margemTotal));

    consolidadas.push({
      ...base,
      valorBruto: arredondarDinheiro(somar((l) => l.valorBruto)),
      receitaTotal,
      custoTotal,
      margemTotal,
      margemVendaPercentual: arredondarPercentual(receitaTotal === 0 ? null : margemTotal / receitaTotal),
      markupCustoPercentual: arredondarPercentual(custoTotal === 0 ? null : margemTotal / custoTotal),
      itensSemCusto: somar((l) => l.itensSemCusto),
      valorFrete: arredondarDinheiro(somar((l) => l.valorFrete)),
      valorSeguro: arredondarDinheiro(somar((l) => l.valorSeguro)),
      outrasDespesasFrete: arredondarDinheiro(somar((l) => l.outrasDespesasFrete)),
      valorIPI: arredondarDinheiro(somar((l) => l.valorIPI)),
      valorIcmsSt: arredondarDinheiro(somar((l) => l.valorIcmsSt)),
      impostosEmbutidos: {
        icms: arredondarDinheiro(somar((l) => l.impostosEmbutidos.icms)),
        pis: arredondarDinheiro(somar((l) => l.impostosEmbutidos.pis)),
        cofins: arredondarDinheiro(somar((l) => l.impostosEmbutidos.cofins)),
        ibs: arredondarDinheiro(somar((l) => l.impostosEmbutidos.ibs)),
        cbs: arredondarDinheiro(somar((l) => l.impostosEmbutidos.cbs)),
      },
      itens: grupo.flatMap((l) => l.itens),
    });
  }
  return consolidadas;
}

function calcularResumo(linhas: LinhaRelatorio[]): ResumoRelatorio {
  const quantidadeDocumentos = linhas.length;
  const valorBrutoTotal = linhas.reduce((soma, l) => soma + l.valorBruto, 0);
  const valorLiquidoTotal = linhas.reduce((soma, l) => soma + l.receitaTotal, 0);
  const custoTotal = linhas.reduce((soma, l) => soma + l.custoTotal, 0);
  const margemTotal = linhas.reduce((soma, l) => soma + l.margemTotal, 0);

  return {
    quantidadeDocumentos,
    valorBrutoTotal: arredondarDinheiro(valorBrutoTotal),
    valorLiquidoTotal: arredondarDinheiro(valorLiquidoTotal),
    custoTotal: arredondarDinheiro(custoTotal),
    margemTotal: arredondarDinheiro(margemTotal),
    margemMediaPercentual: arredondarPercentual(valorLiquidoTotal === 0 ? null : margemTotal / valorLiquidoTotal),
    ticketMedio: quantidadeDocumentos === 0 ? null : arredondarDinheiro(valorLiquidoTotal / quantidadeDocumentos),
  };
}

/**
 * Gera o relatório agregado de Vendas (PEDIDO) ou Orçamentos (ORCAMENTO) —
 * nunca os dois juntos (regra crítica de separação, ver
 * `classificacaoDocumento.ts`). Reaproveita a estrutura completa já
 * retornada por `ListarPedidos` (confirmado contra a API real: o mesmo
 * `det`/`informacoes_adicionais`/`lista_parcelas` de `ConsultarPedido`), sem
 * precisar de uma consulta adicional por documento.
 */
export async function gerarRelatorio(
  cliente: ClienteOmieParaRelatorioAgregado,
  filtros: FiltrosRelatorio,
  dataReferenciaCusto: string = dataDeHojeFormatoOmie(),
): Promise<ResultadoRelatorio> {
  const [etapas, vendedores] = await Promise.all([cliente.listarEtapasVendaProduto(), cliente.listarVendedores()]);
  const vendedoresPorCodigo = new Map(vendedores.map((v) => [v.codigo, v]));

  const pedidosBrutos: PedidoOmie[] = [];
  let pagina = 1;
  let totalDePaginas = 1;
  let paginasConsultadas = 0;

  do {
    const resultado = await cliente.listarPedidosCompletos({
      pagina,
      registrosPorPagina: REGISTROS_POR_PAGINA_OMIE,
      dataDe: filtros.dataDe,
      dataAte: filtros.dataAte,
    });
    pedidosBrutos.push(...resultado.pedidos);
    totalDePaginas = resultado.totalDePaginas;
    paginasConsultadas += 1;
    pagina += 1;
  } while (pagina <= totalDePaginas && paginasConsultadas < MAX_PAGINAS_OMIE);

  const limiteAtingido = paginasConsultadas >= MAX_PAGINAS_OMIE && pagina <= totalDePaginas;

  let documentosAmbiguosExcluidos = 0;
  const linhas: LinhaRelatorio[] = [];

  for (const pedido of pedidosBrutos) {
    const classificacao = classificarEtapa(pedido.cabecalho.etapa, etapas);
    if (classificacao.ambiguo) {
      documentosAmbiguosExcluidos += 1;
      continue;
    }
    if (classificacao.tipo !== filtros.tipoDocumento) continue;

    const codigoVendedor = extrairCodigoVendedor(pedido);
    if (filtros.codigoVendedor !== undefined && codigoVendedor !== filtros.codigoVendedor) continue;

    const { totais, itens } = await calcularPedidoCompleto(cliente, pedido, dataReferenciaCusto);
    const nomeVendedor = codigoVendedor !== null ? (vendedoresPorCodigo.get(codigoVendedor)?.nome ?? null) : null;
    const clienteInfo = await cliente.consultarCliente(pedido.cabecalho.codigo_cliente);

    linhas.push({
      codigoPedido: pedido.cabecalho.codigo_pedido,
      numeroPedido: pedido.cabecalho.numero_pedido,
      etapa: pedido.cabecalho.etapa,
      data: pedido.cabecalho.data_previsao,
      codigoCliente: pedido.cabecalho.codigo_cliente,
      nomeCliente: clienteInfo?.nomeFantasia || clienteInfo?.razaoSocial || null,
      codigoVendedor,
      nomeVendedor,
      valorBruto: pedido.total_pedido?.valor_total_pedido ?? 0,
      receitaTotal: totais.receitaTotal,
      custoTotal: totais.custoTotal,
      margemTotal: totais.margemTotal,
      margemVendaPercentual: totais.margemVendaTotal,
      markupCustoPercentual: totais.markupCustoTotal,
      itensSemCusto: totais.itensSemCusto,
      valorFrete: pedido.frete?.valor_frete ?? 0,
      valorSeguro: pedido.frete?.valor_seguro ?? 0,
      outrasDespesasFrete: pedido.frete?.outras_despesas ?? 0,
      valorIPI: pedido.total_pedido?.valor_IPI ?? 0,
      valorIcmsSt: pedido.total_pedido?.valor_st ?? 0,
      impostosEmbutidos: {
        icms: pedido.total_pedido?.valor_icms ?? 0,
        pis: pedido.total_pedido?.valor_pis ?? 0,
        cofins: pedido.total_pedido?.valor_cofins ?? 0,
        ibs: pedido.total_pedido?.valor_ibs ?? 0,
        cbs: pedido.total_pedido?.valor_cbs ?? 0,
      },
      itens: itens.map((item) => ({ codigoProduto: item.codigoProduto, receita: item.receita })),
    });
  }

  const linhasConsolidadas = consolidarFaturamentoParcial(linhas);

  return {
    linhas: linhasConsolidadas,
    resumo: calcularResumo(linhasConsolidadas),
    documentosAmbiguosExcluidos,
    paginasOmieConsultadas: paginasConsultadas,
    limiteAtingido,
  };
}

function normalizarTextoBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Filtro de busca (seção 5/6 do requisito): aplicado localmente sobre as
 * linhas já calculadas do relatório — número/código do pedido, cliente ou
 * vendedor —, sem nenhuma consulta adicional à Omie.
 */
export function filtrarLinhasPorBusca(linhas: LinhaRelatorio[], busca: string | undefined): LinhaRelatorio[] {
  if (busca === undefined || busca.trim() === '') return linhas;
  const termo = normalizarTextoBusca(busca);
  return linhas.filter((linha) => {
    const campos = [linha.numeroPedido, String(linha.codigoPedido), linha.nomeCliente ?? '', linha.nomeVendedor ?? ''];
    return campos.some((campo) => normalizarTextoBusca(campo).includes(termo));
  });
}
