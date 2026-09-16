/**
 * Resolução do destino de uma cotação importada da Omie (Fase 3.2, seções 10/40) — função
 * pura e testável, única fonte de verdade da regra de prioridade (nunca duplicada na rota,
 * no frontend ou no repositório):
 *
 *   PEDIDO (endereço específico do pedido) > CLIENTE_ENTREGA (enderecoEntrega do cliente)
 *   > CLIENTE_CADASTRAL (endereço cadastral do cliente).
 *
 * Baseada nas investigações reais confirmadas em 2026-09-16 (Prompts 3.1.1/3.1.2/3.1.3):
 * a Omie pode fornecer até três endereços distintos, nenhum deles garantidamente preenchido.
 */

import type { EnderecoDestino, OrigemEndereco } from './tipos.js';

export type CandidatoEndereco = Omit<EnderecoDestino, 'origem'>;

/**
 * Um candidato só é considerado um endereço USÁVEL (seção 11) se tiver CEP preenchido, ou
 * logradouro + cidade preenchidos (CEP pode faltar mesmo em endereços reais digitados sem
 * máscara/validação na Omie). A mera existência do objeto (ex.: `enderecoEntrega` presente
 * mas com todos os campos vazios) nunca é suficiente — ver seção 11/caso 5.
 */
function enderecoUtilizavel(candidato: CandidatoEndereco | null): boolean {
  if (candidato === null) return false;
  const cep = (candidato.cep ?? '').trim();
  const logradouro = (candidato.logradouro ?? '').trim();
  const cidade = (candidato.cidade ?? '').trim();
  return cep !== '' || (logradouro !== '' && cidade !== '');
}

export interface CandidatosDestino {
  pedido: CandidatoEndereco | null;
  clienteEntrega: CandidatoEndereco | null;
  clienteCadastral: CandidatoEndereco | null;
}

/** Retorna `null` quando nenhuma das três fontes tem um endereço usável (seção 4/caso 4) — nunca inventa um destino. */
export function resolverDestinoFrete(candidatos: CandidatosDestino): EnderecoDestino | null {
  const ordem: Array<[OrigemEndereco, CandidatoEndereco | null]> = [
    ['PEDIDO', candidatos.pedido],
    ['CLIENTE_ENTREGA', candidatos.clienteEntrega],
    ['CLIENTE_CADASTRAL', candidatos.clienteCadastral],
  ];
  for (const [origem, candidato] of ordem) {
    if (enderecoUtilizavel(candidato)) {
      return { origem, ...(candidato as CandidatoEndereco) };
    }
  }
  return null;
}
