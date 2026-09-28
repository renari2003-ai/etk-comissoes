import type { NextFunction, Request, Response } from 'express';
import type { ClienteOmie, Vendedor } from '../omie/cliente.js';
import type { UsuarioPublico } from './tipos.js';

/**
 * Vínculo usuário ↔ vendedor Omie por NOME (regra de 2026-09-28). Os documentos da Omie e as
 * cotações de frete continuam guardando só o código do vendedor; o nome vinculado ao usuário é
 * convertido, a cada requisição, em todos os códigos cujo nome na Omie é IGUAL — comparação
 * técnica só com trim e maiúsculas/minúsculas, nunca aproximada (nomes parecidos não casam).
 * A lista vem de `listarVendedores` (consulta somente leitura, já usada pelos relatórios).
 */

export const MENSAGEM_VENDEDOR_SEM_VINCULO =
  'Seu usuário ainda não está vinculado a um vendedor da Omie. Peça ao administrador para fazer o vínculo.';

export function normalizarNomeVendedor(nome: string): string {
  return nome.trim().toLocaleLowerCase('pt-BR');
}

export function mesmoNomeVendedor(a: string, b: string): boolean {
  return normalizarNomeVendedor(a) === normalizarNomeVendedor(b);
}

/** Nome vinculado ou `null` — `undefined` (objeto montado sem o campo) conta como sem vínculo, nunca como "vinculado". */
export function nomeVendedorVinculado(usuario: UsuarioPublico): string | null {
  return usuario.vendedorOmieNome ?? null;
}

export function codigosPorNome(vendedores: Vendedor[], nome: string): number[] {
  return vendedores.filter((vendedor) => mesmoNomeVendedor(vendedor.nome, nome)).map((vendedor) => vendedor.codigo);
}

/**
 * Códigos Omie que representam "o próprio vendedor" deste usuário:
 * - com `vendedorOmieNome`: os códigos resolvidos pelo middleware (nunca o nome sem resolver);
 * - papel "vendedor" sem nome: nenhum (o código legado não vale mais para vendedor);
 * - demais papéis sem nome: o `vendedorOmieId` legado, se houver (compatibilidade).
 */
export function codigosVendedorVinculados(usuario: UsuarioPublico): number[] {
  if (nomeVendedorVinculado(usuario) !== null) return usuario.codigosVendedorOmie ?? [];
  if (usuario.papel === 'vendedor') return [];
  return usuario.vendedorOmieId !== null ? [usuario.vendedorOmieId] : [];
}

/**
 * Preenche `req.usuario.codigosVendedorOmie` a partir do nome vinculado. Deve vir DEPOIS de
 * `exigirAutenticacao`. Só consulta a Omie quando o usuário tem nome vinculado; se a consulta
 * falhar, a requisição falha (nunca cai para "todos os vendedores").
 */
export function resolverVinculoVendedor(cliente: Pick<ClienteOmie, 'listarVendedores'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const usuario = req.usuario;
    const nome = usuario === undefined ? null : nomeVendedorVinculado(usuario);
    if (usuario === undefined || nome === null) {
      next();
      return;
    }
    cliente
      .listarVendedores()
      .then((vendedores) => {
        req.usuario = { ...usuario, codigosVendedorOmie: codigosPorNome(vendedores, nome) };
        next();
      })
      .catch(next);
  };
}
