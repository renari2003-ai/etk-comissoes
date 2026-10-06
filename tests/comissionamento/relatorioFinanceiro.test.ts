import { describe, expect, it, vi } from 'vitest';
import { gerarRelatorioFinanceiro, vendedoresParaTitulos } from '../../src/comissionamento/relatorioFinanceiro.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';
import { baixaFinanceiro, clienteFinanceiro, pedidoFinanceiro, tituloFinanceiro } from './financeiroFixture.js';
import { ID_TABELA_001, itemTabela, tabelaPreco } from '../omie/clienteComissionamentoFalso.js';

const periodo = { dataDe: '01/09/2026', dataAte: '30/09/2026' };

describe('Financeiro / Comissão — recebimentos no período', () => {
  it('inclui venda com mais de 12 meses e vencimento fora do período, sem varrer vendas', async () => {
    const cliente = clienteFinanceiro([baixaFinanceiro()]);
    const listar = vi.spyOn(cliente, 'listarPedidosCompletos');
    const resultado = await gerarRelatorioFinanceiro(cliente, periodo);
    expect(listar).not.toHaveBeenCalled();
    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]).toMatchObject({ numeroNotaFiscal: '00025739', dataRecebimento: '10/09/2026', comissaoAPagar: 15 });
    expect(resultado.resumo).toMatchObject({ quantidadePedidos: 1, valorRecebido: 500, comissaoAPagar: 15 });
  });

  it('considera os limites inclusivos e exclui recebimentos de fora, sem pagar parcelas pendentes', async () => {
    const titulos = [tituloFinanceiro(), tituloFinanceiro(11, 500, { statusTitulo: 'A VENCER' })];
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([
      baixaFinanceiro(1, 10, 200, '01/09/2026'), baixaFinanceiro(2, 10, 300, '30/09/2026'),
      baixaFinanceiro(3, 11, 500, '01/10/2026'), baixaFinanceiro(4, 11, 100, '31/08/2026'),
    ], titulos), periodo);
    expect(resultado.linhas).toHaveLength(2);
    expect(resultado.resumo.comissaoAPagar).toBe(15);
    expect(resultado.linhas.map(l => l.comissaoAPagar)).toEqual([6, 9]);
  });

  it('não duplica uma baixa e inclui pagamento parcial mesmo com título ainda aberto', async () => {
    const recebimento = baixaFinanceiro(1, 10, 200);
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([recebimento, recebimento],
      [tituloFinanceiro(10, 500, { statusTitulo: 'A VENCER' }), tituloFinanceiro(11)]), periodo);
    expect(resultado.resumo.comissaoAPagar).toBe(6);
    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.detalhe.parcelas).toHaveLength(1);
  });

  it('retorna zero para vendas sem baixas', async () => {
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([]), periodo);
    expect(resultado.linhas).toEqual([]);
    expect(resultado.resumo.comissaoAPagar).toBe(0);
  });

  it('filtra por NF e recalcula os totais após a busca', async () => {
    const cliente = clienteFinanceiro([baixaFinanceiro(), baixaFinanceiro(2, 11)],
      [tituloFinanceiro(), tituloFinanceiro(11, 500, { numeroNotaFiscal: '00025767' })]);
    const resultado = await gerarRelatorioFinanceiro(cliente, { ...periodo, busca: '25767' });
    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.resumo.valorRecebido).toBe(500);
    expect(resultado.resumo.comissaoAPagar).toBe(15);
  });

  it('consulta e consolida todas as faturas antes do rateio; NF vem do título recebido', async () => {
    const cliente = clienteFinanceiro([baixaFinanceiro(1, 11, 350)], [
      tituloFinanceiro(10, 300, { codigoPedido: 2 }),
      tituloFinanceiro(11, 350, { codigoPedido: 3, numeroNotaFiscal: '00025767' }),
      tituloFinanceiro(12, 350, { codigoPedido: 3, numeroNotaFiscal: '00025767' }),
    ], [pedidoFinanceiro(1, 0), pedidoFinanceiro(2, 300), pedidoFinanceiro(3, 700)]);
    const resultado = await gerarRelatorioFinanceiro(cliente, periodo);
    expect(resultado.linhas[0]).toMatchObject({ numeroNotaFiscal: '00025767', comissaoAPagar: 10.5 });
    expect(resultado.linhas[0]?.detalhe.receitaTotal).toBe(1000);
    expect(cliente.consultasPedido).toHaveLength(3);
  });

  it('exclui fatura cancelada sem retirar comissão das faturas irmãs elegíveis', async () => {
    const cancelada = pedidoFinanceiro(3, 700);
    cancelada.infoCadastro = { ...cancelada.infoCadastro, cancelado: 'S' };
    const cliente = clienteFinanceiro([baixaFinanceiro(1, 10, 300), baixaFinanceiro(2, 11, 700)],
      [tituloFinanceiro(10, 300, { codigoPedido: 2 }), tituloFinanceiro(11, 700, { codigoPedido: 3 })],
      [pedidoFinanceiro(1, 0), pedidoFinanceiro(2, 300), cancelada]);
    const resultado = await gerarRelatorioFinanceiro(cliente, periodo);
    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.resumo.comissaoAPagar).toBe(9);
    expect(resultado.avisos.join(' ')).toContain('Fora da apuração automática');
  });

  it('exclui juros e multa da base recebida e não inventa NF ausente', async () => {
    const baixa = { ...baixaFinanceiro(1, 10, 220), juros: 15, multa: 5 };
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([baixa],
      [tituloFinanceiro(10, 500, { numeroNotaFiscal: null }), tituloFinanceiro(11)]), periodo);
    expect(resultado.linhas[0]).toMatchObject({ valorRecebido: 220, comissaoAPagar: 6, numeroNotaFiscal: null });
  });

  it('respeita restrição de vendedor também se a origem trouxer dados de outro vendedor', async () => {
    const cliente = clienteFinanceiro([baixaFinanceiro()]);
    cliente.listarContasReceberPorVendedor = async () => [tituloFinanceiro(), tituloFinanceiro(11)];
    const resultado = await gerarRelatorioFinanceiro(cliente, { ...periodo, codigosVendedor: [200] });
    expect(resultado.linhas).toEqual([]);
  });

  it('avisa sobre pedidos não consultáveis em vez de calcular comissão incompleta', async () => {
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([baixaFinanceiro()], undefined, []), periodo);
    expect(resultado.linhas).toEqual([]);
    expect(resultado.avisos.join(' ')).toContain('não pôde ser consultado');
  });

  it('valida datas reais, período completo e ordem antes de consultar a Omie', async () => {
    const cliente = clienteFinanceiro([]);
    await expect(gerarRelatorioFinanceiro(cliente, {})).rejects.toThrow('data inicial');
    await expect(gerarRelatorioFinanceiro(cliente, { dataDe: '31/09/2026', dataAte: periodo.dataAte })).rejects.toThrow('inválida');
    await expect(gerarRelatorioFinanceiro(cliente, { dataDe: periodo.dataAte, dataAte: periodo.dataDe })).rejects.toThrow('anterior');
  });
});

describe('Financeiro / Comissão — comissão por tabela de preços (2026-10-06)', () => {
  it('rateio pelo recebido (valores do título do pedido 28, itens FICTÍCIOS): o desconto não libera comissão', async () => {
    // ATENÇÃO: só o título (2.518,78) e o recebido (2.143,75) são do pedido 28 real; o item é fictício
    // (produto de teste a 3%), então os R$ 64,31 daqui NÃO são a comissão real do pedido 28 — essa está
    // no teste seguinte, com os itens reais (R$ 29,02 de comissão, R$ 24,70 a pagar).
    // Título de 2.518,78 baixado com 2.143,75 em dinheiro + 375,03 de desconto (baixa só de desconto
    // é descartada em `normalizarBaixas` — ver tests/omie/recebimentos.test.ts).
    const pedido28 = { ...pedidoFinanceiro(2802, 2518.78), cabecalho: { codigo_pedido: 2802, numero_pedido: '28', etapa: '60', codigo_cliente: 500 } };
    const titulo = tituloFinanceiro(10, 2518.78, { codigoPedido: 2802, numeroPedido: '28', numeroNotaFiscal: '00025770' });
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([baixaFinanceiro(1, 10, 2143.75)], [titulo], [pedido28]), periodo);
    expect(resultado.linhas).toHaveLength(1);
    const [linha] = resultado.linhas;
    // 3% (tabela padrão de teste: vendido bem acima de 1,90) sobre 2.518,78 = 75,5634; recebido 2.143,75/2.518,78
    expect(linha?.detalhe.comissaoTotal).toBeCloseTo(75.56, 2);
    expect(linha?.comissaoAPagar).toBe(64.31);
    expect(linha?.valorRecebido).toBe(2143.75);
    expect(resultado.resumo.comissaoAPagar).toBe(64.31);
  });

  it('itens de taxas diferentes: paga a fração recebida da comissão TOTAL rateada, sem duplicar em baixas parciais', async () => {
    const pedidoMisto = pedidoFinanceiro(1, 1000);
    pedidoMisto.det = [
      { produto: { codigo_produto: 1, codigo: 'P1', descricao: 'Tabela 003', quantidade: 1, valor_unitario: 800, valor_mercadoria: 800 } }, // 3% = 24
      { produto: { codigo_produto: 2, codigo: 'P2', descricao: 'Tabela 001', quantidade: 1, valor_unitario: 200, valor_mercadoria: 200 } }, // 1% = 2
    ];
    const cliente = clienteFinanceiro(
      [baixaFinanceiro(1, 10, 200, '05/09/2026'), baixaFinanceiro(2, 10, 300, '20/09/2026'), baixaFinanceiro(2, 10, 300, '20/09/2026')],
      [tituloFinanceiro(10, 500, { statusTitulo: 'RECEBIDO' }), tituloFinanceiro(11, 500, { statusTitulo: 'A VENCER' })],
      [pedidoMisto],
    );
    cliente.tabelasPreco = [tabelaPreco('001', [itemTabela(2, 82.9)]), tabelaPreco('003', [itemTabela(1, 190)])];
    const resultado = await gerarRelatorioFinanceiro(cliente, periodo);

    expect(resultado.linhas[0]?.detalhe.comissaoTotal).toBe(26);
    // parcela de 500 = 50% do pedido -> 13 de comissão; recebidos 200 e 300 (a baixa repetida conta uma vez)
    expect(resultado.linhas.map((l) => l.comissaoAPagar)).toEqual([5.2, 7.8]);
    expect(resultado.resumo.comissaoAPagar).toBe(13);
    expect(resultado.linhas[0]?.comissaoPercentual).toBe(2.6); // efetivo 26 ÷ 1000, só exibição
  });

  it('pedido sem tabela confiável: recebimentos fora da apuração, com aviso (produto, tabela e motivo) e sem comissão zero', async () => {
    const pedidoSemTabela = pedidoFinanceiro();
    pedidoSemTabela.det = [{ produto: { codigo_produto: 77, codigo: 'PA00000077', descricao: 'Sem tabela', quantidade: 1, valor_unitario: 1000, valor_mercadoria: 1000 } }];
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([baixaFinanceiro()], undefined, [pedidoSemTabela]), periodo);
    expect(resultado.linhas).toEqual([]);
    expect(resultado.resumo.comissaoAPagar).toBe(0);
    expect(resultado.excecoesApuracao).toEqual([expect.objectContaining({ numeroPedido: '154', problemas: [expect.objectContaining({ codigo: 'PA00000077', motivo: 'TABELA_NAO_IDENTIFICADA' })] })]);
    expect(resultado.avisos.join(' ')).toContain('PA00000077 (tabela não identificada)');
    expect(resultado.avisos.join(' ')).toContain('fora da apuração');
  });
});

describe('Financeiro / Comissão — Omie recusando a consulta de títulos (Client-1880 persistente)', () => {
  it('não exclui o vendedor silenciosamente nem devolve total parcial: a falha sobe como erro', async () => {
    const { OmieErroMetodoEmExecucao } = await import('../../src/omie/erros.js');
    const cliente = clienteFinanceiro([baixaFinanceiro()]);
    cliente.listarContasReceberPorVendedor = async (codigo: number) => {
      if (codigo === 200) throw new OmieErroMetodoEmExecucao('A Omie continuou recusando a consulta… após 3 tentativas em 71 s.', 'SOAP-ENV:Client-1880');
      return codigo === 100 ? [tituloFinanceiro(), tituloFinanceiro(11)] : [];
    };
    await expect(gerarRelatorioFinanceiro(cliente, periodo)).rejects.toThrow('após 3 tentativas');
  });
});

describe('Financeiro / Comissão — pedido 28 / NF 00025770 com os itens REAIS (consultados na Omie em 2026-10-06)', () => {
  it('fatura filha válida: PA00000088 na 001 (1%) e PA20000013 na 003 (3%) → R$ 29,02; recebidos R$ 2.143,75 de R$ 2.518,78 → R$ 24,70', async () => {
    const fatura: PedidoOmie = {
      cabecalho: { codigo_pedido: 2426802881, numero_pedido: '28', etapa: '60', codigo_cliente: 500 },
      det: [
        { produto: { codigo_produto: 88, codigo: 'PA00000088', descricao: 'CTOE', quantidade: 10, valor_unitario: 82.9, valor_mercadoria: 829, codigo_tabela_preco: ID_TABELA_001 } },
        { produto: { codigo_produto: 2013, codigo: 'PA20000013', descricao: 'Item 003', quantidade: 10, valor_unitario: 16.34, valor_mercadoria: 163.4, codigo_tabela_preco: 2 } },
        { produto: { codigo_produto: 88, codigo: 'PA00000088', descricao: 'CTOE', quantidade: 12, valor_unitario: 82.9, valor_mercadoria: 994.8, codigo_tabela_preco: ID_TABELA_001 } },
        { produto: { codigo_produto: 2013, codigo: 'PA20000013', descricao: 'Item 003', quantidade: 12, valor_unitario: 16.34, valor_mercadoria: 196.08, codigo_tabela_preco: 2 } },
      ],
      total_pedido: { valor_total_pedido: 2518.78, valor_mercadorias: 2183.28 },
      informacoes_adicionais: { codVend: 100 },
      infoCadastro: { dInc: '01/09/2026', dAlt: '01/09/2026' },
    };
    const titulo = tituloFinanceiro(10, 2518.78, { codigoPedido: 2426802881, numeroPedido: '28', numeroNotaFiscal: '00025770' });
    const cliente = clienteFinanceiro([baixaFinanceiro(1, 10, 2143.75)], [titulo], [fatura]);
    cliente.tabelasPreco = [tabelaPreco('001', [itemTabela(88, 82.9)]), tabelaPreco('003', [itemTabela(2013, 10.4948)])];
    const resultado = await gerarRelatorioFinanceiro(cliente, periodo);
    const [linha] = resultado.linhas;
    expect(linha?.detalhe.composicaoItens?.map((i) => [i.codigo, i.tabelaCodigo, i.comissaoNormalPercentual])).toEqual([
      ['PA00000088', '001', 1], ['PA20000013', '003', 3], ['PA00000088', '001', 1], ['PA20000013', '003', 3],
    ]);
    expect(linha?.detalhe.baseComissao).toBe(2183.28);
    expect(linha?.detalhe.comissaoTotal).toBe(29.02);
    expect(linha?.comissaoPercentual).toBe(1.33);
    expect(linha?.comissaoAPagar).toBe(24.7);
  });
});

describe('Financeiro / Comissão — títulos só dos vendedores presentes nos recebimentos (otimização de 2026-10-06)', () => {
  const doisVendedores = () => [tituloFinanceiro(), tituloFinanceiro(11), tituloFinanceiro(20, 300, { codigoPedido: 9, numeroPedido: '900', codigoVendedor: 200 })];

  it('sem filtro: lê só o vendedor indicado nos movimentos e chega ao MESMO resultado da busca completa', async () => {
    const reduzido = clienteFinanceiro([baixaFinanceiro(1, 10, 500, '10/09/2026', 100)], doisVendedores());
    const completo = clienteFinanceiro([baixaFinanceiro(1, 10, 500, '10/09/2026')], doisVendedores()); // movimento sem vendedor → completa
    const r1 = await gerarRelatorioFinanceiro(reduzido, periodo);
    const r2 = await gerarRelatorioFinanceiro(completo, periodo);
    expect(reduzido.consultasTitulosPorVendedor).toEqual([100]);
    expect(completo.consultasTitulosPorVendedor).toEqual([100, 200]);
    expect(r1.linhas.map((l) => [l.codigoBaixa, l.comissaoAPagar])).toEqual(r2.linhas.map((l) => [l.codigoBaixa, l.comissaoAPagar]));
    expect(r1.resumo).toEqual(r2.resumo);
  });

  it('movimento com vendedor fora da lista conhecida → busca completa', async () => {
    const cliente = clienteFinanceiro([baixaFinanceiro(1, 10, 500, '10/09/2026', 999)], doisVendedores());
    await gerarRelatorioFinanceiro(cliente, periodo);
    expect(cliente.consultasTitulosPorVendedor).toEqual([100, 200]);
  });

  it('divergência (movimento diz 200, título é do 100): não acha o título e completa a busca — o recebimento não some', async () => {
    const cliente = clienteFinanceiro([baixaFinanceiro(1, 10, 500, '10/09/2026', 200)], doisVendedores());
    const resultado = await gerarRelatorioFinanceiro(cliente, periodo);
    expect(cliente.consultasTitulosPorVendedor).toEqual([200, 100]);
    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.resumo.comissaoAPagar).toBe(15);
  });

  it('com filtro explícito de vendedores lê todos os filtrados, como antes', async () => {
    const cliente = clienteFinanceiro([baixaFinanceiro(1, 10, 500, '10/09/2026', 100)], doisVendedores());
    await gerarRelatorioFinanceiro(cliente, { ...periodo, codigosVendedor: [100, 200] });
    expect(cliente.consultasTitulosPorVendedor).toEqual([100, 200]);
  });

  it('vendedoresParaTitulos: regras de retorno à lista completa', () => {
    expect(vendedoresParaTitulos([{ codigoVendedor: 2 }, { codigoVendedor: 2 }], [1, 2, 3], false)).toEqual([2]);
    expect(vendedoresParaTitulos([{ codigoVendedor: 2 }, { codigoVendedor: null }], [1, 2, 3], false)).toEqual([1, 2, 3]);
    expect(vendedoresParaTitulos([{}], [1, 2, 3], false)).toEqual([1, 2, 3]);
    expect(vendedoresParaTitulos([{ codigoVendedor: 9 }], [1, 2, 3], false)).toEqual([1, 2, 3]);
    expect(vendedoresParaTitulos([{ codigoVendedor: 2 }], [1, 2, 3], true)).toEqual([1, 2, 3]);
    expect(vendedoresParaTitulos([], [1, 2, 3], false)).toEqual([]);
  });
});
