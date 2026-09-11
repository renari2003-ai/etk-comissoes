/**
 * Margem de comissionamento — REGRA DE NEGÓCIO CRÍTICA, confirmada
 * explicitamente com o usuário em 2026-09-05:
 *
 *   O CUSTO DO PRODUTO NUNCA É ABATIDO NESTE CÁLCULO.
 *
 * Fórmula oficial (revisada em 2026-09-08 — ver `TotalPedidoOmie`):
 *   despesas = IPI + ICMS-ST + frete + seguro + outras despesas
 *   resultado_apos_despesas = valor_da_venda - despesas
 *   margem_comissionamento % = resultado_apos_despesas / valor_da_venda × 100
 *
 * Esta é uma métrica DIFERENTE da margem de custo/venda já existente no
 * sistema (`margemVendaTotal`, calculada como (receita − custo) ÷ receita),
 * que continua disponível para análise comercial/precificação mas NUNCA é
 * usada para determinar a faixa de comissão.
 *
 * Mapeamento de campos Omie → significado → uso (reconciliação exata
 * confirmada contra 8 pedidos reais em 2026-09-08 — ver `TotalPedidoOmie`):
 *   - "valor da venda"        = `total_pedido.valor_total_pedido` (bruto,
 *                               valor total da nota).
 *   - "valor dos produtos"    = soma de `valor_mercadoria` dos itens — é a
 *                               BASE DA COMISSÃO (não mais o valor da venda,
 *                               decisão de negócio de 2026-09-08).
 *   - "despesas de imposto"   = `total_pedido.valor_IPI` (IPI) +
 *                               `total_pedido.valor_st` (ICMS-ST /
 *                               Substituição Tributária) — os ÚNICOS dois
 *                               impostos somados "por fora" do valor dos
 *                               produtos na nota fiscal brasileira.
 *   - "impostos embutidos"    = ICMS "normal" (`valor_icms`), PIS
 *                               (`valor_pis`), COFINS (`valor_cofins`), IBS
 *                               (`valor_ibs`) e CBS (`valor_cbs`) — já estão
 *                               DENTRO do valor dos produtos (não somam ao
 *                               total da nota). Nunca subtraídos de novo:
 *                               entram no relatório só como informação,
 *                               para transparência sobre a composição do
 *                               preço, nunca como despesa.
 *   - "frete/seguro/outras
 *      despesas da venda"     = `frete.valor_frete` / `frete.valor_seguro` /
 *                               `frete.outras_despesas`.
 */

export interface ImpostosEmbutidos {
  icms: number;
  pis: number;
  cofins: number;
  ibs: number;
  cbs: number;
}

export interface DadosParaMargemComissionamento {
  /** total_pedido.valor_total_pedido — valor bruto da venda (denominador da margem %). */
  valorVenda: number;
  /** Soma do valor de mercadoria dos itens — valor dos produtos, usado apenas para exibição/conferência (a base da comissão é aplicada fora desta função). */
  valorMercadorias: number;
  /** total_pedido.valor_IPI — imposto somado "por fora" do valor dos produtos. */
  valorIPI: number;
  /** total_pedido.valor_st — ICMS-ST (Substituição Tributária), também somado "por fora". */
  valorIcmsSt: number;
  valorFrete: number;
  valorSeguro: number;
  outrasDespesas: number;
  /** Impostos já embutidos no valor dos produtos — apenas informativo, nunca subtraído. */
  impostosEmbutidos: ImpostosEmbutidos;
}

export interface ResultadoMargemComissionamento {
  valorVenda: number;
  valorMercadorias: number;
  despesasIPI: number;
  despesasIcmsSt: number;
  despesasFreteSeguroOutras: number;
  despesasTotal: number;
  resultadoAposDespesas: number;
  /** null quando `valorVenda` é 0 — nunca Infinity/NaN. */
  margemComissionamentoPercentual: number | null;
  /** Apenas informativo (ver comentário do módulo) — nunca somado a `despesasTotal`. */
  impostosEmbutidos: ImpostosEmbutidos;
}

export function calcularMargemComissionamento(
  dados: DadosParaMargemComissionamento,
): ResultadoMargemComissionamento {
  const despesasIPI = dados.valorIPI;
  const despesasIcmsSt = dados.valorIcmsSt;
  const despesasFreteSeguroOutras = dados.valorFrete + dados.valorSeguro + dados.outrasDespesas;
  const despesasTotal = despesasIPI + despesasIcmsSt + despesasFreteSeguroOutras;
  const resultadoAposDespesas = dados.valorVenda - despesasTotal;
  const margemComissionamentoPercentual =
    dados.valorVenda === 0 || !Number.isFinite(dados.valorVenda)
      ? null
      : (resultadoAposDespesas / dados.valorVenda) * 100;

  return {
    valorVenda: dados.valorVenda,
    valorMercadorias: dados.valorMercadorias,
    despesasIPI,
    despesasIcmsSt,
    despesasFreteSeguroOutras,
    despesasTotal,
    resultadoAposDespesas,
    margemComissionamentoPercentual,
    impostosEmbutidos: dados.impostosEmbutidos,
  };
}
