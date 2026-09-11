import { describe, expect, it } from 'vitest';
import { calcularMargemComissionamento } from '../../src/comissionamento/calcularMargemComissionamento.js';

const SEM_IMPOSTOS_EMBUTIDOS = { icms: 0, pis: 0, cofins: 0, ibs: 0, cbs: 0 };

describe('calcularMargemComissionamento — regra fundamental: custo do produto nunca é abatido (seção 13)', () => {
  it('a margem de comissionamento é idêntica com custo baixo ou custo alto, pois o custo não entra na fórmula', () => {
    // Venda R$ 100.000, despesas (IPI) R$ 30.000 -> margem 70%, independentemente do custo do produto.
    // (o custo do produto nem é um parâmetro desta função — ele nunca poderia influenciar o resultado)
    const semRelacaoComCusto1 = calcularMargemComissionamento({
      valorVenda: 100000,
      valorMercadorias: 70000,
      valorIPI: 30000,
      valorIcmsSt: 0,
      valorFrete: 0,
      valorSeguro: 0,
      outrasDespesas: 0,
      impostosEmbutidos: SEM_IMPOSTOS_EMBUTIDOS,
    });
    expect(semRelacaoComCusto1.margemComissionamentoPercentual).toBe(70);

    // Mesmo valor de venda e despesas, custo do produto seria outro em qualquer análise de custo
    // separada (10.000 ou 70.000) -- mas essa função nunca recebe custo, então o resultado é idêntico.
    const semRelacaoComCusto2 = calcularMargemComissionamento({
      valorVenda: 100000,
      valorMercadorias: 70000,
      valorIPI: 30000,
      valorIcmsSt: 0,
      valorFrete: 0,
      valorSeguro: 0,
      outrasDespesas: 0,
      impostosEmbutidos: SEM_IMPOSTOS_EMBUTIDOS,
    });
    expect(semRelacaoComCusto2.margemComissionamentoPercentual).toBe(
      semRelacaoComCusto1.margemComissionamentoPercentual,
    );
  });
});

describe('calcularMargemComissionamento — exemplo completo do requisito (seção 5)', () => {
  it('venda 100.000, despesas 30.000 (IPI) -> resultado 70.000, margem 70%', () => {
    const resultado = calcularMargemComissionamento({
      valorVenda: 100000,
      valorMercadorias: 70000,
      valorIPI: 30000,
      valorIcmsSt: 0,
      valorFrete: 0,
      valorSeguro: 0,
      outrasDespesas: 0,
      impostosEmbutidos: SEM_IMPOSTOS_EMBUTIDOS,
    });
    expect(resultado.despesasTotal).toBe(30000);
    expect(resultado.resultadoAposDespesas).toBe(70000);
    expect(resultado.margemComissionamentoPercentual).toBe(70);
  });

  it('soma IPI, ICMS-ST e frete/seguro/outras despesas, nunca confundindo as origens', () => {
    const resultado = calcularMargemComissionamento({
      valorVenda: 100000,
      valorMercadorias: 90000,
      valorIPI: 6000,
      valorIcmsSt: 4000, // IPI + ICMS-ST = 10000
      valorFrete: 3000,
      valorSeguro: 1000,
      outrasDespesas: 500,
      impostosEmbutidos: SEM_IMPOSTOS_EMBUTIDOS,
    });
    expect(resultado.despesasIPI).toBe(6000);
    expect(resultado.despesasIcmsSt).toBe(4000);
    expect(resultado.despesasFreteSeguroOutras).toBe(4500);
    expect(resultado.despesasTotal).toBe(14500);
    expect(resultado.resultadoAposDespesas).toBe(85500);
    expect(resultado.margemComissionamentoPercentual).toBe(85.5);
  });

  it('nunca subtrai os impostos embutidos (ICMS/PIS/COFINS/IBS/CBS) — são apenas informativos', () => {
    const resultado = calcularMargemComissionamento({
      valorVenda: 100000,
      valorMercadorias: 90000,
      valorIPI: 10000,
      valorIcmsSt: 0,
      valorFrete: 0,
      valorSeguro: 0,
      outrasDespesas: 0,
      impostosEmbutidos: { icms: 15000, pis: 1500, cofins: 7000, ibs: 100, cbs: 900 },
    });
    // despesasTotal e margem não são afetados pelos impostos embutidos, mesmo sendo grandes.
    expect(resultado.despesasTotal).toBe(10000);
    expect(resultado.resultadoAposDespesas).toBe(90000);
    expect(resultado.margemComissionamentoPercentual).toBe(90);
    // mas continuam disponíveis no resultado, para exibição.
    expect(resultado.impostosEmbutidos).toEqual({ icms: 15000, pis: 1500, cofins: 7000, ibs: 100, cbs: 900 });
  });
});

describe('calcularMargemComissionamento — venda zero', () => {
  it('nunca divide por zero: margem fica null, nunca Infinity/NaN', () => {
    const resultado = calcularMargemComissionamento({
      valorVenda: 0,
      valorMercadorias: 0,
      valorIPI: 0,
      valorIcmsSt: 0,
      valorFrete: 0,
      valorSeguro: 0,
      outrasDespesas: 0,
      impostosEmbutidos: SEM_IMPOSTOS_EMBUTIDOS,
    });
    expect(resultado.margemComissionamentoPercentual).toBeNull();
  });
});
