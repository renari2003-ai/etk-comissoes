import { describe, expect, it } from 'vitest';
import { resolverCusto } from '../../src/calculo/custo.js';

describe('resolverCusto', () => {
  it('usa o primeiro campo candidato válido em listaEstoque', () => {
    const resultado = resolverCusto({
      listaEstoque: [{ nCMC: 0, nCustoMedio: 12.5, outro: 'x' }],
    });
    expect(resultado).toEqual({ custoUnitario: 12.5, origemCusto: 'estoque.nCustoMedio' });
  });

  it('ignora valores zero ou negativos e segue para o próximo campo candidato', () => {
    const resultado = resolverCusto({
      listaEstoque: [{ nCMC: -5, nCustoMedio: 0, nPrecoUnitario: 7.25 }],
    });
    expect(resultado).toEqual({ custoUnitario: 7.25, origemCusto: 'estoque.nPrecoUnitario' });
  });

  it('cai para o nível raiz quando listaEstoque não tem valor utilizável', () => {
    const resultado = resolverCusto({
      listaEstoque: [{ nCMC: 0 }],
      nCustoUnitario: 3.4,
    });
    expect(resultado).toEqual({ custoUnitario: 3.4, origemCusto: 'raiz.nCustoUnitario' });
  });

  it('retorna custo zero e origem "sem custo" quando nada é encontrado', () => {
    const resultado = resolverCusto({ listaEstoque: [] });
    expect(resultado).toEqual({ custoUnitario: 0, origemCusto: 'sem custo' });
  });

  it('retorna origem "indisponivel" quando não há resposta de estoque', () => {
    const resultado = resolverCusto(null);
    expect(resultado).toEqual({ custoUnitario: 0, origemCusto: 'indisponivel' });
  });

  it('converte strings numéricas corretamente', () => {
    const resultado = resolverCusto({ listaEstoque: [{ nCMC: '15.75' }] });
    expect(resultado).toEqual({ custoUnitario: 15.75, origemCusto: 'estoque.nCMC' });
  });
});
