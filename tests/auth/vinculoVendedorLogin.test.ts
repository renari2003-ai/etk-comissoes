import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Papel } from '../../src/auth/tipos.js';
import { sugerirVendedorPorLogin } from '../../src/auth/vinculoVendedor.js';
import type { Vendedor } from '../../src/omie/cliente.js';

/**
 * Vínculo usuário ↔ vendedor Omie por NOME a partir do login (regra de 2026-09-28): o login é só a
 * tentativa automática inicial (papel "vendedor"), comparada por trim/caixa — nunca fuzzy. O nome
 * fica gravado à parte em `vendedorOmieNome`. Mesmo padrão de `papeis.test.ts`: rotas reais contra
 * tabelas descartáveis; a Omie é um dublê de `listarVendedores` (somente leitura).
 */

vi.setConfig({ testTimeout: 60_000 });

const VENDEDORES_OMIE: Vendedor[] = [
  { codigo: 11, nome: 'BRUNA PINTO', inativo: false },
  { codigo: 12, nome: 'BRUNA PINTO', inativo: false },
  { codigo: 21, nome: 'Alice Silva', inativo: false },
  { codigo: 31, nome: 'Carlos Souza', inativo: false },
  { codigo: 41, nome: 'Duda Lima', inativo: false },
  { codigo: 42, nome: 'DUDA LIMA', inativo: false },
];

describe('sugerirVendedorPorLogin — igualdade exata após trim/caixa', () => {
  it('login "Bruna Pinto" casa com "BRUNA PINTO" (vários códigos com a mesma grafia = um nome)', () => {
    expect(sugerirVendedorPorLogin('  bruna pinto ', VENDEDORES_OMIE)).toEqual({ status: 'ENCONTRADO', nome: 'BRUNA PINTO' });
  });

  it('nunca fuzzy: primeiro nome, nome parecido ou parcial não casam', () => {
    expect(sugerirVendedorPorLogin('Bruna', VENDEDORES_OMIE).status).toBe('NAO_ENCONTRADO');
    expect(sugerirVendedorPorLogin('Bruna Pinta', VENDEDORES_OMIE).status).toBe('NAO_ENCONTRADO');
    expect(sugerirVendedorPorLogin('Alice', VENDEDORES_OMIE).status).toBe('NAO_ENCONTRADO');
    expect(sugerirVendedorPorLogin('Bruna  Pinto', VENDEDORES_OMIE).status).toBe('NAO_ENCONTRADO');
    expect(sugerirVendedorPorLogin('   ', VENDEDORES_OMIE).status).toBe('NAO_ENCONTRADO');
  });

  it('grafias diferentes que só casam após normalizar são ambíguas', () => {
    expect(sugerirVendedorPorLogin('duda lima', VENDEDORES_OMIE)).toEqual({ status: 'AMBIGUO', nomes: ['Duda Lima', 'DUDA LIMA'] });
  });
});

let tabelaTemp: string;
let tabelaSessoesTemp: string;

beforeEach(() => {
  tabelaTemp = `usuarios_vinculo_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  tabelaSessoesTemp = `sessoes_vinculo_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.USUARIOS_TABELA = tabelaTemp;
  process.env.SESSOES_TABELA = tabelaSessoesTemp;
  process.env.USUARIOS_ARQUIVO = path.join(tmpdir(), `usuarios-vinculo-inexistente-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.ADMIN_USUARIO = 'Ricardo';
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

async function montarServidor(listarVendedores: () => Promise<Vendedor[]> = async () => VENDEDORES_OMIE) {
  const { criarRotaAuth } = await import('../../src/rotas/autenticacaoRotas.js');
  const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
  const { criarSessao } = await import('../../src/auth/sessoes.js');
  const { NOME_COOKIE_SESSAO } = await import('../../src/auth/cookies.js');
  const repositorio = await import('../../src/auth/usuariosRepositorio.js');
  const { obterPool } = await import('../../src/db.js');

  const app = express();
  app.use(express.json());
  app.use(criarRotaAuth({ listarVendedores }));
  app.use(tratadorDeErros);
  const servidor = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const [admin] = await repositorio.listarUsuarios();
  const cookieAdmin = `${NOME_COOKIE_SESSAO}=${await criarSessao(admin!.id)}`;

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

  async function criarPelaApi(usuario: string, nome: string, papel: Papel) {
    const resposta = await chamar(cookieAdmin, 'POST', '/api/auth/usuarios', {
      usuario,
      nome,
      senha: 'senha123',
      papel,
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    expect(resposta.status).toBe(201);
    return (await resposta.json()) as {
      id: string;
      vendedorOmieNome: string | null;
      vendedorOmieId: number | null;
      vinculoVendedorOmie: { status: string; nome?: string; mensagem?: string };
    };
  }

  return { servidor, admin: admin!, cookieAdmin, repositorio, pool: obterPool(), cookiePara, chamar, criarPelaApi };
}

describe('criação de vendedor — login como sugestão inicial', () => {
  it('Bruna / login "Bruna Pinto" / Vendedor → associa ao "BRUNA PINTO" da Omie (caixa diferente)', async () => {
    const { servidor, repositorio, criarPelaApi } = await montarServidor();
    try {
      const bruna = await criarPelaApi('Bruna Pinto', 'Bruna', 'vendedor');
      expect(bruna.vinculoVendedorOmie).toEqual({ status: 'VINCULADO', nome: 'BRUNA PINTO' });
      expect(bruna.vendedorOmieNome).toBe('BRUNA PINTO');
      expect(bruna.vendedorOmieId).toBeNull();
      expect((await repositorio.buscarPorId(bruna.id))?.vendedorOmieNome).toBe('BRUNA PINTO');
    } finally {
      servidor.close();
    }
  });

  it('nome não encontrado → cria sem vínculo e avisa o administrador', async () => {
    const { servidor, repositorio, criarPelaApi } = await montarServidor();
    try {
      const alice = await criarPelaApi('Alice', 'Alice', 'vendedor');
      expect(alice.vinculoVendedorOmie.status).toBe('NAO_ENCONTRADO');
      expect(alice.vinculoVendedorOmie.mensagem).toMatch(/Não foi encontrado vendedor Omie com o nome "Alice"/);
      expect(alice.vendedorOmieNome).toBeNull();
      expect((await repositorio.buscarPorId(alice.id))?.vendedorOmieNome).toBeNull();
    } finally {
      servidor.close();
    }
  });

  it('Omie indisponível → cria sem vínculo (nunca inventa)', async () => {
    const { servidor, criarPelaApi } = await montarServidor(async () => {
      throw new Error('Omie fora do ar');
    });
    try {
      const bruna = await criarPelaApi('Bruna Pinto', 'Bruna', 'vendedor');
      expect(bruna.vinculoVendedorOmie.status).toBe('OMIE_INDISPONIVEL');
      expect(bruna.vendedorOmieNome).toBeNull();
    } finally {
      servidor.close();
    }
  });

  for (const papel of ['administrador', 'usuario', 'convidado'] as const) {
    it(`papel "${papel}" não recebe associação automática, mesmo com login igual a um vendedor Omie`, async () => {
      const listar = vi.fn(async () => VENDEDORES_OMIE);
      const { servidor, criarPelaApi } = await montarServidor(listar);
      try {
        const criado = await criarPelaApi('Carlos Souza', 'Carlos', papel);
        expect(criado.vinculoVendedorOmie).toEqual({ status: 'NAO_APLICAVEL' });
        expect(criado.vendedorOmieNome).toBeNull();
        expect(listar).not.toHaveBeenCalled();
      } finally {
        servidor.close();
      }
    });
  }
});

describe('vínculo manual e persistência separada do login', () => {
  it('Alice (login "Alice") pode ser associada manualmente a "Alice Silva"', async () => {
    const { servidor, cookieAdmin, repositorio, chamar, criarPelaApi } = await montarServidor();
    try {
      const alice = await criarPelaApi('Alice', 'Alice', 'vendedor');
      expect(alice.vendedorOmieNome).toBeNull();
      const resposta = await chamar(cookieAdmin, 'PUT', `/api/auth/usuarios/${alice.id}`, { vendedorOmieNome: 'Alice Silva' });
      expect(resposta.status).toBe(200);
      expect((await repositorio.buscarPorId(alice.id))?.vendedorOmieNome).toBe('Alice Silva');
    } finally {
      servidor.close();
    }
  });

  it('alterar o login depois não altera vendedorOmieNome', async () => {
    const { servidor, repositorio, pool, criarPelaApi } = await montarServidor();
    try {
      const bruna = await criarPelaApi('Bruna Pinto', 'Bruna', 'vendedor');
      await pool.query(`UPDATE ${tabelaTemp} SET usuario = 'bruna.p' WHERE id = $1`, [bruna.id]);
      const depois = await repositorio.buscarPorId(bruna.id);
      expect(depois?.usuario).toBe('bruna.p');
      expect(depois?.vendedorOmieNome).toBe('BRUNA PINTO');
    } finally {
      servidor.close();
    }
  });
});

describe('migração segura dos vendedores existentes pelo login', () => {
  it('só vendedor sem vínculo, só nome exato; não sobrescreve, ignora não encontrado/ambíguo/outros papéis', async () => {
    const { servidor, cookieAdmin, repositorio, chamar } = await montarServidor();
    try {
      const semPerms = { ...PERMISSOES_VAZIAS };
      const criar = (usuario: string, papel: Papel, vendedorOmieNome: string | null = null) =>
        repositorio.criarUsuario({ usuario, nome: usuario, senha: 'senha123', papel, permissoes: semPerms, vendedorOmieNome });
      const bruna = await criar('bruna pinto', 'vendedor');
      const carlosJaVinculado = await criar('Carlos Souza', 'vendedor', 'Alice Silva');
      const alice = await criar('Alice', 'vendedor');
      const duda = await criar('Duda Lima', 'vendedor');
      const interno = await criar('Alice Silva', 'usuario');

      const resposta = await chamar(cookieAdmin, 'POST', '/api/auth/usuarios/vincular-vendedores-por-login');
      expect(resposta.status).toBe(200);
      const relatorio = (await resposta.json()) as { vinculados: unknown[]; naoEncontrados: string[]; ambiguos: string[] };
      expect(relatorio.vinculados).toEqual([{ usuario: 'bruna pinto', vendedorOmieNome: 'BRUNA PINTO' }]);
      expect(relatorio.naoEncontrados).toEqual(['Alice']);
      expect(relatorio.ambiguos).toEqual(['Duda Lima']);

      expect((await repositorio.buscarPorId(bruna.id))?.vendedorOmieNome).toBe('BRUNA PINTO');
      expect((await repositorio.buscarPorId(carlosJaVinculado.id))?.vendedorOmieNome).toBe('Alice Silva');
      expect((await repositorio.buscarPorId(alice.id))?.vendedorOmieNome).toBeNull();
      expect((await repositorio.buscarPorId(duda.id))?.vendedorOmieNome).toBeNull();
      expect((await repositorio.buscarPorId(interno.id))?.vendedorOmieNome).toBeNull();

      // Idempotente: rodar de novo não mexe em ninguém.
      const segunda = (await (await chamar(cookieAdmin, 'POST', '/api/auth/usuarios/vincular-vendedores-por-login')).json()) as { vinculados: unknown[] };
      expect(segunda.vinculados).toEqual([]);
    } finally {
      servidor.close();
    }
  });

  it('Omie indisponível → 400 e nenhum vínculo alterado', async () => {
    const { servidor, cookieAdmin, repositorio, chamar } = await montarServidor(async () => {
      throw new Error('Omie fora do ar');
    });
    try {
      const bruna = await repositorio.criarUsuario({
        usuario: 'Bruna Pinto',
        nome: 'Bruna',
        senha: 'senha123',
        papel: 'vendedor',
        permissoes: { ...PERMISSOES_VAZIAS },
      });
      expect((await chamar(cookieAdmin, 'POST', '/api/auth/usuarios/vincular-vendedores-por-login')).status).toBe(400);
      expect((await repositorio.buscarPorId(bruna.id))?.vendedorOmieNome).toBeNull();
    } finally {
      servidor.close();
    }
  });
});

describe('backend protegido — só administrador altera o vínculo', () => {
  for (const papel of ['vendedor', 'usuario', 'convidado'] as const) {
    it(`papel "${papel}" recebe 403 ao tentar alterar vínculo (próprio ou alheio) ou rodar a migração`, async () => {
      const { servidor, admin, repositorio, cookiePara, chamar } = await montarServidor();
      try {
        const todas = Object.fromEntries(Object.keys(PERMISSOES_VAZIAS).map((chave) => [chave, true])) as unknown as typeof PERMISSOES_VAZIAS;
        const conta = await repositorio.criarUsuario({
          usuario: `conta-${papel}`,
          nome: 'Conta',
          senha: 'senha123',
          papel,
          permissoes: todas,
          vendedorOmieNome: 'Alice Silva',
        });
        const cookie = await cookiePara(conta.id);
        const tentativas: Array<[string, string, unknown?]> = [
          ['PUT', `/api/auth/usuarios/${conta.id}`, { vendedorOmieNome: 'BRUNA PINTO' }],
          ['PUT', `/api/auth/usuarios/${conta.id}?vendedorOmieNome=BRUNA%20PINTO`, {}],
          ['PUT', `/api/auth/usuarios/${admin.id}`, { vendedorOmieNome: 'BRUNA PINTO' }],
          ['POST', '/api/auth/usuarios/vincular-vendedores-por-login'],
        ];
        for (const [metodo, caminho, corpo] of tentativas) {
          expect((await chamar(cookie, metodo, caminho, corpo)).status, `${metodo} ${caminho}`).toBe(403);
        }
        expect((await repositorio.buscarPorId(conta.id))?.vendedorOmieNome).toBe('Alice Silva');
        expect((await repositorio.buscarPorId(admin.id))?.vendedorOmieNome).toBeNull();
      } finally {
        servidor.close();
      }
    });
  }
});

describe('frontend — tela de Usuários não pede código de vendedor', () => {
  const raiz = process.cwd();
  const html = readFileSync(path.join(raiz, 'public', 'index.html'), 'utf-8');
  const inicioUsuarios = html.indexOf('id="form-novo-usuario"');
  const secaoUsuarios = html.slice(inicioUsuarios, html.indexOf('id="modo-fretes"'));
  const fonte = readFileSync(path.join(raiz, 'public-src', 'usuarios.ts'), 'utf-8');

  it('formulário de criação não tem campo de vendedor Omie nem menção a código', () => {
    expect(inicioUsuarios).toBeGreaterThan(-1);
    expect(secaoUsuarios).not.toMatch(/c[óo]digo/i);
    expect(secaoUsuarios).not.toContain('vendedorOmieId');
    expect(secaoUsuarios).not.toContain('novo-usuario-vendedor-omie');
  });

  it('usuarios.ts só trabalha com nome: sem vendedorOmieId no envio, sem prompt além da senha', () => {
    expect(fonte).not.toMatch(/JSON\.stringify\(\{[^}]*vendedorOmieId/);
    expect(fonte.match(/window\.prompt\(/g) ?? []).toHaveLength(1);
    expect(fonte).toContain('Alterar vendedor Omie');
    expect(fonte).toContain("'Não vinculado'");
  });
});
