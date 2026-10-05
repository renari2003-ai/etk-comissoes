import {
  calcularComissaoTotal,
  calcularComissaoVendedor,
  comissaoFixaDaFamilia,
  comissaoFixaDoVendedor,
  distribuirComissaoPorParcelas,
  ehVendedorComAdicional,
  type ParcelaComissao,
} from './calcularComissao.js';
import {
  calcularMargemComissionamento,
  type ImpostosEmbutidos,
  type ResultadoMargemComissionamento,
} from './calcularMargemComissionamento.js';
import {
  avaliarRegistroComissionamento,
  validarConfiguracaoEtapasComissionamento,
  type ExcecaoRevisaoManual,
} from './elegibilidadeComissionamento.js';
import {
  gerarRelatorio,
  montarLinhasDePedidos,
  type AvaliarRegistroPedido,
  type ClienteOmieParaRelatorioAgregado,
  type LinhaRelatorio,
} from '../relatorio/relatorioVendas.js';
import type { PedidoOmie } from '../calculo/tipos.js';
import type { TituloContaReceber } from '../omie/cliente.js';

export interface ClienteOmieParaComissionamento extends ClienteOmieParaRelatorioAgregado {
  listarContasReceberPorVendedor(codigoVendedor: number): Promise<TituloContaReceber[]>;
  /** Somente leitura (`ConsultarPedido`) — usado só para os pedidos de períodos anteriores trazidos por parcela no período. */
  consultarPedido(identificador: { numeroPedido?: string; codigoPedido?: number }): Promise<PedidoOmie>;
}

/**
 * `PERIODO` = venda do período filtrado (como sempre foi). `PARCELA_PERIODO_ANTERIOR` = pedido dos
 * 12 meses anteriores ao início do período, incluído SÓ porque tem parcela com vencimento dentro
 * do período (regra de 2026-09-28) — nunca soma venda/comissão total/quantidade do período.
 */
export type OrigemLinhaComissionamento = 'PERIODO' | 'PARCELA_PERIODO_ANTERIOR';

export interface FiltrosComissionamento {
  dataDe?: string;
  dataAte?: string;
  codigoVendedor?: number;
}

/**
 * Presente apenas quando o pedido tem item(ns) de família com comissão fixa
 * (`FAMILIAS_COMISSAO_FIXA`, ver `calcularComissao.ts`) MISTURADOS com
 * produtos de outras famílias no mesmo pedido — decisão de negócio de
 * 2026-09-10: os itens da família são segregados do cálculo por margem; a
 * comissão sobre eles usa o percentual fixo da família, e o restante do
 * pedido segue a regra normal (margem + adicional do vendedor). Como a Omie
 * não discrimina impostos/frete por item, a parte "normal" reparte essas
 * despesas proporcionalmente à participação de cada grupo na receita do
 * pedido — a única forma de segregar a margem sem inventar dado que a Omie
 * não fornece por item.
 *
 * O adicional de vendedor especial (Sandro/Horacio/Roberto Rocha, +1%) SOMA
 * sobre a comissão fixa da família também — confirmado com o usuário em
 * 2026-09-10 (a comissão fixa "trava" o percentual base, mas nunca suprime
 * o adicional do vendedor).
 */
export interface SegregacaoComissaoFixa {
  nomeFamilia: string;
  /** Percentual BASE da família (ex.: 1% para CTO Promocional), sem o adicional do vendedor. */
  percentualFixo: number;
  /** +1,00 quando o vendedor é especial (`ehVendedorComAdicional`), senão 0 — já somado em `comissaoValorFixa`. */
  adicionalVendedorPercentual: number;
  receitaComissaoFixa: number;
  /** Valor da comissão sobre a parte fixa, já incluindo o adicional do vendedor quando aplicável. */
  comissaoValorFixa: number;
  receitaNormal: number;
  comissaoValorNormal: number;
}

export interface LinhaComissionamento extends LinhaRelatorio {
  /** total_pedido.valor_IPI — imposto somado "por fora" do valor dos produtos. Quando há `segregacaoComissaoFixa`, refere-se só à parte "normal" do pedido (repartição proporcional). */
  despesasIPI: number;
  /** total_pedido.valor_st (ICMS-ST/Substituição Tributária) — também somado "por fora". */
  despesasIcmsSt: number;
  despesasFreteSeguroOutras: number;
  despesasTotal: number;
  resultadoAposDespesas: number;
  /** Margem de comissionamento = (valor da venda − despesas) ÷ valor da venda — NUNCA usa custo de produto. Distinta de `margemVendaPercentual` (métrica de custo, apenas exibida para análise). Quando há `segregacaoComissaoFixa`, é a margem só da parte "normal" do pedido. */
  margemComissionamentoPercentual: number | null;
  /** ICMS/PIS/COFINS/IBS/CBS já embutidos no valor dos produtos — apenas informativo, nunca subtraído de novo (ver `calcularMargemComissionamento.ts`). */
  impostosEmbutidos: ImpostosEmbutidos;
  /** Determinada exclusivamente pela margem de comissionamento — piso 1%, teto 3% (seção 1/2 da regra de 2026-09-08). Quando `vendedorComissaoFixaPercentual` está presente, é igual a ele (comissão fixa do vendedor). */
  comissaoNormalPercentual: number;
  /** +1,00 quando o vendedor está na lista de vendedores com adicional (`VENDEDORES_COM_ADICIONAL`), senão 0 (seção 3). Sempre 0 quando `vendedorComissaoFixaPercentual` está presente — a comissão fixa DO VENDEDOR (ex.: Renato Pinto) nunca recebe adicional, mas a comissão fixa DA FAMÍLIA (`segregacaoComissaoFixa`) recebe normalmente. */
  adicionalVendedorPercentual: number;
  /** comissaoNormalPercentual + adicionalVendedorPercentual — percentual efetivamente aplicado à base da comissão; pode chegar a 4% para vendedores com adicional (seção 8: nunca limitado de novo em 3%). */
  comissaoFinalPercentual: number;
  /** Base da comissão = valor total dos produtos (`receitaTotal`), NUNCA o valor bruto da nota nem o custo do produto (decisão de negócio de 2026-09-08). Quando há segregação, é a soma das duas partes (normal + comissão fixa). */
  comissaoTotal: number;
  parcelas: ParcelaComissao[];
  comissaoLiberada: number;
  comissaoPendente: number;
  /** true quando nenhum título financeiro pôde ser localizado na Omie para este pedido — comissão calculada, mas sem acompanhamento de baixa (seção 40). */
  semTitulosLocalizados: boolean;
  /** Ver `OrigemLinhaComissionamento`. Em `PARCELA_PERIODO_ANTERIOR`, `parcelas`/`comissaoLiberada`/`comissaoPendente` cobrem só as parcelas com vencimento no período. */
  origem: OrigemLinhaComissionamento;
  /**
   * Datas de faturamento do pedido (dd/mm/aaaa, cronológicas, sem repetição) = `data_emissao` dos
   * títulos localizados (uma por fatura; várias no faturamento parcial). Vazio quando não há
   * título — nunca substituída pela data do pedido.
   */
  datasFaturamento: string[];
  /** Soma do `valorDocumento` de todos os títulos localizados para o pedido (todas as faturas, parciais ou não). 0 quando `semTitulosLocalizados` é true. */
  valorFaturado: number;
  /**
   * `valorBruto` (valor da nota do pedido inteiro) menos `valorFaturado` — quanto do pedido
   * ainda não foi faturado (regra de negócio de 2026-09-10, pedido real nº 154: faturado em
   * 2 notas parciais que juntas não cobrem o valor total do pedido). Sempre presente, mas só
   * deve ser exibido/destacado no frontend quando positivo (> tolerância de arredondamento) E
   * `semTitulosLocalizados` é false — sem título localizado não dá pra saber se o saldo é real
   * ou só uma falha de vínculo título↔pedido.
   */
  saldoAFaturar: number;
  /**
   * Presente quando o VENDEDOR tem comissão fixa própria (`VENDEDORES_COMISSAO_FIXA`,
   * ex.: Renato Pinto = 4%) — prioridade máxima, ignora margem e família do
   * produto por completo (regra de 2026-09-10).
   */
  vendedorComissaoFixaPercentual?: number;
  /** Ver `SegregacaoComissaoFixa`. Nunca presente ao mesmo tempo que `vendedorComissaoFixaPercentual` (a regra do vendedor tem prioridade e ignora a família). */
  segregacaoComissaoFixa?: SegregacaoComissaoFixa;
}

export interface ResumoComissionamento {
  quantidadePedidos: number;
  valorVendaTotal: number;
  comissaoTotalCalculada: number;
  comissaoLiberada: number;
  comissaoPendente: number;
  quantidadeParcelasTotal: number;
  quantidadeParcelasBaixadas: number;
  quantidadeParcelasPendentes: number;
}

export interface ResultadoComissionamento {
  linhas: LinhaComissionamento[];
  resumo: ResumoComissionamento;
  documentosAmbiguosExcluidos: number;
  /** Pedidos sem vendedor identificado (`informacoes_adicionais.codVend` ausente) — excluídos do comissionamento, nunca calculados com vendedor adivinhado. */
  pedidosSemVendedorExcluidos: number;
  /** Números dos pedidos excluídos por não terem vendedor identificado (mesma contagem de `pedidosSemVendedorExcluidos`) — para o usuário conseguir localizá-los na Omie e corrigir o cadastro do vendedor. */
  numerosPedidosSemVendedor: string[];
  /**
   * Pedidos de períodos anteriores que tinham parcela vencendo no período, mas cujo pedido não
   * pôde ser consultado na Omie (ex.: excluído/cancelado) — ficam fora do relatório e são
   * listados aqui para aviso, nunca calculados com dado incompleto.
   */
  numerosPedidosAnterioresNaoLocalizados: string[];
  /**
   * Registros cancelados na Omie que ainda têm título financeiro não cancelado (em aberto ou
   * recebido) — fora do cálculo automático e listados para revisão manual (regra de 2026-09-28).
   */
  excecoesRevisaoManual: ExcecaoRevisaoManual[];
}

/** "dd/mm/aaaa" → aaaammdd (número comparável); `null` se o texto não for uma data nesse formato. */
function chaveData(data: string | null | undefined): number | null {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((data ?? '').trim());
  if (partes === null) return null;
  return Number(partes[3]) * 10000 + Number(partes[2]) * 100 + Number(partes[1]);
}

/** Mesmo dia, 12 meses antes (29/02 → 28/02) — limite inferior da janela de pedidos anteriores. */
function chaveDozeMesesAntes(chave: number): number {
  const ano = Math.floor(chave / 10000);
  const mes = Math.floor(chave / 100) % 100;
  const dia = chave % 100;
  const ultimoDiaDoMes = new Date(ano - 1, mes, 0).getDate();
  return (ano - 1) * 10000 + mes * 100 + Math.min(dia, ultimoDiaDoMes);
}

function datasFaturamentoDosTitulos(titulos: TituloContaReceber[]): string[] {
  const porChave = new Map<number, string>();
  for (const titulo of titulos) {
    const chave = chaveData(titulo.dataEmissao);
    if (chave !== null && titulo.dataEmissao) porChave.set(chave, titulo.dataEmissao.trim());
  }
  return [...porChave.entries()].sort((a, b) => a[0] - b[0]).map(([, data]) => data);
}

function arredondarDinheiroLocal(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function repartirProporcional(valor: number, fracao: number): number {
  return valor * fracao;
}

function calcularMargemDaLinha(dados: {
  valorBruto: number;
  receitaTotal: number;
  valorIPI: number;
  valorIcmsSt: number;
  valorFrete: number;
  valorSeguro: number;
  outrasDespesasFrete: number;
  impostosEmbutidos: ImpostosEmbutidos;
}): ResultadoMargemComissionamento {
  return calcularMargemComissionamento({
    valorVenda: dados.valorBruto,
    valorMercadorias: dados.receitaTotal,
    valorIPI: dados.valorIPI,
    valorIcmsSt: dados.valorIcmsSt,
    valorFrete: dados.valorFrete,
    valorSeguro: dados.valorSeguro,
    outrasDespesas: dados.outrasDespesasFrete,
    impostosEmbutidos: dados.impostosEmbutidos,
  });
}

/**
 * Descobre a família (descrição real cadastrada na Omie) de cada produto
 * único presente na lista de itens — cacheada por `ClienteOmie.consultarProduto`,
 * então nunca repete a chamada para o mesmo produto entre pedidos. Falha ao
 * identificar um produto nunca derruba o relatório: ele só fica de fora da
 * segregação por comissão fixa (trata como família desconhecida).
 */
async function determinarFamiliasDosItens(
  cliente: ClienteOmieParaComissionamento,
  itens: ReadonlyArray<{ codigoProduto: number }>,
): Promise<Map<number, string | null>> {
  const familiaPorCodigo = new Map<number, string | null>();
  const codigosUnicos = [...new Set(itens.map((i) => i.codigoProduto))];
  await Promise.all(
    codigosUnicos.map(async (codigo) => {
      try {
        const produto = await cliente.consultarProduto(codigo);
        familiaPorCodigo.set(codigo, produto.descricao_familia ?? null);
      } catch {
        familiaPorCodigo.set(codigo, null);
      }
    }),
  );
  return familiaPorCodigo;
}

interface ResultadoComissaoLinha {
  margem: ResultadoMargemComissionamento;
  comissaoNormalPercentual: number;
  adicionalVendedorPercentual: number;
  comissaoFinalPercentual: number;
  comissaoTotal: number;
  vendedorComissaoFixaPercentual?: number;
  segregacaoComissaoFixa?: SegregacaoComissaoFixa;
}

/**
 * Calcula a comissão de um pedido aplicando, em ordem de prioridade (regra
 * de negócio de 2026-09-10):
 *   1. Vendedor com comissão fixa (`VENDEDORES_COMISSAO_FIXA`) — ignora
 *      margem e família por completo, aplica sobre o pedido inteiro.
 *   2. Item(ns) de família com comissão fixa (`FAMILIAS_COMISSAO_FIXA`) —
 *      segrega esses itens do cálculo por margem; eles usam o percentual
 *      fixo da família, o resto do pedido segue a regra normal.
 *   3. Regra normal já estabelecida (margem progressiva + adicional do
 *      vendedor especial).
 */
async function calcularComissaoDaLinha(
  cliente: ClienteOmieParaComissionamento,
  linha: LinhaRelatorio,
): Promise<ResultadoComissaoLinha> {
  const margemPedidoInteiro = calcularMargemDaLinha(linha);

  const comissaoFixaVendedor = comissaoFixaDoVendedor(linha.nomeVendedor);
  if (comissaoFixaVendedor !== null) {
    const comissaoTotal = calcularComissaoTotal(linha.receitaTotal, comissaoFixaVendedor);
    return {
      margem: margemPedidoInteiro,
      comissaoNormalPercentual: comissaoFixaVendedor,
      adicionalVendedorPercentual: 0,
      comissaoFinalPercentual: comissaoFixaVendedor,
      comissaoTotal,
      vendedorComissaoFixaPercentual: comissaoFixaVendedor,
    };
  }

  const familiaPorCodigo = await determinarFamiliasDosItens(cliente, linha.itens);
  const itensComissaoFixa = linha.itens.filter((item) => comissaoFixaDaFamilia(familiaPorCodigo.get(item.codigoProduto)) !== null);

  if (itensComissaoFixa.length === 0) {
    const { comissaoNormalPercentual, adicionalVendedorPercentual, comissaoFinalPercentual } = calcularComissaoVendedor(
      margemPedidoInteiro.margemComissionamentoPercentual ?? 0,
      linha.nomeVendedor,
    );
    const comissaoTotal = calcularComissaoTotal(linha.receitaTotal, comissaoFinalPercentual);
    return { margem: margemPedidoInteiro, comissaoNormalPercentual, adicionalVendedorPercentual, comissaoFinalPercentual, comissaoTotal };
  }

  const primeiroItemFixo = itensComissaoFixa[0];
  const nomeFamilia = (primeiroItemFixo && familiaPorCodigo.get(primeiroItemFixo.codigoProduto)) || 'Comissão fixa';
  const percentualFixo = comissaoFixaDaFamilia(nomeFamilia) ?? 0;
  const receitaComissaoFixa = itensComissaoFixa.reduce((soma, item) => soma + item.receita, 0);
  const receitaNormal = linha.receitaTotal - receitaComissaoFixa;

  if (receitaNormal <= 0) {
    // Pedido 100% da família com comissão fixa — nada para segregar. Aplica o percentual fixo sobre o
    // pedido inteiro, MAS o adicional do vendedor especial (Sandro/Horacio/Roberto Rocha) continua somando
    // por cima — a comissão fixa da família nunca suprime o adicional do vendedor (confirmado 2026-09-10).
    const adicionalVendedorPercentual = ehVendedorComAdicional(linha.nomeVendedor) ? 1 : 0;
    const comissaoFinalPercentual = percentualFixo + adicionalVendedorPercentual;
    const comissaoTotal = calcularComissaoTotal(linha.receitaTotal, comissaoFinalPercentual);
    return {
      margem: margemPedidoInteiro,
      comissaoNormalPercentual: percentualFixo,
      adicionalVendedorPercentual,
      comissaoFinalPercentual,
      comissaoTotal,
    };
  }

  const fracaoNormal = receitaNormal / linha.receitaTotal;
  const margemNormal = calcularMargemDaLinha({
    valorBruto: repartirProporcional(linha.valorBruto, fracaoNormal),
    receitaTotal: receitaNormal,
    valorIPI: repartirProporcional(linha.valorIPI, fracaoNormal),
    valorIcmsSt: repartirProporcional(linha.valorIcmsSt, fracaoNormal),
    valorFrete: repartirProporcional(linha.valorFrete, fracaoNormal),
    valorSeguro: repartirProporcional(linha.valorSeguro, fracaoNormal),
    outrasDespesasFrete: repartirProporcional(linha.outrasDespesasFrete, fracaoNormal),
    impostosEmbutidos: {
      icms: repartirProporcional(linha.impostosEmbutidos.icms, fracaoNormal),
      pis: repartirProporcional(linha.impostosEmbutidos.pis, fracaoNormal),
      cofins: repartirProporcional(linha.impostosEmbutidos.cofins, fracaoNormal),
      ibs: repartirProporcional(linha.impostosEmbutidos.ibs, fracaoNormal),
      cbs: repartirProporcional(linha.impostosEmbutidos.cbs, fracaoNormal),
    },
  });

  const { comissaoNormalPercentual, adicionalVendedorPercentual, comissaoFinalPercentual } = calcularComissaoVendedor(
    margemNormal.margemComissionamentoPercentual ?? 0,
    linha.nomeVendedor,
  );
  const comissaoValorNormal = calcularComissaoTotal(receitaNormal, comissaoFinalPercentual);
  // O adicional do vendedor especial soma também sobre a parte de comissão fixa da família — nunca é suprimido pela família (confirmado 2026-09-10).
  const percentualFixoComAdicional = percentualFixo + adicionalVendedorPercentual;
  const comissaoValorFixa = calcularComissaoTotal(receitaComissaoFixa, percentualFixoComAdicional);

  return {
    margem: margemNormal,
    comissaoNormalPercentual,
    adicionalVendedorPercentual,
    comissaoFinalPercentual,
    comissaoTotal: comissaoValorNormal + comissaoValorFixa,
    segregacaoComissaoFixa: {
      nomeFamilia,
      percentualFixo,
      adicionalVendedorPercentual,
      receitaComissaoFixa: arredondarDinheiroLocal(receitaComissaoFixa),
      comissaoValorFixa: arredondarDinheiroLocal(comissaoValorFixa),
      receitaNormal: arredondarDinheiroLocal(receitaNormal),
      comissaoValorNormal: arredondarDinheiroLocal(comissaoValorNormal),
    },
  };
}

/**
 * Rotula cada parcela com o número da fatura parcial a que ela pertence (ex.:
 * "154/1", "154/2"), no mesmo padrão exibido no Kanban da Omie — pedido
 * "existe alguns pedidos que são faturados parcialmente ... preciso que
 * apareça ... no relatório de comissão" (requisito de 2026-09-10). Agrupa as
 * parcelas por `numeroNotaFiscal` e numera os grupos em ordem crescente do
 * número da NF (reflete a ordem cronológica real de emissão). Só rotula
 * quando há MAIS de uma nota fiscal distinta entre as parcelas do pedido —
 * um pedido faturado numa única nota nunca ganha o sufixo "/1".
 */
function rotularFaturamentoParcial(numeroPedido: string, parcelas: ParcelaComissao[]): ParcelaComissao[] {
  const notasFiscaisUnicas = [...new Set(parcelas.map((p) => p.numeroNotaFiscal).filter((nf): nf is string => nf !== null && nf !== undefined))].sort();
  if (notasFiscaisUnicas.length <= 1) return parcelas;

  const indicePorNotaFiscal = new Map(notasFiscaisUnicas.map((nf, indice) => [nf, indice + 1]));
  return parcelas.map((parcela) => {
    const indice = parcela.numeroNotaFiscal ? indicePorNotaFiscal.get(parcela.numeroNotaFiscal) : undefined;
    return {
      ...parcela,
      numeroFaturaParcial: indice !== undefined ? `${numeroPedido}/${indice}` : null,
    };
  });
}

/**
 * Gera o relatório de Comissionamento — exclusivamente sobre PEDIDO (compra
 * concreta). Orçamentos nunca entram aqui (a chamada a `gerarRelatorio` é
 * sempre travada em `tipoDocumento: 'PEDIDO'`, sem exceção).
 *
 * REGRA CRÍTICA (confirmada com o usuário em 2026-09-05): o custo do
 * produto NUNCA é abatido para determinar a margem de comissionamento nem a
 * base da comissão. Ver `calcularMargemComissionamento.ts` para a fórmula
 * completa e o mapeamento de campos Omie.
 *
 * Regras de comissão fixa (2026-09-10, prioridade nesta ordem — ver
 * `calcularComissaoDaLinha`): vendedor com comissão fixa > família de
 * produto com comissão fixa (segregada) > regra normal por margem.
 *
 * Fluxo:
 *   1. Reaproveita o relatório de Vendas já calculado (pedido, vendedor,
 *      cliente, valor bruto da venda, impostos/frete, itens).
 *   2. Para cada vendedor presente no resultado, busca os títulos de contas
 *      a receber vinculados a pedidos (`listarContasReceberPorVendedor`).
 *   3. Calcula a comissão de cada pedido (`calcularComissaoDaLinha`).
 *   4. Localiza as parcelas do pedido pelo código do pedido (`nCodPedido`)
 *      e distribui a comissão proporcionalmente ao valor de cada uma.
 *   5. Consolida comissão total, liberada (parcela baixada) e pendente.
 *   6. Com período informado (regra de 2026-09-28): inclui pedidos dos 12
 *      meses anteriores que tenham parcela com VENCIMENTO no período,
 *      partindo dos títulos (nunca varre 12 meses de pedidos), sem duplicar
 *      venda do período e sem somar venda/comissão total/quantidade deles.
 *
 * Elegibilidade (regra de 2026-09-28, ver `elegibilidadeComissionamento.ts`): só registros nas
 * etapas 50 (PV Liberado Financeiro) e 60 (Faturado), com a configuração da conta conferida antes
 * de gerar; cancelamento decidido POR REGISTRO, antes da consolidação do faturamento parcial —
 * uma fatura filha cancelada nunca derruba as faturas irmãs. Título CANCELADO não gera parcela,
 * comissão liberada/pendente nem valor faturado. Vale igual para os pedidos anteriores.
 */
export async function gerarRelatorioComissionamento(
  cliente: ClienteOmieParaComissionamento,
  filtros: FiltrosComissionamento,
): Promise<ResultadoComissionamento> {
  validarConfiguracaoEtapasComissionamento(await cliente.listarEtapasVendaProduto());

  // Títulos por vendedor, buscados uma vez e sempre em sequência (ver nota abaixo sobre chamadas
  // concorrentes) — compartilhados entre a avaliação de cancelamento e o cálculo das parcelas.
  const titulosPorVendedor = new Map<number, TituloContaReceber[]>();
  async function titulosDoVendedor(codigoVendedor: number): Promise<TituloContaReceber[]> {
    const emCache = titulosPorVendedor.get(codigoVendedor);
    if (emCache !== undefined) return emCache;
    const titulos = await cliente.listarContasReceberPorVendedor(codigoVendedor);
    titulosPorVendedor.set(codigoVendedor, titulos);
    return titulos;
  }

  const excecoesPorCodigoPedido = new Map<number, ExcecaoRevisaoManual>();
  const vendedoresParaExcecao = await cliente.listarVendedores();
  const avaliarRegistro: AvaliarRegistroPedido = async (pedido, codigoVendedor) => {
    const cancelado = pedido.infoCadastro?.cancelado === 'S';
    // Cancelado sem vendedor: os títulos só são consultáveis por vendedor, então não dá para
    // verificá-los (`null`) — vira exceção para revisão manual, nunca "cancelado sem título".
    let titulosDoRegistro: TituloContaReceber[] | null = [];
    if (cancelado) {
      titulosDoRegistro =
        codigoVendedor === null
          ? null
          : (await titulosDoVendedor(codigoVendedor)).filter((t) => t.codigoPedido === pedido.cabecalho.codigo_pedido);
    }
    const resultado = avaliarRegistroComissionamento(pedido, titulosDoRegistro);
    if (resultado.decisao === 'EXCECAO') {
      excecoesPorCodigoPedido.set(pedido.cabecalho.codigo_pedido, {
        codigoPedido: pedido.cabecalho.codigo_pedido,
        numeroPedido: pedido.cabecalho.numero_pedido,
        etapa: pedido.cabecalho.etapa,
        codigoVendedor,
        nomeVendedor: vendedoresParaExcecao.find((v) => v.codigo === codigoVendedor)?.nome ?? null,
        valor: pedido.total_pedido?.valor_total_pedido ?? 0,
        titulos: resultado.titulosAtivos.map((t) => ({
          numeroParcela: t.numeroParcela,
          numeroNotaFiscal: t.numeroNotaFiscal,
          statusTitulo: t.statusTitulo,
          valor: t.valorDocumento,
          dataVencimento: t.dataVencimento,
        })),
        motivo: resultado.motivo,
      });
    }
    return resultado.decisao === 'ELEGIVEL';
  };

  const relatorioVendas = await gerarRelatorio(
    cliente,
    {
      tipoDocumento: 'PEDIDO',
      dataDe: filtros.dataDe,
      dataAte: filtros.dataAte,
      codigoVendedor: filtros.codigoVendedor,
    },
    undefined,
    avaliarRegistro,
  );

  const comVendedor = relatorioVendas.linhas.filter((l) => l.codigoVendedor !== null);
  const semVendedor = relatorioVendas.linhas.filter((l) => l.codigoVendedor === null);
  const pedidosSemVendedorExcluidos = semVendedor.length;
  const numerosPedidosSemVendedor = semVendedor.map((l) => l.numeroPedido);

  // Janela de pedidos anteriores (regra de 2026-09-28): só existe com período completo informado.
  // "Parcela no período" = VENCIMENTO do título dentro do período (única data que a Omie dá por
  // título; liberada/pendente continuam decididas só pelo status, como sempre).
  const inicioPeriodo = chaveData(filtros.dataDe);
  const fimPeriodo = chaveData(filtros.dataAte);

  // Vendedores cujos títulos são necessários: os das vendas do período e, com janela, também os
  // que podem ter parcela de pedido antigo vencendo no período — o vendedor filtrado ou, sem
  // filtro, todos os vendedores (a restrição por vendedor continua vindo de `codigoVendedor`).
  const codigosVendedor = new Set(comVendedor.map((l) => l.codigoVendedor as number));
  if (inicioPeriodo !== null && fimPeriodo !== null) {
    if (filtros.codigoVendedor !== undefined) codigosVendedor.add(filtros.codigoVendedor);
    else for (const vendedor of await cliente.listarVendedores()) codigosVendedor.add(vendedor.codigo);
  }

  // Sequencial, nunca Promise.all: a Omie rejeita chamadas concorrentes do
  // MESMO método ("Já existe uma requisição desse método sendo executada"),
  // mesmo respeitando o espaçamento mínimo entre início de chamadas — o
  // limitador só espaça o INÍCIO, não impede sobreposição quando a resposta
  // demora mais que o intervalo mínimo (confirmado em 2026-09-05 contra a
  // API real).
  //
  // Indexado por codigoPedido E por numeroPedido: faturamento parcial
  // (confirmado contra a API real em 2026-09-10 — ver `TituloContaReceber`)
  // gera títulos com um `nCodPedido` PRÓPRIO, diferente do `codigoPedido` do
  // pedido original, mas sempre com o mesmo `numeroPedido` — por isso o
  // vínculo por código sozinho perde os títulos das faturas parciais.
  //
  // Título CANCELADO fica fora dos índices: não gera parcela, comissão liberada/pendente, valor
  // faturado nem data de faturamento, e não traz pedido anterior para o período.
  const titulosPorCodigoPedido = new Map<number, TituloContaReceber[]>();
  const titulosPorNumeroPedido = new Map<string, TituloContaReceber[]>();
  for (const codigo of codigosVendedor) {
    const titulos = await titulosDoVendedor(codigo);
    for (const titulo of titulos) {
      if (titulo.statusTitulo === 'CANCELADO') continue;
      if (titulo.codigoPedido !== null) {
        const lista = titulosPorCodigoPedido.get(titulo.codigoPedido) ?? [];
        lista.push(titulo);
        titulosPorCodigoPedido.set(titulo.codigoPedido, lista);
      }
      if (titulo.numeroPedido !== null) {
        const lista = titulosPorNumeroPedido.get(titulo.numeroPedido) ?? [];
        lista.push(titulo);
        titulosPorNumeroPedido.set(titulo.numeroPedido, lista);
      }
    }
  }

  /** União dos títulos vinculados por código OU por número (faturamento parcial) — nunca duplica um mesmo título presente nos dois índices. */
  function localizarTitulosDoPedido(linha: LinhaRelatorio): TituloContaReceber[] {
    const porCodigo = titulosPorCodigoPedido.get(linha.codigoPedido) ?? [];
    const porNumero = titulosPorNumeroPedido.get(linha.numeroPedido) ?? [];
    const vistos = new Set<number>();
    const combinados: TituloContaReceber[] = [];
    for (const titulo of [...porCodigo, ...porNumero]) {
      if (vistos.has(titulo.codigoLancamentoOmie)) continue;
      vistos.add(titulo.codigoLancamentoOmie);
      combinados.push(titulo);
    }
    return combinados;
  }

  function venceNoPeriodo(dataVencimento: string | null | undefined): boolean {
    const chave = chaveData(dataVencimento);
    return chave !== null && inicioPeriodo !== null && fimPeriodo !== null && chave >= inicioPeriodo && chave <= fimPeriodo;
  }

  async function calcularLinha(linha: LinhaRelatorio, origem: OrigemLinhaComissionamento): Promise<LinhaComissionamento> {
    return calcularLinhaComissionamento(cliente, linha, localizarTitulosDoPedido(linha), origem, (p) => venceNoPeriodo(p.dataVencimento));
  }

  const linhasDoPeriodo: LinhaComissionamento[] = await Promise.all(comVendedor.map((linha) => calcularLinha(linha, 'PERIODO')));

  // Pedidos anteriores trazidos por parcela: parte dos TÍTULOS com vencimento no período (nunca
  // varre 12 meses de pedidos). Pedido que já é venda do período nunca entra de novo.
  const linhasAnteriores: LinhaComissionamento[] = [];
  const numerosPedidosAnterioresNaoLocalizados: string[] = [];
  if (inicioPeriodo !== null && fimPeriodo !== null) {
    const limiteInferior = chaveDozeMesesAntes(inicioPeriodo);
    const numerosDoPeriodo = new Set(relatorioVendas.linhas.map((l) => l.numeroPedido));
    const candidatos = [...titulosPorNumeroPedido.entries()]
      .filter(([numero, titulos]) => !numerosDoPeriodo.has(numero) && titulos.some((t) => venceNoPeriodo(t.dataVencimento)))
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }));

    if (candidatos.length > 0) {
      const [etapas, vendedores] = await Promise.all([cliente.listarEtapasVendaProduto(), cliente.listarVendedores()]);
      for (const [numeroPedido, titulos] of candidatos) {
        // Faturamento parcial: o registro original consultado sozinho vem com os itens já movidos
        // zerados — por isso busca também o registro de CADA fatura (o `nCodPedido` dos títulos) e
        // consolida exatamente como o relatório do período faz (`montarLinhasDePedidos`).
        let registros: PedidoOmie[];
        try {
          registros = [await cliente.consultarPedido({ numeroPedido })];
          const codigosFaturas = [...new Set(titulos.map((t) => t.codigoPedido).filter((c): c is number => c !== null))];
          for (const codigoPedido of codigosFaturas) {
            if (registros.some((r) => r.cabecalho.codigo_pedido === codigoPedido)) continue;
            registros.push(await cliente.consultarPedido({ codigoPedido }));
          }
        } catch {
          numerosPedidosAnterioresNaoLocalizados.push(numeroPedido);
          continue;
        }

        // Janela: mesma referência de data que decide se um pedido é "do período". O filtro
        // `filtrar_por_data_de/ate` do `ListarPedidos` seleciona pela INCLUSÃO ou pela ÚLTIMA
        // ALTERAÇÃO do registro (`infoCadastro.dInc`/`dAlt`) — confirmado contra a API real em
        // 2026-09-28: 66/66 pedidos de 01–15/09/2026 com dInc ou dAlt no intervalo, contra 46/66
        // pela `data_previsao`. Entra se algum registro do pedido (original ou fatura) seria
        // listado pelo mesmo filtro na janela [início − 12 meses, início). Sem data: não entra.
        const naJanela = (data: string | undefined) => {
          const chave = chaveData(data);
          return chave !== null && chave >= limiteInferior && chave < inicioPeriodo;
        };
        if (!registros.some((r) => naJanela(r.infoCadastro?.dInc) || naJanela(r.infoCadastro?.dAlt))) continue;

        const { linhas: linhasDoPedido } = await montarLinhasDePedidos(
          cliente,
          registros,
          { tipoDocumento: 'PEDIDO', codigoVendedor: filtros.codigoVendedor },
          { etapas, vendedores },
          undefined,
          avaliarRegistro,
        );
        for (const linha of linhasDoPedido) {
          if (linha.numeroPedido !== numeroPedido || linha.codigoVendedor === null) continue;
          linhasAnteriores.push(await calcularLinha(linha, 'PARCELA_PERIODO_ANTERIOR'));
        }
      }
    }
  }

  const linhas = [...linhasDoPeriodo, ...linhasAnteriores];

  // Venda/comissão total/quantidade: só vendas do período (pedido anterior nunca infla o mês).
  // Liberada/pendente/parcelas: todas as linhas — nos pedidos anteriores, já só as do período.
  const resumo: ResumoComissionamento = {
    quantidadePedidos: linhasDoPeriodo.length,
    valorVendaTotal: arredondarDinheiroLocal(linhasDoPeriodo.reduce((s, l) => s + l.valorBruto, 0)),
    comissaoTotalCalculada: arredondarDinheiroLocal(linhasDoPeriodo.reduce((s, l) => s + l.comissaoTotal, 0)),
    comissaoLiberada: arredondarDinheiroLocal(linhas.reduce((s, l) => s + l.comissaoLiberada, 0)),
    comissaoPendente: arredondarDinheiroLocal(linhas.reduce((s, l) => s + l.comissaoPendente, 0)),
    quantidadeParcelasTotal: linhas.reduce((s, l) => s + l.parcelas.length, 0),
    quantidadeParcelasBaixadas: linhas.reduce((s, l) => s + l.parcelas.filter((p) => p.baixado).length, 0),
    quantidadeParcelasPendentes: linhas.reduce((s, l) => s + l.parcelas.filter((p) => !p.baixado).length, 0),
  };

  return {
    linhas,
    resumo,
    documentosAmbiguosExcluidos: relatorioVendas.documentosAmbiguosExcluidos,
    pedidosSemVendedorExcluidos,
    numerosPedidosSemVendedor,
    numerosPedidosAnterioresNaoLocalizados,
    excecoesRevisaoManual: [...excecoesPorCodigoPedido.values()],
  };
}

/** Cálculo de sempre (margem → comissão → parcelas → liberada/pendente) para uma linha — idêntico para venda do período e pedido anterior. */
export async function calcularLinhaComissionamento(
  cliente: ClienteOmieParaComissionamento,
  linha: LinhaRelatorio,
  titulosDoPedido: TituloContaReceber[],
  origem: OrigemLinhaComissionamento = 'PERIODO',
  selecionarParcela: (parcela: ParcelaComissao) => boolean = () => true,
): Promise<LinhaComissionamento> {
  const {
    margem,
    comissaoNormalPercentual,
    adicionalVendedorPercentual,
    comissaoFinalPercentual,
    comissaoTotal,
    vendedorComissaoFixaPercentual,
    segregacaoComissaoFixa,
  } = await calcularComissaoDaLinha(cliente, linha);

  // Percentual efetivo (comissão total ÷ receita) para distribuir a comissão pelas parcelas
  // proporcionalmente ao peso de cada uma — necessário porque, com segregação, a comissão do
  // pedido não é mais um único percentual aplicado à base (é a soma de duas partes).
  const percentualEfetivo = linha.receitaTotal === 0 ? 0 : (comissaoTotal / linha.receitaTotal) * 100;

  const parcelasSemFatura = distribuirComissaoPorParcelas(
    linha.receitaTotal,
    percentualEfetivo,
    titulosDoPedido.map((t) => ({
      codigoLancamentoOmie: t.codigoLancamentoOmie,
      numeroParcela: t.numeroParcela,
      valorBruto: t.valorDocumento,
      statusTitulo: t.statusTitulo,
      numeroNotaFiscal: t.numeroNotaFiscal,
      dataVencimento: t.dataVencimento,
      dataEmissao: t.dataEmissao ?? null,
    })),
  );
  const todasAsParcelas = rotularFaturamentoParcial(linha.numeroPedido, parcelasSemFatura);

  // Venda do período: todas as parcelas, liberada/pendente sobre a comissão inteira (regra de
  // sempre). Pedido anterior: só as parcelas que vencem no período — a distribuição acima já
  // usou TODAS as parcelas, então o valor de cada parcela é exatamente o mesmo de sempre.
  const parcelas = origem === 'PERIODO' ? todasAsParcelas : todasAsParcelas.filter(selecionarParcela);
  const comissaoLiberada = parcelas.filter((p) => p.baixado).reduce((soma, p) => soma + p.comissaoParcela, 0);
  const comissaoPendente =
    origem === 'PERIODO'
      ? comissaoTotal - comissaoLiberada
      : parcelas.filter((p) => !p.baixado).reduce((soma, p) => soma + p.comissaoParcela, 0);

  const valorFaturado = titulosDoPedido.reduce((soma, t) => soma + t.valorDocumento, 0);
  const saldoAFaturar = linha.valorBruto - valorFaturado;

  return {
    ...linha,
    despesasIPI: arredondarDinheiroLocal(margem.despesasIPI),
    despesasIcmsSt: arredondarDinheiroLocal(margem.despesasIcmsSt),
    despesasFreteSeguroOutras: arredondarDinheiroLocal(margem.despesasFreteSeguroOutras),
    despesasTotal: arredondarDinheiroLocal(margem.despesasTotal),
    resultadoAposDespesas: arredondarDinheiroLocal(margem.resultadoAposDespesas),
    margemComissionamentoPercentual:
      margem.margemComissionamentoPercentual === null ? null : arredondarDinheiroLocal(margem.margemComissionamentoPercentual),
    impostosEmbutidos: {
      icms: arredondarDinheiroLocal(margem.impostosEmbutidos.icms),
      pis: arredondarDinheiroLocal(margem.impostosEmbutidos.pis),
      cofins: arredondarDinheiroLocal(margem.impostosEmbutidos.cofins),
      ibs: arredondarDinheiroLocal(margem.impostosEmbutidos.ibs),
      cbs: arredondarDinheiroLocal(margem.impostosEmbutidos.cbs),
    },
    comissaoNormalPercentual: arredondarDinheiroLocal(comissaoNormalPercentual),
    adicionalVendedorPercentual: arredondarDinheiroLocal(adicionalVendedorPercentual),
    comissaoFinalPercentual: arredondarDinheiroLocal(comissaoFinalPercentual),
    comissaoTotal: arredondarDinheiroLocal(comissaoTotal),
    parcelas,
    comissaoLiberada: arredondarDinheiroLocal(comissaoLiberada),
    comissaoPendente: arredondarDinheiroLocal(comissaoPendente),
    semTitulosLocalizados: titulosDoPedido.length === 0,
    origem,
    datasFaturamento: datasFaturamentoDosTitulos(titulosDoPedido),
    valorFaturado: arredondarDinheiroLocal(valorFaturado),
    saldoAFaturar: arredondarDinheiroLocal(saldoAFaturar),
    ...(vendedorComissaoFixaPercentual !== undefined ? { vendedorComissaoFixaPercentual } : {}),
    ...(segregacaoComissaoFixa !== undefined ? { segregacaoComissaoFixa } : {}),
  };
}
