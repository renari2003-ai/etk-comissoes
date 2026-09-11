import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `src/auth/sessoes.ts` roda contra Postgres (Supabase) — nome da tabela via
 * `SESSOES_TABELA` (variável só usada em teste), sempre uma tabela nova e
 * descartável no MESMO banco (não temos um segundo projeto Supabase só pra
 * teste). Cada teste reimporta com `vi.resetModules()` + `import()` dinâmico.
 */
async function importarModulo(): Promise<typeof import('../../src/auth/sessoes.js')> {
  vi.resetModules();
  return import('../../src/auth/sessoes.js');
}

let tabelaTemp: string;

beforeEach(() => {
  tabelaTemp = `sessoes_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.SESSOES_TABELA = tabelaTemp;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  await obterPool()
    .query(`DROP TABLE IF EXISTS ${tabelaTemp}`)
    .catch(() => undefined);
  delete process.env.SESSOES_TABELA;
});

describe('criarSessao / validarSessao / destruirSessao', () => {
  it('criarSessao gera um token que validarSessao resolve pro mesmo usuarioId', async () => {
    const { criarSessao, validarSessao } = await importarModulo();
    const token = await criarSessao('11111111-1111-1111-1111-111111111111');
    expect(token).toHaveLength(64); // randomBytes(32).toString('hex')
    await expect(validarSessao(token)).resolves.toBe('11111111-1111-1111-1111-111111111111');
  });

  it('validarSessao devolve null pra um token que nunca existiu', async () => {
    const { validarSessao } = await importarModulo();
    await expect(validarSessao('token-inexistente')).resolves.toBeNull();
  });

  it('destruirSessao invalida o token na hora', async () => {
    const { criarSessao, validarSessao, destruirSessao } = await importarModulo();
    const token = await criarSessao('11111111-1111-1111-1111-111111111111');
    await destruirSessao(token);
    await expect(validarSessao(token)).resolves.toBeNull();
  });

  it('validarSessao devolve null e apaga a linha de uma sessão expirada', async () => {
    const { criarSessao, validarSessao } = await importarModulo();
    const token = await criarSessao('11111111-1111-1111-1111-111111111111');

    const { obterPool } = await import('../../src/db.js');
    // Força a sessão a já estar expirada, sem esperar os 7 dias reais.
    await obterPool().query(`UPDATE ${tabelaTemp} SET expira_em = now() - interval '1 second' WHERE token = $1`, [token]);

    await expect(validarSessao(token)).resolves.toBeNull();
    const { rows } = await obterPool().query(`SELECT 1 FROM ${tabelaTemp} WHERE token = $1`, [token]);
    expect(rows).toHaveLength(0); // limpa a linha expirada, não deixa lixo acumulando
  });

  it('validarSessao renova a validade (sliding) a cada chamada', async () => {
    const { criarSessao, validarSessao } = await importarModulo();
    const token = await criarSessao('11111111-1111-1111-1111-111111111111');

    const { obterPool } = await import('../../src/db.js');
    const { rows: antes } = await obterPool().query<{ expira_em: Date }>(`SELECT expira_em FROM ${tabelaTemp} WHERE token = $1`, [
      token,
    ]);

    await new Promise((resolve) => setTimeout(resolve, 1100)); // garante um expira_em mensurável diferente
    await validarSessao(token);

    const { rows: depois } = await obterPool().query<{ expira_em: Date }>(`SELECT expira_em FROM ${tabelaTemp} WHERE token = $1`, [
      token,
    ]);
    expect(new Date(depois[0]!.expira_em).getTime()).toBeGreaterThan(new Date(antes[0]!.expira_em).getTime());
  });
});
