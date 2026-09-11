import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `CachePostgres` roda contra Postgres (Supabase) — nome da tabela via
 * `OMIE_CACHE_TABELA` (variável só usada em teste), sempre uma tabela nova e
 * descartável no MESMO banco (não temos um segundo projeto Supabase só pra
 * teste). Cada teste reimporta com `vi.resetModules()` + `import()` dinâmico.
 */
async function importarModulo(): Promise<typeof import('../../src/omie/cachePostgres.js')> {
  vi.resetModules();
  return import('../../src/omie/cachePostgres.js');
}

let tabelaTemp: string;

beforeEach(() => {
  tabelaTemp = `omie_cache_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.OMIE_CACHE_TABELA = tabelaTemp;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  await obterPool()
    .query(`DROP TABLE IF EXISTS ${tabelaTemp}`)
    .catch(() => undefined);
  delete process.env.OMIE_CACHE_TABELA;
});

describe('CachePostgres', () => {
  it('busca só na primeira chamada; a segunda usa o valor em cache sem chamar buscar() de novo', async () => {
    const { CachePostgres } = await importarModulo();
    const cache = new CachePostgres('teste');
    const buscar = vi.fn().mockResolvedValue({ valor: 42 });

    const primeiro = await cache.obterOuBuscar('chave-1', buscar);
    const segundo = await cache.obterOuBuscar('chave-1', buscar);

    expect(primeiro).toEqual({ valor: 42 });
    expect(segundo).toEqual({ valor: 42 });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('chaves diferentes nunca compartilham o valor em cache', async () => {
    const { CachePostgres } = await importarModulo();
    const cache = new CachePostgres('teste');
    await cache.obterOuBuscar('a', () => Promise.resolve('valor-a'));
    await cache.obterOuBuscar('b', () => Promise.resolve('valor-b'));

    const buscarA = vi.fn().mockResolvedValue('novo-a');
    expect(await cache.obterOuBuscar('a', buscarA)).toBe('valor-a');
    expect(buscarA).not.toHaveBeenCalled();
  });

  it('categorias diferentes nunca compartilham o valor em cache, mesmo com a mesma chave', async () => {
    const { CachePostgres } = await importarModulo();
    const cacheX = new CachePostgres('categoria-x');
    const cacheY = new CachePostgres('categoria-y');
    await cacheX.obterOuBuscar('mesma-chave', () => Promise.resolve('valor-x'));

    const buscarY = vi.fn().mockResolvedValue('valor-y');
    expect(await cacheY.obterOuBuscar('mesma-chave', buscarY)).toBe('valor-y');
    expect(buscarY).toHaveBeenCalledTimes(1);
  });

  it('rebusca depois que o TTL expira', async () => {
    const { CachePostgres } = await importarModulo();
    const cache = new CachePostgres('teste', 300); // TTL bem curto só pro teste
    const buscar = vi.fn().mockResolvedValueOnce('primeiro').mockResolvedValueOnce('segundo');

    expect(await cache.obterOuBuscar('chave', buscar)).toBe('primeiro');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await cache.obterOuBuscar('chave', buscar)).toBe('segundo');
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('limpar() remove só a categoria dela, nunca as outras', async () => {
    const { CachePostgres } = await importarModulo();
    const cacheX = new CachePostgres('categoria-x');
    const cacheY = new CachePostgres('categoria-y');
    await cacheX.obterOuBuscar('chave', () => Promise.resolve('valor-x'));
    await cacheY.obterOuBuscar('chave', () => Promise.resolve('valor-y'));

    await cacheX.limpar();

    const buscarXNovo = vi.fn().mockResolvedValue('valor-x-novo');
    expect(await cacheX.obterOuBuscar('chave', buscarXNovo)).toBe('valor-x-novo'); // categoria X foi limpa
    expect(buscarXNovo).toHaveBeenCalledTimes(1);

    const buscarYNovo = vi.fn().mockResolvedValue('nunca-deveria-chamar');
    expect(await cacheY.obterOuBuscar('chave', buscarYNovo)).toBe('valor-y'); // categoria Y intacta
    expect(buscarYNovo).not.toHaveBeenCalled();
  });
});
