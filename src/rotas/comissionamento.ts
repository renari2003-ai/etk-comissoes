import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import { gerarRelatorioComissionamento } from '../comissionamento/relatorioComissionamento.js';
import { filtrarLinhasPorBusca } from '../relatorio/relatorioVendas.js';
import { validarBusca, validarCodigoVendedor, validarData } from '../validacao.js';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import { assincrono } from './erroHttp.js';

/**
 * Rota de Comissionamento — exclusivamente sobre Pedidos (compra concreta).
 * Nunca aceita/gera dados de Orçamento (regra crítica de separação).
 */
export function criarRotaComissionamento(cliente: ClienteOmie): Router {
  const rotas = Router();

  rotas.get(
    '/api/relatorios/comissionamento',
    exigirAutenticacao,
    exigirPermissao('relatorioComissionamento'),
    assincrono(async (req, res) => {
      const dataDe = validarData(req.query.data_de, 'data_de');
      const dataAte = validarData(req.query.data_ate, 'data_ate');
      const codigoVendedor = validarCodigoVendedor(req.query.vendedor);
      const busca = validarBusca(req.query.busca);

      const resultado = await gerarRelatorioComissionamento(cliente, { dataDe, dataAte, codigoVendedor });

      res.json({
        linhas: filtrarLinhasPorBusca(resultado.linhas, busca),
        resumo: resultado.resumo,
        documentosAmbiguosExcluidos: resultado.documentosAmbiguosExcluidos,
        pedidosSemVendedorExcluidos: resultado.pedidosSemVendedorExcluidos,
        numerosPedidosSemVendedor: resultado.numerosPedidosSemVendedor,
      });
    }),
  );

  return rotas;
}
