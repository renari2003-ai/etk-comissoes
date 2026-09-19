/**
 * Cálculo do valor mínimo comercial do frete (Fase 4A.7) — módulo isolado de `calculo.ts`
 * (Fase 1, protegido/inalterado): NUNCA soma PIS/COFINS/ICMS diretamente ao custo ("por
 * fora"), porque esses tributos incidem sobre o próprio preço de venda (base de cálculo =
 * preço, não o custo) — somar direto SUBESTIMARIA o valor mínimo real. A fórmula "por
 * dentro" (gross-up) isola o preço V tal que, depois de descontados os impostos (V ×
 * alíquotaTotal), sobra exatamente o custo:
 *
 *   V − V × (pis + cofins + icms) = custo
 *   V × (1 − (pis + cofins + icms)) = custo
 *   V = custo / (1 − (pis + cofins + icms))
 *
 * As alíquotas NUNCA são hardcoded aqui — vêm de `parametrosFiscaisRepositorio.ts`
 * (configuração explícita, nunca um percentual inventado). Se alguma não estiver
 * configurada, o cálculo falha alto e claro em vez de assumir 0%.
 */

import { arredondarDinheiro } from '../calculo/arredondamento.js';
import { ErroValidacao } from '../validacao.js';

export interface ParametrosFiscaisFrete {
  pisPercentual: number | null;
  cofinsPercentual: number | null;
  icmsPercentual: number | null;
}

export function calcularValorMinimo(freteBase: number, parametros: ParametrosFiscaisFrete): number {
  const { pisPercentual, cofinsPercentual, icmsPercentual } = parametros;
  if (pisPercentual === null || cofinsPercentual === null || icmsPercentual === null) {
    throw new ErroValidacao(
      'Parâmetros fiscais (PIS/COFINS/ICMS) ainda não configurados — configure as alíquotas em "Parâmetros fiscais" antes de calcular o valor mínimo.',
    );
  }
  const aliquotaTotal = (pisPercentual + cofinsPercentual + icmsPercentual) / 100;
  if (aliquotaTotal < 0) {
    throw new ErroValidacao('As alíquotas fiscais configuradas não podem ser negativas.');
  }
  if (aliquotaTotal >= 1) {
    throw new ErroValidacao('A soma das alíquotas fiscais configuradas (PIS + COFINS + ICMS) não pode atingir 100%.');
  }
  return arredondarDinheiro(freteBase / (1 - aliquotaTotal));
}
