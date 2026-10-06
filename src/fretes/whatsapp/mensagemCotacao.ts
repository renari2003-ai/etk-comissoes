/**
 * Mensagem de WhatsApp da solicitação de cotação (Fase 3). Mesmos dados do e-mail
 * (`linhasDadosCotacao`) — referência, CNPJs, modalidade, peso, volumes, embalagens,
 * observações/TDE — e os mesmos campos de resposta, para o mesmo extrator ler a resposta.
 * Só dados logísticos (contrato `PayloadSolicitacaoN8n`), nunca dado comercial interno.
 */
import { ErroValidacao } from '../../validacao.js';
import { CAMPOS_RESPOSTA, linhasDadosCotacao, ROTULO_OBSERVACOES_TRANSPORTADORA } from '../email/templateCotacao.js';
import type { PayloadSolicitacaoN8n } from '../integracoes/n8nCliente.js';

/**
 * Limite do corpo de uma mensagem de texto do WhatsApp (Cloud API/YCloud). Acima disso a
 * mensagem é RECUSADA com erro explícito — nunca cortada (antes era cortada em silêncio no cliente).
 */
export const LIMITE_TEXTO_WHATSAPP = 4096;

/** Texto livre (dentro da janela de 24h da conversa). Lança `ErroValidacao` acima de `LIMITE_TEXTO_WHATSAPP`. */
export function montarTextoWhatsapp(payload: PayloadSolicitacaoN8n): string {
  const texto = textoWhatsappCompleto(payload);
  if (texto.length > LIMITE_TEXTO_WHATSAPP) throw new ErroValidacao(mensagemLimiteTextoWhatsapp(payload, texto.length));
  return texto;
}

function mensagemLimiteTextoWhatsapp(payload: PayloadSolicitacaoN8n, total: number): string {
  const obsCotacao = payload.logistica.observacoes?.length ?? 0;
  const obsTransportadora = payload.logistica.observacoesTransportadora?.length ?? 0;
  return (
    `A mensagem de WhatsApp ficaria com ${total} caracteres (limite ${LIMITE_TEXTO_WHATSAPP}) — observações da cotação: ${obsCotacao}; ` +
    `"${ROTULO_OBSERVACOES_TRANSPORTADORA}": ${obsTransportadora}; o restante são os dados da carga e os rótulos. Reduza o texto antes de enviar.`
  );
}

function textoWhatsappCompleto(payload: PayloadSolicitacaoN8n): string {
  const linhas = linhasDadosCotacao(payload).map(([rotulo, valor]) => {
    const v = valor.replace(/\n/g, '\n   ');
    return rotulo === 'Observações' && /\bTDE\b/i.test(valor) ? `*${rotulo}:* ⚠️ ${v}` : `*${rotulo}:* ${v}`;
  });
  return [
    `*Cotação de Frete ETK | ${payload.referencia}*`,
    '',
    'Olá! A ETK Indústria e Comércio solicita sua cotação de frete para a operação abaixo.',
    '',
    ...linhas,
    '',
    'Por favor, *responda a esta mensagem* (toque e segure → Responder) informando:',
    ...CAMPOS_RESPOSTA.map((c) => `${c}:`),
  ].join('\n');
}

/** Limite por parâmetro do template já usado por este envio (mantido). */
/**
 * Limite do TEXTO de cada parâmetro do corpo do template (YCloud, "Send a message directly":
 * "For body components, the character limit is 1024 characters"; alinhado ao corpo de template da
 * Meta, máx. 1024). Antes era 1000 e os parâmetros {{1}}..{{5}} eram cortados em silêncio; desde
 * 2026-10-06 qualquer parâmetro acima do limite é RECUSADO com erro explícito, nunca cortado.
 */
export const LIMITE_PARAMETRO_TEMPLATE_WHATSAPP = 1024;

/** Nome de cada parâmetro do template aprovado, para mensagens de erro acionáveis. */
const NOMES_PARAMETROS_TEMPLATE = ['{{1}} referência', '{{2}} origem', '{{3}} destino', '{{4}} carga', '{{5}} embalagens', '{{6}} observações'] as const;

/** Parâmetros do WhatsApp não aceitam quebra de linha/tab nem 4+ espaços seguidos. */
function normalizarParametro(texto: string | undefined): string {
  const limpo = (texto ?? '—').replace(/[\r\n\t]+/g, ' | ').replace(/ {4,}/g, ' ').trim();
  return limpo === '' ? '—' : limpo;
}

/** Parâmetro normalizado; acima do limite lança `ErroValidacao` dizendo QUAL parâmetro e o tamanho — nunca corta. */
function parametro(indice: number, texto: string | undefined): string {
  const valor = normalizarParametro(texto);
  if (valor.length > LIMITE_PARAMETRO_TEMPLATE_WHATSAPP) {
    throw new ErroValidacao(
      `O parâmetro ${NOMES_PARAMETROS_TEMPLATE[indice]} do template de WhatsApp ficaria com ${valor.length} caracteres (limite ${LIMITE_PARAMETRO_TEMPLATE_WHATSAPP}) — reduza os dados antes de enviar (ex.: menos tipos de embalagem) ou envie por e-mail.`,
    );
  }
  return valor;
}

/**
 * Parâmetro {{6}} do template aprovado: observações da cotação + "Observações para a
 * transportadora" desta solicitação, no MESMO parâmetro (o template continua com 6 parâmetros —
 * nenhum novo). Quebras de linha viram " | " (limitação do WhatsApp para parâmetros). Nunca é
 * cortado em silêncio: acima do limite, devolve `null` para o chamador recusar o envio.
 */
export function parametroObservacoesTemplate(observacoesCotacao: string | undefined, observacoesTransportadora: string | undefined): string | null {
  const partes = [
    observacoesCotacao !== undefined && observacoesCotacao.trim() !== '' ? observacoesCotacao : null,
    observacoesTransportadora !== undefined && observacoesTransportadora.trim() !== '' ? `${ROTULO_OBSERVACOES_TRANSPORTADORA}: ${observacoesTransportadora}` : null,
  ].filter((p): p is string => p !== null);
  const valor = normalizarParametro(partes.length > 0 ? partes.join(' | ') : undefined);
  return valor.length > LIMITE_PARAMETRO_TEMPLATE_WHATSAPP ? null : valor;
}

export const MENSAGEM_LIMITE_TEMPLATE_WHATSAPP =
  `As observações (da cotação + "${ROTULO_OBSERVACOES_TRANSPORTADORA}") excedem o limite de ${LIMITE_PARAMETRO_TEMPLATE_WHATSAPP} caracteres do template de WhatsApp — reduza o texto antes de enviar.`;

/** Mesma mensagem, com a composição do total (observações da cotação + rótulo/separadores + observação desta transportadora). */
export function mensagemLimiteTemplateWhatsapp(observacoesCotacao: string | undefined, observacoesTransportadora: string | undefined): string {
  const cotacao = normalizarOpcional(observacoesCotacao);
  const transportadora = normalizarOpcional(observacoesTransportadora);
  const total = normalizarParametro(
    [cotacao, transportadora !== null ? `${ROTULO_OBSERVACOES_TRANSPORTADORA}: ${transportadora}` : null].filter((p) => p !== null).join(' | ') || undefined,
  ).length;
  const rotulos = total - (cotacao?.length ?? 0) - (transportadora?.length ?? 0);
  return (
    `${MENSAGEM_LIMITE_TEMPLATE_WHATSAPP} Total: ${total} caracteres = observações da cotação (${cotacao?.length ?? 0}) + ` +
    `rótulo e separadores (${rotulos}) + "${ROTULO_OBSERVACOES_TRANSPORTADORA}" (${transportadora?.length ?? 0}).`
  );
}

function normalizarOpcional(texto: string | undefined | null): string | null {
  return texto === undefined || texto === null || texto.trim() === '' ? null : normalizarParametro(texto);
}

export type ModoEnvioWhatsapp = 'TEMPLATE' | 'TEXTO';

/**
 * Verificação ANTES de criar a solicitação: a mensagem que será enviada cabe no limite do modo
 * em uso? Devolve a mensagem do problema (com a composição do total) ou `null`. Nunca corta.
 */
export function problemaLimiteWhatsapp(payload: PayloadSolicitacaoN8n, modo: ModoEnvioWhatsapp): string | null {
  if (modo === 'TEMPLATE') {
    // Os 6 parâmetros, com as mesmas regras do envio real ({{1}}..{{6}}).
    try {
      parametrosTemplateWhatsapp(payload);
      return null;
    } catch (erro) {
      if (erro instanceof ErroValidacao) return erro.message;
      throw erro;
    }
  }
  const total = textoWhatsappCompleto(payload).length;
  return total > LIMITE_TEXTO_WHATSAPP ? mensagemLimiteTextoWhatsapp(payload, total) : null;
}

/**
 * Parâmetros do template aprovado (fora da janela de 24h), NESTA ordem — o template na YCloud
 * deve usar {{1}}..{{6}} assim:
 *   {{1}} referência · {{2}} origem · {{3}} destino · {{4}} carga (modalidade, peso, volumes)
 *   {{5}} embalagens · {{6}} observações (da cotação + "Observações para a transportadora" desta solicitação)
 */
export function parametrosTemplateWhatsapp(payload: PayloadSolicitacaoN8n): string[] {
  const mapa = new Map(linhasDadosCotacao(payload));
  const origem = [mapa.get('Origem'), mapa.get('CNPJ Origem') ? `CNPJ ${mapa.get('CNPJ Origem')}` : undefined].filter(Boolean).join(' - ');
  const destino = [mapa.get('Destino'), mapa.get('CNPJ Destino') ? `CNPJ ${mapa.get('CNPJ Destino')}` : undefined].filter(Boolean).join(' - ');
  const carga = [mapa.get('Modalidade'), mapa.get('Peso total'), mapa.get('Total de volumes') ? `${mapa.get('Total de volumes')} volumes` : undefined]
    .filter(Boolean)
    .join(' - ');
  const observacoes = parametroObservacoesTemplate(mapa.get('Observações'), mapa.get(ROTULO_OBSERVACOES_TRANSPORTADORA));
  if (observacoes === null) throw new ErroValidacao(mensagemLimiteTemplateWhatsapp(mapa.get('Observações'), mapa.get(ROTULO_OBSERVACOES_TRANSPORTADORA)));
  return [...[payload.referencia, origem, destino, carga, mapa.get('Embalagens')].map((v, i) => parametro(i, v || undefined)), observacoes];
}
