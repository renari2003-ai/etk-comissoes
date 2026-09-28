import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import { gerarRelatorioComissionamento } from '../comissionamento/relatorioComissionamento.js';
import { resolverVendedorDoRelatorio } from '../comissionamento/restricaoVendedor.js';
import { ocultarMargem, podeVerMargemComissionamento } from '../comissionamento/visibilidadeMargem.js';
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
      // req.usuario garantido por exigirAutenticacao (vem antes na cadeia de middlewares desta rota).
      const usuario = req.usuario!;
      const ehVendedor = usuario.papel === 'vendedor';
      // Papel "vendedor": o `vendedor` da query é ignorado por completo (nem validado) — o filtro
      // é sempre o vendedorOmieId do usuário autenticado (ver `restricaoVendedor.ts`).
      const codigoVendedor = resolverVendedorDoRelatorio(usuario, ehVendedor ? undefined : validarCodigoVendedor(req.query.vendedor));
      const busca = validarBusca(req.query.busca);

      const resultado = await gerarRelatorioComissionamento(cliente, { dataDe, dataAte, codigoVendedor });
      // Margem só para administrador — decidido pelo usuário autenticado, nunca por parâmetro
      // do navegador (ver `visibilidadeMargem.ts`).
      const margemVisivel = podeVerMargemComissionamento(usuario);
      const linhasFiltradas = filtrarLinhasPorBusca(resultado.linhas, busca);
      // Defesa extra para o vendedor: nunca devolver linha de outro vendedor, mesmo que o filtro
      // na origem falhe; pedidos sem vendedor (de ninguém) também não são dele.
      const linhas = ehVendedor ? linhasFiltradas.filter((linha) => linha.codigoVendedor === codigoVendedor) : linhasFiltradas;

      res.json({
        margemVisivel,
        linhas: margemVisivel ? linhas : linhas.map(ocultarMargem),
        resumo: resultado.resumo,
        documentosAmbiguosExcluidos: resultado.documentosAmbiguosExcluidos,
        pedidosSemVendedorExcluidos: ehVendedor ? 0 : resultado.pedidosSemVendedorExcluidos,
        numerosPedidosSemVendedor: ehVendedor ? [] : resultado.numerosPedidosSemVendedor,
      });
    }),
  );

  return rotas;
}
