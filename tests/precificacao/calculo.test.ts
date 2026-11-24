import { describe, expect, it } from 'vitest';
import { arredondarDinheiro } from '../../src/calculo/arredondamento.js';
import {
  AVISO_DIFAL_BASE_SIMPLES,
  AVISO_MG_CONSUMIDOR_FINAL,
  aliquotaIcmsCompra,
  aliquotaIpiCompraSemNota,
  calcularCusto,
  calcularLucro,
  calcularPrecos,
  calcularReverso,
  creditosDaCompra,
  decomporValorNota,
  determinarCenario,
  margemAntesDoIrCs,
  type ClienteVenda,
  type Comercial,
  type EntradaPreco,
  type ParametrosIcmsCompra,
  type ParametrosVenda,
  type ProdutoVenda,
  type ResultadoCenario,
} from '../../src/precificacao/calculo.js';
import { ErroValidacao } from '../../src/validacao.js';

const r2 = arredondarDinheiro;
/** Percentual com 1 casa, como na tabela da spec (24,0%). */
const p1 = (fracao: number | null): number => Math.round(((fracao ?? Number.NaN) + Number.EPSILON) * 1000) / 10;

const PARAMETROS_VENDA: ParametrosVenda = {
  pisCofins: 0.0925,
  ganhoIcmsNaBasePisCofins: false,
  percentualRecolhimentoIcms: 0,
  percentualRecolhimentoIcmsMgNaoContribuinte: 0,
  icmsInterestadualVendaPorUf: { SP: 0.12, RJ: 0.12, BA: 0.07 },
  icmsImportadoVenda: 0.04,
  aliquotaInternaPorUf: { SP: 0.18, BA: 0.205, RJ: 0.1 },
};
const IR_CS = 0.34;
const PRODUTO: ProdutoVenda = { icmsInternoMgNcm: 0.18, conteudoImportado: false };
const CLIENTE_SP_CONTRIBUINTE: ClienteVenda = { uf: 'SP', contribuinte: true, usoConsumo: false, autorizadoDiferimentoMg: false };
const CLIENTE_MG_AUTORIZADO: ClienteVenda = { uf: 'MG', contribuinte: true, usoConsumo: false, autorizadoDiferimentoMg: true };
const CLIENTE_MG_NAO_AUTORIZADO: ClienteVenda = { uf: 'MG', contribuinte: true, usoConsumo: false, autorizadoDiferimentoMg: false };
const CLIENTE_MG_NAO_CONTRIBUINTE: ClienteVenda = { uf: 'MG', contribuinte: false, usoConsumo: false, autorizadoDiferimentoMg: false };
const CLIENTE_SP_NAO_CONTRIBUINTE: ClienteVenda = { uf: 'SP', contribuinte: false, usoConsumo: false, autorizadoDiferimentoMg: false };

/** Exemplo numérico de validação da spec: C_liq 90,75; comissão 3%; despesas 10%; margem 12% antes do IR/CS. */
const CUSTO_LIQUIDO = 90.75;
const COMERCIAL: Comercial = { comissao: 0.03, despesas: 0.1, margem: 0.12 };

function entrada(cenario: ResultadoCenario, extra: Partial<EntradaPreco> = {}): EntradaPreco {
  return { custoLiquido: CUSTO_LIQUIDO, cenario, comercial: COMERCIAL, irCs: IR_CS, aliquotaIpiVenda: 0, ...extra };
}
const cenario = (cliente: ClienteVenda, parametros: Partial<ParametrosVenda> = {}, produto: Partial<ProdutoVenda> = {}) =>
  determinarCenario(cliente, { ...PRODUTO, ...produto }, { ...PARAMETROS_VENDA, ...parametros });
const precos = (c: ResultadoCenario, extra: Partial<EntradaPreco> = {}) => calcularPrecos(entrada(c, extra));

describe('Exemplo numérico de validação (tabela da spec, exatamente)', () => {
  const cenarioC = cenario(CLIENTE_SP_CONTRIBUINTE);
  const cenarioA = cenario(CLIENTE_MG_AUTORIZADO);

  it('C, cheio (ICMS 12%): divisor 0,5486; preço 165,42; lucro 39,70 (24,0%) → 26,20 (15,8%)', () => {
    const cheio = precos(cenarioC).cheio!;
    expect(cheio.divisor).toBeCloseTo(0.5486, 10);
    expect(r2(cheio.preco)).toBe(165.42);
    expect(r2(cheio.lucro.lucroAntesIrCs)).toBe(39.7);
    expect(p1(cheio.lucro.margemAntesIrCs)).toBe(24.0);
    expect(r2(cheio.lucro.lucroDepoisIrCs)).toBe(26.2);
    expect(p1(cheio.lucro.margemDepoisIrCs)).toBe(15.8);
  });

  it('C, cheio: os 12 pontos a mais são o ICMS destacado e não recolhido (R$ 19,85)', () => {
    const cheio = precos(cenarioC).cheio!;
    expect(r2(cheio.lucro.icmsDestacado)).toBe(19.85);
    expect(r2(cheio.lucro.icmsNoLucro)).toBe(19.85);
    expect(cheio.lucro.icmsRecolhido).toBe(0);
  });

  it('C, piso (ICMS 12%): divisor 0,6686; preço 135,73; lucro 16,29 (12,0%) → 10,75 (7,9%)', () => {
    const { piso } = precos(cenarioC);
    expect(piso.divisor).toBeCloseTo(0.6686, 10);
    expect(r2(piso.preco)).toBe(135.73);
    expect(r2(piso.lucro.lucroAntesIrCs)).toBe(16.29);
    expect(p1(piso.lucro.margemAntesIrCs)).toBe(12.0);
    expect(r2(piso.lucro.lucroDepoisIrCs)).toBe(10.75);
    expect(p1(piso.lucro.margemDepoisIrCs)).toBe(7.9);
  });

  it('A, MG autorizado: divisor 0,6575; preço 138,02; lucro 16,56 (12,0%) → 10,93 (7,9%)', () => {
    const { cheio, piso } = precos(cenarioA);
    expect(cheio!.divisor).toBeCloseTo(0.6575, 10);
    expect(r2(cheio!.preco)).toBe(138.02);
    expect(r2(cheio!.lucro.lucroAntesIrCs)).toBe(16.56);
    expect(p1(cheio!.lucro.margemAntesIrCs)).toBe(12.0);
    expect(r2(cheio!.lucro.lucroDepoisIrCs)).toBe(10.93);
    expect(p1(cheio!.lucro.margemDepoisIrCs)).toBe(7.9);
    // Sem ICMS destacado, piso e cheio coincidem.
    expect(piso.preco).toBeCloseTo(cheio!.preco, 10);
  });
});

describe('cenários de venda', () => {
  it('A: cliente MG autorizado — sem ICMS, PIS/COFINS cheio, sem DIFAL, sem avisos', () => {
    expect(cenario(CLIENTE_MG_AUTORIZADO)).toMatchObject({ cenario: 'A', icmsDestacado: 0, icmsRecolhido: 0, pisCofinsEfetivo: 0.0925, difal: 0, avisos: [] });
  });

  it('B: cliente MG não autorizado — ICMS interno do NCM (18%), PIS/COFINS × (1 − ICMS)', () => {
    const c = cenario(CLIENTE_MG_NAO_AUTORIZADO);
    expect(c).toMatchObject({ cenario: 'B', icmsDestacado: 0.18, icmsRecolhido: 0, difal: 0, avisos: [] });
    expect(c.pisCofinsEfetivo).toBeCloseTo(0.07585, 12);
    const { cheio, piso } = precos(c);
    expect(cheio!.divisor).toBeCloseTo(0.49415, 10);
    expect(r2(cheio!.preco)).toBe(183.65);
    expect(r2(cheio!.lucro.lucroAntesIrCs)).toBe(55.09);
    expect(r2(cheio!.lucro.lucroDepoisIrCs)).toBe(36.36);
    expect(piso.divisor).toBeCloseTo(0.67415, 10);
    expect(r2(piso.preco)).toBe(134.61);
    expect(r2(piso.lucro.lucroAntesIrCs)).toBe(16.15);
    expect(r2(piso.lucro.lucroDepoisIrCs)).toBe(10.66);
  });

  it('B: cliente MG não contribuinte — cenário B com aviso "confirmar com o fiscal"; padrão 0% = mesmo preço do B', () => {
    const c = cenario(CLIENTE_MG_NAO_CONTRIBUINTE);
    expect(c.cenario).toBe('B');
    expect(c.motivo).toBe('Cliente MG não contribuinte → ICMS 18%');
    expect(c.avisos).toEqual([AVISO_MG_CONSUMIDOR_FINAL]);
    expect(c.icmsRecolhido).toBe(0);
    expect(r2(precos(c).piso.preco)).toBe(134.61);
  });

  it('B: "% de recolhimento do ICMS em MG para não contribuinte" a 100% — o ICMS vira custo (piso = cheio)', () => {
    const c = cenario(CLIENTE_MG_NAO_CONTRIBUINTE, { percentualRecolhimentoIcmsMgNaoContribuinte: 1 });
    expect(c.icmsRecolhido).toBe(0.18);
    const { cheio, piso } = precos(c);
    expect(r2(piso.preco)).toBe(183.65);
    expect(piso.preco).toBeCloseTo(cheio!.preco, 10);
    expect(r2(piso.lucro.icmsRecolhido)).toBe(33.06);
    expect(piso.lucro.icmsNoLucro).toBeCloseTo(0, 10);
    expect(r2(piso.lucro.lucroAntesIrCs)).toBe(22.04);
    expect(piso.lucro.margemAntesIrCs).toBeCloseTo(0.12, 10);
  });

  it('B: o parâmetro de não contribuinte não afeta contribuinte não autorizado (usa o recolhimento geral)', () => {
    expect(cenario(CLIENTE_MG_NAO_AUTORIZADO, { percentualRecolhimentoIcmsMgNaoContribuinte: 1 }).icmsRecolhido).toBe(0);
  });

  it('B: contribuinte de MG comprando para uso e consumo é consumidor final (mesmo autorizado): B com aviso', () => {
    const c = cenario({ ...CLIENTE_MG_AUTORIZADO, usoConsumo: true });
    expect(c.cenario).toBe('B');
    expect(c.motivo).toContain('uso e consumo');
    expect(c.avisos).toEqual([AVISO_MG_CONSUMIDOR_FINAL]);
  });

  it('B: sem alíquota interna de MG para o NCM → erro explícito, nunca um valor assumido', () => {
    expect(() => cenario(CLIENTE_MG_NAO_AUTORIZADO, {}, { icmsInternoMgNcm: null })).toThrow(ErroValidacao);
  });

  it('autorizado diferimento MG: recusado para cliente de fora de MG e para não contribuinte', () => {
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, autorizadoDiferimentoMg: true })).toThrow(/só se aplica a cliente de MG/);
    expect(() => cenario({ ...CLIENTE_MG_AUTORIZADO, contribuinte: false })).toThrow(/exige cliente contribuinte/);
  });

  it('C: motivo legível ("Cliente SP contribuinte → ICMS 12%")', () => {
    const c = cenario(CLIENTE_SP_CONTRIBUINTE);
    expect(c.cenario).toBe('C');
    expect(c.motivo).toBe('Cliente SP contribuinte → ICMS 12%');
    expect(c.avisos).toEqual([]);
  });

  it('C: UF com 7% e produto com conteúdo importado (4%)', () => {
    expect(cenario({ ...CLIENTE_SP_CONTRIBUINTE, uf: 'BA' }).icmsDestacado).toBe(0.07);
    const importado = cenario(CLIENTE_SP_CONTRIBUINTE, {}, { conteudoImportado: true });
    expect(importado.icmsDestacado).toBe(0.04);
    expect(importado.motivo).toContain('importado');
  });

  it('venda dentro de MG ignora o conteúdo importado (4% só vale para venda interestadual)', () => {
    expect(cenario(CLIENTE_MG_NAO_AUTORIZADO, {}, { conteudoImportado: true }).icmsDestacado).toBe(0.18);
  });

  it('D: não contribuinte de SP — ICMS 12% + DIFAL 6% (18% − 12%), base simples, com aviso', () => {
    const c = cenario(CLIENTE_SP_NAO_CONTRIBUINTE);
    expect(c.cenario).toBe('D');
    expect(c.difal).toBeCloseTo(0.06, 12);
    expect(c.avisos).toEqual([AVISO_DIFAL_BASE_SIMPLES]);
    const { cheio, piso } = precos(c);
    expect(cheio!.divisor).toBeCloseTo(0.4886, 10);
    expect(r2(cheio!.preco)).toBe(185.73);
    expect(r2(cheio!.lucro.difal)).toBe(11.14);
    expect(r2(cheio!.lucro.lucroAntesIrCs)).toBe(44.58);
    expect(r2(cheio!.lucro.lucroDepoisIrCs)).toBe(29.42);
    expect(piso.divisor).toBeCloseTo(0.6086, 10);
    expect(r2(piso.preco)).toBe(149.11);
    expect(r2(piso.lucro.lucroAntesIrCs)).toBe(17.89);
    expect(r2(piso.lucro.lucroDepoisIrCs)).toBe(11.81);
  });

  it('D: produto importado para SP — ICMS 4% + DIFAL 14%', () => {
    const c = cenario(CLIENTE_SP_NAO_CONTRIBUINTE, {}, { conteudoImportado: true });
    expect(c.difal).toBeCloseTo(0.14, 12);
    const { cheio, piso } = precos(c);
    expect(r2(cheio!.preco)).toBe(188.59);
    expect(r2(cheio!.lucro.lucroAntesIrCs)).toBe(30.17);
    expect(r2(piso.preco)).toBe(174.12);
    expect(r2(piso.lucro.lucroAntesIrCs)).toBe(20.89);
  });

  it('D: UF de 7% (BA) — ICMS 7% + DIFAL 13,5% (20,5% − 7%)', () => {
    const c = cenario({ ...CLIENTE_SP_NAO_CONTRIBUINTE, uf: 'BA' });
    expect(c.difal).toBeCloseTo(0.135, 12);
    const { cheio, piso } = precos(c);
    expect(r2(cheio!.preco)).toBe(197.72);
    expect(r2(cheio!.lucro.lucroAntesIrCs)).toBe(37.57);
    expect(r2(piso.preco)).toBe(171.56);
    expect(r2(piso.lucro.lucroAntesIrCs)).toBe(20.59);
  });

  it('D: alíquota interna menor que a interestadual não gera DIFAL negativo', () => {
    expect(cenario({ ...CLIENTE_SP_NAO_CONTRIBUINTE, uf: 'RJ' }).difal).toBe(0);
  });

  it('D: contribuinte comprando para uso e consumo também paga DIFAL', () => {
    const c = cenario({ ...CLIENTE_SP_CONTRIBUINTE, usoConsumo: true });
    expect(c.cenario).toBe('D');
    expect(c.motivo).toContain('uso e consumo');
  });

  it('tabela fiscal incompleta (DIFAL ou interestadual da UF) → erro explícito', () => {
    expect(() => cenario({ ...CLIENTE_SP_NAO_CONTRIBUINTE, uf: 'PR' })).toThrow(/não está configurad/);
    expect(() => cenario(CLIENTE_SP_NAO_CONTRIBUINTE, { aliquotaInternaPorUf: {} })).toThrow(/DIFAL/);
  });

  it('chave "ganho do ICMS na base de PIS/COFINS" ligada (recolhimento 0): PIS/COFINS cheio em B, C e D', () => {
    for (const cliente of [CLIENTE_MG_NAO_AUTORIZADO, CLIENTE_SP_CONTRIBUINTE, CLIENTE_SP_NAO_CONTRIBUINTE, CLIENTE_MG_AUTORIZADO]) {
      expect(cenario(cliente, { ganhoIcmsNaBasePisCofins: true }).pisCofinsEfetivo).toBe(0.0925);
    }
    const cheio = precos(cenario(CLIENTE_SP_CONTRIBUINTE, { ganhoIcmsNaBasePisCofins: true })).cheio!;
    expect(cheio.divisor).toBeCloseTo(0.5375, 10);
    expect(r2(cheio.preco)).toBe(168.84);
    expect(r2(cheio.lucro.lucroAntesIrCs)).toBe(40.52);
    expect(r2(cheio.lucro.lucroDepoisIrCs)).toBe(26.74);
  });

  it('chave ligada + recolhimento 50%: só o ganho (ICMS não recolhido) volta à base — 9,25% × (1 − 6%) = 8,695%', () => {
    const c = cenario(CLIENTE_SP_CONTRIBUINTE, { ganhoIcmsNaBasePisCofins: true, percentualRecolhimentoIcms: 0.5 });
    expect(c.pisCofinsEfetivo).toBeCloseTo(0.08695, 12);
    const { cheio, piso } = precos(c);
    expect(r2(cheio!.preco)).toBe(167.11);
    expect(r2(piso.preco)).toBe(150.49);
  });

  it('recolhimento do ICMS a 25%: a parte recolhida vira custo no piso e sai do lucro (valores absolutos)', () => {
    const c = cenario(CLIENTE_SP_CONTRIBUINTE, { percentualRecolhimentoIcms: 0.25 });
    expect(c.icmsRecolhido).toBeCloseTo(0.03, 12);
    const { cheio, piso } = precos(c);
    expect(piso.divisor).toBeCloseTo(0.6386, 10);
    expect(r2(piso.preco)).toBe(142.11);
    expect(r2(piso.lucro.icmsRecolhido)).toBe(4.26);
    expect(r2(piso.lucro.icmsNoLucro)).toBe(12.79);
    expect(r2(piso.lucro.lucroAntesIrCs)).toBe(17.05);
    expect(piso.lucro.margemAntesIrCs).toBeCloseTo(0.12, 10);
    // O cheio não muda de preço (o ICMS todo já está no divisor), mas perde no lucro a parte recolhida.
    expect(r2(cheio!.preco)).toBe(165.42);
    expect(r2(cheio!.lucro.icmsRecolhido)).toBe(4.96);
    expect(r2(cheio!.lucro.lucroAntesIrCs)).toBe(34.74);
  });

  it('recolhimento de 100% é aceito (fim da transição); acima de 100% é recusado', () => {
    expect(cenario(CLIENTE_SP_CONTRIBUINTE, { percentualRecolhimentoIcms: 1 }).icmsRecolhido).toBe(0.12);
    expect(() => cenario(CLIENTE_SP_CONTRIBUINTE, { percentualRecolhimentoIcms: 1.01 })).toThrow(ErroValidacao);
  });

  it('booleanos têm de ser boolean: a string "false" é recusada, nunca lida como verdadeira', () => {
    const texto = 'false' as unknown as boolean;
    expect(() => cenario({ ...CLIENTE_MG_NAO_AUTORIZADO, autorizadoDiferimentoMg: texto })).toThrow(/autorizado/);
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, contribuinte: texto })).toThrow(/contribuinte/);
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, usoConsumo: undefined as unknown as boolean })).toThrow(/uso e consumo/);
    expect(() => cenario(CLIENTE_SP_CONTRIBUINTE, { ganhoIcmsNaBasePisCofins: texto })).toThrow(/Ganho do ICMS/);
    expect(() => cenario(CLIENTE_SP_CONTRIBUINTE, {}, { conteudoImportado: texto })).toThrow(/importado/);
  });

  it('UF inválida e tabela por UF sem chave herdada do protótipo', () => {
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, uf: 'XX' as never })).toThrow(/UF do cliente/);
    const comProtoPoluido = Object.create({ PR: 0.12 }) as Partial<Record<'PR', number>>;
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, uf: 'PR' }, { icmsInterestadualVendaPorUf: comProtoPoluido })).toThrow(/não está configurado/);
  });
});

describe('preço: IPI, margem líquida, limites e validação', () => {
  const c = cenario(CLIENTE_SP_CONTRIBUINTE);

  it('IPI somado por fora: C cheio com IPI 10% → R$ 16,54 de IPI, R$ 181,96 com IPI; lucro não muda', () => {
    const cheio = precos(c, { aliquotaIpiVenda: 0.1 }).cheio!;
    expect(r2(cheio.preco)).toBe(165.42);
    expect(r2(cheio.ipi)).toBe(16.54);
    expect(r2(cheio.precoComIpi)).toBe(181.96);
    expect(r2(cheio.lucro.lucroAntesIrCs)).toBe(39.7);
  });

  it('margem informada como líquida: 10% vira ~15,15% antes do IR/CS e o piso entrega exatamente 10% depois', () => {
    const margem = margemAntesDoIrCs(0.1, IR_CS);
    expect(margem).toBeCloseTo(0.151515, 6);
    const { piso } = precos(c, { comercial: { ...COMERCIAL, margem } });
    expect(r2(piso.preco)).toBe(142.45);
    expect(piso.lucro.margemDepoisIrCs).toBeCloseTo(0.1, 10);
  });

  it('margem líquida que passa de 100% após a conversão → erro que cita o IR/CS', () => {
    expect(() => margemAntesDoIrCs(0.7, IR_CS)).toThrow(/antes do IR\/CS/);
  });

  it('só o cheio impossível: devolve cheio = null e o piso continua existindo', () => {
    const r = precos(c, { comercial: { comissao: 0.05, despesas: 0.3, margem: 0.5 } });
    expect(r.cheio).toBeNull();
    expect(r.piso.divisor).toBeCloseTo(0.0686, 10);
    expect(r2(r.piso.preco)).toBe(1322.89);
  });

  it('piso impossível (soma ≥ 100%) → erro explícito; divisor de ruído (≈ 1e-16) também', () => {
    // 8,14% + 5% + 45% + 45% > 100%.
    expect(() => precos(c, { comercial: { comissao: 0.05, despesas: 0.45, margem: 0.45 } })).toThrow(/100%/);
    const cenarioA = cenario(CLIENTE_MG_AUTORIZADO);
    // 9,25% + 3% + 57% + 30,75% = 100%, mas em ponto flutuante o divisor sai 1,1e-16 (positivo): tem de ser recusado.
    expect(() => precos(cenarioA, { comercial: { comissao: 0.03, despesas: 0.57, margem: 0.3075 } })).toThrow(/100%/);
  });

  it('entradas inválidas são rejeitadas (nunca "melhor esforço")', () => {
    expect(() => precos(c, { custoLiquido: -1 })).toThrow(ErroValidacao);
    expect(() => precos(c, { custoLiquido: Number.NaN })).toThrow(ErroValidacao);
    expect(() => precos(c, { custoLiquido: Number.POSITIVE_INFINITY })).toThrow(ErroValidacao);
    expect(() => precos(c, { custoLiquido: '90.75' as unknown as number })).toThrow(ErroValidacao);
    expect(() => precos(c, { comercial: { ...COMERCIAL, comissao: 1 } })).toThrow(ErroValidacao);
    expect(() => precos(c, { comercial: { ...COMERCIAL, margem: -0.01 } })).toThrow(ErroValidacao);
    expect(() => precos(c, { irCs: 1 })).toThrow(/IR\/CS/);
    expect(() => precos(c, { aliquotaIpiVenda: 1 })).toThrow(/IPI da venda/);
  });

  it('cenário forjado (vindo de fora) é validado antes da conta', () => {
    expect(() => precos({ ...c, pisCofinsEfetivo: -0.5 })).toThrow(/PIS\/COFINS efetivo/);
    expect(() => precos({ ...c, icmsRecolhido: 0.2 })).toThrow(/não pode ser maior/);
    expect(() => precos({ ...c, cenario: 'Z' as never })).toThrow(/Cenário/);
    expect(() => precos({ ...c, difal: Number.NaN })).toThrow(/DIFAL/);
  });

  it('prejuízo não gera IR/CS (lucro depois = lucro antes = −27,66 a R$ 80,00)', () => {
    const lucro = calcularLucro(80, entrada(c));
    expect(r2(lucro.lucroAntesIrCs)).toBe(-27.66);
    expect(lucro.irCs).toBe(0);
    expect(lucro.lucroDepoisIrCs).toBe(lucro.lucroAntesIrCs);
  });

  it('preço zero: margens nulas, sem divisão por zero', () => {
    const lucro = calcularLucro(0, entrada(c, { custoLiquido: 0 }));
    expect(lucro.margemAntesIrCs).toBeNull();
    expect(lucro.margemDepoisIrCs).toBeNull();
    expect(lucro.lucroAntesIrCs).toBe(0);
  });
});

describe('modo reverso', () => {
  const c = cenario(CLIENTE_SP_CONTRIBUINTE);

  it('preço-alvo R$ 150,00 (C): lucro 27,54 (18,4%) → 18,18; acima do piso', () => {
    const r = calcularReverso(150, entrada(c));
    expect(r2(r.lucro.lucroAntesIrCs)).toBe(27.54);
    expect(p1(r.lucro.margemAntesIrCs)).toBe(18.4);
    expect(r2(r.lucro.lucroDepoisIrCs)).toBe(18.18);
    expect(r2(r.lucro.icmsNoLucro)).toBe(18);
    expect(r2(r.precoPiso!)).toBe(135.73);
    expect(r.abaixoDoPiso).toBe(false);
  });

  it('preço-alvo R$ 130,00 (C): abaixo do piso de R$ 135,73 → aviso', () => {
    const r = calcularReverso(130, entrada(c));
    expect(r2(r.lucro.lucroAntesIrCs)).toBe(11.77);
    expect(r.abaixoDoPiso).toBe(true);
  });

  it('comparação em centavos: o piso exibido (135,73) não acusa "abaixo"; um centavo a menos acusa', () => {
    expect(calcularReverso(135.73, entrada(c)).abaixoDoPiso).toBe(false);
    expect(calcularReverso(135.72, entrada(c)).abaixoDoPiso).toBe(true);
  });

  it('com IPI de venda e no cenário A: preço-alvo é sem IPI e o IPI vai por fora', () => {
    const r = calcularReverso(150, entrada(cenario(CLIENTE_MG_AUTORIZADO), { aliquotaIpiVenda: 0.1 }));
    expect(r2(r.lucro.lucroAntesIrCs)).toBe(25.88);
    expect(r2(r.lucro.lucroDepoisIrCs)).toBe(17.08);
    expect(r2(r.ipi)).toBe(15);
    expect(r2(r.precoComIpi)).toBe(165);
  });

  it('quando só o cheio é impossível, o reverso ainda funciona; sem piso possível, todo alvo fica abaixo', () => {
    const r = calcularReverso(2000, entrada(c, { comercial: { comissao: 0.05, despesas: 0.3, margem: 0.5 } }));
    expect(r.abaixoDoPiso).toBe(false);
    const semPiso = calcularReverso(2000, entrada(c, { comercial: { comissao: 0.05, despesas: 0.45, margem: 0.45 } }));
    expect(semPiso.precoPiso).toBeNull();
    expect(semPiso.abaixoDoPiso).toBe(true);
  });
});

describe('impostos na compra (créditos do custo)', () => {
  const PARAMETROS_COMPRA: ParametrosIcmsCompra = {
    icmsInternoMgCompra: 0.18,
    icmsInterestadualCompraPorUf: { SP: 0.12, BA: 0.07 },
    icmsImportadoCompra: 0.04,
  };
  const custo = (valorNota: number, ipi: number, icms: number) => creditosDaCompra(decomporValorNota(valorNota, ipi, icms), 0.0925);

  it('alíquota de ICMS da compra: MG com PTA 0%, MG sem PTA 18%, SP 12%, BA 7%, importado 4%', () => {
    expect(aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: true, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toBe(0);
    expect(aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: false, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toBe(0.18);
    expect(aliquotaIcmsCompra({ ufFornecedor: 'SP', diferimentoPta: false, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toBe(0.12);
    expect(aliquotaIcmsCompra({ ufFornecedor: 'BA', diferimentoPta: false, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toBe(0.07);
    expect(aliquotaIcmsCompra({ ufFornecedor: 'SP', diferimentoPta: false, mercadoriaImportada: true }, PARAMETROS_COMPRA)).toBe(0.04);
  });

  it('combinações impossíveis e flags que não são boolean são rejeitadas', () => {
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'SP', diferimentoPta: true, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toThrow(/só se aplica a compras de MG/);
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: false, mercadoriaImportada: true }, PARAMETROS_COMPRA)).toThrow(/fora de MG/);
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'RJ', diferimentoPta: false, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toThrow(/não está configurado/);
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: 'false' as unknown as boolean, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toThrow(/diferimento PTA/);
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'SP' } as never, PARAMETROS_COMPRA)).toThrow(ErroValidacao);
  });

  it('IPI sem nota: indústria usa o cadastro; Simples/comércio é 0; sem cadastro → null (incompleto); informado prevalece', () => {
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'INDUSTRIA_NORMAL', ipiCadastro: 0.12 })).toBe(0.12);
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'SIMPLES_OU_COMERCIO', ipiCadastro: 0.12 })).toBe(0);
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'INDUSTRIA_NORMAL', ipiCadastro: null })).toBeNull();
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'INDUSTRIA_NORMAL', ipiCadastro: null, ipiInformado: 0.05 })).toBe(0.05);
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'SIMPLES_OU_COMERCIO', ipiCadastro: null })).toBe(0);
  });

  it('tipo de fornecedor inválido é recusado mesmo com IPI informado; IPI informado ≥ 100% também', () => {
    expect(() => aliquotaIpiCompraSemNota({ tipoFornecedor: 'XPTO' as never, ipiCadastro: null, ipiInformado: 0.1 })).toThrow(/Tipo de fornecedor/);
    expect(() => aliquotaIpiCompraSemNota({ tipoFornecedor: 'INDUSTRIA_NORMAL', ipiCadastro: null, ipiInformado: 1 })).toThrow(ErroValidacao);
  });

  // Tabela de exemplos da spec: V = 112,00 com IPI 12% (vProd 100,00; IPI 12,00).
  it('MG com diferimento PTA: ICMS 0; PIS/COFINS 9,25; custo líquido 90,75', () => {
    const c = custo(112, 0.12, 0);
    expect(c.vProd).toBeCloseTo(100, 10);
    expect(c.valorIpi).toBeCloseTo(12, 10);
    expect(c.creditoIpi).toBeCloseTo(12, 10);
    expect(c.valorIcms).toBe(0);
    expect(c.creditoPisCofins).toBeCloseTo(9.25, 10);
    expect(c.custoLiquido).toBeCloseTo(90.75, 10);
  });

  it('MG sem diferimento (18%): ICMS 18,00 fica no custo; PIS/COFINS 7,585; custo líquido 92,415', () => {
    const c = custo(112, 0.12, 0.18);
    expect(c.valorIcms).toBeCloseTo(18, 10);
    expect(c.creditoPisCofins).toBeCloseTo(7.585, 10);
    expect(c.custoLiquido).toBeCloseTo(92.415, 10);
  });

  it('SP (12%): ICMS 12,00; PIS/COFINS 8,14; custo líquido 91,86', () => {
    const c = custo(112, 0.12, 0.12);
    expect(c.creditoPisCofins).toBeCloseTo(8.14, 10);
    expect(c.custoLiquido).toBeCloseTo(91.86, 10);
  });

  it('BA (7%) e importada (4%) também tiram o ICMS da base do PIS/COFINS', () => {
    expect(custo(112, 0.12, 0.07).custoLiquido).toBeCloseTo(100 - 0.0925 * 93, 10);
    expect(custo(112, 0.12, 0.04).custoLiquido).toBeCloseTo(100 - 0.0925 * 96, 10);
  });

  it('fornecedor Simples em MG com PTA (IPI 0, V = 100,00): custo líquido 90,75', () => {
    const c = custo(100, 0, 0);
    expect(c.creditoIpi).toBe(0);
    expect(c.custoLiquido).toBeCloseTo(90.75, 10);
  });

  it('nota de entrada do Omie (valores destacados) usa a mesma regra', () => {
    const c = creditosDaCompra({ vProd: 100, valorIpi: 12, valorIcms: 12 }, 0.0925);
    expect(c.valorBruto).toBe(112);
    expect(c.custoLiquido).toBeCloseTo(91.86, 10);
  });

  it('ICMS maior que o valor dos produtos ou valores negativos → erro explícito', () => {
    expect(() => creditosDaCompra({ vProd: 10, valorIpi: 0, valorIcms: 11 }, 0.0925)).toThrow(ErroValidacao);
    expect(() => decomporValorNota(-1, 0, 0)).toThrow(ErroValidacao);
  });

  it('ponta a ponta: nota → créditos → custo do produto → preço (MG com PTA reproduz o exemplo da spec)', () => {
    const compra = custo(112, 0.12, 0);
    const r = calcularCusto([{ codigo: 'MP1', quantidade: 1, custoBrutoUnitario: compra.valorBruto, custoLiquidoUnitario: compra.custoLiquido }], 0);
    expect(r.custoLiquido).toBeCloseTo(90.75, 10);
    const cheio = precos(cenario(CLIENTE_SP_CONTRIBUINTE), { custoLiquido: r.custoLiquido }).cheio!;
    expect(r2(cheio.preco)).toBe(165.42);
  });
});

describe('custo do produto (estrutura + GGF)', () => {
  it('custo bruto e líquido = Σ quantidade × custo + GGF (GGF sem crédito)', () => {
    const r = calcularCusto(
      [
        { codigo: 'MP1', quantidade: 2, custoBrutoUnitario: 112, custoLiquidoUnitario: 90.75 },
        { codigo: 'PI1', quantidade: 0.5, custoBrutoUnitario: 10, custoLiquidoUnitario: 9 },
      ],
      59.76,
    );
    expect(r.custoBruto).toBeCloseTo(2 * 112 + 0.5 * 10 + 59.76, 10);
    expect(r.custoLiquido).toBeCloseTo(2 * 90.75 + 0.5 * 9 + 59.76, 10);
    expect(r.creditos).toBeCloseTo(2 * 21.25 + 0.5 * 1, 10);
    expect(r.completo).toBe(true);
    expect(r.itensSemCusto).toEqual([]);
  });

  it('item sem custo (ou sem IPI definido) entra com zero e deixa o custo incompleto', () => {
    const r = calcularCusto(
      [
        { codigo: 'MP1', quantidade: 1, custoBrutoUnitario: 100, custoLiquidoUnitario: 90 },
        { codigo: 'MO37', quantidade: 1, custoBrutoUnitario: null, custoLiquidoUnitario: null },
        { codigo: 'MP45', quantidade: 3, custoBrutoUnitario: 50, custoLiquidoUnitario: null },
      ],
      10,
    );
    expect(r.custoLiquido).toBeCloseTo(100, 10);
    expect(r.itensSemCusto).toEqual(['MO37', 'MP45']);
    expect(r.completo).toBe(false);
  });

  it('GGF ausente também deixa o custo incompleto', () => {
    const r = calcularCusto([{ codigo: 'MP1', quantidade: 1, custoBrutoUnitario: 100, custoLiquidoUnitario: 90 }], null);
    expect(r.itensSemCusto).toEqual(['GGF']);
    expect(r.completo).toBe(false);
  });

  it('custo líquido maior que o bruto ou quantidade negativa → erro explícito', () => {
    expect(() => calcularCusto([{ codigo: 'X', quantidade: 1, custoBrutoUnitario: 10, custoLiquidoUnitario: 11 }], 0)).toThrow(ErroValidacao);
    expect(() => calcularCusto([{ codigo: 'X', quantidade: -1, custoBrutoUnitario: 10, custoLiquidoUnitario: 9 }], 0)).toThrow(ErroValidacao);
  });
});
