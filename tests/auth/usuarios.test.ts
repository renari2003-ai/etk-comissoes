import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS } from '../../src/auth/tipos.js';

/**
 * `src/auth/usuarios.ts` roda contra Postgres (Supabase) — nome da tabela via
 * `USUARIOS_TABELA` (variável só usada em teste), sempre uma tabela nova e
 * descartável (não temos um segundo projeto Supabase só pra teste). O admin
 * seed via `ADMIN_USUARIO`/`ADMIN_SENHA` e o caminho de migração do JSON
 * antigo via `USUARIOS_ARQUIVO` (apontado pra um caminho inexistente por
 * padrão, senão os testes migrariam os usuários REAIS de data/usuarios.json).
 * Tudo lido na importação do módulo, por isso cada teste reimporta com
 * `vi.resetModules()` + `import()` dinâmico depois de ajustar `process.env`.
 */
async function importarModuloComArquivoLimpo(): Promise<typeof import('../../src/auth/usuarios.js')> {
  vi.resetModules();
  return import('../../src/auth/usuarios.js');
}

let tabelaTemp: string;

beforeEach(() => {
  tabelaTemp = `usuarios_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.USUARIOS_TABELA = tabelaTemp;
  process.env.USUARIOS_ARQUIVO = path.join(tmpdir(), `usuarios-teste-inexistente-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.ADMIN_USUARIO = 'admin';
  process.env.ADMIN_SENHA = 'senhaAdmin123';
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  await pool.query(`DROP TABLE IF EXISTS ${tabelaTemp}`).catch(() => undefined);
  if (existsSync(process.env.USUARIOS_ARQUIVO!)) rmSync(process.env.USUARIOS_ARQUIVO!);
  delete process.env.USUARIOS_TABELA;
  delete process.env.USUARIOS_ARQUIVO;
  delete process.env.ADMIN_USUARIO;
  delete process.env.ADMIN_SENHA;
});

describe('seed do primeiro administrador', () => {
  it('cria o administrador a partir de ADMIN_USUARIO/ADMIN_SENHA quando o arquivo ainda não existe', async () => {
    const { listarUsuarios } = await importarModuloComArquivoLimpo();
    const usuarios = await listarUsuarios();
    expect(usuarios).toHaveLength(1);
    expect(usuarios[0]?.usuario).toBe('admin');
    expect(usuarios[0]?.papel).toBe('administrador');
    expect((usuarios[0] as unknown as { senhaHash?: string }).senhaHash).toBeUndefined();
  });

  it('falha alto e claro quando ADMIN_USUARIO/ADMIN_SENHA não estão definidos e não há usuários ainda', async () => {
    // String vazia (não `delete`): `config.ts` só carrega o ADMIN_USUARIO/ADMIN_SENHA reais do
    // .env do projeto quando a variável está totalmente AUSENTE do process.env — com `delete`, o
    // teste vazava as credenciais reais do .env (ver `process.loadEnvFile`, que nunca sobrescreve
    // uma variável já definida, mesmo vazia).
    process.env.ADMIN_USUARIO = '';
    process.env.ADMIN_SENHA = '';
    const { listarUsuarios } = await importarModuloComArquivoLimpo();
    await expect(listarUsuarios()).rejects.toThrow(/ADMIN_USUARIO/);
  });
});

describe('CRUD de usuários', () => {
  it('cria um convidado com as permissões informadas', async () => {
    const { criarUsuario } = await importarModuloComArquivoLimpo();
    const criado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS, consultaPedidos: true },
    });
    expect(criado.papel).toBe('convidado');
    expect(criado.permissoes.consultaPedidos).toBe(true);
    expect(criado.permissoes.relatorioComissionamento).toBe(false);
  });

  it('rejeita criar usuário com login já existente (case-insensitive)', async () => {
    const { criarUsuario } = await importarModuloComArquivoLimpo();
    await criarUsuario({ usuario: 'joao', nome: 'João', senha: 'senha123', papel: 'convidado', permissoes: { ...PERMISSOES_VAZIAS } });
    await expect(
      criarUsuario({ usuario: 'JOAO', nome: 'João 2', senha: 'outraSenha', papel: 'convidado', permissoes: { ...PERMISSOES_VAZIAS } }),
    ).rejects.toThrow(/já existe/i);
  });

  it('atualiza permissões de um convidado', async () => {
    const { criarUsuario, atualizarUsuario } = await importarModuloComArquivoLimpo();
    const criado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    const atualizado = await atualizarUsuario(criado.id, {
      permissoes: { ...PERMISSOES_VAZIAS, relatorioComissionamento: true },
    });
    expect(atualizado.permissoes.relatorioComissionamento).toBe(true);
  });

  it('nunca deixa excluir o próprio usuário logado', async () => {
    const { listarUsuarios, excluirUsuario } = await importarModuloComArquivoLimpo();
    const [admin] = await listarUsuarios();
    await expect(excluirUsuario(admin!.id, admin!.id)).rejects.toThrow(/própria conta/i);
  });

  it('nunca deixa excluir o último administrador', async () => {
    const { listarUsuarios, criarUsuario, excluirUsuario } = await importarModuloComArquivoLimpo();
    const outro = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    const [admin] = await listarUsuarios();
    await expect(excluirUsuario(admin!.id, outro.id)).rejects.toThrow(/último administrador/i);
  });

  it('permite excluir um convidado normalmente', async () => {
    const { criarUsuario, excluirUsuario, listarUsuarios } = await importarModuloComArquivoLimpo();
    const criado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    const [admin] = await listarUsuarios();
    await excluirUsuario(criado.id, admin!.id);
    expect(await listarUsuarios()).toHaveLength(1);
  });

  it('redefinirSenha troca o hash e nunca aceita senha curta', async () => {
    const { criarUsuario, redefinirSenha, buscarPorNomeDeUsuario } = await importarModuloComArquivoLimpo();
    const criado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    await expect(redefinirSenha(criado.id, '123')).rejects.toThrow(/pelo menos 6/);

    const antes = await buscarPorNomeDeUsuario('joao');
    await redefinirSenha(criado.id, 'novaSenhaSegura');
    const depois = await buscarPorNomeDeUsuario('joao');
    expect(depois?.senhaHash).not.toBe(antes?.senhaHash);
  });
});

describe('senhaProvisoria (regra de 2026-09-11: trocar senha após o 1º acesso)', () => {
  it('o admin seed e um usuário recém-criado sempre começam com senhaProvisoria true', async () => {
    const { criarUsuario, listarUsuarios } = await importarModuloComArquivoLimpo();
    const [admin] = await listarUsuarios();
    expect(admin?.senhaProvisoria).toBe(true);

    const criado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    expect(criado.senhaProvisoria).toBe(true);
  });

  it('definirSenhaPropria vira senhaProvisoria false; redefinirSenha (admin) sempre volta pra true', async () => {
    const { criarUsuario, definirSenhaPropria, redefinirSenha, buscarPorId } = await importarModuloComArquivoLimpo();
    const criado = await criarUsuario({
      usuario: 'joao',
      nome: 'João',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });

    await definirSenhaPropria(criado.id, 'minhaPropriaSenha');
    expect((await buscarPorId(criado.id))?.senhaProvisoria).toBe(false);

    await redefinirSenha(criado.id, 'senhaEscolhidaPeloAdmin');
    expect((await buscarPorId(criado.id))?.senhaProvisoria).toBe(true);
  });
});

describe('administrador master (regra de 2026-09-11: só Ricardo e Wendell)', () => {
  it('marca mestre=true só para administradores chamados "Ricardo" ou "Wendell" (case-insensitive)', async () => {
    process.env.ADMIN_USUARIO = 'Ricardo';
    const { listarUsuarios, criarUsuario } = await importarModuloComArquivoLimpo();
    const [ricardoSeed] = await listarUsuarios();
    expect(ricardoSeed?.mestre).toBe(true);

    const wendell = await criarUsuario({
      usuario: 'WENDELL',
      nome: 'Wendell',
      senha: 'senha123',
      papel: 'administrador',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    expect(wendell.mestre).toBe(true);

    const outroAdmin = await criarUsuario({
      usuario: 'giuli',
      nome: 'Giuli',
      senha: 'senha123',
      papel: 'administrador',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    expect(outroAdmin.mestre).toBe(false);
  });

  it('nunca marca mestre=true pra um convidado, mesmo se o nome bater', async () => {
    const { criarUsuario } = await importarModuloComArquivoLimpo();
    const convidado = await criarUsuario({
      usuario: 'ricardo',
      nome: 'Ricardo',
      senha: 'senha123',
      papel: 'convidado',
      permissoes: { ...PERMISSOES_VAZIAS },
    });
    expect(convidado.mestre).toBe(false);
  });
});

describe('migração do data/usuarios.json antigo (regra de 2026-09-11: passagem pra Postgres/Supabase)', () => {
  it('importa os usuários do arquivo JSON antigo pra dentro da tabela vazia, em vez de rodar o seed do .env', async () => {
    const usuarioAntigo = {
      id: '11111111-1111-1111-1111-111111111111',
      usuario: 'legado',
      nome: 'Usuário Legado',
      papel: 'administrador' as const,
      senhaHash: 'scrypt$abcd$1234',
      permissoes: { ...PERMISSOES_VAZIAS },
      senhaProvisoria: false,
      mestre: false,
    };
    writeFileSync(process.env.USUARIOS_ARQUIVO!, JSON.stringify({ usuarios: [usuarioAntigo] }));

    const { listarUsuarios } = await importarModuloComArquivoLimpo();
    const usuarios = await listarUsuarios();
    expect(usuarios).toHaveLength(1);
    expect(usuarios[0]?.usuario).toBe('legado');
    expect(usuarios[0]?.senhaProvisoria).toBe(false); // preservado do arquivo, não reiniciado pelo seed
  });
});
