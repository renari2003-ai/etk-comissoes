import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `Limitador` roda contra Postgres (Supabase) — nome da tabela via
 * `LIMITADOR_TABELA` (variável só usada em teste), sempre uma tabela nova e
 * descartável no MESMO banco. Cada teste reimporta com `vi.resetModules()` +
 * `import()` dinâmico — por isso `OmieErroTransitorio` também precisa vir
 * desse MESMO import dinâmico (não de um `import` estático no topo do
 * arquivo): `vi.resetModules()` cria um registro de módulos novo, e um
 * `instanceof` entre uma classe do registro antigo e um erro construído com
 * a classe do registro novo sempre dá `false`, mesmo sendo "a mesma" classe
 * por nome (foi exatamente esse bug que fazia o retry nunca acontecer).
 */
async function importarModulo(): Promise<
  typeof import('../../src/omie/limitador.js') & typeof import('../../src/omie/erros.js')
> {
  vi.resetModules();
  const [limitador, erros] = await Promise.all([import('../../src/omie/limitador.js'), import('../../src/omie/erros.js')]);
  return { ...limitador, ...erros };
}

let tabelaTemp: string;

beforeEach(() => {
  tabelaTemp = `omie_limitador_teste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.LIMITADOR_TABELA = tabelaTemp;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  await obterPool()
    .query(`DROP TABLE IF EXISTS ${tabelaTemp}`)
    .catch(() => undefined);
  delete process.env.LIMITADOR_TABELA;
});

describe('Limitador', () => {
  it('executa fn e devolve o resultado', async () => {
    const { Limitador } = await importarModulo();
    const limitador = new Limitador(50);
    const resultado = await limitador.executar(() => Promise.resolve('valor'));
    expect(resultado).toBe('valor');
  });

  it('espaça o INÍCIO de duas chamadas sequenciais em pelo menos intervaloMinimoMs', async () => {
    const { Limitador } = await importarModulo();
    const limitador = new Limitador(300);
    const inicios: number[] = [];
    const registrarInicio = async () => {
      inicios.push(Date.now());
      return 'ok';
    };

    await limitador.executar(registrarInicio);
    await limitador.executar(registrarInicio);

    expect(inicios[1]! - inicios[0]!).toBeGreaterThanOrEqual(290); // margem pequena pra variação de timer
  });

  it('serializa chamadas concorrentes de duas instâncias diferentes de Limitador (mesma tabela) — simula duas invocações serverless', async () => {
    const { Limitador } = await importarModulo();
    const limitadorA = new Limitador(300);
    const limitadorB = new Limitador(300);
    const inicios: number[] = [];
    const registrarInicio = async () => {
      inicios.push(Date.now());
      return 'ok';
    };

    await Promise.all([limitadorA.executar(registrarInicio), limitadorB.executar(registrarInicio)]);

    inicios.sort((a, b) => a - b);
    expect(inicios[1]! - inicios[0]!).toBeGreaterThanOrEqual(290);
  });

  it('tenta de novo em erro transitório e eventualmente lança o último erro se persistir', async () => {
    const { Limitador, OmieErroTransitorio } = await importarModulo();
    const limitador = new Limitador(10);
    const fn = vi.fn().mockRejectedValue(new OmieErroTransitorio('falha de rede simulada'));

    await expect(limitador.executar(fn)).rejects.toThrow('falha de rede simulada');
    expect(fn).toHaveBeenCalledTimes(3); // MAX_TENTATIVAS
  });

  it('nunca tenta de novo um erro que não é transitório/limite excedido', async () => {
    const { Limitador } = await importarModulo();
    const limitador = new Limitador(10);
    const fn = vi.fn().mockRejectedValue(new Error('erro de programação qualquer'));

    await expect(limitador.executar(fn)).rejects.toThrow('erro de programação qualquer');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
