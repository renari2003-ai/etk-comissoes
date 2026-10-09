import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErroValidacao } from '../validacao.js';
import type { EventoYCloud } from './webhookYCloud.js';

export function verificarAssinaturaMeta(assinatura: string | undefined, corpo: Buffer | null, segredo: string): boolean {
  if (!segredo.trim() || !corpo || !assinatura || !/^sha256=[a-f0-9]{64}$/i.test(assinatura)) return false;
  return timingSafeEqual(createHmac('sha256', segredo).update(corpo).digest(), Buffer.from(assinatura.slice(7), 'hex'));
}

export function desafioWebhookMeta(query: Record<string, unknown>, token: string): string | null {
  const recebido = query['hub.verify_token'];
  const desafio = query['hub.challenge'];
  if (!token || query['hub.mode'] !== 'subscribe' || typeof recebido !== 'string' || typeof desafio !== 'string' || !/^\d{1,100}$/.test(desafio)) return null;
  const a = Buffer.from(recebido), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? desafio : null;
}

function obj(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErroValidacao('Webhook Meta: objeto inválido.'); return v as Record<string, unknown>; }
function txt(v: unknown, max = 300): string { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new ErroValidacao('Webhook Meta: texto ausente ou inválido.'); return v; }
function lista(v: unknown): unknown[] { if (!Array.isArray(v) || v.length > 100) throw new ErroValidacao('Webhook Meta: lista inválida ou excedida.'); return v; }

/** Normaliza o envelope Meta para o núcleo de processamento WhatsApp já usado pela YCloud. */
export function validarEventosMeta(body: unknown, phoneNumberId: string): EventoYCloud[] {
  if (!/^\d{5,30}$/.test(phoneNumberId)) throw new ErroValidacao('Webhook Meta: telefone não configurado.');
  const envelope = obj(body);
  if (envelope.object !== 'whatsapp_business_account') throw new ErroValidacao('Webhook Meta: object inválido.');
  const eventos: EventoYCloud[] = [];
  for (const e of lista(envelope.entry)) {
    const entrada = obj(e); txt(entrada.id);
    for (const c of lista(entrada.changes)) {
      const change = obj(c);
      if (txt(change.field, 100) !== 'messages') continue;
      const value = obj(change.value);
      if (value.messaging_product !== 'whatsapp') throw new ErroValidacao('Webhook Meta: produto inválido.');
      const metadata = obj(value.metadata);
      if (txt(metadata.phone_number_id) !== phoneNumberId) continue;
      for (const bruto of lista(value.messages ?? [])) {
        const m = obj(bruto), id = txt(m.id), tipo = txt(m.type, 50), de = txt(m.from, 20), timestamp = txt(m.timestamp, 15);
        if (!id.startsWith('wamid.')) throw new ErroValidacao('Webhook Meta: identificador de mensagem inválido.');
        if (!/^\d{7,15}$/.test(de) || !/^\d{1,12}$/.test(timestamp)) throw new ErroValidacao('Webhook Meta: remetente/data inválidos.');
        let texto: string | null = null;
        if (tipo === 'text') texto = txt(obj(m.text).body, 4096);
        else if (tipo === 'button') texto = txt(obj(m.button).text, 4096);
        else if (tipo === 'interactive') { const i = obj(m.interactive); texto = txt(obj(i.button_reply ?? i.list_reply).title, 4096); }
        else if (m[tipo] != null && obj(m[tipo]).caption != null) texto = txt(obj(m[tipo]).caption, 4096);
        const contextoId = m.context == null ? null : txt(obj(m.context).id);
        eventos.push({ tipo: 'MENSAGEM_RECEBIDA', eventoId: `meta:${id}`, mensagem: { ycloudId: `meta:${id}`, wamid: id, de: `+${de}`, tipo, texto, contextoId, enviadaEm: new Date(Number(timestamp) * 1000).toISOString() } });
      }
      for (const bruto of lista(value.statuses ?? [])) {
        const s = obj(bruto), id = txt(s.id), status = txt(s.status, 40);
        if (!id.startsWith('wamid.')) throw new ErroValidacao('Webhook Meta: identificador de status inválido.');
        if (!['sent', 'delivered', 'read', 'failed', 'deleted'].includes(status)) throw new ErroValidacao('Webhook Meta: status inválido.');
        const erros = lista(s.errors ?? []).map((v) => obj(v));
        if (erros.some((erro) => erro.code != null && (typeof erro.code !== 'number' || !Number.isInteger(erro.code)))) throw new ErroValidacao('Webhook Meta: código de erro inválido.');
        const mensagens = erros.map((erro) => {
          const mensagem = erro.message == null ? erro.title : erro.message;
          return mensagem == null ? '' : txt(mensagem, 1000);
        });
        eventos.push({ tipo: 'STATUS', eventoId: `meta:${id}:${status}`, mensagem: { ycloudId: `meta:${id}`, wamid: id, status, erroCodigo: erros[0]?.code == null ? null : String(erros[0].code).slice(0, 100), erroMensagem: mensagens.join('; ').slice(0, 1000) || null } });
      }
      if (eventos.length > 100) throw new ErroValidacao('Webhook Meta: limite de eventos excedido.');
    }
  }
  return eventos;
}
