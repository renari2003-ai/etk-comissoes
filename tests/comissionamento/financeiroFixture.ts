import type { PedidoOmie } from '../../src/calculo/tipos.js';
import type { TituloContaReceber } from '../../src/omie/cliente.js';
import type { BaixaRecebimento } from '../../src/omie/recebimentos.js';
import { ClienteComissionamentoOmieFalso } from '../omie/clienteComissionamentoFalso.js';

export function pedidoFinanceiro(codigo = 1, valor = 1000, vendedor = 100): PedidoOmie {
  return {
    cabecalho: { codigo_pedido: codigo, numero_pedido: '154', etapa: '60', codigo_cliente: 500 },
    det: [{ produto: { codigo_produto: 1, codigo: 'P1', descricao: 'Produto', quantidade: 1, valor_unitario: valor, valor_mercadoria: valor } }],
    total_pedido: { valor_total_pedido: valor, valor_mercadorias: valor },
    informacoes_adicionais: { codVend: vendedor },
    infoCadastro: { dInc: '01/01/2023', dAlt: '01/01/2023' },
  };
}

export function tituloFinanceiro(codigo = 10, valor = 500, overrides: Partial<TituloContaReceber> = {}): TituloContaReceber {
  return { codigoLancamentoOmie: codigo, codigoPedido: 1, numeroPedido: '154', numeroParcela: `${codigo}/002`,
    numeroNotaFiscal: '00025739', valorDocumento: valor, dataVencimento: '01/08/2026', dataEmissao: '01/01/2023',
    statusTitulo: 'RECEBIDO', codigoVendedor: 100, ...overrides };
}

export function baixaFinanceiro(codigo = 1, titulo = 10, valor = 500, data = '10/09/2026'): BaixaRecebimento {
  return { codigoBaixa: codigo, codigoLancamentoOmie: titulo, dataRecebimento: data, valorRecebido: valor, juros: 0, multa: 0 };
}

export function clienteFinanceiro(baixas: BaixaRecebimento[], titulos = [tituloFinanceiro(), tituloFinanceiro(11)], pedidos = [pedidoFinanceiro()]) {
  const cliente = new ClienteComissionamentoOmieFalso(pedidos,
    [{ codigo: 100, nome: 'João', inativo: false }, { codigo: 200, nome: 'Maria', inativo: false }],
    new Map([[500, { codigo: 500, razaoSocial: 'Cliente', nomeFantasia: 'Cliente' }]]), new Map(),
    new Map([[100, titulos.filter(t => t.codigoVendedor === 100)], [200, titulos.filter(t => t.codigoVendedor === 200)]]));
  return Object.assign(cliente, { listarBaixasReceber: async () => baixas });
}
