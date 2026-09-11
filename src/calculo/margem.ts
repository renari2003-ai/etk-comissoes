import type {
  AlertaDivergenciaTotal,
  ItemCalculado,
  ItemPedidoOmie,
  MotivoAlertaItem,
  ResumoOperacional,
  TotaisPedido,
} from './tipos.js';
import { arredondarCustoUnitario, arredondarDinheiro, arredondarPercentual } from './arredondamento.js';

const TOLERANCIA_DIVERGENCIA_TOTAL = 0.05;

interface CalculoBrutoItem {
  receita: number;
  custoTotal: number;
  margemValor: number;
  margemVendaRazao: number | null;
  markupCustoRazao: number | null;
}

/** Cálculo bruto (sem arredondamento) das fórmulas da seção 12. */
function calcularBruto(
  item: ItemPedidoOmie,
  custoUnitario: number,
): CalculoBrutoItem {
  const produto = item.produto;
  const receita =
    produto.valor_mercadoria !== undefined && produto.valor_mercadoria !== null
      ? produto.valor_mercadoria
      : produto.quantidade * produto.valor_unitario - (produto.valor_desconto ?? 0);

  const custoTotal = custoUnitario * produto.quantidade;
  const margemValor = receita - custoTotal;

  const margemVendaRazao = receita === 0 ? null : margemValor / receita;
  const markupCustoRazao = custoTotal === 0 ? null : margemValor / custoTotal;

  return { receita, custoTotal, margemValor, margemVendaRazao, markupCustoRazao };
}

/** Calcula um item do pedido já com custo resolvido, retornando os valores prontos para saída (arredondados). */
export function calcularItem(
  item: ItemPedidoOmie,
  custoUnitario: number,
  origemCusto: string,
): ItemCalculado {
  const bruto = calcularBruto(item, custoUnitario);
  const produto = item.produto;

  const alertas: MotivoAlertaItem[] = [];
  if (origemCusto === 'indisponivel') {
    alertas.push('custo_indisponivel');
  } else if (origemCusto === 'sem custo') {
    alertas.push('sem_custo');
  } else if (origemCusto.startsWith('estimado')) {
    alertas.push('custo_estimado');
  }
  if (bruto.margemValor < 0) {
    alertas.push('margem_negativa');
  }

  return {
    codigoProduto: produto.codigo_produto,
    codigo: produto.codigo,
    descricao: produto.descricao,
    quantidade: produto.quantidade,
    valorUnitario: arredondarDinheiro(produto.valor_unitario),
    receita: arredondarDinheiro(bruto.receita),
    custoUnitario: arredondarCustoUnitario(custoUnitario),
    custoTotal: arredondarDinheiro(bruto.custoTotal),
    margemValor: arredondarDinheiro(bruto.margemValor),
    margemVendaPercentual: arredondarPercentual(bruto.margemVendaRazao),
    markupCustoPercentual: arredondarPercentual(bruto.markupCustoRazao),
    origemCusto,
    alertas,
  };
}

/**
 * Calcula os totais do pedido a partir dos valores BRUTOS (não arredondados)
 * de cada item, somando-os antes de qualquer arredondamento.
 *
 * IMPORTANTE (seção 16): a margem percentual total é sempre
 * margem_total / receita_total. NUNCA a média das margens percentuais dos
 * itens — essa abordagem ignora o peso financeiro de cada item e é
 * considerada um erro de implementação.
 */
export function calcularTotais(
  itensPedido: ItemPedidoOmie[],
  custosUnitarios: number[],
  origensCusto: string[],
): TotaisPedido {
  let receitaTotalBruta = 0;
  let custoTotalBruto = 0;
  let itensSemCusto = 0;

  itensPedido.forEach((item, indice) => {
    const custoUnitario = custosUnitarios[indice] ?? 0;
    const origemCusto = origensCusto[indice] ?? 'sem custo';
    const bruto = calcularBruto(item, custoUnitario);
    receitaTotalBruta += bruto.receita;
    custoTotalBruto += bruto.custoTotal;
    if (origemCusto === 'sem custo' || origemCusto === 'indisponivel') {
      itensSemCusto += 1;
    }
  });

  const margemTotalBruta = receitaTotalBruta - custoTotalBruto;
  const margemVendaTotalRazao = receitaTotalBruta === 0 ? null : margemTotalBruta / receitaTotalBruta;
  const markupCustoTotalRazao = custoTotalBruto === 0 ? null : margemTotalBruta / custoTotalBruto;

  return {
    receitaTotal: arredondarDinheiro(receitaTotalBruta),
    custoTotal: arredondarDinheiro(custoTotalBruto),
    margemTotal: arredondarDinheiro(margemTotalBruta),
    margemVendaTotal: arredondarPercentual(margemVendaTotalRazao),
    markupCustoTotal: arredondarPercentual(markupCustoTotalRazao),
    itensSemCusto,
  };
}

/**
 * Compara a receita calculada com o total informado pela Omie (seção 18).
 * Gera alerta se a diferença ultrapassar R$ 0,05, explicando que frete,
 * seguro e despesas acessórias podem compor o total do pedido sem entrar
 * na margem de custo dos produtos.
 */
export function compararComTotalOmie(
  receitaTotal: number,
  valorTotalPedidoOmie: number,
): AlertaDivergenciaTotal | null {
  const diferenca = arredondarDinheiro(receitaTotal - valorTotalPedidoOmie);
  if (Math.abs(diferenca) <= TOLERANCIA_DIVERGENCIA_TOTAL) return null;

  return {
    tipo: 'divergencia_total',
    receitaCalculada: receitaTotal,
    totalInformadoOmie: valorTotalPedidoOmie,
    diferenca,
    explicacao:
      'O total informado pela Omie pode incluir frete, seguro ou outras despesas acessórias ' +
      'que não entram automaticamente no cálculo de custo e margem dos produtos.',
  };
}

/** Monta o resumo operacional (seção 29) a partir dos itens já calculados e dos totais. */
export function montarResumoOperacional(
  itens: ItemCalculado[],
  totais: TotaisPedido,
): ResumoOperacional {
  if (itens.length === 0) {
    return {
      margemPorRealVendido: totais.margemVendaTotal,
      itemMelhorMargem: null,
      itemPiorMargem: null,
      itemMaiorContribuicaoMargem: null,
      itensSemCusto: totais.itensSemCusto,
    };
  }

  const itensComPercentual = itens.filter((item) => item.margemVendaPercentual !== null);

  let itemMelhorMargem: ResumoOperacional['itemMelhorMargem'] = null;
  let itemPiorMargem: ResumoOperacional['itemPiorMargem'] = null;
  if (itensComPercentual.length > 0) {
    const melhor = itensComPercentual.reduce((a, b) =>
      (b.margemVendaPercentual as number) > (a.margemVendaPercentual as number) ? b : a,
    );
    const pior = itensComPercentual.reduce((a, b) =>
      (b.margemVendaPercentual as number) < (a.margemVendaPercentual as number) ? b : a,
    );
    itemMelhorMargem = { descricao: melhor.descricao, margemVendaPercentual: melhor.margemVendaPercentual };
    itemPiorMargem = { descricao: pior.descricao, margemVendaPercentual: pior.margemVendaPercentual };
  }

  const itemMaiorMargemValor = itens.reduce((a, b) => (b.margemValor > a.margemValor ? b : a));
  const participacaoPercentual =
    totais.margemTotal === 0 ? null : arredondarPercentual(itemMaiorMargemValor.margemValor / totais.margemTotal);

  return {
    margemPorRealVendido: totais.margemVendaTotal,
    itemMelhorMargem,
    itemPiorMargem,
    itemMaiorContribuicaoMargem: {
      descricao: itemMaiorMargemValor.descricao,
      margemValor: itemMaiorMargemValor.margemValor,
      participacaoPercentual,
    },
    itensSemCusto: totais.itensSemCusto,
  };
}
