import { describe, expect, it } from 'vitest';
import type { ItemNotaEntrada } from '../../src/omie/notasEntrada.js';
import { calcularCusto } from '../../src/precificacao/calculo.js';
import type { ComponenteOmie, DadosOmieProduto } from '../../src/precificacao/coletaOmie.js';
import type { CustoManual } from '../../src/precificacao/custoManual.js';
import { montarCusto } from '../../src/precificacao/montagemCusto.js';
import { PARAMETROS_GERAIS_INICIAIS, UFS_INICIAIS, type TabelaFiscal } from '../../src/precificacao/parametrosFiscais.js';

const TABELA: TabelaFiscal = {
  gerais: { ...PARAMETROS_GERAIS_INICIAIS },
  ufs: UFS_INICIAIS.map((u) => ({ ...u })),
  excecoesNcm: [],
  ipiNcm: [
    { ncm: '85447000', aliquota: 5 },
    { ncm: '73181500', aliquota: 12 },
  ],
};

function nota(sobrescrever: Partial<ItemNotaEntrada> = {}): ItemNotaEntrada {
  return { idProduto: 10, idRecebimento: 1, idFornecedor: 77, numeroNfe: '555', data: '2026-11-01', quantidade: 1, precoUnitario: 100, aliquotaIcms: 12, aliquotaIpi: 12, temIcmsSt: false, ...sobrescrever };
}

function dados(componentes: Record<string, Partial<ComponenteOmie>>, ncmProduto: string | null = '85447000'): DadosOmieProduto {
  const comps: Record<string, ComponenteOmie> = {};
  for (const [codigo, c] of Object.entries(componentes)) comps[codigo] = { codigo, idProduto: 1, descricao: null, ncm: null, custoMedio: null, ultimaNota: null, ...c };
  return {
    codigo: 'PA1',
    produto: { idProduto: 1, descricao: 'Produto', ncm: ncmProduto, conteudoImportado: false },
    arvore: [],
    folhas: Object.keys(comps).map((codigo) => ({ codigo, descricao: null, quantidadeNoProduto: 1, custoUnitario: comps[codigo]!.custoMedio, caminho: [], kitSemEstrutura: false })),
    componentes: comps,
    janelaNotas: { de: '2026-05-26', ate: '2026-11-26' },
    avisos: [],
  };
}

const manual = (codigo: string, sobrescrever: Partial<CustoManual> = {}): CustoManual => ({
  codigo,
  valorNota: 112,
  ufFornecedor: 'SP',
  diferimentoPta: false,
  mercadoriaImportada: false,
  tipoFornecedor: 'INDUSTRIA_NORMAL',
  ipiPercentual: 12,
  ...sobrescrever,
});

describe('montagem do custo (etapa 4): Omie + nota + custo manual + tabela NCM → IPI', () => {
  it('custo do Omie com nota: alíquotas da nota mais recente sobre o custo médio (exemplo da spec: SP 12%, IPI 12%)', () => {
    const r = montarCusto({ dados: dados({ MP1: { custoMedio: 112, ultimaNota: nota() } }), tabela: TABELA, manuaisSalvos: new Map() });
    const [item] = r.itens;
    expect(item).toMatchObject({ origem: 'OMIE', fonteCreditos: 'NOTA_ENTRADA', aliquotaIpi: 0.12, aliquotaIcms: 0.12, nota: { numeroNfe: '555', data: '2026-11-01' } });
    // vProd 100; IPI 12; ICMS 12; PIS/COFINS 9,25% × 88 = 8,14 → líquido 91,86.
    expect(item!.custoBrutoUnitario).toBeCloseTo(112, 10);
    expect(item!.custoLiquidoUnitario).toBeCloseTo(91.86, 10);
    expect(r.aliquotaIpiVenda).toBe(0.05);
    expect(r.avisos).toEqual([]);
  });

  it('custo manual: créditos pelos dados digitados, mesmo havendo nota do Omie', () => {
    const r = montarCusto({
      dados: dados({ MP1: { custoMedio: 50, ultimaNota: nota({ aliquotaIpi: 0 }) } }),
      tabela: TABELA,
      manuaisSalvos: new Map([['MP1', manual('MP1')]]),
    });
    expect(r.itens[0]).toMatchObject({ origem: 'MANUAL_SALVO', fonteCreditos: 'DADOS_MANUAIS', aliquotaIpi: 0.12, aliquotaIcms: 0.12, nota: null });
    expect(r.itens[0]!.custoLiquidoUnitario).toBeCloseTo(91.86, 10);
    expect(r.avisos.map((a) => a.codigo)).toEqual(['CUSTO_MANUAL_DIFERENTE_OMIE']);
  });

  it('estimado (sem nota) com dados fiscais guardados (valor vazio): usa a tabela NCM → IPI do NCM do componente', () => {
    const r = montarCusto({
      dados: dados({ MP1: { custoMedio: 112, ncm: '73181500' } }),
      tabela: TABELA,
      manuaisSalvos: new Map([['MP1', manual('MP1', { valorNota: null, ipiPercentual: null })]]),
    });
    expect(r.itens[0]).toMatchObject({ origem: 'OMIE', fonteCreditos: 'DADOS_MANUAIS', aliquotaIpi: 0.12 });
    expect(r.itens[0]!.custoLiquidoUnitario).toBeCloseTo(91.86, 10);
  });

  it('estimado com NCM fora da tabela NCM → IPI: sem crédito, tarja amarela ITEM_SEM_NCM_IPI no calcularCusto', () => {
    const r = montarCusto({
      dados: dados({ MP1: { custoMedio: 112, ncm: '99999999' } }),
      tabela: TABELA,
      manuaisSalvos: new Map([['MP1', manual('MP1', { valorNota: null, ipiPercentual: null })]]),
    });
    expect(r.itens[0]).toMatchObject({ custoBrutoUnitario: 112, custoLiquidoUnitario: null, aliquotaIpi: null });
    expect(calcularCusto(r.itens).avisos.map((a) => a.codigo)).toEqual(['ITEM_SEM_NCM_IPI']);
  });

  it('estimado sem dados fiscais: pelo bruto, sem crédito, tarja amarela ITEM_SEM_DADOS_FISCAIS (uma por código)', () => {
    const d = dados({ MP1: { custoMedio: 10 } });
    d.folhas.push({ ...d.folhas[0]! });
    const r = montarCusto({ dados: d, tabela: TABELA, manuaisSalvos: new Map() });
    expect(r.itens.map((i) => [i.fonteCreditos, i.custoBrutoUnitario, i.custoLiquidoUnitario])).toEqual([
      ['SEM_DADOS_FISCAIS', 10, 10],
      ['SEM_DADOS_FISCAIS', 10, 10],
    ]);
    expect(r.avisos.filter((a) => a.codigo === 'ITEM_SEM_DADOS_FISCAIS')).toEqual([
      expect.objectContaining({ nivel: 'AMARELO', item: 'MP1', mensagem: expect.stringContaining('custo manual do item MP1') }),
    ]);
  });

  it('sem custo (Omie 0/vazio, sem manual): entra sem custo, e calcularCusto dá ITEM_SEM_CUSTO', () => {
    const r = montarCusto({ dados: dados({ MP1: { custoMedio: null } }), tabela: TABELA, manuaisSalvos: new Map() });
    expect(r.itens[0]).toMatchObject({ origem: 'SEM_CUSTO', fonteCreditos: 'SEM_CUSTO', custoBrutoUnitario: null });
    expect(calcularCusto(r.itens).avisos.map((a) => a.codigo)).toEqual(['ITEM_SEM_CUSTO']);
  });

  it('IPI da venda: produto sem NCM ou com NCM fora da tabela → tarja VERMELHA IPI_VENDA_NCM_NAO_CONFIGURADO', () => {
    const semNcm = montarCusto({ dados: dados({ MP1: { custoMedio: 1, ultimaNota: nota() } }, null), tabela: TABELA, manuaisSalvos: new Map() });
    expect(semNcm.aliquotaIpiVenda).toBeNull();
    expect(semNcm.avisos).toEqual([expect.objectContaining({ nivel: 'VERMELHO', codigo: 'IPI_VENDA_NCM_NAO_CONFIGURADO', mensagem: expect.stringContaining('não tem NCM') })]);
    const fora = montarCusto({ dados: dados({ MP1: { custoMedio: 1, ultimaNota: nota() } }, '11111111'), tabela: TABELA, manuaisSalvos: new Map() });
    expect(fora.avisos[0]).toMatchObject({ codigo: 'IPI_VENDA_NCM_NAO_CONFIGURADO', item: '11111111', mensagem: expect.stringContaining('preencher o NCM 11111111') });
  });
});
