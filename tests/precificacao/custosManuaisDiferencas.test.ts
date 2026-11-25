import { describe, expect, it } from 'vitest';
import type { CustoManual } from '../../src/precificacao/custoManual.js';
import { diferencasCusto } from '../../src/precificacao/custosManuaisRepositorio.js';
import { numeroDoBanco } from '../../src/precificacao/parametrosFiscaisRepositorio.js';

// Função pura que decide o que vai para o histórico — roda na suíte normal (sem banco).
const custo = (sobrescrever: Partial<CustoManual> = {}): CustoManual => ({
  codigo: 'MP1',
  valorNota: 3.5,
  ufFornecedor: 'MG',
  diferimentoPta: true,
  mercadoriaImportada: false,
  tipoFornecedor: 'INDUSTRIA_NORMAL',
  ipiPercentual: null,
  ...sobrescrever,
});

describe('diferencasCusto (histórico campo a campo)', () => {
  it('inclusão: todos os campos preenchidos, sem os nulos', () => {
    expect(diferencasCusto(null, custo()).map((a) => a.campo)).toEqual(['valorNota', 'ufFornecedor', 'diferimentoPta', 'mercadoriaImportada', 'tipoFornecedor']);
  });

  it('alteração: só o que mudou, com antes e depois em texto; null com null não conta', () => {
    expect(diferencasCusto(custo(), custo({ valorNota: 4.25, ipiPercentual: 12 }))).toEqual([
      { campo: 'valorNota', valorAnterior: '3.5', valorNovo: '4.25' },
      { campo: 'ipiPercentual', valorAnterior: null, valorNovo: '12' },
    ]);
    expect(diferencasCusto(custo(), custo())).toEqual([]);
  });

  it('o numeric do banco ("3.500000") volta como 3.5: reler e salvar igual não gera alteração falsa', () => {
    const doBanco = custo({ valorNota: numeroDoBanco('3.500000', 'valor_nota'), ipiPercentual: numeroDoBanco('12.0000', 'ipi') });
    expect(diferencasCusto(doBanco, custo({ ipiPercentual: 12 }))).toEqual([]);
  });

  it('remoção: o que havia, com valor novo vazio', () => {
    expect(diferencasCusto(custo(), null)).toContainEqual({ campo: 'valorNota', valorAnterior: '3.5', valorNovo: null });
    expect(diferencasCusto(custo(), null).some((a) => a.campo === 'ipiPercentual')).toBe(false);
  });
});
