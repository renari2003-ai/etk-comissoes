import { Router } from 'express';
import type { ClienteOmie, PedidoResumo } from '../omie/cliente.js';
import { ordenarPorDataAprovacaoDescendente } from '../omie/cliente.js';
import type { TipoDocumento } from '../omie/classificacaoDocumento.js';
import { montarRelatorioPedido } from '../relatorio/montarRelatorio.js';
import { gerarCsv } from '../csv/exportarCsv.js';
import { validarData, validarEtapa, validarIdentificadorPedido, validarPaginacao } from '../validacao.js';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import { assincrono } from './erroHttp.js';

/**
 * Limite de segurança de páginas RAW da Omie consultadas para montar a
 * listagem de "recentes" — nunca disparar um número ilimitado de chamadas.
 * A Omie pagina PEDIDO e ORÇAMENTO misturados (mesmo tipo de registro), então
 * um tipo pode ser raro dentro das páginas mais recentes; sem esse loop, a
 * listagem parava na primeira página e podia devolver só 1 registro mesmo
 * havendo dezenas do tipo pedido em páginas seguintes.
 */
const MAX_PAGINAS_OMIE_RECENTES = 10;

const CAMINHO_POR_TIPO: Record<TipoDocumento, { listagem: string; detalhe: string; prefixoArquivo: string }> = {
  PEDIDO: { listagem: '/api/pedidos', detalhe: '/api/pedido/:identificador', prefixoArquivo: 'pedido' },
  ORCAMENTO: { listagem: '/api/orcamentos', detalhe: '/api/orcamento/:identificador', prefixoArquivo: 'orcamento' },
};

/**
 * Cria as rotas de listagem, detalhe e CSV para exatamente um tipo de
 * documento (PEDIDO ou ORCAMENTO) — nunca os dois juntos. Ver a regra de
 * separação obrigatória entre Pedido (compra concreta) e Orçamento
 * (intenção de compra) documentada em `classificacaoDocumento.ts`.
 *
 * Na listagem, `pagina`/`por_pagina` são repassados diretamente à
 * `ListarPedidos` da Omie (que pagina PEDIDO e ORÇAMENTO juntos, misturados,
 * pois são o mesmo tipo de registro na Omie) e o resultado é filtrado
 * localmente para conter apenas o tipo desta rota. Por isso uma página pode
 * legitimamente retornar menos itens que `por_pagina` — o campo
 * `registrosBrutosNaPagina` informa quantos registros a Omie devolveu antes
 * do filtro, para transparência total (nunca escondendo a diferença).
 */
export function criarRotasDocumentos(cliente: ClienteOmie, tipo: TipoDocumento): Router {
  const rotas = Router();
  const caminhos = CAMINHO_POR_TIPO[tipo];
  // Cada rota leva o middleware DIRETO nela (nunca via `rotas.use(...)`/`app.use(middleware, rotas)`) —
  // como as rotas desta API usam caminhos absolutos (não um prefixo comum), um middleware "global" do
  // router rodaria pra QUALQUER requisição que chegasse até aqui, mesmo uma que não bata com nenhuma
  // rota abaixo (ex.: `GET /`), bloqueando até o carregamento do HTML sem sessão (bug real encontrado
  // e corrigido em 2026-09-11).
  const permissao = tipo === 'PEDIDO' ? ('consultaPedidos' as const) : ('consultaOrcamentos' as const);

  rotas.get(
    caminhos.listagem,
    exigirAutenticacao,
    exigirPermissao(permissao),
    assincrono(async (req, res) => {
      const { pagina: paginaInicial, porPagina } = validarPaginacao(req.query.pagina, req.query.por_pagina);
      const etapa = validarEtapa(req.query.etapa);
      const dataDe = validarData(req.query.data_de, 'data_de');
      const dataAte = validarData(req.query.data_ate, 'data_ate');

      const documentos: PedidoResumo[] = [];
      let ambiguosTotal = 0;
      let registrosBrutosTotal = 0;
      let pagina = paginaInicial;
      let totalDePaginasOmie = pagina;
      let paginasConsultadas = 0;

      // Busca páginas RAW sucessivas da Omie até acumular `porPagina` documentos
      // deste tipo (PEDIDO ou ORÇAMENTO), esgotar as páginas existentes, ou
      // atingir o limite de segurança — nunca parava na primeira página, mesmo
      // quando o tipo pedido era raro nela.
      do {
        const resultado = await cliente.listarPedidos({
          pagina,
          registrosPorPagina: porPagina,
          etapa,
          dataDe,
          dataAte,
        });

        registrosBrutosTotal += resultado.pedidos.length;
        totalDePaginasOmie = resultado.totalDePaginas;
        paginasConsultadas += 1;

        for (const documento of resultado.pedidos) {
          if (documento.classificacao.ambiguo) {
            ambiguosTotal += 1;
          } else if (documento.classificacao.tipo === tipo) {
            documentos.push(documento);
          }
        }

        pagina += 1;
      } while (
        documentos.length < porPagina &&
        pagina <= totalDePaginasOmie &&
        paginasConsultadas < MAX_PAGINAS_OMIE_RECENTES
      );

      ordenarPorDataAprovacaoDescendente(documentos);
      const documentosLimitados = documentos.slice(0, porPagina);
      const limiteDePaginasAtingido = paginasConsultadas >= MAX_PAGINAS_OMIE_RECENTES && pagina <= totalDePaginasOmie;

      res.json({
        pagina: paginaInicial,
        totalDePaginas: totalDePaginasOmie,
        registrosBrutosNaPagina: registrosBrutosTotal,
        documentos: documentosLimitados.map((documento) => ({
          codigoPedido: documento.codigoPedido,
          numeroPedido: documento.numeroPedido,
          etapa: documento.etapa,
          statusRotulo: documento.statusRotulo ?? 'Status não identificado',
          dataAprovacao: documento.dataAprovacao,
          horaAprovacao: documento.horaAprovacao,
          data: documento.data,
          valorTotal: documento.valorTotal,
          tipoDocumento: tipo,
        })),
        totalPaginaAtual: documentosLimitados.reduce((soma, documento) => soma + documento.valorTotal, 0),
        limiteDePaginasAtingido,
        ...(ambiguosTotal > 0
          ? {
              avisoClassificacaoAmbigua: `${ambiguosTotal} registro(s) nas ${paginasConsultadas} página(s) consultadas têm etapa não reconhecida na configuração desta conta Omie e foram excluídos desta listagem (não classificados como PEDIDO nem ORÇAMENTO) para evitar contabilização incorreta.`,
            }
          : {}),
      });
    }),
  );

  rotas.get(
    caminhos.detalhe,
    exigirAutenticacao,
    exigirPermissao(permissao),
    assincrono(async (req, res) => {
      const identificador = validarIdentificadorPedido(req.params.identificador, req.query.por_codigo);
      const relatorio = await montarRelatorioPedido(cliente, identificador, undefined, tipo);
      res.json(relatorio);
    }),
  );

  rotas.get(
    `${caminhos.detalhe}/csv`,
    exigirAutenticacao,
    exigirPermissao(permissao),
    assincrono(async (req, res) => {
      const identificador = validarIdentificadorPedido(req.params.identificador, req.query.por_codigo);
      const relatorio = await montarRelatorioPedido(cliente, identificador, undefined, tipo);
      const csv = gerarCsv(relatorio);
      const nomeArquivoSeguro = relatorio.numeroPedido.replace(/[^0-9A-Za-z._-]/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${caminhos.prefixoArquivo}_${nomeArquivoSeguro}.csv"`);
      res.send(csv);
    }),
  );

  return rotas;
}
