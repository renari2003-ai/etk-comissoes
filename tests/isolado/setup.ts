/**
 * Trava de segurança de cada worker da suíte isolada: se o banco NÃO for o PGlite local, nenhum
 * teste roda — nunca há fallback silencioso para o Supabase compartilhado.
 */
import { vi } from 'vitest';

const LOCAL = /^postgres:\/\/[^@]+@127\.0\.0\.1:\d+\/postgres$/;

if (process.env.BANCO_ISOLADO_PGLITE !== '1' || !LOCAL.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Suíte isolada: DATABASE_URL não aponta para o PGlite local (127.0.0.1) — abortado para nunca tocar o banco compartilhado.');
}

// O `pg.Pool` de `src/db.ts` pede SSL (exigência do Supabase); o PGlite local não tem SSL. Só nesta
// suíte, o Pool é criado sem SSL — e recusa qualquer destino que não seja o PGlite local.
vi.mock('pg', async (original) => {
  const pg = await original<typeof import('pg')>();
  const PoolOriginal = pg.Pool ?? (pg as unknown as { default: typeof import('pg') }).default.Pool;
  // Os testes fazem `vi.resetModules()` a cada caso, o que recria `src/db.ts` e, com ele, um Pool
  // novo que nunca é encerrado. Contra o PGlite (limite de conexões do pglite-socket) isso esgota o
  // servidor em poucos testes e todo o resto falha com ECONNRESET. Aqui todo `new Pool()` do worker
  // devolve o MESMO Pool, e `end()` vira no-op (outra cópia do módulo ainda o usa); as conexões
  // morrem junto com o processo do worker.
  const global = globalThis as { __poolIsoladoPglite?: InstanceType<typeof PoolOriginal> };
  class PoolIsolado extends PoolOriginal {
    constructor(opcoes: import('pg').PoolConfig = {}) {
      const destino = opcoes.connectionString ?? '';
      if (!LOCAL.test(destino)) throw new Error('Suíte isolada: conexão recusada — destino não é o PGlite local.');
      if (global.__poolIsoladoPglite) return global.__poolIsoladoPglite as PoolIsolado;
      super({ ...opcoes, ssl: false, max: 5 });
      global.__poolIsoladoPglite = this;
    }
    override end(): Promise<void> {
      return Promise.resolve();
    }
  }
  const padrao = (pg as unknown as { default?: object }).default ?? pg;
  return { ...pg, Pool: PoolIsolado, default: { ...padrao, Pool: PoolIsolado } };
});
