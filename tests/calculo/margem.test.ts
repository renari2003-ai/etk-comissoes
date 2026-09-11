import { describe, expect, it } from 'vitest';
import { calcularItem, calcularTotais, compararComTotalOmie } from '../../src/calculo/margem.js';
import type { ItemPedidoOmie } from '../../src/calculo/tipos.js';

function item(parcial: Partial<ItemPedidoOmie['produto']>): ItemPedidoOmie {
  return {
    produto: {
      codigo_produto: 1,
      codigo: 'P1',
      descricao: 'Produto Teste',
      quantidade: 1,
      valor_unitario: 0,
      ...parcial,
    },
  };
}

describe('calcularItem — Caso 1: item normal', () => {
  it('calcula receita, custo, margem, margem sobre venda e markup corretamente', () => {
    const it1 = item({ quantidade: 10, valor_unitario: 20, valor_mercadoria: 200 });
    const resultado = calcularItem(it1, 12, 'estoque.nCMC');

    expect(resultado.receita).toBe(200);
    expect(resultado.custoTotal).toBe(120);
    expect(resultado.margemValor).toBe(80);
    // margem sobre venda = 80/200 = 40%
    expect(resultado.margemVendaPercentual).toBe(40);
    // markup sobre custo = 80/120 = 66,666...% -> 66.67
    expect(resultado.markupCustoPercentual).toBe(66.67);
    expect(resultado.alertas).toEqual([]);
  });

  it('calcula receita a partir de quantidade x valor_unitario - desconto quando valor_mercadoria ausente', () => {
    const it1 = item({ quantidade: 5, valor_unitario: 10, valor_desconto: 5 });
    const resultado = calcularItem(it1, 4, 'estoque.nCustoMedio');
    // receita = 5*10 - 5 = 45
    expect(resultado.receita).toBe(45);
  });

  it('markup 100% corresponde a margem de 50% sobre a venda (exemplo conceitual obrigatório)', () => {
    const it1 = item({ quantidade: 1, valor_unitario: 100, valor_mercadoria: 100 });
    const resultado = calcularItem(it1, 50, 'estoque.nCMC');
    expect(resultado.markupCustoPercentual).toBe(100);
    expect(resultado.margemVendaPercentual).toBe(50);
  });
});

describe('calcularItem — Caso 2: item sem custo', () => {
  it('mantém custo zero, gera alerta "sem_custo" e não quebra o cálculo', () => {
    const it1 = item({ quantidade: 3, valor_unitario: 10, valor_mercadoria: 30 });
    const resultado = calcularItem(it1, 0, 'sem custo');

    expect(resultado.custoUnitario).toBe(0);
    expect(resultado.custoTotal).toBe(0);
    expect(resultado.alertas).toContain('sem_custo');
    expect(resultado.margemValor).toBe(30);
  });

  it('conta itens sem custo nos totais e o relatório continua funcionando', () => {
    const itens = [item({ quantidade: 1, valor_unitario: 10, valor_mercadoria: 10 })];
    const totais = calcularTotais(itens, [0], ['sem custo']);
    expect(totais.itensSemCusto).toBe(1);
    expect(totais.receitaTotal).toBe(10);
    expect(totais.custoTotal).toBe(0);
  });
});

describe('calcularItem — Caso 3: margem negativa', () => {
  it('calcula valor negativo com sinal correto e gera alerta "margem_negativa"', () => {
    const it1 = item({ quantidade: 1, valor_unitario: 10, valor_mercadoria: 10 });
    const resultado = calcularItem(it1, 15, 'estoque.nCMC');

    expect(resultado.margemValor).toBe(-5);
    expect(resultado.margemVendaPercentual).toBe(-50);
    expect(resultado.alertas).toContain('margem_negativa');
  });
});

describe('calcularTotais — Caso 4: totais ponderados (não é média de percentuais)', () => {
  it('margem_venda_total é margem_total / receita_total, não a média das margens dos itens', () => {
    // Item A: receita alta, margem percentual baixa
    const itemA = item({ quantidade: 100, valor_unitario: 10, valor_mercadoria: 1000 });
    // Item B: receita baixa, margem percentual alta
    const itemB = item({ quantidade: 1, valor_unitario: 10, valor_mercadoria: 10 });

    // custoA = 9 * 100 = 900 -> margemA = 100 -> margem% A = 10%
    // custoB = 1 * 1 = 1 -> margemB = 9 -> margem% B = 90%
    const totais = calcularTotais([itemA, itemB], [9, 1], ['estoque.nCMC', 'estoque.nCMC']);

    const receitaTotal = 1000 + 10; // 1010
    const custoTotal = 900 + 1; // 901
    const margemTotal = receitaTotal - custoTotal; // 109
    const margemVendaTotalEsperada = Math.round((margemTotal / receitaTotal) * 100 * 100) / 100;

    expect(totais.receitaTotal).toBe(receitaTotal);
    expect(totais.custoTotal).toBe(custoTotal);
    expect(totais.margemTotal).toBe(margemTotal);
    expect(totais.margemVendaTotal).toBe(margemVendaTotalEsperada);

    // A média simples das margens percentuais dos itens seria (10 + 90) / 2 = 50%.
    // O valor correto (ponderado) deve ser bem diferente disso.
    const mediaIncorretaDosPercentuais = 50;
    expect(totais.margemVendaTotal).not.toBe(mediaIncorretaDosPercentuais);
  });
});

describe('calcularTotais e calcularItem — Caso 5: divisão por zero', () => {
  it('receita zero resulta em margemVendaPercentual null, sem exceção/NaN/infinito', () => {
    const it1 = item({ quantidade: 0, valor_unitario: 0, valor_mercadoria: 0 });
    const resultado = calcularItem(it1, 0, 'sem custo');
    expect(resultado.margemVendaPercentual).toBeNull();
    expect(resultado.markupCustoPercentual).toBeNull();
    expect(Number.isNaN(resultado.margemValor)).toBe(false);
  });

  it('custo zero com receita positiva resulta em markupCustoPercentual null', () => {
    const it1 = item({ quantidade: 1, valor_unitario: 10, valor_mercadoria: 10 });
    const resultado = calcularItem(it1, 0, 'sem custo');
    expect(resultado.markupCustoPercentual).toBeNull();
    expect(resultado.margemVendaPercentual).toBe(100);
  });

  it('totais com receita e custo zero não geram NaN/Infinity', () => {
    const itens = [item({ quantidade: 0, valor_unitario: 0, valor_mercadoria: 0 })];
    const totais = calcularTotais(itens, [0], ['sem custo']);
    expect(totais.margemVendaTotal).toBeNull();
    expect(totais.markupCustoTotal).toBeNull();
    expect(Number.isFinite(totais.margemTotal)).toBe(true);
  });
});

describe('compararComTotalOmie — Caso 6: divergência de total', () => {
  it('não gera alerta quando a diferença é menor ou igual a R$ 0,05', () => {
    expect(compararComTotalOmie(100, 100.05)).toBeNull();
    expect(compararComTotalOmie(100, 99.95)).toBeNull();
  });

  it('gera alerta com receita calculada, total da Omie e diferença quando acima de R$ 0,05', () => {
    const alerta = compararComTotalOmie(100, 110);
    expect(alerta).not.toBeNull();
    expect(alerta?.receitaCalculada).toBe(100);
    expect(alerta?.totalInformadoOmie).toBe(110);
    expect(alerta?.diferenca).toBe(-10);
    expect(alerta?.explicacao).toMatch(/frete/i);
  });
});
