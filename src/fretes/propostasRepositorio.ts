import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { garantirEsquemaFretes, nomeTabelaPropostas } from './schema.js';
import type { CanalOrigemProposta, PropostaFrete, StatusProposta, StatusRevisaoProposta } from './tipos.js';

interface LinhaProposta {
  id: string;
  cotacao_id: string;
  transportadora_id: string;
  solicitacao_id: string | null;
  valor_custo: string;
  prazo_dias: number | null;
  validade: Date | null;
  peso: string | null;
  volumes: number | null;
  origem: string | null;
  destino: string | null;
  tipo_servico: string | null;
  observacoes: string | null;
  origem_proposta: string;
  mensagem_original: string | null;
  anexo_url: string | null;
  status: StatusProposta;
  confianca: string | null;
  requer_revisao: boolean;
  selecionada: boolean;
  status_revisao: StatusRevisaoProposta;
  criado_em: Date;
  atualizado_em: Date;
}

function numeroOuNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function linhaParaProposta(l: LinhaProposta): PropostaFrete {
  return {
    id: l.id,
    cotacaoId: l.cotacao_id,
    transportadoraId: l.transportadora_id,
    solicitacaoId: l.solicitacao_id,
    valorCusto: Number(l.valor_custo),
    prazoDias: l.prazo_dias,
    validade: l.validade === null ? null : l.validade.toISOString().slice(0, 10),
    peso: numeroOuNull(l.peso),
    volumes: l.volumes,
    origem: l.origem,
    destino: l.destino,
    tipoServico: l.tipo_servico,
    observacoes: l.observacoes,
    origemProposta: l.origem_proposta,
    mensagemOriginal: l.mensagem_original,
    anexoUrl: l.anexo_url,
    status: l.status,
    confianca: numeroOuNull(l.confianca),
    requerRevisao: l.requer_revisao,
    selecionada: l.selecionada,
    statusRevisao: l.status_revisao,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

export interface DadosNovaProposta {
  cotacaoId: string;
  transportadoraId: string;
  valorCusto: number;
  prazoDias: number | null;
  validade: string | null;
  peso: number | null;
  volumes: number | null;
  origem: string | null;
  destino: string | null;
  tipoServico: string | null;
  observacoes: string | null;
}

export async function criarProposta(dados: DadosNovaProposta): Promise<PropostaFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const { rows } = await pool.query<LinhaProposta>(
    `INSERT INTO ${nomeTabelaPropostas()}
       (id, cotacao_id, transportadora_id, valor_custo, prazo_dias, validade, peso, volumes, origem, destino,
        tipo_servico, observacoes, origem_proposta, status, requer_revisao, selecionada)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'MANUAL', 'RECEBIDA', false, false)
     RETURNING *`,
    [
      id,
      dados.cotacaoId,
      dados.transportadoraId,
      dados.valorCusto,
      dados.prazoDias,
      dados.validade,
      dados.peso,
      dados.volumes,
      dados.origem,
      dados.destino,
      dados.tipoServico,
      dados.observacoes,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao criar proposta.');
  return linhaParaProposta(linha);
}

export async function listarPropostasPorCotacao(cotacaoId: string): Promise<PropostaFrete[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaProposta>(
    `SELECT * FROM ${nomeTabelaPropostas()} WHERE cotacao_id = $1 ORDER BY valor_custo ASC`,
    [cotacaoId],
  );
  return rows.map(linhaParaProposta);
}

export async function buscarPropostaPorId(id: string): Promise<PropostaFrete | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaProposta>(`SELECT * FROM ${nomeTabelaPropostas()} WHERE id = $1`, [id]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaProposta(linha);
}

export async function atualizarStatusProposta(id: string, status: StatusProposta): Promise<PropostaFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaProposta>(
    `UPDATE ${nomeTabelaPropostas()} SET status = $1, atualizado_em = now() WHERE id = $2 RETURNING *`,
    [status, id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Proposta não encontrada.');
  return linhaParaProposta(linha);
}

/** Fase 4A.6 — transição da trilha de revisão Logística → Vendedor (ver `StatusRevisaoProposta`, independente de `atualizarStatusProposta` acima). */
export async function atualizarStatusRevisaoProposta(id: string, statusRevisao: StatusRevisaoProposta): Promise<PropostaFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaProposta>(
    `UPDATE ${nomeTabelaPropostas()} SET status_revisao = $1, atualizado_em = now() WHERE id = $2 RETURNING *`,
    [statusRevisao, id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Proposta não encontrada.');
  return linhaParaProposta(linha);
}

/** Fase 4A.6 — usado pelas Centrais da Logística/Vendedor (cross-cotação, ao contrário de `listarPropostasPorCotacao`). */
export async function listarPropostasPorStatusRevisao(status: readonly StatusRevisaoProposta[]): Promise<PropostaFrete[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaProposta>(
    `SELECT * FROM ${nomeTabelaPropostas()} WHERE status_revisao = ANY($1) ORDER BY criado_em ASC`,
    [status],
  );
  return rows.map(linhaParaProposta);
}

/**
 * Marca `propostaId` como selecionada e desmarca todas as outras propostas da MESMA
 * cotação, dentro de uma única transação (seção 26: "as demais devem deixar de ser
 * selecionadas, respeitando a integridade transacional"). Recebe um `PoolClient` já em
 * transação quando chamado por `fretesServico.ts` (que também precisa travar a cotação);
 * abre a própria transação quando chamado isoladamente (ex.: nos testes deste repositório).
 */
export async function selecionarPropostaTransacional(
  cotacaoId: string,
  propostaId: string,
  cliente?: PoolClient,
): Promise<PropostaFrete> {
  await garantirEsquemaFretes();
  const executor = cliente ?? (await obterPool().connect());
  const precisaGerenciarTransacao = cliente === undefined;
  try {
    if (precisaGerenciarTransacao) await executor.query('BEGIN');

    await executor.query(
      `UPDATE ${nomeTabelaPropostas()} SET selecionada = false, status = CASE WHEN status = 'SELECIONADA' THEN 'EM_ANALISE' ELSE status END, atualizado_em = now()
       WHERE cotacao_id = $1 AND id != $2`,
      [cotacaoId, propostaId],
    );
    const { rows } = await executor.query<LinhaProposta>(
      `UPDATE ${nomeTabelaPropostas()} SET selecionada = true, status = 'SELECIONADA', atualizado_em = now()
       WHERE id = $1 AND cotacao_id = $2
       RETURNING *`,
      [propostaId, cotacaoId],
    );
    const linha = rows[0];
    if (linha === undefined) throw new ErroValidacao('Proposta não encontrada nesta cotação.');

    if (precisaGerenciarTransacao) await executor.query('COMMIT');
    return linhaParaProposta(linha);
  } catch (erro) {
    if (precisaGerenciarTransacao) await executor.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    if (precisaGerenciarTransacao) executor.release();
  }
}

// --- Fase 4A.1 — propostas nascidas de uma resposta automática (e-mail/WhatsApp/API) -----

export interface DadosPropostaAutomatica {
  cotacaoId: string;
  transportadoraId: string;
  solicitacaoId: string;
  valorCusto: number;
  prazoDias: number | null;
  validade: string | null;
  observacoes: string | null;
  canal: CanalOrigemProposta;
  mensagemOriginal: string | null;
  confianca: number | null;
  requerRevisao: boolean;
}

/**
 * Nasce SEMPRE com `status = 'PENDENTE_VALIDACAO'` (seção 7) — nunca `'RECEBIDA'` (que
 * tornaria a proposta imediatamente selecionável). Só sai desse status por ação humana
 * explícita (`confirmarPropostaValidada`), mesmo que `confianca` venha altíssima da
 * extração (seção 38: confiança da IA nunca decide sozinha).
 */
export async function criarPropostaAutomatica(dados: DadosPropostaAutomatica): Promise<PropostaFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const { rows } = await pool.query<LinhaProposta>(
    `INSERT INTO ${nomeTabelaPropostas()}
       (id, cotacao_id, transportadora_id, solicitacao_id, valor_custo, prazo_dias, validade, observacoes,
        origem_proposta, mensagem_original, status, confianca, requer_revisao, selecionada)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDENTE_VALIDACAO', $11, $12, false)
     RETURNING *`,
    [
      id,
      dados.cotacaoId,
      dados.transportadoraId,
      dados.solicitacaoId,
      dados.valorCusto,
      dados.prazoDias,
      dados.validade,
      dados.observacoes,
      dados.canal,
      dados.mensagemOriginal,
      dados.confianca,
      dados.requerRevisao,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao criar proposta automática.');
  return linhaParaProposta(linha);
}

export interface CorrecaoPropostaPendente {
  valorCusto?: number;
  prazoDias?: number | null;
  validade?: string | null;
  observacoes?: string | null;
  tipoServico?: string | null;
}

/**
 * Ação humana que tira a proposta de `PENDENTE_VALIDACAO` (seção 17) — sempre para
 * `'RECEBIDA'`, o MESMO status inicial de uma proposta manual (Fase 1): a partir daqui ela
 * segue o fluxo já existente de comparação/seleção/fechamento sem nenhuma regra nova.
 */
export async function confirmarPropostaPendente(id: string, correcao: CorrecaoPropostaPendente): Promise<PropostaFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaProposta>(
    `UPDATE ${nomeTabelaPropostas()}
        SET valor_custo = COALESCE($1, valor_custo),
            prazo_dias = CASE WHEN $2 THEN $3 ELSE prazo_dias END,
            validade = CASE WHEN $4 THEN $5 ELSE validade END,
            observacoes = CASE WHEN $6 THEN $7 ELSE observacoes END,
            tipo_servico = CASE WHEN $8 THEN $9 ELSE tipo_servico END,
            status = 'RECEBIDA', requer_revisao = false, atualizado_em = now()
      WHERE id = $10 AND status = 'PENDENTE_VALIDACAO'
      RETURNING *`,
    [
      correcao.valorCusto ?? null,
      correcao.prazoDias !== undefined,
      correcao.prazoDias ?? null,
      correcao.validade !== undefined,
      correcao.validade ?? null,
      correcao.observacoes !== undefined,
      correcao.observacoes ?? null,
      correcao.tipoServico !== undefined,
      correcao.tipoServico ?? null,
      id,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Proposta pendente de validação não encontrada (ou já validada/rejeitada).');
  return linhaParaProposta(linha);
}

export async function listarPropostasPorStatus(status: StatusProposta): Promise<PropostaFrete[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaProposta>(
    `SELECT * FROM ${nomeTabelaPropostas()} WHERE status = $1 ORDER BY criado_em ASC`,
    [status],
  );
  return rows.map(linhaParaProposta);
}
