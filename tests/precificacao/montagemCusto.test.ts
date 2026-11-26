import { describe, expect, it } from 'vitest';
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

function dados(componentes: Record<string, Partial<ComponenteOmie>>, ncmProduto: string | null = '85447000'): DadosOmieProduto {
  const comps: Record<string, ComponenteOmie> = {};
  for (const [codigo, c] of Object.entries(componentes)) comps[codigo] = { codigo, idProduto: 1, descricao: null, ncm: null, custoMedio: null, ...c };
  return {
    codigo: 'PA1',
    produto: { idProduto: 1, descricao: 'Produto', ncm: ncmProduto, conteudoImportado: false },
    arvore: [],
    folhas: Object.keys(comps).map((codigo) => ({ codigo, descricao: null, quantidadeNoProduto: 1, custoUnitario: comps[codigo]!.custoMedio, caminho: [], kitSemEstrutura: false })),
    componentes: comps,
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

describe('montagem do custo (etapa 4): Omie + custo manual + tabela NCM → IPI', () => {
  it('custo do Omie (nCMC): já líquido — entra como está, SEM crédito nenhum (decisão de 26/11/2026)', () => {
    const r = montarCusto({ dados: dados({ MP1: { custoMedio: 91.86, ncm: '73181500' } }), tabela: TABELA, manuaisSalvos: new Map() });
    expect(r.itens[0]).toMatchObject({ origem: 'OMIE', fonteCreditos: 'OMIE_LIQUIDO', custoBrutoUnitario: 91.86, custoLiquidoUnitario: 91.86, aliquotaIpi: null, aliquotaIcms: null });
    expect(r.aliquotaIpiVenda).toBe(0.05);
    expect(r.avisos).toEqual([]);
    // Sem tarja de IPI/dados fiscais: o nCMC não depende de NCM nem de nota.
    expect(calcularCusto(r.itens).avisos).toEqual([]);
  });

  it('custo do Omie com NCM fora da tabela e sem custo manual: continua sem crédito e sem tarja', () => {
    const r = montarCusto({ dados: dados({ MP1: { custoMedio: 10, ncm: '99999999' } }), tabela: TABELA, manuaisSalvos: new Map() });
    expect(r.itens[0]).toMatchObject({ fonteCreditos: 'OMIE_LIQUIDO', custoLiquidoUnitario: 10 });
    expect(calcularCusto(r.itens).avisos).toEqual([]);
  });

  it('custo manual (valor da nota, com impostos): tira IPI e PIS/COFINS pelos dados digitados (exemplo da spec: SP 12%, IPI 12%)', () => {
    const r = montarCusto({
      dados: dados({ MP1: { custoMedio: null } }),
      tabela: TABELA,
      manuaisSalvos: new Map([['MP1', manual('MP1')]]),
    });
    expect(r.itens[0]).toMatchObject({ origem: 'MANUAL_SALVO', fonteCreditos: 'DADOS_MANUAIS', aliquotaIpi: 0.12, aliquotaIcms: 0.12 });
    // vProd 100; IPI 12; ICMS 12; PIS/COFINS 9,25% × 88 = 8,14 → líquido 91,86.
    expect(r.itens[0]!.custoBrutoUnitario).toBeCloseTo(112, 10);
    expect(r.itens[0]!.custoLiquidoUnitario).toBeCloseTo(91.86, 10);
    expect(r.avisos).toEqual([]);
  });

  it('manual diferente do Omie: vale o manual (com créditos) até escolher; escolhendo Omie, vale o nCMC sem crédito', () => {
    const entrada = { dados: dados({ MP1: { custoMedio: 50 } }), tabela: TABELA, manuaisSalvos: new Map([['MP1', manual('MP1')]]) };
    const r = montarCusto(entrada);
    expect(r.itens[0]).toMatchObject({ origem: 'MANUAL_SALVO', fonteCreditos: 'DADOS_MANUAIS' });
    expect(r.itens[0]!.custoLiquidoUnitario).toBeCloseTo(91.86, 10);
    expect(r.avisos.map((a) => a.codigo)).toEqual(['CUSTO_MANUAL_DIFERENTE_OMIE']);
    const omie = montarCusto({ ...entrada, escolhas: { MP1: 'OMIE' } });
    expect(omie.itens[0]).toMatchObject({ origem: 'OMIE', fonteCreditos: 'OMIE_LIQUIDO', custoBrutoUnitario: 50, custoLiquidoUnitario: 50 });
  });

  it('custo manual de indústria normal sem IPI e NCM fora da tabela: sem crédito, tarja amarela ITEM_SEM_NCM_IPI no calcularCusto', () => {
    const r = montarCusto({
      dados: dados({ MP1: { custoMedio: null, ncm: '99999999' } }),
      tabela: TABELA,
      manuaisSalvos: new Map([['MP1', manual('MP1', { ipiPercentual: null })]]),
    });
    expect(r.itens[0]).toMatchObject({ custoBrutoUnitario: 112, custoLiquidoUnitario: null, aliquotaIpi: null });
    expect(calcularCusto(r.itens).avisos.map((a) => a.codigo)).toEqual(['ITEM_SEM_NCM_IPI']);
  });

  it('custo manual de indústria normal sem IPI informado: usa a tabela NCM → IPI do NCM do componente', () => {
    const r = montarCusto({
      dados: dados({ MP1: { custoMedio: null, ncm: '73181500' } }),
      tabela: TABELA,
      manuaisSalvos: new Map([['MP1', manual('MP1', { ipiPercentual: null })]]),
    });
    expect(r.itens[0]).toMatchObject({ fonteCreditos: 'DADOS_MANUAIS', aliquotaIpi: 0.12 });
    expect(r.itens[0]!.custoLiquidoUnitario).toBeCloseTo(91.86, 10);
  });

  it('registro antigo sem valor não vira "estimado": com custo no Omie vale o nCMC, sem crédito', () => {
    const r = montarCusto({
      dados: dados({ MP1: { custoMedio: 20, ncm: '73181500' } }),
      tabela: TABELA,
      manuaisSalvos: new Map([['MP1', manual('MP1', { valorNota: null })]]),
    });
    expect(r.itens[0]).toMatchObject({ origem: 'OMIE', fonteCreditos: 'OMIE_LIQUIDO', custoLiquidoUnitario: 20 });
  });

  it('nenhum item do Omie gera ITEM_SEM_DADOS_FISCAIS (a tarja vale só para custo manual sem UF/tipo)', () => {
    const d = dados({ MP1: { custoMedio: 10 } });
    d.folhas.push({ ...d.folhas[0]! });
    const r = montarCusto({ dados: d, tabela: TABELA, manuaisSalvos: new Map() });
    expect(r.itens.map((i) => i.fonteCreditos)).toEqual(['OMIE_LIQUIDO', 'OMIE_LIQUIDO']);
    expect(r.avisos.some((a) => a.codigo === 'ITEM_SEM_DADOS_FISCAIS')).toBe(false);
  });

  it('sem custo (Omie 0/vazio, sem manual): entra sem custo, e calcularCusto dá ITEM_SEM_CUSTO', () => {
    const r = montarCusto({ dados: dados({ MP1: { custoMedio: null } }), tabela: TABELA, manuaisSalvos: new Map() });
    expect(r.itens[0]).toMatchObject({ origem: 'SEM_CUSTO', fonteCreditos: 'SEM_CUSTO', custoBrutoUnitario: null });
    expect(calcularCusto(r.itens).avisos.map((a) => a.codigo)).toEqual(['ITEM_SEM_CUSTO']);
  });

  it('IPI da venda: produto sem NCM ou com NCM fora da tabela → tarja VERMELHA IPI_VENDA_NCM_NAO_CONFIGURADO', () => {
    const semNcm = montarCusto({ dados: dados({ MP1: { custoMedio: 1 } }, null), tabela: TABELA, manuaisSalvos: new Map() });
    expect(semNcm.aliquotaIpiVenda).toBeNull();
    expect(semNcm.avisos).toEqual([expect.objectContaining({ nivel: 'VERMELHO', codigo: 'IPI_VENDA_NCM_NAO_CONFIGURADO', mensagem: expect.stringContaining('não tem NCM') })]);
    const fora = montarCusto({ dados: dados({ MP1: { custoMedio: 1 } }, '11111111'), tabela: TABELA, manuaisSalvos: new Map() });
    expect(fora.avisos[0]).toMatchObject({ codigo: 'IPI_VENDA_NCM_NAO_CONFIGURADO', item: '11111111', mensagem: expect.stringContaining('preencher o NCM 11111111') });
  });
});
