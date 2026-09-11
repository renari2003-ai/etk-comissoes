/**
 * Frontend da ferramenta de relatório de custo e margem. Toda a interface é
 * uma página única (seção 26). Dados vindos da API são tratados como
 * externos: renderizados sempre via textContent, nunca innerHTML.
 *
 * Separação obrigatória entre Pedido (compra concreta) e Orçamento
 * (intenção de compra): a interface tem duas abas independentes, cada uma
 * com sua própria busca, listagem de recentes e rota de API. Nunca mistura
 * as duas categorias na mesma lista ou nos mesmos totais.
 *
 * A simulação de markup editável / preço de venda (ver `precificacao.ts`) é
 * uma camada adicional, exclusiva de ORÇAMENTO — nunca aparece para Pedido,
 * que já representa uma venda concretizada — e é puramente local: nada é
 * enviado à Omie.
 */

import {
  calcularMarkupInicial,
  calcularPrecificacaoItem,
  calcularValorTotalOrcamento,
  interpretarMarkupDigitado,
  type MotivoMarkupInvalido,
  type ResultadoPrecificacaoItem,
} from './precificacao.js';
import { formatarMoeda, formatarPercentual } from './formatacao.js';
import { inicializarRelatorios } from './relatorios.js';
import { inicializarUsuarios } from './usuarios.js';
import './auth.js';

type TipoDocumento = 'PEDIDO' | 'ORCAMENTO';

interface ItemCalculado {
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
  alertas: string[];
}

interface TotaisPedido {
  receitaTotal: number;
  custoTotal: number;
  margemTotal: number;
  margemVendaTotal: number | null;
  markupCustoTotal: number | null;
  itensSemCusto: number;
}

interface AlertaDivergenciaTotal {
  receitaCalculada: number;
  totalInformadoOmie: number;
  diferenca: number;
  explicacao: string;
}

interface ResumoOperacional {
  margemPorRealVendido: number | null;
  itemMelhorMargem: { descricao: string; margemVendaPercentual: number | null } | null;
  itemPiorMargem: { descricao: string; margemVendaPercentual: number | null } | null;
  itemMaiorContribuicaoMargem: { descricao: string; margemValor: number; participacaoPercentual: number | null } | null;
  itensSemCusto: number;
}

interface NotaFiscalPedido {
  numero: string | null;
  valorTotal: number;
  parcelasTotal: number;
  parcelasBaixadas: number;
}

interface FaturamentoPedido {
  valorFaturado: number;
  valorPedido: number;
  percentualFaturado: number | null;
  notasFiscais: NotaFiscalPedido[];
}

interface PedidoCalculado {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  codigoCliente: number;
  nomeCliente: string | null;
  avisoClienteNaoIdentificado?: string;
  dataPrevisao?: string;
  tipoDocumento: TipoDocumento | null;
  motivoClassificacaoAmbigua?: string;
  avisoOrcamento?: string;
  itens: ItemCalculado[];
  totais: TotaisPedido;
  alertaDivergenciaTotal: AlertaDivergenciaTotal | null;
  resumoOperacional: ResumoOperacional;
  faturamento?: FaturamentoPedido;
}

interface DocumentoResumo {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  statusRotulo: string;
  dataAprovacao: string | null;
  horaAprovacao: string | null;
  data?: string;
  valorTotal: number;
  tipoDocumento: TipoDocumento;
}

const MOTIVOS_LEGIVEIS: Record<string, string> = {
  sem_custo: 'Sem custo encontrado',
  custo_indisponivel: 'Custo indisponível',
  margem_negativa: 'Margem negativa',
  custo_estimado: 'Custo estimado (preço ÷ divisor) — temporário até as notas de entrada estarem corretas',
};

const ROTULOS_POR_TIPO: Record<
  TipoDocumento,
  { singular: string; artigoSingular: string; recentes: string; areaVazia: string; itensTabela: string; placeholder: string }
> = {
  PEDIDO: {
    singular: 'pedido',
    artigoSingular: 'um pedido',
    recentes: 'Pedidos recentes',
    areaVazia: 'Nenhum pedido carregado. Informe um número acima ou selecione um pedido recente.',
    itensTabela: 'Itens do pedido',
    placeholder: 'Buscar pedido pelo número…',
  },
  ORCAMENTO: {
    singular: 'orçamento',
    artigoSingular: 'um orçamento',
    recentes: 'Orçamentos recentes',
    areaVazia: 'Nenhum orçamento carregado. Informe um número acima ou selecione um orçamento recente.',
    itensTabela: 'Itens do orçamento',
    placeholder: 'Buscar orçamento pelo número…',
  },
};

function caminhoListagem(tipo: TipoDocumento): string {
  return tipo === 'PEDIDO' ? '/api/pedidos' : '/api/orcamentos';
}

function caminhoDetalhe(tipo: TipoDocumento, identificador: string): string {
  const base = tipo === 'PEDIDO' ? '/api/pedido' : '/api/orcamento';
  return `${base}/${encodeURIComponent(identificador)}`;
}

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`Elemento #${id} não encontrado`);
  return elemento as T;
}

const formBusca = el<HTMLFormElement>('form-busca');
const campoIdentificador = el<HTMLInputElement>('campo-identificador');
const campoPorCodigo = el<HTMLInputElement>('campo-por-codigo');
const abaPedidos = el<HTMLButtonElement>('aba-pedidos');
const abaOrcamentos = el<HTMLButtonElement>('aba-orcamentos');
const avisoTipoDocumento = el<HTMLElement>('aviso-tipo-documento');
const cabecalhoPedido = el<HTMLElement>('cabecalho-pedido');
const cabecalhoPedidoNumero = el<HTMLElement>('cabecalho-pedido-numero');
const cabecalhoPedidoCliente = el<HTMLElement>('cabecalho-pedido-cliente');
const cabecalhoPedidoAvisoCliente = el<HTMLElement>('cabecalho-pedido-aviso-cliente');
const cabecalhoPedidoFaturamento = el<HTMLElement>('cabecalho-pedido-faturamento');
const cabecalhoPedidoFaturamentoResumo = el<HTMLElement>('cabecalho-pedido-faturamento-resumo');
const cabecalhoPedidoNotasFiscais = el<HTMLUListElement>('cabecalho-pedido-notas-fiscais');
const tituloRecentes = el<HTMLElement>('titulo-recentes');
const tituloAreaTabela = el<HTMLElement>('titulo-area-tabela');
const textoAreaVazia = el<HTMLElement>('texto-area-vazia');
const faixaTotais = el<HTMLElement>('faixa-totais');
const areaAlertas = el<HTMLElement>('area-alertas');
const areaResumo = el<HTMLElement>('area-resumo');
const listaResumo = el<HTMLUListElement>('lista-resumo');
const areaTabela = el<HTMLElement>('area-tabela');
const corpoTabela = el<HTMLTableSectionElement>('corpo-tabela');
const rodapeTabela = el<HTMLTableSectionElement>('rodape-tabela');
const areaVazia = el<HTMLElement>('area-vazia');
const areaErro = el<HTMLElement>('area-erro');
const indicadorCarregamento = el<HTMLElement>('indicador-carregamento');
const botaoCsv = el<HTMLButtonElement>('botao-csv');
const botaoExpandirTabela = el<HTMLButtonElement>('botao-expandir-tabela');
const textoExpandirTabela = el<HTMLElement>('texto-expandir-tabela');
const fundoTabelaExpandida = el<HTMLElement>('fundo-tabela-expandida');
const botaoCarregarRecentes = el<HTMLButtonElement>('botao-carregar-recentes');
const listaRecentes = el<HTMLUListElement>('lista-recentes');
const cabecalhosPrecificacao = [
  el<HTMLElement>('cabecalho-markup-editavel'),
  el<HTMLElement>('cabecalho-preco-venda'),
  el<HTMLElement>('cabecalho-preco-total'),
  el<HTMLElement>('cabecalho-subtotal'),
];
const areaValorTotalOrcamento = el<HTMLElement>('area-valor-total-orcamento');
const valorTotalOrcamentoEl = el<HTMLElement>('valor-total-orcamento');

let tipoAtivo: TipoDocumento = 'PEDIDO';
let pedidoAtual: PedidoCalculado | null = null;
let identificadorAtualParaCsv: { identificador: string; porCodigo: boolean; tipo: TipoDocumento } | null = null;

/**
 * Estado local (nunca enviado à Omie) da simulação de precificação de cada
 * item do orçamento atualmente carregado, indexado na mesma ordem de
 * `pedidoAtual.itens`. `markup: null` = sem valor calculável/informado
 * (ex.: custo zero e usuário ainda não digitou nada).
 */
interface EstadoMarkupItem {
  markup: number | null;
  invalido: MotivoMarkupInvalido | null;
}
let estadoPrecificacao: EstadoMarkupItem[] = [];
/** Último resultado válido calculado por item — congelado enquanto o campo estiver com valor inválido (seção 16: nunca calcular com valor inválido). */
let resultadosPrecificacao: ResultadoPrecificacaoItem[] = [];

/**
 * Estado local (nunca enviado à Omie) de custo unitário digitado manualmente
 * pelo usuário, indexado como `pedidoAtual.itens`. Só é editável quando a
 * Omie não retornou um custo real (alerta `sem_custo` ou
 * `custo_indisponivel`) — quando a Omie encontra o custo, o campo permanece
 * bloqueado, nunca sobrescrito. `custoUnitario: null` = campo ainda vazio ou
 * valor inválido (a última leitura válida fica congelada nas células).
 */
interface EstadoCustoManualItem {
  custoUnitario: number | null;
  invalido: MotivoMarkupInvalido | null;
}
let estadoCustoManual: EstadoCustoManualItem[] = [];

function mostrarCarregando(mostrar: boolean): void {
  indicadorCarregamento.hidden = !mostrar;
}

function limparResultado(): void {
  cabecalhoPedido.hidden = true;
  cabecalhoPedidoNumero.textContent = '';
  cabecalhoPedidoCliente.textContent = '';
  cabecalhoPedidoAvisoCliente.hidden = true;
  cabecalhoPedidoAvisoCliente.textContent = '';
  cabecalhoPedidoFaturamento.hidden = true;
  cabecalhoPedidoFaturamentoResumo.textContent = '';
  cabecalhoPedidoNotasFiscais.textContent = '';
  faixaTotais.hidden = true;
  areaAlertas.hidden = true;
  areaAlertas.textContent = '';
  areaResumo.hidden = true;
  areaTabela.hidden = true;
  areaErro.hidden = true;
  avisoTipoDocumento.hidden = true;
  avisoTipoDocumento.textContent = '';
  areaValorTotalOrcamento.hidden = true;
  for (const cabecalho of cabecalhosPrecificacao) cabecalho.hidden = true;
  estadoPrecificacao = [];
  resultadosPrecificacao = [];
  estadoCustoManual = [];
  areaTabela.classList.remove('area-tabela-expandida');
  fundoTabelaExpandida.hidden = true;
  document.body.classList.remove('corpo-tabela-expandida');
  botaoExpandirTabela.setAttribute('aria-pressed', 'false');
  textoExpandirTabela.textContent = 'Expandir';
}

function mostrarErro(mensagem: string): void {
  limparResultado();
  areaVazia.hidden = true;
  areaErro.hidden = false;
  areaErro.textContent = mensagem;
}

function aplicarRotulosDaAba(): void {
  const rotulos = ROTULOS_POR_TIPO[tipoAtivo];
  tituloRecentes.textContent = rotulos.recentes;
  tituloAreaTabela.textContent = rotulos.itensTabela;
  textoAreaVazia.textContent = rotulos.areaVazia;
  campoIdentificador.placeholder = rotulos.placeholder;

  abaPedidos.classList.toggle('aba-ativa', tipoAtivo === 'PEDIDO');
  abaPedidos.setAttribute('aria-selected', String(tipoAtivo === 'PEDIDO'));
  abaOrcamentos.classList.toggle('aba-ativa', tipoAtivo === 'ORCAMENTO');
  abaOrcamentos.setAttribute('aria-selected', String(tipoAtivo === 'ORCAMENTO'));
}

function trocarAba(tipo: TipoDocumento): void {
  if (tipo === tipoAtivo) return;
  tipoAtivo = tipo;
  pedidoAtual = null;
  identificadorAtualParaCsv = null;
  campoIdentificador.value = '';
  limparResultado();
  areaVazia.hidden = false;
  // Limpa a lista de recentes imediatamente: nunca deixar itens da aba
  // anterior visíveis sob o título já trocado (ex.: "Pedido 1" listado como
  // se fosse um orçamento recente enquanto a nova lista carrega).
  listaRecentes.textContent = '';
  aplicarRotulosDaAba();
  void carregarRecentes();
}

abaPedidos.addEventListener('click', () => trocarAba('PEDIDO'));
abaOrcamentos.addEventListener('click', () => trocarAba('ORCAMENTO'));

function definirMetrica(idValor: string, valor: number | null, comCor: boolean): void {
  const elemento = el<HTMLElement>(idValor);
  elemento.textContent = formatarMoeda(valor);
  elemento.classList.remove('positivo', 'negativo');
  if (comCor && valor !== null) {
    elemento.classList.add(valor >= 0 ? 'positivo' : 'negativo');
  }
}

function renderizarCabecalhoPedido(pedido: PedidoCalculado): void {
  const rotuloSingular = ROTULOS_POR_TIPO[tipoAtivo].singular === 'pedido' ? 'Pedido' : 'Orçamento';
  cabecalhoPedidoNumero.textContent = `${rotuloSingular} nº ${pedido.numeroPedido}`;
  cabecalhoPedidoCliente.textContent = `Cliente: ${pedido.nomeCliente ?? 'Não identificado'}`;

  if (pedido.avisoClienteNaoIdentificado) {
    cabecalhoPedidoAvisoCliente.textContent = pedido.avisoClienteNaoIdentificado;
    cabecalhoPedidoAvisoCliente.hidden = false;
  } else {
    cabecalhoPedidoAvisoCliente.hidden = true;
    cabecalhoPedidoAvisoCliente.textContent = '';
  }

  if (pedido.faturamento) {
    const { valorFaturado, valorPedido, percentualFaturado, notasFiscais } = pedido.faturamento;
    const completo = percentualFaturado !== null && percentualFaturado >= 99.995; // tolerância de arredondamento
    cabecalhoPedidoFaturamentoResumo.textContent = completo
      ? `Faturado por completo: ${formatarMoeda(valorFaturado)} em ${notasFiscais.length} nota(s) fiscal(is)`
      : `Faturamento parcial: ${formatarMoeda(valorFaturado)} de ${formatarMoeda(valorPedido)}` +
        `${percentualFaturado !== null ? ` (${formatarPercentual(percentualFaturado)})` : ''} — ${notasFiscais.length} nota(s) fiscal(is)`;

    cabecalhoPedidoNotasFiscais.textContent = '';
    for (const nf of notasFiscais) {
      const li = document.createElement('li');
      li.textContent = `NF ${nf.numero ?? '—'}: ${formatarMoeda(nf.valorTotal)} (${nf.parcelasBaixadas}/${nf.parcelasTotal} parcela(s) baixada(s))`;
      cabecalhoPedidoNotasFiscais.appendChild(li);
    }
    cabecalhoPedidoFaturamento.hidden = false;
  } else {
    cabecalhoPedidoFaturamento.hidden = true;
  }

  cabecalhoPedido.hidden = false;
}

function renderizarAvisoTipoDocumento(pedido: PedidoCalculado): void {
  if (pedido.tipoDocumento === null) {
    avisoTipoDocumento.textContent =
      `Atenção: não foi possível determinar com segurança se este documento é PEDIDO ou ORÇAMENTO ` +
      `(${pedido.motivoClassificacaoAmbigua ?? 'etapa não reconhecida'}). Os valores abaixo não devem ser contabilizados ` +
      'em indicadores até que a classificação seja revisada manualmente na Omie.';
    avisoTipoDocumento.hidden = false;
    return;
  }

  if (pedido.tipoDocumento === 'ORCAMENTO' && pedido.avisoOrcamento) {
    avisoTipoDocumento.textContent = pedido.avisoOrcamento;
    avisoTipoDocumento.hidden = false;
    return;
  }

  avisoTipoDocumento.hidden = true;
}

function renderizarAlertas(pedido: PedidoCalculado): void {
  const mensagens: string[] = [];

  if (pedido.totais.itensSemCusto > 0) {
    mensagens.push(
      `${pedido.totais.itensSemCusto} item(ns) deste ${ROTULOS_POR_TIPO[tipoAtivo].singular} entraram no relatório sem custo encontrado ou com custo indisponível. ` +
        'A margem calculada para esses itens pode estar artificialmente inflada.',
    );
  }

  if (pedido.totais.margemTotal < 0) {
    mensagens.push(`A margem total deste ${ROTULOS_POR_TIPO[tipoAtivo].singular} é negativa.`);
  }

  if (pedido.alertaDivergenciaTotal !== null) {
    const a = pedido.alertaDivergenciaTotal;
    mensagens.push(
      `A receita calculada (${formatarMoeda(a.receitaCalculada)}) difere do total informado pela Omie ` +
        `(${formatarMoeda(a.totalInformadoOmie)}) em ${formatarMoeda(Math.abs(a.diferenca))}. ${a.explicacao}`,
    );
  }

  areaAlertas.textContent = '';
  if (mensagens.length === 0) {
    areaAlertas.hidden = true;
    return;
  }

  for (const mensagem of mensagens) {
    const div = document.createElement('div');
    div.className = 'alerta';
    const forte = document.createElement('strong');
    forte.textContent = 'Atenção:';
    div.appendChild(forte);
    div.appendChild(document.createTextNode(mensagem));
    areaAlertas.appendChild(div);
  }
  areaAlertas.hidden = false;
}

function renderizarResumo(pedido: PedidoCalculado): void {
  const r = pedido.resumoOperacional;
  listaResumo.textContent = '';

  const itens: string[] = [];

  if (r.margemPorRealVendido !== null) {
    itens.push(`A cada R$ 1,00 vendido, sobram ${formatarMoeda(r.margemPorRealVendido / 100)} de margem.`);
  } else {
    itens.push('Não foi possível calcular a margem por real vendido (receita total igual a zero).');
  }

  if (r.itemMelhorMargem !== null) {
    itens.push(
      `Melhor margem: "${r.itemMelhorMargem.descricao}" (${formatarPercentual(r.itemMelhorMargem.margemVendaPercentual)}).`,
    );
  }
  if (r.itemPiorMargem !== null) {
    itens.push(
      `Pior margem: "${r.itemPiorMargem.descricao}" (${formatarPercentual(r.itemPiorMargem.margemVendaPercentual)}).`,
    );
  }
  if (r.itemMaiorContribuicaoMargem !== null) {
    const c = r.itemMaiorContribuicaoMargem;
    const participacao = c.participacaoPercentual !== null ? ` (${formatarPercentual(c.participacaoPercentual)} da margem total)` : '';
    itens.push(`Maior contribuição em margem: "${c.descricao}" com ${formatarMoeda(c.margemValor)}${participacao}.`);
  }
  itens.push(
    r.itensSemCusto > 0
      ? `${r.itensSemCusto} item(ns) sem custo encontrado.`
      : 'Todos os itens têm custo identificado.',
  );

  for (const texto of itens) {
    const li = document.createElement('li');
    li.textContent = texto;
    listaResumo.appendChild(li);
  }
  areaResumo.hidden = false;
}

const MENSAGENS_MARKUP_INVALIDO: Record<MotivoMarkupInvalido, string> = {
  nao_numerico: 'Informe um número válido (ex.: 2 ou 2,5).',
  negativo: 'Markup não pode ser negativo.',
};

/** Formata um número para o campo de edição: precisão completa, sem separador de milhar, sem zeros à direita desnecessários. */
function formatarMarkupParaEdicao(valor: number): string {
  if (Number.isInteger(valor)) return String(valor);
  return valor.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Inicializa a simulação de precificação de um orçamento: markup editável
 * inicial = preço unitário original (já existente no item) ÷ custo unitário
 * (seção 3) — nunca um novo campo inventado. Apenas para ORÇAMENTO.
 */
function inicializarPrecificacao(pedido: PedidoCalculado): void {
  estadoPrecificacao = pedido.itens.map((item) => ({
    markup: calcularMarkupInicial(item.valorUnitario, item.custoUnitario),
    invalido: null,
  }));
  resultadosPrecificacao = pedido.itens.map((item, indice) =>
    calcularPrecificacaoItem(
      { quantidade: item.quantidade, custoUnitario: item.custoUnitario },
      estadoPrecificacao[indice]?.markup ?? null,
    ),
  );
}

function atualizarValorTotalOrcamento(): void {
  const subtotais = resultadosPrecificacao.map((resultado) => resultado.subtotal);
  valorTotalOrcamentoEl.textContent = formatarMoeda(calcularValorTotalOrcamento(subtotais));
}

/**
 * Recalcula e re-renderiza a linha `indice` após uma edição de markup.
 * Com valor inválido (seção 16), nunca recalcula — apenas destaca o campo e
 * explica o problema, mantendo o último resultado válido nas células.
 */
function atualizarLinhaPrecificacao(pedido: PedidoCalculado, indice: number): void {
  const estado = estadoPrecificacao[indice];
  const item = pedido.itens[indice];
  if (estado === undefined || item === undefined) return;

  const inputEl = document.getElementById(`markup-editavel-${indice}`);
  const erroEl = document.getElementById(`erro-markup-${indice}`);
  if (inputEl instanceof HTMLInputElement) {
    inputEl.classList.toggle('campo-invalido', estado.invalido !== null);
  }
  if (erroEl !== null) {
    erroEl.textContent = estado.invalido !== null ? MENSAGENS_MARKUP_INVALIDO[estado.invalido] : '';
  }

  if (estado.invalido !== null) return;

  // Usa o custo EFETIVO (digitado manualmente, quando houver) — nunca o custo original parado em zero.
  const resultado = calcularPrecificacaoItem(
    { quantidade: item.quantidade, custoUnitario: custoUnitarioEfetivo(item, indice) },
    estado.markup,
  );
  resultadosPrecificacao[indice] = resultado;

  const precoVendaEl = document.getElementById(`preco-venda-${indice}`);
  const precoTotalEl = document.getElementById(`preco-total-${indice}`);
  const subtotalEl = document.getElementById(`subtotal-${indice}`);
  if (precoVendaEl !== null) precoVendaEl.textContent = formatarMoeda(resultado.precoVenda);
  if (precoTotalEl !== null) precoTotalEl.textContent = formatarMoeda(resultado.precoTotal);
  if (subtotalEl !== null) subtotalEl.textContent = formatarMoeda(resultado.subtotal);

  const rodapePrecoTotalEl = document.getElementById('rodape-preco-total');
  const rodapeSubtotalEl = document.getElementById('rodape-subtotal');
  const somaPrecoTotal = resultadosPrecificacao.reduce((soma, r) => soma + (r.precoTotal ?? 0), 0);
  if (rodapePrecoTotalEl !== null) rodapePrecoTotalEl.textContent = formatarMoeda(somaPrecoTotal);
  if (rodapeSubtotalEl !== null) rodapeSubtotalEl.textContent = formatarMoeda(somaPrecoTotal);

  atualizarValorTotalOrcamento();
}

/**
 * Constrói as 4 células de precificação de uma linha (markup editável,
 * preço de venda, preço total, subtotal) — exclusivo de ORÇAMENTO (seção 22).
 */
function montarCelulasPrecificacao(tr: HTMLTableRowElement, pedido: PedidoCalculado, item: ItemCalculado, indice: number): void {
  const estado = estadoPrecificacao[indice];
  const resultado = resultadosPrecificacao[indice];
  const semCustoAgora = custoUnitarioEfetivo(item, indice) === 0;

  const tdMarkup = document.createElement('td');
  tdMarkup.className = 'col-num';
  const wrapperMarkup = document.createElement('div');
  wrapperMarkup.className = 'celula-markup-editavel';
  const inputMarkup = document.createElement('input');
  inputMarkup.type = 'text';
  inputMarkup.inputMode = 'decimal';
  inputMarkup.id = `markup-editavel-${indice}`;
  inputMarkup.className = 'campo-markup-editavel';
  inputMarkup.value = estado?.markup !== null && estado?.markup !== undefined ? formatarMarkupParaEdicao(estado.markup) : '';
  inputMarkup.placeholder = semCustoAgora ? 'Sem custo' : '';
  inputMarkup.setAttribute('aria-label', `Markup editável — ${item.descricao}`);
  inputMarkup.addEventListener('input', () => {
    const interpretado = interpretarMarkupDigitado(inputMarkup.value);
    if (typeof interpretado === 'number') {
      estadoPrecificacao[indice] = { markup: interpretado, invalido: null };
    } else {
      estadoPrecificacao[indice] = { markup: estadoPrecificacao[indice]?.markup ?? null, invalido: interpretado };
    }
    atualizarLinhaPrecificacao(pedido, indice);
  });
  wrapperMarkup.appendChild(inputMarkup);

  const avisoSemCusto = document.createElement('span');
  avisoSemCusto.id = `aviso-sem-custo-markup-${indice}`;
  avisoSemCusto.className = 'sem-custo-markup';
  avisoSemCusto.textContent = 'Sem custo';
  avisoSemCusto.hidden = !semCustoAgora;
  wrapperMarkup.appendChild(avisoSemCusto);

  const erro = document.createElement('span');
  erro.id = `erro-markup-${indice}`;
  erro.className = 'erro-markup-editavel';
  erro.textContent = estado?.invalido !== null && estado?.invalido !== undefined ? MENSAGENS_MARKUP_INVALIDO[estado.invalido] : '';
  wrapperMarkup.appendChild(erro);

  tdMarkup.appendChild(wrapperMarkup);
  tr.appendChild(tdMarkup);

  const adicionarCelulaCalculada = (id: string, valor: number | null) => {
    const td = document.createElement('td');
    td.className = 'col-num';
    td.id = id;
    td.textContent = formatarMoeda(valor);
    tr.appendChild(td);
  };

  adicionarCelulaCalculada(`preco-venda-${indice}`, resultado?.precoVenda ?? null);
  adicionarCelulaCalculada(`preco-total-${indice}`, resultado?.precoTotal ?? null);
  adicionarCelulaCalculada(`subtotal-${indice}`, resultado?.subtotal ?? null);
}

/** true somente quando a Omie não retornou um custo real para o item (alertas `sem_custo`/`custo_indisponivel`) — nunca sobrescreve um custo já encontrado. */
function custoEhEditavel(item: ItemCalculado): boolean {
  return item.alertas.includes('sem_custo') || item.alertas.includes('custo_indisponivel');
}

/** Custo unitário efetivo da linha: o digitado manualmente (se válido), senão o resolvido pela Omie (0 quando não encontrado). */
function custoUnitarioEfetivo(item: ItemCalculado, indice: number): number {
  const estado = estadoCustoManual[indice];
  return estado?.custoUnitario ?? item.custoUnitario;
}

interface RecalculoCusto {
  custoTotal: number;
  margemValor: number;
  margemVendaPercentual: number | null;
  markupCustoPercentual: number | null;
}

/**
 * Recalcula margem/markup de um item a partir de um custo unitário diferente
 * do resolvido pela Omie — mesma fórmula de `src/calculo/margem.ts`, aplicada
 * localmente (nunca envia nada à Omie). `receita` nunca muda: só o custo é
 * substituído pelo valor digitado pelo usuário.
 */
function recalcularComCustoManual(item: ItemCalculado, custoUnitario: number): RecalculoCusto {
  const custoTotal = custoUnitario * item.quantidade;
  const margemValor = item.receita - custoTotal;
  const margemVendaPercentual = item.receita === 0 ? null : (margemValor / item.receita) * 100;
  const markupCustoPercentual = custoTotal === 0 ? null : (margemValor / custoTotal) * 100;
  return { custoTotal, margemValor, margemVendaPercentual, markupCustoPercentual };
}

/**
 * Recalcula os totais (Receita/Custo/Margem/Markup) usando, para cada item,
 * o custo manual digitado quando houver (seção do custo editável) — os
 * mesmos itens sem custo editado continuam usando o custo original da Omie.
 * Nunca recalcula o resumo operacional (melhor/pior item, alertas de
 * divergência) — fora do escopo desta simulação local.
 */
function recalcularTotaisComCustoManual(pedido: PedidoCalculado): {
  custoTotal: number;
  margemTotal: number;
  margemVendaTotal: number | null;
  markupCustoTotal: number | null;
} {
  let receitaTotal = 0;
  let custoTotal = 0;
  pedido.itens.forEach((item, indice) => {
    const custoUnitario = custoUnitarioEfetivo(item, indice);
    receitaTotal += item.receita;
    custoTotal += custoUnitario * item.quantidade;
  });
  const margemTotal = receitaTotal - custoTotal;
  const margemVendaTotal = receitaTotal === 0 ? null : (margemTotal / receitaTotal) * 100;
  const markupCustoTotal = custoTotal === 0 ? null : (margemTotal / custoTotal) * 100;
  return { custoTotal, margemTotal, margemVendaTotal, markupCustoTotal };
}

/**
 * Após editar o custo manual de uma linha: recalcula e atualiza a linha, os
 * totais do rodapé da tabela e os cards de Custo/Margem/Markup no topo. Com
 * valor inválido, nunca recalcula — apenas destaca o campo (mesma regra do
 * markup editável, seção 16).
 */
function atualizarLinhaCustoManual(pedido: PedidoCalculado, indice: number): void {
  const estado = estadoCustoManual[indice];
  const item = pedido.itens[indice];
  if (estado === undefined || item === undefined) return;

  const inputEl = document.getElementById(`custo-manual-${indice}`);
  const erroEl = document.getElementById(`erro-custo-manual-${indice}`);
  if (inputEl instanceof HTMLInputElement) {
    inputEl.classList.toggle('campo-invalido', estado.invalido !== null);
  }
  if (erroEl !== null) {
    erroEl.textContent = estado.invalido !== null ? MENSAGENS_MARKUP_INVALIDO[estado.invalido] : '';
  }
  if (estado.invalido !== null) return;

  const custoUnitario = custoUnitarioEfetivo(item, indice);
  const recalculo = recalcularComCustoManual(item, custoUnitario);

  const custoTotalEl = document.getElementById(`custo-total-${indice}`);
  const margemValorEl = document.getElementById(`margem-valor-${indice}`);
  const margemVendaEl = document.getElementById(`margem-venda-${indice}`);
  const markupCustoEl = document.getElementById(`markup-custo-${indice}`);
  if (custoTotalEl !== null) custoTotalEl.textContent = formatarMoeda(recalculo.custoTotal);
  if (margemValorEl !== null) {
    margemValorEl.textContent = formatarMoeda(recalculo.margemValor);
    margemValorEl.classList.toggle('valor-negativo', recalculo.margemValor < 0);
    margemValorEl.classList.toggle('valor-positivo', recalculo.margemValor >= 0);
  }
  if (margemVendaEl !== null) margemVendaEl.textContent = formatarPercentual(recalculo.margemVendaPercentual);
  if (markupCustoEl !== null) markupCustoEl.textContent = formatarPercentual(recalculo.markupCustoPercentual);

  const totais = recalcularTotaisComCustoManual(pedido);
  const rodapeCustoTotalEl = document.getElementById('rodape-custo-total');
  const rodapeMargemValorEl = document.getElementById('rodape-margem-valor');
  const rodapeMargemVendaEl = document.getElementById('rodape-margem-venda');
  const rodapeMarkupCustoEl = document.getElementById('rodape-markup-custo');
  if (rodapeCustoTotalEl !== null) rodapeCustoTotalEl.textContent = formatarMoeda(totais.custoTotal);
  if (rodapeMargemValorEl !== null) rodapeMargemValorEl.textContent = formatarMoeda(totais.margemTotal);
  if (rodapeMargemVendaEl !== null) rodapeMargemVendaEl.textContent = formatarPercentual(totais.margemVendaTotal);
  if (rodapeMarkupCustoEl !== null) rodapeMarkupCustoEl.textContent = formatarPercentual(totais.markupCustoTotal);

  definirMetrica('valor-custo', totais.custoTotal, false);
  definirMetrica('valor-margem', totais.margemTotal, true);
  el<HTMLElement>('valor-margem-venda').textContent = formatarPercentual(totais.margemVendaTotal);
  el<HTMLElement>('valor-markup').textContent = formatarPercentual(totais.markupCustoTotal);

  if (pedido.tipoDocumento === 'ORCAMENTO') {
    atualizarMarkupAposCustoManual(pedido, indice, custoUnitario);
  }
}

/**
 * A simulação de markup editável (seção de precificação) dependia do custo
 * original do item — sempre zero quando "sem custo encontrado". Ao digitar
 * um custo manual, ela passa a usar esse valor: se o usuário ainda não tinha
 * digitado nenhum markup, inicializa um automaticamente (mesma regra de
 * `inicializarPrecificacao` — preço original ÷ custo); se o custo manual for
 * removido, volta ao estado "sem custo" (nunca deixa um markup calculando
 * sobre custo zero como se fosse válido).
 */
function atualizarMarkupAposCustoManual(pedido: PedidoCalculado, indice: number, custoUnitario: number): void {
  const item = pedido.itens[indice];
  const estado = estadoPrecificacao[indice];
  if (item === undefined || estado === undefined) return;

  if (custoUnitario === 0) {
    estadoPrecificacao[indice] = { markup: null, invalido: null };
  } else if (estado.markup === null && estado.invalido === null) {
    estadoPrecificacao[indice] = { markup: calcularMarkupInicial(item.valorUnitario, custoUnitario), invalido: null };
  }
  const estadoAtualizado = estadoPrecificacao[indice];

  const inputMarkupEl = document.getElementById(`markup-editavel-${indice}`);
  const avisoSemCustoEl = document.getElementById(`aviso-sem-custo-markup-${indice}`);
  if (inputMarkupEl instanceof HTMLInputElement) {
    inputMarkupEl.placeholder = custoUnitario === 0 ? 'Sem custo' : '';
    if (document.activeElement !== inputMarkupEl) {
      inputMarkupEl.value =
        estadoAtualizado?.markup !== null && estadoAtualizado?.markup !== undefined
          ? formatarMarkupParaEdicao(estadoAtualizado.markup)
          : '';
    }
  }
  if (avisoSemCustoEl !== null) avisoSemCustoEl.hidden = custoUnitario !== 0;

  atualizarLinhaPrecificacao(pedido, indice);
}

function renderizarTabela(pedido: PedidoCalculado): void {
  corpoTabela.textContent = '';
  const ehOrcamento = pedido.tipoDocumento === 'ORCAMENTO';

  for (const cabecalho of cabecalhosPrecificacao) cabecalho.hidden = !ehOrcamento;
  areaValorTotalOrcamento.hidden = !ehOrcamento;

  if (ehOrcamento) {
    inicializarPrecificacao(pedido);
  }

  pedido.itens.forEach((item, indice) => {
    const tr = document.createElement('tr');
    // "custo_estimado" é informativo (decisão de negócio temporária), não um problema — nunca pinta a linha de alerta sozinho.
    const alertasDeProblema = item.alertas.filter((motivo) => motivo !== 'custo_estimado');
    const temProblema = alertasDeProblema.length > 0;
    const temAviso = item.alertas.length > 0;
    if (temProblema) tr.classList.add('linha-problema');

    const tdProduto = document.createElement('td');
    tdProduto.className = 'celula-produto';
    const spanCodigo = document.createElement('span');
    spanCodigo.className = 'codigo-produto';
    spanCodigo.textContent = item.codigo;
    tdProduto.appendChild(spanCodigo);
    tdProduto.appendChild(document.createTextNode(item.descricao));
    if (temAviso) {
      const spanMotivo = document.createElement('span');
      spanMotivo.className = temProblema ? 'motivo-problema' : 'motivo-informativo';
      spanMotivo.textContent = item.alertas.map((motivo) => MOTIVOS_LEGIVEIS[motivo] ?? motivo).join(' · ');
      tdProduto.appendChild(spanMotivo);
    }
    tr.appendChild(tdProduto);

    const adicionarCelula = (texto: string, classeExtra?: string) => {
      const td = document.createElement('td');
      td.className = 'col-num';
      if (classeExtra) td.classList.add(classeExtra);
      td.textContent = texto;
      tr.appendChild(td);
    };

    adicionarCelula(item.quantidade.toLocaleString('pt-BR'));
    adicionarCelula(formatarMoeda(item.valorUnitario));
    adicionarCelula(formatarMoeda(item.receita));

    if (custoEhEditavel(item)) {
      const tdCusto = document.createElement('td');
      tdCusto.className = 'col-num';
      const wrapperCusto = document.createElement('div');
      wrapperCusto.className = 'celula-markup-editavel';
      const inputCusto = document.createElement('input');
      inputCusto.type = 'text';
      inputCusto.inputMode = 'decimal';
      inputCusto.id = `custo-manual-${indice}`;
      inputCusto.className = 'campo-markup-editavel';
      inputCusto.placeholder = 'Sem custo';
      const estadoCusto = estadoCustoManual[indice];
      inputCusto.value =
        estadoCusto?.custoUnitario !== null && estadoCusto?.custoUnitario !== undefined
          ? formatarMoeda(estadoCusto.custoUnitario)
          : '';
      inputCusto.setAttribute('aria-label', `Custo unitário — ${item.descricao}`);
      inputCusto.addEventListener('input', () => {
        if (inputCusto.value.trim() === '') {
          // Campo esvaziado (ex.: usuário apagou o que digitou) — volta ao estado "ainda não preenchido",
          // nunca mostra erro de validação para um campo vazio.
          estadoCustoManual[indice] = { custoUnitario: null, invalido: null };
        } else {
          const interpretado = interpretarMarkupDigitado(inputCusto.value);
          if (typeof interpretado === 'number') {
            estadoCustoManual[indice] = { custoUnitario: interpretado, invalido: null };
          } else {
            estadoCustoManual[indice] = { custoUnitario: estadoCustoManual[indice]?.custoUnitario ?? null, invalido: interpretado };
          }
        }
        atualizarLinhaCustoManual(pedido, indice);
      });
      // Ao focar: mostra o número "cru" (fácil de editar). Ao sair do campo: reformata em moeda,
      // com casas decimais (ex.: "R$ 6,00") — só quando há um valor válido digitado.
      inputCusto.addEventListener('focus', () => {
        const atual = estadoCustoManual[indice];
        inputCusto.value =
          atual?.custoUnitario !== null && atual?.custoUnitario !== undefined ? formatarMarkupParaEdicao(atual.custoUnitario) : '';
      });
      inputCusto.addEventListener('blur', () => {
        const atual = estadoCustoManual[indice];
        if (atual?.custoUnitario !== null && atual?.custoUnitario !== undefined && atual.invalido === null) {
          inputCusto.value = formatarMoeda(atual.custoUnitario);
        }
      });
      wrapperCusto.appendChild(inputCusto);

      const erroCusto = document.createElement('span');
      erroCusto.id = `erro-custo-manual-${indice}`;
      erroCusto.className = 'erro-markup-editavel';
      wrapperCusto.appendChild(erroCusto);

      tdCusto.appendChild(wrapperCusto);
      tr.appendChild(tdCusto);
    } else {
      adicionarCelula(formatarMoeda(item.custoUnitario));
    }

    const adicionarCelulaComId = (id: string, texto: string, classeExtra?: string) => {
      const td = document.createElement('td');
      td.id = id;
      td.className = 'col-num';
      if (classeExtra) td.classList.add(classeExtra);
      td.textContent = texto;
      tr.appendChild(td);
    };
    adicionarCelulaComId(`custo-total-${indice}`, formatarMoeda(item.custoTotal));
    adicionarCelulaComId(
      `margem-valor-${indice}`,
      formatarMoeda(item.margemValor),
      item.margemValor < 0 ? 'valor-negativo' : 'valor-positivo',
    );
    adicionarCelulaComId(`margem-venda-${indice}`, formatarPercentual(item.margemVendaPercentual));
    adicionarCelulaComId(`markup-custo-${indice}`, formatarPercentual(item.markupCustoPercentual));

    if (ehOrcamento) {
      montarCelulasPrecificacao(tr, pedido, item, indice);
    }

    corpoTabela.appendChild(tr);
  });

  rodapeTabela.textContent = '';
  const trTotais = document.createElement('tr');
  const celulas: Array<{ texto: string; id?: string }> = [
    { texto: 'Totais' },
    { texto: '' },
    { texto: '' },
    { texto: formatarMoeda(pedido.totais.receitaTotal) },
    { texto: '' },
    { texto: formatarMoeda(pedido.totais.custoTotal), id: 'rodape-custo-total' },
    { texto: formatarMoeda(pedido.totais.margemTotal), id: 'rodape-margem-valor' },
    { texto: formatarPercentual(pedido.totais.margemVendaTotal), id: 'rodape-margem-venda' },
    { texto: formatarPercentual(pedido.totais.markupCustoTotal), id: 'rodape-markup-custo' },
  ];
  celulas.forEach(({ texto, id }, indice) => {
    const td = document.createElement('td');
    if (indice > 0) td.classList.add('col-num');
    if (id) td.id = id;
    td.textContent = texto;
    trTotais.appendChild(td);
  });

  if (ehOrcamento) {
    // Nunca somar preços unitários/de venda para representar um total (seção 24) — célula em branco.
    const tdMarkupVazia = document.createElement('td');
    tdMarkupVazia.className = 'col-num';
    trTotais.appendChild(tdMarkupVazia);

    const tdPrecoVendaVazia = document.createElement('td');
    tdPrecoVendaVazia.className = 'col-num';
    trTotais.appendChild(tdPrecoVendaVazia);

    const somaPrecoTotal = resultadosPrecificacao.reduce((soma, r) => soma + (r.precoTotal ?? 0), 0);

    const tdPrecoTotal = document.createElement('td');
    tdPrecoTotal.className = 'col-num';
    tdPrecoTotal.id = 'rodape-preco-total';
    tdPrecoTotal.textContent = formatarMoeda(somaPrecoTotal);
    trTotais.appendChild(tdPrecoTotal);

    const tdSubtotal = document.createElement('td');
    tdSubtotal.className = 'col-num';
    tdSubtotal.id = 'rodape-subtotal';
    tdSubtotal.textContent = formatarMoeda(somaPrecoTotal);
    trTotais.appendChild(tdSubtotal);
  }

  rodapeTabela.appendChild(trTotais);

  areaTabela.hidden = false;

  if (ehOrcamento) {
    atualizarValorTotalOrcamento();
  }
}

function renderizarPedido(pedido: PedidoCalculado): void {
  limparResultado();
  areaVazia.hidden = true;

  definirMetrica('valor-receita', pedido.totais.receitaTotal, false);
  definirMetrica('valor-custo', pedido.totais.custoTotal, false);
  definirMetrica('valor-margem', pedido.totais.margemTotal, true);

  const elMargemVenda = el<HTMLElement>('valor-margem-venda');
  elMargemVenda.textContent = formatarPercentual(pedido.totais.margemVendaTotal);
  const elMarkup = el<HTMLElement>('valor-markup');
  elMarkup.textContent = formatarPercentual(pedido.totais.markupCustoTotal);

  faixaTotais.hidden = false;

  renderizarCabecalhoPedido(pedido);
  renderizarAvisoTipoDocumento(pedido);
  renderizarAlertas(pedido);
  renderizarResumo(pedido);
  renderizarTabela(pedido);
}

async function requisitarJson<T>(url: string, opcoes?: RequestInit): Promise<T> {
  const resposta = await fetch(url, opcoes);
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const corpoErro = corpo && typeof corpo === 'object' ? (corpo as { erro?: unknown; motivo?: unknown }) : null;
    const erroBase =
      typeof corpoErro?.erro === 'string'
        ? corpoErro.erro
        : 'Não foi possível consultar a Omie neste momento. Verifique sua conexão e tente novamente.';
    const motivo = typeof corpoErro?.motivo === 'string' ? corpoErro.motivo : null;
    throw new Error(motivo ? `${erroBase} ${motivo}` : erroBase);
  }
  return corpo as T;
}

async function consultarPedido(identificador: string, porCodigo: boolean): Promise<void> {
  mostrarCarregando(true);
  try {
    const query = porCodigo ? '?por_codigo=true' : '';
    const pedido = await requisitarJson<PedidoCalculado>(`${caminhoDetalhe(tipoAtivo, identificador)}${query}`);
    pedidoAtual = pedido;
    identificadorAtualParaCsv = { identificador, porCodigo, tipo: tipoAtivo };
    renderizarPedido(pedido);
  } catch (erro) {
    pedidoAtual = null;
    identificadorAtualParaCsv = null;
    mostrarErro(erro instanceof Error ? erro.message : 'Erro desconhecido.');
  } finally {
    mostrarCarregando(false);
  }
}

formBusca.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const identificador = campoIdentificador.value.trim();
  if (identificador === '') return;
  void consultarPedido(identificador, campoPorCodigo.checked);
});

botaoCsv.addEventListener('click', () => {
  if (identificadorAtualParaCsv === null) return;
  const query = identificadorAtualParaCsv.porCodigo ? '?por_codigo=true' : '';
  window.location.href = `${caminhoDetalhe(identificadorAtualParaCsv.tipo, identificadorAtualParaCsv.identificador)}/csv${query}`;
});

function definirTabelaExpandida(expandida: boolean): void {
  areaTabela.classList.toggle('area-tabela-expandida', expandida);
  fundoTabelaExpandida.hidden = !expandida;
  document.body.classList.toggle('corpo-tabela-expandida', expandida);
  botaoExpandirTabela.setAttribute('aria-pressed', String(expandida));
  textoExpandirTabela.textContent = expandida ? 'Recolher' : 'Expandir';
}

botaoExpandirTabela.addEventListener('click', () => {
  definirTabelaExpandida(!areaTabela.classList.contains('area-tabela-expandida'));
});

fundoTabelaExpandida.addEventListener('click', () => definirTabelaExpandida(false));

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && areaTabela.classList.contains('area-tabela-expandida')) {
    definirTabelaExpandida(false);
  }
});

function classeCorStatus(statusRotulo: string | null): string {
  if (statusRotulo === null) return '';
  const rotulo = statusRotulo.toLowerCase();
  if (rotulo.includes('liberado financeiro')) return 'status-liberado-financeiro';
  if (rotulo.includes('faturado')) return 'status-faturado';
  return '';
}

async function carregarRecentes(): Promise<void> {
  const tipoDaRequisicao = tipoAtivo;
  mostrarCarregando(true);
  try {
    const resultado = await requisitarJson<{
      documentos: DocumentoResumo[];
      registrosBrutosNaPagina: number;
      totalDePaginas: number;
      limiteDePaginasAtingido: boolean;
    }>(`${caminhoListagem(tipoDaRequisicao)}?por_pagina=50`);
    if (tipoDaRequisicao !== tipoAtivo) return; // usuário trocou de aba enquanto a busca estava em andamento
    listaRecentes.textContent = '';

    if (resultado.documentos.length === 0) {
      const li = document.createElement('li');
      li.className = 'recentes-vazio';
      li.textContent =
        resultado.registrosBrutosNaPagina > 0
          ? `Nenhum ${ROTULOS_POR_TIPO[tipoDaRequisicao].singular} encontrado nos registros mais recentes desta conta — a Omie pagina pedidos e orçamentos juntos, e nenhuma das páginas consultadas continha um ${ROTULOS_POR_TIPO[tipoDaRequisicao].singular}.`
          : `Nenhum ${ROTULOS_POR_TIPO[tipoDaRequisicao].singular} encontrado.`;
      listaRecentes.appendChild(li);
      return;
    }

    for (const documento of resultado.documentos) {
      const li = document.createElement('li');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'item-recente';

      const linhaPrincipal = document.createElement('span');
      linhaPrincipal.className = 'linha-principal';

      const spanNumero = document.createElement('span');
      spanNumero.textContent = `${ROTULOS_POR_TIPO[tipoDaRequisicao].singular === 'pedido' ? 'Pedido nº' : 'Orçamento nº'} ${documento.numeroPedido}`;

      const spanValor = document.createElement('span');
      spanValor.className = 'valor-total';
      spanValor.textContent = formatarMoeda(documento.valorTotal);

      linhaPrincipal.appendChild(spanNumero);
      linhaPrincipal.appendChild(spanValor);

      const linhaSecundaria = document.createElement('span');
      linhaSecundaria.className = 'linha-secundaria';
      linhaSecundaria.textContent =
        documento.dataAprovacao !== null
          ? `Aprovado em ${documento.dataAprovacao}${documento.horaAprovacao ? ` às ${documento.horaAprovacao.slice(0, 5)}` : ''}`
          : 'Data de aprovação não disponível';

      const linhaStatus = document.createElement('span');
      linhaStatus.className = `linha-status ${classeCorStatus(documento.statusRotulo)}`;
      linhaStatus.textContent = `Etapa ${documento.etapa} • ${documento.statusRotulo}`;

      botao.appendChild(linhaPrincipal);
      botao.appendChild(linhaSecundaria);
      botao.appendChild(linhaStatus);
      botao.addEventListener('click', () => {
        campoIdentificador.value = documento.numeroPedido;
        campoPorCodigo.checked = false;
        void consultarPedido(documento.numeroPedido, false);
      });

      li.appendChild(botao);
      listaRecentes.appendChild(li);
    }

    if (resultado.limiteDePaginasAtingido) {
      const liNota = document.createElement('li');
      liNota.className = 'recentes-nota';
      liNota.textContent = `Podem existir ${ROTULOS_POR_TIPO[tipoDaRequisicao].singular}s mais antigos ainda não verificados — a busca parou no limite de páginas consultadas nesta conta.`;
      listaRecentes.appendChild(liNota);
    }
  } catch (erro) {
    mostrarErro(
      erro instanceof Error
        ? erro.message
        : `Não foi possível carregar os ${ROTULOS_POR_TIPO[tipoDaRequisicao].recentes.toLowerCase()}.`,
    );
  } finally {
    mostrarCarregando(false);
  }
}

botaoCarregarRecentes.addEventListener('click', () => {
  void carregarRecentes();
});

aplicarRotulosDaAba();

// Modo Consulta (busca individual) vs Relatórios (visão agregada) vs Usuários (admin) — três áreas independentes da página.
const relatorios = inicializarRelatorios();
const usuarios = inicializarUsuarios();
const modoConsultaBotao = el<HTMLButtonElement>('modo-consulta-botao');
const modoRelatoriosBotao = el<HTMLButtonElement>('modo-relatorios-botao');
const modoUsuariosBotao = el<HTMLButtonElement>('modo-usuarios-botao');
const modoConsultaSecao = el<HTMLElement>('modo-consulta');
const modoRelatoriosSecao = el<HTMLElement>('modo-relatorios');
const modoUsuariosSecao = el<HTMLElement>('modo-usuarios');

type Modo = 'consulta' | 'relatorios' | 'usuarios';

function ativarModo(modo: Modo): void {
  modoConsultaSecao.hidden = modo !== 'consulta';
  modoRelatoriosSecao.hidden = modo !== 'relatorios';
  modoUsuariosSecao.hidden = modo !== 'usuarios';
  modoConsultaBotao.classList.toggle('aba-modo-ativa', modo === 'consulta');
  modoConsultaBotao.setAttribute('aria-selected', String(modo === 'consulta'));
  modoRelatoriosBotao.classList.toggle('aba-modo-ativa', modo === 'relatorios');
  modoRelatoriosBotao.setAttribute('aria-selected', String(modo === 'relatorios'));
  modoUsuariosBotao.classList.toggle('aba-modo-ativa', modo === 'usuarios');
  modoUsuariosBotao.setAttribute('aria-selected', String(modo === 'usuarios'));
  if (modo === 'relatorios') relatorios.ativar();
  if (modo === 'usuarios') usuarios.ativar();
}

modoConsultaBotao.addEventListener('click', () => ativarModo('consulta'));
modoRelatoriosBotao.addEventListener('click', () => ativarModo('relatorios'));
modoUsuariosBotao.addEventListener('click', () => ativarModo('usuarios'));
