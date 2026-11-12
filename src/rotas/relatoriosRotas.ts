import { Router } from 'express';
import type { ClienteOmie } from '../omie/cliente.js';
import type { TipoDocumento } from '../omie/classificacaoDocumento.js';
import { filtrarLinhasPorBusca, gerarRelatorio } from '../relatorio/relatorioVendas.js';
import { gerarRelatorioVendasFaturadas } from '../relatorio/vendasPorFaturamento.js';
import { validarBusca, validarCodigoVendedor, validarData } from '../validacao.js';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import { assincrono } from './erroHttp.js';

const CAMINHO_POR_TIPO: Record<TipoDocumento, string> = {
  PEDIDO: '/api/relatorios/vendas',
  ORCAMENTO: '/api/relatorios/orcamentos',
};

/**
 * Cria a rota de relatório agregado (Vendas ou Orçamentos) — exatamente um
 * tipo por instância, nunca misturados (regra crítica de separação
 * Pedido/Orçamento).
 */
export function criarRotasRelatorios(cliente: ClienteOmie, tipo: TipoDocumento): Router {
  const rotas = Router();
  const caminho = CAMINHO_POR_TIPO[tipo];
  const permissao = tipo === 'PEDIDO' ? ('relatorioVendas' as const) : ('relatorioOrcamentos' as const);

  rotas.get(
    caminho,
    exigirAutenticacao,
    exigirPermissao(permissao),
    assincrono(async (req, res) => {
      const dataDe = validarData(req.query.data_de, 'data_de');
      const dataAte = validarData(req.query.data_ate, 'data_ate');
      const codigoVendedor = validarCodigoVendedor(req.query.vendedor);
      const busca = validarBusca(req.query.busca);

      // Vendas: período pela data de FATURAMENTO (regra de 2026-11-12, ver `vendasPorFaturamento.ts`).
      // Orçamentos nunca são faturados — continuam pela listagem de sempre.
      const resultado =
        tipo === 'PEDIDO'
          ? await gerarRelatorioVendasFaturadas(cliente, { dataDe, dataAte, codigoVendedor })
          : { ...(await gerarRelatorio(cliente, { tipoDocumento: tipo, dataDe, dataAte, codigoVendedor })), numerosPedidosSemVendedorNaoVerificados: [] };

      res.json({
        linhas: filtrarLinhasPorBusca(resultado.linhas, busca),
        resumo: resultado.resumo,
        documentosAmbiguosExcluidos: resultado.documentosAmbiguosExcluidos,
        paginasOmieConsultadas: resultado.paginasOmieConsultadas,
        limiteAtingido: resultado.limiteAtingido,
        numerosPedidosSemVendedorNaoVerificados: resultado.numerosPedidosSemVendedorNaoVerificados,
      });
    }),
  );

  return rotas;
}
