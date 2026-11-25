import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Usuario } from '../../src/auth/tipos.js';

// Sessão e banco simulados: conferem SÓ a proteção e a validação das rotas de custo manual.
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
vi.mock('../../src/precificacao/parametrosFiscaisRepositorio.js', () => ({}));
const repositorio = vi.hoisted(() => ({
  listarCustosManuais: vi.fn(),
  listarHistoricoCustosManuais: vi.fn(),
  salvarCustoManual: vi.fn(),
  removerCustoManual: vi.fn(),
}));
vi.mock('../../src/precificacao/custosManuaisRepositorio.js', () => repositorio);

const { criarRotasPrecificacao } = await import('../../src/rotas/precificacaoRotas.js');
const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
const { NOME_COOKIE_SESSAO } = await import('../../src/auth/cookies.js');
const { ErroConflito } = await import('../../src/validacao.js');

const corpoValido = () => ({
  versao: null,
  valorNota: 3.5,
  ufFornecedor: 'MG',
  diferimentoPta: true,
  mercadoriaImportada: false,
  tipoFornecedor: 'INDUSTRIA_NORMAL',
  ipiPercentual: 12,
});

describe('rotas de custo manual da precificação — proteção e validação', () => {
  const app = express();
  let servidor: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(() => {
    app.use(express.json({ limit: '100kb' }));
    app.use(criarRotasPrecificacao());
    app.use(tratadorDeErros);
    servidor = app.listen(0);
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    servidor.close();
  });

  beforeEach(() => {
    repositorio.listarCustosManuais.mockReset().mockResolvedValue([]);
    repositorio.listarHistoricoCustosManuais.mockReset().mockResolvedValue([]);
    repositorio.salvarCustoManual.mockReset().mockImplementation(async (custo: object) => ({ custo: { ...custo, versao: 1 }, alteracoes: 6 }));
    repositorio.removerCustoManual.mockReset().mockResolvedValue(undefined);
  });

  const como = (token: string | null, caminho: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${caminho}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Cookie: `${NOME_COOKIE_SESSAO}=${token}` }) },
    });

  it('sem sessão: 401 em todas; sem a permissão `precificacao`: 403 — e o banco nunca é tocado', async () => {
    for (const token of [null, 'semPermissao']) {
      const esperado = token === null ? 401 : 403;
      expect((await como(token, '/api/precificacao/custos-manuais')).status).toBe(esperado);
      expect((await como(token, '/api/precificacao/custos-manuais/historico')).status).toBe(esperado);
      expect((await como(token, '/api/precificacao/custos-manuais/MP1', { method: 'PUT', body: JSON.stringify(corpoValido()) })).status).toBe(esperado);
      expect((await como(token, '/api/precificacao/custos-manuais/MP1', { method: 'DELETE', body: JSON.stringify({ versao: 1 }) })).status).toBe(esperado);
    }
    expect(repositorio.salvarCustoManual).not.toHaveBeenCalled();
    expect(repositorio.removerCustoManual).not.toHaveBeenCalled();
    expect(repositorio.listarCustosManuais).not.toHaveBeenCalled();
  });

  it('quem tem a permissão `precificacao` (e o administrador) lê e grava; o usuário vai para o histórico', async () => {
    for (const token of ['comPermissao', 'admin']) {
      const resposta = await como(token, '/api/precificacao/custos-manuais/mp00000045', { method: 'PUT', body: JSON.stringify(corpoValido()) });
      expect(resposta.status).toBe(200);
    }
    expect(repositorio.salvarCustoManual).toHaveBeenNthCalledWith(1, expect.objectContaining({ codigo: 'MP00000045', valorNota: 3.5 }), null, { id: 'id-usuario-true', nome: 'Nome usuario' });
    expect((await como('comPermissao', '/api/precificacao/custos-manuais')).status).toBe(200);
  });

  it('payload malformado → 400 sem gravar (campo extra, PTA fora de MG, código inválido)', async () => {
    const extra = await como('comPermissao', '/api/precificacao/custos-manuais/MP1', { method: 'PUT', body: JSON.stringify({ ...corpoValido(), extra: 1 }) });
    expect(extra.status).toBe(400);
    const pta = await como('comPermissao', '/api/precificacao/custos-manuais/MP1', { method: 'PUT', body: JSON.stringify({ ...corpoValido(), ufFornecedor: 'SP' }) });
    expect(pta.status).toBe(400);
    const codigo = await como('comPermissao', '/api/precificacao/custos-manuais/MP1%3BDROP', { method: 'PUT', body: JSON.stringify(corpoValido()) });
    expect(codigo.status).toBe(400);
    const historico = await como('comPermissao', '/api/precificacao/custos-manuais/historico?limite=abc');
    expect(historico.status).toBe(400);
    expect((await como('comPermissao', '/api/precificacao/custos-manuais/historico?codigo=MP1%3BDROP')).status).toBe(400);
    expect((await como('comPermissao', '/api/precificacao/custos-manuais/historico?codigo=a&codigo=b')).status).toBe(400);
    // "historico" é caminho da API, nunca código: PUT nele não cria custo manual.
    expect((await como('comPermissao', '/api/precificacao/custos-manuais/historico', { method: 'PUT', body: JSON.stringify(corpoValido()) })).status).toBe(400);
    expect(repositorio.salvarCustoManual).not.toHaveBeenCalled();
  });

  it('conflito de versão vira 409; remoção bem-sucedida responde 204', async () => {
    repositorio.salvarCustoManual.mockRejectedValueOnce(new ErroConflito('alterado por outro usuário'));
    expect((await como('comPermissao', '/api/precificacao/custos-manuais/MP1', { method: 'PUT', body: JSON.stringify({ ...corpoValido(), versao: 1 }) })).status).toBe(409);
    const remover = await como('comPermissao', '/api/precificacao/custos-manuais/MP1', { method: 'DELETE', body: JSON.stringify({ versao: 2 }) });
    expect(remover.status).toBe(204);
    expect(repositorio.removerCustoManual).toHaveBeenCalledWith('MP1', 2, { id: 'id-usuario-true', nome: 'Nome usuario' });
    expect((await como('comPermissao', '/api/precificacao/custos-manuais/MP1', { method: 'DELETE', body: JSON.stringify({}) })).status).toBe(400);
  });
});
