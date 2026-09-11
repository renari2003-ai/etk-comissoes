/** Nenhuma sessão válida (cookie ausente/expirado) — vira HTTP 401 em `erroHttp.ts`. */
export class ErroNaoAutenticado extends Error {
  constructor(message: string = 'É necessário fazer login para acessar este recurso.') {
    super(message);
    this.name = 'ErroNaoAutenticado';
  }
}

/** Sessão válida, mas sem a permissão necessária (papel/permissão insuficiente) — vira HTTP 403 em `erroHttp.ts`. */
export class ErroSemPermissao extends Error {
  constructor(message: string = 'Sua conta não tem permissão para acessar este recurso. Peça liberação ao administrador.') {
    super(message);
    this.name = 'ErroSemPermissao';
  }
}
