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

  // Nunca corta o texto em silêncio (2026-10-06): acima do limite do WhatsApp, nada é enviado.
  if (mensagem.tipo === 'texto' && mensagem.texto.length > 4096) {
    throw new ErroEnvioYCloudFalhou(false, `YCLOUD_MENSAGEM_LONGA: a mensagem tem ${mensagem.texto.length} caracteres (limite 4096) — nada foi enviado.`);
  }
  // Template: cada parâmetro do corpo tem limite de 1024 caracteres (referência da API YCloud) — nunca cortado.
  if (mensagem.tipo === 'template') {
    const indice = mensagem.parametros.findIndex((p) => p.length > 1024);
    if (indice >= 0) {
      throw new ErroEnvioYCloudFalhou(
        false,
        `YCLOUD_PARAMETRO_LONGO: o parâmetro {{${indice + 1}}} tem ${mensagem.parametros[indice]!.length} caracteres (limite 1024) — nada foi enviado.`,
      );
    }
  }
  const corpo =
    mensagem.tipo === 'texto'
      ? { from: remetente, to: mensagem.para, type: 'text', text: { body: mensagem.texto, preview_url: false } }
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
  const erroApi = dados.error !== null && typeof dados.error === 'object' && !Array.isArray(dados.error)
    ? dados.error as Record<string, unknown> : {};
  const codigoBruto = erroApi.code ?? dados.errorCode;
  const codigo = typeof codigoBruto === 'string' || typeof codigoBruto === 'number' ? String(codigoBruto) : '';
  const textoErro = typeof erroApi.message === 'string' ? erroApi.message : typeof dados.errorMessage === 'string' ? dados.errorMessage : typeof dados.message === 'string' ? dados.message : '';
  const motivos: Record<string, string> = {
    ACCOUNT_LIMITED: 'Conta limitada: confira os destinatários autorizados para teste.',
    ACCOUNT_UNAVAILABLE: 'Conta indisponível: consulte o suporte YCloud.',
    BALANCE_INSUFFICIENT: 'Saldo insuficiente na YCloud.',
    WHATSAPP_PHONE_NUMBER_UNAVAILABLE: 'Número remetente de WhatsApp indisponível: confira sua vinculação na YCloud.',
    WHATSAPP_TEMPLATE_UNAVAILABLE: 'Template indisponível: confira o nome, idioma e aprovação pela Meta.',
    WHATSAPP_WABA_UNAVAILABLE: 'Conta WhatsApp Business indisponível.',
    RECIPIENT_IN_BLOCK_LIST: 'Destinatário bloqueado na YCloud.',
    RECIPIENT_UNSUBSCRIBED: 'Destinatário cancelou o recebimento de mensagens.',
    CONTENT_PROHIBITED: 'Conteúdo recusado pela YCloud.',
    UNAUTHORIZED: 'Autenticação recusada pela YCloud.',
  };

  if (!resposta.ok) {
    if (resposta.status === 401) {
      const detalhe = sanitizar([codigo, textoErro].filter(Boolean).join(' '));
      throw new ErroEnvioYCloudFalhou(false, `YCLOUD_AUTENTICACAO: a YCloud recusou a autenticação (HTTP 401).${detalhe ? ` Detalhe: ${detalhe}` : ''}`);
    }
    if (resposta.status === 403) {
      const conhecido = Object.prototype.hasOwnProperty.call(motivos, codigo);
      const detalhe = sanitizar(textoErro);
      throw new ErroEnvioYCloudFalhou(false,
        `YCLOUD_RECUSADO: envio negado (HTTP 403).${conhecido ? ` ${codigo}: ${motivos[codigo]}` : codigo ? ` Código: ${sanitizar(codigo)}.` : ''}${detalhe ? ` Detalhe: ${detalhe}` : ''}`);
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
