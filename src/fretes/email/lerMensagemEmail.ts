/**
 * Decodifica um e-mail bruto (RFC 822) nos campos usados pelo job de respostas e calcula a chave
 * de idempotência. Sem rede, sem banco.
 */
import { createHash } from 'node:crypto';
import { simpleParser, type AddressObject } from 'mailparser';

/** Limite do `mensagemId` aceito pelo contrato de resposta (`webhookCotacoes.ts`). */
const LIMITE_CHAVE = 300;

export interface MensagemLida {
  /** Message-ID como veio no cabeçalho (com `<>`), ou `null` se ausente. */
  messageId: string | null;
  /** Chave de idempotência: o Message-ID, ou `sem-message-id:<sha256>` determinístico. */
  chave: string;
  /** `In-Reply-To` + `References` (Message-IDs), sem repetição. */
  idsRelacionados: string[];
  assunto: string;
  remetente: string | null;
  data: string | null;
  /** Corpo em texto (HTML convertido quando não houver parte texto). */
  texto: string;
}

function primeiroEndereco(campo: AddressObject | AddressObject[] | undefined): string | null {
  const lista = campo === undefined ? [] : Array.isArray(campo) ? campo : [campo];
  for (const grupo of lista) {
    for (const item of grupo.value) if (item.address) return item.address.toLowerCase();
  }
  return null;
}

function htmlParaTexto(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');
}

/**
 * Chave determinística quando falta Message-ID: hash de remetente + data + assunto + texto. O
 * mesmo e-mail relido gera a mesma chave (sem duplicar); e-mails diferentes geram chaves
 * diferentes. Message-ID longo demais também vira hash (nunca truncado, para não colidir).
 */
export function calcularChaveMensagem(messageId: string | null, partes: { remetente: string | null; data: string | null; assunto: string; texto: string }): string {
  const id = messageId?.trim() ?? '';
  if (id !== '' && id.length <= LIMITE_CHAVE) return id;
  const base = id !== '' ? `message-id:${id}` : [partes.remetente ?? '', partes.data ?? '', partes.assunto, partes.texto.slice(0, 20000)].join('\u0000');
  const prefixo = id !== '' ? 'message-id-longo:' : 'sem-message-id:';
  return `${prefixo}${createHash('sha256').update(base).digest('hex')}`;
}

export async function lerMensagemEmail(fonte: Buffer): Promise<MensagemLida> {
  const email = await simpleParser(fonte, { skipImageLinks: true, skipTextToHtml: true });
  const messageId = typeof email.messageId === 'string' && email.messageId.trim() !== '' ? email.messageId.trim() : null;
  const referencias = Array.isArray(email.references) ? email.references : typeof email.references === 'string' ? email.references.split(/\s+/) : [];
  const idsRelacionados = [...new Set([email.inReplyTo ?? '', ...referencias].map((s) => s.trim()).filter((s) => s !== ''))];
  const assunto = (email.subject ?? '').trim();
  const remetente = primeiroEndereco(email.from);
  const data = email.date instanceof Date && !Number.isNaN(email.date.getTime()) ? email.date.toISOString() : null;
  const texto = (email.text && email.text.trim() !== '' ? email.text : typeof email.html === 'string' ? htmlParaTexto(email.html) : '').trim();
  return { messageId, chave: calcularChaveMensagem(messageId, { remetente, data, assunto, texto }), idsRelacionados, assunto, remetente, data, texto };
}
