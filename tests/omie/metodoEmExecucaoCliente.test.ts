import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClienteOmie } from '../../src/omie/cliente.js';
import { OmieErroMetodoEmExecucao } from '../../src/omie/erros.js';

// Banco, configuração e fila substituídos (fila = passagem direta): aqui só se testa como o cliente
// HTTP classifica a resposta real da Omie. A política de retry tem os próprios testes.
vi.mock('../../src/db.js', () => ({ executarDdlIdempotente: async () => {}, obterPool: () => ({ query: async () => ({ rows: [] }) }) }));
vi.mock('../../src/config.js', () => ({ config: { intervaloMinimoMs: 0, omieAppKey: 'teste', omieAppSecret: 'teste' } }));
vi.mock('../../src/omie/limitador.js', () => ({ Limitador: class { async executar<T>(fn: () => Promise<T>) { return fn(); } } }));
afterEach(() => vi.unstubAllGlobals());

describe('ClienteOmie — resposta real Client-1880', () => {
  it('HTTP 500 com faultcode SOAP-ENV:Client-1880 vira OmieErroMetodoEmExecucao, com o método no texto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      faultstring: 'ERROR: Já existe uma requisição desse método sendo executada e você pode tentar novamente em alguns instantes. (1)',
      faultcode: 'SOAP-ENV:Client-1880',
    }), { status: 500 })));
    const erro = await new ClienteOmie(0).listarContasReceberPorVendedor(2389160395).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(OmieErroMetodoEmExecucao);
    expect((erro as Error).message).toContain('[ListarContasReceber]');
  });
});
