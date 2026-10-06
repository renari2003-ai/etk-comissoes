import { describe, expect, it } from 'vitest';
import { gerarRelatorioComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import { ClienteComissionamentoOmieFalso, ID_TABELA_003, itemTabela, tabelaPreco } from '../omie/clienteComissionamentoFalso.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';
import type { ClienteInfo, VendedorInfo } from '../../src/relatorio/relatorioVendas.js';
import type { TituloContaReceber } from '../../src/omie/cliente.js';

function pedido(overrides: {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  codigoCliente: number;
  codVend?: number;
  quantidade: number;
  valorUnitario: number;
  valorMercadoria: number;
  /** Valor bruto da venda (total_pedido.valor_total_pedido). Default = valorMercadoria (sem despesas). */
  valorTotalPedido?: number;
  /** total_pedido.valor_IPI — único imposto somado "por fora" junto com valor_st (ver TotalPedidoOmie). Default 0. */
  valorIPI?: number;
  /** total_pedido.valor_st (ICMS-ST). Default 0. */
  valorIcmsSt?: number;
  valorFrete?: number;
  valorSeguro?: number;
  outrasDespesas?: number;
  /** ICMS/PIS/COFINS/IBS/CBS embutidos no valor dos produtos — apenas informativo (nunca somam ao total). */
  impostosEmbutidos?: { icms?: number; pis?: number; cofins?: number; ibs?: number; cbs?: number };
  codigoProduto?: number;
  valorDesconto?: number;
  codigoTabelaPreco?: number;
  /** Inclusão do pedido na Omie (`infoCadastro.dInc`). Só informativa para a comissão desde 2026-10-06 (não bloqueia). */
  dataInclusao?: string;
}): PedidoOmie {
  const codigoProduto = overrides.codigoProduto ?? 1;
  return {
    cabecalho: {
      codigo_pedido: overrides.codigoPedido,
      numero_pedido: overrides.numeroPedido,
      etapa: overrides.etapa,
      codigo_cliente: overrides.codigoCliente,
    },
    det: [
      {
        produto: {
          codigo_produto: codigoProduto,
          codigo: `P${codigoProduto}`,
          descricao: `Produto ${codigoProduto}`,
          quantidade: overrides.quantidade,
          valor_unitario: overrides.valorUnitario,
          valor_mercadoria: overrides.valorMercadoria,
          ...(overrides.valorDesconto !== undefined ? { valor_desconto: overrides.valorDesconto } : {}),
          ...(overrides.codigoTabelaPreco !== undefined ? { codigo_tabela_preco: overrides.codigoTabelaPreco } : {}),
        },
      },
    ],
    total_pedido: {
      valor_total_pedido: overrides.valorTotalPedido ?? overrides.valorMercadoria,
      valor_mercadorias: overrides.valorMercadoria,
      valor_IPI: overrides.valorIPI ?? 0,
      valor_st: overrides.valorIcmsSt ?? 0,
      valor_icms: overrides.impostosEmbutidos?.icms ?? 0,
      valor_pis: overrides.impostosEmbutidos?.pis ?? 0,
      valor_cofins: overrides.impostosEmbutidos?.cofins ?? 0,
      valor_ibs: overrides.impostosEmbutidos?.ibs ?? 0,
      valor_cbs: overrides.impostosEmbutidos?.cbs ?? 0,
    },
    informacoes_adicionais: overrides.codVend !== undefined ? { codVend: overrides.codVend } : {},
    frete: {
      valor_frete: overrides.valorFrete ?? 0,
      valor_seguro: overrides.valorSeguro ?? 0,
      outras_despesas: overrides.outrasDespesas ?? 0,
    },
    infoCadastro: { dInc: overrides.dataInclusao ?? '01/06/2026', hInc: '10:00:00' },
  };
}

/** Produto 1 na tabela 003 com o Preço da Tabela informado (custo de referência = preço ÷ 1,90). */
function tabelas003(precoTabela: number, codigoProduto = 1) {
  return [tabelaPreco('001', []), tabelaPreco('002', []), tabelaPreco('003', [itemTabela(codigoProduto, precoTabela)])];
}

const VENDEDORES: VendedorInfo[] = [{ codigo: 100, nome: 'João', inativo: false }];
const CLIENTES = new Map<number, ClienteInfo>([[500, { codigo: 500, razaoSocial: 'Cliente 500', nomeFantasia: 'Cliente 500' }]]);

describe('gerarRelatorioComissionamento — separação Pedido vs Orçamento (regra crítica)', () => {
  it('nunca calcula comissão sobre um orçamento, mesmo com margem de comissionamento alta', async () => {
    const orcamento = pedido({
      codigoPedido: 20,
      numeroPedido: '20',
      etapa: '00',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 100,
      valorUnitario: 100,
      valorMercadoria: 10000,
      valorTotalPedido: 10000, // sem despesas -> margem 100%, faixa 3% se fosse (indevidamente) considerado
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([orcamento], VENDEDORES, CLIENTES, estoques, new Map());

    const resultado = await gerarRelatorioComissionamento(cliente, {});

    expect(resultado.linhas).toHaveLength(0);
    expect(resultado.resumo.comissaoTotalCalculada).toBe(0);
  });

  it('exclui pedidos sem vendedor identificado, sem adivinhar', async () => {
    const semVendedor = pedido({
      codigoPedido: 21,
      numeroPedido: '21',
      etapa: '50',
      codigoCliente: 500,
      quantidade: 10,
      valorUnitario: 10,
      valorMercadoria: 100,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([semVendedor], VENDEDORES, CLIENTES, estoques, new Map());

    const resultado = await gerarRelatorioComissionamento(cliente, {});

    expect(resultado.linhas).toHaveLength(0);
    expect(resultado.pedidosSemVendedorExcluidos).toBe(1);
    expect(resultado.numerosPedidosSemVendedor).toEqual(['21']);
  });
});

describe('gerarRelatorioComissionamento — regra fundamental: custo do produto nunca entra na margem de comissionamento', () => {
  it('a mesma venda com custo de produto baixo ou alto gera exatamente a mesma margem/faixa/comissão', async () => {
    const baseVenda = {
      codigoPedido: 40,
      numeroPedido: '40',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 100,
      valorUnitario: 100,
      valorMercadoria: 70000,
      valorTotalPedido: 100000,
      valorIPI: 30000, // despesas de imposto = 30000 -> margem 70% -> comissão normal 1% (piso da regra progressiva)
    };

    // Custo agora é ESTIMADO a partir do preço de venda (regra temporária de 2026-09-10) — para
    // provar que ele não afeta a comissão, variamos o custo via a família do produto (padrão ÷1,90
    // vs. "Linha Premium" ÷1,75), não mais via estoque (que deixou de ser a fonte do custo).
    const pedidoCustoBaixo = pedido(baseVenda);
    const clienteBaixo = new ClienteComissionamentoOmieFalso(
      [pedidoCustoBaixo],
      VENDEDORES,
      CLIENTES,
      new Map(),
      new Map(),
      undefined,
      new Map(), // produto não configurado -> divisor padrão (1,90) -> custo menor
    );
    const resultadoBaixo = await gerarRelatorioComissionamento(clienteBaixo, {});

    const pedidoCustoAlto = pedido({ ...baseVenda, codigoPedido: 41, numeroPedido: '41' });
    const clienteAlto = new ClienteComissionamentoOmieFalso(
      [pedidoCustoAlto],
      VENDEDORES,
      CLIENTES,
      new Map(),
      new Map(),
      undefined,
      new Map([[1, { codigo_produto: 1, descricao_familia: 'Linha Premium' }]]), // divisor 1,75 -> custo maior
    );
    const resultadoAlto = await gerarRelatorioComissionamento(clienteAlto, {});

    const linhaBaixo = resultadoBaixo.linhas[0];
    const linhaAlto = resultadoAlto.linhas[0];
    if (linhaBaixo === undefined || linhaAlto === undefined) throw new Error('linha ausente');

    // As margens de CUSTO são bem diferentes entre os dois pedidos...
    expect(linhaBaixo.margemVendaPercentual).not.toBe(linhaAlto.margemVendaPercentual);

    // ...mas a margem de COMISSIONAMENTO, a comissão normal e final são idênticas: o custo nunca entra nessa conta.
    expect(linhaBaixo.margemComissionamentoPercentual).toBe(70);
    expect(linhaAlto.margemComissionamentoPercentual).toBe(70);
    expect(linhaBaixo.comissaoNormalPercentual).toBe(linhaAlto.comissaoNormalPercentual);
    expect(linhaBaixo.comissaoFinalPercentual).toBe(linhaAlto.comissaoFinalPercentual);
    expect(linhaBaixo.comissaoTotal).toBe(linhaAlto.comissaoTotal);
  });
});

describe('gerarRelatorioComissionamento — cálculo completo (teste — seção 38)', () => {
  it('retorna pedido, vendedor, margem (informativa), comissão por tabela normal/final, valor da venda, comissão, parcelas e baixas', async () => {
    const pedidoD = pedido({
      codigoPedido: 10,
      numeroPedido: '10',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 100,
      valorUnitario: 100,
      valorMercadoria: 70000,
      valorTotalPedido: 100000,
      valorIPI: 30000, // despesas (impostos) = 30000 -> margem 70% (só informativa)
    });
    // Preço da Tabela 950 (tabela 003) -> custo de referência 500; vendido a 700/un. -> multiplicador 1,40 -> 1% (piso)
    // custo elevado, propositalmente, para provar que não afeta o resultado do comissionamento
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 600 }] }]]);
    const titulos = new Map<number, TituloContaReceber[]>([
      [
        100,
        [
          {
            codigoLancamentoOmie: 1,
            codigoPedido: 10,
            numeroPedido: '10',
            numeroParcela: '001/002',
            valorDocumento: 60000,
            dataVencimento: '01/01/2026',
            statusTitulo: 'RECEBIDO',
            codigoVendedor: 100,
          },
          {
            codigoLancamentoOmie: 2,
            codigoPedido: 10,
            numeroPedido: '10',
            numeroParcela: '002/002',
            valorDocumento: 40000,
            dataVencimento: '01/02/2026',
            statusTitulo: 'A VENCER',
            codigoVendedor: 100,
          },
        ],
      ],
    ]);

    const cliente = new ClienteComissionamentoOmieFalso([pedidoD], VENDEDORES, CLIENTES, estoques, titulos, undefined, undefined, tabelas003(950));
    const resultado = await gerarRelatorioComissionamento(cliente, {});

    expect(resultado.linhas).toHaveLength(1);
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    // Pedido
    expect(linha.numeroPedido).toBe('10');
    expect(linha.nomeVendedor).toBe('João');
    expect(linha.nomeCliente).toBe('Cliente 500');
    // Margem de comissionamento (venda - despesas, nunca custo)
    expect(linha.valorBruto).toBe(100000);
    expect(linha.despesasIPI).toBe(30000);
    expect(linha.despesasIcmsSt).toBe(0);
    expect(linha.despesasFreteSeguroOutras).toBe(0);
    expect(linha.resultadoAposDespesas).toBe(70000);
    expect(linha.margemComissionamentoPercentual).toBe(70);
    // Comissão — multiplicador 1,40 -> comissão normal 1% (piso da regra progressiva), "João" não tem adicional
    expect(linha.composicaoItens?.[0]).toMatchObject({ tabelaCodigo: '003', precoTabela: 950, custoReferencia: 500, multiplicadorRealizado: 1.4 });
    expect(linha.comissaoNormalPercentual).toBe(1);
    expect(linha.adicionalVendedorPercentual).toBe(0);
    expect(linha.comissaoFinalPercentual).toBe(1);
    // base = valor dos PRODUTOS após desconto (70000), não o valor bruto da nota (100000) * 1%
    expect(linha.baseComissao).toBe(70000);
    expect(linha.comissaoTotal).toBeCloseTo(700, 10);
    // Pagamento / parcelas
    expect(linha.parcelas).toHaveLength(2);
    expect(linha.semTitulosLocalizados).toBe(false);
    // Parcela 1 = 60% do peso dos títulos, baixada -> comissão liberada = 60% de 700 = 420
    expect(linha.comissaoLiberada).toBeCloseTo(420, 10);
    expect(linha.comissaoPendente).toBeCloseTo(280, 10);

    expect(resultado.resumo.comissaoTotalCalculada).toBeCloseTo(700, 10);
    expect(resultado.resumo.comissaoLiberada).toBeCloseTo(420, 10);
    expect(resultado.resumo.comissaoPendente).toBeCloseTo(280, 10);
    expect(resultado.resumo.quantidadeParcelasBaixadas).toBe(1);
    expect(resultado.resumo.quantidadeParcelasPendentes).toBe(1);
  });

  it('considera IPI/ICMS-ST somados a frete/seguro/outras despesas', async () => {
    const pedidoComFrete = pedido({
      codigoPedido: 12,
      numeroPedido: '12',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 100,
      valorMercadoria: 9000,
      valorTotalPedido: 10000, // 9000 (produtos) + 500 (IPI) + 300 (frete) + 100 (seguro) + 100 (outras) = 10000
      valorIPI: 500,
      valorFrete: 300,
      valorSeguro: 100,
      outrasDespesas: 100,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoComFrete], VENDEDORES, CLIENTES, estoques, new Map());

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.despesasIPI).toBe(500);
    expect(linha.despesasIcmsSt).toBe(0);
    expect(linha.despesasFreteSeguroOutras).toBe(500);
    expect(linha.despesasTotal).toBe(1000);
    expect(linha.resultadoAposDespesas).toBe(9000);
    expect(linha.margemComissionamentoPercentual).toBe(90);
    // Base da comissão = valor dos produtos (9000); margem 90% -> teto da comissão normal (3%)
    expect(linha.comissaoTotal).toBeCloseTo(270, 10);
  });

  it('exibe os impostos embutidos no valor dos produtos (ICMS/PIS/COFINS/IBS/CBS) como informativo, sem afetar a margem nem a comissão', async () => {
    const pedidoComImpostosEmbutidos = pedido({
      codigoPedido: 13,
      numeroPedido: '13',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 100,
      valorMercadoria: 9000,
      valorTotalPedido: 9500,
      valorIPI: 500,
      impostosEmbutidos: { icms: 1800, pis: 150, cofins: 700, ibs: 10, cbs: 90 },
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso(
      [pedidoComImpostosEmbutidos],
      VENDEDORES,
      CLIENTES,
      estoques,
      new Map(),
    );

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.impostosEmbutidos).toEqual({ icms: 1800, pis: 150, cofins: 700, ibs: 10, cbs: 90 });
    // despesasTotal/margem não são afetados pelos impostos embutidos, mesmo sendo grandes.
    expect(linha.despesasTotal).toBe(500);
    expect(linha.margemComissionamentoPercentual).toBeCloseTo((9000 / 9500) * 100, 1);
  });

  it('marca pedidos sem título financeiro localizado, sem inventar parcelas', async () => {
    const pedidoSemTitulo = pedido({
      codigoPedido: 11,
      numeroPedido: '11',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 10,
      valorMercadoria: 100,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoSemTitulo], VENDEDORES, CLIENTES, estoques, new Map());

    const resultado = await gerarRelatorioComissionamento(cliente, {});

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.semTitulosLocalizados).toBe(true);
    expect(resultado.linhas[0]?.parcelas).toHaveLength(0);
    // Comissão total ainda é calculada sobre o valor da venda (independe de título encontrado)
    expect(resultado.linhas[0]?.comissaoTotal).toBeGreaterThan(0);
    expect(resultado.linhas[0]?.comissaoLiberada).toBe(0);
  });
});

describe('gerarRelatorioComissionamento — adicional de vendedor especial, ponta a ponta (regra de 2026-09-08)', () => {
  const VENDEDOR_SANDRO: VendedorInfo[] = [{ codigo: 300, nome: 'Sandro Cedro', inativo: false }];

  it('Sandro recebe +1% sobre a comissão normal no relatório completo (multiplicador 1,85 -> normal 2,5% -> final 3,5%)', async () => {
    const pedidoSandro = pedido({
      codigoPedido: 50,
      numeroPedido: '50',
      etapa: '50',
      codigoCliente: 500,
      codVend: 300,
      quantidade: 10,
      valorUnitario: 925,
      valorMercadoria: 9250, // 925/un. ÷ custo de referência 500 (Preço da Tabela 950 ÷ 1,90) = 1,85
      valorTotalPedido: 10000,
      valorIPI: 750,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoSandro], VENDEDOR_SANDRO, CLIENTES, estoques, new Map(), undefined, undefined, tabelas003(950));

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.nomeVendedor).toBe('Sandro Cedro');
    expect(linha.comissaoNormalPercentual).toBe(2.5);
    expect(linha.adicionalVendedorPercentual).toBe(1);
    expect(linha.comissaoFinalPercentual).toBe(3.5);
    // base = valor dos produtos (9250) * 3,5%
    expect(linha.comissaoTotal).toBeCloseTo(323.75, 10);
  });

  it('vendedor comum (fora da lista) nunca recebe o adicional no relatório completo', async () => {
    const pedidoJoao = pedido({
      codigoPedido: 51,
      numeroPedido: '51',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 925,
      valorMercadoria: 9250,
      valorTotalPedido: 10000,
      valorIPI: 750,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoJoao], VENDEDORES, CLIENTES, estoques, new Map(), undefined, undefined, tabelas003(950));

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.adicionalVendedorPercentual).toBe(0);
    expect(linha.comissaoFinalPercentual).toBe(linha.comissaoNormalPercentual);
    expect(linha.comissaoTotal).toBeCloseTo(231.25, 10); // 9250 * 2,5%
  });
});

describe('gerarRelatorioComissionamento — filtro por vendedor (teste — seção 36)', () => {
  it('retorna apenas pedidos do vendedor selecionado', async () => {
    const pedidoVendedor100 = pedido({
      codigoPedido: 30,
      numeroPedido: '30',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 10,
      valorMercadoria: 100,
    });
    const pedidoVendedor200 = pedido({
      codigoPedido: 31,
      numeroPedido: '31',
      etapa: '50',
      codigoCliente: 500,
      codVend: 200,
      quantidade: 10,
      valorUnitario: 10,
      valorMercadoria: 100,
    });
    const vendedores: VendedorInfo[] = [...VENDEDORES, { codigo: 200, nome: 'Maria', inativo: false }];
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso(
      [pedidoVendedor100, pedidoVendedor200],
      vendedores,
      CLIENTES,
      estoques,
      new Map(),
    );

    const resultado = await gerarRelatorioComissionamento(cliente, { codigoVendedor: 100 });

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.nomeVendedor).toBe('João');
  });
});

describe('gerarRelatorioComissionamento — vendedor com comissão fixa: Renato Pinto (regra de 2026-09-10)', () => {
  const VENDEDOR_RENATO: VendedorInfo[] = [{ codigo: 400, nome: 'Renato Pinto', inativo: false }];

  it('aplica 4% fixo sobre o pedido inteiro, ignorando a tabela de preços e o adicional', async () => {
    const pedidoRenato = pedido({
      codigoPedido: 60,
      numeroPedido: '60',
      etapa: '50',
      codigoCliente: 500,
      codVend: 400,
      quantidade: 10,
      valorUnitario: 1000,
      valorMercadoria: 9500, // pela tabela padrão seria 3% -- mas o vendedor tem comissão fixa, ignora isso
      valorTotalPedido: 10000,
      valorIPI: 500,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    // Sem nenhuma tabela de preço: a regra do vendedor nem consulta tabela, logo nunca vira exceção.
    const cliente = new ClienteComissionamentoOmieFalso([pedidoRenato], VENDEDOR_RENATO, CLIENTES, estoques, new Map(), undefined, undefined, []);

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.vendedorComissaoFixaPercentual).toBe(4);
    expect(linha.comissaoNormalPercentual).toBe(4);
    expect(linha.adicionalVendedorPercentual).toBe(0);
    expect(linha.comissaoFinalPercentual).toBe(4);
    expect(linha.composicaoItens).toBeUndefined();
    expect(cliente.consultasTabelasPreco).toBe(0);
    expect(resultado.excecoesApuracao).toEqual([]);
    // base = valor dos produtos (9500) * 4%
    expect(linha.comissaoTotal).toBeCloseTo(380, 10);
  });

  it('a comissão fixa do vendedor tem prioridade sobre a tabela 001 — ignora item CTO Promocional', async () => {
    const pedidoMisto: PedidoOmie = {
      cabecalho: { codigo_pedido: 63, numero_pedido: '63', etapa: '50', codigo_cliente: 500 },
      det: [
        { produto: { codigo_produto: 1, codigo: 'P1', descricao: 'Produto normal', quantidade: 10, valor_unitario: 100, valor_mercadoria: 900 } },
        { produto: { codigo_produto: 2, codigo: 'P2', descricao: 'CTO Promocional', quantidade: 5, valor_unitario: 20, valor_mercadoria: 100 } },
      ],
      total_pedido: { valor_total_pedido: 1100, valor_mercadorias: 1000, valor_IPI: 100 },
      informacoes_adicionais: { codVend: 400 },
      frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 },
    };
    const estoques = new Map([
      [1, { listaEstoque: [{ nCMC: 1 }] }],
      [2, { listaEstoque: [{ nCMC: 1 }] }],
    ]);
    const produtos = new Map([[2, { codigo_produto: 2, descricao_familia: 'CTO Promocional' }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoMisto], VENDEDOR_RENATO, CLIENTES, estoques, new Map(), undefined, produtos);

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.vendedorComissaoFixaPercentual).toBe(4);
    expect(linha.composicaoItens).toBeUndefined();
    // 4% sobre a receita TOTAL do pedido (1000), sem separar a parte da tabela 001
    expect(linha.comissaoTotal).toBeCloseTo(40, 10);
  });
});

describe('gerarRelatorioComissionamento — tabela 001 (comissão fixa de 1%, substitui a família CTO Promocional — 2026-10-06)', () => {
  function pedidoMisto(codigo: number, codVend: number): PedidoOmie {
    // item 1: tabela 003, 10 × 90 = 900 (Preço da Tabela 95 -> custo ref. 50 -> 1,80 -> 2%)
    // item 2: tabela 001, 5 × 20 = 100 (1% fixo)
    return {
      cabecalho: { codigo_pedido: codigo, numero_pedido: String(codigo), etapa: '50', codigo_cliente: 500 },
      det: [
        { produto: { codigo_produto: 1, codigo: 'P1', descricao: 'Produto 003', quantidade: 10, valor_unitario: 90, valor_mercadoria: 900, codigo_tabela_preco: 2 } },
        { produto: { codigo_produto: 2, codigo: 'P2', descricao: 'CTO', quantidade: 5, valor_unitario: 20, valor_mercadoria: 100, codigo_tabela_preco: 2 } },
      ],
      total_pedido: { valor_total_pedido: 1100, valor_mercadorias: 1000, valor_IPI: 100 },
      informacoes_adicionais: { codVend },
      frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 },
      infoCadastro: { dInc: '01/06/2026', hInc: '10:00:00' },
    };
  }
  const TABELAS_MISTO = [tabelaPreco('001', [itemTabela(2, 82.9)]), tabelaPreco('002', []), tabelaPreco('003', [itemTabela(1, 95)])];
  const estoques = new Map([
    [1, { listaEstoque: [{ nCMC: 1 }] }],
    [2, { listaEstoque: [{ nCMC: 1 }] }],
  ]);

  it('pedido 100% tabela 001 aplica 1% fixo — mesmo sem a família "CTO Promocional" no cadastro', async () => {
    const pedidoPromo = pedido({ codigoPedido: 61, numeroPedido: '61', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 10, valorUnitario: 90, valorMercadoria: 900, valorTotalPedido: 1000, valorIPI: 100 });
    const produtos = new Map([[1, { codigo_produto: 1, descricao_familia: 'Outra família' }]]);
    const tabelas = [tabelaPreco('001', [itemTabela(1, 82.9)])];
    const cliente = new ClienteComissionamentoOmieFalso([pedidoPromo], VENDEDORES, CLIENTES, estoques, new Map(), undefined, produtos, tabelas);

    const [linha] = (await gerarRelatorioComissionamento(cliente, {})).linhas;
    expect(linha?.comissaoNormalPercentual).toBe(1);
    expect(linha?.adicionalVendedorPercentual).toBe(0);
    expect(linha?.comissaoFinalPercentual).toBe(1);
    expect(linha?.composicaoItens?.[0]).toMatchObject({ tabelaCodigo: '001', regra: 'FIXA', precoTabela: null, custoReferencia: null });
    expect(linha?.comissaoTotal).toBeCloseTo(9, 10); // 900 * 1%
  });

  it('família "CTO Promocional" sozinha não dá 1%: produto da tabela 003 segue o multiplicador', async () => {
    const pedidoFamilia = pedido({ codigoPedido: 66, numeroPedido: '66', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 10, valorUnitario: 95, valorMercadoria: 950 });
    const produtos = new Map([[1, { codigo_produto: 1, descricao_familia: 'CTO Promocional' }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoFamilia], VENDEDORES, CLIENTES, estoques, new Map(), undefined, produtos, tabelas003(95));

    const [linha] = (await gerarRelatorioComissionamento(cliente, {})).linhas;
    expect(linha?.comissaoNormalPercentual).toBe(3); // 95 ÷ 50 = 1,90
  });

  it('pedido MISTO: cada item com a regra da sua tabela; comissão = soma dos itens', async () => {
    const cliente = new ClienteComissionamentoOmieFalso([pedidoMisto(62, 100)], VENDEDORES, CLIENTES, estoques, new Map(), undefined, undefined, TABELAS_MISTO);
    const [linha] = (await gerarRelatorioComissionamento(cliente, {})).linhas;
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.composicaoItens?.map((i) => [i.codigo, i.tabelaCodigo, i.comissaoNormalPercentual, i.comissaoValor])).toEqual([
      ['P1', '003', 2, 18],
      ['P2', '001', 1, 1],
    ]);
    expect(linha.comissaoTotal).toBeCloseTo(19, 10);
    // percentuais do pedido = média ponderada (exibição): 19 ÷ 1000
    expect(linha.comissaoFinalPercentual).toBe(1.9);
    expect(linha.comissaoNormalPercentual).toBe(1.9);
  });

  it('vendedor especial (Sandro) recebe +1% em TODOS os itens, inclusive os da tabela 001', async () => {
    const vendedorSandro: VendedorInfo[] = [{ codigo: 300, nome: 'Sandro Cedro', inativo: false }];
    const cliente = new ClienteComissionamentoOmieFalso([pedidoMisto(64, 300)], vendedorSandro, CLIENTES, estoques, new Map(), undefined, undefined, TABELAS_MISTO);
    const [linha] = (await gerarRelatorioComissionamento(cliente, {})).linhas;
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.adicionalVendedorPercentual).toBe(1);
    expect(linha.composicaoItens?.map((i) => [i.comissaoNormalPercentual, i.adicionalVendedorPercentual, i.comissaoFinalPercentual])).toEqual([
      [2, 1, 3],
      [1, 1, 2],
    ]);
    expect(linha.comissaoTotal).toBeCloseTo(27 + 2, 10);
  });

  it('pedido 100% tabela 001 com vendedor especial soma o adicional (pedido real nº 53: 1% + 1%)', async () => {
    const pedidoPromoSandro = pedido({ codigoPedido: 65, numeroPedido: '65', etapa: '50', codigoCliente: 500, codVend: 300, quantidade: 10, valorUnitario: 434.5, valorMercadoria: 4345, valorTotalPedido: 5013, valorIPI: 326, valorIcmsSt: 342 });
    const vendedorSandro: VendedorInfo[] = [{ codigo: 300, nome: 'Sandro Cedro', inativo: false }];
    const cliente = new ClienteComissionamentoOmieFalso([pedidoPromoSandro], vendedorSandro, CLIENTES, estoques, new Map(), undefined, undefined, [tabelaPreco('001', [itemTabela(1, 82.9)])]);
    const [linha] = (await gerarRelatorioComissionamento(cliente, {})).linhas;

    expect(linha?.comissaoNormalPercentual).toBe(1);
    expect(linha?.adicionalVendedorPercentual).toBe(1);
    expect(linha?.comissaoFinalPercentual).toBe(2);
    expect(linha?.comissaoTotal).toBeCloseTo(4345 * 0.02, 10);
  });
});

describe('gerarRelatorioComissionamento — descontos e rateio pelas parcelas (2026-10-06)', () => {
  it('base = mercadoria − desconto; a comissão total de itens com taxas diferentes é rateada pelas parcelas sem taxa global pela margem', async () => {
    const pedidoDesconto: PedidoOmie = {
      cabecalho: { codigo_pedido: 70, numero_pedido: '70', etapa: '60', codigo_cliente: 500 },
      det: [
        // 10 × 190 = 1900, desconto 100 -> 1800 -> 180/un. ÷ 100 = 1,80 -> 2% -> 36
        { produto: { codigo_produto: 1, codigo: 'P1', descricao: 'A', quantidade: 10, valor_unitario: 190, valor_mercadoria: 1900, valor_desconto: 100 } },
        // 2 × 100 = 200 na tabela 001 -> 1% -> 2
        { produto: { codigo_produto: 2, codigo: 'P2', descricao: 'B', quantidade: 2, valor_unitario: 100, valor_mercadoria: 200 } },
      ],
      // margem informativa ruim de propósito (frete alto) — não pode puxar a comissão para baixo
      total_pedido: { valor_total_pedido: 3000, valor_mercadorias: 2100, valor_IPI: 100 },
      informacoes_adicionais: { codVend: 100 },
      frete: { valor_frete: 900, valor_seguro: 0, outras_despesas: 0 },
      infoCadastro: { dInc: '01/06/2026', hInc: '10:00:00' },
    };
    const tabelas = [tabelaPreco('001', [itemTabela(2, 82.9)]), tabelaPreco('003', [itemTabela(1, 190)])];
    const titulos = new Map<number, TituloContaReceber[]>([
      [100, [
        { codigoLancamentoOmie: 1, codigoPedido: 70, numeroPedido: '70', numeroParcela: '001/002', valorDocumento: 1000, dataVencimento: '01/07/2026', statusTitulo: 'RECEBIDO', codigoVendedor: 100 },
        { codigoLancamentoOmie: 2, codigoPedido: 70, numeroPedido: '70', numeroParcela: '002/002', valorDocumento: 3000, dataVencimento: '01/08/2026', statusTitulo: 'A VENCER', codigoVendedor: 100 },
      ]],
    ]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoDesconto], VENDEDORES, CLIENTES, new Map(), titulos, undefined, undefined, tabelas);
    const [linha] = (await gerarRelatorioComissionamento(cliente, {})).linhas;
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.receitaTotal).toBe(2100); // valor de mercadoria bruto (análise de custo), como sempre
    expect(linha.baseComissao).toBe(2000); // após o desconto de 100
    expect(linha.comissaoTotal).toBeCloseTo(38, 10);
    expect(linha.margemComissionamentoPercentual).toBeLessThan(70); // seria 1% pela regra antiga
    expect(linha.parcelas.map((p) => p.comissaoParcela)).toEqual([expect.closeTo(9.5, 10), expect.closeTo(28.5, 10)]); // 25% / 75%
    expect(linha.comissaoLiberada).toBeCloseTo(9.5, 10);
    expect(linha.comissaoPendente).toBeCloseTo(28.5, 10);
  });
});

describe('gerarRelatorioComissionamento — exceções de apuração (tabela/preço/data, 2026-10-06)', () => {
  it('pedido com produto fora de qualquer tabela sai inteiro da apuração (sem comissão zero) e é listado; os demais seguem', async () => {
    const valido = pedido({ codigoPedido: 80, numeroPedido: '80', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 1, valorUnitario: 190, valorMercadoria: 190 });
    const semTabela: PedidoOmie = {
      ...pedido({ codigoPedido: 81, numeroPedido: '81', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 1, valorUnitario: 190, valorMercadoria: 190 }),
      det: [
        { produto: { codigo_produto: 1, codigo: 'P1', descricao: 'Ok', quantidade: 1, valor_unitario: 190, valor_mercadoria: 190 } },
        { produto: { codigo_produto: 55, codigo: 'PA00000055', descricao: 'Sem tabela', quantidade: 1, valor_unitario: 50, valor_mercadoria: 50, codigo_tabela_preco: 2 } },
      ],
    };
    const cliente = new ClienteComissionamentoOmieFalso([valido, semTabela], VENDEDORES, CLIENTES, new Map(), new Map());
    const resultado = await gerarRelatorioComissionamento(cliente, {});

    expect(resultado.linhas.map((l) => l.numeroPedido)).toEqual(['80']);
    expect(resultado.resumo.quantidadePedidos).toBe(1);
    expect(resultado.resumo.comissaoTotalCalculada).toBeCloseTo(5.7, 10);
    expect(resultado.excecoesApuracao).toEqual([
      expect.objectContaining({
        numeroPedido: '81',
        nomeVendedor: 'João',
        problemas: [expect.objectContaining({ codigo: 'PA00000055', tabela: null, motivo: 'TABELA_NAO_IDENTIFICADA' })],
      }),
    ]);
  });

  it('tabela/item alterados depois da venda: apura com o PREÇO ATUAL da tabela ativa (decisão de 2026-10-06), sem bloqueio', async () => {
    const venda = pedido({ codigoPedido: 82, numeroPedido: '82', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 1, valorUnitario: 190, valorMercadoria: 190, dataInclusao: '01/09/2026' });
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190, '05/10/2026', '10:28:09')], { dataAlteracao: '05/10/2026', horaAlteracao: '10:30:00', consultadoEm: '2026-10-06T15:00:00.000Z' })];
    const cliente = new ClienteComissionamentoOmieFalso([venda], VENDEDORES, CLIENTES, new Map(), new Map(), undefined, undefined, tabelas);
    const resultado = await gerarRelatorioComissionamento(cliente, {});

    expect(resultado.excecoesApuracao).toEqual([]);
    expect(resultado.linhas[0]?.comissaoTotal).toBeCloseTo(5.7, 10);
    expect(resultado.linhas[0]?.composicaoItens?.[0]).toMatchObject({
      referencia: 'PRECO_ATUAL_TABELA_ATIVA',
      precoConsultadoEm: '2026-10-06T15:00:00.000Z',
      itemAlteradoEm: '05/10/2026 10:28:09',
    });
  });

  it('tabela INATIVA indicada pelo ID interno do item → exceção com produto, tabela e motivo', async () => {
    const venda = pedido({ codigoPedido: 84, numeroPedido: '84', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 1, valorUnitario: 190, valorMercadoria: 190, codigoTabelaPreco: ID_TABELA_003 });
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190)], { ativa: false })];
    const cliente = new ClienteComissionamentoOmieFalso([venda], VENDEDORES, CLIENTES, new Map(), new Map(), undefined, undefined, tabelas);
    const resultado = await gerarRelatorioComissionamento(cliente, {});
    expect(resultado.linhas).toEqual([]);
    expect(resultado.excecoesApuracao[0]?.problemas[0]).toMatchObject({ codigo: 'P1', motivo: 'TABELA_INATIVA', tabela: '003 — TABELA DE VENDA - 07/26' });
  });

  it('ID interno indicado no item tem prioridade; produto fora dele vira exceção (nunca troca para outra tabela)', async () => {
    const venda = pedido({ codigoPedido: 83, numeroPedido: '83', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 1, valorUnitario: 190, valorMercadoria: 190, codigoTabelaPreco: ID_TABELA_003 });
    const tabelas = [tabelaPreco('002', [itemTabela(1, 175)]), tabelaPreco('003', [])];
    const cliente = new ClienteComissionamentoOmieFalso([venda], VENDEDORES, CLIENTES, new Map(), new Map(), undefined, undefined, tabelas);
    const resultado = await gerarRelatorioComissionamento(cliente, {});
    expect(resultado.excecoesApuracao[0]?.problemas[0]?.motivo).toBe('PRODUTO_FORA_DA_TABELA_INFORMADA');
  });

  it('faturamento parcial: itens zerados do registro original não exigem tabela; a fatura filha é apurada normalmente', async () => {
    // Produto 99 (só no original, zerado) não está em tabela nenhuma — não pode bloquear o pedido.
    const original = pedido({ codigoPedido: 1540, numeroPedido: '154', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 0, valorUnitario: 0, valorMercadoria: 0, dataInclusao: '01/08/2026', codigoProduto: 99 });
    const fatura = pedido({ codigoPedido: 1541, numeroPedido: '154', etapa: '60', codigoCliente: 500, codVend: 100, quantidade: 1, valorUnitario: 190, valorMercadoria: 190, dataInclusao: '20/09/2026' });
    const tabelas = [tabelaPreco('003', [itemTabela(1, 190, '10/09/2026')])];
    const cliente = new ClienteComissionamentoOmieFalso([original, fatura], VENDEDORES, CLIENTES, new Map(), new Map(), undefined, undefined, tabelas);
    const resultado = await gerarRelatorioComissionamento(cliente, {});
    expect(resultado.excecoesApuracao).toEqual([]);
    expect(resultado.linhas.map((l) => [l.numeroPedido, l.composicaoItens?.length])).toEqual([['154', 1]]);
    expect(resultado.linhas[0]?.comissaoTotal).toBeCloseTo(5.7, 10);
  });
});

describe('gerarRelatorioComissionamento — faturamento parcial (BUG REAL corrigido em 2026-09-10)', () => {
  it('localiza os títulos de uma fatura parcial mesmo quando o nCodPedido delas é DIFERENTE do codigo_pedido do pedido original', async () => {
    // Reproduz o pedido real nº 154: faturado em 2 notas fiscais parciais, cada uma com um
    // nCodPedido PRÓPRIO na Omie (diferente do codigo_pedido do pedido original), mas com o
    // mesmo numero_pedido — antes da correção, `semTitulosLocalizados` ficava `true` e as
    // parcelas ficavam vazias mesmo o pedido já tendo sido parcialmente faturado.
    const pedidoParcial = pedido({
      codigoPedido: 900, // codigo_pedido do pedido ORIGINAL — não bate com nenhum título abaixo
      numeroPedido: '154',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 100,
      valorUnitario: 100,
      valorMercadoria: 70000,
      valorTotalPedido: 100000,
      valorIPI: 30000,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const titulos = new Map<number, TituloContaReceber[]>([
      [
        100,
        [
          // Fatura parcial 1 (NF 00025739) — nCodPedido 901, diferente de 900, mas numeroPedido igual.
          {
            codigoLancamentoOmie: 1,
            codigoPedido: 901,
            numeroPedido: '154',
            numeroParcela: '001/001',
            numeroNotaFiscal: '00025739',
            valorDocumento: 35382.1,
            dataVencimento: '01/01/2026',
            statusTitulo: 'RECEBIDO',
            codigoVendedor: 100,
          },
          // Fatura parcial 2 (NF 00025767) — nCodPedido 902, também diferente de 900.
          {
            codigoLancamentoOmie: 2,
            codigoPedido: 902,
            numeroPedido: '154',
            numeroParcela: '001/001',
            numeroNotaFiscal: '00025767',
            valorDocumento: 61003.2,
            dataVencimento: '01/02/2026',
            statusTitulo: 'A VENCER',
            codigoVendedor: 100,
          },
        ],
      ],
    ]);

    const cliente = new ClienteComissionamentoOmieFalso([pedidoParcial], VENDEDORES, CLIENTES, estoques, titulos);
    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.semTitulosLocalizados).toBe(false);
    expect(linha.parcelas).toHaveLength(2);
    expect(linha.comissaoLiberada).toBeGreaterThan(0); // a fatura RECEBIDO já deve contar como liberada
    expect(linha.comissaoPendente).toBeGreaterThan(0); // a fatura A VENCER continua pendente

    // Rótulo de fatura parcial (regra de 2026-09-10): "154/1" para a NF mais antiga (00025739),
    // "154/2" para a mais nova (00025767) — mesmo padrão exibido no Kanban da Omie.
    const parcelaNf739 = linha.parcelas.find((p) => p.numeroNotaFiscal === '00025739');
    const parcelaNf767 = linha.parcelas.find((p) => p.numeroNotaFiscal === '00025767');
    expect(parcelaNf739?.numeroFaturaParcial).toBe('154/1');
    expect(parcelaNf767?.numeroFaturaParcial).toBe('154/2');

    // Saldo a faturar (regra de 2026-09-10): valor da nota (100000) menos o que já foi
    // faturado nas 2 NFs parciais (35382.1 + 61003.2 = 96385.3) = 3614.70 ainda não faturado.
    expect(linha.valorFaturado).toBeCloseTo(96385.3, 2);
    expect(linha.saldoAFaturar).toBeCloseTo(3614.7, 2);
  });

  it('nunca conta o mesmo título duas vezes quando ele bate tanto por código quanto por número de pedido', async () => {
    const pedidoNormal = pedido({
      codigoPedido: 10,
      numeroPedido: '10',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 100,
      valorMercadoria: 9000,
      valorTotalPedido: 10000,
      valorIPI: 1000,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const titulos = new Map<number, TituloContaReceber[]>([
      [
        100,
        [
          {
            codigoLancamentoOmie: 1,
            codigoPedido: 10, // bate por código E por número — não deve duplicar
            numeroPedido: '10',
            numeroParcela: '001/001',
            numeroNotaFiscal: '00099999',
            valorDocumento: 10000,
            dataVencimento: '01/01/2026',
            statusTitulo: 'A VENCER',
            codigoVendedor: 100,
          },
        ],
      ],
    ]);

    const cliente = new ClienteComissionamentoOmieFalso([pedidoNormal], VENDEDORES, CLIENTES, estoques, titulos);
    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.parcelas).toHaveLength(1); // nunca 2
  });

  it('nunca rotula pedido com fatura única (mesmo com várias parcelas na mesma NF)', async () => {
    const pedidoUmaNota = pedido({
      codigoPedido: 20,
      numeroPedido: '20',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 100,
      valorMercadoria: 9000,
      valorTotalPedido: 10000,
      valorIPI: 1000,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const titulos = new Map<number, TituloContaReceber[]>([
      [
        100,
        [
          {
            codigoLancamentoOmie: 1,
            codigoPedido: 20,
            numeroPedido: '20',
            numeroParcela: '001/002',
            numeroNotaFiscal: '00011111',
            valorDocumento: 5000,
            dataVencimento: '01/01/2026',
            statusTitulo: 'A VENCER',
            codigoVendedor: 100,
          },
          {
            codigoLancamentoOmie: 2,
            codigoPedido: 20,
            numeroPedido: '20',
            numeroParcela: '002/002',
            numeroNotaFiscal: '00011111',
            valorDocumento: 5000,
            dataVencimento: '01/02/2026',
            statusTitulo: 'A VENCER',
            codigoVendedor: 100,
          },
        ],
      ],
    ]);

    const cliente = new ClienteComissionamentoOmieFalso([pedidoUmaNota], VENDEDORES, CLIENTES, estoques, titulos);
    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.parcelas).toHaveLength(2);
    for (const parcela of linha.parcelas) {
      expect(parcela.numeroFaturaParcial ?? null).toBeNull();
    }
  });

  it('saldoAFaturar fica ~0 quando o pedido já foi faturado por completo', async () => {
    const pedidoCompleto = pedido({
      codigoPedido: 30,
      numeroPedido: '30',
      etapa: '50',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 100,
      valorMercadoria: 9000,
      valorTotalPedido: 10000,
      valorIPI: 1000,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const titulos = new Map<number, TituloContaReceber[]>([
      [
        100,
        [
          {
            codigoLancamentoOmie: 1,
            codigoPedido: 30,
            numeroPedido: '30',
            numeroParcela: '001/001',
            numeroNotaFiscal: '00022222',
            valorDocumento: 10000,
            dataVencimento: '01/01/2026',
            statusTitulo: 'RECEBIDO',
            codigoVendedor: 100,
          },
        ],
      ],
    ]);

    const cliente = new ClienteComissionamentoOmieFalso([pedidoCompleto], VENDEDORES, CLIENTES, estoques, titulos);
    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.valorFaturado).toBeCloseTo(10000, 2);
    expect(linha.saldoAFaturar).toBeCloseTo(0, 2);
  });
});

describe('gerarRelatorioComissionamento — Omie recusando a consulta de títulos (Client-1880 persistente)', () => {
  it('sem filtro de vendedor, nunca devolve totais sem os títulos de algum vendedor: a falha sobe como erro', async () => {
    const { OmieErroMetodoEmExecucao } = await import('../../src/omie/erros.js');
    const venda = pedido({ codigoPedido: 90, numeroPedido: '90', etapa: '50', codigoCliente: 500, codVend: 100, quantidade: 1, valorUnitario: 190, valorMercadoria: 190 });
    const vendedores: VendedorInfo[] = [...VENDEDORES, { codigo: 2389160395, nome: 'CRM Omie', inativo: false }];
    const cliente = new ClienteComissionamentoOmieFalso([venda], vendedores, CLIENTES, new Map(), new Map());
    const original = cliente.listarContasReceberPorVendedor.bind(cliente);
    cliente.listarContasReceberPorVendedor = async (codigo: number) => {
      if (codigo === 2389160395) throw new OmieErroMetodoEmExecucao('A Omie continuou recusando a consulta… após 3 tentativas em 71 s.', 'SOAP-ENV:Client-1880');
      return original(codigo);
    };
    await expect(gerarRelatorioComissionamento(cliente, { dataDe: '01/06/2026', dataAte: '30/06/2026' })).rejects.toThrow('após 3 tentativas');
  });
});
