import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import {
  gerarRelatorioComissionamento,
  type FiltrosComissionamento,
  type ResultadoComissionamento,
} from '../comissionamento/relatorioComissionamento.js';
import { resolverVendedoresDoRelatorio } from '../comissionamento/restricaoVendedor.js';
import { ocultarMargem, podeVerMargemComissionamento } from '../comissionamento/visibilidadeMargem.js';
import { filtrarLinhasPorBusca } from '../relatorio/relatorioVendas.js';
import { validarBusca, validarCodigoVendedor, validarData } from '../validacao.js';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import { resolverVinculoVendedor } from '../auth/vinculoVendedor.js';
import { assincrono } from './erroHttp.js';
import { gerarRelatorioFinanceiro, resumirFinanceiro, validarPeriodoFinanceiro } from '../comissionamento/relatorioFinanceiro.js';
import { gerarExcelFinanceiro } from '../comissionamento/excelFinanceiro.js';

function resultadoVazio(): ResultadoComissionamento {
  return {
    linhas: [],
    resumo: {
      quantidadePedidos: 0,
      valorVendaTotal: 0,
      comissaoTotalCalculada: 0,
      comissaoLiberada: 0,
      comissaoPendente: 0,
      quantidadeParcelasTotal: 0,
      quantidadeParcelasBaixadas: 0,
      quantidadeParcelasPendentes: 0,
    },
    documentosAmbiguosExcluidos: 0,
    pedidosSemVendedorExcluidos: 0,
    numerosPedidosSemVendedor: [],
    numerosPedidosAnterioresNaoLocalizados: [],
    excecoesRevisaoManual: [],
  };
}

/**
 * Um mesmo nome de vendedor pode ter mais de um código na Omie (cadastro duplicado) — gera o
 * relatório de cada código com o MESMO cálculo de sempre e soma os totais (todos aditivos).
 * Sequencial de propósito, para respeitar o limitador de chamadas da Omie.
 */
async function gerarParaCodigos(
  cliente: ClienteOmie,
  filtros: Omit<FiltrosComissionamento, 'codigoVendedor'>,
  codigos: number[] | undefined,
): Promise<ResultadoComissionamento> {
  if (codigos === undefined) return gerarRelatorioComissionamento(cliente, filtros);
  if (codigos.length === 1) return gerarRelatorioComissionamento(cliente, { ...filtros, codigoVendedor: codigos[0] });
  const total = resultadoVazio();
  for (const codigoVendedor of codigos) {
    const parcial = await gerarRelatorioComissionamento(cliente, { ...filtros, codigoVendedor });
    total.linhas.push(...parcial.linhas);
    for (const chave of Object.keys(total.resumo) as Array<keyof typeof total.resumo>) total.resumo[chave] += parcial.resumo[chave];
    total.documentosAmbiguosExcluidos = Math.max(total.documentosAmbiguosExcluidos, parcial.documentosAmbiguosExcluidos);
    total.numerosPedidosAnterioresNaoLocalizados.push(...parcial.numerosPedidosAnterioresNaoLocalizados);
    total.excecoesRevisaoManual.push(...(parcial.excecoesRevisaoManual ?? []));
  }
  return total;
}

/**
 * Rota de Comissionamento — exclusivamente sobre Pedidos (compra concreta).
 * Nunca aceita/gera dados de Orçamento (regra crítica de separação).
 */
export function criarRotaComissionamento(cliente: ClienteOmie): Router {
  const rotas = Router();

  // JSON e Excel usam a mesma apuração e os mesmos controles de acesso.
  rotas.get(['/api/relatorios/financeiro-comissao', '/api/relatorios/financeiro-comissao/excel'],
    exigirAutenticacao, exigirPermissao('relatorioFinanceiroComissao'), resolverVinculoVendedor(cliente),
    assincrono(async (req, res) => {
      const periodo = validarPeriodoFinanceiro(validarData(req.query.data_de, 'data_de'), validarData(req.query.data_ate, 'data_ate'));
      const usuario = req.usuario!;
      const codigos = resolverVendedoresDoRelatorio(usuario, usuario.papel === 'vendedor' ? undefined : validarCodigoVendedor(req.query.vendedor));
      const resultado = await gerarRelatorioFinanceiro(cliente, { ...periodo, codigosVendedor: codigos, busca: validarBusca(req.query.busca) });
      const linhas = usuario.papel === 'vendedor' ? resultado.linhas.filter(l => (codigos ?? []).includes(l.codigoVendedor)) : resultado.linhas;
      const filtrado = { ...resultado, linhas, resumo: resumirFinanceiro(linhas) };
      const margemVisivel = podeVerMargemComissionamento(usuario);
      if (req.path.endsWith('/excel')) {
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="financeiro-comissao.xlsx"');
        res.send(gerarExcelFinanceiro(filtrado, periodo, margemVisivel));
        return;
      }
      res.json({ ...filtrado, margemVisivel,
        linhas: margemVisivel ? linhas : linhas.map(l => ({ ...l, detalhe: ocultarMargem(l.detalhe) })),
      });
    }));

  rotas.get(
    '/api/relatorios/comissionamento',
    exigirAutenticacao,
    exigirPermissao('relatorioComissionamento'),
    resolverVinculoVendedor(cliente),
    assincrono(async (req, res) => {
      const dataDe = validarData(req.query.data_de, 'data_de');
      const dataAte = validarData(req.query.data_ate, 'data_ate');
      // req.usuario garantido por exigirAutenticacao (vem antes na cadeia de middlewares desta rota).
      const usuario = req.usuario!;
      const ehVendedor = usuario.papel === 'vendedor';
      // Papel "vendedor": o `vendedor` da query é ignorado por completo (nem validado) — o filtro
      // é sempre o vendedor vinculado ao usuário autenticado pelo nome (ver `restricaoVendedor.ts`).
      const codigos = resolverVendedoresDoRelatorio(usuario, ehVendedor ? undefined : validarCodigoVendedor(req.query.vendedor));
      const busca = validarBusca(req.query.busca);

      const resultado = ehVendedor && codigos?.length === 0 ? resultadoVazio() : await gerarParaCodigos(cliente, { dataDe, dataAte }, codigos);
      // Margem só para administrador — decidido pelo usuário autenticado, nunca por parâmetro
      // do navegador (ver `visibilidadeMargem.ts`).
      const margemVisivel = podeVerMargemComissionamento(usuario);
      const linhasFiltradas = filtrarLinhasPorBusca(resultado.linhas, busca);
      // Defesa extra para o vendedor: nunca devolver linha de outro vendedor, mesmo que o filtro
      // na origem falhe; pedidos sem vendedor (de ninguém) também não são dele.
      const linhas = ehVendedor
        ? linhasFiltradas.filter((linha) => linha.codigoVendedor !== null && (codigos ?? []).includes(linha.codigoVendedor))
        : linhasFiltradas;
      // Exceções para revisão manual seguem a mesma restrição: vendedor só vê as próprias.
      const excecoes = resultado.excecoesRevisaoManual ?? [];
      const excecoesRevisaoManual = ehVendedor
        ? excecoes.filter((e) => e.codigoVendedor !== null && (codigos ?? []).includes(e.codigoVendedor))
        : excecoes;

      res.json({
        margemVisivel,
        linhas: margemVisivel ? linhas : linhas.map(ocultarMargem),
        resumo: resultado.resumo,
        documentosAmbiguosExcluidos: resultado.documentosAmbiguosExcluidos,
        pedidosSemVendedorExcluidos: ehVendedor ? 0 : resultado.pedidosSemVendedorExcluidos,
        numerosPedidosSemVendedor: ehVendedor ? [] : resultado.numerosPedidosSemVendedor,
        numerosPedidosAnterioresNaoLocalizados: resultado.numerosPedidosAnterioresNaoLocalizados,
        excecoesRevisaoManual,
      });
    }),
  );

  return rotas;
}
