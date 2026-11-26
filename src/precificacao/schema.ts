/**
 * Tabelas da formação de preço. Regra autorizada em 2026-11-24 (o Preview usa o MESMO banco da
 * produção): só `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` de tabelas NOVAS com
 * prefixo `precificacao_` — nunca `ALTER`/`DROP` nem qualquer toque em tabela existente. O prefixo
 * é exigido até nos nomes de teste (sobrescritos por variável de ambiente), para um nome errado
 * nunca apontar para uma tabela de outro módulo.
 *
 * Os valores iniciais entram com `INSERT ... ON CONFLICT DO NOTHING`: só na primeira vez, nunca
 * sobrescrevendo o que o administrador já editou.
 */

import { executarDdlIdempotente, obterPool } from '../db.js';
import { ALIQUOTAS_INTERNAS_INICIAIS, FONTE_ALIQUOTAS_INTERNAS, PARAMETROS_GERAIS_INICIAIS, UFS_INICIAIS } from './parametrosFiscais.js';

function nomeValidado(nome: string): string {
  if (!/^precificacao_[a-z0-9_]+$/.test(nome)) {
    throw new Error(`Nome de tabela da precificação inválido (precisa começar com "precificacao_"): "${nome}"`);
  }
  return nome;
}

export function nomeTabelaParametrosFiscais(): string {
  return nomeValidado(process.env.PRECIFICACAO_PARAMETROS_TABELA ?? 'precificacao_parametros_fiscais');
}
export function nomeTabelaIcmsUf(): string {
  return nomeValidado(process.env.PRECIFICACAO_ICMS_UF_TABELA ?? 'precificacao_icms_uf');
}
export function nomeTabelaIcmsMgNcm(): string {
  return nomeValidado(process.env.PRECIFICACAO_ICMS_MG_NCM_TABELA ?? 'precificacao_icms_mg_ncm');
}
/**
 * Parâmetros fiscais acrescentados em 25/11/2026 (respostas do fiscal) numa tabela NOVA, porque a
 * tabela de parâmetros já existe no banco da produção e não recebe ALTER: % de recolhimento do ICMS
 * na venda a não contribuinte/consumidor final e o status "Provisório / Validado pelo fiscal".
 */
export function nomeTabelaParametrosFiscaisExtra(): string {
  return nomeValidado(process.env.PRECIFICACAO_PARAMETROS_EXTRA_TABELA ?? 'precificacao_parametros_fiscais_extra');
}
/** IPI por NCM (26/11/2026): o cadastro do Omie não tem alíquota de IPI. Parte da tabela fiscal (mesma versão e histórico). */
export function nomeTabelaIpiNcm(): string {
  return nomeValidado(process.env.PRECIFICACAO_IPI_NCM_TABELA ?? 'precificacao_ipi_ncm');
}
export function nomeTabelaHistorico(): string {
  return nomeValidado(process.env.PRECIFICACAO_HISTORICO_TABELA ?? 'precificacao_parametros_historico');
}
/** Custos manuais (etapa 3) — nunca gravados no Omie. */
export function nomeTabelaCustosManuais(): string {
  return nomeValidado(process.env.PRECIFICACAO_CUSTOS_MANUAIS_TABELA ?? 'precificacao_custos_manuais');
}
export function nomeTabelaCustosManuaisHistorico(): string {
  return nomeValidado(process.env.PRECIFICACAO_CUSTOS_MANUAIS_HISTORICO_TABELA ?? 'precificacao_custos_manuais_historico');
}

let esquemaGarantido: Promise<void> | null = null;

/** Idempotente e cacheado por processo. Se falhar, a próxima chamada tenta de novo. */
export function garantirEsquemaPrecificacao(): Promise<void> {
  esquemaGarantido ??= criarEsquema().catch((erro: unknown) => {
    esquemaGarantido = null;
    throw erro;
  });
  return esquemaGarantido;
}

async function criarEsquema(): Promise<void> {
  const parametros = nomeTabelaParametrosFiscais();
  const ufs = nomeTabelaIcmsUf();
  const ncm = nomeTabelaIcmsMgNcm();
  const historico = nomeTabelaHistorico();

  await executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${parametros} (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      pis_cofins NUMERIC(7,4) NOT NULL,
      ir_cs NUMERIC(7,4) NOT NULL,
      ganho_icms_na_base_pis_cofins BOOLEAN NOT NULL,
      recolhimento_icms NUMERIC(7,4) NOT NULL,
      recolhimento_icms_mg_nao_contribuinte NUMERIC(7,4) NOT NULL,
      icms_interno_mg_venda NUMERIC(7,4) NOT NULL,
      icms_interno_mg_compra NUMERIC(7,4) NOT NULL,
      icms_interestadual_compra NUMERIC(7,4) NOT NULL,
      icms_importado_venda NUMERIC(7,4) NOT NULL,
      icms_importado_compra NUMERIC(7,4) NOT NULL,
      versao INTEGER NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMPTZ NULL,
      atualizado_por TEXT NULL
    )
  `);
  await executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${ufs} (
      uf CHAR(2) PRIMARY KEY,
      icms_interestadual_venda NUMERIC(7,4) NOT NULL,
      aliquota_interna NUMERIC(7,4) NULL
    )
  `);
  await executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${ncm} (
      ncm CHAR(8) PRIMARY KEY,
      aliquota NUMERIC(7,4) NOT NULL
    )
  `);
  await executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${historico} (
      id BIGSERIAL PRIMARY KEY,
      alterado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      usuario_id TEXT NOT NULL,
      usuario_nome TEXT NOT NULL,
      campo TEXT NOT NULL,
      valor_anterior TEXT NULL,
      valor_novo TEXT NULL
    )
  `);
  await executarDdlIdempotente(`CREATE INDEX IF NOT EXISTS ${historico}_alterado_em_idx ON ${historico} (alterado_em DESC)`);

  // Etapa 3 — custos manuais e histórico (tabelas novas; nada de ALTER em tabela existente).
  const custos = nomeTabelaCustosManuais();
  const custosHistorico = nomeTabelaCustosManuaisHistorico();
  await executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${custos} (
      codigo TEXT PRIMARY KEY,
      valor_nota NUMERIC(18,6) NULL CHECK (valor_nota IS NULL OR valor_nota > 0),
      uf_fornecedor CHAR(2) NOT NULL,
      diferimento_pta BOOLEAN NOT NULL,
      mercadoria_importada BOOLEAN NOT NULL,
      tipo_fornecedor TEXT NOT NULL CHECK (tipo_fornecedor IN ('INDUSTRIA_NORMAL', 'SIMPLES_NACIONAL', 'COMERCIO')),
      ipi_percentual NUMERIC(7,4) NULL CHECK (ipi_percentual IS NULL OR (ipi_percentual >= 0 AND ipi_percentual < 100)),
      versao INTEGER NOT NULL DEFAULT 1,
      -- Remoção lógica: a linha fica (com a versão), para a versão nunca recomeçar em 1 numa nova
      -- inclusão do mesmo código — senão uma tela aberta antes da remoção gravaria por cima.
      removido BOOLEAN NOT NULL DEFAULT false,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_por_id TEXT NOT NULL,
      atualizado_por_nome TEXT NOT NULL
    )
  `);
  await executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${custosHistorico} (
      id BIGSERIAL PRIMARY KEY,
      alterado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      usuario_id TEXT NOT NULL,
      usuario_nome TEXT NOT NULL,
      codigo TEXT NOT NULL,
      campo TEXT NOT NULL,
      valor_anterior TEXT NULL,
      valor_novo TEXT NULL
    )
  `);
  await executarDdlIdempotente(`CREATE INDEX IF NOT EXISTS ${custosHistorico}_codigo_idx ON ${custosHistorico} (codigo, alterado_em DESC)`);
  await executarDdlIdempotente(`CREATE INDEX IF NOT EXISTS ${custosHistorico}_alterado_em_idx ON ${custosHistorico} (alterado_em DESC)`);

  // 25/11/2026 — parâmetros novos do fiscal (tabela nova; nada de ALTER em tabela existente).
  const extra = nomeTabelaParametrosFiscaisExtra();
  await executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${extra} (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      recolhimento_icms_consumidor_final NUMERIC(7,4) NOT NULL CHECK (recolhimento_icms_consumidor_final >= 0 AND recolhimento_icms_consumidor_final <= 100),
      status TEXT NOT NULL CHECK (status IN ('PROVISORIO', 'VALIDADO')),
      status_alterado_em TIMESTAMPTZ NULL,
      status_alterado_por TEXT NULL
    )
  `);

  // 26/11/2026 — IPI por NCM (tabela nova, começa vazia: "a confirmar pelo fiscal").
  await executarDdlIdempotente(`
    CREATE TABLE IF NOT EXISTS ${nomeTabelaIpiNcm()} (
      ncm CHAR(8) PRIMARY KEY,
      aliquota NUMERIC(7,4) NOT NULL CHECK (aliquota >= 0 AND aliquota < 100)
    )
  `);

  const pool = obterPool();
  const g = PARAMETROS_GERAIS_INICIAIS;
  await pool.query(
    `INSERT INTO ${parametros} (id, pis_cofins, ir_cs, ganho_icms_na_base_pis_cofins, recolhimento_icms,
       recolhimento_icms_mg_nao_contribuinte, icms_interno_mg_venda, icms_interno_mg_compra,
       icms_interestadual_compra, icms_importado_venda, icms_importado_compra)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [
      g.pisCofins,
      g.irCs,
      g.ganhoIcmsNaBasePisCofins,
      g.percentualRecolhimentoIcms,
      // Coluna antiga, sem uso desde 25/11/2026 (o recolhimento a consumidor final mora na tabela extra).
      0,
      g.icmsInternoMgVenda,
      g.icmsInternoMgCompra,
      g.icmsInterestadualCompra,
      g.icmsImportadoVenda,
      g.icmsImportadoCompra,
    ],
  );
  await pool.query(
    `INSERT INTO ${ufs} (uf, icms_interestadual_venda, aliquota_interna)
     SELECT * FROM UNNEST($1::char(2)[], $2::numeric[], $3::numeric[])
     ON CONFLICT (uf) DO NOTHING`,
    [UFS_INICIAIS.map((u) => u.uf), UFS_INICIAIS.map((u) => u.icmsInterestadualVenda), UFS_INICIAIS.map((u) => u.aliquotaInterna)],
  );

  // Primeira vez da tabela extra: nasce "Provisório", com 100% de recolhimento a consumidor final, e
  // preenche as alíquotas internas que estão VAZIAS (nunca sobrescreve o que o administrador editou),
  // com uma linha de histórico por UF dizendo a fonte. Numa transação: ou faz tudo, ou nada.
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rowCount } = await cliente.query(
      `INSERT INTO ${extra} (id, recolhimento_icms_consumidor_final, status) VALUES (1, $1, 'PROVISORIO') ON CONFLICT (id) DO NOTHING`,
      [g.percentualRecolhimentoIcmsConsumidorFinal],
    );
    if (rowCount === 1) {
      const ufsIniciais = Object.keys(ALIQUOTAS_INTERNAS_INICIAIS) as Array<keyof typeof ALIQUOTAS_INTERNAS_INICIAIS>;
      const { rows } = await cliente.query<{ uf: string; aliquota_interna: string }>(
        `UPDATE ${ufs} AS t SET aliquota_interna = v.aliquota
         FROM UNNEST($1::char(2)[], $2::numeric[]) AS v(uf, aliquota)
         WHERE t.uf = v.uf AND t.aliquota_interna IS NULL
         RETURNING t.uf, t.aliquota_interna`,
        [ufsIniciais, ufsIniciais.map((uf) => ALIQUOTAS_INTERNAS_INICIAIS[uf])],
      );
      if (rows.length > 0) {
        await cliente.query(
          `INSERT INTO ${historico} (usuario_id, usuario_nome, campo, valor_anterior, valor_novo)
           SELECT 'sistema', $1, campo, NULL, valor FROM UNNEST($2::text[], $3::text[]) AS v(campo, valor)`,
          [FONTE_ALIQUOTAS_INTERNAS, rows.map((r) => `uf.${r.uf.trim()}.aliquotaInterna`), rows.map((r) => String(Number(r.aliquota_interna)))],
        );
      }
    }
    await cliente.query('COMMIT');
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}
