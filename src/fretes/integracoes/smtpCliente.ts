/**
 * Envio SMTP direto (Fase 1 da migração n8n → backend). Único ponto do módulo de Fretes que
 * fala SMTP — `integracaoCotacoesServico.ts` só chama `enviarEmailSmtp`.
 *
 * Host, porta, usuário, senha e remetente vêm EXCLUSIVAMENTE de `config` (variáveis de
 * ambiente do servidor), nunca do payload/usuário. Toda mensagem de erro é sanitizada (nunca
 * contém senha nem o comando AUTH) e começa com um código estável (`SMTP_*`) para a camada de
 * envio escolher a mensagem amigável certa por transportadora.
 */
import nodemailer, { type SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { config } from '../../config.js';
import { emailValido } from '../validacao.js';
import { sanitizarTextoErro } from './sanitizacao.js';

export interface MensagemEmail {
  para: string;
  assunto: string;
  html: string;
  texto: string;
}

export interface ResultadoEnvioSmtp {
  /** Message-ID atribuído ao e-mail — guardado como identificador externo da solicitação. */
  messageId: string | null;
}

export type TipoFalhaSmtp = 'AUTENTICACAO' | 'DESTINATARIO_RECUSADO' | 'CONEXAO' | 'TIMEOUT' | 'OUTRO';

/** Fail-closed: configuração ausente nunca vira envio silencioso. */
export class ErroSmtpNaoConfigurado extends Error {
  constructor() {
    super('SMTP_NAO_CONFIGURADO: configure SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM no servidor.');
    this.name = 'ErroSmtpNaoConfigurado';
  }
}

export class ErroEnvioSmtpFalhou extends Error {
  constructor(
    readonly tipo: TipoFalhaSmtp,
    motivo: string,
  ) {
    super(motivo);
    this.name = 'ErroEnvioSmtpFalhou';
  }
}

/** Só o necessário do transporte do nodemailer — injetável em teste (nenhum servidor real). */
export interface TransporteSmtp {
  sendMail(mensagem: SendMailOptions): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>;
  close(): void;
}

export type FabricaTransporteSmtp = (opcoes: SMTPTransport.Options) => TransporteSmtp;

const fabricaPadrao: FabricaTransporteSmtp = (opcoes) => nodemailer.createTransport(opcoes);

const LIMITE_RESPOSTA_SERVIDOR = 300;

const DESCRICAO_FALHA: Record<TipoFalhaSmtp, string> = {
  AUTENTICACAO: 'o servidor SMTP recusou o usuário/senha configurados',
  DESTINATARIO_RECUSADO: 'o servidor SMTP recusou o destinatário',
  CONEXAO: 'não foi possível conectar ao servidor SMTP',
  TIMEOUT: 'tempo limite excedido na comunicação com o servidor SMTP',
  OUTRO: 'o servidor SMTP não aceitou o e-mail',
};

/** Classifica o erro do nodemailer pelo `code`/`responseCode` — nunca pelo texto (pode vir em qualquer idioma). */
export function classificarErroSmtp(erro: unknown): TipoFalhaSmtp {
  const e = (erro ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : null;
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) return 'AUTENTICACAO';
  if (code === 'EENVELOPE' || (e.command === 'RCPT TO' && responseCode !== null && responseCode >= 500)) return 'DESTINATARIO_RECUSADO';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'TIMEOUT';
  if (['ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'EDNS', 'ENOTFOUND', 'ESOCKET', 'ETLS', 'EHOSTUNREACH'].includes(code)) return 'CONEXAO';
  return 'OUTRO';
}

function motivoSanitizado(tipo: TipoFalhaSmtp, erro: unknown): string {
  const e = (erro ?? {}) as { response?: unknown; message?: unknown };
  const bruto = typeof e.response === 'string' && e.response.trim() !== '' ? e.response : typeof e.message === 'string' ? e.message : '';
  let detalhe = sanitizarTextoErro(bruto.replace(/\s+/g, ' ').trim(), [config.smtpPass, config.smtpUser]);
  if (detalhe.length > LIMITE_RESPOSTA_SERVIDOR) detalhe = `${detalhe.slice(0, LIMITE_RESPOSTA_SERVIDOR)}…`;
  return `SMTP_${tipo}: ${DESCRICAO_FALHA[tipo]}.${detalhe === '' ? '' : ` Servidor: ${detalhe}`}`;
}

/**
 * Envia UM e-mail. Uma única tentativa (sem retry automático — reenvio é ação humana
 * explícita). Sucesso = servidor SMTP aceitou a mensagem para o destinatário; isso NÃO é
 * confirmação de entrega na caixa da transportadora.
 */
export async function enviarEmailSmtp(mensagem: MensagemEmail, fabrica: FabricaTransporteSmtp = fabricaPadrao): Promise<ResultadoEnvioSmtp> {
  const host = config.smtpHost.trim();
  const usuario = config.smtpUser.trim();
  const remetente = config.smtpFrom.trim();
  if (host === '' || usuario === '' || config.smtpPass === '' || remetente === '') throw new ErroSmtpNaoConfigurado();
  if (!emailValido(mensagem.para)) {
    throw new ErroEnvioSmtpFalhou('DESTINATARIO_RECUSADO', 'SMTP_DESTINATARIO_RECUSADO: e-mail de destino inválido — nada foi enviado.');
  }

  const transporte = fabrica({
    host,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: config.smtpPort !== 465,
    auth: { user: usuario, pass: config.smtpPass },
    connectionTimeout: config.smtpTimeoutMs,
    greetingTimeout: config.smtpTimeoutMs,
    socketTimeout: config.smtpTimeoutMs,
    logger: false,
    debug: false,
  });
  try {
    const info = await transporte.sendMail({
      from: remetente,
      to: mensagem.para.trim(),
      subject: mensagem.assunto,
      html: mensagem.html,
      text: mensagem.texto,
    });
    if (Array.isArray(info.rejected) && info.rejected.length > 0) {
      throw Object.assign(new Error('Destinatário recusado pelo servidor.'), { code: 'EENVELOPE' });
    }
    return { messageId: typeof info.messageId === 'string' && info.messageId !== '' ? info.messageId : null };
  } catch (erro) {
    const tipo = classificarErroSmtp(erro);
    throw new ErroEnvioSmtpFalhou(tipo, motivoSanitizado(tipo, erro));
  } finally {
    transporte.close();
  }
}
