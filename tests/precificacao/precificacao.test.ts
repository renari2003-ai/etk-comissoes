import { describe, expect, it } from 'vitest';
import {
  calcularMarkupInicial,
  calcularPrecificacaoItem,
  calcularValorTotalOrcamento,
  interpretarMarkupDigitado,
} from '../../public-src/precificacao.js';

describe('calcularPrecificacaoItem — cálculo básico (teste 1 do requisito)', () => {
  it('quantidade 10, custo 15, markup 2 -> preço de venda 30, preço total/subtotal 300', () => {
    const resultado = calcularPrecificacaoItem({ quantidade: 10, custoUnitario: 15 }, 2);
    expect(resultado.precoVenda).toBe(30);
    expect(resultado.precoTotal).toBe(300);
    expect(resultado.subtotal).toBe(300);
  });
});

describe('calcularPrecificacaoItem — markup decimal (teste 2 do requisito)', () => {
  it('quantidade 4, custo 12,50, markup 1,8 -> preço de venda 22,50, preço total/subtotal 90,00', () => {
    const resultado = calcularPrecificacaoItem({ quantidade: 4, custoUnitario: 12.5 }, 1.8);
    expect(resultado.precoVenda).toBeCloseTo(22.5, 10);
    expect(resultado.precoTotal).toBeCloseTo(90, 10);
    expect(resultado.subtotal).toBeCloseTo(90, 10);
  });
});

describe('calcularPrecificacaoItem — alteração do markup recalcula a cadeia inteira (teste 3 do requisito)', () => {
  it('recalcula preço de venda, preço total e subtotal quando o markup muda', () => {
    const item = { quantidade: 5, custoUnitario: 20 };
    const antes = calcularPrecificacaoItem(item, 2);
    expect(antes.precoVenda).toBe(40);
    expect(antes.precoTotal).toBe(200);

    const depois = calcularPrecificacaoItem(item, 2.5);
    expect(depois.precoVenda).toBe(50);
    expect(depois.precoTotal).toBe(250);
    expect(depois.subtotal).toBe(250);
  });
});

describe('calcularValorTotalOrcamento — múltiplos itens (teste 4 do requisito)', () => {
  it('soma os subtotais de itens com quantidades, custos e markups diferentes', () => {
    const itens = [
      { quantidade: 10, custoUnitario: 15 }, // markup 2 -> subtotal 300
      { quantidade: 4, custoUnitario: 12.5 }, // markup 1.8 -> subtotal 90
      { quantidade: 3, custoUnitario: 7 }, // markup 3 -> subtotal 63
    ];
    const markups = [2, 1.8, 3];
    const subtotais = itens.map((item, indice) => calcularPrecificacaoItem(item, markups[indice] ?? null).subtotal);

    expect(subtotais).toEqual([300, 90, 63]);
    expect(calcularValorTotalOrcamento(subtotais)).toBeCloseTo(453, 10);
  });

  it('itens sem markup calculável (custo zero, sem edição) contribuem 0 ao total, sem quebrar a soma', () => {
    const subtotais = [300, null, 63];
    expect(calcularValorTotalOrcamento(subtotais)).toBe(363);
  });
});

describe('calcularMarkupInicial e calcularPrecificacaoItem — custo zero (teste 5 do requisito)', () => {
  it('custo zero nunca gera divisão por zero: markup inicial é null, nunca Infinity/NaN', () => {
    const markup = calcularMarkupInicial(50, 0);
    expect(markup).toBeNull();
    expect(markup).not.toBe(Infinity);
  });

  it('com custo zero, mesmo markup informado manualmente resulta em preço de venda 0 (nunca inventa preço)', () => {
    const resultado = calcularPrecificacaoItem({ quantidade: 5, custoUnitario: 0 }, 3);
    expect(resultado.precoVenda).toBe(0);
    expect(resultado.precoTotal).toBe(0);
    expect(resultado.subtotal).toBe(0);
    expect(Number.isNaN(resultado.precoVenda)).toBe(false);
  });

  it('sem markup informado (null) e custo zero: todos os resultados ficam null, não zero forjado', () => {
    const resultado = calcularPrecificacaoItem({ quantidade: 5, custoUnitario: 0 }, null);
    expect(resultado.markupEditavel).toBeNull();
    expect(resultado.precoVenda).toBeNull();
    expect(resultado.precoTotal).toBeNull();
    expect(resultado.subtotal).toBeNull();
  });
});

describe('calcularPrecificacaoItem — precisão (teste 6 do requisito)', () => {
  it('não arredonda em nenhum ponto da cadeia de cálculo', () => {
    const resultado = calcularPrecificacaoItem({ quantidade: 3, custoUnitario: 10.333333 }, 1.111111);
    const precoVendaEsperado = 10.333333 * 1.111111;
    const precoTotalEsperado = 3 * precoVendaEsperado;
    expect(resultado.precoVenda).toBe(precoVendaEsperado);
    expect(resultado.precoTotal).toBe(precoTotalEsperado);
  });
});

describe('interpretarMarkupDigitado — validação de entrada (seção 16)', () => {
  it('aceita números com ponto decimal', () => {
    expect(interpretarMarkupDigitado('2.75')).toBe(2.75);
  });

  it('aceita números com vírgula decimal', () => {
    expect(interpretarMarkupDigitado('2,75')).toBe(2.75);
  });

  it('aceita inteiros', () => {
    expect(interpretarMarkupDigitado('3')).toBe(3);
  });

  it('rejeita texto não numérico, sem lançar exceção', () => {
    expect(interpretarMarkupDigitado('abc')).toBe('nao_numerico');
  });

  it('rejeita string vazia', () => {
    expect(interpretarMarkupDigitado('')).toBe('nao_numerico');
  });

  it('rejeita valores negativos com motivo específico', () => {
    expect(interpretarMarkupDigitado('-1')).toBe('negativo');
  });

  it('aceita markup zero (decisão de negócio documentada: markup >= 0 é válido)', () => {
    expect(interpretarMarkupDigitado('0')).toBe(0);
  });

  it('aceita vírgula sem dígito antes (ex.: ",61" digitado para 0,61 — forma comum de digitar centavos)', () => {
    expect(interpretarMarkupDigitado(',61')).toBe(0.61);
  });

  it('aceita ponto sem dígito antes (ex.: ".61")', () => {
    expect(interpretarMarkupDigitado('.61')).toBe(0.61);
  });

  it('aceita separador decimal sem dígitos depois (ex.: "0," digitado antes de completar os centavos)', () => {
    expect(interpretarMarkupDigitado('0,')).toBe(0);
  });

  it('rejeita separador decimal sozinho, sem dígito antes nem depois', () => {
    expect(interpretarMarkupDigitado(',')).toBe('nao_numerico');
    expect(interpretarMarkupDigitado('.')).toBe('nao_numerico');
  });
});

describe('calcularPrecificacaoItem — markup zero (seção 17)', () => {
  it('markup 0 é aceito e resulta em preço de venda e total 0', () => {
    const resultado = calcularPrecificacaoItem({ quantidade: 10, custoUnitario: 25 }, 0);
    expect(resultado.precoVenda).toBe(0);
    expect(resultado.precoTotal).toBe(0);
  });
});

describe('calcularMarkupInicial — valor inicial a partir do preço de venda original (seção 3)', () => {
  it('custo 10, preço de venda original 20 -> markup inicial 2,00', () => {
    expect(calcularMarkupInicial(20, 10)).toBe(2);
  });

  it('custo 10, preço de venda original 15 -> markup inicial 1,50', () => {
    expect(calcularMarkupInicial(15, 10)).toBe(1.5);
  });
});
