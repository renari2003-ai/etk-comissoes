import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { garantirEsquemaFretes, nomeTabelaRespostas, nomeTabelaExtracoes, nomeTabelaSolicitacoes } from './schema.js';
import type { CanalOrigemProposta, RespostaCotacao, StatusProcessamentoResposta } from './tipos.js';

interface LinhaResposta {
  id: string;
  solicitacao_id: string;
  canal: CanalOrigemProposta;
  identificador_mensagem: string;
  conteudo_bruto: string | null;
  data_recebimento: Date;
  status_processamento: StatusProcessamentoResposta;
  erro_processamento: string | null;
  criado_em: Date;
}

function linhaParaResposta(l: LinhaResposta): RespostaCotacao {
  return {
    id: l.id,
    solicitacaoId: l.solicitacao_id,
    canal: l.canal,
    identificadorMensagem: l.identificador_mensagem,
    conteudoBruto: l.conteudo_bruto,
    dataRecebimento: l.data_recebimento.toISOString(),
    statusProcessamento: l.status_processamento,
    erroProcessamento: l.erro_processamento,
    criadoEm: l.criado_em.toISOString(),
  };
}

export interface DadosNovaResposta {
  solicitacaoId: string;
  canal: CanalOrigemProposta;
  identificadorMensagem: string;
  conteudoBruto: string | null;
}

export interface ResultadoCriarResposta {
  resposta: RespostaCotacao;
  /** `false` quando a mesma mensagem (canal + identificadorMensagem) já tinha sido recebida antes (seção 19) — nesse caso `resposta` é a linha JÁ EXISTENTE, nunca uma nova. */
  criada: boolean;
}

/**
 * Idempotência em nível de banco (seção 19): `ON CONFLICT (canal, identificador_mensagem)
 * DO NOTHING` garante que a mesma mensagem chegando duas vezes nunca cria uma segunda
 * linha — a chamada apenas devolve a linha já existente, sem lançar erro (o webhook deve
 * responder 200 tanto na primeira quanto nas tentativas seguintes da mesma entrega).
 */
export async function criarRespostaIdempotente(dados: DadosNovaResposta): Promise<ResultadoCriarResposta> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const { rows } = await pool.query<LinhaResposta>(
    `INSERT INTO ${nomeTabelaRespostas()} (id, solicitacao_id, canal, identificador_mensagem, conteudo_bruto, status_processamento)
     VALUES ($1, $2, $3, $4, $5, 'PENDENTE')
     ON CONFLICT (canal, identificador_mensagem) DO NOTHING
     RETURNING *`,
    [id, dados.solicitacaoId, dados.canal, dados.identificadorMensagem, dados.conteudoBruto],
  );
  const nova = rows[0];
  if (nova !== undefined) return { resposta: linhaParaResposta(nova), criada: true };

  const existente = await buscarRespostaPorCanalEMensagem(dados.canal, dados.identificadorMensagem);
  if (existente === null) throw new Error('Falha ao reconciliar resposta idempotente já existente.');
  return { resposta: existente, criada: false };
}

export async function buscarRespostaPorCanalEMensagem(canal: CanalOrigemProposta, identificadorMensagem: string): Promise<RespostaCotacao | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaResposta>(
    `SELECT * FROM ${nomeTabelaRespostas()} WHERE canal = $1 AND identificador_mensagem = $2`,
    [canal, identificadorMensagem],
  );
  const linha = rows[0];
  return linha === undefined ? null : linhaParaResposta(linha);
}

export async function buscarRespostaPorId(id: string): Promise<RespostaCotacao | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaResposta>(`SELECT * FROM ${nomeTabelaRespostas()} WHERE id = $1`, [id]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaResposta(linha);
}

/** Nunca altera `conteudo_bruto` (seção 18 — a mensagem original é imutável); só marca o resultado do processamento. */
export async function marcarStatusProcessamentoResposta(id: string, status: StatusProcessamentoResposta, erro: string | null): Promise<void> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  await pool.query(
    `UPDATE ${nomeTabelaRespostas()} SET status_processamento = $1, erro_processamento = $2 WHERE id = $3`,
    [status, erro, id],
  );
}

export interface RespostaCotacaoParaRevisao extends RespostaCotacao {
  codigoReferencia: string | null;
}

export async function listarRespostasComErroOuSemProposta(): Promise<RespostaCotacaoParaRevisao[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  // Uma mensagem pode ter sido processada corretamente, mas sem valor utilizável: sua
  // extração fica REQUER_REVISAO, sem proposta. Não é erro de processamento e não pode
  // desaparecer da caixa de entrada. EXISTS evita multiplicar a resposta pelos registros
  // de extração; uma extração com proposta já vinculada não deve reaparecer como "sem proposta".
  const { rows } = await pool.query<LinhaResposta & { codigo_referencia: string | null }>(
    `SELECT r.*, s.codigo_referencia
       FROM ${nomeTabelaRespostas()} r
       LEFT JOIN ${nomeTabelaSolicitacoes()} s ON s.id = r.solicitacao_id
      WHERE r.status_processamento = 'ERRO'
         OR (r.status_processamento = 'PROCESSADA'
             AND EXISTS (SELECT 1 FROM ${nomeTabelaExtracoes()} e
                          WHERE e.resposta_id = r.id AND e.status = 'REQUER_REVISAO' AND e.proposta_id IS NULL)
             AND NOT EXISTS (SELECT 1 FROM ${nomeTabelaExtracoes()} e
                              WHERE e.resposta_id = r.id AND e.proposta_id IS NOT NULL))
      ORDER BY r.data_recebimento DESC`,
  );
  return rows.map((linha) => ({ ...linhaParaResposta(linha), codigoReferencia: linha.codigo_referencia ?? null }));
}
