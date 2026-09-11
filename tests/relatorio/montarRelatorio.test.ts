import { describe, expect, it } from 'vitest';
import { ErroTipoDocumentoIncompativel, montarRelatorioPedido } from '../../src/relatorio/montarRelatorio.js';
import { CLIENTE_PADRAO, ClienteOmieFalso, ETAPAS_VENDA_PRODUTO_PADRAO } from '../omie/clienteFalso.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';

function pedidoFixo(overrides: Partial<PedidoOmie> = {}): PedidoOmie {
  return {
    cabecalho: {
      codigo_pedido: 111,
      numero_pedido: '001',
      etapa: '10',
      codigo_cliente: 999,
    },
    det: [
      {
        produto: {
          codigo_produto: 1,
          codigo: 'A1',
          descricao: 'Item A',
          quantidade: 10,
          valor_unitario: 20,
          valor_mercadoria: 200,
        },
      },
      {
        produto: {
          codigo_produto: 2,
          codigo: 'B1',
          descricao: 'Item B (sem custo)',
          quantidade: 5,
          valor_unitario: 10,
          valor_mercadoria: 50,
        },
      },
    ],
    total_pedido: { valor_total_pedido: 250 },
    ...overrides,
  };
}

describe('montarRelatorioPedido', () => {
  it('monta o relatório completo, com custo ESTIMADO (preço ÷ 1,90) por item e totais ponderados (regra temporária de 2026-09-10)', async () => {
    const cliente = new ClienteOmieFalso(pedidoFixo(), new Map());

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.itens).toHaveLength(2);
    // item A: valor_unitario 20 / 1,90 = 10,5263
    expect(relatorio.itens[0]?.custoUnitario).toBeCloseTo(10.5263, 4);
    expect(relatorio.itens[0]?.origemCusto).toBe('estimado.padrao');
    expect(relatorio.itens[0]?.alertas).toContain('custo_estimado');
    // item B: valor_unitario 10 / 1,90 = 5,2632
    expect(relatorio.itens[1]?.custoUnitario).toBeCloseTo(5.2632, 4);
    expect(relatorio.itens[1]?.origemCusto).toBe('estimado.padrao');

    expect(relatorio.totais.receitaTotal).toBe(250);
    // custo estimado sempre resolve quando há preço de venda -> nenhum item "sem custo"
    expect(relatorio.totais.itensSemCusto).toBe(0);
    expect(relatorio.alertaDivergenciaTotal).toBeNull(); // 250 == valor_total_pedido
  });

  it('usa o divisor 1,75 para produtos da família "Linha Premium" (seção da regra de 2026-09-10)', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map(),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      CLIENTE_PADRAO,
      new Map([[1, { codigo_produto: 1, descricao_familia: 'Linha Premium' }]]),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    // item A (família premium): 20 / 1,75 = 11,4286
    expect(relatorio.itens[0]?.custoUnitario).toBeCloseTo(11.4286, 4);
    expect(relatorio.itens[0]?.origemCusto).toBe('estimado.premium');
    // item B (produto não configurado no fake -> consultarProduto rejeita -> cai no divisor padrão)
    expect(relatorio.itens[1]?.custoUnitario).toBeCloseTo(5.2632, 4);
    expect(relatorio.itens[1]?.origemCusto).toBe('estimado.padrao');
  });

  it('usa o preço da TABELA DE VENDAS ATIVA do produto (cadastro), não o preço gravado no pedido (regra de 2026-09-10)', async () => {
    // item A no pedido custa 20 (valor_unitario da linha), mas a tabela ativa do produto tem 40 — a
    // tabela deve prevalecer (confirmado contra a API real: preço do pedido difere do de tabela em
    // praticamente todos os casos, pois carrega ajustes/impostos daquela venda específica).
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map(),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      CLIENTE_PADRAO,
      new Map([[1, { codigo_produto: 1, descricao_familia: 'Produto Acabado', valor_unitario: 40 }]]),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    // 40 (tabela) / 1,90 = 21,0526 — nunca 20 (preço do pedido) / 1,90 = 10,5263
    expect(relatorio.itens[0]?.custoUnitario).toBeCloseTo(21.0526, 4);
  });

  it('cai no preço do pedido quando o cadastro do produto não informa preço de tabela (nunca quebra o cálculo)', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map(),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      CLIENTE_PADRAO,
      new Map([[1, { codigo_produto: 1, descricao_familia: 'Produto Acabado' }]]), // sem valor_unitario no cadastro
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    // volta para o preço do pedido (20) / 1,90 = 10,5263
    expect(relatorio.itens[0]?.custoUnitario).toBeCloseTo(10.5263, 4);
  });

  it('não derruba o relatório quando a consulta de família do produto falha (regra crítica) — cai no divisor padrão', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map(),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      CLIENTE_PADRAO,
      new Map([[1, new Error('falha simulada de rede na consulta do produto')]]),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    // Falha ao identificar a família não impede o cálculo — só usa o divisor padrão.
    expect(relatorio.itens[0]?.custoUnitario).toBeCloseTo(10.5263, 4);
    expect(relatorio.itens[0]?.origemCusto).toBe('estimado.padrao');
    expect(relatorio.totais.itensSemCusto).toBe(0);
  });

  it('produto sem preço de venda (valor_unitario 0) fica "sem custo" — o custo estimado nunca inventa um valor', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo({
        det: [
          {
            produto: {
              codigo_produto: 1,
              codigo: 'A1',
              descricao: 'Item sem preço',
              quantidade: 10,
              valor_unitario: 0,
              valor_mercadoria: 0,
            },
          },
        ],
      }),
      new Map(),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.itens[0]?.origemCusto).toBe('sem custo');
    expect(relatorio.itens[0]?.alertas).toContain('sem_custo');
  });

  it('gera alerta de divergência quando a soma das receitas difere do total da Omie em mais de R$ 0,05', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo({ total_pedido: { valor_total_pedido: 300 } }), // frete embutido, por exemplo
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.alertaDivergenciaTotal).not.toBeNull();
    expect(relatorio.alertaDivergenciaTotal?.totalInformadoOmie).toBe(300);
  });
});

describe('montarRelatorioPedido — nome do cliente', () => {
  it('usa a Razão Social retornada por ConsultarCliente', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      { codigo: 999, razaoSocial: 'Empresa ABC Ltda', nomeFantasia: 'ABC' },
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.nomeCliente).toBe('Empresa ABC Ltda');
    expect(relatorio.avisoClienteNaoIdentificado).toBeUndefined();
  });

  it('usa o Nome Fantasia quando não há Razão Social', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      { codigo: 999, razaoSocial: '', nomeFantasia: 'ABC Fantasia' },
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.nomeCliente).toBe('ABC Fantasia');
  });

  it('mostra cliente não identificado (null) quando a Omie não encontra o cliente, sem quebrar o relatório', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      null,
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.nomeCliente).toBeNull();
    expect(relatorio.avisoClienteNaoIdentificado).toBeUndefined();
    expect(relatorio.totais.receitaTotal).toBe(250); // resto do relatório continua íntegro
  });

  it('não derruba o relatório quando a consulta do cliente falha — mostra aviso discreto', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      new Error('falha simulada de rede na consulta de cliente'),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.nomeCliente).toBeNull();
    expect(relatorio.avisoClienteNaoIdentificado).toBeTruthy();
    expect(relatorio.itens).toHaveLength(2); // resto do relatório continua íntegro
  });

  it('usa CLIENTE_PADRAO do fake quando o teste não configura um cliente específico', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo(),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.nomeCliente).toBe(CLIENTE_PADRAO.razaoSocial);
  });
});

describe('montarRelatorioPedido — separação Pedido vs Orçamento (regra crítica de negócio)', () => {
  it('classifica um pedido (etapa fora do rótulo "Orçamento") como PEDIDO, sem aviso de orçamento', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo({ cabecalho: { codigo_pedido: 111, numero_pedido: '001', etapa: '10', codigo_cliente: 999 } }),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026', 'PEDIDO');

    expect(relatorio.tipoDocumento).toBe('PEDIDO');
    expect(relatorio.avisoOrcamento).toBeUndefined();
    expect(relatorio.motivoClassificacaoAmbigua).toBeUndefined();
  });

  it('classifica um orçamento (etapa "00") como ORCAMENTO e nunca como PEDIDO, com aviso de projeção', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo({ cabecalho: { codigo_pedido: 222, numero_pedido: '002', etapa: '00', codigo_cliente: 999 } }),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 222 }, '03/09/2026', 'ORCAMENTO');

    expect(relatorio.tipoDocumento).toBe('ORCAMENTO');
    expect(relatorio.tipoDocumento).not.toBe('PEDIDO');
    expect(relatorio.avisoOrcamento).toMatch(/intenção de compra/i);
    expect(relatorio.avisoOrcamento).toMatch(/não devem ser somados/i);
  });

  it('rejeita com ErroTipoDocumentoIncompativel ao consultar um orçamento pela rota de pedidos (nunca mistura)', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo({ cabecalho: { codigo_pedido: 222, numero_pedido: '002', etapa: '00', codigo_cliente: 999 } }),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
    );

    await expect(montarRelatorioPedido(cliente, { codigoPedido: 222 }, '03/09/2026', 'PEDIDO')).rejects.toThrow(
      ErroTipoDocumentoIncompativel,
    );
  });

  it('rejeita com ErroTipoDocumentoIncompativel ao consultar um pedido pela rota de orçamentos (nunca mistura)', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo({ cabecalho: { codigo_pedido: 111, numero_pedido: '001', etapa: '10', codigo_cliente: 999 } }),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
    );

    await expect(montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026', 'ORCAMENTO')).rejects.toThrow(
      ErroTipoDocumentoIncompativel,
    );
  });

  it('não classifica arbitrariamente uma etapa desconhecida: fica ambígua, com motivo, e não é tratada como PEDIDO nem ORCAMENTO', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo({ cabecalho: { codigo_pedido: 333, numero_pedido: '003', etapa: '999', codigo_cliente: 999 } }),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
      ETAPAS_VENDA_PRODUTO_PADRAO,
    );

    // Sem tipoEsperado: uma consulta direta por identificador exato ainda
    // retorna os dados (não bloqueia), mas nunca classifica por adivinhação.
    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 333 }, '03/09/2026');

    expect(relatorio.tipoDocumento).toBeNull();
    expect(relatorio.motivoClassificacaoAmbigua).toContain('999');
    expect(relatorio.avisoOrcamento).toBeUndefined();
  });

  it('quando ambígua, não força incompatibilidade mesmo se um tipoEsperado for passado (não há evidência de mismatch)', async () => {
    const cliente = new ClienteOmieFalso(
      pedidoFixo({ cabecalho: { codigo_pedido: 333, numero_pedido: '003', etapa: '999', codigo_cliente: 999 } }),
      new Map([
        [1, { listaEstoque: [{ nCMC: 12 }] }],
        [2, { listaEstoque: [{ nCMC: 4 }] }],
      ]),
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 333 }, '03/09/2026', 'PEDIDO');
    expect(relatorio.tipoDocumento).toBeNull();
  });
});

describe('montarRelatorioPedido — faturamento parcial (regra de 2026-09-10)', () => {
  it('monta o resumo de faturamento a partir dos títulos vinculados por número do pedido (nCodPedido diferente do original, igual ao pedido real "154")', async () => {
    const pedidoParcial = pedidoFixo({
      cabecalho: { codigo_pedido: 900, numero_pedido: '154', etapa: '10', codigo_cliente: 999 },
      total_pedido: { valor_total_pedido: 12425.22 },
      informacoes_adicionais: { codVend: 100 },
    });
    const titulos = new Map([
      [
        100,
        [
          {
            codigoLancamentoOmie: 1,
            codigoPedido: 901, // diferente de 900 — mesma situação do pedido real "154"
            numeroPedido: '154',
            numeroParcela: '001/001',
            numeroNotaFiscal: '00025739',
            valorDocumento: 3538.21,
            dataVencimento: '01/01/2026',
            statusTitulo: 'RECEBIDO',
            codigoVendedor: 100,
          },
          {
            codigoLancamentoOmie: 2,
            codigoPedido: 902,
            numeroPedido: '154',
            numeroParcela: '001/001',
            numeroNotaFiscal: '00025767',
            valorDocumento: 6100.32,
            dataVencimento: '01/02/2026',
            statusTitulo: 'A VENCER',
            codigoVendedor: 100,
          },
        ],
      ],
    ]);
    const cliente = new ClienteOmieFalso(
      pedidoParcial,
      new Map(),
      ETAPAS_VENDA_PRODUTO_PADRAO,
      CLIENTE_PADRAO,
      new Map(),
      titulos,
    );

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 900 }, '03/09/2026');

    expect(relatorio.faturamento).toBeDefined();
    expect(relatorio.faturamento?.valorFaturado).toBeCloseTo(9638.53, 2);
    // valorPedido = saldo ainda não faturado (12425.22, o que a Omie devolve em total_pedido para o
    // registro original) + já faturado (9638.53) — NUNCA só o saldo (bug corrigido em 2026-09-10: a
    // Omie zera a quantidade/valor de cada item assim que ele é movido para uma fatura parcial).
    expect(relatorio.faturamento?.valorPedido).toBeCloseTo(22063.75, 2);
    expect(relatorio.faturamento?.percentualFaturado).toBeCloseTo(43.68, 1);
    expect(relatorio.faturamento?.notasFiscais).toHaveLength(2);
    const nf1 = relatorio.faturamento?.notasFiscais.find((nf) => nf.numero === '00025739');
    expect(nf1?.valorTotal).toBeCloseTo(3538.21, 2);
    expect(nf1?.parcelasBaixadas).toBe(1);
    const nf2 = relatorio.faturamento?.notasFiscais.find((nf) => nf.numero === '00025767');
    expect(nf2?.valorTotal).toBeCloseTo(6100.32, 2);
    expect(nf2?.parcelasBaixadas).toBe(0);
  });

  it('não inclui faturamento quando nenhum título é encontrado (pedido ainda não faturado)', async () => {
    const pedidoSemFatura = pedidoFixo({ informacoes_adicionais: { codVend: 100 } });
    const cliente = new ClienteOmieFalso(pedidoSemFatura, new Map());

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.faturamento).toBeUndefined();
  });

  it('não inclui faturamento quando o pedido não tem vendedor identificado (nunca adivinha)', async () => {
    const cliente = new ClienteOmieFalso(pedidoFixo(), new Map());

    const relatorio = await montarRelatorioPedido(cliente, { codigoPedido: 111 }, '03/09/2026');

    expect(relatorio.faturamento).toBeUndefined();
  });
});
