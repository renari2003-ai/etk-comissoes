import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import { exigirAdministrador, exigirAutenticacao } from '../auth/middleware.js';
import { diagnosticarCusto, validarCodigoProduto } from '../precificacao/diagnosticoCusto.js';
import { dataDeHojeFormatoOmie } from '../relatorio/relatorioVendas.js';
import { assincrono } from './erroHttp.js';

/**
 * ROTA TEMPORÁRIA (2026-11-24) — REMOVER ANTES DE IR PARA PRODUÇÃO.
 * Só administrador, só leitura: mostra o que a Omie devolve para a estrutura/custo de um produto,
 * para validar a fonte do custo da formação de preço (ver `precificacao/diagnosticoCusto.ts`).
 */
export function criarRotaPrecificacaoDiagnostico(cliente: ClienteOmie): Router {
  const rotas = Router();

  rotas.get(
    '/api/precificacao/diagnostico/:codigo',
    exigirAutenticacao,
    exigirAdministrador,
    assincrono(async (req, res) => {
      const codigo = validarCodigoProduto(req.params.codigo);
      res.json(await diagnosticarCusto(cliente, codigo, dataDeHojeFormatoOmie()));
    }),
  );

  return rotas;
}
