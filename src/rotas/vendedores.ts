import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import { exigirAutenticacao } from '../auth/middleware.js';
import { assincrono } from './erroHttp.js';

/** Lista os vendedores cadastrados na Omie — usada para popular o filtro de vendedor nos relatórios. */
export function criarRotaVendedores(cliente: ClienteOmie): Router {
  const rotas = Router();

  rotas.get(
    '/api/vendedores',
    exigirAutenticacao,
    assincrono(async (_req, res) => {
      const vendedores = await cliente.listarVendedores();
      res.json({ vendedores });
    }),
  );

  return rotas;
}
