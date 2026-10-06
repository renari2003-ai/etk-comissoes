import { describe, expect, it } from 'vitest';
import { determinarComissaoNormal } from '../../src/comissionamento/calcularComissao.js';
import { apurarComissaoPorTabela, resolverTabelaDoItem } from '../../src/comissionamento/comissaoPorTabela.js';
import type { ItemLinhaRelatorio } from '../../src/relatorio/relatorioVendas.js';
import { ID_TABELA_001, ID_TABELA_002, ID_TABELA_003, itemTabela, tabelaPreco } from '../omie/clienteComissionamentoFalso.js';


function item(overrides: Partial<ItemLinhaRelatorio> & { codigoProduto: number }): ItemLinhaRelatorio {
  const quantidade = overrides.quantidade ?? 1;
  const valorMercadoria = overrides.valorMercadoria ?? 100 * quantidade;
  return {
    codigo: `PA${overrides.codigoProduto}`,
    descricao: `Produto ${overrides.codigoProduto}`,
    quantidade,
    receita: valorMercadoria,
    valorMercadoria,
    valorDesconto: 0,
    codigoTabelaPreco: null,
    ...overrides,
  };
}

/** Item único vendido a `preco` numa tabela 003 (×1,90) com Preço da Tabela = 190 → custo de referência 100. */
function apurarMultiplicador(precoUnitario: number, codigoTabela: '002' | '003' = '003', precoTabela = 190) {
  const tabelas = [tabelaPreco(codigoTabela, [itemTabela(1, precoTabela)])];
  return apurarComissaoPorTabela([item({ codigoProduto: 1, valorMercadoria: precoUnitario })], tabelas, 'João');
}

function composicao(resultado: ReturnType<typeof apurarComissaoPorTabela>) {
  if (!resultado.ok) throw new Error(`esperava apuração válida: ${JSON.stringify(resultado.problemas)}`);
  return resultado;
}

describe('progressão pelo multiplicador realizado (exemplos obrigatórios — regra de 2026-10-06)', () => {
  // custo de referência = 190 ÷ 1,90 = 100 → preço vendido = multiplicador × 100
  it.each([
    [170, 70, 1],
    [175, 75, 1.5],
    [177, 77, 1.7],
    [180, 80, 2],
    [184.21, 84.21, 2.421],
    [185, 85, 2.5],
    [190, 90, 3],
    [250, 150, 3],
    [120, 20, 1],
  ])('vendido a %s (custo ref. 100) → acréscimo %s%% → comissão %s%%', (preco, acrescimo, comissao) => {
    const r = composicao(apurarMultiplicador(preco));
    const [i] = r.itens;
    expect(i?.custoReferencia).toBeCloseTo(100, 10);
    expect(i?.multiplicadorRealizado).toBeCloseTo(preco / 100, 10);
    expect(i?.acrescimoPercentual).toBeCloseTo(acrescimo, 8);
    expect(i?.comissaoNormalPercentual).toBeCloseTo(comissao, 8);
    expect(r.comissaoTotal).toBeCloseTo(preco * (comissao / 100), 8);
  });

  it('1,8421 → 2,421% sem arredondar o percentual antes do valor (exibido como 2,42%)', () => {
    const r = composicao(apurarMultiplicador(184.21));
    expect(r.itens[0]?.comissaoNormalPercentual).toBeCloseTo(2.421, 10);
    expect(r.comissaoTotal).toBeCloseTo(184.21 * 0.02421, 10); // 4,4597… — nunca 184,21 × 2,42%
    expect(determinarComissaoNormal(84.21)).toBeCloseTo(2.421, 10);
  });

  it('limites exatos: 1,6999 ainda 1%; 1,70 = 1%; logo abaixo de 1,90 < 3%; 1,90 = 3%', () => {
    expect(composicao(apurarMultiplicador(169.99)).itens[0]?.comissaoNormalPercentual).toBe(1);
    expect(composicao(apurarMultiplicador(170)).itens[0]?.comissaoNormalPercentual).toBeCloseTo(1, 10);
    expect(composicao(apurarMultiplicador(189.99)).itens[0]?.comissaoNormalPercentual).toBeLessThan(3);
    expect(composicao(apurarMultiplicador(189.99)).itens[0]?.comissaoNormalPercentual).toBeCloseTo(2.999, 8);
    expect(composicao(apurarMultiplicador(190)).itens[0]?.comissaoNormalPercentual).toBe(3);
  });

  it('tabela 002 vendida pelo preço cheio → multiplicador 1,75 → 1,50%', () => {
    const r = composicao(apurarMultiplicador(141.04, '002', 141.04));
    expect(r.itens[0]?.multiplicadorTabela).toBe(1.75);
    expect(r.itens[0]?.multiplicadorRealizado).toBeCloseTo(1.75, 10);
    expect(r.itens[0]?.comissaoNormalPercentual).toBeCloseTo(1.5, 10);
  });

  it('tabela 003 vendida pelo preço cheio → multiplicador 1,90 → 3%', () => {
    const r = composicao(apurarMultiplicador(116.72, '003', 116.72));
    expect(r.itens[0]?.multiplicadorRealizado).toBeCloseTo(1.9, 10);
    expect(r.itens[0]?.comissaoNormalPercentual).toBe(3);
  });
});

describe('base do item: quantidade, descontos e itens múltiplos', () => {
  it('usa valor de mercadoria − desconto como base e o preço unitário líquido no multiplicador', () => {
    // 10 un. a 190 = 1900 bruto, desconto 100 → 1800 líquido → 180/un. → multiplicador 1,80 → 2%
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190)])];
    const r = composicao(
      apurarComissaoPorTabela([item({ codigoProduto: 1, quantidade: 10, valorMercadoria: 1900, valorDesconto: 100 })], tabelas, 'João'),
    );
    expect(r.itens[0]?.precoUnitarioVendido).toBeCloseTo(180, 10);
    expect(r.itens[0]?.comissaoNormalPercentual).toBeCloseTo(2, 10);
    expect(r.baseComissao).toBe(1800);
    expect(r.comissaoTotal).toBeCloseTo(36, 10);
  });

  it('soma itens de tabelas e taxas diferentes (001 fixa, 002 e 003 por multiplicador)', () => {
    const tabelas = [
      tabelaPreco('001', [itemTabela(1, 82.9)]),
      tabelaPreco('002', [itemTabela(2, 175)]), // custo ref. 100
      tabelaPreco('003', [itemTabela(3, 190)]), // custo ref. 100
    ];
    const r = composicao(
      apurarComissaoPorTabela(
        [
          item({ codigoProduto: 1, quantidade: 2, valorMercadoria: 160 }), // 1% fixo → 1,60
          item({ codigoProduto: 2, quantidade: 3, valorMercadoria: 540 }), // 180/un. → 1,80 → 2% → 10,80
          item({ codigoProduto: 3, quantidade: 1, valorMercadoria: 175 }), // 1,75 → 1,5% → 2,625
        ],
        tabelas,
        'João',
      ),
    );
    expect(r.itens.map((i) => i.tabelaCodigo)).toEqual(['001', '002', '003']);
    expect(r.itens[0]?.regra).toBe('FIXA');
    expect(r.itens[0]?.precoTabela).toBeNull();
    expect(r.itens.map((i) => i.comissaoValor)).toEqual([expect.closeTo(1.6, 10), expect.closeTo(10.8, 10), expect.closeTo(2.625, 10)]);
    expect(r.comissaoTotal).toBeCloseTo(15.025, 10);
    expect(r.baseComissao).toBe(875);
  });

  it('ignora itens zerados (registro original de faturamento parcial) sem exigir tabela deles', () => {
    const r = composicao(
      apurarComissaoPorTabela(
        [item({ codigoProduto: 77, quantidade: 0, valorMercadoria: 0 }), item({ codigoProduto: 1, valorMercadoria: 190 })],
        [tabelaPreco('003', [itemTabela(1, 190)])],
        'João',
      ),
    );
    expect(r.itens).toHaveLength(1);
  });
});

describe('adicional do vendedor (Sandro, Horacio, Roberto Rocha)', () => {
  it('soma +1% em cada item, inclusive na tabela 001 — nunca altera a comissão normal', () => {
    const tabelas = [tabelaPreco('001', [itemTabela(1, 82.9)]), tabelaPreco('003', [itemTabela(2, 190)])];
    for (const nome of ['Sandro Cedro', 'HORÁCIO', 'Roberto Rocha']) {
      const r = composicao(
        apurarComissaoPorTabela(
          [item({ codigoProduto: 1, valorMercadoria: 100 }), item({ codigoProduto: 2, valorMercadoria: 180 })],
          tabelas,
          nome,
        ),
      );
      expect(r.itens.map((i) => [i.comissaoNormalPercentual, i.adicionalVendedorPercentual, i.comissaoFinalPercentual])).toEqual([
        [1, 1, 2],
        [expect.closeTo(2, 10), 1, expect.closeTo(3, 10)],
      ]);
      expect(r.comissaoNormalValor).toBeCloseTo(1 + 3.6, 10);
      expect(r.comissaoTotal).toBeCloseTo(2 + 5.4, 10);
    }
  });

  it('teto de 3% vale só para a comissão normal: com adicional chega a 4%', () => {
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190)])];
    const r = composicao(apurarComissaoPorTabela([item({ codigoProduto: 1, valorMercadoria: 300 })], tabelas, 'Sandro'));
    expect(r.itens[0]?.comissaoFinalPercentual).toBe(4);
  });
});

describe('identificação da tabela do item (decisão de 2026-10-06)', () => {
  const tabelas = [
    tabelaPreco('001', [itemTabela(10, 82.9)]),
    tabelaPreco('002', [itemTabela(20, 175)]),
    tabelaPreco('003', [itemTabela(30, 190)]),
  ];

  it('codigo_tabela_preco = ID interno da tabela que contém o produto → ID_INTERNO', () => {
    const r = resolverTabelaDoItem(item({ codigoProduto: 30, codigoTabelaPreco: ID_TABELA_003 }), tabelas);
    expect(r).toMatchObject({ origem: 'ID_INTERNO', tabela: { codigoComercial: '003' } });
  });

  it('ID interno de uma tabela que NÃO contém o produto → exceção (nunca troca de tabela)', () => {
    const r = resolverTabelaDoItem(item({ codigoProduto: 30, codigoTabelaPreco: ID_TABELA_002 }), tabelas);
    expect(r).toMatchObject({ motivo: 'PRODUTO_FORA_DA_TABELA_INFORMADA' });
  });

  it('código comercial que corresponde à tabela do produto (2 → 002) → CODIGO_COMERCIAL', () => {
    const r = resolverTabelaDoItem(item({ codigoProduto: 20, codigoTabelaPreco: 2 }), tabelas);
    expect(r).toMatchObject({ origem: 'CODIGO_COMERCIAL', tabela: { codigoComercial: '002' } });
  });

  it('código 2 para produto que só está na 003 → sem correspondência válida → única tabela do produto', () => {
    const r = resolverTabelaDoItem(item({ codigoProduto: 30, codigoTabelaPreco: 2 }), tabelas);
    expect(r).toMatchObject({ origem: 'UNICA_TABELA_DO_PRODUTO', tabela: { codigoComercial: '003' } });
  });

  it('sem codigo_tabela_preco → única tabela ativa que contém o produto', () => {
    expect(resolverTabelaDoItem(item({ codigoProduto: 10 }), tabelas)).toMatchObject({ origem: 'UNICA_TABELA_DO_PRODUTO', tabela: { codigoComercial: '001' } });
  });

  it('produto em nenhuma tabela → exceção', () => {
    expect(resolverTabelaDoItem(item({ codigoProduto: 99, codigoTabelaPreco: 2 }), tabelas)).toMatchObject({ motivo: 'TABELA_NAO_IDENTIFICADA', tabela: null });
  });

  it('produto em várias tabelas ativas sem indicação válida → exceção, nunca escolhe uma', () => {
    const duplicadas = [tabelaPreco('002', [itemTabela(5, 175)]), tabelaPreco('003', [itemTabela(5, 190)])];
    const r = resolverTabelaDoItem(item({ codigoProduto: 5, codigoTabelaPreco: 1 }), duplicadas);
    expect(r).toMatchObject({ motivo: 'TABELA_AMBIGUA' });
    // …mas o ID interno explícito resolve a ambiguidade.
    expect(resolverTabelaDoItem(item({ codigoProduto: 5, codigoTabelaPreco: ID_TABELA_002 }), duplicadas)).toMatchObject({ origem: 'ID_INTERNO' });
  });

  it('tabela inativa não é usada pelo pertencimento; indicada por ID interno vira exceção', () => {
    const comInativa = [tabelaPreco('003', [itemTabela(30, 190)], { ativa: false })];
    expect(resolverTabelaDoItem(item({ codigoProduto: 30 }), comInativa)).toMatchObject({ motivo: 'TABELA_NAO_IDENTIFICADA' });
    expect(resolverTabelaDoItem(item({ codigoProduto: 30, codigoTabelaPreco: ID_TABELA_003 }), comInativa)).toMatchObject({ motivo: 'TABELA_INATIVA' });
  });

  it('identifica tabela pelo código comercial, nunca pelo nome', () => {
    const renomeada = [tabelaPreco('001', [itemTabela(10, 82.9)], { nome: 'CTO SLIM' })];
    const r = composicao(apurarComissaoPorTabela([item({ codigoProduto: 10 })], renomeada, 'João'));
    expect(r.itens[0]).toMatchObject({ regra: 'FIXA', comissaoNormalPercentual: 1, tabelaNome: 'CTO SLIM' });
    expect(ID_TABELA_001).toBe(2400087453);
  });
});

describe('dados necessários ausentes ou inválidos → pedido inteiro fora da apuração', () => {
  function problemas(resultado: ReturnType<typeof apurarComissaoPorTabela>) {
    if (resultado.ok) throw new Error('esperava exceção');
    return resultado.problemas;
  }

  it('Preço da Tabela ausente ou zero', () => {
    for (const preco of [null, 0]) {
      const [p] = problemas(apurarComissaoPorTabela([item({ codigoProduto: 1 })], [tabelaPreco('003', [itemTabela(1, preco)])], 'João'));
      expect(p).toMatchObject({ motivo: 'PRECO_TABELA_AUSENTE', codigo: 'PA1', tabela: '003 — TABELA DE VENDA - 07/26' });
    }
  });

  it('tabela sem regra (ex.: nova 004) não é tratada por suposição', () => {
    const [p] = problemas(apurarComissaoPorTabela([item({ codigoProduto: 1 })], [tabelaPreco('004', [itemTabela(1, 190)])], 'João'));
    expect(p?.motivo).toBe('TABELA_SEM_REGRA');
  });

  it('item da tabela alterado depois da venda → calcula com o Preço da Tabela ATUAL (decisão de 2026-10-06), sem bloqueio', () => {
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190, '05/10/2026', '10:28:09')], { dataAlteracao: '05/10/2026', horaAlteracao: '10:30:00' })];
    const r = composicao(apurarComissaoPorTabela([item({ codigoProduto: 1, valorMercadoria: 190 })], tabelas, 'João'));
    expect(r.itens[0]).toMatchObject({
      referencia: 'PRECO_ATUAL_TABELA_ATIVA',
      precoTabela: 190,
      comissaoNormalPercentual: 3,
      itemAlteradoEm: '05/10/2026 10:28:09',
      tabelaAlteradaEm: '05/10/2026 10:30:00',
    });
  });

  it('datas de alteração ausentes (item e tabela) não bloqueiam quando os demais dados são válidos', () => {
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190, null as unknown as string, null)], { dataAlteracao: null, horaAlteracao: null })];
    const r = composicao(apurarComissaoPorTabela([item({ codigoProduto: 1, valorMercadoria: 180 })], tabelas, 'João'));
    expect(r.itens[0]).toMatchObject({ itemAlteradoEm: null, tabelaAlteradaEm: null, comissaoNormalPercentual: expect.closeTo(2, 10) });
  });

  it('não existe mais motivo de exceção por data', () => {
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190, '31/12/2099', '23:59:59')], { dataAlteracao: '31/12/2099', horaAlteracao: null })];
    expect(apurarComissaoPorTabela([item({ codigoProduto: 1 })], tabelas, 'João').ok).toBe(true);
  });

  it('tabela 001 (comissão fixa) não depende de preço nem de data', () => {
    const tabelas = [tabelaPreco('001', [itemTabela(1, null, '05/10/2026')])];
    const r = apurarComissaoPorTabela([item({ codigoProduto: 1 })], tabelas, 'João');
    expect(r.ok).toBe(true);
  });

  it('lista TODOS os itens com problema, mesmo com outros itens válidos (nunca comissão parcial)', () => {
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190), itemTabela(2, 0)])];
    const r = apurarComissaoPorTabela(
      [item({ codigoProduto: 1 }), item({ codigoProduto: 2 }), item({ codigoProduto: 3 })],
      tabelas,
      'João',
    );
    expect(problemas(r).map((p) => [p.codigoProduto, p.motivo])).toEqual([
      [2, 'PRECO_TABELA_AUSENTE'],
      [3, 'TABELA_NAO_IDENTIFICADA'],
    ]);
  });

  it('desconto maior que a mercadoria ou quantidade inválida → item inválido', () => {
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190)])];
    expect(problemas(apurarComissaoPorTabela([item({ codigoProduto: 1, valorMercadoria: 100, valorDesconto: 101 })], tabelas, 'João'))[0]?.motivo).toBe('ITEM_INVALIDO');
    expect(problemas(apurarComissaoPorTabela([item({ codigoProduto: 1, quantidade: 0, valorMercadoria: 100 })], tabelas, 'João'))[0]?.motivo).toBe('ITEM_INVALIDO');
  });
});

describe('pedido 207 (dados reais consultados na Omie em 2026-10-06)', () => {
  it('PA00000001, 50 × R$ 130,00, codigo_tabela_preco 2 → tabela 003 (única do produto), Preço da Tabela 116,72 → 3% = R$ 195,00', () => {
    // Tabelas reais: o produto 2387115720 só consta na 003 (nValorTabela 116,72, alterado em
    // 26/06/2026 15:39:46). "2" coincide com o código comercial 002, mas o produto não está nela.
    const tabelas = [
      // Datas de alteração reais das TABELAS (info.dAlt/hAlt): 001 09/06, 002 10/09, 003 27/08/2026 10:55:09.
      tabelaPreco('001', [itemTabela(2389175097, 82.9, '09/06/2026', '16:06:33')], { dataAlteracao: '09/06/2026', horaAlteracao: '16:09:16' }),
      tabelaPreco('002', [itemTabela(2389175149, 141.04, '19/08/2026', '14:16:52')], { dataAlteracao: '10/09/2026', horaAlteracao: '14:36:34' }),
      tabelaPreco('003', [itemTabela(2387115720, 116.72, '26/06/2026', '15:39:46')], { dataAlteracao: '27/08/2026', horaAlteracao: '10:55:09' }),
    ];
    const r = composicao(
      apurarComissaoPorTabela(
        [item({ codigoProduto: 2387115720, codigo: 'PA00000001', quantidade: 50, valorMercadoria: 6500, valorDesconto: 0, codigoTabelaPreco: 2 })],
        tabelas,
        'Vendedor do pedido 207',
      ),
    );
    const [i] = r.itens;
    expect(i).toMatchObject({ tabelaCodigo: '003', origemTabela: 'UNICA_TABELA_DO_PRODUTO', precoTabela: 116.72, precoUnitarioVendido: 130 });
    expect(i?.custoReferencia).toBeCloseTo(61.431579, 6);
    expect(i?.multiplicadorRealizado).toBeCloseTo(2.116175, 6); // 130 ÷ 61,431579
    expect(i?.comissaoNormalPercentual).toBe(3);
    expect(r.baseComissao).toBe(6500); // IPI 487,50 e frete 689,00 ficam fora da base
    expect(r.comissaoTotal).toBeCloseTo(195, 10);
  });
});

describe('ruído de ponto flutuante nos limites (preço cheio da tabela)', () => {
  // Preços reais de "Preço da Tabela" consultados em 2026-10-06, mais uma varredura de centavos.
  const reais003 = [116.72, 124.5, 125.4368, 127.6117, 124.3163, 125.655, 7.5376, 16.2244, 11.4152, 117.384, 10.6753];
  const reais002 = [141.04, 153.21, 148.24, 149.61, 150.79, 195.39];
  const varredura = Array.from({ length: 2000 }, (_, i) => Math.round((0.37 + i * 1.13) * 100) / 100);

  it('vender exatamente pelo Preço da Tabela 003 dá sempre 3% (nunca 2,9999…%)', () => {
    for (const preco of [...reais003, ...varredura]) {
      const r = composicao(apurarMultiplicador(preco, '003', preco));
      expect(r.itens[0]?.comissaoNormalPercentual, String(preco)).toBe(3);
    }
  });

  it('vender exatamente pelo Preço da Tabela 002 dá sempre 1,50%', () => {
    for (const preco of [...reais002, ...varredura]) {
      const r = composicao(apurarMultiplicador(preco, '002', preco));
      expect(r.itens[0]?.comissaoNormalPercentual, String(preco)).toBeCloseTo(1.5, 9);
    }
  });

  it('quantidade × preço com centavos (valor de mercadoria ÷ quantidade) continua exato no limite', () => {
    for (const quantidade of [3, 7, 50, 333]) {
      const preco = 116.72;
      const tabelas = [tabelaPreco('003', [itemTabela(1, preco)])];
      const r = composicao(
        apurarComissaoPorTabela([item({ codigoProduto: 1, quantidade, valorMercadoria: Math.round(quantidade * preco * 100) / 100 })], tabelas, 'João'),
      );
      expect(r.itens[0]?.comissaoNormalPercentual, String(quantidade)).toBe(3);
    }
  });
});

describe('referência = PREÇO ATUAL da tabela ativa (decisão de 2026-10-06, substitui o bloqueio por data)', () => {
  const MOMENTO = '2026-10-06T15:00:00.000Z';

  it('registra tabela usada (ID, código), preço atual, multiplicador, custo, momento da consulta e da apuração', () => {
    const tabela = tabelaPreco('003', [itemTabela(1, 116.72, '27/08/2026', '10:36:07')], {
      dataAlteracao: '27/08/2026',
      horaAlteracao: '10:55:09',
      consultadoEm: '2026-10-06T14:55:00.000Z',
    });
    const r = composicao(apurarComissaoPorTabela([item({ codigoProduto: 1, quantidade: 50, valorMercadoria: 6500 })], [tabela], 'João', MOMENTO));
    expect(r.itens[0]).toMatchObject({
      tabelaId: ID_TABELA_003,
      tabelaCodigo: '003',
      referencia: 'PRECO_ATUAL_TABELA_ATIVA',
      precoTabela: 116.72,
      multiplicadorTabela: 1.9,
      precoConsultadoEm: '2026-10-06T14:55:00.000Z',
      apuradoEm: MOMENTO,
    });
    expect(r.itens[0]?.custoReferencia).toBeCloseTo(61.4316, 4);
  });

  it('venda antiga com tabela alterada depois (ex.: 27/08) é apurada pelo preço atual — nunca chamado de histórico', () => {
    const tabela = tabelaPreco('003', [itemTabela(1, 190, '27/08/2026', '10:36:07')], { dataAlteracao: '27/08/2026', horaAlteracao: '10:55:09' });
    const r = composicao(apurarComissaoPorTabela([item({ codigoProduto: 1, valorMercadoria: 175 })], [tabela], 'João', MOMENTO));
    expect(r.itens[0]?.referencia).toBe('PRECO_ATUAL_TABELA_ATIVA');
    expect(r.itens[0]?.comissaoNormalPercentual).toBeCloseTo(1.5, 10);
    expect(JSON.stringify(r)).not.toMatch(/hist[oó]ric/i);
  });

  it('tabela 001 (comissão fixa) não depende de preço nem de nenhuma data — inclusive com adicional (1% + 1 = 2%)', () => {
    const tabela001 = tabelaPreco('001', [itemTabela(1, null, null as unknown as string, null)], { dataAlteracao: null, horaAlteracao: null });
    for (const [nome, final] of [['João', 1], ['Sandro', 2], ['Horacio', 2], ['Roberto Rocha', 2]] as const) {
      const r = composicao(apurarComissaoPorTabela([item({ codigoProduto: 1, valorMercadoria: 100 })], [tabela001], nome, MOMENTO));
      expect(r.itens[0]).toMatchObject({ regra: 'FIXA', referencia: 'COMISSAO_FIXA_DA_TABELA', precoTabela: null, comissaoNormalPercentual: 1, comissaoFinalPercentual: final });
      expect(r.comissaoTotal).toBeCloseTo(final, 10);
    }
  });

  it('a lista de vendedores com adicional não foi ampliada', () => {
    const r = composicao(apurarComissaoPorTabela([item({ codigoProduto: 1, valorMercadoria: 100 })], [tabelaPreco('001', [itemTabela(1, 82.9)])], 'Renata Sandrini'));
    // "sandro" não é trecho de "sandrini" — comparação por trecho do nome configurado, como sempre foi
    expect(r.itens[0]?.adicionalVendedorPercentual).toBe(0);
  });

  it('tabela INATIVA nunca é usada (nem como única tabela do produto); 004 ativa exige regra explícita', () => {
    const inativa = tabelaPreco('003', [itemTabela(1, 190)], { ativa: false });
    const resultadoInativa = apurarComissaoPorTabela([item({ codigoProduto: 1 })], [inativa], 'João');
    expect(resultadoInativa.ok).toBe(false);
    if (!resultadoInativa.ok) expect(resultadoInativa.problemas[0]?.motivo).toBe('TABELA_NAO_IDENTIFICADA');

    const nova = tabelaPreco('004', [itemTabela(1, 190)], { nome: 'TABELA DE VENDA - 10/26' }); // nome parecido com a 003: não herda regra
    const resultadoNova = apurarComissaoPorTabela([item({ codigoProduto: 1 })], [nova], 'João');
    expect(resultadoNova.ok).toBe(false);
    if (!resultadoNova.ok) expect(resultadoNova.problemas[0]).toMatchObject({ motivo: 'TABELA_SEM_REGRA', tabela: '004 — TABELA DE VENDA - 10/26' });
  });

  it('produto em 003 e numa 004 ativa ao mesmo tempo → ambígua (nunca escolhe a que tem regra)', () => {
    const r = apurarComissaoPorTabela([item({ codigoProduto: 1 })], [tabelaPreco('003', [itemTabela(1, 190)]), tabelaPreco('004', [itemTabela(1, 200)])], 'João');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]?.motivo).toBe('TABELA_AMBIGUA');
  });

  it('preço inválido (negativo) na 002 bloqueia; na 001 não é exigido', () => {
    const r = apurarComissaoPorTabela([item({ codigoProduto: 1 })], [tabelaPreco('002', [itemTabela(1, -5)])], 'João');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]?.motivo).toBe('PRECO_TABELA_AUSENTE');
    expect(apurarComissaoPorTabela([item({ codigoProduto: 1 })], [tabelaPreco('001', [itemTabela(1, -5)])], 'João').ok).toBe(true);
  });
});

describe('produto PA50000048 — pedidos 12 e 17 (dados reais consultados em 2026-10-06, após correção do preço)', () => {
  // Preço corrigido pelo usuário na Omie: 14,72 na tabela 003, item alterado em 06/10/2026 10:32:36 —
  // DEPOIS das vendas (17/07/2026). Pela decisão de 2026-10-06 isso não bloqueia mais.
  const tabelas = [
    tabelaPreco('003', [itemTabela(2389175621, 14.72, '06/10/2026', '10:32:36')], { dataAlteracao: '27/08/2026', horaAlteracao: '10:55:09' }),
  ];
  const pa48 = (quantidade: number, valorMercadoria: number) =>
    item({ codigoProduto: 2389175621, codigo: 'PA50000048', quantidade, valorMercadoria, codigoTabelaPreco: 2 });

  it('pedido 12: 3.500 × 13,311708 → multiplicador 1,7182 → 1,1822% → R$ 550,81', () => {
    const r = composicao(apurarComissaoPorTabela([pa48(3500, 46590.98)], tabelas, 'Nelson Pinto'));
    expect(r.itens[0]).toMatchObject({ tabelaCodigo: '003', origemTabela: 'UNICA_TABELA_DO_PRODUTO', referencia: 'PRECO_ATUAL_TABELA_ATIVA', itemAlteradoEm: '06/10/2026 10:32:36' });
    expect(r.itens[0]?.custoReferencia).toBeCloseTo(7.747368, 6);
    expect(r.itens[0]?.multiplicadorRealizado).toBeCloseTo(1.718223, 6);
    expect(r.itens[0]?.comissaoNormalPercentual).toBeCloseTo(1.182233, 6);
    expect(r.itens[0]?.adicionalVendedorPercentual).toBe(0); // "Nelson Pinto" não é Renato Pinto nem vendedor com adicional
    expect(Math.round(r.comissaoTotal * 100) / 100).toBe(550.81);
  });

  it('pedido 17: 3.000 × 14,13318 → multiplicador 1,8243 → 2,2426% → R$ 950,83', () => {
    const r = composicao(apurarComissaoPorTabela([pa48(3000, 42399.54)], tabelas, 'Nelson Pinto'));
    expect(r.itens[0]?.multiplicadorRealizado).toBeCloseTo(1.824256, 6);
    expect(r.itens[0]?.comissaoNormalPercentual).toBeCloseTo(2.242556, 6);
    expect(Math.round(r.comissaoTotal * 100) / 100).toBe(950.83);
  });
});
