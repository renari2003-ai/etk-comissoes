import { executarDdlIdempotente, obterPool } from '../db.js';

/** Nome da tabela — só sobrescrito nos testes (`OMIE_CACHE_TABELA`). Nunca vem de entrada do usuário, mas validado porque entra por interpolação direta no SQL. */
function nomeTabela(): string {
  const nome = process.env.OMIE_CACHE_TABELA ?? 'omie_cache';
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Nome de tabela inválido: "${nome}"`);
  return nome;
}

let tabelaGarantida: Promise<void> | null = null;
/** Compartilhada por TODAS as instâncias de `CachePostgres` (todas as categorias vivem na mesma tabela) — só cria a tabela uma vez por processo. */
function garantirTabela(): Promise<void> {
  tabelaGarantida ??= executarDdlIdempotente(
    `CREATE TABLE IF NOT EXISTS ${nomeTabela()} (
      categoria TEXT NOT NULL,
      chave TEXT NOT NULL,
      valor JSONB NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (categoria, chave)
    )`,
  );
  return tabelaGarantida;
}

const DEZ_MINUTOS_MS = 10 * 60 * 1000;

/**
 * Cache em Postgres (Supabase), substitui o antigo cache em memória (regra
 * de 2026-09-11: hospedagem em Vercel — cada invocação serverless é um
 * processo isolado, então um `Map` em memória nunca era reaproveitado entre
 * requisições). Guarda um TTL (10 min por padrão) em vez de nunca expirar
 * como o cache em memória fazia — decisão deliberada: sem um TTL, um dado
 * como status de título financeiro (`contasReceber`) ficaria desatualizado
 * indefinidamente (antes, pelo menos os restarts do processo renovavam o
 * cache periodicamente; em produção serverless isso não é garantido).
 */
export class CachePostgres {
  constructor(
    private readonly categoria: string,
    private readonly ttlMs: number = DEZ_MINUTOS_MS,
  ) {}

  async obterOuBuscar<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
    await garantirTabela();
    const pool = obterPool();
    const { rows } = await pool.query<{ valor: T; criado_em: Date }>(
      `SELECT valor, criado_em FROM ${nomeTabela()} WHERE categoria = $1 AND chave = $2`,
      [this.categoria, chave],
    );
    const existente = rows[0];
    if (existente !== undefined && Date.now() - existente.criado_em.getTime() < this.ttlMs) {
      return existente.valor;
    }

    const valor = await buscar();
    await pool.query(
      `INSERT INTO ${nomeTabela()} (categoria, chave, valor, criado_em) VALUES ($1, $2, $3, now())
       ON CONFLICT (categoria, chave) DO UPDATE SET valor = EXCLUDED.valor, criado_em = EXCLUDED.criado_em`,
      [this.categoria, chave, JSON.stringify(valor)],
    );
    return valor;
  }

  async limpar(): Promise<void> {
    await garantirTabela();
    await obterPool().query(`DELETE FROM ${nomeTabela()} WHERE categoria = $1`, [this.categoria]);
  }
}
