/**
 * Avisos (tarjas) da formação de preço — gerados pelo CÁLCULO, nunca montados na tela.
 * A tela, a simulação salva e o PDF mostram exatamente esta lista. Spec: `docs/precificacao.md`,
 * seção "Avisos (tarjas)".
 *
 * Níveis:
 * - VERMELHO: bloqueia — o preço não é exibido.
 * - AMARELO: o preço é exibido, marcado "INCOMPLETO – não usar em cotação".
 * - AZUL: informativo.
 */

import { ErroValidacao } from '../validacao.js';

export type NivelAviso = 'VERMELHO' | 'AMARELO' | 'AZUL';

export type CodigoAviso =
  // Vermelhos (bloqueiam)
  | 'PRODUTO_SEM_ESTRUTURA'
  | 'IPI_VENDA_NCM_NAO_CONFIGURADO'
  | 'ALIQUOTA_INTERNA_UF_NAO_CONFIGURADA'
  | 'ICMS_INTERESTADUAL_UF_NAO_CONFIGURADO'
  | 'CLIENTE_INCONSISTENTE'
  | 'OMIE_INDISPONIVEL'
  | 'SEM_PRECO_POSSIVEL'
  // Amarelos (preço incompleto)
  | 'ITEM_SEM_CUSTO'
  | 'ITEM_SEM_NCM_IPI'
  | 'COMPONENTES_NAO_CONSULTADOS'
  | 'ITEM_SEM_DADOS_FISCAIS'
  // Azuis (informativos)
  | 'CUSTO_MANUAL_DIFERENTE_OMIE'
  | 'ORIGEM_NAO_INFORMADA'
  | 'DIFAL_BASE_SIMPLES'
  | 'PARAMETROS_FISCAIS_PROVISORIOS'
  | 'PRECO_CHEIO_INDISPONIVEL'
  // Resultado do modo reverso (vermelho só no bloco do reverso; não bloqueia o preço principal)
  | 'ALVO_ABAIXO_DO_PISO';

export interface Aviso {
  nivel: NivelAviso;
  codigo: CodigoAviso;
  /** Item afetado (código do componente, UF...), ou `null` se o aviso é do cálculo todo. */
  item: string | null;
  /** O que está errado e como resolver, já em linguagem do operador. */
  mensagem: string;
}

/** Erro que interrompe o cálculo e vira tarja VERMELHA (é um `ErroValidacao`: na API, resposta 400). */
export class ErroPrecificacao extends ErroValidacao {
  readonly aviso: Aviso;
  constructor(codigo: CodigoAviso, item: string | null, mensagem: string) {
    super(mensagem);
    this.name = 'ErroPrecificacao';
    this.aviso = { nivel: 'VERMELHO', codigo, item, mensagem };
  }
}

/** Ordem de exibição: vermelho, amarelo, azul (estável dentro do mesmo nível). */
export function ordenarAvisos(avisos: readonly Aviso[]): Aviso[] {
  const peso: Record<NivelAviso, number> = { VERMELHO: 0, AMARELO: 1, AZUL: 2 };
  return avisos.map((a, i) => ({ a, i })).sort((x, y) => peso[x.a.nivel] - peso[y.a.nivel] || x.i - y.i).map(({ a }) => a);
}

/** Preço exibido? Não, se houver qualquer aviso vermelho. */
export function precoBloqueado(avisos: readonly Aviso[]): boolean {
  return avisos.some((a) => a.nivel === 'VERMELHO' && a.codigo !== 'ALVO_ABAIXO_DO_PISO');
}

/** Preço exibido mas marcado "INCOMPLETO – não usar em cotação"? */
export function precoIncompleto(avisos: readonly Aviso[]): boolean {
  return avisos.some((a) => a.nivel === 'AMARELO');
}
