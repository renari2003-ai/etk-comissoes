import { ErroSemPermissao } from '../auth/erros.js';
import type { UsuarioPublico } from '../auth/tipos.js';

/**
 * Relatório de Comissionamento para o papel "vendedor" (regra de 2026-09-28): o vendedor só
 * enxerga a si mesmo. O filtro é SEMPRE o `vendedorOmieId` vinculado ao usuário autenticado —
 * qualquer `vendedor` vindo do navegador é ignorado. Sem vínculo, bloqueia com mensagem clara
 * em vez de devolver "todos". Os demais papéis mantêm o filtro escolhido na tela.
 */
export function resolverVendedorDoRelatorio(usuario: UsuarioPublico, codigoSolicitado: number | undefined): number | undefined {
  if (usuario.papel !== 'vendedor') return codigoSolicitado;
  return exigirVinculoVendedor(usuario);
}

export function exigirVinculoVendedor(usuario: UsuarioPublico): number {
  if (usuario.vendedorOmieId === null) {
    throw new ErroSemPermissao(
      'Seu usuário de vendedor ainda não está vinculado a um vendedor da Omie — peça ao administrador para fazer o vínculo.',
    );
  }
  return usuario.vendedorOmieId;
}
