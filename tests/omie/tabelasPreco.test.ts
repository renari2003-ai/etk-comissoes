import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClienteOmie } from '../../src/omie/cliente.js';
import { normalizarItemTabela, normalizarTabela } from '../../src/omie/tabelasPreco.js';

const { registros } = vi.hoisted(() => ({ registros: new Map<string, { valor: unknown; criado_em: Date }>() }));
// Banco e rede substituídos; o cache e o cliente HTTP sob teste são os reais.
vi.mock('../../src/db.js', () => ({ executarDdlIdempotente: async () => {}, obterPool: () => ({
  query: async (sql: string, params: unknown[]) => {
    const chave = `${params[0]}:${params[1]}`;
    if (sql.trimStart().startsWith('SELECT')) return { rows: registros.has(chave) ? [registros.get(chave)] : [] };
    if (sql.trimStart().startsWith('INSERT')) registros.set(chave, { valor: JSON.parse(params[2] as string), criado_em: new Date() });
    return { rows: [] };
  },
}) }));
vi.mock('../../src/config.js', () => ({ config: { intervaloMinimoMs: 0, omieAppKey: 'teste', omieAppSecret: 'teste' } }));
vi.mock('../../src/omie/limitador.js', () => ({ Limitador: class { async executar<T>(fn: () => Promise<T>) { return fn(); } } }));
beforeEach(() => registros.clear());
afterEach(() => vi.unstubAllGlobals());

/** Formato real devolvido pela Omie em 2026-10-06 (campos não usados omitidos). */
const TABELAS = {
  nPagina: 1, nTotPaginas: 1,
  listaTabelasPreco: [
    { nCodTabPreco: 2400087453, cCodigo: '001', cNome: 'CTO PROMOCIONAL.', cAtiva: 'S' },
    { nCodTabPreco: 2404412334, cCodigo: '003', cNome: 'TABELA DE VENDA - 07/26', cAtiva: 'S', info: { dInc: '26/06/2026', dAlt: '27/08/2026', hAlt: '10:55:09' } },
    { nCodTabPreco: 2300000000, cCodigo: '000', cNome: 'ANTIGA', cAtiva: 'N' },
  ],
};
const ITENS: Record<number, unknown> = {
  2400087453: { nTotPaginas: 1, listaTabelaPreco: { itensTabela: [{ nCodProd: 2389175097, cCodigoProduto: 'PA00000088', nValorTabela: 82.9, itemInfo: { dAltItem: '09/06/2026', hAltItem: '16:06:33' } }] } },
  2404412334: { nTotPaginas: 1, listaTabelaPreco: { itensTabela: [
    { nCodProd: 2387115720, cCodigoProduto: 'PA00000001', nValorTabela: 116.72, nValorOriginal: 111.825433, itemInfo: { dAltItem: '26/06/2026', hAltItem: '15:39:46' } },
  ] } },
};

describe('ListarTabelasPreco / ListarTabelaItens — somente leitura', () => {
  it('consulta só métodos de leitura, itens apenas das tabelas ativas, e usa nValorTabela (nunca nValorOriginal)', async () => {
    const chamadas: Array<{ call: string; param: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const corpo = JSON.parse(init.body) as { call: string; param: Array<Record<string, unknown>> };
      const param = corpo.param[0] ?? {};
      chamadas.push({ call: corpo.call, param });
      const resposta = corpo.call === 'ListarTabelasPreco' ? TABELAS : ITENS[param.nCodTabPreco as number];
      return new Response(JSON.stringify(resposta), { status: 200 });
    }));

    const tabelas = await new ClienteOmie(0).listarTabelasPreco();

    expect(chamadas.map((c) => c.call)).toEqual(['ListarTabelasPreco', 'ListarTabelaItens', 'ListarTabelaItens']);
    expect(chamadas.every((c) => /^(Listar|Consultar)/.test(c.call))).toBe(true);
    expect(chamadas.filter((c) => c.call === 'ListarTabelaItens').map((c) => c.param.nCodTabPreco)).toEqual([2400087453, 2404412334]);
    expect(tabelas.map((t) => [t.codigoComercial, t.ativa, t.itens.length])).toEqual([['001', true, 1], ['003', true, 1], ['000', false, 0]]);
    expect(tabelas[1]).toMatchObject({ dataAlteracao: '27/08/2026', horaAlteracao: '10:55:09' });
    expect(tabelas[0]).toMatchObject({ dataAlteracao: null, horaAlteracao: null }); // sem `info`: nunca inventada
    expect(tabelas[1]?.itens[0]).toEqual({ codigoProduto: 2387115720, codigoProdutoTexto: 'PA00000001', precoTabela: 116.72, dataAlteracao: '26/06/2026', horaAlteracao: '15:39:46' });

    // Cacheado: segunda consulta não volta à Omie.
    await new ClienteOmie(0).listarTabelasPreco();
    expect(chamadas).toHaveLength(3);
  });

  it('tabela sem identificação válida é erro explícito, nunca ignorada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ nTotPaginas: 1, listaTabelasPreco: [{ nCodTabPreco: 0, cCodigo: '', cAtiva: 'S' }] }), { status: 200 })));
    await expect(new ClienteOmie(0).listarTabelasPreco()).rejects.toThrow('sem identificação válida');
  });
});

describe('normalização dos registros de tabela de preços', () => {
  it('preço ausente vira null (nunca outro preço); data/hora inválidas viram null', () => {
    expect(normalizarItemTabela({ nCodProd: 1, itemInfo: { dAltItem: '2026-06-26', hAltItem: 'x' } })).toEqual({
      codigoProduto: 1, codigoProdutoTexto: '', precoTabela: null, dataAlteracao: null, horaAlteracao: null,
    });
  });
  it('item sem produto e tabela com cAtiva inválido lançam erro', () => {
    expect(() => normalizarItemTabela({ nValorTabela: 10 })).toThrow('sem código de produto');
    expect(() => normalizarTabela({ nCodTabPreco: 1, cCodigo: '001', cAtiva: 'X' })).toThrow('sem identificação válida');
  });
});
