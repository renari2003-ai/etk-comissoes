/**
 * Área de Relatórios: Vendas, Orçamentos e Comissionamento — três telas
 * independentes, nunca misturadas (regra crítica de separação Pedido vs
 * Orçamento; comissionamento é calculado exclusivamente sobre Vendas).
 * Toda renderização usa textContent/criação de nós DOM, nunca innerHTML,
 * pois os dados vêm da Omie e são tratados como não confiáveis.
 */

import { formatarMoeda, formatarPercentual } from './formatacao.js';

type TipoRelatorio = 'vendas' | 'orcamentos' | 'comissionamento';

interface LinhaRelatorio {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  data?: string;
  codigoCliente: number;
  nomeCliente: string | null;
  codigoVendedor: number | null;
  nomeVendedor: string | null;
  valorBruto: number;
  receitaTotal: number;
  custoTotal: number;
  margemTotal: number;
  margemVendaPercentual: number | null;
  markupCustoPercentual: number | null;
  itensSemCusto: number;
  valorFrete: number;
  valorSeguro: number;
  outrasDespesasFrete: number;
  valorIPI: number;
  valorIcmsSt: number;
  impostosEmbutidos: {
    icms: number;
    pis: number;
    cofins: number;
    ibs: number;
    cbs: number;
  };
}

interface ParcelaComissao {
  numeroParcela: string | null;
  valorBrutoParcela: number;
  valorBaseParcela: number;
  comissaoParcela: number;
  statusTitulo: string | null;
  baixado: boolean;
  situacao: 'AGUARDANDO_TITULO' | 'PENDENTE_DE_BAIXA' | 'ELEGIVEL';
  numeroNotaFiscal?: string | null;
  /** Ex.: "154/1", "154/2" — presente só quando o pedido tem faturamento parcial (mais de uma NF). */
  numeroFaturaParcial?: string | null;
}

interface LinhaComissionamento extends LinhaRelatorio {
  despesasIPI: number;
  despesasIcmsSt: number;
  despesasFreteSeguroOutras: number;
  despesasTotal: number;
  resultadoAposDespesas: number;
  margemComissionamentoPercentual: number | null;
  impostosEmbutidos: {
    icms: number;
    pis: number;
    cofins: number;
    ibs: number;
    cbs: number;
  };
  comissaoNormalPercentual: number;
  adicionalVendedorPercentual: number;
  comissaoFinalPercentual: number;
  comissaoTotal: number;
  parcelas: ParcelaComissao[];
  comissaoLiberada: number;
  comissaoPendente: number;
  semTitulosLocalizados: boolean;
  valorFaturado: number;
  saldoAFaturar: number;
  /** Presente quando o VENDEDOR tem comissão fixa própria (ex.: Renato Pinto = 4%) — ignora margem e família por completo. */
  vendedorComissaoFixaPercentual?: number;
  /** Presente quando o pedido tem item(ns) de família com comissão fixa (ex.: CTO Promocional) misturados com outros produtos. */
  segregacaoComissaoFixa?: {
    nomeFamilia: string;
    percentualFixo: number;
    /** +1,00 quando o vendedor é especial (Sandro/Horacio/Roberto Rocha) — já somado em `comissaoValorFixa`. */
    adicionalVendedorPercentual: number;
    receitaComissaoFixa: number;
    comissaoValorFixa: number;
    receitaNormal: number;
    comissaoValorNormal: number;
  };
}

interface ResumoRelatorio {
  quantidadeDocumentos: number;
  valorBrutoTotal: number;
  valorLiquidoTotal: number;
  custoTotal: number;
  margemTotal: number;
  margemMediaPercentual: number | null;
  ticketMedio: number | null;
}

interface ResumoComissionamento {
  quantidadePedidos: number;
  valorVendaTotal: number;
  comissaoTotalCalculada: number;
  comissaoLiberada: number;
  comissaoPendente: number;
  quantidadeParcelasTotal: number;
  quantidadeParcelasBaixadas: number;
  quantidadeParcelasPendentes: number;
}

interface RespostaRelatorio {
  linhas: LinhaRelatorio[];
  resumo: ResumoRelatorio;
  documentosAmbiguosExcluidos: number;
  limiteAtingido: boolean;
}

interface RespostaComissionamento {
  linhas: LinhaComissionamento[];
  resumo: ResumoComissionamento;
  documentosAmbiguosExcluidos: number;
  pedidosSemVendedorExcluidos: number;
  numerosPedidosSemVendedor: string[];
}

interface Vendedor {
  codigo: number;
  nome: string;
  inativo: boolean;
}

const SITUACAO_COMISSAO_LEGIVEL: Record<ParcelaComissao['situacao'], string> = {
  AGUARDANDO_TITULO: 'Aguardando título financeiro',
  PENDENTE_DE_BAIXA: 'Pendente de baixa',
  ELEGIVEL: 'Baixado — comissão elegível',
};

const CAMINHO_POR_TIPO: Record<TipoRelatorio, string> = {
  vendas: '/api/relatorios/vendas',
  orcamentos: '/api/relatorios/orcamentos',
  comissionamento: '/api/relatorios/comissionamento',
};

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`Elemento #${id} não encontrado`);
  return elemento as T;
}

export function inicializarRelatorios(): { ativar: () => void } {
  const abaVendas = el<HTMLButtonElement>('aba-relatorio-vendas');
  const abaOrcamentos = el<HTMLButtonElement>('aba-relatorio-orcamentos');
  const abaComissionamento = el<HTMLButtonElement>('aba-relatorio-comissionamento');
  const formFiltros = el<HTMLFormElement>('form-filtros-relatorio');
  const campoDataDe = el<HTMLInputElement>('filtro-data-de');
  const campoDataAte = el<HTMLInputElement>('filtro-data-ate');
  const campoDataDeCalendario = el<HTMLInputElement>('filtro-data-de-calendario');
  const campoDataAteCalendario = el<HTMLInputElement>('filtro-data-ate-calendario');
  const botaoCalendarioDe = el<HTMLButtonElement>('filtro-data-de-calendario-botao');
  const botaoCalendarioAte = el<HTMLButtonElement>('filtro-data-ate-calendario-botao');
  const campoVendedor = el<HTMLSelectElement>('filtro-vendedor');
  const campoBusca = el<HTMLInputElement>('filtro-busca');
  const avisoRelatorio = el<HTMLElement>('relatorio-aviso');
  const indicadores = el<HTMLElement>('relatorio-indicadores');
  const areaTabela = el<HTMLElement>('relatorio-area-tabela');
  const cabecalhoTabela = el<HTMLTableSectionElement>('relatorio-tabela-cabecalho');
  const corpoTabela = el<HTMLTableSectionElement>('relatorio-tabela-corpo');
  const areaVazia = el<HTMLElement>('relatorio-area-vazia');
  const textoVazio = el<HTMLElement>('relatorio-texto-vazio');
  const areaErro = el<HTMLElement>('relatorio-area-erro');
  const indicadorCarregamento = el<HTMLElement>('indicador-carregamento');
  const botaoBaixarPdf = el<HTMLButtonElement>('botao-baixar-pdf-comissao');
  const modalLinhaFundo = el<HTMLElement>('relatorio-modal-linha-fundo');
  const modalLinha = el<HTMLElement>('relatorio-modal-linha');
  const modalLinhaTitulo = el<HTMLElement>('relatorio-modal-linha-titulo');
  const modalLinhaFechar = el<HTMLButtonElement>('relatorio-modal-linha-fechar');
  const modalLinhaCorpo = el<HTMLElement>('relatorio-modal-linha-corpo');

  let tipoAtivo: TipoRelatorio = 'vendas';
  let vendedoresCarregados = false;
  let ativado = false;

  function mostrarCarregando(mostrar: boolean): void {
    indicadorCarregamento.hidden = !mostrar;
  }

  function limparResultado(): void {
    avisoRelatorio.hidden = true;
    avisoRelatorio.textContent = '';
    indicadores.hidden = true;
    indicadores.textContent = '';
    areaTabela.hidden = true;
    areaErro.hidden = true;
    areaVazia.hidden = true;
    botaoBaixarPdf.hidden = true;
    fecharModalLinha();
  }

  function mostrarErro(mensagem: string): void {
    limparResultado();
    areaErro.hidden = false;
    areaErro.textContent = mensagem;
  }

  function aplicarAbaAtiva(): void {
    abaVendas.classList.toggle('aba-ativa', tipoAtivo === 'vendas');
    abaVendas.setAttribute('aria-selected', String(tipoAtivo === 'vendas'));
    abaOrcamentos.classList.toggle('aba-ativa', tipoAtivo === 'orcamentos');
    abaOrcamentos.setAttribute('aria-selected', String(tipoAtivo === 'orcamentos'));
    abaComissionamento.classList.toggle('aba-ativa', tipoAtivo === 'comissionamento');
    abaComissionamento.setAttribute('aria-selected', String(tipoAtivo === 'comissionamento'));

    textoVazio.textContent =
      tipoAtivo === 'vendas'
        ? 'Nenhuma venda encontrada para os filtros selecionados.'
        : tipoAtivo === 'orcamentos'
          ? 'Nenhum orçamento encontrado para os filtros selecionados.'
          : 'Nenhum pedido elegível a comissionamento para os filtros selecionados.';
  }

  async function carregarVendedores(): Promise<void> {
    if (vendedoresCarregados) return;
    try {
      const resposta = await fetch('/api/vendedores');
      const corpo = (await resposta.json()) as { vendedores: Vendedor[] };
      for (const vendedor of corpo.vendedores) {
        if (vendedor.inativo) continue;
        const option = document.createElement('option');
        option.value = String(vendedor.codigo);
        option.textContent = vendedor.nome;
        campoVendedor.appendChild(option);
      }
      vendedoresCarregados = true;
    } catch {
      // Filtro de vendedor fica apenas com "Todos" — não impede o uso do restante do relatório.
    }
  }

  function montarIndicador(rotulo: string, valor: string, destaque = false): HTMLElement {
    const div = document.createElement('div');
    div.className = destaque ? 'metrica metrica-destaque' : 'metrica';
    const spanRotulo = document.createElement('span');
    spanRotulo.className = 'metrica-rotulo';
    spanRotulo.textContent = rotulo;
    const spanValor = document.createElement('span');
    spanValor.className = 'metrica-valor';
    spanValor.textContent = valor;
    div.appendChild(spanRotulo);
    div.appendChild(spanValor);
    return div;
  }

  function renderizarIndicadoresRelatorio(resumo: ResumoRelatorio): void {
    indicadores.textContent = '';
    indicadores.appendChild(montarIndicador('Quantidade', String(resumo.quantidadeDocumentos)));
    indicadores.appendChild(montarIndicador('Valor líquido', formatarMoeda(resumo.valorLiquidoTotal), true));
    indicadores.appendChild(montarIndicador('Custo total', formatarMoeda(resumo.custoTotal)));
    indicadores.appendChild(montarIndicador('Margem total', formatarMoeda(resumo.margemTotal)));
    indicadores.appendChild(montarIndicador('Margem média', formatarPercentual(resumo.margemMediaPercentual)));
    indicadores.appendChild(montarIndicador('Ticket médio', formatarMoeda(resumo.ticketMedio)));
    indicadores.hidden = false;
  }

  function renderizarIndicadoresComissionamento(resumo: ResumoComissionamento): void {
    indicadores.textContent = '';
    indicadores.appendChild(montarIndicador('Pedidos', String(resumo.quantidadePedidos)));
    indicadores.appendChild(montarIndicador('Valor da venda', formatarMoeda(resumo.valorVendaTotal)));
    indicadores.appendChild(montarIndicador('Comissão calculada', formatarMoeda(resumo.comissaoTotalCalculada), true));
    indicadores.appendChild(montarIndicador('Comissão liberada', formatarMoeda(resumo.comissaoLiberada)));
    indicadores.appendChild(montarIndicador('Comissão pendente', formatarMoeda(resumo.comissaoPendente)));
    indicadores.appendChild(
      montarIndicador('Parcelas', `${resumo.quantidadeParcelasBaixadas} baixadas / ${resumo.quantidadeParcelasTotal}`),
    );
    indicadores.hidden = false;
  }

  function celula(texto: string, classe?: string): HTMLTableCellElement {
    const td = document.createElement('td');
    if (classe) td.className = classe;
    td.textContent = texto;
    return td;
  }

  function renderizarTabelaRelatorio(linhas: LinhaRelatorio[]): void {
    cabecalhoTabela.textContent = '';
    const trCabecalho = document.createElement('tr');
    for (const titulo of ['Nº', 'Cliente', 'Vendedor', 'Data', 'Valor líquido', 'Custo', 'Margem R$', 'Margem %', 'Markup %']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = titulo;
      if (titulo !== 'Nº' && titulo !== 'Cliente' && titulo !== 'Vendedor' && titulo !== 'Data') th.className = 'col-num';
      trCabecalho.appendChild(th);
    }
    cabecalhoTabela.appendChild(trCabecalho);

    corpoTabela.textContent = '';
    for (const linha of linhas) {
      const tr = document.createElement('tr');
      tr.appendChild(celula(linha.numeroPedido));
      const tdCliente = celula(linha.nomeCliente ?? 'Não localizado', 'col-nome');
      tdCliente.title = linha.nomeCliente ?? 'Não localizado';
      tr.appendChild(tdCliente);
      const tdVendedor = celula(linha.nomeVendedor ?? 'Não identificado', 'col-nome');
      tdVendedor.title = linha.nomeVendedor ?? 'Não identificado';
      tr.appendChild(tdVendedor);
      tr.appendChild(celula(linha.data ?? '—'));
      tr.appendChild(celula(formatarMoeda(linha.receitaTotal), 'col-num'));
      tr.appendChild(celula(formatarMoeda(linha.custoTotal), 'col-num'));
      tr.appendChild(celula(formatarMoeda(linha.margemTotal), 'col-num'));
      tr.appendChild(celula(formatarPercentual(linha.margemVendaPercentual), 'col-num'));
      tr.appendChild(celula(formatarPercentual(linha.markupCustoPercentual), 'col-num'));
      corpoTabela.appendChild(tr);
    }
  }

  function renderizarLinhaParcelas(linha: LinhaComissionamento): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.className = 'linha-parcelas';
    const td = document.createElement('td');
    td.colSpan = 10;

    const detalheCalculo = document.createElement('div');
    detalheCalculo.className = 'detalhe-calculo-comissao';
    const par = (rotulo: string, valor: string) => {
      const item = document.createElement('div');
      item.className = 'detalhe-item';
      const spanRotulo = document.createElement('span');
      spanRotulo.className = 'detalhe-item-rotulo';
      spanRotulo.textContent = rotulo;
      const spanValor = document.createElement('span');
      spanValor.className = 'detalhe-item-valor';
      spanValor.textContent = valor;
      item.appendChild(spanRotulo);
      item.appendChild(spanValor);
      detalheCalculo.appendChild(item);
    };
    if (linha.vendedorComissaoFixaPercentual !== undefined) {
      const aviso = document.createElement('p');
      aviso.className = 'impostos-embutidos-titulo';
      aviso.textContent = `Vendedor com comissão fixa: ${linha.vendedorComissaoFixaPercentual}% sobre todo o pedido — ignora margem de comissionamento e família de produto.`;
      td.appendChild(aviso);
    }

    par('Valor da venda (nota)', formatarMoeda(linha.valorBruto));
    par('Valor dos produtos', formatarMoeda(linha.receitaTotal));
    if (linha.vendedorComissaoFixaPercentual === undefined) {
      par('Despesas — IPI', formatarMoeda(linha.despesasIPI));
      par('Despesas — ICMS-ST', formatarMoeda(linha.despesasIcmsSt));
      par('Despesas — frete/seguro/outras', formatarMoeda(linha.despesasFreteSeguroOutras));
      par('Resultado após despesas', formatarMoeda(linha.resultadoAposDespesas));
      par(
        linha.segregacaoComissaoFixa ? 'Margem de comissionamento (parte normal)' : 'Margem de comissionamento',
        formatarPercentual(linha.margemComissionamentoPercentual),
      );
    }
    par(linha.segregacaoComissaoFixa ? 'Comissão normal (parte normal)' : 'Comissão normal', formatarPercentual(linha.comissaoNormalPercentual));
    par('Adicional do vendedor', formatarPercentual(linha.adicionalVendedorPercentual));
    par('Comissão final', formatarPercentual(linha.comissaoFinalPercentual));
    par('Base da comissão (valor dos produtos)', formatarMoeda(linha.receitaTotal));
    par('Valor da comissão', formatarMoeda(linha.comissaoTotal));
    td.appendChild(detalheCalculo);

    // Saldo do pedido ainda não faturado — só exibido quando há título(s) localizado(s) (sem
    // isso não dá pra saber se o saldo é real ou apenas falha de vínculo título↔pedido) e o
    // saldo é positivo além da tolerância de arredondamento (regra de 2026-09-10).
    if (!linha.semTitulosLocalizados && linha.saldoAFaturar > 0.005) {
      const saldo = document.createElement('p');
      saldo.className = 'saldo-a-faturar';
      saldo.textContent = `Saldo a faturar: ${formatarMoeda(linha.saldoAFaturar)} (faturado ${formatarMoeda(linha.valorFaturado)} de ${formatarMoeda(linha.valorBruto)})`;
      td.appendChild(saldo);
    }

    if (linha.segregacaoComissaoFixa) {
      const segTitulo = document.createElement('p');
      segTitulo.className = 'impostos-embutidos-titulo';
      const percentualFixoTotal = linha.segregacaoComissaoFixa.percentualFixo + linha.segregacaoComissaoFixa.adicionalVendedorPercentual;
      segTitulo.textContent =
        linha.segregacaoComissaoFixa.adicionalVendedorPercentual > 0
          ? `Pedido misto: itens da família "${linha.segregacaoComissaoFixa.nomeFamilia}" foram segregados e recebem comissão fixa de ${linha.segregacaoComissaoFixa.percentualFixo}% + ${linha.segregacaoComissaoFixa.adicionalVendedorPercentual}% de adicional do vendedor = ${percentualFixoTotal}% — o restante do pedido segue a regra normal por margem.`
          : `Pedido misto: itens da família "${linha.segregacaoComissaoFixa.nomeFamilia}" foram segregados e recebem comissão fixa de ${linha.segregacaoComissaoFixa.percentualFixo}% — o restante do pedido segue a regra normal por margem.`;
      td.appendChild(segTitulo);

      const detalheSeg = document.createElement('div');
      detalheSeg.className = 'detalhe-calculo-comissao detalhe-impostos-embutidos';
      const parSeg = (rotulo: string, valor: string) => {
        const item = document.createElement('div');
        item.className = 'detalhe-item';
        const spanRotulo = document.createElement('span');
        spanRotulo.className = 'detalhe-item-rotulo';
        spanRotulo.textContent = rotulo;
        const spanValor = document.createElement('span');
        spanValor.className = 'detalhe-item-valor';
        spanValor.textContent = valor;
        item.appendChild(spanRotulo);
        item.appendChild(spanValor);
        detalheSeg.appendChild(item);
      };
      parSeg('Receita — parte normal', formatarMoeda(linha.segregacaoComissaoFixa.receitaNormal));
      parSeg('Comissão — parte normal', formatarMoeda(linha.segregacaoComissaoFixa.comissaoValorNormal));
      parSeg(`Receita — ${linha.segregacaoComissaoFixa.nomeFamilia}`, formatarMoeda(linha.segregacaoComissaoFixa.receitaComissaoFixa));
      parSeg(
        `Comissão — ${linha.segregacaoComissaoFixa.nomeFamilia} (${linha.segregacaoComissaoFixa.percentualFixo}% fixo${linha.segregacaoComissaoFixa.adicionalVendedorPercentual > 0 ? ` + ${linha.segregacaoComissaoFixa.adicionalVendedorPercentual}% adicional` : ''})`,
        formatarMoeda(linha.segregacaoComissaoFixa.comissaoValorFixa),
      );
      td.appendChild(detalheSeg);
    }

    const impostosEmbutidosTitulo = document.createElement('p');
    impostosEmbutidosTitulo.className = 'impostos-embutidos-titulo';
    impostosEmbutidosTitulo.textContent = 'Impostos já embutidos no valor dos produtos (informativo — não somam à nota)';
    td.appendChild(impostosEmbutidosTitulo);

    const impostosEmbutidos = document.createElement('div');
    impostosEmbutidos.className = 'detalhe-calculo-comissao detalhe-impostos-embutidos';
    const parImposto = (rotulo: string, valor: string) => {
      const item = document.createElement('div');
      item.className = 'detalhe-item';
      const spanRotulo = document.createElement('span');
      spanRotulo.className = 'detalhe-item-rotulo';
      spanRotulo.textContent = rotulo;
      const spanValor = document.createElement('span');
      spanValor.className = 'detalhe-item-valor';
      spanValor.textContent = valor;
      item.appendChild(spanRotulo);
      item.appendChild(spanValor);
      impostosEmbutidos.appendChild(item);
    };
    parImposto('ICMS', formatarMoeda(linha.impostosEmbutidos.icms));
    parImposto('PIS', formatarMoeda(linha.impostosEmbutidos.pis));
    parImposto('COFINS', formatarMoeda(linha.impostosEmbutidos.cofins));
    parImposto('IBS', formatarMoeda(linha.impostosEmbutidos.ibs));
    parImposto('CBS', formatarMoeda(linha.impostosEmbutidos.cbs));

    const botaoExpandir = document.createElement('button');
    botaoExpandir.type = 'button';
    botaoExpandir.className = 'botao-secundario botao-expandir-relatorio';
    botaoExpandir.textContent = 'Expandir tela';
    botaoExpandir.addEventListener('click', (evento) => {
      evento.stopPropagation(); // não deve alternar (recolher) a linha de parcelas ao clicar
      alternarModalLinha(td, linha.numeroPedido);
    });
    impostosEmbutidos.appendChild(botaoExpandir);

    td.appendChild(impostosEmbutidos);

    if (linha.semTitulosLocalizados) {
      const aviso = document.createElement('p');
      aviso.className = 'parcelas-vazio';
      aviso.textContent = 'Nenhum título financeiro localizado na Omie para este pedido — acompanhamento de baixa indisponível.';
      td.appendChild(aviso);
      tr.appendChild(td);
      return tr;
    }

    const tabelaParcelas = document.createElement('table');
    tabelaParcelas.className = 'tabela-parcelas';
    const thead = document.createElement('thead');
    const temFaturamentoParcial = linha.parcelas.some((p) => p.numeroFaturaParcial);
    const trh = document.createElement('tr');
    const colunas = temFaturamentoParcial
      ? ['Fatura', 'Parcela', 'Valor', 'Situação financeira', 'Comissão', 'Situação da comissão']
      : ['Parcela', 'Valor', 'Situação financeira', 'Comissão', 'Situação da comissão'];
    for (const titulo of colunas) {
      const th = document.createElement('th');
      th.textContent = titulo;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    tabelaParcelas.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const parcela of linha.parcelas) {
      const trp = document.createElement('tr');
      if (temFaturamentoParcial) {
        trp.appendChild(celula(parcela.numeroFaturaParcial ?? linha.numeroPedido, 'col-fatura-parcial'));
      }
      trp.appendChild(celula(parcela.numeroParcela ?? '—'));
      trp.appendChild(celula(formatarMoeda(parcela.valorBrutoParcela)));
      trp.appendChild(celula(parcela.statusTitulo ?? 'Não localizado'));
      trp.appendChild(celula(formatarMoeda(parcela.comissaoParcela)));
      const tdSituacao = celula(SITUACAO_COMISSAO_LEGIVEL[parcela.situacao]);
      tdSituacao.classList.add(parcela.baixado ? 'situacao-elegivel' : 'situacao-pendente');
      trp.appendChild(tdSituacao);
      tbody.appendChild(trp);
    }
    tabelaParcelas.appendChild(tbody);
    td.appendChild(tabelaParcelas);
    tr.appendChild(td);
    return tr;
  }

  function renderizarTabelaComissionamento(linhas: LinhaComissionamento[]): void {
    cabecalhoTabela.textContent = '';
    const trCabecalho = document.createElement('tr');
    for (const titulo of [
      'Nº',
      'Cliente',
      'Vendedor',
      'Margem',
      'Comissão %',
      'Valor da venda',
      'Comissão total',
      'Liberada',
      'Pendente',
      'Parcelas',
    ]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = titulo;
      if (!['Nº', 'Cliente', 'Vendedor'].includes(titulo)) th.className = 'col-num';
      trCabecalho.appendChild(th);
    }
    cabecalhoTabela.appendChild(trCabecalho);

    corpoTabela.textContent = '';
    for (const linha of linhas) {
      const tr = document.createElement('tr');
      tr.className = 'linha-comissionamento-clicavel';
      const notasFiscaisDistintas = new Set(linha.parcelas.map((p) => p.numeroFaturaParcial).filter(Boolean)).size;
      const tdNumero = celula(linha.numeroPedido);
      if (notasFiscaisDistintas > 1) {
        const badge = document.createElement('span');
        badge.className = 'badge-faturamento-parcial';
        badge.textContent = `${notasFiscaisDistintas} faturas`;
        badge.title = 'Pedido faturado em mais de uma nota fiscal — veja o detalhamento por fatura ao expandir a linha.';
        tdNumero.appendChild(badge);
      }
      tr.appendChild(tdNumero);
      const tdCliente = celula(linha.nomeCliente ?? 'Não localizado', 'col-nome');
      tdCliente.title = linha.nomeCliente ?? 'Não localizado';
      tr.appendChild(tdCliente);
      const tdVendedor = celula(linha.nomeVendedor ?? 'Não identificado', 'col-nome');
      tdVendedor.title = linha.nomeVendedor ?? 'Não identificado';
      tr.appendChild(tdVendedor);
      tr.appendChild(celula(formatarPercentual(linha.margemComissionamentoPercentual), 'col-num'));
      // Em pedidos mistos (comissão fixa numa família + regra normal no resto), mostra a taxa EFETIVA
      // (comissão total ÷ receita) na coluna — comissaoFinalPercentual sozinho só reflete a parte normal.
      const percentualExibido = linha.segregacaoComissaoFixa
        ? linha.receitaTotal === 0
          ? linha.comissaoFinalPercentual
          : Math.round((linha.comissaoTotal / linha.receitaTotal) * 10000) / 100
        : linha.comissaoFinalPercentual;
      const tdFaixa = celula(`${percentualExibido}%`, 'col-num');
      if (linha.vendedorComissaoFixaPercentual !== undefined) {
        tdFaixa.title = `Comissão fixa do vendedor: ${linha.vendedorComissaoFixaPercentual}% (ignora margem e família de produto)`;
      } else if (linha.segregacaoComissaoFixa) {
        tdFaixa.title = `Pedido misto: ${linha.comissaoNormalPercentual}% na parte normal (+ ${linha.adicionalVendedorPercentual}% adicional) e ${linha.segregacaoComissaoFixa.percentualFixo}% fixo em "${linha.segregacaoComissaoFixa.nomeFamilia}" — % exibido é a média ponderada.`;
      } else {
        tdFaixa.title =
          linha.adicionalVendedorPercentual > 0
            ? `Comissão normal ${linha.comissaoNormalPercentual}% + adicional do vendedor ${linha.adicionalVendedorPercentual}%`
            : `Comissão normal ${linha.comissaoNormalPercentual}% (sem adicional)`;
      }
      tr.appendChild(tdFaixa);
      tr.appendChild(celula(formatarMoeda(linha.valorBruto), 'col-num'));
      tr.appendChild(celula(formatarMoeda(linha.comissaoTotal), 'col-num'));
      tr.appendChild(celula(formatarMoeda(linha.comissaoLiberada), 'col-num valor-positivo'));
      tr.appendChild(celula(formatarMoeda(linha.comissaoPendente), 'col-num'));
      tr.appendChild(
        celula(
          linha.semTitulosLocalizados ? 'Sem título' : `${linha.parcelas.filter((p) => p.baixado).length}/${linha.parcelas.length}`,
          'col-num',
        ),
      );
      corpoTabela.appendChild(tr);

      const linhaDetalhe = renderizarLinhaParcelas(linha);
      linhaDetalhe.hidden = true;
      corpoTabela.appendChild(linhaDetalhe);

      tr.addEventListener('click', () => {
        linhaDetalhe.hidden = !linhaDetalhe.hidden;
      });
    }
  }

  async function carregarRelatorio(): Promise<void> {
    limparResultado();
    mostrarCarregando(true);
    try {
      const parametros = new URLSearchParams();
      if (campoDataDe.value.trim() !== '') parametros.set('data_de', campoDataDe.value.trim());
      if (campoDataAte.value.trim() !== '') parametros.set('data_ate', campoDataAte.value.trim());
      if (campoVendedor.value !== '') parametros.set('vendedor', campoVendedor.value);
      if (campoBusca.value.trim() !== '') parametros.set('busca', campoBusca.value.trim());

      const resposta = await fetch(`${CAMINHO_POR_TIPO[tipoAtivo]}?${parametros.toString()}`);
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        const corpoErro = corpo && typeof corpo === 'object' ? (corpo as { erro?: unknown; motivo?: unknown }) : null;
        const erroBase = typeof corpoErro?.erro === 'string' ? corpoErro.erro : 'Não foi possível consultar a Omie neste momento.';
        const motivo = typeof corpoErro?.motivo === 'string' ? corpoErro.motivo : null;
        throw new Error(motivo ? `${erroBase} ${motivo}` : erroBase);
      }

      const avisos: string[] = [];
      if (tipoAtivo === 'comissionamento') {
        const dados = corpo as RespostaComissionamento;
        if (dados.pedidosSemVendedorExcluidos > 0) {
          const numeros = dados.numerosPedidosSemVendedor.map((n) => `nº ${n}`).join(', ');
          avisos.push(
            `${dados.pedidosSemVendedorExcluidos} pedido(s) sem vendedor identificado foram excluídos do comissionamento: ${numeros}.`,
          );
        }
        if (dados.documentosAmbiguosExcluidos > 0) {
          avisos.push(`${dados.documentosAmbiguosExcluidos} documento(s) com etapa não reconhecida foram excluídos.`);
        }
        if (avisos.length > 0) {
          avisoRelatorio.textContent = avisos.join(' ');
          avisoRelatorio.hidden = false;
        }

        if (dados.linhas.length === 0) {
          areaVazia.hidden = false;
          return;
        }
        renderizarIndicadoresComissionamento(dados.resumo);
        renderizarTabelaComissionamento(dados.linhas);
        areaTabela.hidden = false;
        botaoBaixarPdf.hidden = false;
      } else {
        const dados = corpo as RespostaRelatorio;
        if (dados.documentosAmbiguosExcluidos > 0) {
          avisos.push(`${dados.documentosAmbiguosExcluidos} documento(s) com etapa não reconhecida foram excluídos.`);
        }
        if (dados.limiteAtingido) {
          avisos.push('O período filtrado tem mais registros do que o relatório processa de uma vez — refine o período para ver o total exato.');
        }
        if (avisos.length > 0) {
          avisoRelatorio.textContent = avisos.join(' ');
          avisoRelatorio.hidden = false;
        }

        if (dados.linhas.length === 0) {
          areaVazia.hidden = false;
          return;
        }
        renderizarIndicadoresRelatorio(dados.resumo);
        renderizarTabelaRelatorio(dados.linhas);
        areaTabela.hidden = false;
      }
    } catch (erro) {
      mostrarErro(erro instanceof Error ? erro.message : 'Erro desconhecido.');
    } finally {
      mostrarCarregando(false);
    }
  }

  function trocarAbaRelatorio(tipo: TipoRelatorio): void {
    if (tipo === tipoAtivo) return;
    tipoAtivo = tipo;
    aplicarAbaAtiva();
    void carregarRelatorio();
  }

  abaVendas.addEventListener('click', () => trocarAbaRelatorio('vendas'));
  abaOrcamentos.addEventListener('click', () => trocarAbaRelatorio('orcamentos'));
  abaComissionamento.addEventListener('click', () => trocarAbaRelatorio('comissionamento'));
  botaoBaixarPdf.addEventListener('click', () => window.print());

  /**
   * Máscara automática dd/mm/aaaa: o usuário digita só números, sem precisar
   * da barra (ex.: "01012026" vira "01/01/2026" enquanto digita). Se parar
   * com o ano em 2 dígitos (ex.: "010126" -> "01/01/26"), completa para
   * "01/01/2026" ao sair do campo — sistema opera só com datas recentes,
   * então o século 2000 é assumido.
   */
  function aplicarMascaraData(campo: HTMLInputElement): void {
    campo.addEventListener('input', () => {
      const digitos = campo.value.replace(/\D/g, '').slice(0, 8);
      if (digitos.length > 4) {
        campo.value = `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
      } else if (digitos.length > 2) {
        campo.value = `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
      } else {
        campo.value = digitos;
      }
    });

    campo.addEventListener('blur', () => {
      const partes = campo.value.split('/');
      if (partes.length === 3 && partes[2]?.length === 2) {
        campo.value = `${partes[0]}/${partes[1]}/20${partes[2]}`;
      }
    });
  }

  aplicarMascaraData(campoDataDe);
  aplicarMascaraData(campoDataAte);

  /** Conecta o botão de calendário a um `<input type="date">` oculto — abre o seletor visual do navegador e escreve o resultado formatado de volta no campo de texto. */
  function conectarCalendario(campoTexto: HTMLInputElement, campoCalendario: HTMLInputElement, botao: HTMLButtonElement): void {
    botao.addEventListener('click', () => {
      const comShowPicker = campoCalendario as HTMLInputElement & { showPicker?: () => void };
      if (typeof comShowPicker.showPicker === 'function') {
        comShowPicker.showPicker();
      } else {
        campoCalendario.click();
      }
    });
    campoCalendario.addEventListener('change', () => {
      if (campoCalendario.value === '') return;
      const [ano, mes, dia] = campoCalendario.value.split('-');
      campoTexto.value = `${dia}/${mes}/${ano}`;
    });
  }

  conectarCalendario(campoDataDe, campoDataDeCalendario, botaoCalendarioDe);
  conectarCalendario(campoDataAte, campoDataAteCalendario, botaoCalendarioAte);

  // Expande em tela cheia apenas a LINHA selecionada (não a tabela inteira): move o conteúdo do
  // <td> de detalhe daquele pedido para dentro do modal e devolve ao fechar — nunca clona/recria
  // os nós (preserva os dados, sem re-parsear texto não confiável vindo da Omie).
  let tdOrigemModalExpandido: HTMLTableCellElement | null = null;

  function fecharModalLinha(): void {
    if (tdOrigemModalExpandido !== null) {
      while (modalLinhaCorpo.firstChild) tdOrigemModalExpandido.appendChild(modalLinhaCorpo.firstChild);
      tdOrigemModalExpandido = null;
    }
    modalLinha.hidden = true;
    modalLinhaFundo.hidden = true;
    document.body.classList.remove('corpo-tabela-expandida');
  }

  function alternarModalLinha(td: HTMLTableCellElement, numeroPedido: string): void {
    if (tdOrigemModalExpandido === td) {
      fecharModalLinha();
      return;
    }
    if (tdOrigemModalExpandido !== null) fecharModalLinha();
    while (td.firstChild) modalLinhaCorpo.appendChild(td.firstChild);
    tdOrigemModalExpandido = td;
    modalLinhaTitulo.textContent = `Pedido nº ${numeroPedido}`;
    modalLinha.hidden = false;
    modalLinhaFundo.hidden = false;
    document.body.classList.add('corpo-tabela-expandida');
  }

  modalLinhaFundo.addEventListener('click', fecharModalLinha);
  modalLinhaFechar.addEventListener('click', fecharModalLinha);

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !modalLinha.hidden) {
      fecharModalLinha();
    }
  });

  formFiltros.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void carregarRelatorio();
  });

  aplicarAbaAtiva();

  return {
    ativar(): void {
      if (ativado) return;
      ativado = true;
      void carregarVendedores();
      void carregarRelatorio();
    },
  };
}
