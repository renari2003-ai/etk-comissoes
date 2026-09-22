import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { prepararCotacaoDeOmie } from '../../src/fretes/omieFretes.js';

// Conferência de Pedido/Orçamento: mostra o NOME do vendedor; o código fica só internamente.
function omieFalso(tipo: 'PEDIDO' | 'ORCAMENTO', vendedores: () => Promise<Array<{ codigo: number; nome: string; inativo: boolean }>>) {
  return {
    consultarPedido: async (id: { numeroPedido?: string }) => ({
      cabecalho: { codigo_pedido: 5001, numero_pedido: id.numeroPedido ?? '', etapa: '10', codigo_cliente: 321 },
      det: [],
      total_pedido: { valor_total_pedido: 100 },
      informacoes_adicionais: { codVend: 42 },
      frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 },
    }),
    classificarPedido: async () => ({ tipo, ambiguo: false, rotulo: 'Etapa', motivo: '' }),
    consultarCliente: async () => null,
    listarVendedores: vendedores,
  } as unknown as ClienteOmie;
}

describe('nome do vendedor na conferência', () => {
  for (const tipo of ['PEDIDO', 'ORCAMENTO'] as const) {
    it(`${tipo}: devolve o nome do vendedor e mantém o código internamente`, async () => {
      const cliente = omieFalso(tipo, async () => [
        { codigo: 7, nome: 'Outro Vendedor', inativo: false },
        { codigo: 42, nome: 'Maria Vendedora', inativo: false },
      ]);
      const prep = await prepararCotacaoDeOmie(cliente, '123', tipo);
      expect(prep.vendedorNome).toBe('Maria Vendedora');
      expect(prep.vendedorOmieId).toBe(42);
    });
  }

  it('vendedor não localizado ou consulta falhando: nome null (a tela mostra "Vendedor não identificado") e a preparação segue', async () => {
    const semNome = await prepararCotacaoDeOmie(omieFalso('ORCAMENTO', async () => [{ codigo: 1, nome: 'X', inativo: false }]), '123', 'ORCAMENTO');
    expect(semNome.vendedorNome).toBeNull();
    expect(semNome.vendedorOmieId).toBe(42);
    const quebrado = await prepararCotacaoDeOmie(
      omieFalso('PEDIDO', async () => {
        throw new Error('falha Omie');
      }),
      '123',
      'PEDIDO',
    );
    expect(quebrado.vendedorNome).toBeNull();
    expect(quebrado.vendedorOmieId).toBe(42);
  });

  it('as duas telas de conferência exibem "Vendedor" (nome) e nunca o código', () => {
    const codigo = readFileSync('public-src/fretes.ts', 'utf8');
    expect(codigo).not.toContain('Vendedor (código Omie)');
    expect(codigo).toContain("linhaInfo(infoPedido, 'Vendedor', preparacao.vendedorNome ?? 'Vendedor não identificado')");
    expect(codigo).toContain("linhaInfo(resumoOrcamentoInfo, 'Vendedor', p.vendedorNome ?? 'Vendedor não identificado')");
  });
});
