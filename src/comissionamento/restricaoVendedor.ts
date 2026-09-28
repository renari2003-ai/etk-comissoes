import { ErroSemPermissao } from '../auth/erros.js';
import type { UsuarioPublico } from '../auth/tipos.js';
import { codigosVendedorVinculados, MENSAGEM_VENDEDOR_SEM_VINCULO, nomeVendedorVinculado } from '../auth/vinculoVendedor.js';

/**
 * Relatório de Comissionamento para o papel "vendedor" (regra de 2026-09-28): o vendedor só
 * enxerga a si mesmo. O filtro é SEMPRE o vendedor vinculado ao usuário autenticado pelo NOME
 * Omie (`vendedorOmieNome`, convertido em códigos por `resolverVinculoVendedor`) — qualquer
 * `vendedor` vindo do navegador é ignorado. Sem nome vinculado, bloqueia com mensagem clara em
 * vez de devolver "todos". Os demais papéis mantêm o filtro escolhido na tela.
 *
 * Retorno: `undefined` = sem restrição (todos) ou filtro único do admin; lista = códigos do
 * próprio vendedor (pode ser vazia se o nome vinculado não existir mais na Omie).
 */
export function resolverVendedoresDoRelatorio(usuario: UsuarioPublico, codigoSolicitado: number | undefined): number[] | undefined {
  if (usuario.papel !== 'vendedor') return codigoSolicitado === undefined ? undefined : [codigoSolicitado];
  exigirVinculoVendedor(usuario);
  return codigosVendedorVinculados(usuario);
}

export function exigirVinculoVendedor(usuario: UsuarioPublico): void {
  if (nomeVendedorVinculado(usuario) === null) throw new ErroSemPermissao(MENSAGEM_VENDEDOR_SEM_VINCULO);
}
