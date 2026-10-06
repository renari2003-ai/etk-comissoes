import {
  calcularComissaoTotal,
  comissaoFixaDoVendedor,
  distribuirComissaoPorParcelas,
  ehVendedorComAdicional,
  type ParcelaComissao,
} from './calcularComissao.js';
import {
  apurarComissaoPorTabela,
  ErroApuracaoComissao,
  type ComposicaoItemComissao,
  type ExcecaoApuracaoComissao,
} from './comissaoPorTabela.js';
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
import type { TabelaPreco } from '../omie/tabelasPreco.js';
import { memorizarCadastrosDaGeracao } from './memoCadastros.js';

export interface ClienteOmieParaComissionamento extends ClienteOmieParaRelatorioAgregado {
  /** Somente leitura (`ListarTabelasPreco` + `ListarTabelaItens`) — origem do percentual de comissão por item. */
  listarTabelasPreco(): Promise<TabelaPreco[]>;
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

export interface LinhaComissionamento extends LinhaRelatorio {
  /** total_pedido.valor_IPI — imposto somado "por fora" do valor dos produtos. */
  despesasIPI: number;
  /** total_pedido.valor_st (ICMS-ST/Substituição Tributária) — também somado "por fora". */
  despesasIcmsSt: number;
  despesasFreteSeguroOutras: number;
  despesasTotal: number;
  resultadoAposDespesas: number;
  /** Margem de comissionamento = (valor da venda − despesas) ÷ valor da venda — NUNCA usa custo de produto. Desde 2026-10-06 é só INFORMATIVA (administrador): a comissão vem da tabela de preços, por item (`composicaoItens`). */
  margemComissionamentoPercentual: number | null;
  /** ICMS/PIS/COFINS/IBS/CBS já embutidos no valor dos produtos — apenas informativo, nunca subtraído de novo (ver `calcularMargemComissionamento.ts`). */
  impostosEmbutidos: ImpostosEmbutidos;
  /**
   * Comissão normal EFETIVA do pedido = Σ (base do item × comissão normal do item) ÷ base da
   * comissão — com itens de taxas diferentes é a média ponderada (exibição; arredondada só na
   * saída, cada item é calculado sem arredondar). Igual ao fixo do vendedor quando
   * `vendedorComissaoFixaPercentual` está presente.
   */
  comissaoNormalPercentual: number;
  /** +1,00 quando o vendedor está em `VENDEDORES_COM_ADICIONAL`, senão 0 (seção 3) — somado em cada item, inclusive nos da tabela 001. Sempre 0 com `vendedorComissaoFixaPercentual` (Renato Pinto nunca recebe adicional). */
  adicionalVendedorPercentual: number;
  /** Comissão total ÷ base da comissão × 100 — percentual efetivo do pedido; pode chegar a 4% com adicional (seção 8: nunca limitado de novo em 3%). */
  comissaoFinalPercentual: number;
  /**
   * Base da comissão = Σ (valor de mercadoria − desconto) dos itens (regra de 2026-10-06: a Omie
   * devolve `valor_mercadoria` ANTES do desconto). Para vendedor com comissão fixa (Renato Pinto)
   * continua sendo o valor dos produtos (`receitaTotal`), como sempre foi.
   */
  baseComissao: number;
  /** Soma das comissões dos itens (sem arredondamento intermediário). */
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
   * ex.: Renato Pinto = 4%) — prioridade máxima, ignora a tabela de preços por
   * completo (regra de 2026-09-10).
   */
  vendedorComissaoFixaPercentual?: number;
  /**
   * Composição por item (tabela, Preço da Tabela, custo de referência, multiplicador, acréscimo,
   * comissão) — EXCLUSIVA de administrador (`visibilidadeMargem.ts`). Ausente para vendedor com
   * comissão fixa.
   */
  composicaoItens?: ComposicaoItemComissao[];
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
  /**
   * Pedidos elegíveis retirados da apuração automática por tabela não identificável, inativa,
   * ambígua ou sem regra, ou preço/dados inválidos (regra de 2026-10-06) — nunca somados com comissão zero nem pela regra antiga.
   */
  excecoesApuracao: ExcecaoApuracaoComissao[];
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

/** Arredondamento só na SAÍDA (dinheiro 2 casas; preço/custo 4; percentuais/multiplicadores 6) — o cálculo usa os valores brutos. */
function arredondarComposicao(item: ComposicaoItemComissao): ComposicaoItemComissao {
  const casas = (valor: number, n: number) => Math.round((valor + Number.EPSILON) * 10 ** n) / 10 ** n;
  const casasOuNulo = (valor: number | null, n: number) => (valor === null ? null : casas(valor, n));
  return {
    ...item,
    valorMercadoria: arredondarDinheiroLocal(item.valorMercadoria),
    valorDesconto: arredondarDinheiroLocal(item.valorDesconto),
    baseComissao: arredondarDinheiroLocal(item.baseComissao),
    precoUnitarioVendido: casas(item.precoUnitarioVendido, 4),
    precoTabela: casasOuNulo(item.precoTabela, 4),
    custoReferencia: casasOuNulo(item.custoReferencia, 4),
    multiplicadorRealizado: casasOuNulo(item.multiplicadorRealizado, 6),
    acrescimoPercentual: casasOuNulo(item.acrescimoPercentual, 6),
    comissaoNormalPercentual: casas(item.comissaoNormalPercentual, 6),
    comissaoFinalPercentual: casas(item.comissaoFinalPercentual, 6),
    comissaoValor: arredondarDinheiroLocal(item.comissaoValor),
  };
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

interface ResultadoComissaoLinha {
  margem: ResultadoMargemComissionamento;
  comissaoNormalPercentual: number;
  adicionalVendedorPercentual: number;
  comissaoFinalPercentual: number;
  baseComissao: number;
  comissaoTotal: number;
  vendedorComissaoFixaPercentual?: number;
  composicaoItens?: ComposicaoItemComissao[];
}

/**
 * Calcula a comissão de um pedido, em ordem de prioridade:
 *   1. Vendedor com comissão fixa (`VENDEDORES_COMISSAO_FIXA`, Renato Pinto 4%) — pedido inteiro,
 *      sem consultar a tabela de preços (regra de 2026-09-10, preservada).
 *   2. Por item, pela tabela de preços da Omie (regra de 2026-10-06, ver `comissaoPorTabela.ts`):
 *      tabela 001 = 1% fixo; 002/003 = progressão pelo acréscimo sobre o custo de referência; em
 *      todos, + adicional do vendedor especial. Comissão do pedido = soma dos itens.
 * Faltando tabela válida, regra, preço de referência ou dados do item em QUALQUER item, lança `ErroApuracaoComissao` — o
 * pedido inteiro sai da apuração automática; nunca volta para a regra antiga da margem.
 * A margem de comissionamento continua calculada só como informação (administrador).
 */
async function calcularComissaoDaLinha(
  cliente: ClienteOmieParaComissionamento,
  linha: LinhaRelatorio,
): Promise<ResultadoComissaoLinha> {
  const margem = calcularMargemDaLinha(linha);

  const comissaoFixaVendedor = comissaoFixaDoVendedor(linha.nomeVendedor);
  if (comissaoFixaVendedor !== null) {
    return {
      margem,
      comissaoNormalPercentual: comissaoFixaVendedor,
      adicionalVendedorPercentual: 0,
      comissaoFinalPercentual: comissaoFixaVendedor,
      baseComissao: linha.receitaTotal,
      comissaoTotal: calcularComissaoTotal(linha.receitaTotal, comissaoFixaVendedor),
      vendedorComissaoFixaPercentual: comissaoFixaVendedor,
    };
  }

  const apuracao = apurarComissaoPorTabela(linha.itens, await cliente.listarTabelasPreco(), linha.nomeVendedor);
  if (!apuracao.ok) throw new ErroApuracaoComissao(apuracao.problemas);

  const { baseComissao, comissaoTotal, comissaoNormalValor } = apuracao;
  return {
    margem,
    comissaoNormalPercentual: baseComissao === 0 ? 0 : (comissaoNormalValor / baseComissao) * 100,
    adicionalVendedorPercentual: ehVendedorComAdicional(linha.nomeVendedor) ? 1 : 0,
    comissaoFinalPercentual: baseComissao === 0 ? 0 : (comissaoTotal / baseComissao) * 100,
    baseComissao,
    comissaoTotal,
    composicaoItens: apuracao.itens,
  };
}

/** Exceção exibível (sem preço nem custo) a partir do erro do cálculo compartilhado. */
export function excecaoApuracaoDaLinha(linha: LinhaRelatorio, erro: ErroApuracaoComissao): ExcecaoApuracaoComissao {
  return {
    codigoPedido: linha.codigoPedido,
    numeroPedido: linha.numeroPedido,
    codigoVendedor: linha.codigoVendedor,
    nomeVendedor: linha.nomeVendedor,
    nomeCliente: linha.nomeCliente,
    valorProdutos: arredondarDinheiroLocal(linha.receitaTotal),
    problemas: erro.problemas,
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
 * Regras (prioridade nesta ordem — ver `calcularComissaoDaLinha`): vendedor
 * com comissão fixa (2026-09-10) > comissão por item pela tabela de preços
 * da Omie (2026-10-06). Pedido sem tabela/regra/preço válidos vai para
 * `excecoesApuracao`, fora dos totais.
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
  clienteOmie: ClienteOmieParaComissionamento,
  filtros: FiltrosComissionamento,
): Promise<ResultadoComissionamento> {
  // Produto/cliente repetidos nesta geração reaproveitam a 1ª consulta (sem mudar TTL) — `memoCadastros.ts`.
  const cliente = memorizarCadastrosDaGeracao(clienteOmie);
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

  const excecoesApuracao: ExcecaoApuracaoComissao[] = [];
  /** `null` = pedido fora da apuração automática (registrado em `excecoesApuracao`, nunca somado). */
  async function calcularLinha(linha: LinhaRelatorio, origem: OrigemLinhaComissionamento): Promise<LinhaComissionamento | null> {
    try {
      return await calcularLinhaComissionamento(cliente, linha, localizarTitulosDoPedido(linha), origem, (p) => venceNoPeriodo(p.dataVencimento));
    } catch (erro) {
      if (!(erro instanceof ErroApuracaoComissao)) throw erro;
      excecoesApuracao.push(excecaoApuracaoDaLinha(linha, erro));
      return null;
    }
  }

  const linhasDoPeriodo: LinhaComissionamento[] = (
    await Promise.all(comVendedor.map((linha) => calcularLinha(linha, 'PERIODO')))
  ).filter((linha): linha is LinhaComissionamento => linha !== null);

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
          const calculada = await calcularLinha(linha, 'PARCELA_PERIODO_ANTERIOR');
          if (calculada !== null) linhasAnteriores.push(calculada);
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
    excecoesApuracao,
  };
}

/**
 * Cálculo compartilhado (Comissionamento e Financeiro / Comissão): comissão por item → parcelas →
 * liberada/pendente — idêntico para venda do período e pedido anterior. Lança
 * `ErroApuracaoComissao` quando o pedido não pode ser apurado automaticamente.
 */
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
    baseComissao,
    comissaoTotal,
    vendedorComissaoFixaPercentual,
    composicaoItens,
  } = await calcularComissaoDaLinha(cliente, linha);

  // Itens com taxas diferentes: a comissão TOTAL (soma dos itens) é distribuída pelas parcelas na
  // proporção do valor de cada uma — o percentual efetivo só reproduz essa soma
  // (fração × base × total ÷ base); nunca recalcula uma taxa global pela margem.
  const percentualEfetivo = baseComissao === 0 ? 0 : (comissaoTotal / baseComissao) * 100;

  const parcelasSemFatura = distribuirComissaoPorParcelas(
    baseComissao,
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
    baseComissao: arredondarDinheiroLocal(baseComissao),
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
    ...(composicaoItens !== undefined ? { composicaoItens: composicaoItens.map(arredondarComposicao) } : {}),
  };
}
