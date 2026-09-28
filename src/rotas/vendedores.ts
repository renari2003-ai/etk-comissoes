import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import { exigirAutenticacao } from '../auth/middleware.js';
import { assincrono } from './erroHttp.js';

/**
 * Lista os vendedores cadastrados na Omie — usada para popular o filtro de vendedor nos relatórios.
 * Papel "vendedor" (regra de 2026-09-28): recebe somente o próprio vendedor (pelo vendedorOmieId
 * vinculado; lista vazia sem vínculo) e `restritoAoProprioVendedor: true`, para a tela travar o filtro.
 * Os demais papéis recebem a lista completa, como antes.
 */
export function criarRotaVendedores(cliente: ClienteOmie): Router {
  const rotas = Router();

  rotas.get(
    '/api/vendedores',
    exigirAutenticacao,
    assincrono(async (req, res) => {
      const vendedores = await cliente.listarVendedores();
      // req.usuario garantido por exigirAutenticacao (vem antes na cadeia de middlewares desta rota).
      const usuario = req.usuario!;
      if (usuario.papel === 'vendedor') {
        const proprio = usuario.vendedorOmieId;
        res.json({
          vendedores: proprio === null ? [] : vendedores.filter((vendedor) => vendedor.codigo === proprio),
          restritoAoProprioVendedor: true,
        });
        return;
      }
      res.json({ vendedores, restritoAoProprioVendedor: false });
    }),
  );

  return rotas;
}
