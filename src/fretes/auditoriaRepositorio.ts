import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { obterPool } from '../db.js';
import { garantirEsquemaFretes, nomeTabelaAuditoria } from './schema.js';
import type { AcaoAuditoriaFrete, RegistroAuditoriaFrete } from './tipos.js';

interface LinhaAuditoria {
  id: string;
  usuario_id: string | null;
  acao: AcaoAuditoriaFrete;
  entidade: string;
  entidade_id: string | null;
  valor_anterior: unknown;
  valor_novo: unknown;
  criado_em: Date;
  origem: string;
}

function linhaParaRegistro(l: LinhaAuditoria): RegistroAuditoriaFrete {
  return {
    id: l.id,
    usuarioId: l.usuario_id,
    acao: l.acao,
    entidade: l.entidade,
    entidadeId: l.entidade_id,
    valorAnterior: l.valor_anterior,
    valorNovo: l.valor_novo,
    criadoEm: l.criado_em.toISOString(),
    origem: l.origem,
  };
}

export interface DadosRegistroAuditoria {
  /** `null` só em eventos de origem máquina (webhook Fase 4A.1) — ver `origem`. */
  usuarioId: string | null;
  acao: AcaoAuditoriaFrete;
  entidade: string;
  entidadeId: string | null;
  valorAnterior?: unknown;
  valorNovo?: unknown;
  /** Fase 4A.1 — `'webhook_n8n'` nos eventos automáticos; default `'sistema'` (mesmo default de sempre) quando omitido. */
  origem?: string;
}

/**
 * Registra uma ação de auditoria do módulo de Fretes (seção 13) — estrutura própria,
 * isolada do resto do sistema (não existe um mecanismo de auditoria genérico
 * reutilizável hoje no projeto, ver auditoria da Fase 1). Aceita um `PoolClient` opcional
 * para ser chamado dentro da MESMA transação de uma operação crítica (ex.: fechamento),
 * garantindo que o registro de auditoria nunca fique dessincronizado da ação que descreve.
 */
export async function registrarAuditoria(dados: DadosRegistroAuditoria, cliente?: PoolClient): Promise<void> {
  await garantirEsquemaFretes();
  const executor = cliente ?? obterPool();
  await executor.query(
    `INSERT INTO ${nomeTabelaAuditoria()} (id, usuario_id, acao, entidade, entidade_id, valor_anterior, valor_novo, origem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      dados.usuarioId,
      dados.acao,
      dados.entidade,
      dados.entidadeId,
      dados.valorAnterior !== undefined ? JSON.stringify(dados.valorAnterior) : null,
      dados.valorNovo !== undefined ? JSON.stringify(dados.valorNovo) : null,
      dados.origem ?? 'sistema',
    ],
  );
}

export async function listarAuditoriaPorEntidade(entidade: string, entidadeId: string): Promise<RegistroAuditoriaFrete[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaAuditoria>(
    `SELECT * FROM ${nomeTabelaAuditoria()} WHERE entidade = $1 AND entidade_id = $2 ORDER BY criado_em DESC`,
    [entidade, entidadeId],
  );
  return rows.map(linhaParaRegistro);
}
