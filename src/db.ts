import { Pool } from 'pg';
import { config } from './config.js';

let pool: Pool | null = null;

/**
 * Pool de conexões Postgres (Supabase) compartilhado por `auth/` (usuários,
 * sessões) e `omie/` (cache, limitador de chamadas) — criado sob demanda
 * (não no import do módulo) pra nunca derrubar o servidor inteiro se
 * `DATABASE_URL` estiver faltando; o erro só aparece quando algo de fato
 * tenta usar o banco. `ssl: { rejectUnauthorized: false }` é o exigido pelo
 * Supabase (certificado não está na cadeia padrão de CAs do Node) —
 * aceitável aqui porque a própria connection string já contém a senha e vem
 * de uma variável de ambiente confiável, nunca de entrada do usuário.
 */
export function obterPool(): Pool {
  if (pool === null) {
    if (config.databaseUrl.trim() === '') {
      throw new Error(
        'DATABASE_URL não está definida no .env — configure a connection string do Postgres (Supabase) para o sistema funcionar.',
      );
    }
    pool = new Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

/**
 * Roda um `CREATE TABLE IF NOT EXISTS` (ou `CREATE INDEX IF NOT EXISTS`)
 * tolerando a corrida real do Postgres quando duas conexões tentam criar a
 * MESMA tabela/índice novo ao mesmo tempo: `IF NOT EXISTS` não é atômico —
 * as duas passam pela checagem antes de qualquer uma existir de fato, e uma
 * delas recebe um erro de índice duplicado (`pg_type_typname_nsp_index` para
 * tabela nova, ou `duplicate_table`) mesmo sem nenhum erro de lógica —
 * confirmado ao vivo em 2026-09-11 com duas invocações concorrentes criando
 * a mesma tabela do limitador (cenário real em cold starts simultâneos no
 * Vercel). Nos dois casos a tabela/índice já existe de verdade nesse ponto —
 * seguro ignorar e seguir em frente. `42701` (duplicate_column) é a mesma
 * corrida, só que para `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — adicionada
 * em 2026-09-16 para as colunas novas do módulo de Fretes (Fase 2), mas é
 * genérica: qualquer `ADD COLUMN IF NOT EXISTS` concorrente se beneficia.
 */
export async function executarDdlIdempotente(sql: string): Promise<void> {
  try {
    await obterPool().query(sql);
  } catch (erro) {
    const codigo = (erro as { code?: string }).code;
    if (codigo !== '42P07' && codigo !== '23505' && codigo !== '42701') throw erro;
  }
}
