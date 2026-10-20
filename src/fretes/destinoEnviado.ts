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

/** Texto do destino sem acento, caixa, pontuação nem espaços repetidos — só para comparar. */
function normalizarTextoDestino(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Mesmo destino de entrega? Compara CEP (só dígitos) e o texto do endereço normalizado (que já
 * reúne logradouro, número, complemento, bairro e cidade/UF). Máscara, espaços, caixa, acentos e
 * pontuação não contam como mudança; a origem do endereço (PEDIDO/MANUAL...) também não.
 */
export function mesmoDestino(a: Pick<DestinoEnviado, 'cep' | 'texto'>, b: Pick<DestinoEnviado, 'cep' | 'texto'>): boolean {
  return digitosCep(a.cep) === digitosCep(b.cep) && normalizarTextoDestino(a.texto) === normalizarTextoDestino(b.texto);
}

/**
 * A solicitação foi registrada com um destino (endereço e/ou CEP) diferente do destino atual da
 * cotação — o operador corrigiu depois do envio (2026-10-20). O snapshot NÃO é alterado (histórico
 * e "Reenviar" continuam com os dados originais); isto só sinaliza que o destino atual exige uma
 * NOVA solicitação. Solicitação antiga sem snapshot usa o destino atual da cotação, então nunca
 * fica desatualizada; destino atual vazio nunca justifica nova solicitação.
 */
export function destinoEnviadoDesatualizado(solicitacao: Pick<SolicitacaoCotacao, 'destinoEnviado'>, cotacao: CotacaoFrete): boolean {
  if (solicitacao.destinoEnviado === null || solicitacao.destinoEnviado === undefined) return false;
  const atual = montarDestinoEnviado(cotacao);
  const atualUtilizavel = digitosCep(atual.cep).length === 8 || normalizarTextoDestino(atual.texto) !== '';
  return atualUtilizavel && !mesmoDestino(solicitacao.destinoEnviado, atual);
}

/**
 * COMPATIBILIDADE TEMPORÁRIA (semântica do commit 2bc0021): compara SÓ o CEP. Mantido para abas
 * abertas com o frontend anterior, que ainda leem `cepDestinoDesatualizado`. A regra vigente
 * (envio e tela nova) é `destinoEnviadoDesatualizado`. Remover quando não houver mais clientes antigos.
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
