import type { EstoqueOmie, ResultadoCusto } from './tipos.js';

/**
 * Campos candidatos a custo unitário, em ordem de prioridade.
 * Editar esta lista para ajustar de onde o custo é extraído nas respostas
 * de estoque da Omie (seção 8 do briefing do projeto).
 */
export const CAMPOS_CUSTO_CANDIDATOS: readonly string[] = [
  'nCMC',
  'nCustoMedio',
  'nPrecoUnitario',
  'nCustoUnitario',
];

/** Converte um valor desconhecido em número positivo válido, ou null se não for utilizável. */
function paraNumeroPositivo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return numero;
}

function buscarCampoCandidato(
  fonte: Record<string, unknown>,
  prefixoOrigem: string,
): ResultadoCusto | null {
  for (const campo of CAMPOS_CUSTO_CANDIDATOS) {
    const numero = paraNumeroPositivo(fonte[campo]);
    if (numero !== null) {
      return { custoUnitario: numero, origemCusto: `${prefixoOrigem}.${campo}` };
    }
  }
  return null;
}

/**
 * Resolve o custo unitário de um produto a partir da resposta de estoque da Omie.
 *
 * Passo 1: percorre listaEstoque procurando o primeiro campo candidato válido.
 * Passo 2: se não encontrar, procura os mesmos campos no nível raiz da resposta.
 * Passo 3: se ainda não encontrar, retorna custo zero com origem "sem custo".
 */
export function resolverCusto(estoque: EstoqueOmie | null): ResultadoCusto {
  if (estoque === null) {
    return { custoUnitario: 0, origemCusto: 'indisponivel' };
  }

  const lista = Array.isArray(estoque.listaEstoque) ? estoque.listaEstoque : [];
  for (const registro of lista) {
    const encontrado = buscarCampoCandidato(registro, 'estoque');
    if (encontrado !== null) return encontrado;
  }

  const encontradoRaiz = buscarCampoCandidato(estoque, 'raiz');
  if (encontradoRaiz !== null) return encontradoRaiz;

  return { custoUnitario: 0, origemCusto: 'sem custo' };
}
