import { describe, expect, it } from 'vitest';
import { calcularFreteFinal, calcularPercentualAcrescimo, calcularValorAcrescimo } from '../../src/fretes/calculo.js';

describe('calcularValorAcrescimo / calcularFreteFinal', () => {
  it('0% não altera o custo (frete zero, seção 10)', () => {
    expect(calcularValorAcrescimo(1000, 0)).toBe(0);
    expect(calcularFreteFinal(1000, 0)).toBe(1000);
  });

  it('10%', () => {
    expect(calcularValorAcrescimo(1000, 10)).toBe(100);
    expect(calcularFreteFinal(1000, 10)).toBe(1100);
  });

  it('15%', () => {
    expect(calcularValorAcrescimo(1000, 15)).toBe(150);
    expect(calcularFreteFinal(1000, 15)).toBe(1150);
  });

  it('20%', () => {
    expect(calcularValorAcrescimo(1000, 20)).toBe(200);
    expect(calcularFreteFinal(1000, 20)).toBe(1200);
  });
});

describe('calcularPercentualAcrescimo (cálculo reverso)', () => {
  it('1000 → 1200 = 20%', () => {
    expect(calcularPercentualAcrescimo(1000, 1200)).toBe(20);
  });

  it('1000 → 1500 = 50%', () => {
    expect(calcularPercentualAcrescimo(1000, 1500)).toBe(50);
  });

  it('1000 → 1000 = 0%', () => {
    expect(calcularPercentualAcrescimo(1000, 1000)).toBe(0);
  });

  it('custo zero devolve null (percentual indefinido, nunca Infinity/NaN)', () => {
    expect(calcularPercentualAcrescimo(0, 500)).toBeNull();
  });
});
