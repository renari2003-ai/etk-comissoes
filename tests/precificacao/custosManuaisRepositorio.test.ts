import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustoManual } from '../../src/precificacao/custoManual.js';

// Banco de verdade, mas SÓ o isolado (PGlite da suíte `npx vitest run -c vitest.isolado.config.ts`):
// fora dela este arquivo é pulado — nunca cria, escreve ou dropa tabela no banco compartilhado
// (que é o da produção). Tabelas descartáveis por teste, também com prefixo "precificacao_".
vi.setConfig({ testTimeout: 30000 });
const NO_BANCO_ISOLADO = process.env.BANCO_ISOLADO_PGLITE === '1';

const VARIAVEIS = [
  'PRECIFICACAO_PARAMETROS_TABELA',
  'PRECIFICACAO_ICMS_UF_TABELA',
  'PRECIFICACAO_ICMS_MG_NCM_TABELA',
  'PRECIFICACAO_HISTORICO_TABELA',
  'PRECIFICACAO_CUSTOS_MANUAIS_TABELA',
  'PRECIFICACAO_CUSTOS_MANUAIS_HISTORICO_TABELA',
] as const;
let tabelas: string[] = [];

async function importarRepositorio(): Promise<typeof import('../../src/precificacao/custosManuaisRepositorio.js')> {
  vi.resetModules();
  return import('../../src/precificacao/custosManuaisRepositorio.js');
}

const OPERADOR = { id: 'u-1', nome: 'Operador Teste' };
const OUTRO = { id: 'u-2', nome: 'Outro Operador' };

const custo = (sobrescrever: Partial<CustoManual> = {}): CustoManual => ({
  codigo: 'MP00000045',
  valorNota: 3.5,
  ufFornecedor: 'MG',
  diferimentoPta: true,
  mercadoriaImportada: false,
  tipoFornecedor: 'INDUSTRIA_NORMAL',
  ipiPercentual: 12,
  ...sobrescrever,
});

beforeEach(() => {
  if (!NO_BANCO_ISOLADO) return;
  const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  tabelas = VARIAVEIS.map((variavel, i) => {
    const nome = `precificacao_teste_cm${i}_${sufixo}`;
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

describe.skipIf(!NO_BANCO_ISOLADO)('repositório de custos manuais (PGlite isolado)', () => {
  it('inclui, lista e registra a inclusão no histórico (campo a campo, com o usuário)', async () => {
    const { salvarCustoManual, listarCustosManuais, listarHistoricoCustosManuais } = await importarRepositorio();
    const { custo: salvo, alteracoes } = await salvarCustoManual(custo(), null, OPERADOR);
    expect(salvo).toMatchObject({ ...custo(), versao: 1, atualizadoPor: 'Operador Teste' });
    expect(alteracoes).toBe(6);
    expect(await listarCustosManuais()).toEqual([salvo]);
    const historico = await listarHistoricoCustosManuais('MP00000045', 50);
    expect(historico.map((h) => [h.campo, h.valorAnterior, h.valorNovo]).sort()).toEqual([
      ['diferimentoPta', null, 'true'],
      ['ipiPercentual', null, '12'],
      ['mercadoriaImportada', null, 'false'],
      ['tipoFornecedor', null, 'INDUSTRIA_NORMAL'],
      ['ufFornecedor', null, 'MG'],
      ['valorNota', null, '3.5'],
    ]);
    expect(historico.every((h) => h.usuarioNome === 'Operador Teste')).toBe(true);
  });

  it('altera só o que mudou (histórico com valor anterior) e sobe a versão; sem mudança, não grava nada', async () => {
    const { salvarCustoManual, listarHistoricoCustosManuais } = await importarRepositorio();
    const primeiro = await salvarCustoManual(custo(), null, OPERADOR);
    const segundo = await salvarCustoManual(custo({ valorNota: 4.25 }), primeiro.custo.versao, OUTRO);
    expect(segundo.custo).toMatchObject({ valorNota: 4.25, versao: 2, atualizadoPor: 'Outro Operador' });
    expect((await listarHistoricoCustosManuais(null, 1))[0]).toMatchObject({ campo: 'valorNota', valorAnterior: '3.5', valorNovo: '4.25', usuarioNome: 'Outro Operador' });
    const igual = await salvarCustoManual(custo({ valorNota: 4.25 }), 2, OPERADOR);
    expect(igual.alteracoes).toBe(0);
    expect(igual.custo.versao).toBe(2);
    expect(await listarHistoricoCustosManuais('MP00000045', 50)).toHaveLength(7);
  });

  it('registro antigo sem valor da nota (null) continua sendo lido (vale como "sem custo manual")', async () => {
    const { salvarCustoManual, obterCustosManuais } = await importarRepositorio();
    await salvarCustoManual(custo({ codigo: 'MP1', valorNota: null, ufFornecedor: 'SP', diferimentoPta: false, ipiPercentual: null }), null, OPERADOR);
    const mapa = await obterCustosManuais(['MP1', 'NAO_EXISTE']);
    expect([...mapa.keys()]).toEqual(['MP1']);
    expect(mapa.get('MP1')).toMatchObject({ valorNota: null, ufFornecedor: 'SP', ipiPercentual: null });
  });

  it('concorrência: gravar em cima de leitura antiga (ou incluir de novo um item que já existe) dá 409', async () => {
    const { salvarCustoManual, listarCustosManuais } = await importarRepositorio();
    await salvarCustoManual(custo(), null, OPERADOR);
    await salvarCustoManual(custo({ valorNota: 5 }), 1, OUTRO);
    await expect(salvarCustoManual(custo({ valorNota: 6 }), 1, OPERADOR)).rejects.toThrow(/alterado por Outro Operador.*Recarregue/);
    await expect(salvarCustoManual(custo({ valorNota: 7 }), null, OPERADOR)).rejects.toThrow(/Já existe custo manual salvo para MP00000045/);
    expect((await listarCustosManuais())[0]!.valorNota).toBe(5);
  });

  it('remove (volta a valer o Omie) com histórico; versão errada dá 409; remover de novo dá 409', async () => {
    const { salvarCustoManual, removerCustoManual, listarCustosManuais, listarHistoricoCustosManuais, obterCustosManuais } = await importarRepositorio();
    await salvarCustoManual(custo(), null, OPERADOR);
    await expect(removerCustoManual('MP00000045', 9, OPERADOR)).rejects.toThrow(/Recarregue/);
    await removerCustoManual('MP00000045', 1, OUTRO);
    expect(await listarCustosManuais()).toEqual([]);
    expect((await obterCustosManuais(['mp00000045'])).size).toBe(0);
    const removidos = (await listarHistoricoCustosManuais('MP00000045', 50)).filter((h) => h.usuarioNome === 'Outro Operador');
    expect(removidos.map((h) => [h.campo, h.valorAnterior, h.valorNovo])).toContainEqual(['registro', 'salvo', 'removido']);
    expect(removidos.map((h) => [h.campo, h.valorAnterior, h.valorNovo])).toContainEqual(['valorNota', '3.5', null]);
    // Dois operadores removendo ao mesmo tempo: o segundo recebe 409 (não 400).
    await expect(removerCustoManual('MP00000045', 1, OPERADOR)).rejects.toThrow(/removido por Outro Operador.*Recarregue/);
    await expect(removerCustoManual('NUNCA_SALVO', 1, OPERADOR)).rejects.toThrow(/Não há custo manual salvo para NUNCA_SALVO/);
    // Gravar com a versão antiga depois da remoção: 409.
    await expect(salvarCustoManual(custo(), 1, OPERADOR)).rejects.toThrow(/removido por Outro Operador/);
  });

  it('remover e incluir de novo NÃO volta a versão para 1: uma tela aberta antes da remoção recebe 409 (sem sobrescrever)', async () => {
    const { salvarCustoManual, removerCustoManual, listarCustosManuais } = await importarRepositorio();
    const lidoPorA = (await salvarCustoManual(custo(), null, OPERADOR)).custo; // A tem a versão 1 na tela
    await removerCustoManual('MP00000045', 1, OUTRO); // B remove (versão 2)
    const incluidoPorC = (await salvarCustoManual(custo({ valorNota: 9, ufFornecedor: 'SP', diferimentoPta: false }), null, OUTRO)).custo; // C inclui de novo
    expect(incluidoPorC.versao).toBe(3);
    await expect(salvarCustoManual(custo({ valorNota: 4 }), lidoPorA.versao, OPERADOR)).rejects.toThrow(/alterado por Outro Operador/);
    expect((await listarCustosManuais())[0]).toMatchObject({ valorNota: 9, ufFornecedor: 'SP' });
  });

  it('nome de tabela fora do prefixo precificacao_ é recusado antes de qualquer SQL', async () => {
    process.env.PRECIFICACAO_CUSTOS_MANUAIS_TABELA = 'usuarios';
    const { listarCustosManuais } = await importarRepositorio();
    await expect(listarCustosManuais()).rejects.toThrow(/precisa começar com "precificacao_"/);
  });
});
