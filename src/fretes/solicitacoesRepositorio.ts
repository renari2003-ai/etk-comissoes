import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { garantirEsquemaFretes, nomeTabelaSolicitacoes } from './schema.js';
import type { CanalOrigemProposta, EmailOrigem, SolicitacaoCotacao, StatusSolicitacaoCotacao } from './tipos.js';

interface LinhaSolicitacao {
  id: string;
  cotacao_frete_id: string;
  transportadora_id: string;
  canal: CanalOrigemProposta;
  status: StatusSolicitacaoCotacao;
  codigo_referencia: string;
  data_envio: Date | null;
  data_resposta: Date | null;
  identificador_externo: string | null;
  tentativas: number;
  erro_ultima_tentativa: string | null;
  email_destino: string | null;
  email_origem: EmailOrigem | null;
  criado_por: string;
  criado_em: Date;
  atualizado_em: Date;
}

function linhaParaSolicitacao(l: LinhaSolicitacao): SolicitacaoCotacao {
  return {
    id: l.id,
    cotacaoFreteId: l.cotacao_frete_id,
    transportadoraId: l.transportadora_id,
    canal: l.canal,
    status: l.status,
    codigoReferencia: l.codigo_referencia,
    dataEnvio: l.data_envio === null ? null : l.data_envio.toISOString(),
    dataResposta: l.data_resposta === null ? null : l.data_resposta.toISOString(),
    identificadorExterno: l.identificador_externo,
    tentativas: l.tentativas,
    erroUltimaTentativa: l.erro_ultima_tentativa,
    emailDestino: l.email_destino,
    emailOrigem: l.email_origem,
    criadoPor: l.criado_por,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

export interface DadosNovaSolicitacao {
  cotacaoFreteId: string;
  transportadoraId: string;
  canal: CanalOrigemProposta;
  codigoReferencia: string;
  criadoPor: string;
  /** Fase 4A.4.1 — só preenchido para canal EMAIL; `undefined`/`null` nos demais canais. */
  emailDestino?: string | null;
  emailOrigem?: EmailOrigem | null;
}

export async function criarSolicitacao(dados: DadosNovaSolicitacao): Promise<SolicitacaoCotacao> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `INSERT INTO ${nomeTabelaSolicitacoes()}
       (id, cotacao_frete_id, transportadora_id, canal, status, codigo_referencia, tentativas, criado_por, email_destino, email_origem)
     VALUES ($1, $2, $3, $4, 'PENDENTE_ENVIO', $5, 0, $6, $7, $8)
     RETURNING *`,
    [
      id,
      dados.cotacaoFreteId,
      dados.transportadoraId,
      dados.canal,
      dados.codigoReferencia,
      dados.criadoPor,
      dados.emailDestino ?? null,
      dados.emailOrigem ?? null,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao criar solicitação de cotação.');
  return linhaParaSolicitacao(linha);
}

export async function listarSolicitacoesPorCotacao(cotacaoFreteId: string): Promise<SolicitacaoCotacao[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `SELECT * FROM ${nomeTabelaSolicitacoes()} WHERE cotacao_frete_id = $1 ORDER BY criado_em ASC`,
    [cotacaoFreteId],
  );
  return rows.map(linhaParaSolicitacao);
}

export async function buscarSolicitacaoPorId(id: string): Promise<SolicitacaoCotacao | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaSolicitacao>(`SELECT * FROM ${nomeTabelaSolicitacoes()} WHERE id = $1`, [id]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaSolicitacao(linha);
}

/**
 * `codigoReferencia` é a chave de reconciliação segura (seção 23/24) — é através dela,
 * nunca de nome/assunto/texto aproximado, que o webhook (Fase 4A.1, seção 20) encontra a
 * solicitação correspondente a uma resposta recebida.
 */
export async function buscarSolicitacaoPorCodigoReferencia(codigoReferencia: string): Promise<SolicitacaoCotacao | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `SELECT * FROM ${nomeTabelaSolicitacoes()} WHERE codigo_referencia = $1`,
    [codigoReferencia],
  );
  const linha = rows[0];
  return linha === undefined ? null : linhaParaSolicitacao(linha);
}

/** Marca a solicitação como respondida (seção 13) — chamado pelo webhook ao processar uma resposta nova (nunca em uma duplicata idempotente). */
export async function marcarSolicitacaoRespondida(id: string): Promise<SolicitacaoCotacao> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `UPDATE ${nomeTabelaSolicitacoes()} SET status = 'RESPONDIDA', data_resposta = now(), atualizado_em = now() WHERE id = $1 RETURNING *`,
    [id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Solicitação de cotação não encontrada.');
  return linhaParaSolicitacao(linha);
}

// --- Fase 4A.2 — status técnico do envio outbound (ETK → n8n) --------------------------

/** Envio ao n8n confirmado (HTTP 2xx) — seção 20. `identificadorExterno` é opcional (ex.: id de execução do n8n, se devolvido). */
export async function marcarSolicitacaoEnviada(id: string, identificadorExterno: string | null): Promise<SolicitacaoCotacao> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `UPDATE ${nomeTabelaSolicitacoes()}
        SET status = 'ENVIADA', data_envio = now(), identificador_externo = COALESCE($2, identificador_externo),
            tentativas = tentativas + 1, erro_ultima_tentativa = NULL, atualizado_em = now()
      WHERE id = $1
      RETURNING *`,
    [id, identificadorExterno],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Solicitação de cotação não encontrada.');
  return linhaParaSolicitacao(linha);
}

/** Envio ao n8n falhou (config ausente, timeout, rede, HTTP não-2xx) — seção 8/11/27. Nunca lança: a solicitação fica registrada com o motivo, nunca se perde. */
export async function marcarSolicitacaoErro(id: string, erroResumido: string): Promise<SolicitacaoCotacao> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `UPDATE ${nomeTabelaSolicitacoes()}
        SET status = 'ERRO', tentativas = tentativas + 1, erro_ultima_tentativa = $2, atualizado_em = now()
      WHERE id = $1
      RETURNING *`,
    [id, erroResumido],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Solicitação de cotação não encontrada.');
  return linhaParaSolicitacao(linha);
}
