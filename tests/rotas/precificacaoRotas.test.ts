import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Usuario } from '../../src/auth/tipos.js';
import { PARAMETROS_GERAIS_INICIAIS, UFS_INICIAIS } from '../../src/precificacao/parametrosFiscais.js';

// Sessão e banco simulados: estes testes conferem SÓ a proteção e a validação das rotas, sem
// tocar banco nenhum. Token "admin" → administrador; "comPermissao" → usuário com a permissão
// `precificacao`; "semPermissao" → usuário sem ela.
function usuario(papel: Usuario['papel'], precificacao: boolean): Usuario {
  return {
    id: `id-${papel}-${precificacao}`,
    usuario: papel,
    nome: `Nome ${papel}`,
    papel,
    senhaHash: 'x',
    permissoes: { ...PERMISSOES_VAZIAS, precificacao },
    senhaProvisoria: false,
    mestre: false,
    vendedorOmieId: null,
    vendedorOmieNome: null,
  } as Usuario;
}
const USUARIOS: Record<string, Usuario> = {
  admin: usuario('administrador', false),
  comPermissao: usuario('usuario', true),
  semPermissao: usuario('usuario', false),
};

vi.mock('../../src/auth/sessoes.js', () => ({
  validarSessao: vi.fn(async (token: string) => (token in USUARIOS ? token : null)),
}));
vi.mock('../../src/auth/usuariosRepositorio.js', () => ({
  buscarPorId: vi.fn(async (id: string) => USUARIOS[id] ?? null),
}));
const repositorio = vi.hoisted(() => ({
  lerTabelaFiscal: vi.fn(),
  atualizarTabelaFiscal: vi.fn(),
  listarHistorico: vi.fn(),
}));
vi.mock('../../src/precificacao/parametrosFiscaisRepositorio.js', () => repositorio);

const { criarRotasPrecificacao } = await import('../../src/rotas/precificacaoRotas.js');
const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
const { NOME_COOKIE_SESSAO } = await import('../../src/auth/cookies.js');

const TABELA = { gerais: PARAMETROS_GERAIS_INICIAIS, ufs: UFS_INICIAIS, excecoesNcm: [], versao: 0, atualizadoEm: null, atualizadoPor: null };

describe('rotas da tabela fiscal da precificação — proteção e validação', () => {
  const app = express();
  let servidor: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(() => {
    app.use(express.json({ limit: '100kb' }));
    app.use(criarRotasPrecificacao());
    app.get('/rota-publica-alheia', (_req, res) => res.json({ ok: true }));
    app.use(tratadorDeErros);
    servidor = app.listen(0);
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    servidor.close();
  });

  beforeEach(() => {
    repositorio.lerTabelaFiscal.mockReset().mockResolvedValue(TABELA);
    repositorio.atualizarTabelaFiscal.mockReset().mockResolvedValue({ tabela: TABELA, alteracoes: [] });
    repositorio.listarHistorico.mockReset().mockResolvedValue([]);
  });

  const como = (token: string | null, caminho: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${caminho}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Cookie: `${NOME_COOKIE_SESSAO}=${token}` }) },
    });
  const put = (token: string | null, corpo: unknown) => como(token, '/api/precificacao/parametros-fiscais', { method: 'PUT', body: JSON.stringify(corpo) });
  const corpoValido = () => ({ versao: 0, gerais: PARAMETROS_GERAIS_INICIAIS, ufs: UFS_INICIAIS, excecoesNcm: [] });

  it('sem sessão: 401 na leitura, na gravação e no histórico, sem tocar o banco', async () => {
    expect((await como(null, '/api/precificacao/parametros-fiscais')).status).toBe(401);
    expect((await put(null, corpoValido())).status).toBe(401);
    expect((await como(null, '/api/precificacao/parametros-fiscais/historico')).status).toBe(401);
    expect(repositorio.lerTabelaFiscal).not.toHaveBeenCalled();
    expect(repositorio.atualizarTabelaFiscal).not.toHaveBeenCalled();
  });

  it('leitura: 200 com a permissão "precificacao"; 403 sem ela; administrador sempre lê', async () => {
    expect((await como('comPermissao', '/api/precificacao/parametros-fiscais')).status).toBe(200);
    expect((await como('semPermissao', '/api/precificacao/parametros-fiscais')).status).toBe(403);
    expect((await como('admin', '/api/precificacao/parametros-fiscais')).status).toBe(200);
  });

  it('gravação e histórico: 403 para não administrador, MESMO com a permissão "precificacao", com mensagem própria', async () => {
    const resposta = await put('comPermissao', corpoValido());
    expect(resposta.status).toBe(403);
    expect(((await resposta.json()) as { erro: string }).erro).toBe('Só administradores podem alterar a tabela fiscal e ver o histórico.');
    expect((await como('comPermissao', '/api/precificacao/parametros-fiscais/historico')).status).toBe(403);
    expect(repositorio.atualizarTabelaFiscal).not.toHaveBeenCalled();
    expect(repositorio.listarHistorico).not.toHaveBeenCalled();
  });

  it('administrador: PUT válido grava (com a versão e o usuário) e devolve a tabela', async () => {
    const resposta = await put('admin', corpoValido());
    expect(resposta.status).toBe(200);
    expect(repositorio.atualizarTabelaFiscal).toHaveBeenCalledWith(
      { gerais: PARAMETROS_GERAIS_INICIAIS, ufs: UFS_INICIAIS, excecoesNcm: [] },
      0,
      { id: 'id-administrador-false', nome: 'Nome administrador' },
    );
  });

  it('administrador: payload inválido dá 400 e nunca chega ao banco', async () => {
    for (const corpo of [{ ...corpoValido(), extra: 1 }, { ...corpoValido(), versao: undefined }, { ...corpoValido(), gerais: { ...PARAMETROS_GERAIS_INICIAIS, irCs: '34' } }]) {
      expect((await put('admin', corpo)).status).toBe(400);
    }
    expect(repositorio.atualizarTabelaFiscal).not.toHaveBeenCalled();
  });

  it('conflito de versão do repositório vira 409', async () => {
    const { ErroConflito } = await import('../../src/validacao.js');
    repositorio.atualizarTabelaFiscal.mockRejectedValueOnce(new ErroConflito('A tabela fiscal foi alterada por outro usuário. Recarregue.'));
    const resposta = await put('admin', corpoValido());
    expect(resposta.status).toBe(409);
    expect(((await resposta.json()) as { erro: string }).erro).toContain('Recarregue');
  });

  it('histórico: limite validado (400 fora da faixa)', async () => {
    expect((await como('admin', '/api/precificacao/parametros-fiscais/historico?limite=10')).status).toBe(200);
    expect(repositorio.listarHistorico).toHaveBeenCalledWith(10);
    expect((await como('admin', '/api/precificacao/parametros-fiscais/historico?limite=0')).status).toBe(400);
    expect((await como('admin', '/api/precificacao/parametros-fiscais/historico?limite=abc')).status).toBe(400);
  });

  it('nunca bloqueia uma rota alheia montada depois', async () => {
    expect((await fetch(`${baseUrl}/rota-publica-alheia`)).status).toBe(200);
  });
});
