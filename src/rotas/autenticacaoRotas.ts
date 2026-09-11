import { Router } from 'express';
import { lerCookie, NOME_COOKIE_SESSAO } from '../auth/cookies.js';
import { exigirAdministrador, exigirAdministradorMestre, exigirAutenticacao } from '../auth/middleware.js';
import { criarSessao, destruirSessao } from '../auth/sessoes.js';
import { verificarSenha } from '../auth/senhas.js';
import { PERMISSOES_VAZIAS, type Papel, type Permissoes } from '../auth/tipos.js';
import {
  atualizarUsuario,
  buscarPorNomeDeUsuario,
  criarUsuario,
  definirSenhaPropria,
  excluirUsuario,
  listarUsuarios,
  redefinirSenha,
} from '../auth/usuariosRepositorio.js';
import { ErroValidacao } from '../validacao.js';
import { assincrono } from './erroHttp.js';

const DURACAO_COOKIE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias — acompanha a duração da sessão em sessoes.ts

function validarTextoNaoVazio(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErroValidacao(`O campo "${campo}" é obrigatório.`);
  }
  return valor;
}

function validarPapel(valor: unknown): Papel {
  if (valor !== 'administrador' && valor !== 'convidado') {
    throw new ErroValidacao('O campo "papel" deve ser "administrador" ou "convidado".');
  }
  return valor;
}

function validarPermissoes(valor: unknown): Permissoes {
  if (valor === undefined) return { ...PERMISSOES_VAZIAS };
  if (typeof valor !== 'object' || valor === null) {
    throw new ErroValidacao('O campo "permissoes" deve ser um objeto.');
  }
  const bruto = valor as Record<string, unknown>;
  const permissoes = { ...PERMISSOES_VAZIAS };
  for (const chave of Object.keys(PERMISSOES_VAZIAS) as Array<keyof Permissoes>) {
    if (bruto[chave] !== undefined) permissoes[chave] = bruto[chave] === true;
  }
  return permissoes;
}

export function criarRotaAuth(): Router {
  const rotas = Router();

  rotas.post(
    '/api/auth/login',
    assincrono(async (req, res) => {
      const usuarioDigitado = validarTextoNaoVazio(req.body?.usuario, 'usuario');
      const senhaDigitada = validarTextoNaoVazio(req.body?.senha, 'senha');

      const usuario = await buscarPorNomeDeUsuario(usuarioDigitado);
      // Mesma mensagem para usuário inexistente OU senha errada — nunca revelar qual dos dois falhou
      // (evita que alguém descubra quais logins existem só tentando senhas ao acaso).
      if (usuario === null || !verificarSenha(senhaDigitada, usuario.senhaHash)) {
        throw new ErroValidacao('Usuário ou senha incorretos.');
      }

      const token = await criarSessao(usuario.id);
      res.cookie(NOME_COOKIE_SESSAO, token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: DURACAO_COOKIE_MS,
        path: '/',
      });
      res.json({
        id: usuario.id,
        usuario: usuario.usuario,
        nome: usuario.nome,
        papel: usuario.papel,
        permissoes: usuario.permissoes,
        senhaProvisoria: usuario.senhaProvisoria,
        mestre: usuario.mestre,
      });
    }),
  );

  rotas.post(
    '/api/auth/logout',
    assincrono(async (req, res) => {
      const token = lerCookie(req.headers.cookie, NOME_COOKIE_SESSAO);
      if (token !== null) await destruirSessao(token);
      res.clearCookie(NOME_COOKIE_SESSAO, { path: '/' });
      res.json({ ok: true });
    }),
  );

  rotas.get('/api/auth/eu', exigirAutenticacao, (req, res) => {
    res.json(req.usuario);
  });

  rotas.get(
    '/api/auth/usuarios',
    exigirAutenticacao,
    exigirAdministrador,
    assincrono(async (_req, res) => {
      res.json({ usuarios: await listarUsuarios() });
    }),
  );

  rotas.post(
    '/api/auth/usuarios',
    exigirAutenticacao,
    exigirAdministrador,
    assincrono(async (req, res) => {
      const usuario = validarTextoNaoVazio(req.body?.usuario, 'usuario');
      const nome = validarTextoNaoVazio(req.body?.nome, 'nome');
      const senha = validarTextoNaoVazio(req.body?.senha, 'senha');
      const papel = validarPapel(req.body?.papel);
      const permissoes = validarPermissoes(req.body?.permissoes);

      const criado = await criarUsuario({ usuario, nome, senha, papel, permissoes });
      res.status(201).json(criado);
    }),
  );

  rotas.put(
    '/api/auth/usuarios/:id',
    exigirAutenticacao,
    exigirAdministrador,
    assincrono(async (req, res) => {
      const id = validarTextoNaoVazio(req.params.id, 'id');
      const atualizado = await atualizarUsuario(id, {
        ...(req.body?.nome !== undefined ? { nome: validarTextoNaoVazio(req.body.nome, 'nome') } : {}),
        ...(req.body?.papel !== undefined ? { papel: validarPapel(req.body.papel) } : {}),
        ...(req.body?.permissoes !== undefined ? { permissoes: validarPermissoes(req.body.permissoes) } : {}),
      });
      res.json(atualizado);
    }),
  );

  rotas.post(
    '/api/auth/usuarios/:id/senha',
    exigirAutenticacao,
    exigirAdministradorMestre, // recuperação de acesso — só Ricardo/Wendell (regra de 2026-09-11)
    assincrono(async (req, res) => {
      const id = validarTextoNaoVazio(req.params.id, 'id');
      const senha = validarTextoNaoVazio(req.body?.senha, 'senha');
      await redefinirSenha(id, senha);
      res.json({ ok: true });
    }),
  );

  // Autoatendimento: qualquer usuário logado define a própria senha (obrigatório quando
  // `senhaProvisoria` é true, ver auth.ts do frontend) — nunca exige ser administrador.
  rotas.post(
    '/api/auth/definir-senha',
    exigirAutenticacao,
    assincrono(async (req, res) => {
      const senha = validarTextoNaoVazio(req.body?.senha, 'senha');
      // req.usuario garantido por exigirAutenticacao (vem antes na cadeia de middlewares desta rota).
      await definirSenhaPropria(req.usuario!.id, senha);
      res.json({ ok: true });
    }),
  );

  rotas.delete(
    '/api/auth/usuarios/:id',
    exigirAutenticacao,
    exigirAdministrador,
    assincrono(async (req, res) => {
      const id = validarTextoNaoVazio(req.params.id, 'id');
      // req.usuario garantido por exigirAutenticacao (vem antes na cadeia de middlewares desta rota).
      await excluirUsuario(id, req.usuario!.id);
      res.json({ ok: true });
    }),
  );

  return rotas;
}
