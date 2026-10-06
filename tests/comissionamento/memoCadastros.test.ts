import { describe, expect, it, vi } from 'vitest';
import { memorizarCadastrosDaGeracao } from '../../src/comissionamento/memoCadastros.js';
import { gerarRelatorioComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';
import { ClienteComissionamentoOmieFalso } from '../omie/clienteComissionamentoFalso.js';

describe('memorizarCadastrosDaGeracao — produto/cliente reaproveitados dentro de uma geração', () => {
  it('mesmo código → uma consulta só (inclusive em paralelo); códigos diferentes consultam cada um', async () => {
    const base = {
      consultarProduto: vi.fn(async (c: number) => ({ codigo_produto: c })),
      consultarCliente: vi.fn(async (c: number) => ({ codigo: c })),
      outro: vi.fn(function (this: unknown) { return this; }),
    };
    const memo = memorizarCadastrosDaGeracao(base);
    await Promise.all([memo.consultarProduto(1), memo.consultarProduto(1), memo.consultarProduto(2)]);
    await memo.consultarProduto(1);
    await Promise.all([memo.consultarCliente(5), memo.consultarCliente(5)]);
    expect(base.consultarProduto.mock.calls).toEqual([[1], [2]]);
    expect(base.consultarCliente.mock.calls).toEqual([[5]]);
    expect(memo.outro()).toBe(base); // demais métodos chegam ao cliente original, com `this` preservado
  });

  it('falha não fica memorizada: a próxima chamada tenta de novo (comportamento de antes)', async () => {
    const consultarProduto = vi.fn().mockRejectedValueOnce(new Error('Omie fora')).mockResolvedValue({ codigo_produto: 1 });
    const memo = memorizarCadastrosDaGeracao({ consultarProduto, consultarCliente: vi.fn() });
    await expect(memo.consultarProduto(1)).rejects.toThrow('Omie fora');
    await expect(memo.consultarProduto(1)).resolves.toEqual({ codigo_produto: 1 });
    expect(consultarProduto).toHaveBeenCalledTimes(2);
  });

  it('cada geração tem o seu memo: nada é reaproveitado entre relatórios', async () => {
    const consultarProduto = vi.fn(async (c: number) => ({ codigo_produto: c }));
    const cliente = { consultarProduto, consultarCliente: vi.fn() };
    await memorizarCadastrosDaGeracao(cliente).consultarProduto(1);
    await memorizarCadastrosDaGeracao(cliente).consultarProduto(1);
    expect(consultarProduto).toHaveBeenCalledTimes(2);
  });
});

describe('Comissionamento — memo aplicado na geração (sem mudar o resultado)', () => {
  it('3 pedidos com o mesmo produto e cliente: 1 consulta de produto e 1 de cliente por geração', async () => {
    const pedido = (n: number): PedidoOmie => ({
      cabecalho: { codigo_pedido: n, numero_pedido: String(n), etapa: '50', codigo_cliente: 500 },
      det: [{ produto: { codigo_produto: 1, codigo: 'P1', descricao: 'P', quantidade: 1, valor_unitario: 190, valor_mercadoria: 190 } }],
      total_pedido: { valor_total_pedido: 190, valor_mercadorias: 190 },
      informacoes_adicionais: { codVend: 100 },
      infoCadastro: { dInc: '01/06/2026', hInc: '10:00:00' },
    });
    const cliente = new ClienteComissionamentoOmieFalso(
      [pedido(1), pedido(2), pedido(3)],
      [{ codigo: 100, nome: 'João', inativo: false }],
      new Map([[500, { codigo: 500, razaoSocial: 'Cliente', nomeFantasia: 'Cliente' }]]),
      new Map(), new Map(), undefined,
      new Map([[1, { codigo_produto: 1, descricao_familia: 'Família' }]]),
    );
    const produto = vi.spyOn(cliente, 'consultarProduto');
    const consultaCliente = vi.spyOn(cliente, 'consultarCliente');
    const r1 = await gerarRelatorioComissionamento(cliente, {});
    expect(produto).toHaveBeenCalledTimes(1);
    expect(consultaCliente).toHaveBeenCalledTimes(1);
    expect(r1.linhas.map((l) => l.comissaoTotal)).toEqual([5.7, 5.7, 5.7]);
    await gerarRelatorioComissionamento(cliente, {});
    expect(produto).toHaveBeenCalledTimes(2); // nova geração, novo memo
  });
});
