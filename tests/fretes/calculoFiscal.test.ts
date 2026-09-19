import { describe, expect, it } from 'vitest';
import { calcularValorMinimo } from '../../src/fretes/calculoFiscal.js';

describe('calcularValorMinimo (Fase 4A.7 — fórmula "por dentro", nunca soma direta)', () => {
  it('calcula o valor mínimo via gross-up "por dentro": custo / (1 - alíquotaTotal)', () => {
    // PIS 1% + COFINS 3% + ICMS 18% = 22% -> 1000 / (1 - 0.22) = 1282.05...
    const valorMinimo = calcularValorMinimo(1000, { pisPercentual: 1, cofinsPercentual: 3, icmsPercentual: 18 });
    expect(valorMinimo).toBeCloseTo(1282.05, 2);
  });

  it('nunca soma os percentuais direto ao custo (fórmula "por fora" seria 1000*1.22=1220, incorreta)', () => {
    const valorMinimo = calcularValorMinimo(1000, { pisPercentual: 1, cofinsPercentual: 3, icmsPercentual: 18 });
    expect(valorMinimo).not.toBe(1220);
    expect(valorMinimo).toBeGreaterThan(1220);
  });

  it('alíquota total 0% devolve exatamente o custo', () => {
    const valorMinimo = calcularValorMinimo(500, { pisPercentual: 0, cofinsPercentual: 0, icmsPercentual: 0 });
    expect(valorMinimo).toBe(500);
  });

  it('rejeita calcular quando algum percentual ainda não foi configurado (null) — nunca assume 0% inventado', () => {
    expect(() => calcularValorMinimo(1000, { pisPercentual: null, cofinsPercentual: 3, icmsPercentual: 18 })).toThrow(/não configurados/);
    expect(() => calcularValorMinimo(1000, { pisPercentual: 1, cofinsPercentual: null, icmsPercentual: 18 })).toThrow(/não configurados/);
    expect(() => calcularValorMinimo(1000, { pisPercentual: 1, cofinsPercentual: 3, icmsPercentual: null })).toThrow(/não configurados/);
  });

  it('rejeita alíquota total >= 100%', () => {
    expect(() => calcularValorMinimo(1000, { pisPercentual: 50, cofinsPercentual: 30, icmsPercentual: 20 })).toThrow(/100%/);
  });

  it('rejeita alíquota total negativa', () => {
    expect(() => calcularValorMinimo(1000, { pisPercentual: -30, cofinsPercentual: 3, icmsPercentual: 18 })).toThrow(/negativas/);
  });
});
