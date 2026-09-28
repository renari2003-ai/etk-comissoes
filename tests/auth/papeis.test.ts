import { existsSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Papel } from '../../src/auth/tipos.js';

/**
 * Papéis "usuario"/"vendedor" (2026-09-28) e administração de usuários exclusiva do administrador.
 * Sobe as rotas reais de `autenticacaoRotas.ts` contra tabelas descartáveis (mesmo padrão de
 * `middleware.test.ts`) e chama a API diretamente — a proteção tem que valer no backend, não só na UI.
 */

// Cada teste faz dezenas de idas e voltas ao Supabase remoto (sessões + várias chamadas HTTP) —
// o limite padrão de 5s do Vitest não comporta isso.
vi.setConfig({ testTimeout: 60_000 });

let tabelaTemp: string;
let tabelaSessoesTemp: string;

beforeEach(() => {
  tabelaTemp = `usuarios_papeis_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  tabelaSessoesTemp = `sessoes_papeis_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.USUARIOS_TABELA = tabelaTemp;
  process.env.SESSOES_TABELA = tabelaSessoesTemp;
  process.env.USUARIOS_ARQUIVO = path.join(tmpdir(), `usuarios-papeis-inexistente-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.ADMIN_USUARIO = 'Ricardo'; // master — cobre também a redefinição de senha
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

async function montarServidor() {
  const { criarRotaAuth } = await import('../../src/rotas/autenticacaoRotas.js');
  const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
  const { criarSessao } = await import('../../src/auth/sessoes.js');
  const { NOME_COOKIE_SESSAO } = await import('../../src/auth/cookies.js');
  const repositorio = await import('../../src/auth/usuariosRepositorio.js');

  const app = express();
  app.use(express.json());
  app.use(criarRotaAuth());
  app.use(tratadorDeErros);
  const servidor = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const [admin] = await repositorio.listarUsuarios();

  async function cookiePara(usuarioId: string): Promise<string> {
    return `${NOME_COOKIE_SESSAO}=${await criarSessao(usuarioId)}`;
  }

  async function chamar(cookie: string, metodo: string, caminho: string, corpo?: unknown): Promise<Response> {
    return fetch(`${baseUrl}${caminho}`, {
      method: metodo,
      headers: { cookie, 'Content-Type': 'application/json' },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
  }

  return { servidor, admin: admin!, repositorio, cookiePara, chamar };
}

describe('administração de usuários — só administrador', () => {
  it('administrador lista, cria (usuario/vendedor), edita, redefine senha e exclui', async () => {
    const { servidor, admin, cookiePara, chamar } = await montarServidor();
    try {
      const cookie = await cookiePara(admin.id);

      expect((await chamar(cookie, 'GET', '/api/auth/usuarios')).status).toBe(200);

      const criarUsuario = await chamar(cookie, 'POST', '/api/auth/usuarios', {
        usuario: 'interno',
        nome: 'Interno',
        senha: 'senha123',
        papel: 'usuario',
        permissoes: { ...PERMISSOES_VAZIAS, relatorioVendas: true },
      });
      expect(criarUsuario.status).toBe(201);
      const interno = (await criarUsuario.json()) as { id: string; papel: Papel; permissoes: typeof PERMISSOES_VAZIAS };
      expect(interno.papel).toBe('usuario');
      expect(interno.permissoes.relatorioVendas).toBe(true);

      const criarVendedor = await chamar(cookie, 'POST', '/api/auth/usuarios', {
        usuario: 'vend',
        nome: 'Vendedor',
        senha: 'senha123',
        papel: 'vendedor',
        permissoes: { ...PERMISSOES_VAZIAS, fretes: true, fretesComercial: true },
        vendedorOmieId: 901,
      });
      expect(criarVendedor.status).toBe(201);
      const vendedor = (await criarVendedor.json()) as { id: string; papel: Papel; vendedorOmieId: number | null };
      expect(vendedor.papel).toBe('vendedor');
      expect(vendedor.vendedorOmieId).toBe(901);

      const editar = await chamar(cookie, 'PUT', `/api/auth/usuarios/${interno.id}`, {
        papel: 'vendedor',
        permissoes: { ...PERMISSOES_VAZIAS, consultaPedidos: true },
        vendedorOmieId: 902,
      });
      expect(editar.status).toBe(200);
      const editado = (await editar.json()) as { papel: Papel; vendedorOmieId: number | null; permissoes: typeof PERMISSOES_VAZIAS };
      expect(editado.papel).toBe('vendedor');
      expect(editado.vendedorOmieId).toBe(902);
      expect(editado.permissoes.consultaPedidos).toBe(true);

      expect((await chamar(cookie, 'POST', `/api/auth/usuarios/${interno.id}/senha`, { senha: 'novaSenha1' })).status).toBe(200);
      expect((await chamar(cookie, 'DELETE', `/api/auth/usuarios/${interno.id}`)).status).toBe(200);
    } finally {
      servidor.close();
    }
  });

  it('vínculo por nome: admin cria/edita/remove vendedorOmieNome, sem exigir vendedorOmieId', async () => {
    const { servidor, admin, repositorio, cookiePara, chamar } = await montarServidor();
    try {
      const cookie = await cookiePara(admin.id);
      const criar = await chamar(cookie, 'POST', '/api/auth/usuarios', {
        usuario: 'alice',
        nome: 'Alice',
        senha: 'senha123',
        papel: 'vendedor',
        permissoes: { ...PERMISSOES_VAZIAS, relatorioComissionamento: true },
        vendedorOmieNome: '  Alice Silva ',
      });
      expect(criar.status).toBe(201);
      const alice = (await criar.json()) as { id: string; vendedorOmieNome: string | null; vendedorOmieId: number | null };
      expect(alice.vendedorOmieNome).toBe('Alice Silva');
      expect(alice.vendedorOmieId).toBeNull();

      expect((await chamar(cookie, 'PUT', `/api/auth/usuarios/${alice.id}`, { vendedorOmieNome: 'Alice Souza' })).status).toBe(200);
      expect((await repositorio.buscarPorId(alice.id))?.vendedorOmieNome).toBe('Alice Souza');

      expect((await chamar(cookie, 'PUT', `/api/auth/usuarios/${alice.id}`, { vendedorOmieNome: 123 })).status).toBe(400);

      expect((await chamar(cookie, 'PUT', `/api/auth/usuarios/${alice.id}`, { vendedorOmieNome: null })).status).toBe(200);
      expect((await repositorio.buscarPorId(alice.id))?.vendedorOmieNome).toBeNull();
    } finally {
      servidor.close();
    }
  });

  it('rejeita papel desconhecido (400)', async () => {
    const { servidor, admin, cookiePara, chamar } = await montarServidor();
    try {
      const cookie = await cookiePara(admin.id);
      const resposta = await chamar(cookie, 'POST', '/api/auth/usuarios', {
        usuario: 'x',
        nome: 'X',
        senha: 'senha123',
        papel: 'gerente',
      });
      expect(resposta.status).toBe(400);
    } finally {
      servidor.close();
    }
  });

  for (const papel of ['usuario', 'vendedor', 'convidado'] as const) {
    it(`papel "${papel}" recebe 403 em todas as rotas de administração de usuários, mesmo com todas as permissões marcadas`, async () => {
      const { servidor, admin, repositorio, cookiePara, chamar } = await montarServidor();
      try {
        const todasPermissoes = Object.fromEntries(Object.keys(PERMISSOES_VAZIAS).map((chave) => [chave, true])) as unknown as typeof PERMISSOES_VAZIAS;
        const naoAdmin = await repositorio.criarUsuario({
          usuario: `nao-admin-${papel}`,
          nome: 'Não admin',
          senha: 'senha123',
          papel,
          permissoes: todasPermissoes,
          vendedorOmieId: papel === 'vendedor' ? 901 : null,
        });
        const cookie = await cookiePara(naoAdmin.id);

        const tentativas: Array<[string, string, unknown?]> = [
          ['GET', '/api/auth/usuarios'],
          ['POST', '/api/auth/usuarios', { usuario: 'novo', nome: 'Novo', senha: 'senha123', papel: 'administrador' }],
          ['PUT', `/api/auth/usuarios/${admin.id}`, { nome: 'Hackeado' }],
          ['PUT', `/api/auth/usuarios/${naoAdmin.id}`, { papel: 'administrador' }],
          ['PUT', `/api/auth/usuarios/${naoAdmin.id}`, { permissoes: todasPermissoes }],
          ['PUT', `/api/auth/usuarios/${admin.id}`, { vendedorOmieId: 999 }],
          ['POST', `/api/auth/usuarios/${admin.id}/senha`, { senha: 'senhaNova1' }],
          ['DELETE', `/api/auth/usuarios/${admin.id}`],
        ];
        for (const [metodo, caminho, corpo] of tentativas) {
          const resposta = await chamar(cookie, metodo, caminho, corpo);
          expect(resposta.status, `${metodo} ${caminho}`).toBe(403);
        }

        // Nada mudou: o próprio papel continua o mesmo e o admin continua intacto.
        expect((await repositorio.buscarPorId(naoAdmin.id))?.papel).toBe(papel);
        const adminDepois = await repositorio.buscarPorId(admin.id);
        expect(adminDepois?.nome).toBe(admin.nome);
        expect(adminDepois?.vendedorOmieId).toBeNull();

        // Autoatendimento continua liberado para qualquer papel.
        expect((await chamar(cookie, 'GET', '/api/auth/eu')).status).toBe(200);
      } finally {
        servidor.close();
      }
    });
  }
});

describe('papéis "usuario"/"vendedor" — permissões granulares e vínculo Omie', () => {
  it('exigirPermissao respeita os checkboxes para usuario e vendedor (nunca acesso total)', async () => {
    const { criarUsuario } = await import('../../src/auth/usuariosRepositorio.js');
    const { exigirPermissao } = await import('../../src/auth/middleware.js');
    for (const papel of ['usuario', 'vendedor'] as const) {
      const conta = await criarUsuario({
        usuario: `conta-${papel}`,
        nome: papel,
        senha: 'senha123',
        papel,
        permissoes: { ...PERMISSOES_VAZIAS, relatorioVendas: true },
      });
      const liberado = vi.fn();
      exigirPermissao('relatorioVendas')({ usuario: conta } as never, {} as never, liberado);
      expect(liberado).toHaveBeenCalledWith();
      const barrado = vi.fn();
      exigirPermissao('relatorioComissionamento')({ usuario: conta } as never, {} as never, barrado);
      expect(barrado).toHaveBeenCalledWith(expect.objectContaining({ name: 'ErroSemPermissao' }));
    }
  });

  it('atualizarUsuario grava permissões de usuario/vendedor e preserva vendedorOmieId', async () => {
    const { criarUsuario, atualizarUsuario, buscarPorId } = await import('../../src/auth/usuariosRepositorio.js');
    const vendedor = await criarUsuario({
      usuario: 'vend',
      nome: 'Vendedor',
      senha: 'senha123',
      papel: 'vendedor',
      permissoes: { ...PERMISSOES_VAZIAS },
      vendedorOmieId: 901,
    });
    await atualizarUsuario(vendedor.id, { permissoes: { ...PERMISSOES_VAZIAS, fretesComercial: true } });
    const salvo = await buscarPorId(vendedor.id);
    expect(salvo?.papel).toBe('vendedor');
    expect(salvo?.permissoes.fretesComercial).toBe(true);
    expect(salvo?.vendedorOmieId).toBe(901);
    expect(salvo?.mestre).toBe(false);
  });

  it('nunca deixa rebaixar o último administrador para usuario/vendedor', async () => {
    const { listarUsuarios, atualizarUsuario } = await import('../../src/auth/usuariosRepositorio.js');
    const [admin] = await listarUsuarios();
    await expect(atualizarUsuario(admin!.id, { papel: 'usuario' })).rejects.toThrow(/último administrador/i);
    await expect(atualizarUsuario(admin!.id, { papel: 'vendedor' })).rejects.toThrow(/último administrador/i);
  });
});

describe('compatibilidade — tabela antiga com CHECK (administrador, convidado)', () => {
  it('amplia o CHECK de forma aditiva, sem converter nem perder usuários existentes', async () => {
    const { obterPool } = await import('../../src/db.js');
    const pool = obterPool();
    await pool.query(`
      CREATE TABLE ${tabelaTemp} (
        id UUID PRIMARY KEY,
        usuario TEXT NOT NULL,
        nome TEXT NOT NULL,
        papel TEXT NOT NULL CHECK (papel IN ('administrador', 'convidado')),
        senha_hash TEXT NOT NULL,
        permissoes JSONB NOT NULL,
        senha_provisoria BOOLEAN NOT NULL DEFAULT true,
        mestre BOOLEAN NOT NULL DEFAULT false
      )
    `);
    await pool.query(
      `INSERT INTO ${tabelaTemp} (id, usuario, nome, papel, senha_hash, permissoes) VALUES
       ('00000000-0000-0000-0000-000000000001', 'admin', 'Admin', 'administrador', 'x', $1),
       ('00000000-0000-0000-0000-000000000002', 'legado', 'Legado', 'convidado', 'x', $2)`,
      [JSON.stringify(PERMISSOES_VAZIAS), JSON.stringify({ ...PERMISSOES_VAZIAS, fretes: true })],
    );

    const { listarUsuarios, criarUsuario } = await import('../../src/auth/usuariosRepositorio.js');
    const antes = await listarUsuarios();
    expect(antes.map((u) => [u.usuario, u.papel])).toEqual([
      ['admin', 'administrador'],
      ['legado', 'convidado'],
    ]);
    expect(antes.find((u) => u.usuario === 'legado')?.permissoes.fretes).toBe(true);

    const vendedor = await criarUsuario({ usuario: 'v', nome: 'V', senha: 'senha123', papel: 'vendedor', permissoes: { ...PERMISSOES_VAZIAS } });
    const usuario = await criarUsuario({ usuario: 'u', nome: 'U', senha: 'senha123', papel: 'usuario', permissoes: { ...PERMISSOES_VAZIAS } });
    expect(vendedor.papel).toBe('vendedor');
    expect(usuario.papel).toBe('usuario');

    await expect(
      pool.query(`INSERT INTO ${tabelaTemp} (id, usuario, nome, papel, senha_hash, permissoes) VALUES (gen_random_uuid(), 'z', 'Z', 'invalido', 'x', '{}')`),
    ).rejects.toThrow(/check/i);
  });
});
