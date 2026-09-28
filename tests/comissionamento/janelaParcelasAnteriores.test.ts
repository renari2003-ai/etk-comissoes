import { describe, expect, it } from 'vitest';
import { gerarRelatorioComissionamento, type LinhaComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import { ClienteComissionamentoOmieFalso } from '../omie/clienteComissionamentoFalso.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';
import type { ClienteInfo, VendedorInfo } from '../../src/relatorio/relatorioVendas.js';
import type { TituloContaReceber } from '../../src/omie/cliente.js';
import { formatarDatasFaturamento, titulosTabelaComissionamento } from '../../public-src/relatorios.js';

/**
 * Comissionamento — parcelas de pedidos dos 12 meses anteriores + data de faturamento (regra de
 * 2026-09-28). Período sempre 01/09/2026 a 30/09/2026. "Parcela no período" = VENCIMENTO do título
 * no período; data de faturamento = `data_emissao` do título. Venda sem despesas → margem 100% →
 * comissão 3% da receita (cálculo existente, não alterado aqui).
 */

const PERIODO = { dataDe: '01/09/2026', dataAte: '30/09/2026' };
const JOAO = 100;
const MARIA = 200;

/**
 * `data` = inclusão do pedido (`dInc`); `dAlt` default = `data`. A referência de período é
 * inclusão OU última alteração (igual ao filtro `ListarPedidos` real); `previsao` default = `data`
 * e é propositalmente irrelevante para a janela.
 */
function pedido(o: { codigo: number; numero: string; data: string; valor: number; codVend?: number; dAlt?: string; previsao?: string }): PedidoOmie {
  return {
    cabecalho: {
      codigo_pedido: o.codigo,
      numero_pedido: o.numero,
      etapa: '10',
      codigo_cliente: 500,
      data_previsao: o.previsao ?? o.data,
    },
    infoCadastro: { dInc: o.data, dAlt: o.dAlt ?? o.data },
    det: [
      {
        produto: {
          codigo_produto: 1,
          codigo: 'P1',
          descricao: 'Produto 1',
          quantidade: 1,
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
  vencimento: string;
  emissao: string | null;
  status?: string;
  nf?: string;
  parcela?: string;
  codVend?: number;
}): TituloContaReceber {
  return {
    codigoLancamentoOmie: proximoLancamento++,
    codigoPedido: o.codigoPedido,
    numeroPedido: o.numeroPedido,
    numeroParcela: o.parcela ?? '001/001',
    numeroNotaFiscal: o.nf ?? `NF-${o.numeroPedido}`,
    valorDocumento: o.valor,
    dataVencimento: o.vencimento,
    dataEmissao: o.emissao,
    statusTitulo: o.status ?? 'A VENCER',
    codigoVendedor: o.codVend ?? JOAO,
  };
}

const VENDEDORES: VendedorInfo[] = [
  { codigo: JOAO, nome: 'João', inativo: false },
  { codigo: MARIA, nome: 'Maria', inativo: false },
];
const CLIENTES = new Map<number, ClienteInfo>([[500, { codigo: 500, razaoSocial: 'Cliente 500', nomeFantasia: 'Cliente 500' }]]);

function cenario() {
  const pedidos: PedidoOmie[] = [
    pedido({ codigo: 1001, numero: '1001', data: '10/09/2026', valor: 1000 }), // venda do período, parcela no período
    pedido({ codigo: 1009, numero: '1009', data: '20/09/2026', valor: 500 }), // venda do período sem título
    pedido({ codigo: 1002, numero: '1002', data: '15/08/2026', valor: 2000 }), // mês anterior
    pedido({ codigo: 1003, numero: '1003', data: '10/03/2026', valor: 1000 }), // 6 meses antes
    pedido({ codigo: 1004, numero: '1004', data: '01/09/2025', valor: 1000 }), // exatamente 12 meses antes
    pedido({ codigo: 1005, numero: '1005', data: '31/08/2025', valor: 1000 }), // mais de 12 meses
    pedido({ codigo: 1006, numero: '1006', data: '10/07/2026', valor: 1000 }), // anterior SEM parcela no período
    // Faturamento parcial de pedido anterior: registro original + registro da 2ª fatura (código próprio, mesmo número).
    pedido({ codigo: 8000, numero: '1008', data: '01/06/2026', valor: 1000 }),
    pedido({ codigo: 8001, numero: '1008', data: '01/06/2026', valor: 500 }),
    pedido({ codigo: 2001, numero: '2001', data: '10/08/2026', valor: 1000, codVend: MARIA }), // outro vendedor
  ];
  const titulosJoao: TituloContaReceber[] = [
    titulo({ codigoPedido: 1001, numeroPedido: '1001', valor: 500, vencimento: '20/09/2026', emissao: '12/09/2026', status: 'RECEBIDO', parcela: '001/002' }),
    titulo({ codigoPedido: 1001, numeroPedido: '1001', valor: 500, vencimento: '20/10/2026', emissao: '12/09/2026', parcela: '002/002' }),
    titulo({ codigoPedido: 1002, numeroPedido: '1002', valor: 1000, vencimento: '15/08/2026', emissao: '16/08/2026', status: 'RECEBIDO', parcela: '001/002' }),
    titulo({ codigoPedido: 1002, numeroPedido: '1002', valor: 1000, vencimento: '15/09/2026', emissao: '16/08/2026', parcela: '002/002' }),
    titulo({ codigoPedido: 1003, numeroPedido: '1003', valor: 1000, vencimento: '10/09/2026', emissao: '11/03/2026', status: 'RECEBIDO' }),
    titulo({ codigoPedido: 1004, numeroPedido: '1004', valor: 1000, vencimento: '05/09/2026', emissao: null }),
    titulo({ codigoPedido: 1005, numeroPedido: '1005', valor: 1000, vencimento: '05/09/2026', emissao: '31/08/2025' }),
    titulo({ codigoPedido: 1006, numeroPedido: '1006', valor: 500, vencimento: '10/08/2026', emissao: '11/07/2026', parcela: '001/002' }),
    titulo({ codigoPedido: 1006, numeroPedido: '1006', valor: 500, vencimento: '10/10/2026', emissao: '11/07/2026', parcela: '002/002' }),
    titulo({ codigoPedido: 8000, numeroPedido: '1008', valor: 1000, vencimento: '05/09/2026', emissao: '05/06/2026', nf: 'NF-A' }),
    titulo({ codigoPedido: 8001, numeroPedido: '1008', valor: 500, vencimento: '20/09/2026', emissao: '20/06/2026', nf: 'NF-B', status: 'RECEBIDO' }),
  ];
  const titulosMaria: TituloContaReceber[] = [
    titulo({ codigoPedido: 2001, numeroPedido: '2001', valor: 1000, vencimento: '10/09/2026', emissao: '11/08/2026', codVend: MARIA }),
  ];
  return new ClienteComissionamentoOmieFalso(
    pedidos,
    VENDEDORES,
    CLIENTES,
    new Map(),
    new Map([
      [JOAO, titulosJoao],
      [MARIA, titulosMaria],
    ]),
  );
}

function porNumero(linhas: LinhaComissionamento[], numero: string): LinhaComissionamento[] {
  return linhas.filter((l) => l.numeroPedido === numero);
}

describe('janela de 12 meses — pedidos anteriores com parcela no período', () => {
  it('pedido do período aparece normalmente, uma vez só, mesmo tendo parcela no período', async () => {
    const r = await gerarRelatorioComissionamento(cenario(), { ...PERIODO, codigoVendedor: JOAO });
    const linhas = porNumero(r.linhas, '1001');
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.origem).toBe('PERIODO');
    expect(linhas[0]!.parcelas).toHaveLength(2); // venda do período: todas as parcelas, como sempre
  });

  it('inclui mês anterior, 6 meses e exatamente 12 meses antes; exclui mais de 12 meses e anterior sem parcela no período', async () => {
    const r = await gerarRelatorioComissionamento(cenario(), { ...PERIODO, codigoVendedor: JOAO });
    const anteriores = r.linhas.filter((l) => l.origem === 'PARCELA_PERIODO_ANTERIOR').map((l) => l.numeroPedido).sort();
    expect(anteriores).toEqual(['1002', '1003', '1004', '1008']);
    expect(porNumero(r.linhas, '1005')).toEqual([]);
    expect(porNumero(r.linhas, '1006')).toEqual([]);
    expect(r.numerosPedidosAnterioresNaoLocalizados).toEqual([]);
  });

  it('pedido anterior mostra só as parcelas que vencem no período; liberada/pendente só delas (valor da parcela = cálculo de sempre)', async () => {
    const r = await gerarRelatorioComissionamento(cenario(), { ...PERIODO, codigoVendedor: JOAO });
    const [p1002] = porNumero(r.linhas, '1002');
    expect(p1002!.comissaoTotal).toBe(60); // 3% de 2000 — venda inteira, só referência
    expect(p1002!.parcelas.map((p) => p.dataVencimento)).toEqual(['15/09/2026']);
    expect(p1002!.parcelas[0]!.comissaoParcela).toBe(30); // metade da comissão (parcela = metade do valor)
    expect(p1002!.comissaoLiberada).toBe(0);
    expect(p1002!.comissaoPendente).toBe(30);

    const [p1003] = porNumero(r.linhas, '1003');
    expect(p1003!.comissaoLiberada).toBe(30);
    expect(p1003!.comissaoPendente).toBe(0);
  });

  it('venda de pedido anterior não infla o mês; liberada/pendente/parcelas incluem as parcelas anteriores do período', async () => {
    const r = await gerarRelatorioComissionamento(cenario(), { ...PERIODO, codigoVendedor: JOAO });
    // Só 1001 e 1009 são vendas do período.
    expect(r.resumo.quantidadePedidos).toBe(2);
    expect(r.resumo.valorVendaTotal).toBe(1500);
    expect(r.resumo.comissaoTotalCalculada).toBe(45);
    // Liberada: 1001 (15) + 1003 (30) + 1008 NF-B (15). Pendente: 1001 (15) + 1009 (15) + 1002 (30) + 1004 (30) + 1008 NF-A (30).
    expect(r.resumo.comissaoLiberada).toBe(60);
    expect(r.resumo.comissaoPendente).toBe(120);
    // Parcelas: 1001 (2) + 1002 (1) + 1003 (1) + 1004 (1) + 1008 (2).
    expect(r.resumo.quantidadeParcelasTotal).toBe(7);
    expect(r.resumo.quantidadeParcelasBaixadas).toBe(3);
  });

  it('múltiplas faturas de pedido anterior: uma linha só, consolidada, com as datas de cada fatura', async () => {
    const cliente = cenario();
    const r = await gerarRelatorioComissionamento(cliente, { ...PERIODO, codigoVendedor: JOAO });
    const linhas = porNumero(r.linhas, '1008');
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.valorBruto).toBe(1500); // original + 2ª fatura, como no relatório do período
    expect(linhas[0]!.datasFaturamento).toEqual(['05/06/2026', '20/06/2026']);
    expect(linhas[0]!.parcelas.map((p) => p.numeroFaturaParcial).sort()).toEqual(['1008/1', '1008/2']);
    expect(cliente.consultasPedido).toContainEqual({ numeroPedido: '1008' });
    expect(cliente.consultasPedido).toContainEqual({ codigoPedido: 8001 });
  });

  it('data de faturamento = emissão do título; sem título → vazio (nunca a data do pedido)', async () => {
    const r = await gerarRelatorioComissionamento(cenario(), { ...PERIODO, codigoVendedor: JOAO });
    expect(porNumero(r.linhas, '1001')[0]!.datasFaturamento).toEqual(['12/09/2026']);
    expect(porNumero(r.linhas, '1009')[0]!.datasFaturamento).toEqual([]);
    expect(porNumero(r.linhas, '1004')[0]!.datasFaturamento).toEqual([]); // título sem data_emissao
    expect(porNumero(r.linhas, '1001')[0]!.parcelas[0]!.dataEmissao).toBe('12/09/2026');
  });

  it('vendedor filtrado: nunca traz pedido anterior de outro vendedor e só consulta os títulos dele', async () => {
    const cliente = cenario();
    const r = await gerarRelatorioComissionamento(cliente, { ...PERIODO, codigoVendedor: JOAO });
    expect(porNumero(r.linhas, '2001')).toEqual([]);
    expect(r.linhas.every((l) => l.codigoVendedor === JOAO)).toBe(true);
    expect(cliente.consultasTitulosPorVendedor).toEqual([JOAO]);

    const daMaria = await gerarRelatorioComissionamento(cenario(), { ...PERIODO, codigoVendedor: MARIA });
    expect(daMaria.linhas.map((l) => l.numeroPedido)).toEqual(['2001']);
  });

  it('janela usa a MESMA referência do filtro do período (inclusão OU alteração), nunca a previsão', async () => {
    const pedidos = [
      // Incluído há mais de 12 meses, mas ALTERADO dentro da janela → entra (o filtro da Omie o listaria).
      pedido({ codigo: 3001, numero: '3001', data: '10/07/2025', dAlt: '05/08/2026', valor: 1000 }),
      // Previsão dentro da janela, mas inclusão e alteração há mais de 12 meses → não entra.
      pedido({ codigo: 3002, numero: '3002', data: '10/05/2025', previsao: '10/08/2026', valor: 1000 }),
      // Alterado DENTRO do período → é venda do período (como na listagem), aparece uma vez só.
      pedido({ codigo: 3003, numero: '3003', data: '20/08/2026', dAlt: '05/09/2026', previsao: '20/08/2026', valor: 1000 }),
    ];
    const titulos = ['3001', '3002', '3003'].map((n) =>
      titulo({ codigoPedido: Number(n), numeroPedido: n, valor: 1000, vencimento: '10/09/2026', emissao: '01/08/2026' }),
    );
    const cliente = new ClienteComissionamentoOmieFalso(pedidos, VENDEDORES, CLIENTES, new Map(), new Map([[JOAO, titulos]]));
    const r = await gerarRelatorioComissionamento(cliente, { ...PERIODO, codigoVendedor: JOAO });
    expect(r.linhas.map((l) => [l.numeroPedido, l.origem])).toEqual([
      ['3003', 'PERIODO'],
      ['3001', 'PARCELA_PERIODO_ANTERIOR'],
    ]);
  });

  it('sem período informado: nenhuma busca de pedido anterior (comportamento antigo)', async () => {
    const cliente = cenario();
    const r = await gerarRelatorioComissionamento(cliente, { codigoVendedor: JOAO });
    expect(r.linhas.every((l) => l.origem === 'PERIODO')).toBe(true);
    expect(cliente.consultasPedido).toEqual([]);
  });

  it('pedido anterior que não pode ser consultado fica fora, com aviso (nunca calculado com dado incompleto)', async () => {
    const cliente = cenario();
    // Título de um pedido que não existe mais na Omie.
    const titulos = await cliente.listarContasReceberPorVendedor(JOAO);
    titulos.push(titulo({ codigoPedido: 9999, numeroPedido: '9999', valor: 100, vencimento: '10/09/2026', emissao: '01/08/2026' }));
    const r = await gerarRelatorioComissionamento(cliente, { ...PERIODO, codigoVendedor: JOAO });
    expect(porNumero(r.linhas, '9999')).toEqual([]);
    expect(r.numerosPedidosAnterioresNaoLocalizados).toEqual(['9999']);
  });
});

describe('tela e PDF (impressão da mesma tabela) — data de faturamento', () => {
  it('coluna "Data de faturamento" presente para admin e demais papéis', () => {
    expect(titulosTabelaComissionamento(true)).toContain('Data de faturamento');
    expect(titulosTabelaComissionamento(false)).toContain('Data de faturamento');
    expect(titulosTabelaComissionamento(false)).not.toContain('Margem');
  });

  it('formata: sem faturamento "—"; uma data; várias faturas compactas sem duplicar a linha', () => {
    expect(formatarDatasFaturamento([]).texto).toBe('—');
    expect(formatarDatasFaturamento(undefined).texto).toBe('—');
    expect(formatarDatasFaturamento(['12/09/2026']).texto).toBe('12/09/2026');
    const varias = formatarDatasFaturamento(['05/06/2026', '20/06/2026']);
    expect(varias.texto).toBe('05/06/2026 (+1)');
    expect(varias.titulo).toContain('20/06/2026');
  });
});
