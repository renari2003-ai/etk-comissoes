import { describe, expect, it, vi } from 'vitest';
import { gerarRelatorioFinanceiro } from '../../src/comissionamento/relatorioFinanceiro.js';
import { baixaFinanceiro, clienteFinanceiro, pedidoFinanceiro, tituloFinanceiro } from './financeiroFixture.js';

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
