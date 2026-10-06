import type { EstoqueOmie, PedidoOmie } from '../../src/calculo/tipos.js';
import type { ClienteInfo, VendedorInfo } from '../../src/relatorio/relatorioVendas.js';
import type { ClienteOmieParaComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import type { ProdutoOmie, TituloContaReceber } from '../../src/omie/cliente.js';
import type { EtapaFaturamento } from '../../src/omie/classificacaoDocumento.js';
import type { ItemTabelaPreco, TabelaPreco } from '../../src/omie/tabelasPreco.js';

/** IDs internos reais (`nCodTabPreco`) das tabelas da conta, conferidos em 2026-10-06. */
export const ID_TABELA_001 = 2400087453;
export const ID_TABELA_002 = 2400097871;
export const ID_TABELA_003 = 2404412334;

export function itemTabela(codigoProduto: number, precoTabela: number | null, dataAlteracao = '01/01/2020', horaAlteracao: string | null = '08:00:00'): ItemTabelaPreco {
  return { codigoProduto, codigoProdutoTexto: `P${codigoProduto}`, precoTabela, dataAlteracao, horaAlteracao };
}

export function tabelaPreco(codigoComercial: '001' | '002' | '003' | string, itens: ItemTabelaPreco[], extras: Partial<TabelaPreco> = {}): TabelaPreco {
  const idInterno = codigoComercial === '001' ? ID_TABELA_001 : codigoComercial === '002' ? ID_TABELA_002 : codigoComercial === '003' ? ID_TABELA_003 : 1000 + Number(codigoComercial);
  const nome = codigoComercial === '001' ? 'CTO PROMOCIONAL.' : codigoComercial === '002' ? 'LINHA PREMIUM' : codigoComercial === '003' ? 'TABELA DE VENDA - 07/26' : `TABELA ${codigoComercial}`;
  // Tabela alterada pela última vez em 01/01/2020 08:00 (antes de qualquer venda de teste), salvo `extras`.
  return { idInterno, codigoComercial, nome, ativa: true, dataAlteracao: '01/01/2020', horaAlteracao: '08:00:00', itens, ...extras };
}

/**
 * Padrão dos testes que não tratam de tabela: produtos 1 a 9 na tabela 003 com Preço da Tabela
 * 190 (custo de referência 100), alterados em 01/01/2020 — vender a 190 = multiplicador 1,90 = 3%.
 */
export const TABELAS_PRECO_PADRAO_TESTE: TabelaPreco[] = [
  tabelaPreco('001', []),
  tabelaPreco('002', []),
  tabelaPreco('003', [1, 2, 3, 4, 5, 6, 7, 8, 9].map((codigo) => itemTabela(codigo, 190))),
];

/**
 * Configuração REAL de etapas de Venda de Produto da conta (`ListarEtapasFaturamento`, verificada
 * em 2026-09-28): o Comissionamento só aceita 50 = "PV Liberado Financeiro" e 60 = "Faturado".
 */
export const ETAPAS_VENDA_PRODUTO_CONTA_REAL: EtapaFaturamento[] = [
  { codigo: '00', descricaoPadrao: 'Proposta', descricao: 'Orçamento', inativa: true },
  { codigo: '10', descricaoPadrao: 'Pedido de Venda', descricao: 'Orçamento', inativa: false },
  { codigo: '20', descricaoPadrao: 'Separar Estoque', descricao: 'Pedido de Venda', inativa: false },
  { codigo: '50', descricaoPadrao: 'Faturar', descricao: 'PV Liberado Financeiro', inativa: false },
  { codigo: '60', descricaoPadrao: 'Faturado', descricao: 'Faturado', inativa: false },
  { codigo: '70', descricaoPadrao: 'Entrega', descricao: 'Aprovação Gerência', inativa: false },
  { codigo: '80', descricaoPadrao: '<disponível>', descricao: 'Aprovação Financeiro', inativa: false },
];

/** Cliente Omie falso para o relatório de Comissionamento — nenhum teste toca a rede. */
export class ClienteComissionamentoOmieFalso implements ClienteOmieParaComissionamento {
  constructor(
    private readonly pedidos: PedidoOmie[],
    private readonly vendedores: VendedorInfo[],
    private readonly clientesPorCodigo: Map<number, ClienteInfo>,
    private readonly estoquesPorCodigoProduto: Map<number, EstoqueOmie>,
    private readonly titulosPorVendedor: Map<number, TituloContaReceber[]>,
    private readonly etapas: EtapaFaturamento[] = ETAPAS_VENDA_PRODUTO_CONTA_REAL,
    /** Família por produto, usada pelo custo estimado (`custoEstimado.ts`). Produto não configurado -> `consultarProduto` rejeita (cai no divisor padrão). */
    private readonly produtosPorCodigo: Map<number, ProdutoOmie> = new Map(),
    /** Tabelas de preço (`ListarTabelasPreco` + `ListarTabelaItens`) — ver `TABELAS_PRECO_PADRAO_TESTE`. */
    public tabelasPreco: TabelaPreco[] = TABELAS_PRECO_PADRAO_TESTE,
  ) {}

  consultasTabelasPreco = 0;
  async listarTabelasPreco(): Promise<TabelaPreco[]> {
    this.consultasTabelasPreco += 1;
    return this.tabelasPreco;
  }

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
