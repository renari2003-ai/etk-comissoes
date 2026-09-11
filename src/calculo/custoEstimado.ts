/**
 * Custo ESTIMADO a partir do preço de venda — decisão de negócio TEMPORÁRIA
 * (confirmada com o usuário em 2026-09-10): enquanto as notas de entrada de
 * estoque não estiverem completas/corretas na Omie, o Custo Médio Contábil
 * (`nCMC`, ver `custo.ts`/`resolverCusto`) não é confiável para vários
 * produtos. Até a regularização, o custo passa a ser estimado assim:
 *
 *   custo = preço unitário de venda ÷ 1,90
 *   custo = preço unitário de venda ÷ 1,75   (produtos da família "Linha Premium")
 *
 * REVERTER quando as notas de entrada estiverem corretas: voltar a usar
 * `resolverCusto` (custo.ts) + `obterEstoqueProduto` em
 * `montarRelatorio.ts` → `buscarCustoDoItem`, no lugar desta função.
 */

import type { ResultadoCusto } from './tipos.js';

export const DIVISOR_CUSTO_PADRAO = 1.9;
export const DIVISOR_CUSTO_PREMIUM = 1.75;

/** Trecho (normalizado, sem acento) que identifica a família premium pelo nome real cadastrado na Omie — nunca por código fixo, que pode mudar. */
const TRECHO_FAMILIA_PREMIUM = 'premium';

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Verificado contra a API real em 2026-09-10: a conta tem a família "Linha Premium" (código 2400097387). Comparação por texto, não por código — mais robusta a a família ser recriada. */
export function ehFamiliaPremium(descricaoFamilia: string | null | undefined): boolean {
  if (descricaoFamilia === null || descricaoFamilia === undefined) return false;
  return normalizar(descricaoFamilia).includes(TRECHO_FAMILIA_PREMIUM);
}

/**
 * Nunca divide por preço zero/inválido — cai em "sem custo" (mesmo
 * comportamento de fallback do `resolverCusto` real), nunca inventa um
 * número a partir de um preço que não existe.
 */
export function calcularCustoEstimado(valorUnitarioVenda: number, ehPremium: boolean): ResultadoCusto {
  if (!Number.isFinite(valorUnitarioVenda) || valorUnitarioVenda <= 0) {
    return { custoUnitario: 0, origemCusto: 'sem custo' };
  }
  const divisor = ehPremium ? DIVISOR_CUSTO_PREMIUM : DIVISOR_CUSTO_PADRAO;
  return {
    custoUnitario: valorUnitarioVenda / divisor,
    origemCusto: ehPremium ? 'estimado.premium' : 'estimado.padrao',
  };
}
