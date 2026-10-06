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
  /** REDUNDANT reinicia a janela de 60s a cada falha. Nunca repetir com backoff curto. */
  readonly esperaMinimaMs: number;
  constructor(message: string, faultcode?: string) {
    super(message, faultcode);
    this.name = 'OmieErroLimiteExcedido';
    const segundos = /aguarde\s+(\d+)\s+segundos?/i.exec(message);
    const redundante = /redundan/i.test(`${message} ${faultcode ?? ''}`);
    this.esperaMinimaMs = redundante || segundos !== null
      ? (Math.max(redundante ? 60 : 0, Number(segundos?.[1] ?? 0)) + 1) * 1000
      : 0;
  }
}

/**
 * "Já existe uma requisição desse método sendo executada" — faultcode `SOAP-ENV:Client-1880`, HTTP
 * 500 (confirmado contra a API real em 2026-10-06, em `ListarContasReceber`). A Omie recusa a MESMA
 * consulta (método + parâmetros) enquanto considera outra igual em execução — outras consultas do
 * mesmo método passam normalmente. Temporário: medido ao vivo, a mesma consulta voltou a 1880 após
 * 10 s e respondeu após ~60 s. Candidato a retry com política própria (ver `Limitador.executar`):
 * a 3ª consulta idêntica em menos de 60 s vira REDUNDANT, então as esperas são 10 s e depois 61 s.
 */
export class OmieErroMetodoEmExecucao extends OmieError {
  constructor(message: string, faultcode?: string) {
    super(message, faultcode);
    this.name = 'OmieErroMetodoEmExecucao';
  }
}

export function indicaMetodoEmExecucao(faultcode?: string, faultstring?: string): boolean {
  return /Client-1880\b/.test(faultcode ?? '') || /j[áa] existe uma requisi[çc][ãa]o desse m[ée]todo sendo executada/i.test(faultstring ?? '');
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
  return /425|redundan/i.test(`${faultcode ?? ''} ${faultstring ?? ''}`);
}
