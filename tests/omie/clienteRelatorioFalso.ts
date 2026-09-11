import type { EstoqueOmie, PedidoOmie } from '../../src/calculo/tipos.js';
import type {
  ClienteInfo,
  ClienteOmieParaRelatorioAgregado,
  VendedorInfo,
} from '../../src/relatorio/relatorioVendas.js';
import { ETAPAS_VENDA_PRODUTO_PADRAO } from './clienteFalso.js';
import type { EtapaFaturamento } from '../../src/omie/classificacaoDocumento.js';
import type { ProdutoOmie } from '../../src/omie/cliente.js';

/** Cliente Omie falso para os relatórios agregados de Vendas/Orçamentos — nenhum teste toca a rede. */
export class ClienteRelatorioOmieFalso implements ClienteOmieParaRelatorioAgregado {
  constructor(
    private readonly pedidos: PedidoOmie[],
    private readonly vendedores: VendedorInfo[],
    private readonly clientesPorCodigo: Map<number, ClienteInfo>,
    private readonly estoquesPorCodigoProduto: Map<number, EstoqueOmie>,
    private readonly etapas: EtapaFaturamento[] = ETAPAS_VENDA_PRODUTO_PADRAO,
    /** Família por produto, usada pelo custo estimado (`custoEstimado.ts`). Produto não configurado -> `consultarProduto` rejeita (cai no divisor padrão). */
    private readonly produtosPorCodigo: Map<number, ProdutoOmie> = new Map(),
  ) {}

  async consultarProduto(codigoProduto: number): Promise<ProdutoOmie> {
    const registro = this.produtosPorCodigo.get(codigoProduto);
    if (registro === undefined) throw new Error(`Produto não configurado no fake: ${codigoProduto}`);
    return registro;
  }

  async listarPedidosCompletos(filtros: {
    pagina: number;
    registrosPorPagina: number;
  }): Promise<{ pedidos: PedidoOmie[]; pagina: number; totalDePaginas: number }> {
    const inicio = (filtros.pagina - 1) * filtros.registrosPorPagina;
    const pagina = this.pedidos.slice(inicio, inicio + filtros.registrosPorPagina);
    const totalDePaginas = Math.max(1, Math.ceil(this.pedidos.length / filtros.registrosPorPagina));
    return { pedidos: pagina, pagina: filtros.pagina, totalDePaginas };
  }

  async listarEtapasVendaProduto(): Promise<EtapaFaturamento[]> {
    return this.etapas;
  }

  async listarVendedores(): Promise<VendedorInfo[]> {
    return this.vendedores;
  }

  async consultarCliente(codigoCliente: number): Promise<ClienteInfo | null> {
    return this.clientesPorCodigo.get(codigoCliente) ?? null;
  }

  async obterEstoqueProduto(codigoProduto: number): Promise<EstoqueOmie> {
    return this.estoquesPorCodigoProduto.get(codigoProduto) ?? { listaEstoque: [] };
  }
}
