/**
 * Webhook de entrada direto da YCloud (Fase 3 da migração n8n → backend).
 *
 * Autenticidade: cabeçalho oficial `YCloud-Signature: t={unix},s={hex}`, com
 * `s = HMAC-SHA256(segredo do endpoint, "{t}.{corpo bruto}")` em hex
 * (https://docs.ycloud.com/reference/webhook-integration-guide). Comparação em tempo
 * constante, tolerância de relógio de 5 min contra replay e segredo vazio = recusa tudo.
 *
 * Contrato: validação estrita por tipo/tamanho antes de tocar o banco. Eventos tratados:
 * `whatsapp.inbound_message.received` e `whatsapp.message.updated`; qualquer outro tipo válido
 * é aceito e ignorado (a YCloud reenvia o que não receber 2xx).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErroValidacao } from '../validacao.js';

export const TOLERANCIA_ASSINATURA_SEGUNDOS = 300;

export function verificarAssinaturaYCloud(cabecalho: string | undefined, corpoBruto: Buffer | null, segredo: string, agoraSegundos: number): boolean {
  if (segredo.trim() === '' || corpoBruto === null || cabecalho === undefined) return false;
  const partes = new Map(
    cabecalho.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const t = partes.get('t') ?? '';
  const s = partes.get('s') ?? '';
  if (!/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/i.test(s)) return false;
  if (Math.abs(agoraSegundos - Number(t)) > TOLERANCIA_ASSINATURA_SEGUNDOS) return false;
  const esperado = createHmac('sha256', segredo).update(`${t}.`).update(corpoBruto).digest();
  const recebido = Buffer.from(s, 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export interface MensagemRecebidaYCloud {
  ycloudId: string;
  wamid: string | null;
  de: string | null;
  tipo: string;
  texto: string | null;
  contextoId: string | null;
  enviadaEm: string | null;
}

export interface StatusMensagemYCloud {
  ycloudId: string;
  wamid: string | null;
  status: string;
  erroCodigo: string | null;
  erroMensagem: string | null;
}

export type EventoYCloud =
  | { tipo: 'MENSAGEM_RECEBIDA'; eventoId: string; mensagem: MensagemRecebidaYCloud }
  | { tipo: 'STATUS'; eventoId: string; mensagem: StatusMensagemYCloud }
  | { tipo: 'IGNORADO'; eventoId: string; tipoOriginal: string };

function texto(valor: unknown, campo: string, max: number, obrigatorio: boolean): string | null {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) throw new ErroValidacao(`O campo "${campo}" é obrigatório.`);
    return null;
  }
  if (typeof valor !== 'string') throw new ErroValidacao(`O campo "${campo}" deve ser texto.`);
  if (valor.length > max) throw new ErroValidacao(`O campo "${campo}" excede ${max} caracteres.`);
  return valor;
}

function objeto(valor: unknown, campo: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new ErroValidacao(`O campo "${campo}" deve ser um objeto.`);
  return valor as Record<string, unknown>;
}

function objetoOpcional(valor: unknown, campo: string): Record<string, unknown> | null {
  return valor === undefined || valor === null ? null : objeto(valor, campo);
}

/** Texto de uma mensagem recebida: `text.body`, ou o título de botão/resposta interativa. Mídia sem legenda → `null`. */
function textoDaMensagem(m: Record<string, unknown>, tipo: string): string | null {
  const max = 4096;
  if (tipo === 'text') return texto(objeto(m.text, 'whatsappInboundMessage.text').body, 'whatsappInboundMessage.text.body', max, false);
  if (tipo === 'button') return texto(objetoOpcional(m.button, 'whatsappInboundMessage.button')?.text, 'whatsappInboundMessage.button.text', max, false);
  if (tipo === 'interactive') {
    const i = objetoOpcional(m.interactive, 'whatsappInboundMessage.interactive');
    const r = objetoOpcional(i?.button_reply, 'interactive.button_reply') ?? objetoOpcional(i?.list_reply, 'interactive.list_reply');
    return texto(r?.title, 'interactive.reply.title', max, false);
  }
  const midia = objetoOpcional(m[tipo], `whatsappInboundMessage.${tipo}`);
  return texto(midia?.caption, `whatsappInboundMessage.${tipo}.caption`, max, false);
}

export function validarEventoYCloud(body: unknown): EventoYCloud {
  const e = objeto(body, 'corpo');
  const eventoId = texto(e.id, 'id', 200, true) as string;
  const tipo = texto(e.type, 'type', 100, true) as string;

  if (tipo === 'whatsapp.inbound_message.received') {
    const m = objeto(e.whatsappInboundMessage, 'whatsappInboundMessage');
    const tipoMsg = texto(m.type, 'whatsappInboundMessage.type', 50, true) as string;
    const contexto = objetoOpcional(m.context, 'whatsappInboundMessage.context');
    const enviadaEm = texto(m.sendTime, 'whatsappInboundMessage.sendTime', 40, false);
    if (enviadaEm !== null && Number.isNaN(Date.parse(enviadaEm))) throw new ErroValidacao('O campo "whatsappInboundMessage.sendTime" deve ser data/hora ISO 8601.');
    return {
      tipo: 'MENSAGEM_RECEBIDA',
      eventoId,
      mensagem: {
        ycloudId: texto(m.id, 'whatsappInboundMessage.id', 200, true) as string,
        wamid: texto(m.wamid, 'whatsappInboundMessage.wamid', 300, false),
        de: texto(m.from, 'whatsappInboundMessage.from', 40, false),
        tipo: tipoMsg,
        texto: textoDaMensagem(m, tipoMsg),
        contextoId: texto(contexto?.id, 'whatsappInboundMessage.context.id', 300, false),
        enviadaEm,
      },
    };
  }

  if (tipo === 'whatsapp.message.updated') {
    const m = objeto(e.whatsappMessage, 'whatsappMessage');
    const codigo = m.errorCode;
    return {
      tipo: 'STATUS',
      eventoId,
      mensagem: {
        ycloudId: texto(m.id, 'whatsappMessage.id', 200, true) as string,
        wamid: texto(m.wamid, 'whatsappMessage.wamid', 300, false),
        status: texto(m.status, 'whatsappMessage.status', 40, true) as string,
        erroCodigo: typeof codigo === 'number' ? String(codigo) : texto(codigo, 'whatsappMessage.errorCode', 100, false),
        erroMensagem: texto(m.errorMessage, 'whatsappMessage.errorMessage', 1000, false),
      },
    };
  }

  return { tipo: 'IGNORADO', eventoId, tipoOriginal: tipo };
}
