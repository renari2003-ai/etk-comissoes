/**
 * Origem fixa da ETK e observação padrão de TDE. Definidos SEMPRE no backend — nunca
 * confiam em valor enviado pelo navegador.
 */
export const CEP_ORIGEM_ETK = '37646352';

export const OBSERVACAO_TDE = 'Entrega com data programada, favor incluir a taxa (TDE) na cotação.';

/**
 * Recalcula as observações a partir do texto livre + flag TDE: remove qualquer ocorrência
 * anterior da frase e só a acrescenta (uma vez) quando `incluir` é true — idempotente, então
 * reabrir/recalcular nunca duplica a frase.
 */
export function aplicarObservacaoTde(observacoes: string | null, incluir: boolean): string | null {
  const livre = (observacoes ?? '').split(OBSERVACAO_TDE).join('').replace(/\s{2,}/g, ' ').trim();
  const partes = [livre, incluir ? OBSERVACAO_TDE : ''].filter((p) => p !== '');
  return partes.length === 0 ? null : partes.join(' ');
}
