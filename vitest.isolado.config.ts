// Suíte completa contra um Postgres ISOLADO (PGlite em memória) — `npx vitest run --config vitest.isolado.config.ts`.
// Requer os devDependencies @electric-sql/pglite e @electric-sql/pglite-socket. Nunca usa o DATABASE_URL do .env.
export default {
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/isolado/globalSetup.ts'],
    setupFiles: ['tests/isolado/setup.ts'],
    // Um único PGlite (uma conexão real): arquivos em sequência evitam transações intercaladas entre arquivos.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
};
