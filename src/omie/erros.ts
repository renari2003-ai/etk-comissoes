/**
 * Erro originado na API da Omie: HTTP 200 com faultstring/faultcode indicando
 * falha (seção 7), ou HTTP de erro. Deve virar HTTP 502 na API interna.
 */
export class OmieError extends Error {
  constructor(
    message: string,
    public readonly faultcode?: string,
  ) {
    super(message);
    this.name = 'OmieError';
  }
}

/**
 * Erro de rede/timeout ou resposta que não é JSON válido — candidato a retry
 * (`Limitador.executar`). Estende `OmieError` (BUG corrigido em 2026-09-10:
 * antes não estendia, então esgotar as tentativas de retry fazia o erro cair
 * no tratador genérico de `erroHttp.ts` como HTTP 500 "erro interno", em vez
 * do 502 "A consulta à Omie falhou" — confuso para quem só via um pedido de
 * comissionamento falhar durante uso normal, sem saber que era a própria
 * Omie temporariamente indisponível/limitando as requisições).
 */
export class OmieErroTransitorio extends OmieError {
  constructor(message: string) {
    super(message);
    this.name = 'OmieErroTransitorio';
  }
}

/**
 * Indica excesso de requisições (HTTP 425 ou faultcode/faultstring
 * correspondente, incluindo "consumo redundante") — candidato a retry. Ver
 * nota de `OmieErroTransitorio` sobre por que precisa estender `OmieError`.
 */
export class OmieErroLimiteExcedido extends OmieError {
  constructor(message: string) {
    super(message);
    this.name = 'OmieErroLimiteExcedido';
  }
}

/** Verifica no corpo JSON da resposta se a Omie sinalizou erro, mesmo com HTTP 200. */
export function verificarFalhaNoCorpo(corpo: unknown): { faultcode?: string; faultstring?: string } | null {
  if (typeof corpo !== 'object' || corpo === null) return null;
  const registro = corpo as Record<string, unknown>;
  const faultstring = typeof registro.faultstring === 'string' ? registro.faultstring : undefined;
  const faultcode = typeof registro.faultcode === 'string' ? registro.faultcode : undefined;
  if (faultstring !== undefined || faultcode !== undefined) {
    return { faultcode, faultstring };
  }
  return null;
}

export function indicaLimiteExcedido(faultcode?: string, faultstring?: string): boolean {
  return (faultcode ?? '').includes('425') || (faultstring ?? '').includes('425');
}
