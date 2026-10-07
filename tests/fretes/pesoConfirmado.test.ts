import { describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';

const mocks = vi.hoisted(() => ({ criar: vi.fn(async (dados) => ({ id: 'cot-teste', ...dados })), auditoria: vi.fn(async () => undefined) }));
vi.mock('../../src/fretes/cotacoesRepositorio.js', () => ({ criarCotacao: mocks.criar }));
vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({ registrarAuditoria: mocks.auditoria }));
vi.mock('../../src/fretes/omieFretes.js', () => ({
  formatarDestinoTexto: () => 'Destino de teste',
  prepararCotacaoDeOmie: async () => ({
    destino: { origem: 'CLIENTE_ENTREGA', cep: '05000000', cidade: 'São Paulo', uf: 'SP' },
    logistica: { pesoBruto: 2.988, pesoLiquido: 2.8, quantidadeVolumes: 1 },
    valorTotalPedido: 264.72,
  }),
}));

import { servicoCriarCotacaoDeOmie } from '../../src/fretes/fretesServico.js';

describe('peso confirmado na criação de cotação', () => {
  it.each([3.292, null])('persiste o peso confirmado (%s), com fallback apenas quando ausente', async (peso) => {
    const cotacao = await servicoCriarCotacaoDeOmie({} as ClienteOmie, '268', 'PEDIDO', null,
      { modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null, peso }, 'usuario-teste');
    expect(cotacao.peso).toBe(peso ?? 2.988);
    expect(cotacao.pesoBruto).toBe(peso ?? 2.988);
    expect(cotacao.pesoLiquido).toBe(2.8);
    expect(mocks.auditoria).toHaveBeenCalledWith(expect.objectContaining({ valorNovo: cotacao }));
  });
});
