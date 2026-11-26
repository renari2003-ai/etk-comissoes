import { describe, expect, it } from 'vitest';
import { arredondarDinheiro } from '../../src/calculo/arredondamento.js';
import {
  AVISO_DIFAL_BASE_SIMPLES,
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
import { ErroPrecificacao, type CodigoAviso } from '../../src/precificacao/avisos.js';

/** Executa e devolve o aviso vermelho do ErroPrecificacao lançado (falha se não lançar). */
function avisoVermelho(fn: () => unknown): { codigo: CodigoAviso; item: string | null; mensagem: string } {
  try {
    fn();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroPrecificacao);
    expect(erro).toBeInstanceOf(ErroValidacao);
    const { aviso } = erro as ErroPrecificacao;
    expect(aviso.nivel).toBe('VERMELHO');
    return aviso;
  }
  throw new Error('esperava ErroPrecificacao');
}

const r2 = arredondarDinheiro;
/** Percentual com 1 casa, como na tabela da spec (24,0%). */
const p1 = (fracao: number | null): number => Math.round(((fracao ?? Number.NaN) + Number.EPSILON) * 1000) / 10;

const PARAMETROS_VENDA: ParametrosVenda = {
  pisCofins: 0.0925,
  icmsInternoMgVenda: 0.18,
  ganhoIcmsNaBasePisCofins: false,
  percentualRecolhimentoIcms: 0,
  // 0 aqui só para isolar as fórmulas de B/D; o padrão real é 100% (ver "respostas do fiscal" abaixo).
  percentualRecolhimentoIcmsConsumidorFinal: 0,
  icmsInterestadualVendaPorUf: { SP: 0.12, RJ: 0.12, BA: 0.07 },
  icmsImportadoVenda: 0.04,
  aliquotaInternaPorUf: { SP: 0.18, BA: 0.205, RJ: 0.1 },
};
const IR_CS = 0.34;
const PRODUTO: ProdutoVenda = { icmsInternoMgExcecaoNcm: null, conteudoImportado: false };
const SEM_PTA = { clienteComPta: false, vendaParaIndustrializacao: false };
const CLIENTE_SP_CONTRIBUINTE: ClienteVenda = { uf: 'SP', contribuinte: true, usoConsumo: false, ...SEM_PTA };
/** Cenário A: cliente de MG com PTA e venda para industrialização. */
const CLIENTE_MG_AUTORIZADO: ClienteVenda = { uf: 'MG', contribuinte: true, usoConsumo: false, clienteComPta: true, vendaParaIndustrializacao: true };
const CLIENTE_MG_NAO_AUTORIZADO: ClienteVenda = { uf: 'MG', contribuinte: true, usoConsumo: false, ...SEM_PTA };
const CLIENTE_MG_NAO_CONTRIBUINTE: ClienteVenda = { uf: 'MG', contribuinte: false, usoConsumo: false, ...SEM_PTA };
const CLIENTE_SP_NAO_CONTRIBUINTE: ClienteVenda = { uf: 'SP', contribuinte: false, usoConsumo: false, ...SEM_PTA };

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
  it('A: cliente MG com PTA e venda para industrialização — sem ICMS, PIS/COFINS cheio, sem DIFAL, sem avisos', () => {
    expect(cenario(CLIENTE_MG_AUTORIZADO)).toMatchObject({ cenario: 'A', icmsDestacado: 0, icmsRecolhido: 0, pisCofinsEfetivo: 0.0925, difal: 0, avisos: [] });
  });

  it('A só com as DUAS condições: cliente com PTA mas venda que não é para industrialização → B (contribuinte, recolhimento geral)', () => {
    const c = cenario({ ...CLIENTE_MG_AUTORIZADO, vendaParaIndustrializacao: false });
    expect(c).toMatchObject({ cenario: 'B', icmsDestacado: 0.18, icmsRecolhido: 0 });
    expect(c.motivo).toBe('Cliente MG com PTA, venda que não é para industrialização → ICMS 18%');
    // Venda para industrialização a cliente SEM PTA também não é A.
    expect(cenario({ ...CLIENTE_MG_NAO_AUTORIZADO, vendaParaIndustrializacao: true }).cenario).toBe('B');
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

  it('B: cliente MG não contribuinte — cenário B, sem aviso (o fiscal respondeu); com recolhimento 0 = mesmo preço do B', () => {
    const c = cenario(CLIENTE_MG_NAO_CONTRIBUINTE);
    expect(c.cenario).toBe('B');
    expect(c.motivo).toBe('Cliente MG não contribuinte → ICMS 18% (consumidor final: 0% recolhido)');
    expect(c.avisos).toEqual([]);
    expect(c.icmsRecolhido).toBe(0);
    expect(r2(precos(c).piso.preco)).toBe(134.61);
  });

  it('B: recolhimento a consumidor final a 100% (padrão do fiscal) — o ICMS vira custo (piso = cheio)', () => {
    const c = cenario(CLIENTE_MG_NAO_CONTRIBUINTE, { percentualRecolhimentoIcmsConsumidorFinal: 1 });
    expect(c.icmsRecolhido).toBe(0.18);
    const { cheio, piso } = precos(c);
    expect(r2(piso.preco)).toBe(183.65);
    expect(piso.preco).toBeCloseTo(cheio!.preco, 10);
    expect(r2(piso.lucro.icmsRecolhido)).toBe(33.06);
    expect(piso.lucro.icmsNoLucro).toBeCloseTo(0, 10);
    expect(r2(piso.lucro.lucroAntesIrCs)).toBe(22.04);
    expect(piso.lucro.margemAntesIrCs).toBeCloseTo(0.12, 10);
  });

  it('B: o recolhimento a consumidor final não afeta contribuinte sem PTA (usa o recolhimento geral, o PTA da ETK)', () => {
    expect(cenario(CLIENTE_MG_NAO_AUTORIZADO, { percentualRecolhimentoIcmsConsumidorFinal: 1 }).icmsRecolhido).toBe(0);
  });

  it('B: contribuinte de MG comprando para uso e consumo é consumidor final (mesmo com PTA): B, recolhimento de consumidor final', () => {
    const c = cenario({ ...CLIENTE_MG_AUTORIZADO, vendaParaIndustrializacao: false, usoConsumo: true }, { percentualRecolhimentoIcmsConsumidorFinal: 1 });
    expect(c.cenario).toBe('B');
    expect(c.motivo).toContain('uso e consumo');
    expect(c.icmsRecolhido).toBe(0.18);
    expect(c.avisos).toEqual([]);
  });

  it('B: sem exceção para o NCM vale a alíquota geral de MG (18%); com exceção, vale a do NCM', () => {
    expect(cenario(CLIENTE_MG_NAO_AUTORIZADO).icmsDestacado).toBe(0.18);
    expect(cenario(CLIENTE_MG_NAO_AUTORIZADO, { icmsInternoMgVenda: 0.2 }).icmsDestacado).toBe(0.2);
    const excecao = cenario(CLIENTE_MG_NAO_AUTORIZADO, {}, { icmsInternoMgExcecaoNcm: 0.12 });
    expect(excecao.icmsDestacado).toBe(0.12);
    expect(excecao.motivo).toBe('Cliente MG contribuinte sem PTA → ICMS 12%');
  });

  it('tarja VERMELHA "cliente inconsistente": PTA de fora de MG, PTA sem ser contribuinte, industrialização + uso e consumo', () => {
    const conflito = avisoVermelho(() => cenario({ ...CLIENTE_MG_AUTORIZADO, usoConsumo: true }));
    expect(conflito.codigo).toBe('CLIENTE_INCONSISTENTE');
    expect(conflito.mensagem).toContain('ao mesmo tempo');
    const industrializacaoSemContribuinte = avisoVermelho(() => cenario({ ...CLIENTE_SP_NAO_CONTRIBUINTE, vendaParaIndustrializacao: true }));
    expect(industrializacaoSemContribuinte.mensagem).toContain('exige cliente contribuinte');
    const foraDeMg = avisoVermelho(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, clienteComPta: true }));
    expect(foraDeMg).toMatchObject({ codigo: 'CLIENTE_INCONSISTENTE', item: 'SP' });
    expect(foraDeMg.mensagem).toMatch(/só se aplica a cliente de MG.*Corrija o cadastro do cliente/);
    const naoContribuinte = avisoVermelho(() => cenario({ ...CLIENTE_MG_AUTORIZADO, contribuinte: false }));
    expect(naoContribuinte.codigo).toBe('CLIENTE_INCONSISTENTE');
    expect(naoContribuinte.mensagem).toContain('sem ser contribuinte');
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

  it('D (respostas do fiscal): não contribuinte de SP com recolhimento 100% — ICMS 12% recolhido + DIFAL 6%: piso = cheio', () => {
    const c = cenario(CLIENTE_SP_NAO_CONTRIBUINTE, { percentualRecolhimentoIcmsConsumidorFinal: 1 });
    expect(c.icmsRecolhido).toBe(0.12);
    expect(c.motivo).toBe('Cliente SP não contribuinte → ICMS 12% (consumidor final: 100% recolhido) + DIFAL 6%');
    const { cheio, piso } = precos(c);
    expect(piso.preco).toBeCloseTo(cheio!.preco, 10);
    expect(r2(piso.preco)).toBe(185.73);
    expect(r2(piso.lucro.icmsRecolhido)).toBe(22.29);
    expect(piso.lucro.icmsNoLucro).toBeCloseTo(0, 10);
    // Contribuinte (cenário C) continua com o recolhimento geral (0%): o PTA da ETK vale.
    expect(cenario(CLIENTE_SP_CONTRIBUINTE, { percentualRecolhimentoIcmsConsumidorFinal: 1 }).icmsRecolhido).toBe(0);
    // Contribuinte comprando para uso e consumo é consumidor final: recolhe também.
    expect(cenario({ ...CLIENTE_SP_CONTRIBUINTE, usoConsumo: true }, { percentualRecolhimentoIcmsConsumidorFinal: 1 }).icmsRecolhido).toBe(0.12);
  });

  it('D: alíquota interna menor que a interestadual não gera DIFAL negativo', () => {
    expect(cenario({ ...CLIENTE_SP_NAO_CONTRIBUINTE, uf: 'RJ' }).difal).toBe(0);
  });

  it('D: contribuinte comprando para uso e consumo também paga DIFAL', () => {
    const c = cenario({ ...CLIENTE_SP_CONTRIBUINTE, usoConsumo: true });
    expect(c.cenario).toBe('D');
    expect(c.motivo).toContain('uso e consumo');
  });

  it('tarja VERMELHA: alíquota interna da UF de destino não configurada (só no cenário D)', () => {
    const aviso = avisoVermelho(() => cenario(CLIENTE_SP_NAO_CONTRIBUINTE, { aliquotaInternaPorUf: { SP: null } }));
    expect(aviso).toMatchObject({ codigo: 'ALIQUOTA_INTERNA_UF_NAO_CONFIGURADA', item: 'SP' });
    expect(aviso.mensagem).toContain('Peça ao administrador para preencher a UF SP na tabela fiscal');
    // A mesma UF sem alíquota interna não atrapalha o cenário C (contribuinte).
    expect(cenario(CLIENTE_SP_CONTRIBUINTE, { aliquotaInternaPorUf: { SP: null } }).cenario).toBe('C');
  });

  it('tarja VERMELHA: ICMS interestadual de venda da UF não configurado', () => {
    const aviso = avisoVermelho(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, uf: 'PR' }));
    expect(aviso).toMatchObject({ codigo: 'ICMS_INTERESTADUAL_UF_NAO_CONFIGURADO', item: 'PR' });
    expect(aviso.mensagem).toContain('preencher a UF PR');
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
    expect(() => cenario({ ...CLIENTE_MG_NAO_AUTORIZADO, clienteComPta: texto })).toThrow(/Cliente com PTA/);
    expect(() => cenario({ ...CLIENTE_MG_NAO_AUTORIZADO, vendaParaIndustrializacao: texto })).toThrow(/industrialização/);
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, contribuinte: texto })).toThrow(/contribuinte/);
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, usoConsumo: undefined as unknown as boolean })).toThrow(/uso e consumo/);
    expect(() => cenario(CLIENTE_SP_CONTRIBUINTE, { ganhoIcmsNaBasePisCofins: texto })).toThrow(/Ganho do ICMS/);
    expect(() => cenario(CLIENTE_SP_CONTRIBUINTE, {}, { conteudoImportado: texto })).toThrow(/importado/);
  });

  it('UF inválida e tabela por UF sem chave herdada do protótipo', () => {
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, uf: 'XX' as never })).toThrow(/UF do cliente/);
    const comProtoPoluido = Object.create({ PR: 0.12 }) as Partial<Record<'PR', number>>;
    expect(() => cenario({ ...CLIENTE_SP_CONTRIBUINTE, uf: 'PR' }, { icmsInterestadualVendaPorUf: comProtoPoluido })).toThrow(/não configurado/);
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

  it('só o cheio impossível: devolve cheio = null, o piso continua existindo, com tarja AZUL', () => {
    const r = precos(c, { comercial: { comissao: 0.05, despesas: 0.3, margem: 0.5 } });
    expect(r.cheio).toBeNull();
    expect(r.avisos.map((a) => [a.nivel, a.codigo])).toEqual([['AZUL', 'PRECO_CHEIO_INDISPONIVEL']]);
    expect(precos(c).avisos).toEqual([]);
    expect(r.piso.divisor).toBeCloseTo(0.0686, 10);
    expect(r2(r.piso.preco)).toBe(1322.89);
  });

  it('piso impossível (soma ≥ 100%) → erro explícito; divisor de ruído (≈ 1e-16) também', () => {
    // 8,14% + 5% + 45% + 45% > 100% → tarja VERMELHA (sem preço).
    const aviso = avisoVermelho(() => precos(c, { comercial: { comissao: 0.05, despesas: 0.45, margem: 0.45 } }));
    expect(aviso.codigo).toBe('SEM_PRECO_POSSIVEL');
    expect(aviso.mensagem).toMatch(/100%.*Reduza a margem/);
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

  it('preço-alvo R$ 130,00 (C): abaixo do piso de R$ 135,73 → tarja VERMELHA no bloco do reverso', () => {
    const r = calcularReverso(130, entrada(c));
    expect(r2(r.lucro.lucroAntesIrCs)).toBe(11.77);
    expect(r.abaixoDoPiso).toBe(true);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ nivel: 'VERMELHO', codigo: 'ALVO_ABAIXO_DO_PISO', item: null });
    expect(r.avisos[0]!.mensagem).toMatch(/130,00 abaixo do preço piso de R\$\s135,73/);
    expect(calcularReverso(150, entrada(c)).avisos).toEqual([]);
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
    expect(semPiso.avisos[0]!.mensagem).toContain('não existe preço que entregue a margem pedida');
  });
});

describe('impostos na compra (créditos do custo)', () => {
  const PARAMETROS_COMPRA: ParametrosIcmsCompra = {
    icmsInternoMgCompra: 0.18,
    icmsInterestadualCompra: 0.12,
    icmsImportadoCompra: 0.04,
  };
  const custo = (valorNota: number, ipi: number, icms: number) => creditosDaCompra(decomporValorNota(valorNota, ipi, icms), 0.0925);

  it('alíquota de ICMS da compra: MG com PTA 0%, MG sem PTA 18%, qualquer outra UF 12% (inclusive N/NE/CO/ES), importado 4%', () => {
    expect(aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: true, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toBe(0);
    expect(aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: false, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toBe(0.18);
    expect(aliquotaIcmsCompra({ ufFornecedor: 'SP', diferimentoPta: false, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toBe(0.12);
    // Correção de 2026-11-24: entradas em MG vindas de qualquer UF são 12%; os 7% só existem na VENDA.
    for (const uf of ['BA', 'ES', 'GO', 'AM', 'RS'] as const) {
      expect(aliquotaIcmsCompra({ ufFornecedor: uf, diferimentoPta: false, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toBe(0.12);
    }
    expect(aliquotaIcmsCompra({ ufFornecedor: 'SP', diferimentoPta: false, mercadoriaImportada: true }, PARAMETROS_COMPRA)).toBe(0.04);
  });

  it('combinações impossíveis e flags que não são boolean são rejeitadas', () => {
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'SP', diferimentoPta: true, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toThrow(/só se aplica a fornecedor de MG/);
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: false, mercadoriaImportada: true }, PARAMETROS_COMPRA)).toThrow(/fora de MG/);
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: 'false' as unknown as boolean, mercadoriaImportada: false }, PARAMETROS_COMPRA)).toThrow(/Fornecedor de MG com PTA/);
    expect(() => aliquotaIcmsCompra({ ufFornecedor: 'SP' } as never, PARAMETROS_COMPRA)).toThrow(ErroValidacao);
  });

  it('IPI sem nota — indústria normal: informado, senão o cadastro; sem cadastro → null (sem crédito, incompleto)', () => {
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'INDUSTRIA_NORMAL', ipiCadastro: 0.12 })).toBe(0.12);
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'INDUSTRIA_NORMAL', ipiCadastro: null })).toBeNull();
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'INDUSTRIA_NORMAL', ipiCadastro: null, ipiInformado: 0.05 })).toBe(0.05);
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'INDUSTRIA_NORMAL', ipiCadastro: 0.12, ipiInformado: 0.05 })).toBe(0.05);
  });

  it('IPI sem nota — Simples Nacional: sempre 0 (travado); IPI informado diferente de 0 é recusado', () => {
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'SIMPLES_NACIONAL', ipiCadastro: 0.12 })).toBe(0);
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'SIMPLES_NACIONAL', ipiCadastro: null, ipiInformado: 0 })).toBe(0);
    expect(() => aliquotaIpiCompraSemNota({ tipoFornecedor: 'SIMPLES_NACIONAL', ipiCadastro: null, ipiInformado: 0.05 })).toThrow(/Simples Nacional/);
  });

  it('IPI sem nota — comércio: começa em 0 (ignora o cadastro), mas aceita o IPI destacado na nota', () => {
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'COMERCIO', ipiCadastro: 0.12 })).toBe(0);
    expect(aliquotaIpiCompraSemNota({ tipoFornecedor: 'COMERCIO', ipiCadastro: null, ipiInformado: 0.1 })).toBe(0.1);
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
    const r = calcularCusto([{ codigo: 'MP1', quantidade: 1, custoBrutoUnitario: compra.valorBruto, custoLiquidoUnitario: compra.custoLiquido }]);
    expect(r.custoLiquido).toBeCloseTo(90.75, 10);
    const cheio = precos(cenario(CLIENTE_SP_CONTRIBUINTE), { custoLiquido: r.custoLiquido }).cheio!;
    expect(r2(cheio.preco)).toBe(165.42);
  });
});

describe('custo do produto (folhas da estrutura, sem GGF separado)', () => {
  it('custo bruto e líquido = Σ quantidade × custo; sem GGF e sem custo de fabricação por padrão', () => {
    const r = calcularCusto([
      { codigo: 'MP1', quantidade: 2, custoBrutoUnitario: 112, custoLiquidoUnitario: 90.75 },
      { codigo: 'PI1', quantidade: 0.5, custoBrutoUnitario: 10, custoLiquidoUnitario: 9 },
    ]);
    expect(r.custoBruto).toBeCloseTo(2 * 112 + 0.5 * 10, 10);
    expect(r.custoLiquido).toBeCloseTo(2 * 90.75 + 0.5 * 9, 10);
    expect(r.creditos).toBeCloseTo(2 * 21.25 + 0.5 * 1, 10);
    expect(r.custoFabricacao).toBe(0);
    expect(r.completo).toBe(true);
    expect(r.itensSemCusto).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it('custo 0 = sem custo: tarja amarela ITEM_SEM_CUSTO e preço incompleto (nunca 0 como custo válido)', () => {
    const r = calcularCusto([
      { codigo: 'MP45', quantidade: 1, custoBrutoUnitario: 0, custoLiquidoUnitario: 0 },
      { codigo: 'MP1', quantidade: 1, custoBrutoUnitario: 100, custoLiquidoUnitario: 90 },
    ]);
    expect(r.itensSemCusto).toEqual(['MP45']);
    expect(r.completo).toBe(false);
    expect(r.avisos).toEqual([expect.objectContaining({ nivel: 'AMARELO', codigo: 'ITEM_SEM_CUSTO', item: 'MP45' })]);
  });

  it('nenhum aviso de GGF: produto completo sem GGF não fica incompleto', () => {
    const r = calcularCusto([{ codigo: 'MP1', quantidade: 1, custoBrutoUnitario: 100, custoLiquidoUnitario: 90 }]);
    expect(r.completo).toBe(true);
    expect(r.avisos).toEqual([]);
  });

  it('"% de custo de fabricação" (desligado por padrão): quando informado, soma % × custo bruto dos materiais, sem crédito', () => {
    const r = calcularCusto([{ codigo: 'MP1', quantidade: 2, custoBrutoUnitario: 100, custoLiquidoUnitario: 90 }], { percentualCustoFabricacao: 0.1 });
    expect(r.custoFabricacao).toBeCloseTo(20, 10);
    expect(r.custoBruto).toBeCloseTo(220, 10);
    expect(r.custoLiquido).toBeCloseTo(200, 10);
    expect(r.creditos).toBeCloseTo(20, 10);
    expect(() => calcularCusto([], { percentualCustoFabricacao: 1 })).toThrow(ErroValidacao);
    expect(() => calcularCusto([], { percentualCustoFabricacao: -0.1 })).toThrow(ErroValidacao);
  });

  it('tarja AMARELA "item sem custo": entra com zero, com o código do item e "digite o custo manual"', () => {
    const r = calcularCusto([
      { codigo: 'MP1', quantidade: 1, custoBrutoUnitario: 100, custoLiquidoUnitario: 90 },
      { codigo: 'MO00000037', quantidade: 2, custoBrutoUnitario: null, custoLiquidoUnitario: null },
    ]);
    expect(r.custoLiquido).toBeCloseTo(90, 10);
    expect(r.itensSemCusto).toEqual(['MO00000037']);
    expect(r.completo).toBe(false);
    expect(r.avisos).toEqual([
      { nivel: 'AMARELO', codigo: 'ITEM_SEM_CUSTO', item: 'MO00000037', mensagem: 'Item MO00000037 sem custo — entrou como zero. Digite o custo manual.' },
    ]);
  });

  it('tarja AMARELA "sem NCM/IPI": item com custo entra pelo valor BRUTO, sem crédito (nunca zero)', () => {
    const r = calcularCusto([
      { codigo: 'MP1', quantidade: 1, custoBrutoUnitario: 100, custoLiquidoUnitario: 90 },
      { codigo: 'MP00000045', quantidade: 3, custoBrutoUnitario: 50, custoLiquidoUnitario: null },
    ]);
    expect(r.custoBruto).toBeCloseTo(100 + 150, 10);
    expect(r.custoLiquido).toBeCloseTo(90 + 150, 10);
    expect(r.itensSemCredito).toEqual(['MP00000045']);
    expect(r.itensSemCusto).toEqual([]);
    expect(r.completo).toBe(false);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ nivel: 'AMARELO', codigo: 'ITEM_SEM_NCM_IPI', item: 'MP00000045' });
    expect(r.avisos[0]!.mensagem).toContain('Corrija o NCM do item MP00000045 no Omie ou peça ao administrador para preencher o NCM na tabela NCM → IPI');
  });

  it('o mesmo item em vários ramos (folhas repetidas): soma todas as quantidades, mas um aviso só por código', () => {
    const r = calcularCusto([
      { codigo: 'MO37', quantidade: 1, custoBrutoUnitario: null, custoLiquidoUnitario: null },
      { codigo: 'MO37', quantidade: 2, custoBrutoUnitario: null, custoLiquidoUnitario: null },
      { codigo: 'MP45', quantidade: 1, custoBrutoUnitario: 10, custoLiquidoUnitario: null },
      { codigo: 'MP45', quantidade: 3, custoBrutoUnitario: 10, custoLiquidoUnitario: null },
    ]);
    expect(r.itensSemCusto).toEqual(['MO37']);
    expect(r.itensSemCredito).toEqual(['MP45']);
    expect(r.custoLiquido).toBeCloseTo(40, 10);
    expect(r.avisos.map((a) => `${a.codigo}:${a.item}`)).toEqual(['ITEM_SEM_CUSTO:MO37', 'ITEM_SEM_NCM_IPI:MP45']);
  });

  it('custo líquido maior que o bruto ou quantidade negativa → erro explícito', () => {
    expect(() => calcularCusto([{ codigo: 'X', quantidade: 1, custoBrutoUnitario: 10, custoLiquidoUnitario: 11 }])).toThrow(ErroValidacao);
    expect(() => calcularCusto([{ codigo: 'X', quantidade: -1, custoBrutoUnitario: 10, custoLiquidoUnitario: 9 }])).toThrow(ErroValidacao);
  });
});
