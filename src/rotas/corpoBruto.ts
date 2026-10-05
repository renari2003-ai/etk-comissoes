import type { IncomingMessage } from 'node:http';

/**
 * Corpo bruto (bytes exatos recebidos) das requisições cujo caminho começa com algum prefixo de
 * `PREFIXOS_COM_CORPO_BRUTO` — necessário para conferir assinaturas HMAC de webhooks (ex.:
 * `YCloud-Signature`), que são calculadas sobre os bytes e não sobre o JSON reinterpretado.
 * Guardado fora do objeto da requisição (WeakMap) e só para essas rotas.
 */
const PREFIXOS_COM_CORPO_BRUTO = ['/api/fretes/integracoes/ycloud/'];
const corpos = new WeakMap<IncomingMessage, Buffer>();

/** Usado como `verify` do `express.json()`. */
export function capturarCorpoBruto(req: IncomingMessage, _res: unknown, buffer: Buffer): void {
  const caminho = req.url ?? '';
  if (PREFIXOS_COM_CORPO_BRUTO.some((p) => caminho.startsWith(p))) corpos.set(req, Buffer.from(buffer));
}

export function obterCorpoBruto(req: IncomingMessage): Buffer | null {
  return corpos.get(req) ?? null;
}
