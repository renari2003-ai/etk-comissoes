import type { ClienteOmieParaRelatorio } from '../../src/relatorio/montarRelatorio.js';
import type { EstoqueOmie, PedidoOmie } from '../../src/calculo/tipos.js';
import { classificarEtapa, type EtapaFaturamento, type ResultadoClassificacao } from '../../src/omie/classificacaoDocumento.js';
import type { Cliente, ProdutoOmie, TituloContaReceber } from '../../src/omie/cliente.js';

/** Cliente padrão devolvido pelo fake quando o teste não precisa configurar um cliente específico. */
export const CLIENTE_PADRAO: Cliente = { codigo: 999, razaoSocial: 'Cliente Fake Ltda', nomeFantasia: 'Cliente Fake' };

/** Configuração padrão de etapas usada pelos testes: "00" é Orçamento, "10" é Pedido. */
export const ETAPAS_VENDA_PRODUTO_PADRAO: EtapaFaturamento[] = [
  { codigo: '00', descricaoPadrao: 'Proposta', descricao: 'Orçamento', inativa: false },
  { codigo: '10', descricaoPadrao: 'Pedido de Venda', descricao: 'Pedido de Venda', inativa: false },
];

/**
 * Cliente Omie falso, com respostas fixas em memória. Usado por todos os
 * testes do núcleo — nenhum teste toca a rede ou depende da Omie real.
 */
export class ClienteOmieFalso implements ClienteOmieParaRelatorio {
  constructor(
    private readonly pedido: PedidoOmie,
    private readonly estoquesPorCodigoProduto: Map<number, EstoqueOmie | Error>,
    private readonly etapasVendaProduto: EtapaFaturamento[] = ETAPAS_VENDA_PRODUTO_PADRAO,
    private readonly cliente: Cliente | null | Error = CLIENTE_PADRAO,
    /** Família por produto, usada pelo custo estimado (`custoEstimado.ts`). Produto não configurado aqui -> `consultarProduto` rejeita (o chamador cai no divisor padrão, nunca quebra). */
    private readonly produtosPorCodigo: Map<number, ProdutoOmie | Error> = new Map(),
    /** Títulos financeiros por código de vendedor, usados para montar `faturamento` (ver `montarRelatorio.ts` → `buscarFaturamento`). Vendedor não configurado -> lista vazia (nunca quebra). */
    private readonly titulosPorVendedor: Map<number, TituloContaReceber[]> = new Map(),
  ) {}

  async consultarPedido(): Promise<PedidoOmie> {
    return this.pedido;
  }

  async listarContasReceberPorVendedor(codigoVendedor: number): Promise<TituloContaReceber[]> {
    return this.titulosPorVendedor.get(codigoVendedor) ?? [];
  }

  async consultarProduto(codigoProduto: number): Promise<ProdutoOmie> {
    const registro = this.produtosPorCodigo.get(codigoProduto);
    if (registro === undefined) {
      throw new Error(`Produto não configurado no fake: ${codigoProduto}`);
    }
    if (registro instanceof Error) {
      throw registro;
    }
    return registro;
  }

  async consultarCliente(): Promise<Cliente | null> {
    if (this.cliente instanceof Error) throw this.cliente;
    return this.cliente;
  }

  async obterEstoqueProduto(codigoProduto: number): Promise<EstoqueOmie> {
    const registro = this.estoquesPorCodigoProduto.get(codigoProduto);
    if (registro === undefined) {
      throw new Error(`Estoque não configurado no fake para o produto ${codigoProduto}`);
    }
    if (registro instanceof Error) {
      throw registro;
    }
    return registro;
  }

  async classificarPedido(etapa: string): Promise<ResultadoClassificacao> {
    return classificarEtapa(etapa, this.etapasVendaProduto);
  }
}
