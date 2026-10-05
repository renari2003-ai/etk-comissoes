/**
 * Mensagem de WhatsApp da solicitação de cotação (Fase 3). Mesmos dados do e-mail
 * (`linhasDadosCotacao`) — referência, CNPJs, modalidade, peso, volumes, embalagens,
 * observações/TDE — e os mesmos campos de resposta, para o mesmo extrator ler a resposta.
 * Só dados logísticos (contrato `PayloadSolicitacaoN8n`), nunca dado comercial interno.
 */
import { CAMPOS_RESPOSTA, linhasDadosCotacao } from '../email/templateCotacao.js';
import type { PayloadSolicitacaoN8n } from '../integracoes/n8nCliente.js';

/** Texto livre (dentro da janela de 24h da conversa). */
export function montarTextoWhatsapp(payload: PayloadSolicitacaoN8n): string {
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

/** Parâmetros do WhatsApp não aceitam quebra de linha/tab nem 4+ espaços seguidos. */
function parametro(texto: string | undefined): string {
  const limpo = (texto ?? '—').replace(/[\r\n\t]+/g, ' | ').replace(/ {4,}/g, ' ').trim();
  return (limpo === '' ? '—' : limpo).slice(0, 1000);
}

/**
 * Parâmetros do template aprovado (fora da janela de 24h), NESTA ordem — o template na YCloud
 * deve usar {{1}}..{{6}} assim:
 *   {{1}} referência · {{2}} origem · {{3}} destino · {{4}} carga (modalidade, peso, volumes)
 *   {{5}} embalagens · {{6}} observações
 */
export function parametrosTemplateWhatsapp(payload: PayloadSolicitacaoN8n): string[] {
  const mapa = new Map(linhasDadosCotacao(payload));
  const origem = [mapa.get('Origem'), mapa.get('CNPJ Origem') ? `CNPJ ${mapa.get('CNPJ Origem')}` : undefined].filter(Boolean).join(' - ');
  const destino = [mapa.get('Destino'), mapa.get('CNPJ Destino') ? `CNPJ ${mapa.get('CNPJ Destino')}` : undefined].filter(Boolean).join(' - ');
  const carga = [mapa.get('Modalidade'), mapa.get('Peso total'), mapa.get('Total de volumes') ? `${mapa.get('Total de volumes')} volumes` : undefined]
    .filter(Boolean)
    .join(' - ');
  return [payload.referencia, origem, destino, carga, mapa.get('Embalagens'), mapa.get('Observações')].map((v) => parametro(v || undefined));
}
