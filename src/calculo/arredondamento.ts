/**
 * Funções de arredondamento aplicadas exclusivamente na saída dos cálculos
 * (seção 17). Todos os cálculos intermediários usam números em ponto
 * flutuante sem arredondamento, para não acumular erro.
 *
 * Precisões definidas no briefing:
 *  - Dinheiro (receita, custo total, margem em R$): 2 casas.
 *  - Custo unitário: 4 casas, pois valores unitários muito baixos
 *    (ex.: componentes vendidos a centavos) perderiam precisão relevante
 *    se arredondados para 2 casas antes de multiplicar pela quantidade.
 *  - Percentuais (margem sobre venda, markup sobre custo): 2 casas.
 */

function arredondarCasas(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

export function arredondarDinheiro(valor: number): number {
  return arredondarCasas(valor, 2);
}

export function arredondarCustoUnitario(valor: number): number {
  return arredondarCasas(valor, 4);
}

/** Recebe uma razão (ex.: 0.5) e retorna o percentual arredondado (ex.: 50.00), ou null. */
export function arredondarPercentual(razao: number | null): number | null {
  if (razao === null) return null;
  return arredondarCasas(razao * 100, 2);
}
