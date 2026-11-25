import { describe, expect, it } from 'vitest';
import { abrirEstrutura, MAX_NIVEIS_ESTRUTURA, somarFolhas, type NoEstrutura } from '../../src/precificacao/estrutura.js';
import { ErroValidacao } from '../../src/validacao.js';

const folha = (codigo: string, quantidade: number, custoUnitario: number | null, perda = 0): NoEstrutura => ({ codigo, quantidade, perda, custoUnitario });

describe('abrirEstrutura — custo pelas folhas, sem duplicidade', () => {
  it('kit aberto NÃO entra com o próprio custo: só os itens de dentro somam', () => {
    const kit: NoEstrutura = { codigo: 'PI1', quantidade: 2, perda: 0, custoUnitario: 999, filhos: [folha('MP1', 3, 10), folha('MO1', 1, 5)] };
    const r = somarFolhas(abrirEstrutura([kit, folha('MP2', 1, 7)]));
    // 2 × (3 × 10 + 1 × 5) + 7 = 77 — nunca 77 + 2 × 999.
    expect(r.total).toBeCloseTo(77, 10);
    expect(r.folhas.map((f) => f.codigo)).toEqual(['MP1', 'MO1', 'MP2']);
    expect(r.folhas.some((f) => f.codigo === 'PI1')).toBe(false);
  });

  it('abre todos os níveis (4 níveis) e multiplica as quantidades do caminho', () => {
    const arvore: NoEstrutura[] = [
      {
        codigo: 'K1',
        quantidade: 2,
        perda: 0,
        custoUnitario: 50,
        filhos: [{ codigo: 'K2', quantidade: 3, perda: 0, custoUnitario: 40, filhos: [{ codigo: 'K3', quantidade: 0.5, perda: 0, custoUnitario: 1, filhos: [folha('MP9', 4, 1.5)] }] }],
      },
    ];
    const [f] = abrirEstrutura(arvore);
    expect(f!.quantidadeNoProduto).toBeCloseTo(2 * 3 * 0.5 * 4, 10);
    expect(f!.caminho).toEqual(['K1', 'K2', 'K3']);
    expect(somarFolhas([f!]).total).toBeCloseTo(12 * 1.5, 10);
  });

  it('perda: quantidade × (1 + perda) em cada nível do caminho', () => {
    const kit: NoEstrutura = { codigo: 'PI1', quantidade: 2, perda: 0.1, custoUnitario: 0, filhos: [folha('MP1', 3, 10, 0.05)] };
    const [f] = abrirEstrutura([kit]);
    expect(f!.quantidadeNoProduto).toBeCloseTo(2 * 1.1 * 3 * 1.05, 10);
  });

  it('kit SEM estrutura entra com o custo médio do próprio kit (e é marcado)', () => {
    const kitVazio: NoEstrutura = { codigo: 'PI7', quantidade: 2, perda: 0, custoUnitario: 12, filhos: [] };
    const r = somarFolhas(abrirEstrutura([kitVazio, folha('MP1', 1, 3)], { ehKit: (n) => n.codigo.startsWith('PI') }));
    expect(r.total).toBeCloseTo(2 * 12 + 3, 10);
    expect(r.folhas[0]).toMatchObject({ codigo: 'PI7', kitSemEstrutura: true });
    expect(r.folhas[1]).toMatchObject({ codigo: 'MP1', kitSemEstrutura: false });
  });

  it('folha sem custo entra com zero e é listada uma vez', () => {
    const r = somarFolhas(abrirEstrutura([folha('MO37', 1, null), folha('MP1', 2, 5), { codigo: 'K', quantidade: 1, perda: 0, custoUnitario: 1, filhos: [folha('MO37', 3, null)] }]));
    expect(r.total).toBeCloseTo(10, 10);
    expect(r.semCusto).toEqual(['MO37']);
  });

  it('custo 0 (custo médio zerado no Omie) é "sem custo", nunca um custo válido', () => {
    const r = somarFolhas(abrirEstrutura([folha('MP45', 1, 0), folha('MP1', 2, 5)]));
    expect(r.total).toBeCloseTo(10, 10);
    expect(r.semCusto).toEqual(['MP45']);
  });

  it('o mesmo item em dois kits diferentes conta nos dois (usos diferentes, não duplicidade)', () => {
    const r = somarFolhas(
      abrirEstrutura([
        { codigo: 'K1', quantidade: 1, perda: 0, custoUnitario: 100, filhos: [folha('MP1', 2, 10)] },
        { codigo: 'K2', quantidade: 1, perda: 0, custoUnitario: 100, filhos: [folha('MP1', 1, 10)] },
      ]),
    );
    expect(r.total).toBeCloseTo(30, 10);
  });

  it('ciclo, profundidade demais, quantidade negativa, perda ≥ 100% ou código vazio → erro explícito', () => {
    const ciclo: NoEstrutura = { codigo: 'K1', quantidade: 1, perda: 0, custoUnitario: 0, filhos: [{ codigo: 'k1', quantidade: 1, perda: 0, custoUnitario: 0, filhos: [folha('X', 1, 1)] }] };
    expect(() => abrirEstrutura([ciclo])).toThrow(ErroValidacao);
    // Item que contém o próprio produto (ciclo de volta à raiz).
    const voltaARaiz: NoEstrutura = { codigo: 'K1', quantidade: 1, perda: 0, custoUnitario: 0, filhos: [folha('pa1', 1, 5)] };
    expect(() => abrirEstrutura([voltaARaiz], { codigoRaiz: 'PA1' })).toThrow(/produto pa1 aparece dentro da própria estrutura/);
    expect(abrirEstrutura([voltaARaiz])).toHaveLength(1);

    let fundo: NoEstrutura = folha('F', 1, 1);
    for (let i = 0; i < MAX_NIVEIS_ESTRUTURA; i++) fundo = { codigo: `K${i}`, quantidade: 1, perda: 0, custoUnitario: 0, filhos: [fundo] };
    expect(() => abrirEstrutura([fundo])).toThrow(/níveis/);

    expect(() => abrirEstrutura([folha('X', -1, 1)])).toThrow(ErroValidacao);
    expect(() => abrirEstrutura([folha('X', 1, 1, 1)])).toThrow(ErroValidacao);
    expect(() => abrirEstrutura([folha(' ', 1, 1)])).toThrow(ErroValidacao);
    expect(() => abrirEstrutura([folha('X', 1, -2)])).toThrow(ErroValidacao);
  });
});
