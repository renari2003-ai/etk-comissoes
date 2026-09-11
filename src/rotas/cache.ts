import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import { exigirAutenticacao } from '../auth/middleware.js';
import { assincrono } from './erroHttp.js';

export function criarRotaCache(cliente: ClienteOmie): Router {
  const rotas = Router();

  rotas.post(
    '/api/cache/limpar',
    exigirAutenticacao,
    assincrono(async (_req, res) => {
      await cliente.limparCache();
      res.json({ mensagem: 'Cache limpo com sucesso.' });
    }),
  );

  return rotas;
}
