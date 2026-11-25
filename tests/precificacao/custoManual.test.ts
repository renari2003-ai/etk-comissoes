import { describe, expect, it } from 'vitest';
import { calcularCusto } from '../../src/precificacao/calculo.js';
import {
  custoDaCompraSemNota,
  resolverCustoItem,
  validarCodigoComponente,
  validarGravacaoCustoManual,
  validarRemocaoCustoManual,
  type CustoManual,
} from '../../src/precificacao/custoManual.js';
import { ErroValidacao } from '../../src/validacao.js';

const PARAMETROS = { icmsInternoMgCompra: 0.18, icmsInterestadualCompra: 0.12, icmsImportadoCompra: 0.04 };
const PIS_COFINS = 0.0925;

const corpo = (sobrescrever: Record<string, unknown> = {}): Record<string, unknown> => ({
  versao: null,
  valorNota: 112,
  ufFornecedor: 'MG',
  diferimentoPta: true,
  mercadoriaImportada: false,
  tipoFornecedor: 'INDUSTRIA_NORMAL',
  ipiPercentual: 12,
  ...sobrescrever,
});

const manual = (sobrescrever: Partial<CustoManual> = {}): CustoManual => ({
  codigo: 'MP00000045',
  valorNota: 112,
  ufFornecedor: 'MG',
  diferimentoPta: true,
  mercadoriaImportada: false,
  tipoFornecedor: 'INDUSTRIA_NORMAL',
  ipiPercentual: 12,
  ...sobrescrever,
});

describe('validação estrita do custo manual (PUT)', () => {
  it('aceita o formulário completo e normaliza o código para maiúsculas', () => {
    const { versao, custo } = validarGravacaoCustoManual(' mp00000045 ', corpo());
    expect(versao).toBeNull();
    expect(custo).toEqual(manual());
  });

  it('valor da nota vazio (null) = só dados fiscais de item estimado', () => {
    expect(validarGravacaoCustoManual('MP1', corpo({ valorNota: null })).custo.valorNota).toBeNull();
  });

  it('recusa valor ≤ 0, texto, mais de 6 casas e acima do teto', () => {
    for (const valorNota of [0, -1, '112', 1.1234567, 10_000_001, Number.NaN]) {
      expect(() => validarGravacaoCustoManual('MP1', corpo({ valorNota }))).toThrow(ErroValidacao);
    }
  });

  it('PTA só em MG; importada só fora de MG (combinação incoerente é recusada, nunca ignorada)', () => {
    expect(() => validarGravacaoCustoManual('MP1', corpo({ ufFornecedor: 'SP', diferimentoPta: true }))).toThrow(/"Fornecedor de MG com PTA" só se aplica a fornecedor de MG/);
    expect(() => validarGravacaoCustoManual('MP1', corpo({ ufFornecedor: 'MG', diferimentoPta: false, mercadoriaImportada: true }))).toThrow(/fora de MG/);
    expect(validarGravacaoCustoManual('MP1', corpo({ ufFornecedor: 'SP', diferimentoPta: false, mercadoriaImportada: true })).custo.mercadoriaImportada).toBe(true);
  });

  it('Simples Nacional: IPI sempre 0 (vazio vira 0; diferente de 0 é recusado)', () => {
    expect(validarGravacaoCustoManual('MP1', corpo({ tipoFornecedor: 'SIMPLES_NACIONAL', ipiPercentual: null })).custo.ipiPercentual).toBe(0);
    expect(() => validarGravacaoCustoManual('MP1', corpo({ tipoFornecedor: 'SIMPLES_NACIONAL', ipiPercentual: 5 }))).toThrow(/Simples Nacional/);
  });

  it('recusa campo desconhecido, campo faltando, booleano em texto, UF e tipo inválidos, IPI fora da faixa', () => {
    expect(() => validarGravacaoCustoManual('MP1', corpo({ extra: 1 }))).toThrow(/desconhecido/);
    const semUf = corpo();
    delete semUf.ufFornecedor;
    expect(() => validarGravacaoCustoManual('MP1', semUf)).toThrow(/faltam/);
    expect(() => validarGravacaoCustoManual('MP1', corpo({ diferimentoPta: 'false' }))).toThrow(ErroValidacao);
    expect(() => validarGravacaoCustoManual('MP1', corpo({ ufFornecedor: 'XX' }))).toThrow(ErroValidacao);
    expect(() => validarGravacaoCustoManual('MP1', corpo({ tipoFornecedor: 'DISTRIBUIDOR' }))).toThrow(/Tipo de fornecedor/);
    expect(() => validarGravacaoCustoManual('MP1', corpo({ ipiPercentual: 100 }))).toThrow(ErroValidacao);
    expect(() => validarGravacaoCustoManual('MP1', corpo({ ipiPercentual: 1.23456 }))).toThrow(/4 casas/);
    expect(() => validarGravacaoCustoManual('MP1', corpo({ versao: 0 }))).toThrow(/Versão/);
    expect(() => validarGravacaoCustoManual('MP1', [])).toThrow(ErroValidacao);
  });

  it('código malformado e remoção sem versão são recusados', () => {
    expect(() => validarCodigoComponente('MP1; DROP')).toThrow(ErroValidacao);
    expect(() => validarCodigoComponente('')).toThrow(ErroValidacao);
    expect(() => validarRemocaoCustoManual({})).toThrow(ErroValidacao);
    expect(() => validarRemocaoCustoManual({ versao: null })).toThrow(/obrigatória/);
    expect(validarRemocaoCustoManual({ versao: 3 })).toBe(3);
  });
});

describe('custo da compra sem nota (custo manual ou item estimado) — exemplos da spec', () => {
  it('V = 112, IPI 12%, MG com PTA → custo líquido 90,75', () => {
    const c = custoDaCompraSemNota(112, manual(), null, PARAMETROS, PIS_COFINS);
    expect(c.custoBrutoUnitario).toBeCloseTo(112, 10);
    expect(c.custoLiquidoUnitario).toBeCloseTo(90.75, 10);
    expect(c.creditoIpi).toBeCloseTo(12, 10);
    expect(c.creditoPisCofins).toBeCloseTo(9.25, 10);
  });

  it('MG sem PTA (18%) → 92,415; SP 12% → 91,86', () => {
    expect(custoDaCompraSemNota(112, manual({ diferimentoPta: false }), null, PARAMETROS, PIS_COFINS).custoLiquidoUnitario).toBeCloseTo(92.415, 10);
    expect(custoDaCompraSemNota(112, manual({ ufFornecedor: 'SP', diferimentoPta: false }), null, PARAMETROS, PIS_COFINS).custoLiquidoUnitario).toBeCloseTo(91.86, 10);
  });

  it('Simples Nacional, MG com PTA, V = 100 → 90,75 (sem IPI, o valor digitado já é o vProd)', () => {
    const c = custoDaCompraSemNota(100, manual({ tipoFornecedor: 'SIMPLES_NACIONAL', ipiPercentual: 0 }), 0.12, PARAMETROS, PIS_COFINS);
    expect(c.aliquotaIpi).toBe(0);
    expect(c.custoLiquidoUnitario).toBeCloseTo(90.75, 10);
  });

  it('indústria normal sem IPI informado usa o IPI do cadastro; sem cadastro → pelo bruto, sem crédito', () => {
    expect(custoDaCompraSemNota(112, manual({ ipiPercentual: null }), 0.12, PARAMETROS, PIS_COFINS).custoLiquidoUnitario).toBeCloseTo(90.75, 10);
    const semCadastro = custoDaCompraSemNota(112, manual({ ipiPercentual: null }), null, PARAMETROS, PIS_COFINS);
    expect(semCadastro).toMatchObject({ custoBrutoUnitario: 112, custoLiquidoUnitario: null, aliquotaIpi: null });
    // No custo do produto ele entra pelo bruto e marca o preço como incompleto (ITEM_SEM_NCM_IPI).
    const r = calcularCusto([{ codigo: 'MP00000045', quantidade: 1, ...semCadastro }]);
    expect(r.custoLiquido).toBeCloseTo(112, 10);
    expect(r.avisos[0]).toMatchObject({ codigo: 'ITEM_SEM_NCM_IPI', item: 'MP00000045' });
  });

  it('comércio/distribuidor sem IPI informado → IPI 0 (nunca o do cadastro)', () => {
    const c = custoDaCompraSemNota(100, manual({ tipoFornecedor: 'COMERCIO', ipiPercentual: null }), 0.12, PARAMETROS, PIS_COFINS);
    expect(c.aliquotaIpi).toBe(0);
    expect(c.custoLiquidoUnitario).toBeCloseTo(90.75, 10);
  });
});

describe('prioridade do custo: manual da simulação > manual salvo > Omie > sem custo', () => {
  it('sem manual e sem custo no Omie → SEM_CUSTO (entra como zero no cálculo, preço incompleto)', () => {
    const r = resolverCustoItem({ codigo: 'MO00000038', custoOmie: 0, manualSalvo: null, manualSimulacao: null });
    expect(r).toMatchObject({ origem: 'SEM_CUSTO', valorUnitario: null, conflito: null, avisos: [] });
    const custo = calcularCusto([{ codigo: 'MO00000038', quantidade: 1, custoBrutoUnitario: null, custoLiquidoUnitario: null }]);
    expect(custo.completo).toBe(false);
    expect(custo.avisos[0]).toMatchObject({ codigo: 'ITEM_SEM_CUSTO' });
  });

  it('só Omie → OMIE', () => {
    expect(resolverCustoItem({ codigo: 'MP1', custoOmie: 12.86, manualSalvo: null, manualSimulacao: null })).toMatchObject({ origem: 'OMIE', valorUnitario: 12.86 });
  });

  it('item sem custo no Omie com custo manual salvo → MANUAL_SALVO', () => {
    const r = resolverCustoItem({ codigo: 'MP00000045', custoOmie: null, manualSalvo: manual({ valorNota: 3.5 }), manualSimulacao: null });
    expect(r).toMatchObject({ origem: 'MANUAL_SALVO', valorUnitario: 3.5, conflito: null });
    expect(r.dadosFiscais).toMatchObject({ ufFornecedor: 'MG', tipoFornecedor: 'INDUSTRIA_NORMAL' });
  });

  it('manual salvo diferente do Omie: vale o manual até o operador escolher, com aviso azul mostrando os dois', () => {
    const r = resolverCustoItem({ codigo: 'MP00000045', custoOmie: 4, manualSalvo: manual({ valorNota: 3.5 }), manualSimulacao: null });
    expect(r).toMatchObject({ origem: 'MANUAL_SALVO', valorUnitario: 3.5, conflito: { valorManual: 3.5, valorOmie: 4, escolhido: 'MANUAL' } });
    expect(r.avisos).toEqual([
      { nivel: 'AZUL', codigo: 'CUSTO_MANUAL_DIFERENTE_OMIE', item: 'MP00000045', mensagem: 'Item MP00000045: custo manual R$ 3,50 e custo do Omie R$ 4,00. Está valendo o manual (até você escolher).' },
    ]);
    const omie = resolverCustoItem({ codigo: 'MP00000045', custoOmie: 4, manualSalvo: manual({ valorNota: 3.5 }), manualSimulacao: null, escolhaConflito: 'OMIE' });
    expect(omie).toMatchObject({ origem: 'OMIE', valorUnitario: 4, conflito: { escolhido: 'OMIE' } });
    expect(omie.avisos[0]!.mensagem).toBe('Item MP00000045: custo manual R$ 3,50 e custo do Omie R$ 4,00. Está valendo o do Omie.');
  });

  it('manual igual ao Omie: sem conflito', () => {
    expect(resolverCustoItem({ codigo: 'MP1', custoOmie: 3.5, manualSalvo: manual({ codigo: 'MP1', valorNota: 3.5 }), manualSimulacao: null }).conflito).toBeNull();
  });

  it('"só nesta simulação" passa na frente do salvo e do Omie', () => {
    const r = resolverCustoItem({ codigo: 'MP00000045', custoOmie: 4, manualSalvo: manual({ valorNota: 3.5 }), manualSimulacao: manual({ valorNota: 3, ufFornecedor: 'SP', diferimentoPta: false }) });
    expect(r).toMatchObject({ origem: 'MANUAL_SIMULACAO', valorUnitario: 3, conflito: null });
    expect(r.dadosFiscais!.ufFornecedor).toBe('SP');
  });

  it('item estimado: registro só com dados fiscais (valor vazio) mantém o custo do Omie e leva os dados fiscais', () => {
    const r = resolverCustoItem({ codigo: 'MP1', custoOmie: 12.86, manualSalvo: manual({ codigo: 'MP1', valorNota: null, ufFornecedor: 'SP', diferimentoPta: false }), manualSimulacao: null });
    expect(r).toMatchObject({ origem: 'OMIE', valorUnitario: 12.86, conflito: null });
    expect(r.dadosFiscais!.ufFornecedor).toBe('SP');
  });

  it('escolha "MANUAL" sem custo manual salvo = SEM CUSTO com tarja amarela; nunca 0 e nunca volta sozinho ao Omie', () => {
    const r = resolverCustoItem({ codigo: 'MP00000045', custoOmie: 4, manualSalvo: null, manualSimulacao: null, escolhaConflito: 'MANUAL' });
    expect(r).toMatchObject({ origem: 'SEM_CUSTO', valorUnitario: null, conflito: null });
    expect(r.avisos).toEqual([
      expect.objectContaining({ nivel: 'AMARELO', codigo: 'ITEM_SEM_CUSTO', item: 'MP00000045', mensagem: expect.stringContaining('Digite o custo do item MP00000045') }),
    ]);
    expect(r.avisos[0]!.mensagem).toContain('NÃO foi usado');
    // Registro só com dados fiscais (valor vazio) também não é custo manual.
    const soFiscal = resolverCustoItem({ codigo: 'MP00000045', custoOmie: 4, manualSalvo: manual({ valorNota: null }), manualSimulacao: null, escolhaConflito: 'MANUAL' });
    expect(soFiscal.origem).toBe('SEM_CUSTO');
    // Sem custo no Omie também: sem custo, nunca 0.
    expect(resolverCustoItem({ codigo: 'MP1', custoOmie: null, manualSalvo: null, manualSimulacao: null, escolhaConflito: 'MANUAL' }).valorUnitario).toBeNull();
  });

  it('custo médio 0 no Omie = sem custo', () => {
    expect(resolverCustoItem({ codigo: 'MP1', custoOmie: 0, manualSalvo: null, manualSimulacao: null }).origem).toBe('SEM_CUSTO');
  });

  it('erros explícitos: manual de outro item, custo do Omie inválido, escolha "OMIE" sem custo no Omie', () => {
    expect(() => resolverCustoItem({ codigo: 'MP2', custoOmie: null, manualSalvo: manual(), manualSimulacao: null })).toThrow(/não pertence/);
    expect(() => resolverCustoItem({ codigo: 'MP1', custoOmie: -1, manualSalvo: null, manualSimulacao: null })).toThrow(ErroValidacao);
    expect(() => resolverCustoItem({ codigo: 'MP1', custoOmie: null, manualSalvo: null, manualSimulacao: null, escolhaConflito: 'OMIE' })).toThrow(/não tem custo no Omie/);
  });
});
