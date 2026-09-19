import { obterPool } from '../db.js';
import { garantirEsquemaFretes, nomeTabelaParametrosFiscais } from './schema.js';
import type { ParametrosFiscaisFrete } from './tipos.js';

/** Linha única (singleton) — sempre a mesma id, nunca uma segunda linha (ver `atualizarParametrosFiscais`). */
const ID_SINGLETON = '00000000-0000-0000-0000-000000000001';

interface LinhaParametrosFiscais {
  id: string;
  pis_percentual: string | null;
  cofins_percentual: string | null;
  icms_percentual: string | null;
  atualizado_por: string | null;
  atualizado_em: Date;
}

function numeroOuNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function linhaParaParametros(l: LinhaParametrosFiscais): ParametrosFiscaisFrete {
  return {
    pisPercentual: numeroOuNull(l.pis_percentual),
    cofinsPercentual: numeroOuNull(l.cofins_percentual),
    icmsPercentual: numeroOuNull(l.icms_percentual),
    atualizadoPor: l.atualizado_por,
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

/** Antes de qualquer configuração, todos os percentuais são `null` (nunca um valor inventado — ver `calculoFiscal.ts`). */
export async function buscarParametrosFiscais(): Promise<ParametrosFiscaisFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaParametrosFiscais>(`SELECT * FROM ${nomeTabelaParametrosFiscais()} WHERE id = $1`, [ID_SINGLETON]);
  const linha = rows[0];
  if (linha === undefined) return { pisPercentual: null, cofinsPercentual: null, icmsPercentual: null, atualizadoPor: null, atualizadoEm: null };
  return linhaParaParametros(linha);
}

export interface DadosParametrosFiscais {
  pisPercentual: number | null;
  cofinsPercentual: number | null;
  icmsPercentual: number | null;
}

export async function atualizarParametrosFiscais(dados: DadosParametrosFiscais, usuarioId: string): Promise<ParametrosFiscaisFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaParametrosFiscais>(
    `INSERT INTO ${nomeTabelaParametrosFiscais()} (id, pis_percentual, cofins_percentual, icms_percentual, atualizado_por, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       pis_percentual = EXCLUDED.pis_percentual,
       cofins_percentual = EXCLUDED.cofins_percentual,
       icms_percentual = EXCLUDED.icms_percentual,
       atualizado_por = EXCLUDED.atualizado_por,
       atualizado_em = now()
     RETURNING *`,
    [ID_SINGLETON, dados.pisPercentual, dados.cofinsPercentual, dados.icmsPercentual, usuarioId],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao salvar parâmetros fiscais.');
  return linhaParaParametros(linha);
}
