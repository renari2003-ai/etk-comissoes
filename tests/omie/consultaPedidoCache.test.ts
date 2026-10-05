import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClienteOmie } from '../../src/omie/cliente.js';
import { CachePostgres } from '../../src/omie/cachePostgres.js';

const { registros } = vi.hoisted(() => ({ registros: new Map<string, { valor: unknown; criado_em: Date }>() }));
// Banco e rede substituídos; o cache e o cliente HTTP sob teste são os reais.
vi.mock('../../src/db.js', () => ({ executarDdlIdempotente: async () => {}, obterPool: () => ({
  query: async (sql: string, params: unknown[]) => {
    const chave = `${params[0]}:${params[1]}`;
    if (sql.trimStart().startsWith('SELECT')) return { rows: registros.has(chave) ? [registros.get(chave)] : [] };
    if (sql.trimStart().startsWith('INSERT')) registros.set(chave, { valor: JSON.parse(params[2] as string), criado_em: new Date() });
    if (sql.trimStart().startsWith('DELETE')) for (const k of registros.keys()) if (k.startsWith(`${params[0]}:`)) registros.delete(k);
    return { rows: [] };
  },
}) }));
vi.mock('../../src/config.js', () => ({ config: { intervaloMinimoMs: 0, omieAppKey: 'teste', omieAppSecret: 'teste' } }));
vi.mock('../../src/omie/limitador.js', () => ({ Limitador: class { async executar<T>(fn: () => Promise<T>) { return fn(); } } }));
beforeEach(() => registros.clear());
afterEach(() => vi.unstubAllGlobals());

const pedido = { cabecalho: { codigo_pedido: 1, numero_pedido: '154' } };
const resposta = () => new Response(JSON.stringify({ pedido_venda_produto: pedido }), { status: 200 });

describe('ConsultarPedido — cache compartilhado entre tela, períodos e Excel', () => {
  it('envia uma única consulta para requisições simultâneas do mesmo pedido', async () => {
    const fetchFalso = vi.fn().mockImplementation(async () => resposta());
    vi.stubGlobal('fetch', fetchFalso);
    const cliente = new ClienteOmie(0);
    const resultados = await Promise.all([cliente.consultarPedido({ numeroPedido: '154' }), cliente.consultarPedido({ numeroPedido: '154' })]);
    expect(resultados).toEqual([pedido, pedido]);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
  it('reaproveita a resposta em outra instância do servidor, sem perder faturas por código', async () => {
    const fetchFalso = vi.fn().mockImplementation(async () => resposta());
    vi.stubGlobal('fetch', fetchFalso);
    await new ClienteOmie(0).consultarPedido({ numeroPedido: '154' });
    const outro = new ClienteOmie(0);
    expect(await outro.consultarPedido({ numeroPedido: '154' })).toEqual(pedido);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    await outro.consultarPedido({ codigoPedido: 2 });
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
  it('não guarda falhas como resultados e permite uma consulta posterior', async () => {
    const fetchFalso = vi.fn().mockRejectedValueOnce(new Error('rede')).mockImplementation(async () => resposta());
    vi.stubGlobal('fetch', fetchFalso);
    const cliente = new ClienteOmie(0);
    await expect(cliente.consultarPedido({ numeroPedido: '154' })).rejects.toThrow('Falha de rede');
    expect(await cliente.consultarPedido({ numeroPedido: '154' })).toEqual(pedido);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
  it('limpar cache invalida também as consultas de pedido', async () => {
    const fetchFalso = vi.fn().mockImplementation(async () => resposta());
    vi.stubGlobal('fetch', fetchFalso);
    const cliente = new ClienteOmie(0);
    await cliente.consultarPedido({ numeroPedido: '154' });
    await cliente.limparCache();
    await cliente.consultarPedido({ numeroPedido: '154' });
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
  it('coalesce buscas em andamento também quando a consulta de banco ainda está pendente', async () => {
    const cache = new CachePostgres('teste-concorrente');
    const buscar = vi.fn().mockResolvedValue({ valor: 42 });
    expect(await Promise.all([cache.obterOuBuscar('a', buscar), cache.obterOuBuscar('a', buscar)])).toEqual([{ valor: 42 }, { valor: 42 }]);
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});
