/** Sanitização compartilhada pelos clientes de integração (n8n, SMTP) — nada aqui faz I/O. */

/**
 * Remove do texto qualquer coisa com cara de credencial antes de persistir/auditar: o próprio
 * segredo configurado, comandos SMTP `AUTH`, cabeçalhos/pares `chave=valor` sensíveis, tokens Bearer/Basic, JWTs e
 * sequências longas tipo chave de API.
 */
export function sanitizarTextoErro(texto: string, segredos: readonly string[] = []): string {
  let resultado = texto;
  for (const segredo of segredos) {
    if (segredo.trim().length >= 4) resultado = resultado.split(segredo.trim()).join('[oculto]');
  }
  return resultado
    .replace(/\bAUTH\s+(PLAIN|LOGIN|XOAUTH2|CRAM-MD5)\s+\S+/gi, 'AUTH $1 [oculto]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [oculto]')
    .replace(
      /(["']?[\w-]*(?:secret|segredo|token|senha|password|passwd|pwd|api[_-]?key|apikey|authorization|credential|credencial|cookie|session)[\w-]*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      '$1[oculto]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[oculto]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[oculto]');
}
