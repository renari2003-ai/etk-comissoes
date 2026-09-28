import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import { exigirAutenticacao } from '../auth/middleware.js';
import { mesmoNomeVendedor, nomeVendedorVinculado } from '../auth/vinculoVendedor.js';
import { assincrono } from './erroHttp.js';

/**
 * Lista os vendedores cadastrados na Omie — usada para popular o filtro de vendedor nos relatórios
 * e a escolha do vínculo por nome na administração de usuários.
 * Papel "vendedor" (regra de 2026-09-28): recebe somente o próprio vendedor — os itens cujo nome
 * é igual ao `vendedorOmieNome` vinculado (trim/maiúsculas-minúsculas, nunca aproximado); lista
 * vazia sem vínculo — e `restritoAoProprioVendedor: true`, para a tela travar o filtro.
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
        const nome = nomeVendedorVinculado(usuario);
        res.json({
          vendedores: nome === null ? [] : vendedores.filter((vendedor) => mesmoNomeVendedor(vendedor.nome, nome)),
          restritoAoProprioVendedor: true,
        });
        return;
      }
      res.json({ vendedores, restritoAoProprioVendedor: false });
    }),
  );

  return rotas;
}
