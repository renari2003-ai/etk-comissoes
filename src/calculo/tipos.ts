/** Tipos compartilhados pelo núcleo de cálculo de custo e margem. */

import type { TipoDocumento } from '../omie/classificacaoDocumento.js';

export interface ProdutoItemPedidoOmie {
  codigo_produto: number;
  codigo: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_mercadoria?: number;
  valor_desconto?: number;
}

export interface ItemPedidoOmie {
  produto: ProdutoItemPedidoOmie;
}

export interface CabecalhoPedidoOmie {
  codigo_pedido: number;
  numero_pedido: string;
  etapa: string;
  codigo_cliente: number;
  data_previsao?: string;
}

/**
 * Bloco de metadados de cadastro que a Omie devolve junto de
 * `pedido_venda_produto` (irmão de `cabecalho`, chave `infoCadastro` —
 * confirmado contra a API real em 2026-09-08). A Omie não expõe histórico de
 * mudança de etapa — `dAlt`/`hAlt` (data/hora da última alteração do
 * registro) é a única data real disponível para aproximar "quando o pedido
 * mudou de status pela última vez" e é usada como data de aprovação. Ver
 * `ClienteOmie.listarPedidos`.
 */
export interface InfoCadastroPedidoOmie {
  dInc?: string;
  hInc?: string;
  dAlt?: string;
  hAlt?: string;
  uAlt?: string;
}

export interface ParcelaPedidoOmie {
  numero_parcela: number;
  data_vencimento: string;
  percentual: number;
  valor: number;
}

export interface FretePedidoOmie {
  valor_frete: number;
  valor_seguro: number;
  outras_despesas: number;
}

/**
 * Bloco de totais que a Omie devolve por pedido — confirmado contra a API
 * real em 2026-09-08. Reconciliação exata verificada em 8 pedidos reais:
 *   valor_mercadorias + valor_IPI + valor_st + frete.valor_frete +
 *   frete.valor_seguro + frete.outras_despesas === valor_total_pedido
 * ICMS/PIS/COFINS/IBS/CBS (`valor_icms`, `valor_pis`, `valor_cofins`,
 * `valor_ibs`, `valor_cbs`) já estão embutidos dentro de `valor_mercadorias`
 * — não somam ao total da nota, e nunca devem ser subtraídos de novo (ver
 * `calcularMargemComissionamento.ts`). Apenas IPI e ICMS-ST (`valor_st`,
 * Substituição Tributária) são somados "por fora".
 */
export interface TotalPedidoOmie {
  valor_total_pedido: number;
  valor_mercadorias?: number;
  valor_IPI?: number;
  valor_st?: number;
  valor_icms?: number;
  valor_pis?: number;
  valor_cofins?: number;
  valor_ibs?: number;
  valor_cbs?: number;
}

export interface PedidoOmie {
  cabecalho: CabecalhoPedidoOmie;
  det: ItemPedidoOmie[];
  total_pedido: TotalPedidoOmie;
  informacoes_adicionais?: Record<string, unknown>;
  lista_parcelas?: { parcela?: ParcelaPedidoOmie[] };
  frete?: FretePedidoOmie;
  infoCadastro?: InfoCadastroPedidoOmie;
}

export interface RegistroEstoque {
  [campo: string]: unknown;
}

export interface EstoqueOmie {
  listaEstoque?: RegistroEstoque[];
  [campoRaiz: string]: unknown;
}

/** Resultado da resolução de custo de um produto: valor e de onde veio. */
export interface ResultadoCusto {
  custoUnitario: number;
  origemCusto: string;
}

/** Motivo de destaque de uma linha problemática na tabela de itens. */
export type MotivoAlertaItem = 'sem_custo' | 'custo_indisponivel' | 'margem_negativa' | 'custo_estimado';

export interface ItemCalculado {
  codigoProduto: number;
  codigo: string;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  receita: number;
  custoUnitario: number;
  custoTotal: number;
  margemValor: number;
  margemVendaPercentual: number | null;
  markupCustoPercentual: number | null;
  origemCusto: string;
  alertas: MotivoAlertaItem[];
}

export interface TotaisPedido {
  receitaTotal: number;
  custoTotal: number;
  margemTotal: number;
  margemVendaTotal: number | null;
  markupCustoTotal: number | null;
  itensSemCusto: number;
}

export interface AlertaDivergenciaTotal {
  tipo: 'divergencia_total';
  receitaCalculada: number;
  totalInformadoOmie: number;
  diferenca: number;
  explicacao: string;
}

export interface ResumoOperacional {
  margemPorRealVendido: number | null;
  itemMelhorMargem: { descricao: string; margemVendaPercentual: number | null } | null;
  itemPiorMargem: { descricao: string; margemVendaPercentual: number | null } | null;
  itemMaiorContribuicaoMargem: { descricao: string; margemValor: number; participacaoPercentual: number | null } | null;
  itensSemCusto: number;
}

export interface NotaFiscalPedido {
  numero: string | null;
  valorTotal: number;
  parcelasTotal: number;
  parcelasBaixadas: number;
}

/**
 * Presente apenas quando existem títulos financeiros (Contas a Receber)
 * vinculados a este pedido — inclui o caso de FATURAMENTO PARCIAL
 * (confirmado contra a API real em 2026-09-10): a Omie permite faturar um
 * pedido em mais de uma nota fiscal (ex.: pedido "154" faturado como NF
 * 00025739 e depois NF 00025767); cada fatura parcial recebe um código
 * interno próprio na Omie, mas o mesmo `numero_pedido` do pedido original —
 * por isso o vínculo é feito por número do pedido, não só pelo código (ver
 * `montarRelatorio.ts` → `buscarFaturamento`).
 */
export interface FaturamentoPedido {
  valorFaturado: number;
  /** Valor TOTAL do pedido (saldo ainda não faturado + já faturado) — nunca só o saldo restante que a Omie devolve em `total_pedido.valor_total_pedido` (ver `buscarFaturamento` em `montarRelatorio.ts`). */
  valorPedido: number;
  /** null quando `valorPedido` é 0. */
  percentualFaturado: number | null;
  notasFiscais: NotaFiscalPedido[];
}

export interface PedidoCalculado {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  codigoCliente: number;
  /** Razão Social (preferencial) ou Nome Fantasia do cliente vinculado ao pedido, via `ConsultarCliente` na Omie. `null` quando o pedido não tem cliente identificado. */
  nomeCliente: string | null;
  /** Presente apenas quando a consulta do cliente falhou (nunca impede a exibição do restante do pedido). */
  avisoClienteNaoIdentificado?: string;
  dataPrevisao?: string;
  /** PEDIDO = compra concreta. ORCAMENTO = intenção de compra. Nunca inferido por adivinhação — ver `classificacaoDocumento.ts`. */
  tipoDocumento: TipoDocumento | null;
  /** Presente apenas quando `tipoDocumento` é `null`: motivo pelo qual a etapa não pôde ser classificada com segurança. */
  motivoClassificacaoAmbigua?: string;
  /** Presente apenas quando `tipoDocumento` é `ORCAMENTO`: os valores abaixo são projeção, não receita concretizada. */
  avisoOrcamento?: string;
  itens: ItemCalculado[];
  totais: TotaisPedido;
  alertaDivergenciaTotal: AlertaDivergenciaTotal | null;
  resumoOperacional: ResumoOperacional;
  /** Ver `FaturamentoPedido`. Ausente quando nenhum título financeiro foi localizado para este pedido (nunca inventado). */
  faturamento?: FaturamentoPedido;
}
