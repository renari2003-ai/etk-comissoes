import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Executa a consulta real em PostgreSQL em memória. Não importa config nem acessa .env/rede.
const estado = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/db.js', () => ({ obterPool: () => ({ query: estado.query }) }));
vi.mock('../../src/fretes/schema.js', () => ({
  garantirEsquemaFretes: async () => undefined,
  nomeTabelaRespostas: () => 'respostas',
  nomeTabelaExtracoes: () => 'extracoes',
  nomeTabelaSolicitacoes: () => 'solicitacoes',
}));
import { listarRespostasComErroOuSemProposta } from '../../src/fretes/respostasRepositorio.js';
import { extrairRespostaEmail } from '../../src/fretes/email/parserRespostaEmail.js';

const banco = new PGlite();
beforeAll(async () => {
  await banco.exec(`
    CREATE TABLE solicitacoes (id text PRIMARY KEY, codigo_referencia text);
    CREATE TABLE respostas (
      id text PRIMARY KEY, solicitacao_id text, canal text, identificador_mensagem text,
      conteudo_bruto text, data_recebimento timestamptz, status_processamento text,
      erro_processamento text, criado_em timestamptz
    );
    CREATE TABLE extracoes (resposta_id text, status text, proposta_id text);
    INSERT INTO solicitacoes VALUES ('solicitacao', 'FRE-2026-000047-f99d2884');
  `);
  estado.query.mockImplementation((sql: string, parametros?: unknown[]) => banco.query(sql, parametros));
});
beforeEach(async () => { await banco.exec('DELETE FROM extracoes; DELETE FROM respostas;'); });
afterAll(async () => { await banco.close(); });

async function resposta(id: string, status: string, texto = 'Valor 100\nPrazo. 20 disse\n\nValidade 5 dias') {
  await banco.query(`INSERT INTO respostas VALUES ($1, 'solicitacao', 'WHATSAPP', $1, $2,
    '2026-11-05T17:40:19Z', $3, NULL, '2026-11-05T17:40:21Z')`, [id, texto, status]);
}
async function extracao(id: string, status: string, proposta: string | null = null) {
  await banco.query('INSERT INTO extracoes VALUES ($1, $2, $3)', [id, status, proposta]);
}

describe('caixa de entrada: resposta processada sem proposta', () => {
  it('exibe o caso real que não teve valor extraído, mantendo texto, referência e horário', async () => {
    await resposta('sem-valor', 'PROCESSADA');
    await extracao('sem-valor', 'REQUER_REVISAO');
    const itens = await listarRespostasComErroOuSemProposta();
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ id: 'sem-valor', codigoReferencia: 'FRE-2026-000047-f99d2884',
      conteudoBruto: 'Valor 100\nPrazo. 20 disse\n\nValidade 5 dias', statusProcessamento: 'PROCESSADA',
      dataRecebimento: '2026-11-05T17:40:19.000Z' });
  });
  it('continua exibindo erros de processamento, mesmo sem extração', async () => {
    await resposta('erro', 'ERRO');
    expect((await listarRespostasComErroOuSemProposta()).map((r) => r.id)).toEqual(['erro']);
  });
  it('não apresenta como sem proposta uma resposta já vinculada a uma proposta', async () => {
    await resposta('com-proposta', 'PROCESSADA');
    await extracao('com-proposta', 'REQUER_REVISAO', 'proposta');
    expect(await listarRespostasComErroOuSemProposta()).toEqual([]);
  });
  it('não duplica registros e não reapresenta extração antiga após vincular uma proposta', async () => {
    await resposta('varias', 'PROCESSADA');
    await extracao('varias', 'REQUER_REVISAO');
    await extracao('varias', 'REQUER_REVISAO');
    expect(await listarRespostasComErroOuSemProposta()).toHaveLength(1);
    await extracao('varias', 'EXTRAIDA', 'proposta');
    expect(await listarRespostasComErroOuSemProposta()).toEqual([]);
  });
  it('não inclui respostas ainda em processamento nem respostas extraídas normalmente', async () => {
    await resposta('pendente', 'PENDENTE');
    await extracao('pendente', 'REQUER_REVISAO');
    await resposta('extraida', 'PROCESSADA');
    await extracao('extraida', 'EXTRAIDA', 'proposta');
    expect(await listarRespostasComErroOuSemProposta()).toEqual([]);
  });
  it('mantém revisão para texto livre e reconhece o exemplo estruturado, sem inferir validade relativa', () => {
    expect(extrairRespostaEmail('Valor 100\nPrazo. 20 disse\n\nValidade 5 dias').extracao.valorFrete).toBeNull();
    const exemplo = extrairRespostaEmail('VALOR_FRETE: 100,00\nPRAZO_DIAS: 20\nVALIDADE: 10/11/2026\nOBSERVACOES: Teste.');
    expect(exemplo.problemas).toEqual([]);
    expect(exemplo.extracao).toMatchObject({ valorFrete: 100, prazoDias: 20, validade: '2026-11-10' });
    expect(extrairRespostaEmail('VALOR_FRETE: 100\nVALIDADE: 5 dias').extracao.validade).toBeNull();
  });
});
