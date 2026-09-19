import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ErroValidacao } from '../validacao.js';
import { executarDdlIdempotente, obterPool } from '../db.js';
import { hashSenha } from './senhas.js';
import { PERMISSOES_VAZIAS, paraPublico, type Papel, type Permissoes, type Usuario, type UsuarioPublico } from './tipos.js';

/**
 * Nome da tabela — só sobrescrito nos testes (`USUARIOS_TABELA`), pra rodar
 * contra uma tabela isolada e descartável no MESMO banco Supabase (não temos
 * um segundo projeto só pra teste). Nunca vem de entrada do usuário, mas
 * validado mesmo assim porque entra por interpolação direta no SQL — `pg`
 * não parametriza nome de tabela.
 */
function nomeTabela(): string {
  const nome = process.env.USUARIOS_TABELA ?? 'usuarios';
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Nome de tabela inválido: "${nome}"`);
  return nome;
}

/**
 * Administradores "master" (regra de 2026-09-11) — hardcoded de propósito
 * (nunca exposto numa tela de "promover a master": só os dois nomes pedidos
 * explicitamente). Comparação por `usuario` normalizado, igual ao login.
 * Adicionar um novo master exige mexer aqui — decisão deliberada, é um
 * recurso sensível (só eles conseguem destravar quem perdeu a senha).
 */
const NOMES_ADMINISTRADORES_MASTER = ['ricardo', 'wendell'];

function normalizarUsuario(usuario: string): string {
  return usuario.trim().toLowerCase();
}

function ehAdministradorMasterPorNome(nomeUsuario: string): boolean {
  return NOMES_ADMINISTRADORES_MASTER.includes(normalizarUsuario(nomeUsuario));
}

interface LinhaUsuario {
  id: string;
  usuario: string;
  nome: string;
  papel: Papel;
  senha_hash: string;
  permissoes: Permissoes;
  senha_provisoria: boolean;
  mestre: boolean;
  vendedor_omie_id: string | null;
}

function linhaParaUsuario(linha: LinhaUsuario): Usuario {
  return {
    id: linha.id,
    usuario: linha.usuario,
    nome: linha.nome,
    papel: linha.papel,
    senhaHash: linha.senha_hash,
    permissoes: linha.permissoes,
    senhaProvisoria: linha.senha_provisoria,
    mestre: linha.mestre,
    vendedorOmieId: linha.vendedor_omie_id === null ? null : Number(linha.vendedor_omie_id),
  };
}

/**
 * Cria a tabela (se ainda não existir) e, na primeira vez que ela está
 * vazia, migra os dados de `data/usuarios.json` (formato usado antes da
 * migração para Postgres/Supabase de 2026-09-11) — nunca perde os usuários
 * já cadastrados. Se não houver arquivo antigo nem tabela populada, cria o
 * primeiro administrador a partir de `ADMIN_USUARIO`/`ADMIN_SENHA` do `.env`,
 * igual ao comportamento anterior.
 */
let tabelaGarantida: Promise<void> | null = null;
async function garantirTabela(): Promise<void> {
  tabelaGarantida ??= (async () => {
    const pool = obterPool();
    const tabela = nomeTabela();
    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${tabela} (
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
    await executarDdlIdempotente(`CREATE UNIQUE INDEX IF NOT EXISTS ${tabela}_usuario_lower_idx ON ${tabela} (lower(usuario))`);
    // Fase 4A.6 — vínculo opcional login↔vendedor Omie (ver comentário completo em `auth/tipos.ts`).
    // Aditivo/nullable: contas já existentes simplesmente começam sem vínculo (`null`).
    await executarDdlIdempotente(`ALTER TABLE ${tabela} ADD COLUMN IF NOT EXISTS vendedor_omie_id BIGINT`);

    const { rows: contagem } = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM ${tabela}`);
    if (Number(contagem[0]?.total ?? '0') > 0) return;

    // Sobrescrito só nos testes (USUARIOS_ARQUIVO) — sem isso, os testes que usam uma tabela vazia
    // acabavam migrando os usuários REAIS de data/usuarios.json em vez de testar o seed isolado.
    const caminhoArquivoAntigo = process.env.USUARIOS_ARQUIVO ?? path.join(process.cwd(), 'data', 'usuarios.json');
    if (existsSync(caminhoArquivoAntigo)) {
      const dados = JSON.parse(readFileSync(caminhoArquivoAntigo, 'utf-8')) as { usuarios: Usuario[] };
      for (const usuario of dados.usuarios) {
        await inserirUsuario(usuario);
      }
      console.log(`Migrados ${dados.usuarios.length} usuário(s) de data/usuarios.json para o Postgres (Supabase).`);
      return;
    }

    if (config.adminUsuario.trim() === '' || config.adminSenha.trim() === '') {
      throw new Error(
        'Nenhum usuário cadastrado ainda e ADMIN_USUARIO/ADMIN_SENHA não estão definidos no .env — ' +
          'defina essas duas variáveis para criar o primeiro administrador e suba o servidor novamente.',
      );
    }
    const admin: Usuario = {
      id: randomUUID(),
      usuario: config.adminUsuario.trim(),
      nome: config.adminUsuario.trim(),
      papel: 'administrador',
      senhaHash: hashSenha(config.adminSenha),
      permissoes: { ...PERMISSOES_VAZIAS },
      senhaProvisoria: true,
      mestre: ehAdministradorMasterPorNome(config.adminUsuario),
      vendedorOmieId: null,
    };
    await inserirUsuario(admin);
    console.log(`Primeiro administrador criado: "${admin.usuario}".`);
  })();
  return tabelaGarantida;
}

async function inserirUsuario(usuario: Usuario): Promise<void> {
  const pool = obterPool();
  await pool.query(
    `INSERT INTO ${nomeTabela()} (id, usuario, nome, papel, senha_hash, permissoes, senha_provisoria, mestre, vendedor_omie_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      usuario.id,
      usuario.usuario,
      usuario.nome,
      usuario.papel,
      usuario.senhaHash,
      JSON.stringify(usuario.permissoes),
      usuario.senhaProvisoria,
      usuario.mestre,
      usuario.vendedorOmieId ?? null,
    ],
  );
}

export async function listarUsuarios(): Promise<UsuarioPublico[]> {
  await garantirTabela();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaUsuario>(`SELECT * FROM ${nomeTabela()} ORDER BY nome`);
  return rows.map((linha) => paraPublico(linhaParaUsuario(linha)));
}

export async function buscarPorNomeDeUsuario(usuario: string): Promise<Usuario | null> {
  await garantirTabela();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaUsuario>(`SELECT * FROM ${nomeTabela()} WHERE lower(usuario) = lower($1)`, [usuario.trim()]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaUsuario(linha);
}

export async function buscarPorId(id: string): Promise<Usuario | null> {
  await garantirTabela();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaUsuario>(`SELECT * FROM ${nomeTabela()} WHERE id = $1`, [id]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaUsuario(linha);
}

export interface DadosNovoUsuario {
  usuario: string;
  nome: string;
  senha: string;
  papel: Papel;
  permissoes: Permissoes;
  /** Fase 4A.6 — ver comentário completo em `auth/tipos.ts`. */
  vendedorOmieId?: number | null;
}

export async function criarUsuario(dadosNovos: DadosNovoUsuario): Promise<UsuarioPublico> {
  if (dadosNovos.usuario.trim() === '') throw new ErroValidacao('O campo "usuario" é obrigatório.');
  if (dadosNovos.nome.trim() === '') throw new ErroValidacao('O campo "nome" é obrigatório.');
  if (dadosNovos.senha.length < 6) throw new ErroValidacao('A senha precisa ter pelo menos 6 caracteres.');

  await garantirTabela();
  if ((await buscarPorNomeDeUsuario(dadosNovos.usuario)) !== null) {
    throw new ErroValidacao(`Já existe um usuário com o login "${dadosNovos.usuario}".`);
  }

  const novo: Usuario = {
    id: randomUUID(),
    usuario: dadosNovos.usuario.trim(),
    nome: dadosNovos.nome.trim(),
    papel: dadosNovos.papel,
    senhaHash: hashSenha(dadosNovos.senha),
    permissoes: dadosNovos.papel === 'administrador' ? { ...PERMISSOES_VAZIAS } : dadosNovos.permissoes,
    // O administrador escolheu essa senha, não a própria pessoa — força a troca no primeiro acesso.
    senhaProvisoria: true,
    mestre: dadosNovos.papel === 'administrador' && ehAdministradorMasterPorNome(dadosNovos.usuario),
    vendedorOmieId: dadosNovos.vendedorOmieId ?? null,
  };
  await inserirUsuario(novo);
  return paraPublico(novo);
}

export interface DadosAtualizacaoUsuario {
  nome?: string;
  papel?: Papel;
  permissoes?: Permissoes;
  /** Fase 4A.6 — ver comentário completo em `auth/tipos.ts`. `null` remove o vínculo. */
  vendedorOmieId?: number | null;
}

function garantirNaoUltimoAdministrador(administradoresRestantes: number, acao: string): void {
  if (administradoresRestantes === 0) {
    throw new ErroValidacao(`Não é possível ${acao} — precisa sobrar pelo menos um administrador no sistema.`);
  }
}

export async function atualizarUsuario(id: string, atualizacao: DadosAtualizacaoUsuario): Promise<UsuarioPublico> {
  await garantirTabela();
  const usuario = await buscarPorId(id);
  if (usuario === null) throw new ErroValidacao('Usuário não encontrado.');

  if (atualizacao.nome !== undefined) {
    if (atualizacao.nome.trim() === '') throw new ErroValidacao('O campo "nome" não pode ficar vazio.');
    usuario.nome = atualizacao.nome.trim();
  }
  if (atualizacao.papel !== undefined) {
    if (atualizacao.papel === 'convidado' && usuario.papel === 'administrador') {
      const outrosAdministradores = await contarOutrosAdministradores(id);
      garantirNaoUltimoAdministrador(outrosAdministradores, 'rebaixar o último administrador para convidado');
    }
    usuario.papel = atualizacao.papel;
    if (atualizacao.papel === 'administrador') {
      usuario.permissoes = { ...PERMISSOES_VAZIAS };
      usuario.mestre = ehAdministradorMasterPorNome(usuario.usuario);
    } else {
      usuario.mestre = false;
    }
  }
  if (atualizacao.permissoes !== undefined && usuario.papel === 'convidado') {
    usuario.permissoes = atualizacao.permissoes;
  }
  if (atualizacao.vendedorOmieId !== undefined) {
    usuario.vendedorOmieId = atualizacao.vendedorOmieId;
  }

  const pool = obterPool();
  await pool.query(
    `UPDATE ${nomeTabela()} SET nome = $1, papel = $2, permissoes = $3, mestre = $4, vendedor_omie_id = $5 WHERE id = $6`,
    [usuario.nome, usuario.papel, JSON.stringify(usuario.permissoes), usuario.mestre, usuario.vendedorOmieId, usuario.id],
  );
  return paraPublico(usuario);
}

/** Usado pelo administrador master pra destravar quem perdeu a senha (`exigirAdministradorMestre`, ver `middleware.ts`) — a nova senha foi escolhida por OUTRA pessoa, então força a troca de novo no próximo login. */
export async function redefinirSenha(id: string, novaSenha: string): Promise<void> {
  if (novaSenha.length < 6) throw new ErroValidacao('A senha precisa ter pelo menos 6 caracteres.');
  await garantirTabela();
  const pool = obterPool();
  const { rowCount } = await pool.query(`UPDATE ${nomeTabela()} SET senha_hash = $1, senha_provisoria = true WHERE id = $2`, [
    hashSenha(novaSenha),
    id,
  ]);
  if (rowCount === 0) throw new ErroValidacao('Usuário não encontrado.');
}

/** Autoatendimento: o próprio usuário logado escolhe a senha (regra de 2026-09-11: obrigatório após o 1º acesso, quando `senhaProvisoria` é true). Só quem escolheu a própria senha some dessa lista. */
export async function definirSenhaPropria(id: string, novaSenha: string): Promise<void> {
  if (novaSenha.length < 6) throw new ErroValidacao('A senha precisa ter pelo menos 6 caracteres.');
  await garantirTabela();
  const pool = obterPool();
  const { rowCount } = await pool.query(`UPDATE ${nomeTabela()} SET senha_hash = $1, senha_provisoria = false WHERE id = $2`, [
    hashSenha(novaSenha),
    id,
  ]);
  if (rowCount === 0) throw new ErroValidacao('Usuário não encontrado.');
}

async function contarOutrosAdministradores(idExcluido: string): Promise<number> {
  const pool = obterPool();
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM ${nomeTabela()} WHERE papel = 'administrador' AND id != $1`,
    [idExcluido],
  );
  return Number(rows[0]?.total ?? '0');
}

export async function excluirUsuario(id: string, idSolicitante: string): Promise<void> {
  if (id === idSolicitante) {
    throw new ErroValidacao('Você não pode excluir a própria conta enquanto está logado com ela.');
  }
  await garantirTabela();
  const usuario = await buscarPorId(id);
  if (usuario === null) throw new ErroValidacao('Usuário não encontrado.');
  if (usuario.papel === 'administrador') {
    const outrosAdministradores = await contarOutrosAdministradores(id);
    garantirNaoUltimoAdministrador(outrosAdministradores, 'excluir o último administrador');
  }
  const pool = obterPool();
  await pool.query(`DELETE FROM ${nomeTabela()} WHERE id = $1`, [id]);
}
