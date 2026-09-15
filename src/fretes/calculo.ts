/**
 * Cálculo puro de custo × acréscimo × valor final do frete (seção 7 do requisito da
 * Fase 1) — sem I/O, facilmente testável. Nunca decide o percentual sozinho: ele
 * sempre vem de uma decisão manual do usuário (seção 8 — proibido markup automático
 * por cliente/vendedor/transportadora/valor/margem/comissão).
 */

import { arredondarDinheiro, arredondarPercentual } from '../calculo/arredondamento.js';

/** valor_acrescimo = custo_frete × percentual_acrescimo / 100 */
export function calcularValorAcrescimo(custoFrete: number, percentualAcrescimo: number): number {
  return arredondarDinheiro(custoFrete * (percentualAcrescimo / 100));
}

/** valor_frete_cliente = custo_frete + valor_acrescimo. Percentual 0 devolve exatamente o custo (seção 10). */
export function calcularFreteFinal(custoFrete: number, percentualAcrescimo: number): number {
  return arredondarDinheiro(custoFrete + calcularValorAcrescimo(custoFrete, percentualAcrescimo));
}

/**
 * Cálculo reverso (seção 9): o usuário informa o valor final desejado e o sistema
 * mostra o percentual implícito, só para conferência — nunca altera o custo original
 * da transportadora. `null` quando `custoFrete` é 0 (percentual indefinido).
 */
export function calcularPercentualAcrescimo(custoFrete: number, valorFreteCliente: number): number | null {
  if (custoFrete === 0) return null;
  return arredondarPercentual(valorFreteCliente / custoFrete - 1);
}
