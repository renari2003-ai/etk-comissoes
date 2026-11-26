import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientePta } from '../../src/precificacao/clientesPta.js';

// Banco de verdade, mas SÓ o isolado (PGlite da suíte `npx vitest run -c vitest.isolado.config.ts`):
// fora dela este arquivo é pulado — nunca cria, escreve ou dropa tabela no banco compartilhado.
vi.setConfig({ testTimeout: 30000 });
const NO_BANCO_ISOLADO = process.env.BANCO_ISOLADO_PGLITE === '1';

const VARIAVEIS = ['PRECIFICACAO_CLIENTES_PTA_TABELA', 'PRECIFICACAO_CLIENTES_PTA_HISTORICO_TABELA'] as const;
let tabelas: string[] = [];

async function importarRepositorio(): Promise<typeof import('../../src/precificacao/clientesPtaRepositorio.js')> {
  vi.resetModules();
  return import('../../src/precificacao/clientesPtaRepositorio.js');
}

const ADMIN = { id: 'admin-1', nome: 'Admin Teste' };
const OUTRO = { id: 'admin-2', nome: 'Outro Admin' };
const cliente = (sobrescrever: Partial<ClientePta> = {}): ClientePta => ({ codigoCliente: 9001, comPta: true, nomeCliente: 'Cliente Teste Ltda', cnpjCpf: '12345678000199', ...sobrescrever });

beforeEach(() => {
  if (!NO_BANCO_ISOLADO) return;
  const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  tabelas = VARIAVEIS.map((variavel, i) => {
    const nome = `precificacao_teste_pta${i}_${sufixo}`;
    process.env[variavel] = nome;
    return nome;
  });
});

afterEach(async () => {
  if (!NO_BANCO_ISOLADO) return;
  const { obterPool } = await import('../../src/db.js');
  for (const tabela of tabelas) await obterPool().query(`DROP TABLE IF EXISTS ${tabela}`);
  for (const variavel of VARIAVEIS) delete process.env[variavel];
});

describe.skipIf(!NO_BANCO_ISOLADO)('repositório "cliente com PTA" (PGlite isolado)', () => {
  it('marca, lista, lê e registra no histórico com o usuário', async () => {
    const { salvarClientePta, listarClientesComPta, obterClientePta, listarHistoricoClientesPta } = await importarRepositorio();
    expect(await obterClientePta(9001)).toBeNull();
    const { cliente: salvo, alteracoes } = await salvarClientePta(cliente(), null, ADMIN);
    expect(salvo).toMatchObject({ ...cliente(), versao: 1, atualizadoPor: 'Admin Teste' });
    expect(alteracoes).toBe(3);
    expect(await listarClientesComPta()).toHaveLength(1);
    expect((await obterClientePta(9001))?.comPta).toBe(true);
    const historico = await listarHistoricoClientesPta(9001, 10);
    expect(historico.map((h) => h.campo).sort()).toEqual(['cnpjCpf', 'comPta', 'nomeCliente']);
    expect(historico.every((h) => h.usuarioNome === 'Admin Teste' && h.codigoCliente === 9001)).toBe(true);
  });

  it('desmarcar grava comPta = false (sai da lista, a linha e a versão ficam); sem mudança não grava nada', async () => {
    const { salvarClientePta, listarClientesComPta, listarHistoricoClientesPta } = await importarRepositorio();
    const primeira = await salvarClientePta(cliente(), null, ADMIN);
    const desmarcado = await salvarClientePta(cliente({ comPta: false }), primeira.cliente.versao, ADMIN);
    expect(desmarcado).toMatchObject({ alteracoes: 1, cliente: { comPta: false, versao: 2 } });
    expect(await listarClientesComPta()).toEqual([]);
    const igual = await salvarClientePta(cliente({ comPta: false }), 2, ADMIN);
    expect(igual.alteracoes).toBe(0);
    expect(igual.cliente.versao).toBe(2);
    expect((await listarHistoricoClientesPta(null, 10))[0]).toMatchObject({ campo: 'comPta', valorAnterior: 'true', valorNovo: 'false' });
  });

  it('concorrência: versão velha dá 409; incluir de novo um cliente já gravado dá 409', async () => {
    const { salvarClientePta } = await importarRepositorio();
    const { ErroConflito } = await import('../../src/validacao.js');
    await salvarClientePta(cliente(), null, ADMIN);
    await salvarClientePta(cliente({ comPta: false }), 1, OUTRO);
    await expect(salvarClientePta(cliente({ comPta: true }), 1, ADMIN)).rejects.toThrow(/Outro Admin/);
    await expect(salvarClientePta(cliente(), null, ADMIN)).rejects.toBeInstanceOf(ErroConflito);
    await expect(salvarClientePta(cliente({ codigoCliente: 777 }), 1, ADMIN)).rejects.toBeInstanceOf(ErroConflito);
  });

  it('obterClientesPta devolve a situação de vários clientes de uma vez', async () => {
    const { salvarClientePta, obterClientesPta } = await importarRepositorio();
    await salvarClientePta(cliente(), null, ADMIN);
    await salvarClientePta(cliente({ codigoCliente: 9002, comPta: false }), null, ADMIN);
    const mapa = await obterClientesPta([9001, 9002, 9003]);
    expect([...mapa.keys()].sort()).toEqual([9001, 9002]);
    expect(mapa.get(9002)?.comPta).toBe(false);
    expect((await obterClientesPta([])).size).toBe(0);
  });
});
