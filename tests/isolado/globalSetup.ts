/**
 * Banco ISOLADO para os testes que usam Postgres (2026-10-06): PGlite (Postgres 17 em WASM, em
 * memória, descartado no fim) exposto por `pglite-socket` só em 127.0.0.1, porta escolhida pelo SO.
 *
 * O `DATABASE_URL` é sobrescrito ANTES de qualquer worker do Vitest subir — `src/config.ts` usa
 * `process.loadEnvFile`, que nunca sobrescreve variável já definida, então o `.env` (Supabase
 * compartilhado) não é lido para esse valor. `setup.ts` ainda confere isso em cada worker.
 *
 * Limitação (documentada): PGlite tem UMA conexão real; o servidor multiplexa os clientes do `pg`
 * sobre ela. Transações/locks entre sessões diferentes (FOR UPDATE concorrente, advisory lock
 * disputado) NÃO são reproduzidos fielmente — por isso os arquivos rodam em sequência.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export default async function iniciarBancoIsolado(): Promise<() => Promise<void>> {
  const db = await PGlite.create(); // sem dataDir: só em memória
  const servidor = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 20 });
  await servidor.start();
  const conexao = servidor.getServerConn(); // "127.0.0.1:<porta>"
  if (!/^127\.0\.0\.1:\d+$/.test(conexao)) throw new Error(`Servidor PGlite em endereço inesperado: ${conexao}`);
  process.env.DATABASE_URL = `postgres://postgres:postgres@${conexao}/postgres`;
  process.env.BANCO_ISOLADO_PGLITE = '1';
  console.log(`[banco isolado] PGlite em memória escutando em ${conexao}`);
  return async () => {
    await servidor.stop();
    await db.close();
  };
}
