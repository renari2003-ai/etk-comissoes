/**
 * Envio direto de WhatsApp pela API da YCloud (Fase 3 da migração n8n → backend). Único ponto do
 * módulo de Fretes que chama a YCloud.
 *
 * - `POST {YCLOUD_API_URL}/whatsapp/messages/sendDirectly` (síncrono: devolve o resultado do
 *   envio e, quando enviado, o `wamid` usado na correlação dos replies).
 * - Autenticação `X-API-Key` — chave só de `config`, nunca logada; erros sempre sanitizados e
 *   com código estável (`YCLOUD_*`).
 * - Uma única tentativa por chamada (reenvio é ação humana explícita).
 */
import { config } from '../../config.js';
import { sanitizarTextoErro } from './sanitizacao.js';

export type MensagemWhatsapp =
  | { tipo: 'texto'; para: string; texto: string }
  | { tipo: 'template'; para: string; nome: string; idioma: string; parametros: string[] };

export interface ResultadoEnvioYCloud {
  /** Id da mensagem na YCloud (diferente do WAMID). */
  ycloudMessageId: string;
  /** WAMID da Meta — `null` se a YCloud ainda não devolveu (chega depois pelo webhook de status). */
  wamid: string | null;
  /** Status devolvido pela YCloud (`accepted`, `sent`, ...). Nunca é "entregue". */
  status: string;
}

export class ErroYCloudNaoConfigurada extends Error {
  constructor() {
    super('YCLOUD_NAO_CONFIGURADA: configure YCLOUD_API_KEY e YCLOUD_WHATSAPP_FROM no servidor.');
    this.name = 'ErroYCloudNaoConfigurada';
  }
}

export class ErroEnvioYCloudFalhou extends Error {
  constructor(
    readonly destinoInvalido: boolean,
    motivo: string,
  ) {
    super(motivo);
    this.name = 'ErroEnvioYCloudFalhou';
  }
}

/**
 * `whatsappCotacao` do cadastro (só dígitos, 10 a 13) → E.164 brasileiro. 10/11 dígitos = DDD +
 * número (prefixa +55); 12/13 dígitos só se já começarem com 55. Qualquer outra coisa → `null`
 * (nunca adivinha país nem completa número).
 */
export function telefoneE164(whatsappCotacao: string | null): string | null {
  const d = (whatsappCotacao ?? '').replace(/\D/g, '');
  if (/^[1-9]\d{9,10}$/.test(d)) return `+55${d}`;
  if (/^55[1-9]\d{9,10}$/.test(d)) return `+${d}`;
  return null;
}

function sanitizar(texto: string): string {
  const limpo = sanitizarTextoErro(texto.replace(/\s+/g, ' ').trim(), [config.ycloudApiKey]);
  return limpo.length > 300 ? `${limpo.slice(0, 300)}…` : limpo;
}

/** Códigos/mensagens da YCloud que indicam número inválido ou sem WhatsApp (erro do cadastro, não do sistema). */
function ehDestinoInvalido(codigo: string, mensagem: string): boolean {
  return /recipient|phone.?number|not a valid whatsapp|131026|1013|invalid.?(to|number)/i.test(`${codigo} ${mensagem}`);
}

export async function enviarWhatsappYCloud(mensagem: MensagemWhatsapp, fetchImpl: typeof fetch = fetch): Promise<ResultadoEnvioYCloud> {
  const chave = config.ycloudApiKey.trim();
  const remetente = config.ycloudWhatsappFrom.trim();
  if (chave === '' || remetente === '') throw new ErroYCloudNaoConfigurada();
  if (!/^\+\d{10,15}$/.test(mensagem.para)) {
    throw new ErroEnvioYCloudFalhou(true, 'YCLOUD_DESTINO_INVALIDO: número de WhatsApp de destino fora do formato internacional — nada foi enviado.');
  }

  const corpo =
    mensagem.tipo === 'texto'
      ? { from: remetente, to: mensagem.para, type: 'text', text: { body: mensagem.texto.slice(0, 4096), preview_url: false } }
      : {
          from: remetente,
          to: mensagem.para,
          type: 'template',
          template: {
            name: mensagem.nome,
            language: { code: mensagem.idioma },
            components: [{ type: 'body', parameters: mensagem.parametros.map((text) => ({ type: 'text', text })) }],
          },
        };

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), config.ycloudTimeoutMs);
  let resposta: Response;
  try {
    resposta = await fetchImpl(`${config.ycloudApiUrl.replace(/\/+$/, '')}/whatsapp/messages/sendDirectly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': chave },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (erro) {
    if (erro instanceof Error && erro.name === 'AbortError') {
      throw new ErroEnvioYCloudFalhou(false, `YCLOUD_TIMEOUT: tempo limite excedido (${config.ycloudTimeoutMs}ms) ao chamar a API da YCloud.`);
    }
    throw new ErroEnvioYCloudFalhou(false, 'YCLOUD_CONEXAO: falha de rede ao chamar a API da YCloud.');
  } finally {
    clearTimeout(timeout);
  }

  let dados: Record<string, unknown> = {};
  try {
    dados = (await resposta.json()) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  const codigo = typeof dados.errorCode === 'string' || typeof dados.errorCode === 'number' ? String(dados.errorCode) : '';
  const textoErro = typeof dados.errorMessage === 'string' ? dados.errorMessage : typeof dados.message === 'string' ? dados.message : '';

  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroEnvioYCloudFalhou(false, `YCLOUD_AUTENTICACAO: a YCloud recusou a API key configurada (HTTP ${resposta.status}).`);
    }
    const destino = ehDestinoInvalido(codigo, textoErro);
    const detalhe = sanitizar([codigo, textoErro].filter(Boolean).join(' '));
    throw new ErroEnvioYCloudFalhou(
      destino,
      `${destino ? 'YCLOUD_DESTINO_INVALIDO' : 'YCLOUD_RECUSADO'}: a YCloud respondeu HTTP ${resposta.status}.${detalhe === '' ? '' : ` Detalhe: ${detalhe}`}`,
    );
  }

  const status = typeof dados.status === 'string' ? dados.status : 'desconhecido';
  if (status === 'failed') {
    const destino = ehDestinoInvalido(codigo, textoErro);
    const detalhe = sanitizar([codigo, textoErro].filter(Boolean).join(' '));
    throw new ErroEnvioYCloudFalhou(destino, `${destino ? 'YCLOUD_DESTINO_INVALIDO' : 'YCLOUD_FALHOU'}: a YCloud não conseguiu enviar.${detalhe === '' ? '' : ` Detalhe: ${detalhe}`}`);
  }
  const ycloudMessageId = typeof dados.id === 'string' ? dados.id : '';
  if (ycloudMessageId === '') throw new ErroEnvioYCloudFalhou(false, 'YCLOUD_RESPOSTA_INVALIDA: a YCloud não devolveu o id da mensagem.');
  const wamid = typeof dados.wamid === 'string' && dados.wamid.trim() !== '' ? dados.wamid.trim() : null;
  return { ycloudMessageId, wamid, status };
}
