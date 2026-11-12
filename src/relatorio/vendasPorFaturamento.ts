import type { PedidoOmie } from '../calculo/tipos.js';
import type { TituloContaReceber } from '../omie/cliente.js';
import { classificarEtapa } from '../omie/classificacaoDocumento.js';
import {
  calcularResumo,
  dataDeHojeFormatoOmie,
  extrairCodigoVendedor,
  gerarRelatorio,
  MAX_PAGINAS_OMIE,
  montarLinhasDePedidos,
  REGISTROS_POR_PAGINA_OMIE,
  type ClienteOmieParaRelatorioAgregado,
  type LinhaRelatorio,
  type ResultadoRelatorio,
} from './relatorioVendas.js';

/** Somente leitura: o cliente Omie dos relatórios + títulos de contas a receber por vendedor. */
export interface ClienteOmieParaVendasFaturadas extends ClienteOmieParaRelatorioAgregado {
  listarContasReceberPorVendedor(codigoVendedor: number): Promise<TituloContaReceber[]>;
}

export interface FiltrosVendasFaturadas {
  dataDe?: string;
  dataAte?: string;
  codigoVendedor?: number;
}

export interface ResultadoVendasFaturadas extends ResultadoRelatorio {
  /**
   * Pedidos sem vendedor identificado: os títulos só são consultáveis por vendedor, então a data
   * de faturamento não pode ser conferida — ficam fora (nunca entram por adivinhação), com aviso.
   */
  numerosPedidosSemVendedorNaoVerificados: string[];
}

/** "dd/mm/aaaa" → aaaammdd; `null` se não for uma data nesse formato. */
function chaveData(data: string | null | undefined): number | null {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((data ?? '').trim());
  if (partes === null) return null;
  return Number(partes[3]) * 10000 + Number(partes[2]) * 100 + Number(partes[1]);
}

/**
 * Relatório de Vendas — Resultado Concreto, com o período pela DATA DE FATURAMENTO (regra de
 * 2026-11-12, pedida pelo usuário: "01 a 31/10 tem que trazer o que foi faturado no mês").
 *
 * Por que não basta o filtro da Omie: `ListarPedidos` (`filtrar_por_data_de/ate`) seleciona pela
 * INCLUSÃO ou ÚLTIMA ALTERAÇÃO do registro — trazia pedidos faturados em outros meses (só
 * alterados no período) e a tela mostrava a data de previsão.
 *
 * Como funciona:
 *   1. Lista os pedidos com inclusão/alteração de `dataDe` até HOJE (ou `dataAte`, se for depois):
 *      todo registro faturado dentro do período foi incluído ou alterado nessa janela.
 *   2. Data de faturamento = `data_emissao` dos títulos (contas a receber, origem VENR) não
 *      cancelados do registro — a mesma fonte do Comissionamento. Cada fatura parcial é um registro
 *      próprio (`nCodPedido` próprio), então no faturamento parcial entra só a parte faturada no
 *      período.
 *   3. Só os registros com fatura no período seguem para a montagem de sempre
 *      (`montarLinhasDePedidos`: custo, margem, cliente, consolidação por número do pedido). A
 *      coluna Data passa a mostrar a data de faturamento.
 *
 * Sem período completo (data inicial E final), o comportamento antigo é mantido.
 */
export async function gerarRelatorioVendasFaturadas(
  cliente: ClienteOmieParaVendasFaturadas,
  filtros: FiltrosVendasFaturadas,
  hoje: string = dataDeHojeFormatoOmie(),
): Promise<ResultadoVendasFaturadas> {
  const inicio = chaveData(filtros.dataDe);
  const fim = chaveData(filtros.dataAte);
  if (inicio === null || fim === null || filtros.dataDe === undefined || filtros.dataAte === undefined) {
    const antigo = await gerarRelatorio(cliente, { tipoDocumento: 'PEDIDO', ...filtros });
    return { ...antigo, numerosPedidosSemVendedorNaoVerificados: [] };
  }

  const [etapas, vendedores] = await Promise.all([cliente.listarEtapasVendaProduto(), cliente.listarVendedores()]);

  const ateListagem = (chaveData(hoje) ?? 0) > fim ? hoje : filtros.dataAte;

  const registros: PedidoOmie[] = [];
  let pagina = 1;
  let totalDePaginas = 1;
  let paginasConsultadas = 0;
  do {
    const resultado = await cliente.listarPedidosCompletos({
      pagina,
      registrosPorPagina: REGISTROS_POR_PAGINA_OMIE,
      dataDe: filtros.dataDe,
      dataAte: ateListagem,
    });
    registros.push(...resultado.pedidos);
    totalDePaginas = resultado.totalDePaginas;
    paginasConsultadas += 1;
    pagina += 1;
  } while (pagina <= totalDePaginas && paginasConsultadas < MAX_PAGINAS_OMIE);
  const limiteAtingido = paginasConsultadas >= MAX_PAGINAS_OMIE && pagina <= totalDePaginas;

  // Títulos por vendedor — sempre em sequência (a Omie rejeita chamadas concorrentes do mesmo método).
  const codigosVendedor = new Set<number>();
  for (const registro of registros) {
    const codigo = extrairCodigoVendedor(registro);
    if (codigo === null) continue;
    if (filtros.codigoVendedor !== undefined && codigo !== filtros.codigoVendedor) continue;
    codigosVendedor.add(codigo);
  }
  const titulosPorCodigoPedido = new Map<number, TituloContaReceber[]>();
  const titulosSemCodigoPorNumero = new Map<string, TituloContaReceber[]>();
  for (const codigo of codigosVendedor) {
    for (const titulo of await cliente.listarContasReceberPorVendedor(codigo)) {
      if (titulo.statusTitulo === 'CANCELADO') continue;
      if (titulo.codigoPedido !== null) {
        const lista = titulosPorCodigoPedido.get(titulo.codigoPedido) ?? [];
        lista.push(titulo);
        titulosPorCodigoPedido.set(titulo.codigoPedido, lista);
      } else if (titulo.numeroPedido !== null) {
        const lista = titulosSemCodigoPorNumero.get(titulo.numeroPedido) ?? [];
        lista.push(titulo);
        titulosSemCodigoPorNumero.set(titulo.numeroPedido, lista);
      }
    }
  }

  // Título sem `nCodPedido` só vincula pelo número quando há UM registro com esse número — no
  // faturamento parcial (vários registros, mesmo número) não dá para saber de qual fatura ele é.
  const registrosPorNumero = new Map<string, number>();
  for (const registro of registros) {
    registrosPorNumero.set(registro.cabecalho.numero_pedido, (registrosPorNumero.get(registro.cabecalho.numero_pedido) ?? 0) + 1);
  }

  // Primeira data de faturamento no período por número do pedido (exibida na coluna Data).
  const dataFaturamentoPorNumero = new Map<string, { chave: number; data: string }>();
  const numerosSemVendedor = new Set<string>();
  const faturadosNoPeriodo: PedidoOmie[] = [];
  for (const registro of registros) {
    const codigoVendedor = extrairCodigoVendedor(registro);
    if (codigoVendedor === null) {
      const classificacao = classificarEtapa(registro.cabecalho.etapa, etapas);
      if (!classificacao.ambiguo && classificacao.tipo === 'PEDIDO') numerosSemVendedor.add(registro.cabecalho.numero_pedido);
      continue;
    }
    if (filtros.codigoVendedor !== undefined && codigoVendedor !== filtros.codigoVendedor) continue;
    const titulos =
      titulosPorCodigoPedido.get(registro.cabecalho.codigo_pedido) ??
      (registrosPorNumero.get(registro.cabecalho.numero_pedido) === 1
        ? titulosSemCodigoPorNumero.get(registro.cabecalho.numero_pedido)
        : undefined) ??
      [];
    let primeira: { chave: number; data: string } | null = null;
    for (const titulo of titulos) {
      const chave = chaveData(titulo.dataEmissao);
      if (chave === null || chave < inicio || chave > fim) continue;
      if (primeira === null || chave < primeira.chave) primeira = { chave, data: (titulo.dataEmissao ?? '').trim() };
    }
    if (primeira === null) continue;
    faturadosNoPeriodo.push(registro);
    const atual = dataFaturamentoPorNumero.get(registro.cabecalho.numero_pedido);
    if (atual === undefined || primeira.chave < atual.chave) dataFaturamentoPorNumero.set(registro.cabecalho.numero_pedido, primeira);
  }

  const { linhas, documentosAmbiguosExcluidos } = await montarLinhasDePedidos(
    cliente,
    faturadosNoPeriodo,
    { tipoDocumento: 'PEDIDO', codigoVendedor: filtros.codigoVendedor },
    { etapas, vendedores },
  );
  const linhasComData: LinhaRelatorio[] = linhas.map((linha) => ({
    ...linha,
    data: dataFaturamentoPorNumero.get(linha.numeroPedido)?.data ?? linha.data,
  }));
  linhasComData.sort((a, b) => (chaveData(a.data) ?? 0) - (chaveData(b.data) ?? 0) || a.numeroPedido.localeCompare(b.numeroPedido, 'pt-BR', { numeric: true }));

  return {
    linhas: linhasComData,
    resumo: calcularResumo(linhasComData),
    documentosAmbiguosExcluidos,
    paginasOmieConsultadas: paginasConsultadas,
    limiteAtingido,
    numerosPedidosSemVendedorNaoVerificados: filtros.codigoVendedor !== undefined ? [] : [...numerosSemVendedor].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
  };
}
