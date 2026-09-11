import { randomBytes } from 'node:crypto';
import { executarDdlIdempotente, obterPool } from '../db.js';

const DURACAO_SESSAO_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias, renovado a cada requisição autenticada (sliding)

/**
 * Nome da tabela — só sobrescrito nos testes (`SESSOES_TABELA`), igual ao
 * padrão de `USUARIOS_TABELA` em `usuarios.ts`. Nunca vem de entrada do
 * usuário, mas validado mesmo assim porque entra por interpolação direta no
 * SQL — `pg` não parametriza nome de tabela.
 */
function nomeTabela(): string {
  const nome = process.env.SESSOES_TABELA ?? 'sessoes';
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Nome de tabela inválido: "${nome}"`);
  return nome;
}

/**
 * Sessões em Postgres (Supabase), não mais em memória (regra de 2026-09-11:
 * hospedagem em Vercel — funções serverless não compartilham memória entre
 * invocações, então um `Map` em memória perdia a sessão a qualquer momento).
 * Criada sob demanda, idempotente, igual ao padrão de `usuarios.ts`.
 */
let tabelaGarantida: Promise<void> | null = null;
async function garantirTabela(): Promise<void> {
  tabelaGarantida ??= executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${nomeTabela()} (
      token TEXT PRIMARY KEY,
      usuario_id UUID NOT NULL,
      expira_em TIMESTAMPTZ NOT NULL
    )
  `);
  return tabelaGarantida;
}

export async function criarSessao(usuarioId: string): Promise<string> {
  await garantirTabela();
  const token = randomBytes(32).toString('hex');
  await obterPool().query(`INSERT INTO ${nomeTabela()} (token, usuario_id, expira_em) VALUES ($1, $2, $3)`, [
    token,
    usuarioId,
    new Date(Date.now() + DURACAO_SESSAO_MS),
  ]);
  return token;
}

/** Retorna o id do usuário da sessão (renovando sua validade) ou `null` se o token for inválido/expirado. */
export async function validarSessao(token: string): Promise<string | null> {
  await garantirTabela();
  const pool = obterPool();
  const { rows } = await pool.query<{ usuario_id: string; expira_em: Date }>(
    `SELECT usuario_id, expira_em FROM ${nomeTabela()} WHERE token = $1`,
    [token],
  );
  const sessao = rows[0];
  if (sessao === undefined) return null;
  if (sessao.expira_em.getTime() < Date.now()) {
    await pool.query(`DELETE FROM ${nomeTabela()} WHERE token = $1`, [token]);
    return null;
  }
  // Sliding: mantém a sessão viva enquanto o usuário estiver ativo.
  await pool.query(`UPDATE ${nomeTabela()} SET expira_em = $1 WHERE token = $2`, [new Date(Date.now() + DURACAO_SESSAO_MS), token]);
  return sessao.usuario_id;
}

export async function destruirSessao(token: string): Promise<void> {
  await garantirTabela();
  await obterPool().query(`DELETE FROM ${nomeTabela()} WHERE token = $1`, [token]);
}
