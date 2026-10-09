import { config } from '../../config.js';
import { sanitizarTextoErro } from './sanitizacao.js';

export interface TemplateMeta { para: string; nome: string; idioma: string; parametros: string[] }
export interface OpcoesMeta { token?: string; phoneNumberId?: string; versao?: string; timeoutMs?: number; fetchImpl?: typeof fetch }

/** Apenas template para iniciar cotações; não tenta texto livre como fallback. */
export async function enviarTemplateMeta(m: TemplateMeta, opcoes: OpcoesMeta = {}): Promise<{ wamid: string }> {
  const token = opcoes.token ?? config.metaAccessToken;
  const phoneId = opcoes.phoneNumberId ?? config.metaPhoneNumberId;
  const versao = opcoes.versao ?? config.metaGraphVersion;
  if (!token || !/^\d{5,30}$/.test(phoneId) || !/^v\d+\.\d+$/.test(versao)) throw new Error('META_NAO_CONFIGURADA: configure token, identificador do telefone e versão da API.');
  if (!/^\+?[1-9]\d{7,14}$/.test(m.para) || !/^[a-z0-9_]{1,512}$/.test(m.nome) || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(m.idioma) || m.parametros.length !== 6 || m.parametros.some((p) => !p.trim() || p.length > 1024)) throw new Error('META_TEMPLATE_INVALIDO: confira destinatário, nome, idioma e os seis parâmetros do template.');
  const controle = new AbortController();
  const timeout = setTimeout(() => controle.abort(), opcoes.timeoutMs ?? config.metaTimeoutMs);
  try {
    let resposta: Response;
    try {
      resposta = await (opcoes.fetchImpl ?? fetch)(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
        method: 'POST', signal: controle.signal, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: m.para.replace(/^\+/, ''), type: 'template', template: { name: m.nome, language: { code: m.idioma }, components: [{ type: 'body', parameters: m.parametros.map((text) => ({ type: 'text', text })) }] } }),
      });
    } catch (erro) {
      throw new Error(erro instanceof Error && erro.name === 'AbortError' ? 'META_TIMEOUT: tempo limite excedido; confira o status antes de reenviar.' : 'META_REDE: falha de rede; confira o status antes de reenviar.');
    }
    const json = await resposta.json().catch(() => null) as { error?: { code?: unknown; message?: unknown; error_data?: { details?: unknown } }; messages?: { id?: unknown }[] } | null;
    if (!resposta.ok || json?.error) {
      const codigo = typeof json?.error?.code === 'number' ? json.error.code : resposta.status;
      const detalhe = [json?.error?.message, json?.error?.error_data?.details].filter((v): v is string => typeof v === 'string').join(' ');
      throw new Error(`META_RECUSADO: HTTP ${resposta.status}, código ${codigo}. ${sanitizarTextoErro(detalhe, [token, config.metaAppSecret]).slice(0, 600)}`);
    }
    const id = json?.messages?.[0]?.id;
    if (typeof id !== 'string' || !id.startsWith('wamid.') || id.length > 300) throw new Error('META_RESPOSTA_INVALIDA: envio sem WAMID confirmado.');
    return { wamid: id };
  } finally { clearTimeout(timeout); }
}
