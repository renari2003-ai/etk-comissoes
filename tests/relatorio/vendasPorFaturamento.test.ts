import { describe, expect, it } from 'vitest';
import { gerarRelatorioVendasFaturadas } from '../../src/relatorio/vendasPorFaturamento.js';
import { ClienteComissionamentoOmieFalso } from '../omie/clienteComissionamentoFalso.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';
import type { ClienteInfo, VendedorInfo } from '../../src/relatorio/relatorioVendas.js';
import type { TituloContaReceber } from '../../src/omie/cliente.js';

/**
 * Vendas — Resultado Concreto: período pela DATA DE FATURAMENTO (regra de 2026-11-12). Período de
 * teste 01/10/2026 a 31/10/2026, "hoje" = 12/11/2026. O fake lista por inclusão OU alteração
 * (igual à Omie real); data de faturamento = `data_emissao` do título.
 */
const OUTUBRO = { dataDe: '01/10/2026', dataAte: '31/10/2026' };
const HOJE = '12/11/2026';
const JOAO = 100;
const MARIA = 200;
const VENDEDORES: VendedorInfo[] = [
  { codigo: JOAO, nome: 'João', inativo: false },
  { codigo: MARIA, nome: 'Maria', inativo: false },
];
const CLIENTES = new Map<number, ClienteInfo>([[500, { codigo: 500, razaoSocial: 'Cliente 500', nomeFantasia: 'Cliente 500' }]]);

function pedido(o: { codigo: number; numero: string; dInc: string; dAlt?: string; previsao?: string; valor: number; etapa?: string; codVend?: number | null }): PedidoOmie {
  return {
    cabecalho: { codigo_pedido: o.codigo, numero_pedido: o.numero, etapa: o.etapa ?? '60', codigo_cliente: 500, data_previsao: o.previsao ?? o.dInc },
    infoCadastro: { dInc: o.dInc, dAlt: o.dAlt ?? o.dInc },
    det: [{ produto: { codigo_produto: 1, codigo: 'P1', descricao: 'Produto 1', quantidade: 1, valor_unitario: o.valor, valor_mercadoria: o.valor } }],
    total_pedido: {
      valor_total_pedido: o.valor, valor_mercadorias: o.valor, valor_IPI: 0, valor_st: 0,
      valor_icms: 0, valor_pis: 0, valor_cofins: 0, valor_ibs: 0, valor_cbs: 0,
    },
    informacoes_adicionais: o.codVend === null ? {} : { codVend: o.codVend ?? JOAO },
    frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 },
  } as PedidoOmie;
}

let lancamento = 1;
function titulo(o: { codigoPedido: number | null; numeroPedido: string; emissao: string | null; valor?: number; status?: string; codVend?: number }): TituloContaReceber {
  return {
    codigoLancamentoOmie: lancamento++,
    codigoPedido: o.codigoPedido,
    numeroPedido: o.numeroPedido,
    numeroParcela: '001/001',
    numeroNotaFiscal: `NF-${o.numeroPedido}-${o.codigoPedido}`,
    valorDocumento: o.valor ?? 1000,
    dataVencimento: '30/12/2026',
    dataEmissao: o.emissao,
    statusTitulo: o.status ?? 'A VENCER',
    codigoVendedor: o.codVend ?? JOAO,
  };
}

function cliente(pedidos: PedidoOmie[], titulosJoao: TituloContaReceber[], titulosMaria: TituloContaReceber[] = []) {
  return new ClienteComissionamentoOmieFalso(pedidos, VENDEDORES, CLIENTES, new Map(), new Map([[JOAO, titulosJoao], [MARIA, titulosMaria]]));
}

describe('Vendas — período pela data de faturamento', () => {
  it('traz só o faturado em outubro: fora o faturado em setembro (alterado em outubro) e o faturado em novembro', async () => {
    const c = cliente(
      [
        pedido({ codigo: 1, numero: '1', dInc: '20/08/2026', dAlt: '08/10/2026', previsao: '08/09/2026', valor: 1000 }), // faturado em setembro
        pedido({ codigo: 3, numero: '3', dInc: '01/10/2026', previsao: '03/10/2026', valor: 2000 }), // faturado em outubro
        pedido({ codigo: 7, numero: '7', dInc: '15/10/2026', dAlt: '05/11/2026', previsao: '20/10/2026', valor: 3000 }), // faturado em novembro
      ],
      [
        titulo({ codigoPedido: 1, numeroPedido: '1', emissao: '10/09/2026' }),
        titulo({ codigoPedido: 3, numeroPedido: '3', emissao: '06/10/2026' }),
        titulo({ codigoPedido: 7, numeroPedido: '7', emissao: '05/11/2026' }),
      ],
    );
    const r = await gerarRelatorioVendasFaturadas(c, OUTUBRO, HOJE);
    expect(r.linhas.map((l) => [l.numeroPedido, l.data])).toEqual([['3', '06/10/2026']]);
    expect(r.resumo.quantidadeDocumentos).toBe(1);
    expect(r.resumo.valorLiquidoTotal).toBe(2000);
  });

  it('faturado em outubro e alterado de novo depois do mês ainda entra (listagem vai até hoje)', async () => {
    const c = cliente(
      [pedido({ codigo: 9, numero: '9', dInc: '25/09/2026', dAlt: '10/11/2026', valor: 1500 })],
      [titulo({ codigoPedido: 9, numeroPedido: '9', emissao: '20/10/2026' })],
    );
    const r = await gerarRelatorioVendasFaturadas(c, OUTUBRO, HOJE);
    expect(r.linhas.map((l) => [l.numeroPedido, l.data])).toEqual([['9', '20/10/2026']]);
  });

  it('pedido ainda não faturado (sem título) ou só com título cancelado fica fora', async () => {
    const c = cliente(
      [
        pedido({ codigo: 20, numero: '20', dInc: '10/10/2026', etapa: '50', valor: 1000 }),
        pedido({ codigo: 21, numero: '21', dInc: '10/10/2026', valor: 1000 }),
      ],
      [titulo({ codigoPedido: 21, numeroPedido: '21', emissao: '11/10/2026', status: 'CANCELADO' })],
    );
    const r = await gerarRelatorioVendasFaturadas(c, OUTUBRO, HOJE);
    expect(r.linhas).toEqual([]);
  });

  it('faturamento parcial: entra só a fatura emitida no período', async () => {
    const c = cliente(
      [
        pedido({ codigo: 3000, numero: '30', dInc: '01/09/2026', dAlt: '15/10/2026', valor: 0 }), // original (saldo zerado)
        pedido({ codigo: 3001, numero: '30', dInc: '10/09/2026', valor: 1000 }), // 1ª fatura (setembro)
        pedido({ codigo: 3002, numero: '30', dInc: '15/10/2026', valor: 400 }), // 2ª fatura (outubro)
      ],
      [
        titulo({ codigoPedido: 3001, numeroPedido: '30', emissao: '10/09/2026', valor: 1000 }),
        titulo({ codigoPedido: 3002, numeroPedido: '30', emissao: '15/10/2026', valor: 400 }),
      ],
    );
    const r = await gerarRelatorioVendasFaturadas(c, OUTUBRO, HOJE);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.data).toBe('15/10/2026');
    expect(r.linhas[0]!.receitaTotal).toBe(400);
  });

  it('título sem código do pedido: vincula pelo número', async () => {
    const c = cliente(
      [pedido({ codigo: 40, numero: '40', dInc: '02/10/2026', valor: 800 })],
      [titulo({ codigoPedido: null, numeroPedido: '40', emissao: '03/10/2026' })],
    );
    const r = await gerarRelatorioVendasFaturadas(c, OUTUBRO, HOJE);
    expect(r.linhas.map((l) => l.numeroPedido)).toEqual(['40']);
  });

  it('título sem código do pedido em faturamento parcial (vários registros, mesmo número): não vincula a nenhum', async () => {
    const c = cliente(
      [
        pedido({ codigo: 4100, numero: '41', dInc: '01/09/2026', dAlt: '15/10/2026', valor: 0 }),
        pedido({ codigo: 4101, numero: '41', dInc: '10/09/2026', dAlt: '15/10/2026', valor: 1000 }),
      ],
      [titulo({ codigoPedido: null, numeroPedido: '41', emissao: '15/10/2026' })],
    );
    const r = await gerarRelatorioVendasFaturadas(c, OUTUBRO, HOJE);
    expect(r.linhas).toEqual([]);
  });

  it('vendedor filtrado: só os pedidos e títulos dele', async () => {
    const c = cliente(
      [
        pedido({ codigo: 50, numero: '50', dInc: '02/10/2026', valor: 800 }),
        pedido({ codigo: 51, numero: '51', dInc: '02/10/2026', valor: 900, codVend: MARIA }),
      ],
      [titulo({ codigoPedido: 50, numeroPedido: '50', emissao: '03/10/2026' })],
      [titulo({ codigoPedido: 51, numeroPedido: '51', emissao: '03/10/2026', codVend: MARIA })],
    );
    const r = await gerarRelatorioVendasFaturadas(c, { ...OUTUBRO, codigoVendedor: MARIA }, HOJE);
    expect(r.linhas.map((l) => l.numeroPedido)).toEqual(['51']);
    expect(c.consultasTitulosPorVendedor).toEqual([MARIA]);
  });

  it('pedido sem vendedor: fora, com aviso (não dá para conferir a fatura); orçamento sem vendedor não entra no aviso', async () => {
    const c = cliente(
      [
        pedido({ codigo: 60, numero: '60', dInc: '02/10/2026', valor: 800, codVend: null }),
        pedido({ codigo: 61, numero: '61', dInc: '02/10/2026', valor: 800, codVend: null, etapa: '10' }),
      ],
      [],
    );
    const r = await gerarRelatorioVendasFaturadas(c, OUTUBRO, HOJE);
    expect(r.linhas).toEqual([]);
    expect(r.numerosPedidosSemVendedorNaoVerificados).toEqual(['60']);
  });

  it('sem período completo: comportamento antigo (listagem da Omie)', async () => {
    const c = cliente([pedido({ codigo: 70, numero: '70', dInc: '02/10/2026', valor: 800 })], []);
    const r = await gerarRelatorioVendasFaturadas(c, { dataDe: '01/10/2026' }, HOJE);
    expect(r.linhas.map((l) => l.numeroPedido)).toEqual(['70']);
    expect(c.consultasTitulosPorVendedor).toEqual([]);
  });
});
