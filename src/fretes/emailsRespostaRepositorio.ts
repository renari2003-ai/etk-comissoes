import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { garantirEsquemaFretes, nomeTabelaCursoresImap, nomeTabelaEmailsResposta } from './schema.js';

export type StatusEmailResposta = 'PROCESSADO' | 'REVISAO_MANUAL' | 'ERRO';

export interface EmailResposta {
  id: string;
  chaveMensagem: string;
  messageId: string | null;
  mailbox: string;
  uid: number | null;
  recebidoEm: string | null;
  remetente: string | null;
  assunto: string | null;
  referencia: string | null;
  solicitacaoId: string | null;
  respostaId: string | null;
  status: StatusEmailResposta;
  motivo: string | null;
  conteudo: string | null;
  tentativas: number;
  criadoEm: string;
  atualizadoEm: string;
}

interface LinhaEmailResposta {
  id: string;
  chave_mensagem: string;
  message_id: string | null;
  mailbox: string;
  uid: string | null;
  recebido_em: Date | null;
  remetente: string | null;
  assunto: string | null;
  referencia: string | null;
  solicitacao_id: string | null;
  resposta_id: string | null;
  status: StatusEmailResposta;
  motivo: string | null;
  conteudo: string | null;
  tentativas: number;
  criado_em: Date;
  atualizado_em: Date;
}

function linhaParaEmail(l: LinhaEmailResposta): EmailResposta {
  return {
    id: l.id,
    chaveMensagem: l.chave_mensagem,
    messageId: l.message_id,
    mailbox: l.mailbox,
    uid: l.uid === null ? null : Number(l.uid),
    recebidoEm: l.recebido_em === null ? null : l.recebido_em.toISOString(),
    remetente: l.remetente,
    assunto: l.assunto,
    referencia: l.referencia,
    solicitacaoId: l.solicitacao_id,
    respostaId: l.resposta_id,
    status: l.status,
    motivo: l.motivo,
    conteudo: l.conteudo,
    tentativas: l.tentativas,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

export async function buscarEmailPorChave(chave: string): Promise<EmailResposta | null> {
  await garantirEsquemaFretes();
  const { rows } = await obterPool().query<LinhaEmailResposta>(`SELECT * FROM ${nomeTabelaEmailsResposta()} WHERE chave_mensagem = $1`, [chave]);
  return rows[0] === undefined ? null : linhaParaEmail(rows[0]);
}

export interface DadosRegistroEmail {
  chaveMensagem: string;
  messageId: string | null;
  mailbox: string;
  uid: number | null;
  uidvalidity: number | null;
  recebidoEm: string | null;
  remetente: string | null;
  assunto: string | null;
  referencia: string | null;
  solicitacaoId: string | null;
  respostaId: string | null;
  status: StatusEmailResposta;
  motivo: string | null;
  conteudo: string | null;
}

/**
 * Grava o resultado do processamento de UM e-mail. Primeira vez → INSERT; de novo com a mesma
 * chave (só acontece ao reprocessar um `ERRO`) → atualiza o status e soma a tentativa.
 */
export async function registrarEmailResposta(dados: DadosRegistroEmail): Promise<EmailResposta> {
  await garantirEsquemaFretes();
  const { rows } = await obterPool().query<LinhaEmailResposta>(
    `INSERT INTO ${nomeTabelaEmailsResposta()}
       (id, chave_mensagem, message_id, mailbox, uid, uidvalidity, recebido_em, remetente, assunto, referencia,
        solicitacao_id, resposta_id, status, motivo, conteudo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (chave_mensagem) DO UPDATE
       SET status = EXCLUDED.status, motivo = EXCLUDED.motivo, referencia = EXCLUDED.referencia,
           solicitacao_id = EXCLUDED.solicitacao_id, resposta_id = EXCLUDED.resposta_id,
           tentativas = ${nomeTabelaEmailsResposta()}.tentativas + 1, atualizado_em = now()
     RETURNING *`,
    [
      randomUUID(),
      dados.chaveMensagem,
      dados.messageId,
      dados.mailbox,
      dados.uid,
      dados.uidvalidity,
      dados.recebidoEm,
      dados.remetente,
      dados.assunto,
      dados.referencia,
      dados.solicitacaoId,
      dados.respostaId,
      dados.status,
      dados.motivo,
      dados.conteudo,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao registrar e-mail de resposta.');
  return linhaParaEmail(linha);
}

/** Fila de revisão manual (mais recentes primeiro). */
export async function listarEmailsParaRevisao(limite = 100): Promise<EmailResposta[]> {
  await garantirEsquemaFretes();
  const { rows } = await obterPool().query<LinhaEmailResposta>(
    `SELECT * FROM ${nomeTabelaEmailsResposta()} WHERE status IN ('REVISAO_MANUAL','ERRO') ORDER BY criado_em DESC LIMIT $1`,
    [limite],
  );
  return rows.map(linhaParaEmail);
}

export interface CursorImap {
  uidvalidity: number;
  ultimoUid: number;
}

export async function lerCursorImap(mailbox: string): Promise<CursorImap | null> {
  await garantirEsquemaFretes();
  const { rows } = await obterPool().query<{ uidvalidity: string; ultimo_uid: string }>(
    `SELECT uidvalidity, ultimo_uid FROM ${nomeTabelaCursoresImap()} WHERE mailbox = $1`,
    [mailbox],
  );
  const linha = rows[0];
  return linha === undefined ? null : { uidvalidity: Number(linha.uidvalidity), ultimoUid: Number(linha.ultimo_uid) };
}

export async function salvarCursorImap(mailbox: string, cursor: CursorImap): Promise<void> {
  await garantirEsquemaFretes();
  await obterPool().query(
    `INSERT INTO ${nomeTabelaCursoresImap()} (mailbox, uidvalidity, ultimo_uid) VALUES ($1, $2, $3)
     ON CONFLICT (mailbox) DO UPDATE SET uidvalidity = EXCLUDED.uidvalidity, ultimo_uid = EXCLUDED.ultimo_uid, atualizado_em = now()`,
    [mailbox, cursor.uidvalidity, cursor.ultimoUid],
  );
}

/** Chave fixa do advisory lock do job de e-mails (nenhuma outra parte do sistema usa este número). */
const CHAVE_LOCK_JOB_EMAILS = 742_031_002;

/**
 * Executa `fn` só se nenhuma outra execução do job estiver rodando (advisory lock de sessão do
 * Postgres, na mesma conexão do começo ao fim). Ocupado → `{ executou: false }` sem erro.
 */
export async function executarComLockJobEmails<T>(fn: () => Promise<T>): Promise<{ executou: true; resultado: T } | { executou: false }> {
  await garantirEsquemaFretes();
  const cliente = await obterPool().connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [CHAVE_LOCK_JOB_EMAILS]);
    if (rows[0]?.ok !== true) return { executou: false };
    try {
      return { executou: true, resultado: await fn() };
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [CHAVE_LOCK_JOB_EMAILS]);
    }
  } finally {
    cliente.release();
  }
}
