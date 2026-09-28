import type { EstoqueOmie, PedidoOmie } from '../../src/calculo/tipos.js';
import type { ClienteInfo, VendedorInfo } from '../../src/relatorio/relatorioVendas.js';
import type { ClienteOmieParaComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import type { ProdutoOmie, TituloContaReceber } from '../../src/omie/cliente.js';
import { ETAPAS_VENDA_PRODUTO_PADRAO } from './clienteFalso.js';
import type { EtapaFaturamento } from '../../src/omie/classificacaoDocumento.js';

/** Cliente Omie falso para o relatório de Comissionamento — nenhum teste toca a rede. */
export class ClienteComissionamentoOmieFalso implements ClienteOmieParaComissionamento {
  constructor(
    private readonly pedidos: PedidoOmie[],
    private readonly vendedores: VendedorInfo[],
    private readonly clientesPorCodigo: Map<number, ClienteInfo>,
    private readonly estoquesPorCodigoProduto: Map<number, EstoqueOmie>,
    private readonly titulosPorVendedor: Map<number, TituloContaReceber[]>,
    private readonly etapas: EtapaFaturamento[] = ETAPAS_VENDA_PRODUTO_PADRAO,
    /** Família por produto, usada pelo custo estimado (`custoEstimado.ts`). Produto não configurado -> `consultarProduto` rejeita (cai no divisor padrão). */
    private readonly produtosPorCodigo: Map<number, ProdutoOmie> = new Map(),
  ) {}

  async consultarProduto(codigoProduto: number): Promise<ProdutoOmie> {
    const registro = this.produtosPorCodigo.get(codigoProduto);
    if (registro === undefined) throw new Error(`Produto não configurado no fake: ${codigoProduto}`);
    return registro;
  }

  /** Registro de chamadas de leitura (para os testes conferirem quais consultas foram feitas). */
  readonly consultasPedido: Array<{ numeroPedido?: string; codigoPedido?: number }> = [];
  readonly consultasTitulosPorVendedor: number[] = [];

  /**
   * Com `dataDe`/`dataAte`, simula o filtro de período da Omie como ele é de verdade (confirmado
   * contra a API real em 2026-09-28): o registro entra se a INCLUSÃO ou a ÚLTIMA ALTERAÇÃO
   * (`infoCadastro.dInc`/`dAlt`) cair no intervalo. Pedidos sem `infoCadastro` sempre entram
   * (comportamento anterior do fake, preservado para os testes que não usam período).
   */
  async listarPedidosCompletos(filtros: {
    pagina: number;
    registrosPorPagina: number;
    dataDe?: string;
    dataAte?: string;
  }): Promise<{ pedidos: PedidoOmie[]; pagina: number; totalDePaginas: number }> {
    const chave = (d: string) => d.split('/').reverse().join('');
    const noIntervalo = (data: string | undefined) =>
      data !== undefined &&
      (filtros.dataDe === undefined || chave(data) >= chave(filtros.dataDe)) &&
      (filtros.dataAte === undefined || chave(data) <= chave(filtros.dataAte));
    const filtrados = this.pedidos.filter((p) => {
      if (p.infoCadastro === undefined) return true;
      return noIntervalo(p.infoCadastro.dInc) || noIntervalo(p.infoCadastro.dAlt);
    });
    const inicio = (filtros.pagina - 1) * filtros.registrosPorPagina;
    const pagina = filtrados.slice(inicio, inicio + filtros.registrosPorPagina);
    const totalDePaginas = Math.max(1, Math.ceil(filtrados.length / filtros.registrosPorPagina));
    return { pedidos: pagina, pagina: filtros.pagina, totalDePaginas };
  }

  /** Por número devolve o registro ORIGINAL (menor código), como a Omie; rejeita quando não existe. */
  async consultarPedido(identificador: { numeroPedido?: string; codigoPedido?: number }): Promise<PedidoOmie> {
    this.consultasPedido.push(identificador);
    const candidatos = this.pedidos
      .filter((p) =>
        identificador.codigoPedido !== undefined
          ? p.cabecalho.codigo_pedido === identificador.codigoPedido
          : p.cabecalho.numero_pedido === identificador.numeroPedido,
      )
      .sort((a, b) => a.cabecalho.codigo_pedido - b.cabecalho.codigo_pedido);
    const encontrado = candidatos[0];
    if (encontrado === undefined) throw new Error('Pedido não cadastrado (fake)');
    return encontrado;
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

  async listarContasReceberPorVendedor(codigoVendedor: number): Promise<TituloContaReceber[]> {
    this.consultasTitulosPorVendedor.push(codigoVendedor);
    return this.titulosPorVendedor.get(codigoVendedor) ?? [];
  }
}
