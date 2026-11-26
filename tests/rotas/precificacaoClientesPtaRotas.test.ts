import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Usuario } from '../../src/auth/tipos.js';

// Sessão, banco e Omie simulados: conferem SÓ a proteção e a validação das rotas de "cliente com PTA".
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
  listarClientesComPta: vi.fn(),
  listarHistoricoClientesPta: vi.fn(),
  obterClientePta: vi.fn(),
  obterClientesPta: vi.fn(),
  salvarClientePta: vi.fn(),
}));
vi.mock('../../src/precificacao/clientesPtaRepositorio.js', () => repositorio);

const { criarRotasClientesPta } = await import('../../src/rotas/precificacaoClientesPta.js');
const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
const { NOME_COOKIE_SESSAO } = await import('../../src/auth/cookies.js');
const { ErroConflito } = await import('../../src/validacao.js');

const omie = { buscarClientes: vi.fn(), consultarClienteFiscal: vi.fn() };
const corpoValido = () => ({ versao: null, comPta: true });

describe('rotas "cliente com PTA" — proteção, validação e Omie só leitura', () => {
  const app = express();
  let servidor: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(() => {
    app.use(express.json({ limit: '100kb' }));
    app.use(criarRotasClientesPta(omie));
    app.use(tratadorDeErros);
    servidor = app.listen(0);
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    servidor.close();
  });

  beforeEach(() => {
    repositorio.listarClientesComPta.mockReset().mockResolvedValue([]);
    repositorio.listarHistoricoClientesPta.mockReset().mockResolvedValue([]);
    repositorio.obterClientePta.mockReset().mockResolvedValue(null);
    repositorio.obterClientesPta.mockReset().mockResolvedValue(new Map());
    repositorio.salvarClientePta.mockReset().mockImplementation(async (c: object) => ({ cliente: { ...c, versao: 1 }, alteracoes: 3 }));
    omie.buscarClientes.mockReset().mockResolvedValue([]);
    omie.consultarClienteFiscal.mockReset().mockResolvedValue({ codigo: 10, razaoSocial: 'Cliente Teste Ltda', cnpjCpf: '12345678000199', uf: 'MG', contribuinte: true, inscricaoEstadual: '1' });
  });

  const como = (token: string | null, caminho: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${caminho}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Cookie: `${NOME_COOKIE_SESSAO}=${token}` }) },
    });
  const put = (token: string | null, codigo: string, corpo: unknown) => como(token, `/api/precificacao/clientes-pta/${codigo}`, { method: 'PUT', body: JSON.stringify(corpo) });

  it('sem sessão: 401 em tudo, sem tocar banco nem Omie', async () => {
    expect((await como(null, '/api/precificacao/clientes-pta')).status).toBe(401);
    expect((await como(null, '/api/precificacao/clientes-pta/10')).status).toBe(401);
    expect((await put(null, '10', corpoValido())).status).toBe(401);
    expect((await como(null, '/api/precificacao/clientes/busca?nome=Acme')).status).toBe(401);
    expect(repositorio.listarClientesComPta).not.toHaveBeenCalled();
    expect(omie.buscarClientes).not.toHaveBeenCalled();
  });

  it('leitura e busca: permissão "precificacao"; 403 sem ela', async () => {
    expect((await como('comPermissao', '/api/precificacao/clientes-pta')).status).toBe(200);
    expect((await como('semPermissao', '/api/precificacao/clientes-pta')).status).toBe(403);
    const lido = await como('comPermissao', '/api/precificacao/clientes-pta/10');
    expect(await lido.json()).toEqual({ codigoCliente: 10, salvo: null });
    expect((await como('comPermissao', '/api/precificacao/clientes-pta/abc')).status).toBe(400);
    expect((await como('semPermissao', '/api/precificacao/clientes/busca?nome=Acme')).status).toBe(403);
  });

  it('marcar e histórico: só administrador (403 para operador, mesmo com a permissão)', async () => {
    const resposta = await put('comPermissao', '10', corpoValido());
    expect(resposta.status).toBe(403);
    expect(((await resposta.json()) as { erro: string }).erro).toContain('Só administradores');
    expect((await como('comPermissao', '/api/precificacao/clientes-pta/historico')).status).toBe(403);
    expect(repositorio.salvarClientePta).not.toHaveBeenCalled();
  });

  it('administrador: PUT válido grava com a versão e o usuário; payload inválido dá 400; conflito dá 409', async () => {
    const ok = await put('admin', '10', corpoValido());
    expect(ok.status).toBe(200);
    expect(repositorio.salvarClientePta).toHaveBeenCalledWith(
      { codigoCliente: 10, comPta: true, nomeCliente: 'Cliente Teste Ltda', cnpjCpf: '12345678000199' },
      null,
      { id: 'id-administrador-false', nome: 'Nome administrador' },
    );
    expect(omie.consultarClienteFiscal).toHaveBeenCalledWith(10);
    repositorio.salvarClientePta.mockClear();
    // Cliente que o Omie diz não existir: 400, nada gravado.
    omie.consultarClienteFiscal.mockResolvedValueOnce(null);
    const inexistente = await put('admin', '10', corpoValido());
    expect(inexistente.status).toBe(400);
    expect(((await inexistente.json()) as { erro: string }).erro).toContain('não encontrado no Omie');
    for (const [codigo, corpo] of [['10', { ...corpoValido(), extra: 1 }], ['10', { ...corpoValido(), nomeCliente: 'X' }], ['10', { ...corpoValido(), comPta: 'S' }], ['0', corpoValido()]] as const) {
      expect((await put('admin', codigo, corpo)).status).toBe(400);
    }
    expect(repositorio.salvarClientePta).not.toHaveBeenCalled();
    repositorio.salvarClientePta.mockRejectedValueOnce(new ErroConflito('Recarregue a tela.'));
    expect((await put('admin', '10', { ...corpoValido(), versao: 1 })).status).toBe(409);
  });

  it('histórico: filtro por cliente e limite validados', async () => {
    expect((await como('admin', '/api/precificacao/clientes-pta/historico?codigo=10&limite=5')).status).toBe(200);
    expect(repositorio.listarHistoricoClientesPta).toHaveBeenCalledWith(10, 5);
    expect((await como('admin', '/api/precificacao/clientes-pta/historico?limite=0')).status).toBe(400);
    expect((await como('admin', '/api/precificacao/clientes-pta/historico?codigo=x')).status).toBe(400);
  });

  it('busca: chama SÓ a consulta do Omie, devolve só o necessário e junta a situação no app', async () => {
    omie.buscarClientes.mockResolvedValue([
      { codigo: 10, razaoSocial: 'Acme Ltda', nomeFantasia: 'Acme', cnpjCpf: '12345678000199', email: 'x@y', telefone: '1', contato: 'Fulano' },
    ]);
    const salvo = { codigoCliente: 10, comPta: true, nomeCliente: 'Acme Ltda', cnpjCpf: '12345678000199', versao: 2, atualizadoEm: 'x', atualizadoPor: 'A' };
    repositorio.obterClientesPta.mockResolvedValue(new Map([[10, salvo]]));
    const resposta = await como('comPermissao', '/api/precificacao/clientes/busca?nome=Acme');
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([{ codigoCliente: 10, razaoSocial: 'Acme Ltda', nomeFantasia: 'Acme', cnpjCpf: '12345678000199', salvo }]);
    expect(omie.buscarClientes).toHaveBeenCalledWith({ razaoSocial: 'Acme' });
    await como('comPermissao', '/api/precificacao/clientes/busca?cnpj=12.345.678/0001-99');
    expect(omie.buscarClientes).toHaveBeenLastCalledWith({ cnpj: '12345678000199' });
    expect((await como('comPermissao', '/api/precificacao/clientes/busca?nome=ab')).status).toBe(400);
  });
});
