import { describe, expect, it } from 'vitest';
import { gerarRelatorioComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import { ClienteComissionamentoOmieFalso } from '../omie/clienteComissionamentoFalso.js';
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
  };
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
      etapa: '10',
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
      etapa: '10',
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
  it('retorna pedido, vendedor, margem de comissionamento, comissão normal/final, valor da venda, comissão, parcelas e baixas', async () => {
    const pedidoD = pedido({
      codigoPedido: 10,
      numeroPedido: '10',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 100,
      valorUnitario: 100,
      valorMercadoria: 70000,
      valorTotalPedido: 100000,
      valorIPI: 30000, // despesas (impostos) = 30000 -> margem 70% -> comissão normal 1% (piso da regra progressiva)
    });
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

    const cliente = new ClienteComissionamentoOmieFalso([pedidoD], VENDEDORES, CLIENTES, estoques, titulos);
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
    // Comissão — margem 70% -> comissão normal 1% (piso da regra progressiva), "João" não tem adicional
    expect(linha.comissaoNormalPercentual).toBe(1);
    expect(linha.adicionalVendedorPercentual).toBe(0);
    expect(linha.comissaoFinalPercentual).toBe(1);
    // base = valor total dos PRODUTOS (receitaTotal = 70000), não o valor bruto da nota (100000) * 1%
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
      etapa: '10',
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
      etapa: '10',
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
      etapa: '10',
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

  it('Sandro recebe +1% sobre a comissão normal no relatório completo (margem 85% -> normal 2,5% -> final 3,5%)', async () => {
    const pedidoSandro = pedido({
      codigoPedido: 50,
      numeroPedido: '50',
      etapa: '10',
      codigoCliente: 500,
      codVend: 300,
      quantidade: 10,
      valorUnitario: 1000,
      valorMercadoria: 8500,
      valorTotalPedido: 10000,
      valorIPI: 1500, // 8500 + 1500 = 10000 -> margem = 8500/10000 = 85%
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoSandro], VENDEDOR_SANDRO, CLIENTES, estoques, new Map());

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.nomeVendedor).toBe('Sandro Cedro');
    expect(linha.margemComissionamentoPercentual).toBe(85);
    expect(linha.comissaoNormalPercentual).toBe(2.5);
    expect(linha.adicionalVendedorPercentual).toBe(1);
    expect(linha.comissaoFinalPercentual).toBe(3.5);
    // base = valor dos produtos (8500) * 3,5%
    expect(linha.comissaoTotal).toBeCloseTo(297.5, 10);
  });

  it('vendedor comum (fora da lista) nunca recebe o adicional no relatório completo', async () => {
    const pedidoJoao = pedido({
      codigoPedido: 51,
      numeroPedido: '51',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 1000,
      valorMercadoria: 8500,
      valorTotalPedido: 10000,
      valorIPI: 1500,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoJoao], VENDEDORES, CLIENTES, estoques, new Map());

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.adicionalVendedorPercentual).toBe(0);
    expect(linha.comissaoFinalPercentual).toBe(linha.comissaoNormalPercentual);
    expect(linha.comissaoTotal).toBeCloseTo(212.5, 10); // 8500 * 2,5%
  });
});

describe('gerarRelatorioComissionamento — filtro por vendedor (teste — seção 36)', () => {
  it('retorna apenas pedidos do vendedor selecionado', async () => {
    const pedidoVendedor100 = pedido({
      codigoPedido: 30,
      numeroPedido: '30',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 10,
      valorMercadoria: 100,
    });
    const pedidoVendedor200 = pedido({
      codigoPedido: 31,
      numeroPedido: '31',
      etapa: '10',
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

  it('aplica 4% fixo sobre o pedido inteiro, ignorando a margem de comissionamento e o adicional', async () => {
    const pedidoRenato = pedido({
      codigoPedido: 60,
      numeroPedido: '60',
      etapa: '10',
      codigoCliente: 500,
      codVend: 400,
      quantidade: 10,
      valorUnitario: 1000,
      valorMercadoria: 9500, // margem normal seria 95% -> comissão normal 3% -- mas o vendedor tem comissão fixa, ignora isso
      valorTotalPedido: 10000,
      valorIPI: 500,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoRenato], VENDEDOR_RENATO, CLIENTES, estoques, new Map());

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.vendedorComissaoFixaPercentual).toBe(4);
    expect(linha.comissaoNormalPercentual).toBe(4);
    expect(linha.adicionalVendedorPercentual).toBe(0);
    expect(linha.comissaoFinalPercentual).toBe(4);
    expect(linha.segregacaoComissaoFixa).toBeUndefined();
    // base = valor dos produtos (9500) * 4%
    expect(linha.comissaoTotal).toBeCloseTo(380, 10);
  });

  it('a comissão fixa do vendedor tem prioridade sobre a comissão fixa de família — ignora item CTO Promocional', async () => {
    const pedidoMisto: PedidoOmie = {
      cabecalho: { codigo_pedido: 63, numero_pedido: '63', etapa: '10', codigo_cliente: 500 },
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
    expect(linha.segregacaoComissaoFixa).toBeUndefined();
    // 4% sobre a receita TOTAL do pedido (1000), sem segregar a parte promocional
    expect(linha.comissaoTotal).toBeCloseTo(40, 10);
  });
});

describe('gerarRelatorioComissionamento — família com comissão fixa: CTO Promocional (regra de 2026-09-10)', () => {
  it('pedido 100% CTO Promocional aplica 1% fixo sobre tudo, sem segregação a exibir', async () => {
    const pedidoPromo = pedido({
      codigoPedido: 61,
      numeroPedido: '61',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      quantidade: 10,
      valorUnitario: 100,
      valorMercadoria: 900,
      valorTotalPedido: 1000,
      valorIPI: 100,
    });
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const produtos = new Map([[1, { codigo_produto: 1, descricao_familia: 'CTO Promocional' }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoPromo], VENDEDORES, CLIENTES, estoques, new Map(), undefined, produtos);

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.comissaoNormalPercentual).toBe(1);
    expect(linha.adicionalVendedorPercentual).toBe(0);
    expect(linha.comissaoFinalPercentual).toBe(1);
    expect(linha.segregacaoComissaoFixa).toBeUndefined();
    expect(linha.vendedorComissaoFixaPercentual).toBeUndefined();
    expect(linha.comissaoTotal).toBeCloseTo(9, 10); // 900 * 1%
  });

  it('pedido MISTO segrega o item CTO Promocional: cada parte com sua própria regra de comissão', async () => {
    // item 1 (normal, receita 900) + item 2 (CTO Promocional, receita 100) — total produtos 1000, IPI 100 -> nota 1100
    const pedidoMisto: PedidoOmie = {
      cabecalho: { codigo_pedido: 62, numero_pedido: '62', etapa: '10', codigo_cliente: 500 },
      det: [
        { produto: { codigo_produto: 1, codigo: 'P1', descricao: 'Produto normal', quantidade: 10, valor_unitario: 100, valor_mercadoria: 900 } },
        { produto: { codigo_produto: 2, codigo: 'P2', descricao: 'CTO Promocional', quantidade: 5, valor_unitario: 20, valor_mercadoria: 100 } },
      ],
      total_pedido: { valor_total_pedido: 1100, valor_mercadorias: 1000, valor_IPI: 100 },
      informacoes_adicionais: { codVend: 100 },
      frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 },
    };
    const estoques = new Map([
      [1, { listaEstoque: [{ nCMC: 1 }] }],
      [2, { listaEstoque: [{ nCMC: 1 }] }],
    ]);
    const produtos = new Map([[2, { codigo_produto: 2, descricao_familia: 'CTO Promocional' }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoMisto], VENDEDORES, CLIENTES, estoques, new Map(), undefined, produtos);

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    expect(linha.segregacaoComissaoFixa).toBeDefined();
    expect(linha.segregacaoComissaoFixa?.nomeFamilia).toBe('CTO Promocional');
    expect(linha.segregacaoComissaoFixa?.percentualFixo).toBe(1);
    expect(linha.segregacaoComissaoFixa?.receitaComissaoFixa).toBe(100);
    expect(linha.segregacaoComissaoFixa?.receitaNormal).toBe(900);

    // parte normal: nota/IPI repartidos proporcionalmente (90% da receita) -> valorVenda 990, IPI 90
    // margem normal = (990-90)/990 = 90,91% -> >=90% -> comissão normal 3% (João não tem adicional)
    expect(linha.comissaoNormalPercentual).toBe(3);
    expect(linha.adicionalVendedorPercentual).toBe(0);
    expect(linha.segregacaoComissaoFixa?.comissaoValorNormal).toBeCloseTo(27, 1); // 900 * 3%
    expect(linha.segregacaoComissaoFixa?.comissaoValorFixa).toBeCloseTo(1, 10); // 100 * 1%
    expect(linha.comissaoTotal).toBeCloseTo(28, 1);
  });

  it('vendedor especial (Sandro) recebe o adicional +1% em AMBAS as partes do pedido misto — normal E comissão fixa (regra confirmada em 2026-09-10)', async () => {
    const pedidoMisto: PedidoOmie = {
      cabecalho: { codigo_pedido: 64, numero_pedido: '64', etapa: '10', codigo_cliente: 500 },
      det: [
        { produto: { codigo_produto: 1, codigo: 'P1', descricao: 'Produto normal', quantidade: 10, valor_unitario: 100, valor_mercadoria: 900 } },
        { produto: { codigo_produto: 2, codigo: 'P2', descricao: 'CTO Promocional', quantidade: 5, valor_unitario: 20, valor_mercadoria: 100 } },
      ],
      total_pedido: { valor_total_pedido: 1100, valor_mercadorias: 1000, valor_IPI: 100 },
      informacoes_adicionais: { codVend: 300 },
      frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 },
    };
    const vendedorSandro: VendedorInfo[] = [{ codigo: 300, nome: 'Sandro Cedro', inativo: false }];
    const estoques = new Map([
      [1, { listaEstoque: [{ nCMC: 1 }] }],
      [2, { listaEstoque: [{ nCMC: 1 }] }],
    ]);
    const produtos = new Map([[2, { codigo_produto: 2, descricao_familia: 'CTO Promocional' }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoMisto], vendedorSandro, CLIENTES, estoques, new Map(), undefined, produtos);

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    // margem normal 90,91% -> comissão normal 3% + adicional 1% = 4% sobre a parte normal (900)
    expect(linha.comissaoNormalPercentual).toBe(3);
    expect(linha.adicionalVendedorPercentual).toBe(1);
    expect(linha.comissaoFinalPercentual).toBe(4);
    expect(linha.segregacaoComissaoFixa?.comissaoValorNormal).toBeCloseTo(36, 1); // 900 * 4%
    // a parte fixa (CTO Promocional) é 1% + o mesmo adicional de 1% do vendedor = 2% (nunca suprimido pela família)
    expect(linha.segregacaoComissaoFixa?.percentualFixo).toBe(1);
    expect(linha.segregacaoComissaoFixa?.adicionalVendedorPercentual).toBe(1);
    expect(linha.segregacaoComissaoFixa?.comissaoValorFixa).toBeCloseTo(2, 10); // 100 * 2%, nunca 100 * 1%
  });

  it('BUG REAL corrigido: pedido 100% CTO Promocional com vendedor especial (Sandro) soma o adicional — antes ficava travado em 1%/0%', async () => {
    // Reproduz o pedido real nº 53 (Sandro Cedro): 100% de itens da família CTO Promocional,
    // margem de comissionamento alta (86,68%) — antes desta correção, o sistema ignorava tanto a
    // margem quanto o adicional do vendedor nesse caso, sempre travando em 1%/0%.
    const pedidoPromoSandro = pedido({
      codigoPedido: 65,
      numeroPedido: '65',
      etapa: '10',
      codigoCliente: 500,
      codVend: 300,
      quantidade: 10,
      valorUnitario: 500,
      valorMercadoria: 4345,
      valorTotalPedido: 5013,
      valorIPI: 326,
      valorIcmsSt: 342,
    });
    const vendedorSandro: VendedorInfo[] = [{ codigo: 300, nome: 'Sandro Cedro', inativo: false }];
    const estoques = new Map([[1, { listaEstoque: [{ nCMC: 1 }] }]]);
    const produtos = new Map([[1, { codigo_produto: 1, descricao_familia: 'CTO Promocional' }]]);
    const cliente = new ClienteComissionamentoOmieFalso([pedidoPromoSandro], vendedorSandro, CLIENTES, estoques, new Map(), undefined, produtos);

    const resultado = await gerarRelatorioComissionamento(cliente, {});
    const linha = resultado.linhas[0];
    if (linha === undefined) throw new Error('linha ausente');

    // Comissão normal (base) continua sendo o percentual FIXO da família (1%), não a margem — a família
    // trava o percentual base, mas o adicional do vendedor especial sempre soma por cima.
    expect(linha.comissaoNormalPercentual).toBe(1);
    expect(linha.adicionalVendedorPercentual).toBe(1);
    expect(linha.comissaoFinalPercentual).toBe(2);
    expect(linha.segregacaoComissaoFixa).toBeUndefined(); // pedido puro (100% promocional), sem segregação a exibir
    expect(linha.comissaoTotal).toBeCloseTo(4345 * 0.02, 10);
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
      etapa: '10',
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
      etapa: '10',
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
      etapa: '10',
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
      etapa: '10',
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
