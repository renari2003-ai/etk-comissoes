import { calcularItem, calcularTotais, compararComTotalOmie, montarResumoOperacional } from '../calculo/margem.js';
import { calcularCustoEstimado, ehFamiliaPremium } from '../calculo/custoEstimado.js';
import type {
  AlertaDivergenciaTotal,
  EstoqueOmie,
  FaturamentoPedido,
  ItemCalculado,
  ItemPedidoOmie,
  NotaFiscalPedido,
  PedidoCalculado,
  PedidoOmie,
  ResumoOperacional,
  TotaisPedido,
} from '../calculo/tipos.js';
import type { ResultadoClassificacao, TipoDocumento } from '../omie/classificacaoDocumento.js';
import type { Cliente, ProdutoOmie, TituloContaReceber } from '../omie/cliente.js';

/** Superfície do cliente Omie usada pelo relatório — permite injeção de um cliente falso nos testes. */
export interface ClienteOmieParaRelatorio {
  consultarPedido(identificador: { numeroPedido?: string; codigoPedido?: number }): Promise<PedidoOmie>;
  /** Não usado pelo cálculo de custo enquanto a estimativa temporária estiver ativa (ver `buscarCustoDoItem`) — mantido na interface para reverter facilmente. */
  obterEstoqueProduto(codigoProduto: number, dataReferencia: string): Promise<EstoqueOmie>;
  consultarProduto(codigoProduto: number): Promise<ProdutoOmie>;
  classificarPedido(etapa: string): Promise<ResultadoClassificacao>;
  consultarCliente(codigoCliente: number): Promise<Cliente | null>;
  listarContasReceberPorVendedor(codigoVendedor: number): Promise<TituloContaReceber[]>;
}

export interface IdentificadorPedido {
  numeroPedido?: string;
  codigoPedido?: number;
}

/**
 * Erro lançado quando o identificador consultado corresponde a um documento
 * de um tipo diferente do esperado pela rota (ex.: consultar um orçamento
 * pela rota de pedidos). Nunca é engolido silenciosamente — a separação
 * Pedido/Orçamento é uma regra crítica de negócio (seção 1 e 9-10).
 */
export class ErroTipoDocumentoIncompativel extends Error {
  constructor(
    public readonly esperado: TipoDocumento,
    public readonly encontrado: TipoDocumento,
  ) {
    const rotaCorreta = encontrado === 'ORCAMENTO' ? '/api/orcamento/:identificador' : '/api/pedido/:identificador';
    super(
      `Este identificador corresponde a um ${encontrado === 'ORCAMENTO' ? 'ORÇAMENTO' : 'PEDIDO'}, ` +
        `não a um ${esperado === 'ORCAMENTO' ? 'ORÇAMENTO' : 'PEDIDO'}. Use a rota ${rotaCorreta}.`,
    );
    this.name = 'ErroTipoDocumentoIncompativel';
  }
}

function dataDeHojeFormatoOmie(): string {
  const agora = new Date();
  const dia = String(agora.getDate()).padStart(2, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${agora.getFullYear()}`;
}

interface ResultadoNomeCliente {
  nomeCliente: string | null;
  avisoClienteNaoIdentificado?: string;
}

/**
 * A Omie não devolve o nome do cliente dentro de `pedido_venda_produto`
 * (apenas `cabecalho.codigo_cliente`) — é necessária uma chamada adicional a
 * `ConsultarCliente`, já implementada e cacheada por código em
 * `ClienteOmie.consultarCliente`. Nunca deixa uma falha nessa consulta
 * derrubar o restante do relatório (seção 11): erros viram apenas um aviso
 * discreto, e a Razão Social é preferida ao Nome Fantasia (seção 5).
 */
async function buscarNomeCliente(cliente: ClienteOmieParaRelatorio, codigoCliente: number): Promise<ResultadoNomeCliente> {
  if (!codigoCliente) return { nomeCliente: null };

  try {
    const registro = await cliente.consultarCliente(codigoCliente);
    if (registro === null) return { nomeCliente: null };
    const nome = (registro.razaoSocial || registro.nomeFantasia || '').trim();
    return { nomeCliente: nome.length > 0 ? nome : null };
  } catch {
    return {
      nomeCliente: null,
      avisoClienteNaoIdentificado: 'Não foi possível identificar o cliente deste pedido.',
    };
  }
}

function extrairCodigoVendedor(pedido: PedidoOmie): number | null {
  const bruto = pedido.informacoes_adicionais?.codVend;
  const numero = typeof bruto === 'number' ? bruto : Number(bruto);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

/**
 * Busca os títulos financeiros (Contas a Receber) vinculados a este pedido e
 * agrupa por nota fiscal — cobre o caso de FATURAMENTO PARCIAL (confirmado
 * contra a API real em 2026-09-10, pedido real "154"): quando um pedido é
 * faturado em mais de uma NF, cada fatura parcial ganha um `nCodPedido`
 * PRÓPRIO na Omie (diferente do `codigo_pedido` do pedido original), mas
 * mantém o mesmo `numero_pedido` — por isso o vínculo é feito pelos dois
 * campos (união), nunca só pelo código (mesma lógica de
 * `relatorioComissionamento.ts`). Retorna `undefined` (não um objeto vazio)
 * quando nenhum título é encontrado — nunca deixa a falha derrubar o
 * restante do relatório (seção 11).
 */
async function buscarFaturamento(cliente: ClienteOmieParaRelatorio, pedido: PedidoOmie): Promise<FaturamentoPedido | undefined> {
  const codigoVendedor = extrairCodigoVendedor(pedido);
  if (codigoVendedor === null) return undefined;

  let titulos: TituloContaReceber[];
  try {
    titulos = await cliente.listarContasReceberPorVendedor(codigoVendedor);
  } catch {
    return undefined;
  }

  const doPedido = titulos.filter(
    (t) => t.codigoPedido === pedido.cabecalho.codigo_pedido || t.numeroPedido === pedido.cabecalho.numero_pedido,
  );
  if (doPedido.length === 0) return undefined;

  const porNotaFiscal = new Map<string, TituloContaReceber[]>();
  for (const titulo of doPedido) {
    const chave = titulo.numeroNotaFiscal ?? `sem-nf-${titulo.codigoLancamentoOmie}`;
    const lista = porNotaFiscal.get(chave) ?? [];
    lista.push(titulo);
    porNotaFiscal.set(chave, lista);
  }

  const notasFiscais: NotaFiscalPedido[] = [...porNotaFiscal.entries()].map(([, parcelas]) => ({
    numero: parcelas[0]?.numeroNotaFiscal ?? null,
    valorTotal: parcelas.reduce((soma, p) => soma + p.valorDocumento, 0),
    parcelasTotal: parcelas.length,
    parcelasBaixadas: parcelas.filter((p) => p.statusTitulo === 'RECEBIDO').length,
  }));

  const valorFaturado = doPedido.reduce((soma, t) => soma + t.valorDocumento, 0);
  // `pedido.total_pedido.valor_total_pedido` é o SALDO AINDA NÃO FATURADO, não o pedido inteiro
  // (confirmado contra a API real em 2026-09-10, pedido "154": a Omie zera a quantidade/valor de
  // cada item de linha assim que ele é movido para uma fatura parcial — o registro original NUNCA
  // volta a mostrar o total cheio). O total real do pedido é esse saldo + o que já foi faturado.
  const valorPedido = (pedido.total_pedido?.valor_total_pedido ?? 0) + valorFaturado;

  return {
    valorFaturado,
    valorPedido,
    percentualFaturado: valorPedido === 0 ? null : (valorFaturado / valorPedido) * 100,
    notasFiscais,
  };
}

/**
 * Busca o custo de um item, sem deixar a falha de um produto derrubar o
 * relatório inteiro (seção 10 e regra crítica da seção 10).
 *
 * TEMPORÁRIO (decisão de negócio de 2026-09-10 — ver `custoEstimado.ts`):
 * enquanto as notas de entrada de estoque não estiverem corretas na Omie, o
 * custo é ESTIMADO a partir do preço da TABELA DE VENDAS ATIVA do produto
 * (÷ 1,90, ou ÷ 1,75 para a família "Linha Premium") — nunca do preço
 * gravado na linha do pedido, que carrega ajustes/impostos daquela venda
 * específica e por isso difere do preço de tabela (confirmado contra a API
 * real em 2026-09-10: 25 de 25 itens testados tinham preços diferentes). O
 * custo real (Custo Médio Contábil, `obterEstoqueProduto`/`resolverCusto`)
 * fica comentado abaixo — é só trocar de volta quando as notas estiverem
 * regularizadas.
 */
async function buscarCustoDoItem(
  cliente: ClienteOmieParaCusto,
  item: ItemPedidoOmie,
  _dataReferencia: string,
): Promise<{ custoUnitario: number; origemCusto: string }> {
  let ehPremium = false;
  // Preço do pedido como último recurso, apenas se a consulta ao cadastro do produto falhar
  // (nunca deixa a falta do preço de tabela derrubar o cálculo do custo — seção 10).
  let precoTabela = item.produto.valor_unitario;
  try {
    const produto = await cliente.consultarProduto(item.produto.codigo_produto);
    ehPremium = ehFamiliaPremium(produto.descricao_familia);
    if (produto.valor_unitario !== undefined && produto.valor_unitario > 0) {
      precoTabela = produto.valor_unitario;
    }
  } catch {
    // Sem informação de família/tabela disponível — segue com o preço do pedido e o divisor padrão.
  }
  return calcularCustoEstimado(precoTabela, ehPremium);

  // --- Custo real (Custo Médio Contábil da Omie) — REVERTER PARA ISTO quando as notas de entrada estiverem corretas: ---
  // try {
  //   const estoque = await cliente.obterEstoqueProduto(item.produto.codigo_produto, dataReferencia);
  //   return resolverCusto(estoque);
  // } catch {
  //   return { custoUnitario: 0, origemCusto: 'indisponivel' };
  // }
}

export interface ClienteOmieParaCusto {
  obterEstoqueProduto(codigoProduto: number, dataReferencia: string): Promise<EstoqueOmie>;
  consultarProduto(codigoProduto: number): Promise<ProdutoOmie>;
}

export interface PedidoCalculadoBase {
  itens: ItemCalculado[];
  totais: TotaisPedido;
  alertaDivergenciaTotal: AlertaDivergenciaTotal | null;
  resumoOperacional: ResumoOperacional;
}

/**
 * Resolve custo, calcula itens, totais, alerta de divergência e resumo
 * operacional de um pedido/orçamento já obtido (via `ConsultarPedido` ou
 * `ListarPedidos`, que retorna a mesma estrutura completa). Extraído de
 * `montarRelatorioPedido` para ser reaproveitado pelos relatórios agregados
 * de Vendas/Orçamentos/Comissionamento, que já têm o `PedidoOmie` completo
 * de uma listagem em lote e não precisam de uma nova consulta por registro.
 */
export async function calcularPedidoCompleto(
  cliente: ClienteOmieParaCusto,
  pedido: PedidoOmie,
  dataReferencia: string,
): Promise<PedidoCalculadoBase> {
  const itensPedido = pedido.det ?? [];

  const custos = await Promise.all(itensPedido.map((item) => buscarCustoDoItem(cliente, item, dataReferencia)));

  const itens = itensPedido.map((item, indice) => {
    const { custoUnitario, origemCusto } = custos[indice] ?? { custoUnitario: 0, origemCusto: 'sem custo' };
    return calcularItem(item, custoUnitario, origemCusto);
  });

  const totais = calcularTotais(
    itensPedido,
    custos.map((c) => c.custoUnitario),
    custos.map((c) => c.origemCusto),
  );

  const alertaDivergenciaTotal = compararComTotalOmie(totais.receitaTotal, pedido.total_pedido?.valor_total_pedido ?? 0);
  const resumoOperacional = montarResumoOperacional(itens, totais);

  return { itens, totais, alertaDivergenciaTotal, resumoOperacional };
}

/**
 * Orquestra a busca do pedido, resolução de custos e cálculo completo de
 * margem/markup.
 *
 * `tipoEsperado`, quando informado, impõe a separação obrigatória entre
 * Pedido e Orçamento: se o documento encontrado for de um tipo diferente do
 * esperado, a função lança `ErroTipoDocumentoIncompativel` em vez de
 * retornar os dados — nunca deixa o chamador tratar um orçamento como pedido
 * (ou vice-versa) por engano. Quando a classificação do documento é
 * ambígua (etapa não reconhecida na configuração da conta), o relatório é
 * retornado normalmente, mas com `tipoDocumento: null` e
 * `motivoClassificacaoAmbigua` preenchido — nunca classificado por
 * adivinhação.
 */
export async function montarRelatorioPedido(
  cliente: ClienteOmieParaRelatorio,
  identificador: IdentificadorPedido,
  dataReferencia: string = dataDeHojeFormatoOmie(),
  tipoEsperado?: TipoDocumento,
): Promise<PedidoCalculado> {
  const pedido = await cliente.consultarPedido(identificador);
  const classificacao = await cliente.classificarPedido(pedido.cabecalho.etapa);

  if (tipoEsperado !== undefined && !classificacao.ambiguo && classificacao.tipo !== tipoEsperado) {
    throw new ErroTipoDocumentoIncompativel(tipoEsperado, classificacao.tipo);
  }

  // Faturamento (títulos/notas fiscais) só existe para PEDIDO — ORÇAMENTO nunca é faturado.
  const buscarFaturamentoSeAplicavel =
    !classificacao.ambiguo && classificacao.tipo === 'ORCAMENTO' ? Promise.resolve(undefined) : buscarFaturamento(cliente, pedido);

  const [{ nomeCliente, avisoClienteNaoIdentificado }, { itens, totais, alertaDivergenciaTotal, resumoOperacional }, faturamento] =
    await Promise.all([
      buscarNomeCliente(cliente, pedido.cabecalho.codigo_cliente),
      calcularPedidoCompleto(cliente, pedido, dataReferencia),
      buscarFaturamentoSeAplicavel,
    ]);

  return {
    codigoPedido: pedido.cabecalho.codigo_pedido,
    numeroPedido: pedido.cabecalho.numero_pedido,
    etapa: pedido.cabecalho.etapa,
    codigoCliente: pedido.cabecalho.codigo_cliente,
    nomeCliente,
    ...(avisoClienteNaoIdentificado ? { avisoClienteNaoIdentificado } : {}),
    dataPrevisao: pedido.cabecalho.data_previsao,
    tipoDocumento: classificacao.ambiguo ? null : classificacao.tipo,
    ...(classificacao.ambiguo ? { motivoClassificacaoAmbigua: classificacao.motivo } : {}),
    ...(!classificacao.ambiguo && classificacao.tipo === 'ORCAMENTO'
      ? {
          avisoOrcamento:
            'Este documento é um ORÇAMENTO (intenção de compra), não um pedido concretizado. ' +
            'Os valores abaixo são projeção e não devem ser somados a indicadores de receita/margem de pedidos concretos.',
        }
      : {}),
    itens,
    totais,
    alertaDivergenciaTotal,
    resumoOperacional,
    ...(faturamento !== undefined ? { faturamento } : {}),
  };
}
