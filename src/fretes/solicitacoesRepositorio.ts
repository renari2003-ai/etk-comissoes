import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { garantirEsquemaFretes, nomeTabelaSolicitacoes } from './schema.js';
import type { CanalOrigemProposta, EmailOrigem, EmbalagemSolicitacao, SolicitacaoCotacao, StatusSolicitacaoCotacao } from './tipos.js';

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
  wamid_outbound: string | null;
  ycloud_message_id: string | null;
  telefone_destino: string | null;
  /** JSONB (já desserializado pelo `pg`); ausente/`NULL` em registros anteriores à coluna. */
  embalagens?: unknown;
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
    wamidOutbound: l.wamid_outbound,
    ycloudMessageId: l.ycloud_message_id,
    telefoneDestino: l.telefone_destino,
    embalagens: lerEmbalagensPersistidas(l.embalagens),
    criadoPor: l.criado_por,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

/**
 * Lê o snapshot de embalagens gravado na solicitação. Registro antigo (coluna ausente/`NULL`)
 * ou lista vazia → `null`. Conteúdo fora do formato gravado por `criarSolicitacao` é estado
 * inconsistente e falha alto — nunca é "consertado" ou parcialmente aproveitado.
 */
export function lerEmbalagensPersistidas(valor: unknown): EmbalagemSolicitacao[] | null {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) throw new Error('Embalagens da solicitação em formato inválido — estado inconsistente.');
  if (valor.length === 0) return null;
  return valor.map((item: unknown) => {
    const e = item as Record<string, unknown> | null;
    const campos = ['altura', 'largura', 'comprimento', 'quantidade'] as const;
    if (e === null || typeof e !== 'object' || !campos.every((c) => typeof e[c] === 'number' && Number.isFinite(e[c]))) {
      throw new Error('Embalagens da solicitação em formato inválido — estado inconsistente.');
    }
    return { altura: e.altura as number, largura: e.largura as number, comprimento: e.comprimento as number, quantidade: e.quantidade as number };
  });
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
  /** Snapshot das embalagens do envio (canais EMAIL/WHATSAPP); `undefined`/`null`/vazio → `NULL`. */
  embalagens?: EmbalagemSolicitacao[] | null;
}

export async function criarSolicitacao(dados: DadosNovaSolicitacao): Promise<SolicitacaoCotacao> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `INSERT INTO ${nomeTabelaSolicitacoes()}
       (id, cotacao_frete_id, transportadora_id, canal, status, codigo_referencia, tentativas, criado_por, email_destino, email_origem, embalagens)
     VALUES ($1, $2, $3, $4, 'PENDENTE_ENVIO', $5, 0, $6, $7, $8, $9::jsonb)
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
      dados.embalagens !== undefined && dados.embalagens !== null && dados.embalagens.length > 0 ? JSON.stringify(dados.embalagens) : null,
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
 * Solicitações de canal EMAIL cujo Message-ID de saída (gravado em `identificador_externo`
 * pelo envio SMTP direto) está entre `messageIds` — usado para correlacionar uma resposta pelos
 * cabeçalhos `In-Reply-To`/`References` quando o assunto perdeu a referência. Igualdade exata.
 */
export async function buscarSolicitacoesEmailPorMessageId(messageIds: string[]): Promise<SolicitacaoCotacao[]> {
  if (messageIds.length === 0) return [];
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `SELECT * FROM ${nomeTabelaSolicitacoes()} WHERE canal = 'EMAIL' AND identificador_externo = ANY($1::text[])`,
    [messageIds],
  );
  return rows.map(linhaParaSolicitacao);
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

// --- Fase WhatsApp — Etapa 3: persistência definitiva do WAMID outbound ----------------

export interface DadosRegistroWamidOutbound {
  /** Pelo menos um dos dois deve ser informado — resolvido nessa ordem quando ambos vierem. */
  solicitacaoId?: string;
  codigoReferencia?: string;
  wamidOutbound: string;
  ycloudMessageId: string | null;
  telefoneDestino: string | null;
  statusEnvio?: StatusSolicitacaoCotacao;
  enviadoEm?: string | null;
}

export interface ResultadoRegistroWamidOutbound {
  solicitacao: SolicitacaoCotacao;
  /** `true` quando este WAMID já tinha sido registrado antes — reprocessamento idempotente, nenhuma escrita nova. */
  duplicado: boolean;
}

/**
 * Idempotência (Etapa 3, seção 2): se o WAMID já está gravado em alguma solicitação, devolve
 * essa solicitação sem tentar gravar de novo — nunca duplica, nunca lança erro num
 * reenvio/reprocessamento do mesmo evento outbound. Fora desse caso, a constraint UNIQUE em
 * `wamid_outbound` (schema.ts) é a segunda camada de proteção contra corrida entre duas
 * chamadas concorrentes tentando o mesmo WAMID em solicitações diferentes.
 */
export async function registrarWamidOutbound(dados: DadosRegistroWamidOutbound): Promise<ResultadoRegistroWamidOutbound> {
  await garantirEsquemaFretes();
  const pool = obterPool();

  const existente = await buscarSolicitacaoPorWamidOutbound(dados.wamidOutbound);
  if (existente !== null) {
    return { solicitacao: existente, duplicado: true };
  }

  const alvo =
    dados.solicitacaoId !== undefined
      ? await buscarSolicitacaoPorId(dados.solicitacaoId)
      : dados.codigoReferencia !== undefined
        ? await buscarSolicitacaoPorCodigoReferencia(dados.codigoReferencia)
        : null;
  if (alvo === null) throw new ErroValidacao('Solicitação de cotação não encontrada (referencia/solicitacaoId inválidos).');

  try {
    const { rows } = await pool.query<LinhaSolicitacao>(
      `UPDATE ${nomeTabelaSolicitacoes()}
          SET wamid_outbound = $1, ycloud_message_id = $2, telefone_destino = $3,
              status = COALESCE($4, status), data_envio = COALESCE($5::timestamptz, data_envio), atualizado_em = now()
        WHERE id = $6
        RETURNING *`,
      [dados.wamidOutbound, dados.ycloudMessageId, dados.telefoneDestino, dados.statusEnvio ?? null, dados.enviadoEm ?? null, alvo.id],
    );
    const linha = rows[0];
    if (linha === undefined) throw new ErroValidacao('Solicitação de cotação não encontrada.');
    return { solicitacao: linhaParaSolicitacao(linha), duplicado: false };
  } catch (erro) {
    // 23505 = unique_violation (Postgres) — corrida rara entre duas chamadas concorrentes com
    // o mesmo WAMID para solicitações diferentes; nunca deixa vazar o erro genérico do driver.
    if (typeof erro === 'object' && erro !== null && 'code' in erro && (erro as { code?: string }).code === '23505') {
      throw new ErroValidacao('Este WAMID outbound já está registrado para outra solicitação.');
    }
    throw erro;
  }
}

/** Resolução por `context.id` (Etapa 3, seção 3) — nunca adivinha: `null` quando o WAMID não foi registrado por nenhuma solicitação. */
export async function buscarSolicitacaoPorWamidOutbound(wamidOutbound: string): Promise<SolicitacaoCotacao | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaSolicitacao>(
    `SELECT * FROM ${nomeTabelaSolicitacoes()} WHERE wamid_outbound = $1`,
    [wamidOutbound],
  );
  const linha = rows[0];
  return linha === undefined ? null : linhaParaSolicitacao(linha);
}
