import { describe, expect, it } from 'vitest';
import {
  indexarPosicaoEstoque,
  MAX_PAGINAS_POSICAO_ESTOQUE,
  validarTotalPaginasPosicaoEstoque,
} from '../../src/omie/cliente.js';
import { OmieError } from '../../src/omie/erros.js';

/**
 * Regressão (2026-11-24): `CachePostgres` grava com `JSON.stringify`; a posição de estoque era
 * cacheada como `Map`, que vira `{}` — toda leitura vinda do cache quebrava com
 * "posicao.get is not a function". Agora o cache guarda a lista, e o índice é montado depois.
 */
describe('posição de estoque — formato do cache', () => {
  const registros = [
    { nCodProd: 10, nCMC: 0.192111 },
    { nCodProd: '20', nCMC: 17.06279 },
    { nCodProd: 'sem-codigo', nCMC: 1 },
  ];

  it('sobrevive à ida e volta em JSON (como o CachePostgres grava e lê)', () => {
    const doCache: unknown = JSON.parse(JSON.stringify(registros));
    const indice = indexarPosicaoEstoque(doCache);
    expect(indice.get(10)).toEqual({ nCodProd: 10, nCMC: 0.192111 });
    expect(indice.get(20)).toEqual({ nCodProd: '20', nCMC: 17.06279 });
    expect(indice.size).toBe(2);
  });

  it('conteúdo antigo/corrompido do cache ({}) não quebra: vira índice vazio', () => {
    expect(indexarPosicaoEstoque({}).size).toBe(0);
    expect(indexarPosicaoEstoque(null).size).toBe(0);
  });
});

describe('posição de estoque — teto de paginação', () => {
  it('aceita total de páginas válido', () => {
    expect(validarTotalPaginasPosicaoEstoque(0)).toBe(0);
    expect(validarTotalPaginasPosicaoEstoque(MAX_PAGINAS_POSICAO_ESTOQUE)).toBe(MAX_PAGINAS_POSICAO_ESTOQUE);
  });

  it('recusa total inválido ou acima do teto com erro explícito', () => {
    for (const invalido of [undefined, '3', -1, 2.5, Number.NaN]) {
      expect(() => validarTotalPaginasPosicaoEstoque(invalido)).toThrow(OmieError);
    }
    expect(() => validarTotalPaginasPosicaoEstoque(MAX_PAGINAS_POSICAO_ESTOQUE + 1)).toThrow(/acima do teto/);
  });
});
