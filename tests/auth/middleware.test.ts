import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS } from '../../src/auth/tipos.js';

let tabelaTemp: string;
let tabelaSessoesTemp: string;

beforeEach(() => {
  tabelaTemp = `usuarios_mw_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  tabelaSessoesTemp = `sessoes_mw_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.USUARIOS_TABELA = tabelaTemp;
  process.env.SESSOES_TABELA = tabelaSessoesTemp;
  process.env.USUARIOS_ARQUIVO = path.join(tmpdir(), `usuarios-mw-teste-inexistente-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.ADMIN_USUARIO = 'admin';
  process.env.ADMIN_SENHA = 'senhaAdmin123';
  vi.resetModules();
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  await pool.query(`DROP TABLE IF EXISTS ${tabelaTemp}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${tabelaSessoesTemp}`).catch(() => undefined);
  if (existsSync(process.env.USUARIOS_ARQUIVO!)) rmSync(process.env.USUARIOS_ARQUIVO!);
  delete process.env.USUARIOS_TABELA;
  delete process.env.SESSOES_TABELA;
  delete process.env.USUARIOS_ARQUIVO;
  delete process.env.ADMIN_USUARIO;
  delete process.env.ADMIN_SENHA;
});

/** Monta um req/res/next falsos e importa auth/{middleware,sessoes,usuarios,cookies}.js do MESMO registro de módulos (resetado uma vez no beforeEach), para que a sessão criada em `sessoes.ts` seja enxergada por `middleware.ts`. */
async function montarAmbiente() {
  const { NOME_COOKIE_SESSAO } = await import('../../src/auth/cookies.js');
  const { criarSessao } = await import('../../src/auth/sessoes.js');
  const { criarUsuario, listarUsuarios } = await import('../../src/auth/usuariosRepositorio.js');
  const { exigirAutenticacao, exigirPermissao, exigirAdministrador, exigirAdministradorMestre } = await import('../../src/auth/middleware.js');
  const [admin] = await listarUsuarios();
  return {
    NOME_COOKIE_SESSAO,
    criarSessao,
    criarUsuario,
    admin: admin!,
    exigirAutenticacao,
    exigirPermissao,
    exigirAdministrador,
    exigirAdministradorMestre,
  };
}

function reqComCookie(nomeCookie: string, token: string | null): { headers: { cookie?: string } } {
  return { headers: token === null ? {} : { cookie: `${nomeCookie}=${token}` } };
}

/** `exigirAutenticacao` resolve `next` de forma assíncrona (lê o usuário do arquivo) — espera pela chamada em vez de um `setTimeout` arbitrário, evitando flakiness. */
function chamarEEsperarNext(
  middleware: (req: never, res: never, next: (erro?: unknown) => void) => void,
  req: unknown,
): Promise<unknown> {
  return new Promise((resolve) => {
    middleware(req as never, {} as never, (erro?: unknown) => resolve(erro));
  });
}

describe('exigirAutenticacao', () => {
  it('chama next() com erro (nunca preenche req.usuario) quando não há cookie', async () => {
    const { exigirAutenticacao } = await montarAmbiente();
    const req = reqComCookie('sessao_etk', null);
    const erro = await chamarEEsperarNext(exigirAutenticacao, req);
    expect(erro).toMatchObject({ name: 'ErroNaoAutenticado' });
  });

  it('popula req.usuario (sem senhaHash) e chama next() sem erro com uma sessão válida', async () => {
    const { NOME_COOKIE_SESSAO, criarSessao, admin, exigirAutenticacao } = await montarAmbiente();
    const token = await criarSessao(admin.id);
    const req: { headers: { cookie?: string }; usuario?: { usuario: string; senhaHash?: string } } = reqComCookie(
      NOME_COOKIE_SESSAO,
      token,
    );
    const erro = await chamarEEsperarNext(exigirAutenticacao, req);
    expect(erro).toBeUndefined();
    expect(req.usuario?.usuario).toBe('admin');
    expect(req.usuario?.senhaHash).toBeUndefined();
  });

  it('rejeita token de sessão inexistente/expirado', async () => {
    const { NOME_COOKIE_SESSAO, exigirAutenticacao } = await montarAmbiente();
    const req = reqComCookie(NOME_COOKIE_SESSAO, 'token-que-nunca-existiu');
    const erro = await chamarEEsperarNext(exigirAutenticacao, req);
    expect(erro).toMatchObject({ name: 'ErroNaoAutenticado' });
  });
});

describe('exigirPermissao', () => {
  it('administrador sempre passa, mesmo com a permissão "false" no objeto (é ignorado)', async () => {
    const { admin, exigirPermissao } = await montarAmbiente();
    const next = vi.fn();
    const req = { usuario: admin } as never;
    exigirPermissao('relatorioComissionamento')(req, {} as never, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('convidado passa quando a permissão específica é true', async () => {
    const { criarUsuario, exigirPermissao } = await montarAmbiente();
    const convidado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS, consultaPedidos: true },
    });
    const next = vi.fn();
    exigirPermissao('consultaPedidos')({ usuario: convidado } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('convidado é barrado (403) quando a permissão específica é false', async () => {
    const { criarUsuario, exigirPermissao } = await montarAmbiente();
    const convidado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS, consultaPedidos: true },
    });
    const next = vi.fn();
    exigirPermissao('relatorioComissionamento')({ usuario: convidado } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ErroSemPermissao' }));
  });
});

describe('exigirAdministrador', () => {
  it('deixa administrador passar', async () => {
    const { admin, exigirAdministrador } = await montarAmbiente();
    const next = vi.fn();
    exigirAdministrador({ usuario: admin } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('barra convidado (403)', async () => {
    const { criarUsuario, exigirAdministrador } = await montarAmbiente();
    const convidado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    const next = vi.fn();
    exigirAdministrador({ usuario: convidado } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ErroSemPermissao' }));
  });
});

describe('exigirAdministradorMestre (recuperação de acesso — só Ricardo/Wendell, regra de 2026-09-11)', () => {
  it('deixa passar um administrador master', async () => {
    process.env.ADMIN_USUARIO = 'Ricardo';
    const { admin, exigirAdministradorMestre } = await montarAmbiente();
    expect(admin.mestre).toBe(true); // confere a premissa do teste antes de testar o middleware
    const next = vi.fn();
    exigirAdministradorMestre({ usuario: admin } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('barra (403) um administrador comum, mesmo passando em exigirAdministrador', async () => {
    // Fixture padrão: ADMIN_USUARIO="admin" — administrador, mas NÃO master.
    const { admin, exigirAdministradorMestre } = await montarAmbiente();
    expect(admin.mestre).toBe(false);
    const next = vi.fn();
    exigirAdministradorMestre({ usuario: admin } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ErroSemPermissao' }));
  });

  it('barra (403) um convidado', async () => {
    const { criarUsuario, exigirAdministradorMestre } = await montarAmbiente();
    const convidado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    const next = vi.fn();
    exigirAdministradorMestre({ usuario: convidado } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ErroSemPermissao' }));
  });
});
