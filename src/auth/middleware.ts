import type { NextFunction, Request, Response } from 'express';
import { lerCookie, NOME_COOKIE_SESSAO } from './cookies.js';
import { ErroNaoAutenticado, ErroSemPermissao } from './erros.js';
import { validarSessao } from './sessoes.js';
import type { Permissoes, UsuarioPublico } from './tipos.js';
import { buscarPorId } from './usuarios.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Presente somente após `exigirAutenticacao` (nunca contém o hash da senha, ver `UsuarioPublico`). */
      usuario?: UsuarioPublico;
    }
  }
}

/**
 * Lê o cookie de sessão, resolve o usuário logado e popula `req.usuario`.
 * Nunca deixa passar sem sessão válida — 401 (`ErroNaoAutenticado`) via
 * `erroHttp.ts`. Deve ser o primeiro middleware de qualquer rota protegida
 * (as demais, como `exigirPermissao`, dependem de `req.usuario` já estar
 * preenchido).
 */
export function exigirAutenticacao(req: Request, _res: Response, next: NextFunction): void {
  const token = lerCookie(req.headers.cookie, NOME_COOKIE_SESSAO);
  if (token === null) {
    next(new ErroNaoAutenticado());
    return;
  }
  (async () => {
    const usuarioId = await validarSessao(token);
    if (usuarioId === null) {
      next(new ErroNaoAutenticado('Sua sessão expirou — faça login novamente.'));
      return;
    }
    const usuario = await buscarPorId(usuarioId);
    if (usuario === null) {
      next(new ErroNaoAutenticado());
      return;
    }
    const { senhaHash: _senhaHash, ...publico } = usuario;
    req.usuario = publico;
    next();
  })().catch(next);
}

/**
 * Exige a permissão `chave` para o papel "convidado" — "administrador"
 * sempre passa, ignorando `permissoes` por completo (regra de negócio:
 * administrador tem acesso total, sempre). Deve vir DEPOIS de
 * `exigirAutenticacao` na cadeia de middlewares.
 */
export function exigirPermissao(chave: keyof Permissoes) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.usuario === undefined) {
      next(new ErroNaoAutenticado());
      return;
    }
    if (req.usuario.papel === 'administrador' || req.usuario.permissoes[chave]) {
      next();
      return;
    }
    next(new ErroSemPermissao());
  };
}

/** Exige papel "administrador" — usado pelas rotas de gestão de usuários. Deve vir depois de `exigirAutenticacao`. */
export function exigirAdministrador(req: Request, _res: Response, next: NextFunction): void {
  if (req.usuario === undefined) {
    next(new ErroNaoAutenticado());
    return;
  }
  if (req.usuario.papel !== 'administrador') {
    next(new ErroSemPermissao('Só administradores podem gerenciar usuários.'));
    return;
  }
  next();
}

/**
 * Exige administrador "master" (regra de 2026-09-11: só Ricardo e Wendell) —
 * usado exclusivamente para redefinir a senha de outra pessoa (recuperação
 * de acesso). Um administrador comum passa em `exigirAdministrador` mas é
 * barrado aqui. Deve vir depois de `exigirAutenticacao`.
 */
export function exigirAdministradorMestre(req: Request, _res: Response, next: NextFunction): void {
  if (req.usuario === undefined) {
    next(new ErroNaoAutenticado());
    return;
  }
  if (req.usuario.papel !== 'administrador' || !req.usuario.mestre) {
    next(new ErroSemPermissao('Só um administrador master pode redefinir a senha de outra pessoa.'));
    return;
  }
  next();
}
