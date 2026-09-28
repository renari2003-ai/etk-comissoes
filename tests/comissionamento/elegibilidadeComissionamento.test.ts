import { describe, expect, it } from 'vitest';
import { gerarRelatorioComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import {
  ErroConfiguracaoEtapasComissionamento,
  MOTIVO_EXCECAO_CANCELADO_COM_TITULO_ATIVO,
  MOTIVO_EXCECAO_CANCELADO_SEM_VENDEDOR,
} from '../../src/comissionamento/elegibilidadeComissionamento.js';
import { ClienteComissionamentoOmieFalso, ETAPAS_VENDA_PRODUTO_CONTA_REAL } from '../omie/clienteComissionamentoFalso.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';
import type { ClienteInfo, VendedorInfo } from '../../src/relatorio/relatorioVendas.js';
import type { TituloContaReceber } from '../../src/omie/cliente.js';
import type { EtapaFaturamento } from '../../src/omie/classificacaoDocumento.js';
import { descreverExcecoesRevisaoManual } from '../../public-src/relatorios.js';

/**
 * Elegibilidade do Comissionamento (regra de 2026-09-28): só etapas 50 (PV Liberado Financeiro) e
 * 60 (Faturado), configuração conferida antes de gerar, cancelamento decidido POR REGISTRO antes
 * da consolidação do faturamento parcial, título CANCELADO nunca conta. Venda sem despesas →
 * margem 100% → comissão 3% da receita (cálculo existente, não alterado aqui).
 */

const JOAO = 100;
const MARIA = 200;
const PERIODO = { dataDe: '01/09/2026', dataAte: '30/09/2026' };

function pedido(o: {
  codigo: number;
  numero: string;
  etapa: string;
  valor: number;
  data?: string;
  cancelado?: boolean;
  codVend?: number;
}): PedidoOmie {
  const data = o.data ?? '10/09/2026';
  return {
    cabecalho: { codigo_pedido: o.codigo, numero_pedido: o.numero, etapa: o.etapa, codigo_cliente: 500, data_previsao: data },
    infoCadastro: { dInc: data, dAlt: data, ...(o.cancelado ? { cancelado: 'S' } : {}) },
    det: [
      {
        produto: {
          codigo_produto: 1,
          codigo: 'P1',
          descricao: 'Produto 1',
          quantidade: o.valor === 0 ? 0 : 1,
          valor_unitario: o.valor,
          valor_mercadoria: o.valor,
        },
      },
    ],
    total_pedido: {
      valor_total_pedido: o.valor,
      valor_mercadorias: o.valor,
      valor_IPI: 0,
      valor_st: 0,
      valor_icms: 0,
      valor_pis: 0,
      valor_cofins: 0,
      valor_ibs: 0,
      valor_cbs: 0,
    },
    informacoes_adicionais: { codVend: o.codVend ?? JOAO },
    frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 },
  };
}

let proximoLancamento = 1;
function titulo(o: {
  codigoPedido: number;
  numeroPedido: string;
  valor: number;
  status: string;
  vencimento?: string;
  nf?: string;
  codVend?: number;
}): TituloContaReceber {
  return {
    codigoLancamentoOmie: proximoLancamento++,
    codigoPedido: o.codigoPedido,
    numeroPedido: o.numeroPedido,
    numeroParcela: '001/001',
    numeroNotaFiscal: o.nf ?? `NF-${o.codigoPedido}`,
    valorDocumento: o.valor,
    dataVencimento: o.vencimento ?? '20/09/2026',
    dataEmissao: '10/09/2026',
    statusTitulo: o.status,
    codigoVendedor: o.codVend ?? JOAO,
  };
}

const VENDEDORES: VendedorInfo[] = [
  { codigo: JOAO, nome: 'João', inativo: false },
  { codigo: MARIA, nome: 'Maria', inativo: false },
];
const CLIENTES = new Map<number, ClienteInfo>([[500, { codigo: 500, razaoSocial: 'Cliente 500', nomeFantasia: 'Cliente 500' }]]);

function cliente(pedidos: PedidoOmie[], titulos: TituloContaReceber[] = [], etapas: EtapaFaturamento[] = ETAPAS_VENDA_PRODUTO_CONTA_REAL) {
  const porVendedor = new Map<number, TituloContaReceber[]>();
  for (const t of titulos) porVendedor.set(t.codigoVendedor ?? JOAO, [...(porVendedor.get(t.codigoVendedor ?? JOAO) ?? []), t]);
  return new ClienteComissionamentoOmieFalso(pedidos, VENDEDORES, CLIENTES, new Map(), porVendedor, etapas);
}

describe('etapas elegíveis — lista fechada 50/60', () => {
  it('etapa 20 ("Pedido de Venda") não entra', async () => {
    const r = await gerarRelatorioComissionamento(cliente([pedido({ codigo: 1, numero: '1', etapa: '20', valor: 1000 })]), {});
    expect(r.linhas).toHaveLength(0);
    expect(r.resumo.valorVendaTotal).toBe(0);
  });

  it('etapa 50 ("PV Liberado Financeiro") entra', async () => {
    const r = await gerarRelatorioComissionamento(cliente([pedido({ codigo: 1, numero: '1', etapa: '50', valor: 1000 })]), {});
    expect(r.linhas.map((l) => l.numeroPedido)).toEqual(['1']);
    expect(r.resumo.comissaoTotalCalculada).toBe(30);
  });

  it('etapa 60 ("Faturado") entra', async () => {
    const r = await gerarRelatorioComissionamento(cliente([pedido({ codigo: 1, numero: '1', etapa: '60', valor: 1000 })]), {});
    expect(r.linhas.map((l) => l.numeroPedido)).toEqual(['1']);
  });

  it('etapas 70/80 (aprovações, código maior que 50) e desconhecida não entram', async () => {
    const r = await gerarRelatorioComissionamento(
      cliente([
        pedido({ codigo: 1, numero: '1', etapa: '70', valor: 1000 }),
        pedido({ codigo: 2, numero: '2', etapa: '80', valor: 1000 }),
        pedido({ codigo: 3, numero: '3', etapa: '99', valor: 1000 }),
      ]),
      {},
    );
    expect(r.linhas).toHaveLength(0);
    expect(r.documentosAmbiguosExcluidos).toBe(1);
  });
});

describe('validação da configuração de etapas da Omie', () => {
  const comEtapa = (codigo: string, mudanca: Partial<EtapaFaturamento>) =>
    ETAPAS_VENDA_PRODUTO_CONTA_REAL.map((e) => (e.codigo === codigo ? { ...e, ...mudanca } : e));

  it('etapa 50 renomeada: falha explícita, sem gerar relatório', async () => {
    const c = cliente([pedido({ codigo: 1, numero: '1', etapa: '50', valor: 1000 })], [], comEtapa('50', { descricao: 'Separação' }));
    await expect(gerarRelatorioComissionamento(c, {})).rejects.toThrow(ErroConfiguracaoEtapasComissionamento);
    await expect(gerarRelatorioComissionamento(c, {})).rejects.toThrow(/etapa 50 .*"PV Liberado Financeiro".*"Separação"/);
  });

  it('etapa 50 inativa ou ausente: falha explícita', async () => {
    await expect(gerarRelatorioComissionamento(cliente([], [], comEtapa('50', { inativa: true })), {})).rejects.toThrow(
      ErroConfiguracaoEtapasComissionamento,
    );
    const semCinquenta = ETAPAS_VENDA_PRODUTO_CONTA_REAL.filter((e) => e.codigo !== '50');
    await expect(gerarRelatorioComissionamento(cliente([], [], semCinquenta), {})).rejects.toThrow(/não existe/);
  });

  it('etapa 60 que deixou de ser "Faturado": falha explícita', async () => {
    await expect(gerarRelatorioComissionamento(cliente([], [], comEtapa('60', { descricao: 'Entrega' })), {})).rejects.toThrow(
      ErroConfiguracaoEtapasComissionamento,
    );
  });

  it('só acento/caixa diferentes não bloqueiam; texto parcial bloqueia', async () => {
    await expect(gerarRelatorioComissionamento(cliente([], [], comEtapa('50', { descricao: ' pv liberado FINANCEIRO ' })), {})).resolves.toBeDefined();
    await expect(gerarRelatorioComissionamento(cliente([], [], comEtapa('50', { descricao: 'PV Liberado' })), {})).rejects.toThrow(
      ErroConfiguracaoEtapasComissionamento,
    );
  });
});

describe('cancelamento — decidido por REGISTRO', () => {
  it('cancelado sem título não entra e não vira exceção', async () => {
    const r = await gerarRelatorioComissionamento(cliente([pedido({ codigo: 36, numero: '36', etapa: '50', valor: 5000, cancelado: true })]), {});
    expect(r.linhas).toHaveLength(0);
    expect(r.excecoesRevisaoManual).toEqual([]);
  });

  it('cancelado com título CANCELADO não entra, não gera parcela nem comissão', async () => {
    const r = await gerarRelatorioComissionamento(
      cliente(
        [pedido({ codigo: 168, numero: '168', etapa: '60', valor: 443904, cancelado: true })],
        [titulo({ codigoPedido: 168, numeroPedido: '168', valor: 443904, status: 'CANCELADO' })],
      ),
      {},
    );
    expect(r.linhas).toHaveLength(0);
    expect(r.excecoesRevisaoManual).toEqual([]);
    expect(r.resumo).toMatchObject({ valorVendaTotal: 0, comissaoPendente: 0, comissaoLiberada: 0, quantidadeParcelasTotal: 0 });
  });

  it.each([
    ['RECEBIDO'],
    ['A VENCER'],
    ['ATRASADO'],
  ])('cancelado com título %s: fora do cálculo e listado como exceção para revisão manual', async (status) => {
    const r = await gerarRelatorioComissionamento(
      cliente(
        [pedido({ codigo: 77, numero: '77', etapa: '60', valor: 1000, cancelado: true })],
        [
          titulo({ codigoPedido: 77, numeroPedido: '77', valor: 600, status, nf: 'NF-77' }),
          titulo({ codigoPedido: 77, numeroPedido: '77', valor: 400, status: 'CANCELADO', nf: 'NF-77' }),
        ],
      ),
      {},
    );
    expect(r.linhas).toHaveLength(0);
    expect(r.resumo.comissaoTotalCalculada).toBe(0);
    expect(r.excecoesRevisaoManual).toEqual([
      {
        codigoPedido: 77,
        numeroPedido: '77',
        etapa: '60',
        codigoVendedor: JOAO,
        nomeVendedor: 'João',
        valor: 1000,
        titulos: [{ numeroParcela: '001/001', numeroNotaFiscal: 'NF-77', statusTitulo: status, valor: 600, dataVencimento: '20/09/2026' }],
        motivo: MOTIVO_EXCECAO_CANCELADO_COM_TITULO_ATIVO,
      },
    ]);
  });

  it('cancelado sem vendedor: títulos não verificáveis → exceção, nunca "sem título" nem comissão', async () => {
    const semVendedor = pedido({ codigo: 55, numero: '55', etapa: '60', valor: 1000, cancelado: true });
    delete semVendedor.informacoes_adicionais;
    const r = await gerarRelatorioComissionamento(cliente([semVendedor]), {});
    const texto = descreverExcecoesRevisaoManual(r.excecoesRevisaoManual);
    expect(r.linhas).toHaveLength(0);
    expect(r.pedidosSemVendedorExcluidos).toBe(0);
    expect(r.resumo.comissaoTotalCalculada).toBe(0);
    expect(r.excecoesRevisaoManual).toEqual([
      {
        codigoPedido: 55,
        numeroPedido: '55',
        etapa: '60',
        codigoVendedor: null,
        nomeVendedor: null,
        valor: 1000,
        titulos: [],
        motivo: MOTIVO_EXCECAO_CANCELADO_SEM_VENDEDOR,
      },
    ]);
    expect(texto).toContain('pedido nº 55');
    expect(texto).toContain('vendedor não identificado');
    expect(texto).toContain('títulos: nenhum verificado');
    expect(texto).toContain(MOTIVO_EXCECAO_CANCELADO_SEM_VENDEDOR);
  });

  it('título CANCELADO de pedido válido não gera parcela, comissão pendente nem valor faturado', async () => {
    const r = await gerarRelatorioComissionamento(
      cliente(
        [pedido({ codigo: 1, numero: '1', etapa: '60', valor: 1000 })],
        [
          titulo({ codigoPedido: 1, numeroPedido: '1', valor: 1000, status: 'RECEBIDO', nf: 'NF-2' }),
          titulo({ codigoPedido: 1, numeroPedido: '1', valor: 1000, status: 'CANCELADO', nf: 'NF-1' }),
        ],
      ),
      {},
    );
    const [linha] = r.linhas;
    expect(linha?.parcelas.map((p) => p.statusTitulo)).toEqual(['RECEBIDO']);
    expect(linha?.comissaoLiberada).toBe(30);
    expect(linha?.comissaoPendente).toBe(0);
    expect(linha?.valorFaturado).toBe(1000);
  });
});

describe('faturamento parcial — filtros antes da consolidação', () => {
  it('fatura filha cancelada (caso real do pedido 28) não remove a fatura irmã válida', async () => {
    const r = await gerarRelatorioComissionamento(
      cliente(
        [
          pedido({ codigo: 2800, numero: '28', etapa: '50', valor: 0 }), // original, itens já movidos
          pedido({ codigo: 2801, numero: '28', etapa: '60', valor: 1289.86, cancelado: true }),
          pedido({ codigo: 2802, numero: '28', etapa: '60', valor: 2518.78 }),
        ],
        [
          titulo({ codigoPedido: 2801, numeroPedido: '28', valor: 1289.86, status: 'CANCELADO', nf: '00025741' }),
          titulo({ codigoPedido: 2802, numeroPedido: '28', valor: 2518.78, status: 'RECEBIDO', nf: '00025770' }),
        ],
      ),
      {},
    );
    expect(r.linhas).toHaveLength(1);
    const [linha] = r.linhas;
    expect(linha?.valorBruto).toBe(2518.78);
    expect(linha?.parcelas.map((p) => [p.numeroNotaFiscal, p.statusTitulo])).toEqual([['00025770', 'RECEBIDO']]);
    expect(linha?.comissaoLiberada).toBeCloseTo(75.56, 2);
    expect(r.excecoesRevisaoManual).toEqual([]);
  });

  it('faturamento parcial válido continua consolidando em uma linha com a soma dos registros', async () => {
    const r = await gerarRelatorioComissionamento(
      cliente(
        [
          pedido({ codigo: 1540, numero: '154', etapa: '50', valor: 300 }),
          pedido({ codigo: 1541, numero: '154', etapa: '60', valor: 500 }),
          pedido({ codigo: 1542, numero: '154', etapa: '60', valor: 200 }),
        ],
        [
          titulo({ codigoPedido: 1541, numeroPedido: '154', valor: 500, status: 'RECEBIDO', nf: 'NF-A' }),
          titulo({ codigoPedido: 1542, numeroPedido: '154', valor: 200, status: 'A VENCER', nf: 'NF-B' }),
        ],
      ),
      {},
    );
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ codigoPedido: 1540, valorBruto: 1000, valorFaturado: 700, saldoAFaturar: 300 });
    expect(r.linhas[0]?.parcelas.map((p) => p.numeroFaturaParcial)).toEqual(['154/1', '154/2']);
  });
});

describe('pedidos anteriores (janela de 12 meses) — mesma regra', () => {
  it('etapa não elegível, cancelado e cancelado com título ativo recebem o mesmo tratamento do período', async () => {
    const r = await gerarRelatorioComissionamento(
      cliente(
        [
          pedido({ codigo: 900, numero: '900', etapa: '60', valor: 1000, data: '10/06/2026' }), // válido
          pedido({ codigo: 901, numero: '901', etapa: '20', valor: 1000, data: '10/06/2026' }), // etapa fora
          pedido({ codigo: 902, numero: '902', etapa: '60', valor: 1000, data: '10/06/2026', cancelado: true }), // título ativo
          pedido({ codigo: 903, numero: '903', etapa: '60', valor: 1000, data: '10/06/2026', cancelado: true }), // título cancelado
        ],
        [
          titulo({ codigoPedido: 900, numeroPedido: '900', valor: 1000, status: 'A VENCER', vencimento: '15/09/2026' }),
          titulo({ codigoPedido: 901, numeroPedido: '901', valor: 1000, status: 'A VENCER', vencimento: '15/09/2026' }),
          titulo({ codigoPedido: 902, numeroPedido: '902', valor: 1000, status: 'RECEBIDO', vencimento: '15/09/2026' }),
          titulo({ codigoPedido: 903, numeroPedido: '903', valor: 1000, status: 'CANCELADO', vencimento: '15/09/2026' }),
        ],
      ),
      PERIODO,
    );
    expect(r.linhas.map((l) => [l.numeroPedido, l.origem])).toEqual([['900', 'PARCELA_PERIODO_ANTERIOR']]);
    expect(r.excecoesRevisaoManual.map((e) => e.numeroPedido)).toEqual(['902']);
    expect(r.resumo.comissaoPendente).toBe(30);
  });
});

describe('restrição por vendedor', () => {
  it('com vendedor filtrado, registros e exceções de outro vendedor nunca aparecem', async () => {
    const c = cliente(
      [
        pedido({ codigo: 1, numero: '1', etapa: '60', valor: 1000 }),
        pedido({ codigo: 2, numero: '2', etapa: '60', valor: 1000, codVend: MARIA }),
        pedido({ codigo: 3, numero: '3', etapa: '60', valor: 1000, codVend: MARIA, cancelado: true }),
      ],
      [titulo({ codigoPedido: 3, numeroPedido: '3', valor: 1000, status: 'RECEBIDO', codVend: MARIA })],
    );
    const r = await gerarRelatorioComissionamento(c, { codigoVendedor: JOAO });
    expect(r.linhas.map((l) => l.numeroPedido)).toEqual(['1']);
    expect(r.excecoesRevisaoManual).toEqual([]);
    expect(c.consultasTitulosPorVendedor).not.toContain(MARIA);
  });
});

describe('tela e PDF — mesma base', () => {
  it('o aviso de exceções (impresso junto no PDF) traz pedido, vendedor, etapa, títulos, valor e motivo', () => {
    const texto = descreverExcecoesRevisaoManual([
      {
        codigoPedido: 77,
        numeroPedido: '77',
        etapa: '60',
        nomeVendedor: 'João',
        valor: 1000,
        titulos: [{ numeroParcela: '001/001', statusTitulo: 'RECEBIDO', valor: 600 }],
        motivo: MOTIVO_EXCECAO_CANCELADO_COM_TITULO_ATIVO,
      },
    ]);
    expect(texto).toContain('pedido nº 77');
    expect(texto).toContain('etapa 60');
    expect(texto).toContain('vendedor João');
    expect(texto).toContain('RECEBIDO');
    expect(texto).toMatch(/R\$\s?1\.000,00/);
    expect(texto).toContain(MOTIVO_EXCECAO_CANCELADO_COM_TITULO_ATIVO);
  });
});
