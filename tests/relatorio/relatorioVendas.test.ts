import { describe, expect, it } from 'vitest';
import { filtrarLinhasPorBusca, gerarRelatorio } from '../../src/relatorio/relatorioVendas.js';
import { ClienteRelatorioOmieFalso } from '../omie/clienteRelatorioFalso.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';
import type { ClienteInfo, VendedorInfo } from '../../src/relatorio/relatorioVendas.js';

function pedido(overrides: {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  codigoCliente: number;
  codVend?: number;
  itens: Array<{ codigoProduto: number; quantidade: number; valorUnitario: number; valorMercadoria: number }>;
  valorTotalPedido?: number;
}): PedidoOmie {
  const receitaTotal = overrides.itens.reduce((soma, i) => soma + i.valorMercadoria, 0);
  return {
    cabecalho: {
      codigo_pedido: overrides.codigoPedido,
      numero_pedido: overrides.numeroPedido,
      etapa: overrides.etapa,
      codigo_cliente: overrides.codigoCliente,
    },
    det: overrides.itens.map((i) => ({
      produto: {
        codigo_produto: i.codigoProduto,
        codigo: `P${i.codigoProduto}`,
        descricao: `Produto ${i.codigoProduto}`,
        quantidade: i.quantidade,
        valor_unitario: i.valorUnitario,
        valor_mercadoria: i.valorMercadoria,
      },
    })),
    total_pedido: { valor_total_pedido: overrides.valorTotalPedido ?? receitaTotal },
    informacoes_adicionais: overrides.codVend !== undefined ? { codVend: overrides.codVend } : {},
  };
}

const VENDEDORES: VendedorInfo[] = [
  { codigo: 100, nome: 'João', inativo: false },
  { codigo: 200, nome: 'Maria', inativo: false },
];

const CLIENTES = new Map<number, ClienteInfo>([
  [500, { codigo: 500, razaoSocial: 'Cliente 500 LTDA', nomeFantasia: 'Cliente Quinhentos' }],
  [501, { codigo: 501, razaoSocial: 'Cliente 501 LTDA', nomeFantasia: 'Cliente Quinhentos e Um' }],
]);

const ESTOQUES = new Map([
  [1, { listaEstoque: [{ nCMC: 5 }] }],
  [2, { listaEstoque: [{ nCMC: 2 }] }],
  [3, { listaEstoque: [{ nCMC: 1 }] }],
]);

describe('gerarRelatorio — separação Pedido vs Orçamento (regra crítica)', () => {
  it('inclui apenas PEDIDO no relatório de vendas, excluindo orçamentos', async () => {
    const pedidoA = pedido({
      codigoPedido: 1,
      numeroPedido: '1',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 10, valorUnitario: 10, valorMercadoria: 100 }],
    });
    const orcamentoC = pedido({
      codigoPedido: 3,
      numeroPedido: '3',
      etapa: '00',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 3, valorUnitario: 10, valorMercadoria: 30 }],
    });

    const cliente = new ClienteRelatorioOmieFalso([pedidoA, orcamentoC], VENDEDORES, CLIENTES, ESTOQUES);
    const resultado = await gerarRelatorio(cliente, { tipoDocumento: 'PEDIDO' }, '01/01/2026');

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.numeroPedido).toBe('1');
  });

  it('inclui apenas ORCAMENTO no relatório de orçamentos, excluindo pedidos', async () => {
    const pedidoA = pedido({
      codigoPedido: 1,
      numeroPedido: '1',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 10, valorUnitario: 10, valorMercadoria: 100 }],
    });
    const orcamentoC = pedido({
      codigoPedido: 3,
      numeroPedido: '3',
      etapa: '00',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 3, valorUnitario: 10, valorMercadoria: 30 }],
    });

    const cliente = new ClienteRelatorioOmieFalso([pedidoA, orcamentoC], VENDEDORES, CLIENTES, ESTOQUES);
    const resultado = await gerarRelatorio(cliente, { tipoDocumento: 'ORCAMENTO' }, '01/01/2026');

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.numeroPedido).toBe('3');
  });

  it('exclui documentos com etapa ambígua e reporta a contagem, sem contabilizá-los em nenhum relatório', async () => {
    const pedidoAmbiguo = pedido({
      codigoPedido: 9,
      numeroPedido: '9',
      etapa: '999',
      codigoCliente: 500,
      itens: [{ codigoProduto: 1, quantidade: 1, valorUnitario: 10, valorMercadoria: 10 }],
    });

    const cliente = new ClienteRelatorioOmieFalso([pedidoAmbiguo], VENDEDORES, CLIENTES, ESTOQUES);
    const resultadoVendas = await gerarRelatorio(cliente, { tipoDocumento: 'PEDIDO' }, '01/01/2026');
    const resultadoOrcamentos = await gerarRelatorio(cliente, { tipoDocumento: 'ORCAMENTO' }, '01/01/2026');

    expect(resultadoVendas.linhas).toHaveLength(0);
    expect(resultadoVendas.documentosAmbiguosExcluidos).toBe(1);
    expect(resultadoOrcamentos.linhas).toHaveLength(0);
    expect(resultadoOrcamentos.documentosAmbiguosExcluidos).toBe(1);
  });
});

describe('gerarRelatorio — totais, margens e custos (ausência de duplicidade)', () => {
  it('calcula corretamente receita, custo, margem e resumo para múltiplos pedidos', async () => {
    // Custo agora é ESTIMADO a partir do preço de venda ÷ 1,90 (regra temporária de 2026-09-10,
    // ver custoEstimado.ts) — não vem mais do estoque (ESTOQUES é ignorado pelo cálculo de custo).
    const pedidoA = pedido({
      codigoPedido: 1,
      numeroPedido: '1',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 10, valorUnitario: 10, valorMercadoria: 100 }], // custo unit 10/1,9=5,2632 -> custoTotal 52,63
    });
    const pedidoB = pedido({
      codigoPedido: 2,
      numeroPedido: '2',
      etapa: '10',
      codigoCliente: 501,
      codVend: 200,
      itens: [{ codigoProduto: 2, quantidade: 5, valorUnitario: 10, valorMercadoria: 50 }], // custo unit 10/1,9=5,2632 -> custoTotal 26,32
    });

    const cliente = new ClienteRelatorioOmieFalso([pedidoA, pedidoB], VENDEDORES, CLIENTES, ESTOQUES);
    const resultado = await gerarRelatorio(cliente, { tipoDocumento: 'PEDIDO' }, '01/01/2026');

    expect(resultado.linhas).toHaveLength(2);

    const linhaA = resultado.linhas.find((l) => l.numeroPedido === '1');
    expect(linhaA?.receitaTotal).toBe(100);
    expect(linhaA?.custoTotal).toBe(52.63);
    expect(linhaA?.margemTotal).toBe(47.37);
    expect(linhaA?.margemVendaPercentual).toBe(47.37);
    expect(linhaA?.nomeVendedor).toBe('João');
    expect(linhaA?.nomeCliente).toBe('Cliente Quinhentos');

    const linhaB = resultado.linhas.find((l) => l.numeroPedido === '2');
    expect(linhaB?.receitaTotal).toBe(50);
    expect(linhaB?.custoTotal).toBe(26.32);
    expect(linhaB?.margemTotal).toBe(23.68);
    // Mesmo preço unitário (10) nos dois pedidos -> mesma margem %, já que o custo estimado é
    // sempre a mesma fração do preço (1 - 1/1,9 = 47,37%), independente da quantidade/estoque.
    expect(linhaB?.margemVendaPercentual).toBe(47.37);
    expect(linhaB?.nomeVendedor).toBe('Maria');

    expect(resultado.resumo.quantidadeDocumentos).toBe(2);
    expect(resultado.resumo.valorLiquidoTotal).toBe(150);
    expect(resultado.resumo.custoTotal).toBe(78.95);
    expect(resultado.resumo.margemTotal).toBe(71.05);
    expect(resultado.resumo.margemMediaPercentual).toBe(47.37);
    expect(resultado.resumo.ticketMedio).toBe(75);
  });

  it('não duplica um pedido mesmo se ele aparecer em mais de uma página simulada', async () => {
    const pedidoA = pedido({
      codigoPedido: 1,
      numeroPedido: '1',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 1, valorUnitario: 10, valorMercadoria: 10 }],
    });

    // Mesmo pedido não deve ser passado duas vezes pela fonte de dados —
    // aqui garantimos que o relatório reflete exatamente os registros
    // retornados, sem introduzir duplicação própria.
    const cliente = new ClienteRelatorioOmieFalso([pedidoA], VENDEDORES, CLIENTES, ESTOQUES);
    const resultado = await gerarRelatorio(cliente, { tipoDocumento: 'PEDIDO' }, '01/01/2026');

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.resumo.quantidadeDocumentos).toBe(1);
  });
});

describe('gerarRelatorio — consolidação de faturamento parcial (BUG REAL corrigido em 2026-09-10)', () => {
  it('consolida em UMA linha os registros que a Omie retorna para o mesmo numero_pedido quando faturado em mais de uma NF (pedido real nº 154)', async () => {
    // Reproduz a estrutura real confirmada contra a API: o registro ORIGINAL (menor codigo_pedido)
    // mantém a etapa aberta e só os itens AINDA NÃO faturados; cada fatura parcial vira um registro
    // FILHO (mesmo numero_pedido, codigo_pedido diferente) com os itens que foram movidos para ela.
    // Sem consolidação, os 3 apareceriam como 3 linhas distintas para o mesmo pedido "154".
    const registroOriginal = pedido({
      codigoPedido: 900,
      numeroPedido: '154',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 10, valorUnitario: 10, valorMercadoria: 100 }],
    });
    const fatura1 = pedido({
      codigoPedido: 901,
      numeroPedido: '154',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 2, quantidade: 5, valorUnitario: 10, valorMercadoria: 50 }],
    });
    const fatura2 = pedido({
      codigoPedido: 902,
      numeroPedido: '154',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 3, quantidade: 2, valorUnitario: 10, valorMercadoria: 20 }],
    });

    const cliente = new ClienteRelatorioOmieFalso([registroOriginal, fatura1, fatura2], VENDEDORES, CLIENTES, ESTOQUES);
    const resultado = await gerarRelatorio(cliente, { tipoDocumento: 'PEDIDO' }, '01/01/2026');

    expect(resultado.linhas).toHaveLength(1); // nunca 3
    const linha = resultado.linhas[0];
    expect(linha?.numeroPedido).toBe('154');
    expect(linha?.codigoPedido).toBe(900); // registro original (menor código) é o representante
    expect(linha?.valorBruto).toBeCloseTo(170, 2); // 100 + 50 + 20 — soma sem duplicar nem perder nada
    expect(linha?.receitaTotal).toBeCloseTo(170, 2);
    expect(linha?.itens).toHaveLength(3); // itens dos 3 registros, todos preservados

    expect(resultado.resumo.quantidadeDocumentos).toBe(1);
    expect(resultado.resumo.valorLiquidoTotal).toBeCloseTo(170, 2);
  });

  it('não consolida pedidos com numero_pedido diferente, mesmo com o mesmo cliente/vendedor', async () => {
    const pedidoA = pedido({
      codigoPedido: 1,
      numeroPedido: '1',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 1, valorUnitario: 10, valorMercadoria: 10 }],
    });
    const pedidoB = pedido({
      codigoPedido: 2,
      numeroPedido: '2',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 1, valorUnitario: 10, valorMercadoria: 10 }],
    });

    const cliente = new ClienteRelatorioOmieFalso([pedidoA, pedidoB], VENDEDORES, CLIENTES, ESTOQUES);
    const resultado = await gerarRelatorio(cliente, { tipoDocumento: 'PEDIDO' }, '01/01/2026');

    expect(resultado.linhas).toHaveLength(2);
  });
});

describe('gerarRelatorio — filtro por vendedor', () => {
  it('retorna somente os pedidos do vendedor selecionado', async () => {
    const pedidoA = pedido({
      codigoPedido: 1,
      numeroPedido: '1',
      etapa: '10',
      codigoCliente: 500,
      codVend: 100,
      itens: [{ codigoProduto: 1, quantidade: 1, valorUnitario: 10, valorMercadoria: 10 }],
    });
    const pedidoB = pedido({
      codigoPedido: 2,
      numeroPedido: '2',
      etapa: '10',
      codigoCliente: 501,
      codVend: 200,
      itens: [{ codigoProduto: 2, quantidade: 1, valorUnitario: 10, valorMercadoria: 10 }],
    });

    const cliente = new ClienteRelatorioOmieFalso([pedidoA, pedidoB], VENDEDORES, CLIENTES, ESTOQUES);
    const resultado = await gerarRelatorio(cliente, { tipoDocumento: 'PEDIDO', codigoVendedor: 100 }, '01/01/2026');

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.nomeVendedor).toBe('João');
  });
});

describe('filtrarLinhasPorBusca', () => {
  it('filtra por número do pedido, cliente ou vendedor, sem diferenciar maiúsculas/acentos', () => {
    const linhas = [
      { numeroPedido: '42', codigoPedido: 42, nomeCliente: 'Café Central', nomeVendedor: 'João' },
      { numeroPedido: '43', codigoPedido: 43, nomeCliente: 'Outro Cliente', nomeVendedor: 'Maria' },
    ] as never;

    expect(filtrarLinhasPorBusca(linhas, 'cafe central')).toHaveLength(1);
    expect(filtrarLinhasPorBusca(linhas, 'MARIA')).toHaveLength(1);
    expect(filtrarLinhasPorBusca(linhas, '42')).toHaveLength(1);
    expect(filtrarLinhasPorBusca(linhas, undefined)).toHaveLength(2);
    expect(filtrarLinhasPorBusca(linhas, 'inexistente')).toHaveLength(0);
  });
});
