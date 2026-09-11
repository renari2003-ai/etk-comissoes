export const NOME_COOKIE_SESSAO = 'sessao_etk';

/**
 * Parser manual de cookie (sem depender do pacote `cookie-parser`, mantendo a
 * filosofia do projeto de zero dependências além do `express`). `res.cookie`/
 * `res.clearCookie` do Express já funcionam nativamente para ESCREVER
 * cookies — só a LEITURA de `req.headers.cookie` precisa desse parser.
 */
export function lerCookie(cabecalhoCookie: string | undefined, nome: string): string | null {
  if (cabecalhoCookie === undefined) return null;
  for (const par of cabecalhoCookie.split(';')) {
    const indiceIgual = par.indexOf('=');
    if (indiceIgual === -1) continue;
    const chave = par.slice(0, indiceIgual).trim();
    if (chave === nome) {
      return decodeURIComponent(par.slice(indiceIgual + 1).trim());
    }
  }
  return null;
}
