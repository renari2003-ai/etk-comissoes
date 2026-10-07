import { expect, it, vi } from 'vitest';
import type { UsuarioPublico } from '../../src/auth/tipos.js';

vi.mock('../../src/fretes/cotacoesRepositorio.js', () => ({ listarCotacoes: async () => [
  { id: 'sem', vendedorOmieId: null }, { id: 'zero', vendedorOmieId: 0 },
  { id: 'propria', vendedorOmieId: 10 }, { id: 'outra', vendedorOmieId: 20 },
] }));
vi.mock('../../src/fretes/transportadorasRepositorio.js', () => ({ listarTransportadoras: async () => [{ id: 't' }] }));
vi.mock('../../src/fretes/propostasRepositorio.js', () => ({ listarPropostasPorStatusRevisao: async () => [
  ...['sem', 'zero', 'propria', 'outra'].map((cotacaoId) => ({ cotacaoId, transportadoraId: 't', status: 'RECEBIDA' })),
  { cotacaoId: 'sem', transportadoraId: 't', status: 'PENDENTE_VALIDACAO' },
] }));
vi.mock('../../src/auth/vinculoVendedor.js', () => ({ codigosVendedorVinculados: (usuario: UsuarioPublico) => usuario.vendedorOmieId == null ? [] : [usuario.vendedorOmieId] }));
import { servicoListarCentralVendedor } from '../../src/fretes/fretesServico.js';

it.each([10, 20, null])('vendedor %s vê cotações sem responsável e somente as próprias atribuídas', async (codigo) => {
  const linhas = await servicoListarCentralVendedor({ papel: 'usuario', permissoes: { fretesGerencia: false }, vendedorOmieId: codigo } as UsuarioPublico);
  expect(linhas.map((l) => l.cotacao.id)).toEqual(['sem', 'zero', ...(codigo === 10 ? ['propria'] : codigo === 20 ? ['outra'] : [])]);
  expect(linhas.every((l) => l.proposta.status !== 'PENDENTE_VALIDACAO')).toBe(true);
});

it('administrador mantém visão ampliada', async () => {
  const linhas = await servicoListarCentralVendedor({ papel: 'administrador' } as UsuarioPublico);
  expect(linhas).toHaveLength(4);
});
