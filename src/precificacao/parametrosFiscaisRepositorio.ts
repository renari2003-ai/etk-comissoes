/**
 * Leitura e gravação da tabela fiscal da precificação, com histórico (data, usuário, campo,
 * valor anterior e valor novo) de toda alteração. Só toca as tabelas `precificacao_*`.
 */

import type { PoolClient } from 'pg';
import { obterPool } from '../db.js';
import { ErroConflito } from '../validacao.js';
import {
  UFS_FORA_DE_MG,
  type ExcecaoNcm,
  type IcmsUf,
  type ParametrosGerais,
  type StatusTabelaFiscal,
  type TabelaFiscal,
  type TabelaFiscalComMetadados,
} from './parametrosFiscais.js';
import {
  garantirEsquemaPrecificacao,
  nomeTabelaHistorico,
  nomeTabelaIcmsMgNcm,
  nomeTabelaIcmsUf,
  nomeTabelaParametrosFiscais,
  nomeTabelaParametrosFiscaisExtra,
} from './schema.js';

/**
 * `numeric` do Postgres chega como TEXTO pelo `pg`. Conversão central, que recusa vazio, `null` e
 * lixo — nunca um `Number('')` = 0 silencioso. Um valor inválido aqui é defeito do servidor
 * (dado corrompido), não erro do usuário: lança `Error`, que vira 500.
 */
export function numeroDoBanco(valor: unknown, campo: string): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && /^-?\d+(\.\d+)?$/.test(valor.trim())) return Number(valor);
  throw new Error(`Valor numérico inválido no banco (${campo}).`);
}

function numeroOuNullDoBanco(valor: unknown, campo: string): number | null {
  return valor === null ? null : numeroDoBanco(valor, campo);
}

interface LinhaParametros {
  pis_cofins: string;
  ir_cs: string;
  ganho_icms_na_base_pis_cofins: boolean;
  recolhimento_icms: string;
  icms_interno_mg_venda: string;
  icms_interno_mg_compra: string;
  icms_interestadual_compra: string;
  icms_importado_venda: string;
  icms_importado_compra: string;
  versao: number;
  atualizado_em: Date | null;
  atualizado_por: string | null;
}

interface LinhaExtra {
  recolhimento_icms_consumidor_final: string;
  status: string;
  status_alterado_em: Date | null;
  status_alterado_por: string | null;
}

/** Campos gerais que moram na tabela extra (25/11/2026), não na tabela de parâmetros original. */
type CampoGeralExtra = 'percentualRecolhimentoIcmsConsumidorFinal';
type CampoGeralOriginal = Exclude<keyof ParametrosGerais, CampoGeralExtra>;

/** Campo da API → coluna da tabela de parâmetros original (ordem fixa, usada no UPDATE e no histórico). */
const COLUNAS_GERAIS: ReadonlyArray<[CampoGeralOriginal, keyof LinhaParametros]> = [
  ['pisCofins', 'pis_cofins'],
  ['irCs', 'ir_cs'],
  ['ganhoIcmsNaBasePisCofins', 'ganho_icms_na_base_pis_cofins'],
  ['percentualRecolhimentoIcms', 'recolhimento_icms'],
  ['icmsInternoMgVenda', 'icms_interno_mg_venda'],
  ['icmsInternoMgCompra', 'icms_interno_mg_compra'],
  ['icmsInterestadualCompra', 'icms_interestadual_compra'],
  ['icmsImportadoVenda', 'icms_importado_venda'],
  ['icmsImportadoCompra', 'icms_importado_compra'],
];

/** Todos os campos gerais comparados no histórico, na ordem da tela. */
const CAMPOS_GERAIS: ReadonlyArray<keyof ParametrosGerais> = [...COLUNAS_GERAIS.map(([c]) => c), 'percentualRecolhimentoIcmsConsumidorFinal'];

function linhaParaGerais(l: LinhaParametros, extra: LinhaExtra): ParametrosGerais {
  const gerais = {} as Record<keyof ParametrosGerais, number | boolean>;
  for (const [campo, coluna] of COLUNAS_GERAIS) {
    gerais[campo] = campo === 'ganhoIcmsNaBasePisCofins' ? l.ganho_icms_na_base_pis_cofins : numeroDoBanco(l[coluna], coluna);
  }
  gerais.percentualRecolhimentoIcmsConsumidorFinal = numeroDoBanco(extra.recolhimento_icms_consumidor_final, 'recolhimento_icms_consumidor_final');
  return gerais as unknown as ParametrosGerais;
}

function statusDoBanco(valor: string): StatusTabelaFiscal {
  if (valor === 'PROVISORIO' || valor === 'VALIDADO') return valor;
  throw new Error('Status inválido no banco (tabela fiscal da precificação).');
}

async function lerCom(executor: Pick<PoolClient, 'query'>, travar: boolean): Promise<TabelaFiscalComMetadados> {
  const { rows: linhas } = await executor.query<LinhaParametros>(
    `SELECT * FROM ${nomeTabelaParametrosFiscais()} WHERE id = 1${travar ? ' FOR UPDATE' : ''}`,
  );
  const linha = linhas[0];
  if (linha === undefined) throw new Error('Tabela fiscal da precificação sem a linha de parâmetros (id = 1).');
  const { rows: linhasExtra } = await executor.query<LinhaExtra>(
    `SELECT * FROM ${nomeTabelaParametrosFiscaisExtra()} WHERE id = 1${travar ? ' FOR UPDATE' : ''}`,
  );
  const extra = linhasExtra[0];
  if (extra === undefined) throw new Error('Tabela fiscal da precificação sem a linha de parâmetros extras (id = 1).');

  const { rows: linhasUf } = await executor.query<{ uf: string; icms_interestadual_venda: string; aliquota_interna: string | null }>(
    `SELECT uf, icms_interestadual_venda, aliquota_interna FROM ${nomeTabelaIcmsUf()} ORDER BY uf`,
  );
  const porUf = new Map(linhasUf.map((l) => [l.uf.trim(), l]));
  const ufs: IcmsUf[] = UFS_FORA_DE_MG.map((uf) => {
    const l = porUf.get(uf);
    if (l === undefined) throw new Error(`Tabela fiscal da precificação sem a UF ${uf}.`);
    return {
      uf,
      icmsInterestadualVenda: numeroDoBanco(l.icms_interestadual_venda, `icms_interestadual_venda ${uf}`),
      aliquotaInterna: numeroOuNullDoBanco(l.aliquota_interna, `aliquota_interna ${uf}`),
    };
  });

  const { rows: linhasNcm } = await executor.query<{ ncm: string; aliquota: string }>(
    `SELECT ncm, aliquota FROM ${nomeTabelaIcmsMgNcm()} ORDER BY ncm`,
  );
  const excecoesNcm: ExcecaoNcm[] = linhasNcm.map((l) => ({ ncm: l.ncm.trim(), aliquota: numeroDoBanco(l.aliquota, `aliquota NCM ${l.ncm}`) }));

  return {
    gerais: linhaParaGerais(linha, extra),
    ufs,
    excecoesNcm,
    status: statusDoBanco(extra.status),
    statusAlteradoEm: extra.status_alterado_em === null ? null : extra.status_alterado_em.toISOString(),
    statusAlteradoPor: extra.status_alterado_por,
    versao: numeroDoBanco(linha.versao, 'versao'),
    atualizadoEm: linha.atualizado_em === null ? null : linha.atualizado_em.toISOString(),
    atualizadoPor: linha.atualizado_por,
  };
}

/**
 * Leitura num instantâneo só (REPEATABLE READ): parâmetros, status e versão vêm do mesmo momento —
 * nunca "Validado" com a versão de antes da validação (que daria 409 sem motivo aparente).
 */
export async function lerTabelaFiscal(): Promise<TabelaFiscalComMetadados> {
  await garantirEsquemaPrecificacao();
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tabela = await lerCom(cliente, false);
    await cliente.query('COMMIT');
    return tabela;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

export interface Alteracao {
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
}

const texto = (v: number | boolean | null): string | null => (v === null ? null : String(v));

/** Diferenças entre a tabela atual e a nova, campo a campo (é o que vai para o histórico). */
export function diferencas(atual: TabelaFiscal, nova: TabelaFiscal): Alteracao[] {
  const alteracoes: Alteracao[] = [];
  for (const campo of CAMPOS_GERAIS) {
    if (atual.gerais[campo] !== nova.gerais[campo]) {
      alteracoes.push({ campo: `gerais.${campo}`, valorAnterior: texto(atual.gerais[campo]), valorNovo: texto(nova.gerais[campo]) });
    }
  }
  const ufsAtuais = new Map(atual.ufs.map((u) => [u.uf, u]));
  for (const u of nova.ufs) {
    const a = ufsAtuais.get(u.uf);
    if (a === undefined) continue;
    if (a.icmsInterestadualVenda !== u.icmsInterestadualVenda) {
      alteracoes.push({ campo: `uf.${u.uf}.icmsInterestadualVenda`, valorAnterior: texto(a.icmsInterestadualVenda), valorNovo: texto(u.icmsInterestadualVenda) });
    }
    if (a.aliquotaInterna !== u.aliquotaInterna) {
      alteracoes.push({ campo: `uf.${u.uf}.aliquotaInterna`, valorAnterior: texto(a.aliquotaInterna), valorNovo: texto(u.aliquotaInterna) });
    }
  }
  const ncmAtuais = new Map(atual.excecoesNcm.map((e) => [e.ncm, e.aliquota]));
  const ncmNovos = new Map(nova.excecoesNcm.map((e) => [e.ncm, e.aliquota]));
  for (const [ncm, aliquota] of ncmNovos) {
    const anterior = ncmAtuais.get(ncm);
    if (anterior !== aliquota) alteracoes.push({ campo: `ncm.${ncm}`, valorAnterior: texto(anterior ?? null), valorNovo: texto(aliquota) });
  }
  for (const [ncm, aliquota] of ncmAtuais) {
    if (!ncmNovos.has(ncm)) alteracoes.push({ campo: `ncm.${ncm}`, valorAnterior: texto(aliquota), valorNovo: null });
  }
  return alteracoes;
}

/**
 * Grava a tabela inteira numa transação e registra cada campo alterado no histórico. Sem alteração,
 * não grava nada.
 *
 * Concorrência otimista: o PUT manda a tabela INTEIRA, montada a partir do que o admin leu. A linha
 * de parâmetros é travada (FOR UPDATE) e a `versao` lida é comparada com a atual — se outro admin
 * salvou nesse meio-tempo, responde 409 em vez de desfazer em silêncio a alteração dele.
 */
export async function atualizarTabelaFiscal(nova: TabelaFiscal, versaoLida: number, usuario: { id: string; nome: string }): Promise<{ tabela: TabelaFiscalComMetadados; alteracoes: Alteracao[] }> {
  await garantirEsquemaPrecificacao();
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN');
    const atual = await lerCom(cliente, true);
    if (atual.versao !== versaoLida) throw new ErroConflito(mensagemConflito(atual));
    const alteracoes = diferencas(atual, nova);
    // Tabela "Validada" que é editada volta sozinha para "Provisório" (decisão conservadora de
    // 25/11/2026): um valor novo nunca foi validado pelo fiscal, então a tarja azul volta.
    if (alteracoes.length > 0 && atual.status === 'VALIDADO') {
      await cliente.query(
        `UPDATE ${nomeTabelaParametrosFiscaisExtra()} SET status = 'PROVISORIO', status_alterado_em = now(), status_alterado_por = $1 WHERE id = 1`,
        [usuario.nome],
      );
      alteracoes.push({ campo: CAMPO_STATUS, valorAnterior: 'VALIDADO', valorNovo: 'PROVISORIO' });
    }
    if (alteracoes.length > 0) {
      const sets = COLUNAS_GERAIS.map(([, coluna], i) => `${coluna} = $${i + 1}`).join(', ');
      await cliente.query(
        `UPDATE ${nomeTabelaParametrosFiscais()} SET ${sets}, versao = versao + 1, atualizado_em = now(), atualizado_por = $${COLUNAS_GERAIS.length + 1} WHERE id = 1`,
        [...COLUNAS_GERAIS.map(([campo]) => nova.gerais[campo]), usuario.nome],
      );
      await cliente.query(`UPDATE ${nomeTabelaParametrosFiscaisExtra()} SET recolhimento_icms_consumidor_final = $1 WHERE id = 1`, [
        nova.gerais.percentualRecolhimentoIcmsConsumidorFinal,
      ]);
      for (const u of nova.ufs) {
        await cliente.query(`UPDATE ${nomeTabelaIcmsUf()} SET icms_interestadual_venda = $1, aliquota_interna = $2 WHERE uf = $3`, [
          u.icmsInterestadualVenda,
          u.aliquotaInterna,
          u.uf,
        ]);
      }
      const ncms = nova.excecoesNcm.map((e) => e.ncm);
      await cliente.query(`DELETE FROM ${nomeTabelaIcmsMgNcm()} WHERE NOT (ncm = ANY($1::char(8)[]))`, [ncms]);
      if (ncms.length > 0) {
        await cliente.query(
          `INSERT INTO ${nomeTabelaIcmsMgNcm()} (ncm, aliquota)
           SELECT * FROM UNNEST($1::char(8)[], $2::numeric[])
           ON CONFLICT (ncm) DO UPDATE SET aliquota = EXCLUDED.aliquota`,
          [ncms, nova.excecoesNcm.map((e) => e.aliquota)],
        );
      }
      await cliente.query(
        `INSERT INTO ${nomeTabelaHistorico()} (usuario_id, usuario_nome, campo, valor_anterior, valor_novo)
         SELECT $1, $2, * FROM UNNEST($3::text[], $4::text[], $5::text[])`,
        [usuario.id, usuario.nome, alteracoes.map((a) => a.campo), alteracoes.map((a) => a.valorAnterior), alteracoes.map((a) => a.valorNovo)],
      );
    }
    const tabela = await lerCom(cliente, false);
    await cliente.query('COMMIT');
    return { tabela, alteracoes };
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

function mensagemConflito(atual: TabelaFiscalComMetadados): string {
  const quando = atual.atualizadoEm === null ? '' : ` em ${new Date(atual.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
  return `A tabela fiscal foi alterada por ${atual.atualizadoPor ?? 'outro usuário'}${quando} depois que você abriu a tela. Recarregue e refaça a sua alteração.`;
}

/** Campo do histórico usado para o status (Provisório / Validado pelo fiscal). */
export const CAMPO_STATUS = 'status';

/**
 * Muda o status "Provisório / Validado pelo fiscal" (só administrador; a rota confere). Usa a mesma
 * `versao` da tabela (concorrência otimista: 409 se outro admin salvou depois da leitura) e grava a
 * mudança no histórico. Mesmo status: não grava nada.
 */
export async function atualizarStatusTabelaFiscal(
  status: StatusTabelaFiscal,
  versaoLida: number,
  usuario: { id: string; nome: string },
): Promise<{ tabela: TabelaFiscalComMetadados; alterou: boolean }> {
  await garantirEsquemaPrecificacao();
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN');
    const atual = await lerCom(cliente, true);
    if (atual.versao !== versaoLida) throw new ErroConflito(mensagemConflito(atual));
    const alterou = atual.status !== status;
    if (alterou) {
      await cliente.query(
        `UPDATE ${nomeTabelaParametrosFiscaisExtra()} SET status = $1, status_alterado_em = now(), status_alterado_por = $2 WHERE id = 1`,
        [status, usuario.nome],
      );
      await cliente.query(
        `UPDATE ${nomeTabelaParametrosFiscais()} SET versao = versao + 1, atualizado_em = now(), atualizado_por = $1 WHERE id = 1`,
        [usuario.nome],
      );
      await cliente.query(
        `INSERT INTO ${nomeTabelaHistorico()} (usuario_id, usuario_nome, campo, valor_anterior, valor_novo) VALUES ($1, $2, $3, $4, $5)`,
        [usuario.id, usuario.nome, CAMPO_STATUS, atual.status, status],
      );
    }
    const tabela = await lerCom(cliente, false);
    await cliente.query('COMMIT');
    return { tabela, alterou };
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

export interface RegistroHistorico extends Alteracao {
  alteradoEm: string;
  usuarioId: string;
  usuarioNome: string;
}

export async function listarHistorico(limite: number): Promise<RegistroHistorico[]> {
  await garantirEsquemaPrecificacao();
  const { rows } = await obterPool().query<{ alterado_em: Date; usuario_id: string; usuario_nome: string; campo: string; valor_anterior: string | null; valor_novo: string | null }>(
    `SELECT alterado_em, usuario_id, usuario_nome, campo, valor_anterior, valor_novo FROM ${nomeTabelaHistorico()} ORDER BY alterado_em DESC, id DESC LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({
    alteradoEm: r.alterado_em.toISOString(),
    usuarioId: r.usuario_id,
    usuarioNome: r.usuario_nome,
    campo: r.campo,
    valorAnterior: r.valor_anterior,
    valorNovo: r.valor_novo,
  }));
}
