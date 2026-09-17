import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Homologação real 2026-09-16/17: reproduz e comprova a autocura das FKs de
// `solicitacoes_cotacao_frete`/`extracoes_proposta_frete` que, na primeira execução real de
// `garantirEsquemaFretes()` em produção, foram criadas apontando para tabelas de TESTE
// (evidência: `pg_constraint` real mostrava `..._cotacao_frete_id_fkey` e
// `..._transportadora_id_fkey` apontando para `*_teste_1789577687814_airk3qshvlj`, e
// `extracoes_proposta_frete_proposta_id_fkey` para `propostas_frete_teste_...` com o MESMO
// sufixo — uma única execução corrompida). `CREATE TABLE IF NOT EXISTS` nunca corrige uma FK
// já existente; a correção em `schema.ts` (`repararFkSeApontarParaTabelaErrada`) detecta e
// repara isso a cada start, de forma idempotente.
vi.setConfig({ testTimeout: 20000 });

let sufixo: string;

beforeEach(() => {
  sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.TRANSPORTADORAS_TABELA = `transportadoras_teste_${sufixo}`;
  process.env.VEICULOS_FRETE_TABELA = `veiculos_frete_teste_${sufixo}`;
  process.env.COTACOES_FRETE_TABELA = `cotacoes_frete_teste_${sufixo}`;
  process.env.PROPOSTAS_FRETE_TABELA = `propostas_frete_teste_${sufixo}`;
  process.env.FECHAMENTOS_FRETE_TABELA = `fechamentos_frete_teste_${sufixo}`;
  process.env.AUDITORIA_FRETES_TABELA = `auditoria_fretes_teste_${sufixo}`;
  process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_teste_${sufixo}`;
  process.env.SOLICITACOES_COTACAO_TABELA = `solicitacoes_cotacao_teste_${sufixo}`;
  process.env.RESPOSTAS_COTACAO_TABELA = `respostas_cotacao_teste_${sufixo}`;
  process.env.EXTRACOES_PROPOSTA_TABELA = `extracoes_proposta_teste_${sufixo}`;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  await pool.query(`DROP TABLE IF EXISTS decoy_cotacoes_${sufixo}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS decoy_transportadoras_${sufixo}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.EXTRACOES_PROPOSTA_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.RESPOSTAS_COTACAO_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.SOLICITACOES_COTACAO_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.FECHAMENTOS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.PROPOSTAS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.COTACOES_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.TRANSPORTADORAS_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.VEICULOS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.AUDITORIA_FRETES_TABELA}`).catch(() => undefined);
  await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
  delete process.env.TRANSPORTADORAS_TABELA;
  delete process.env.VEICULOS_FRETE_TABELA;
  delete process.env.COTACOES_FRETE_TABELA;
  delete process.env.PROPOSTAS_FRETE_TABELA;
  delete process.env.FECHAMENTOS_FRETE_TABELA;
  delete process.env.AUDITORIA_FRETES_TABELA;
  delete process.env.COTACOES_FRETE_SEQ;
  delete process.env.SOLICITACOES_COTACAO_TABELA;
  delete process.env.RESPOSTAS_COTACAO_TABELA;
  delete process.env.EXTRACOES_PROPOSTA_TABELA;
}, 20000);

const USUARIO_TESTE = '11111111-1111-1111-1111-111111111111';

async function importarModulos() {
  vi.resetModules();
  const schema = await import('../../src/fretes/schema.js');
  const servico = await import('../../src/fretes/fretesServico.js');
  const { obterPool } = await import('../../src/db.js');
  return { schema, servico, pool: obterPool() };
}

/**
 * Nomes de constraint gerados automaticamente pelo Postgres são truncados em 63 bytes
 * (NAMEDATALEN) — para os nomes de tabela de teste (longos, com sufixo aleatório), o nome
 * "esperado" por concatenação simples (`${tabela}_${coluna}_fkey`) quase sempre NÃO bate
 * com o nome real gravado no banco. Por isso o nome real é sempre descoberto via
 * `pg_constraint`/`pg_attribute` (pela COLUNA, nunca pelo nome) — a mesma técnica usada pela
 * própria correção em `schema.ts`.
 */
async function buscarNomeConstraintFk(pool: import('pg').Pool, tabela: string, coluna: string): Promise<string> {
  const r = await pool.query<{ conname: string }>(
    `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel_src ON rel_src.oid = con.conrelid
       JOIN pg_attribute att ON att.attrelid = rel_src.oid AND att.attnum = con.conkey[1]
      WHERE rel_src.relname = $1 AND con.contype = 'f'
        AND array_length(con.conkey, 1) = 1 AND att.attname = $2`,
    [tabela, coluna],
  );
  const nome = r.rows[0]?.conname;
  if (nome === undefined) throw new Error(`Constraint FK não encontrada para ${tabela}.${coluna}`);
  return nome;
}

describe('autocura de FK corrompida em solicitacoes_cotacao_frete/extracoes_proposta_frete (homologação 2026-09-16/17)', () => {
  it('cria as tabelas com as 3 FKs corretas desde o início (caso normal, sem corrupção)', async () => {
    const { schema, pool } = await importarModulos();
    await schema.garantirEsquemaFretes();

    const r = await pool.query<{ tabela_referenciada: string }>(
      `SELECT rel_ref.relname AS tabela_referenciada
         FROM pg_constraint con
         JOIN pg_class rel_src ON rel_src.oid = con.conrelid
         JOIN pg_class rel_ref ON rel_ref.oid = con.confrelid
        WHERE rel_src.relname = $1 AND con.contype = 'f'`,
      [schema.nomeTabelaSolicitacoes()],
    );
    const tabelasReferenciadas = r.rows.map((row) => row.tabela_referenciada);
    expect(tabelasReferenciadas).toEqual(
      expect.arrayContaining([schema.nomeTabelaCotacoes(), schema.nomeTabelaTransportadoras()]),
    );
  });

  it('repara a FK cotacao_frete_id quando ela aponta para uma tabela errada (reprodução exata do bug real)', async () => {
    const { schema, pool } = await importarModulos();
    await schema.garantirEsquemaFretes();

    // Reproduz a corrupção: cria uma tabela "decoy" com o mesmo formato de cotacoes_frete e
    // força a FK a apontar para ela — exatamente o estado encontrado em produção.
    await pool.query(`CREATE TABLE decoy_cotacoes_${sufixo} (id UUID PRIMARY KEY)`);
    const nomeConstraint = await buscarNomeConstraintFk(pool, schema.nomeTabelaSolicitacoes(), 'cotacao_frete_id');
    await pool.query(`ALTER TABLE ${schema.nomeTabelaSolicitacoes()} DROP CONSTRAINT ${nomeConstraint}`);
    await pool.query(
      `ALTER TABLE ${schema.nomeTabelaSolicitacoes()} ADD CONSTRAINT ${nomeConstraint} FOREIGN KEY (cotacao_frete_id) REFERENCES decoy_cotacoes_${sufixo}(id)`,
    );

    // Confirma que a corrupção foi mesmo aplicada antes de testar a correção.
    const antes = await pool.query(
      `SELECT rel_ref.relname AS tabela_referenciada FROM pg_constraint con
         JOIN pg_class rel_ref ON rel_ref.oid = con.confrelid
        WHERE con.conname = $1`,
      [nomeConstraint],
    );
    expect(antes.rows[0]?.tabela_referenciada).toBe(`decoy_cotacoes_${sufixo}`);

    // Força `garantirEsquemaFretes()` a rodar de novo (mesmo processo) e confirma a autocura.
    schema.resetarEsquemaGarantidoParaTestes();
    await schema.garantirEsquemaFretes();

    const depois = await pool.query(
      `SELECT rel_ref.relname AS tabela_referenciada FROM pg_constraint con
         JOIN pg_class rel_ref ON rel_ref.oid = con.confrelid
        WHERE con.conname = $1`,
      [nomeConstraint],
    );
    expect(depois.rows[0]?.tabela_referenciada).toBe(schema.nomeTabelaCotacoes());
  });

  it('repara a FK transportadora_id quando ela aponta para uma tabela errada', async () => {
    const { schema, pool } = await importarModulos();
    await schema.garantirEsquemaFretes();

    await pool.query(`CREATE TABLE decoy_transportadoras_${sufixo} (id UUID PRIMARY KEY)`);
    const nomeConstraint = await buscarNomeConstraintFk(pool, schema.nomeTabelaSolicitacoes(), 'transportadora_id');
    await pool.query(`ALTER TABLE ${schema.nomeTabelaSolicitacoes()} DROP CONSTRAINT ${nomeConstraint}`);
    await pool.query(
      `ALTER TABLE ${schema.nomeTabelaSolicitacoes()} ADD CONSTRAINT ${nomeConstraint} FOREIGN KEY (transportadora_id) REFERENCES decoy_transportadoras_${sufixo}(id)`,
    );

    schema.resetarEsquemaGarantidoParaTestes();
    await schema.garantirEsquemaFretes();

    const depois = await pool.query(
      `SELECT rel_ref.relname AS tabela_referenciada FROM pg_constraint con
         JOIN pg_class rel_ref ON rel_ref.oid = con.confrelid
        WHERE con.conname = $1`,
      [nomeConstraint],
    );
    expect(depois.rows[0]?.tabela_referenciada).toBe(schema.nomeTabelaTransportadoras());
  });

  it('depois da reparação, criar uma solicitação para uma cotação VÁLIDA funciona normalmente (fim a fim, sem chamar n8n)', async () => {
    const { schema, servico, pool } = await importarModulos();
    await schema.garantirEsquemaFretes();

    // Corrompe e repara, como nos testes acima, para simular o cenário real pós-correção.
    await pool.query(`CREATE TABLE decoy_cotacoes_${sufixo} (id UUID PRIMARY KEY)`);
    const nomeConstraint = await buscarNomeConstraintFk(pool, schema.nomeTabelaSolicitacoes(), 'cotacao_frete_id');
    await pool.query(`ALTER TABLE ${schema.nomeTabelaSolicitacoes()} DROP CONSTRAINT ${nomeConstraint}`);
    await pool.query(
      `ALTER TABLE ${schema.nomeTabelaSolicitacoes()} ADD CONSTRAINT ${nomeConstraint} FOREIGN KEY (cotacao_frete_id) REFERENCES decoy_cotacoes_${sufixo}(id)`,
    );
    schema.resetarEsquemaGarantidoParaTestes();
    await schema.garantirEsquemaFretes();

    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportes FK Teste', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await servico.servicoCriarCotacao(
      {
        clienteOmieId: null, pedidoOmieId: null, vendedorOmieId: null, origem: 'SP', cepOrigem: null, destino: 'RJ', cepDestino: null,
        peso: 10, volumes: 1, valorMercadoria: 100, modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA',
        veiculoId: null, motoristaNome: null, custoManual: null, observacoes: null,
      },
      USUARIO_TESTE,
    );

    // Insere diretamente pelo repositório (sem passar pelo cliente n8n — seção "outbound n8n
    // não precisa ser chamado no teste de schema").
    const { criarSolicitacao } = await import('../../src/fretes/solicitacoesRepositorio.js');
    const solicitacao = await criarSolicitacao({
      cotacaoFreteId: cotacao.id,
      transportadoraId: transportadora.id,
      canal: 'EMAIL',
      codigoReferencia: `${cotacao.codigo}-teste-fk`,
      criadoPor: USUARIO_TESTE,
    });
    expect(solicitacao.id).toBeDefined();
    expect(solicitacao.cotacaoFreteId).toBe(cotacao.id);
  });

  it('cotação inexistente continua rejeitada pela FK mesmo depois da reparação (a correção não afrouxa a integridade referencial)', async () => {
    const { schema, servico } = await importarModulos();
    await schema.garantirEsquemaFretes();

    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportes FK Teste 2', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const { criarSolicitacao } = await import('../../src/fretes/solicitacoesRepositorio.js');
    await expect(
      criarSolicitacao({
        cotacaoFreteId: '99999999-9999-9999-9999-999999999999', // não existe
        transportadoraId: transportadora.id,
        canal: 'EMAIL',
        codigoReferencia: 'FRE-INEXISTENTE-teste',
        criadoPor: USUARIO_TESTE,
      }),
    ).rejects.toThrow();
  });

  it(
    'idempotência: rodar garantirEsquemaFretes() várias vezes sem corrupção nunca falha nem altera as FKs',
    async () => {
      const { schema, pool } = await importarModulos();
      await schema.garantirEsquemaFretes();
      schema.resetarEsquemaGarantidoParaTestes();
      await schema.garantirEsquemaFretes();
      schema.resetarEsquemaGarantidoParaTestes();
      await schema.garantirEsquemaFretes();

      const nomeConstraint = await buscarNomeConstraintFk(pool, schema.nomeTabelaSolicitacoes(), 'cotacao_frete_id');
      const r = await pool.query<{ tabela_referenciada: string }>(
        `SELECT rel_ref.relname AS tabela_referenciada FROM pg_constraint con
           JOIN pg_class rel_ref ON rel_ref.oid = con.confrelid
          WHERE con.conname = $1`,
        [nomeConstraint],
      );
      expect(r.rows[0]?.tabela_referenciada).toBe(schema.nomeTabelaCotacoes());
    },
    45000,
  );
});
