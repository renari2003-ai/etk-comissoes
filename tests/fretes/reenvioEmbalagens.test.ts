import { describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import type { PayloadSolicitacaoN8n } from '../../src/fretes/integracoes/n8nCliente.js';
import type { CotacaoFrete, SolicitacaoCotacao } from '../../src/fretes/tipos.js';

// "Reenviar" usa o snapshot de embalagens GRAVADO na solicitação (repositórios e n8n
// simulados — nenhum banco real, nenhuma chamada real ao n8n).

const EMBALAGENS = [
  { altura: 0.27, largura: 0.36, comprimento: 0.77, quantidade: 6 },
  { altura: 1.2, largura: 0.8, comprimento: 1, quantidade: 2 },
];

const solicitacaoComErro = {
  id: 'sol-1',
  cotacaoFreteId: 'cot-1',
  transportadoraId: 'tr-1',
  canal: 'EMAIL',
  status: 'ERRO',
  codigoReferencia: 'FR-1-abcd1234',
  tentativas: 1,
  erroUltimaTentativa: 'O webhook do n8n respondeu HTTP 500.',
  emailDestino: 'cotacao@etk.com.br',
  emailOrigem: 'CADASTRO',
  embalagens: EMBALAGENS,
} as SolicitacaoCotacao;

const enviados: PayloadSolicitacaoN8n[] = [];
const auditorias: { acao: string; valorNovo?: unknown }[] = [];

vi.mock('../../src/fretes/integracoes/n8nCliente.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/integracoes/n8nCliente.js')>()),
  enviarSolicitacaoAoN8n: vi.fn(async (payload: PayloadSolicitacaoN8n) => {
    enviados.push(payload);
    return { statusHttp: 200 };
  }),
}));

vi.mock('../../src/fretes/solicitacoesRepositorio.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/solicitacoesRepositorio.js')>()),
  buscarSolicitacaoPorId: vi.fn(async () => solicitacaoComErro),
  marcarSolicitacaoEnviada: vi.fn(async () => ({ ...solicitacaoComErro, status: 'ENVIADA', tentativas: 2, erroUltimaTentativa: null })),
  marcarSolicitacaoErro: vi.fn(async () => solicitacaoComErro),
  criarSolicitacao: vi.fn(async () => {
    throw new Error('Reenviar nunca deve criar uma nova solicitação.');
  }),
}));

vi.mock('../../src/fretes/fretesServico.js', () => ({
  servicoBuscarCotacao: vi.fn(async () => ({ id: 'cot-1', codigo: 'FR-1', clienteOmieId: null, volumes: 8, peso: 120, especieVolumes: 'Caixas', modalidade: 'CIF' }) as CotacaoFrete),
}));

vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({
  registrarAuditoria: vi.fn(async (dados: { acao: string; valorNovo?: unknown }) => {
    auditorias.push(dados);
  }),
}));

const { servicoReenviarSolicitacao } = await import('../../src/fretes/integracaoCotacoesServico.js');
const n8n = await import('../../src/fretes/integracoes/n8nCliente.js');
const repositorio = await import('../../src/fretes/solicitacoesRepositorio.js');

describe('Reenviar com embalagens persistidas', () => {
  it('reenvia a MESMA solicitação com as mesmas dimensões, quantidades e total de volumes, e audita a tentativa', async () => {
    const resultado = await servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');

    expect(enviados).toHaveLength(1);
    const payload = enviados[0] as PayloadSolicitacaoN8n;
    expect(payload.solicitacaoId).toBe('sol-1');
    expect(payload.referencia).toBe('FR-1-abcd1234');
    expect(payload.logistica.embalagens).toEqual(EMBALAGENS);
    expect(payload.logistica.volumes).toBe(8);
    expect(resultado).toMatchObject({ id: 'sol-1', status: 'ENVIADA', tentativas: 2 });
    expect(auditorias).toEqual([expect.objectContaining({ acao: 'SOLICITACAO_ENVIADA_N8N' })]);
  });

  it('falha HTTP 500: o resumo sanitizado vai para a solicitação (Detalhes) e para a auditoria', async () => {
    auditorias.length = 0;
    const motivo = 'O webhook do n8n respondeu HTTP 500. Resposta: Error in workflow | password=[oculto]';
    vi.mocked(n8n.enviarSolicitacaoAoN8n).mockRejectedValueOnce(new n8n.ErroEnvioN8nFalhou(motivo));

    await servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');

    expect(repositorio.marcarSolicitacaoErro).toHaveBeenCalledWith('sol-1', motivo);
    expect(auditorias).toEqual([expect.objectContaining({ acao: 'SOLICITACAO_ERRO_N8N', valorNovo: expect.objectContaining({ erro: motivo }) })]);
  });
});
