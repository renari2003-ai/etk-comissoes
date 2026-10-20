/**
 * Endereço de destino efetivamente enviado numa solicitação de cotação (2026-10-06) — função
 * pura, fonte única para e-mail, WhatsApp e payload n8n.
 *
 * Regra: se a cotação tem destino ESTRUTURADO (importada da Omie, com ou sem substituição manual
 * pelo operador), usa-se ele inteiro — CEP, logradouro, número, complemento, bairro, cidade, UF —
 * e o texto é montado a partir desses campos. Sem estrutura (cotação manual antiga, só texto
 * livre), usa-se o texto e o CEP como sempre. Nunca mistura partes de duas fontes.
 */
import { formatarDestinoTexto } from './omieFretes.js';
import type { CotacaoFrete, DestinoEnviado, SolicitacaoCotacao } from './tipos.js';

function digitosCep(cep: string | null | undefined): string {
  return (cep ?? '').replace(/\D/g, '');
}

/**
 * A solicitação foi registrada com um CEP diferente do CEP atual (válido) da cotação — ex.: o
 * operador completou/corrigiu o CEP depois do envio (2026-10-20). O snapshot NÃO é alterado
 * (histórico e "Reenviar" continuam com o endereço original); isto só sinaliza que o CEP
 * atualizado exige uma NOVA solicitação. Solicitação antiga sem snapshot usa o destino atual da
 * cotação, então nunca fica desatualizada.
 */
export function cepDestinoDesatualizado(solicitacao: Pick<SolicitacaoCotacao, 'destinoEnviado'>, cotacao: Pick<CotacaoFrete, 'cepDestino'>): boolean {
  if (solicitacao.destinoEnviado === null || solicitacao.destinoEnviado === undefined) return false;
  const atual = digitosCep(cotacao.cepDestino);
  return atual.length === 8 && digitosCep(solicitacao.destinoEnviado.cep) !== atual;
}

function textoOuNulo(valor: string | null | undefined): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

export function montarDestinoEnviado(cotacao: CotacaoFrete): DestinoEnviado {
  const estruturado = {
    cep: textoOuNulo(cotacao.cepDestino),
    logradouro: textoOuNulo(cotacao.logradouroDestino),
    numero: textoOuNulo(cotacao.numeroDestino),
    complemento: textoOuNulo(cotacao.complementoDestino),
    bairro: textoOuNulo(cotacao.bairroDestino),
    cidade: textoOuNulo(cotacao.cidadeDestino),
    uf: textoOuNulo(cotacao.ufDestino),
  };
  const temEstrutura =
    cotacao.origemDestino !== null &&
    [estruturado.logradouro, estruturado.numero, estruturado.complemento, estruturado.bairro, estruturado.cidade, estruturado.uf].some((v) => v !== null);
  if (temEstrutura) {
    return {
      origem: cotacao.origemDestino,
      ...estruturado,
      texto: formatarDestinoTexto({ origem: cotacao.origemDestino ?? 'MANUAL', codigoMunicipio: null, ...estruturado }),
    };
  }
  // Texto livre (cotação manual): exatamente o que o operador digitou, sem completar com nada.
  return {
    origem: cotacao.origemDestino,
    cep: estruturado.cep,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    texto: textoOuNulo(cotacao.destino),
  };
}
