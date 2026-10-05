import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { garantirEsquemaFretes, nomeTabelaWhatsappRecebidas } from './schema.js';

export type StatusWhatsappRecebida = 'PROCESSADO' | 'REVISAO_MANUAL';

export interface WhatsappRecebida {
  id: string;
  chaveMensagem: string;
  ycloudId: string | null;
  telefoneOrigem: string | null;
  contextoId: string | null;
  tipo: string | null;
  texto: string | null;
  enviadaEm: string | null;
  referencia: string | null;
  solicitacaoId: string | null;
  respostaId: string | null;
  status: StatusWhatsappRecebida;
  motivo: string | null;
  criadoEm: string;
}

interface Linha {
  id: string;
  chave_mensagem: string;
  ycloud_id: string | null;
  telefone_origem: string | null;
  contexto_id: string | null;
  tipo: string | null;
  texto: string | null;
  enviada_em: Date | null;
  referencia: string | null;
  solicitacao_id: string | null;
  resposta_id: string | null;
  status: StatusWhatsappRecebida;
  motivo: string | null;
  criado_em: Date;
}

function linhaParaRegistro(l: Linha): WhatsappRecebida {
  return {
    id: l.id,
    chaveMensagem: l.chave_mensagem,
    ycloudId: l.ycloud_id,
    telefoneOrigem: l.telefone_origem,
    contextoId: l.contexto_id,
    tipo: l.tipo,
    texto: l.texto,
    enviadaEm: l.enviada_em === null ? null : l.enviada_em.toISOString(),
    referencia: l.referencia,
    solicitacaoId: l.solicitacao_id,
    respostaId: l.resposta_id,
    status: l.status,
    motivo: l.motivo,
    criadoEm: l.criado_em.toISOString(),
  };
}

export async function buscarWhatsappRecebidaPorChave(chave: string): Promise<WhatsappRecebida | null> {
  await garantirEsquemaFretes();
  const { rows } = await obterPool().query<Linha>(`SELECT * FROM ${nomeTabelaWhatsappRecebidas()} WHERE chave_mensagem = $1`, [chave]);
  return rows[0] === undefined ? null : linhaParaRegistro(rows[0]);
}

export type DadosWhatsappRecebida = Omit<WhatsappRecebida, 'id' | 'criadoEm'>;

/**
 * Grava a mensagem recebida. Mesma chave já gravada (reentrega concorrente da YCloud) → não
 * grava de novo e devolve `null` — o chamador trata como duplicada.
 */
export async function registrarWhatsappRecebida(d: DadosWhatsappRecebida): Promise<WhatsappRecebida | null> {
  await garantirEsquemaFretes();
  const { rows } = await obterPool().query<Linha>(
    `INSERT INTO ${nomeTabelaWhatsappRecebidas()}
       (id, chave_mensagem, ycloud_id, telefone_origem, contexto_id, tipo, texto, enviada_em, referencia, solicitacao_id, resposta_id, status, motivo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (chave_mensagem) DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      d.chaveMensagem,
      d.ycloudId,
      d.telefoneOrigem,
      d.contextoId,
      d.tipo,
      d.texto,
      d.enviadaEm,
      d.referencia,
      d.solicitacaoId,
      d.respostaId,
      d.status,
      d.motivo,
    ],
  );
  return rows[0] === undefined ? null : linhaParaRegistro(rows[0]);
}

export async function listarWhatsappParaRevisao(limite = 100): Promise<WhatsappRecebida[]> {
  await garantirEsquemaFretes();
  const { rows } = await obterPool().query<Linha>(
    `SELECT * FROM ${nomeTabelaWhatsappRecebidas()} WHERE status = 'REVISAO_MANUAL' ORDER BY criado_em DESC LIMIT $1`,
    [limite],
  );
  return rows.map(linhaParaRegistro);
}
