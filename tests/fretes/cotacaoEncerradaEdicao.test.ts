import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cotação FECHADA/CANCELADA não aceita edição de CEP/endereço no backend (não só na tela).
// Repositório real com pool falso: nenhum banco é acessado, nenhum UPDATE é executado.
const consulta = vi.fn();
vi.mock('../../src/db.js', () => ({ obterPool: () => ({ query: consulta }) }));
vi.mock('../../src/fretes/schema.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/schema.js')>()),
  garantirEsquemaFretes: vi.fn(async () => undefined),
}));
vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({
  registrarAuditoria: vi.fn(async () => undefined),
  listarAuditoriaPorEntidade: vi.fn(async () => []),
}));

import { servicoAtualizarCotacao } from '../../src/fretes/fretesServico.js';
import { registrarAuditoria } from '../../src/fretes/auditoriaRepositorio.js';
import { ErroValidacao } from '../../src/validacao.js';

const COTACAO_ID = '22222222-2222-2222-2222-222222222222';
const USUARIO = '11111111-1111-1111-1111-111111111111';

function linha(status: string) {
  return {
    id: COTACAO_ID,
    codigo: 'FRE-2026-000099',
    status,
    modalidade_execucao: 'TRANSPORTADORA',
    veiculo_id: null,
    destino: 'Rua Omie, nº 10, Centro, Curitiba/PR',
    cep_destino: null,
    origem_destino: 'PEDIDO',
    logradouro_destino: 'Rua Omie',
    numero_destino: '10',
    complemento_destino: null,
    bairro_destino: 'Centro',
    cidade_destino: 'Curitiba',
    uf_destino: 'PR',
    criado_em: new Date('2026-10-01T12:00:00Z'),
    atualizado_em: new Date('2026-10-02T12:00:00Z'),
    fechado_em: status === 'FECHADA' ? new Date('2026-10-03T12:00:00Z') : null,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('cotação encerrada: CEP/endereço não editáveis no backend', () => {
  it.each(['FECHADA', 'CANCELADA'])('%s: "Salvar CEP" e "Salvar endereço" são recusados, sem UPDATE nem auditoria', async (status) => {
    consulta.mockImplementation(async (sql: string) => ({ rows: sql.trim().startsWith('SELECT') ? [linha(status)] : [] }));
    await expect(servicoAtualizarCotacao(COTACAO_ID, { cepDestino: '80000-000' }, USUARIO)).rejects.toBeInstanceOf(ErroValidacao);
    await expect(
      servicoAtualizarCotacao(COTACAO_ID, { destinoOverride: { cep: '80010-000', logradouro: 'Rua Nova', numero: '5', complemento: null, bairro: null, cidade: 'Curitiba', uf: 'PR' } }, USUARIO),
    ).rejects.toThrow(`Não é possível editar uma cotação com status ${status}.`);
    expect(consulta.mock.calls.some(([sql]) => String(sql).includes('UPDATE'))).toBe(false);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});
