/**
 * Área de Relatórios: Vendas, Orçamentos, Comissionamento e Financeiro / Comissão — telas
 * independentes, nunca misturadas (regra crítica de separação Pedido vs
 * Orçamento; comissionamento é calculado exclusivamente sobre Vendas).
 * Toda renderização usa textContent/criação de nós DOM, nunca innerHTML,
 * pois os dados vêm da Omie e são tratados como não confiáveis.
 */
import { formatarMoeda, formatarPercentual } from './formatacao.js';
/** Aviso único com pedido, produto, tabela e motivo — os pedidos listados não entram nos totais. */
export function descreverExcecoesApuracao(excecoes) {
    const itens = excecoes.map((e) => {
        const problemas = e.problemas.map((p) => `${p.codigo || p.codigoProduto} (tabela ${p.tabela ?? 'não identificada'}): ${p.detalhe}`);
        return `pedido nº ${e.numeroPedido} (vendedor ${e.nomeVendedor ?? 'não identificado'}) — ${problemas.join('; ')}`;
    });
    return `${excecoes.length} pedido(s) fora da apuração automática de comissão, sem valor calculado: ${itens.join(' | ')}.`;
}
/** Uma linha de aviso por exceção, com o necessário para conferir na Omie (tela e PDF). */
export function descreverExcecoesRevisaoManual(excecoes) {
    const moeda = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const itens = excecoes.map((e) => {
        const titulos = e.titulos.length === 0
            ? 'nenhum verificado'
            : e.titulos.map((t) => `${t.numeroParcela ?? 's/ parcela'} ${t.statusTitulo} ${moeda(t.valor)}`).join('; ');
        return `pedido nº ${e.numeroPedido} (registro ${e.codigoPedido}, etapa ${e.etapa}, vendedor ${e.nomeVendedor ?? 'não identificado'}, valor ${moeda(e.valor)}; títulos: ${titulos}) — ${e.motivo}`;
    });
    return `${excecoes.length} registro(s) fora do cálculo para revisão manual: ${itens.join(' | ')}.`;
}
const SITUACAO_COMISSAO_LEGIVEL = {
    AGUARDANDO_TITULO: 'Aguardando título financeiro',
    PENDENTE_DE_BAIXA: 'Pendente de baixa',
    ELEGIVEL: 'Baixado — comissão elegível',
};
const CAMINHO_POR_TIPO = {
    vendas: '/api/relatorios/vendas',
    orcamentos: '/api/relatorios/orcamentos',
    comissionamento: '/api/relatorios/comissionamento',
    'financeiro-comissao': '/api/relatorios/financeiro-comissao',
};
function el(id) {
    const elemento = document.getElementById(id);
    if (elemento === null)
        throw new Error(`Elemento #${id} não encontrado`);
    return elemento;
}
/**
 * Colunas da tabela de Comissionamento. Sem "Venda após despesas (%)" (o antigo indicador "margem
 * de comissionamento", só informativo desde 2026-10-06) para quem não é administrador — a coluna
 * some de verdade (tela e PDF, que é a impressão desta mesma tabela), em vez de ficar vazia.
 */
/** Mesmo indicador de `margemComissionamentoPercentual` (venda − despesas) ÷ venda — não define a comissão. */
export const ROTULO_COLUNA_VENDA_APOS_DESPESAS = 'Venda após despesas (%)';
export function titulosTabelaComissionamento(margemVisivel) {
    return [
        'Nº',
        'Cliente',
        'Vendedor',
        'Data de faturamento',
        ...(margemVisivel ? [ROTULO_COLUNA_VENDA_APOS_DESPESAS] : []),
        'Comissão %',
        'Valor da venda',
        'Comissão total',
        'Liberada',
        'Pendente',
        'Parcelas',
    ];
}
/**
 * Célula "Data de faturamento": emissão da(s) fatura(s) do pedido, nunca a data do pedido. Sem
 * título → "—". Várias faturas (faturamento parcial) → a primeira + "(+N)", todas no `title`,
 * sem duplicar a linha do pedido.
 */
export function formatarDatasFaturamento(datas) {
    const lista = datas ?? [];
    if (lista.length === 0)
        return { texto: '—', titulo: 'Sem faturamento localizado na Omie' };
    if (lista.length === 1)
        return { texto: lista[0], titulo: `Faturado em ${lista[0]}` };
    return { texto: `${lista[0]} (+${lista.length - 1})`, titulo: `Faturas emitidas em: ${lista.join(', ')}` };
}
/**
 * Popula o filtro de vendedor. Papel "vendedor" (o servidor devolve `restritoAoProprioVendedor`
 * e só o próprio vendedor na lista): sem "Todos os vendedores", só o próprio nome, campo travado.
 * Apresentação apenas — o backend força o vendedor autenticado de qualquer forma.
 */
export function preencherFiltroVendedor(campo, vendedores, restritoAoProprioVendedor) {
    if (restritoAoProprioVendedor) {
        // Todos os itens têm o mesmo nome (vínculo por nome, ver `/api/vendedores`) — mostra uma vez só.
        campo.textContent = '';
        const proprio = vendedores[0];
        if (proprio !== undefined) {
            const option = document.createElement('option');
            option.value = String(proprio.codigo);
            option.textContent = proprio.nome;
            campo.appendChild(option);
        }
        campo.disabled = true;
        return;
    }
    for (const vendedor of vendedores) {
        if (vendedor.inativo)
            continue;
        const option = document.createElement('option');
        option.value = String(vendedor.codigo);
        option.textContent = vendedor.nome;
        campo.appendChild(option);
    }
}
export function inicializarRelatorios() {
    const abaVendas = el('aba-relatorio-vendas');
    const abaOrcamentos = el('aba-relatorio-orcamentos');
    const abaComissionamento = el('aba-relatorio-comissionamento');
    const abaFinanceiro = el('aba-relatorio-financeiro-comissao');
    const formFiltros = el('form-filtros-relatorio');
    const campoDataDe = el('filtro-data-de');
    const campoDataAte = el('filtro-data-ate');
    const campoDataDeCalendario = el('filtro-data-de-calendario');
    const campoDataAteCalendario = el('filtro-data-ate-calendario');
    const botaoCalendarioDe = el('filtro-data-de-calendario-botao');
    const botaoCalendarioAte = el('filtro-data-ate-calendario-botao');
    const campoVendedor = el('filtro-vendedor');
    const campoBusca = el('filtro-busca');
    const legendaPeriodo = el('filtro-data-legenda');
    const legendaOriginal = Array.from(legendaPeriodo.childNodes).map(n => n.cloneNode(true));
    const avisoRelatorio = el('relatorio-aviso');
    const indicadores = el('relatorio-indicadores');
    const areaTabela = el('relatorio-area-tabela');
    const cabecalhoTabela = el('relatorio-tabela-cabecalho');
    const corpoTabela = el('relatorio-tabela-corpo');
    const areaVazia = el('relatorio-area-vazia');
    const textoVazio = el('relatorio-texto-vazio');
    const areaErro = el('relatorio-area-erro');
    // Indicador próprio dos Relatórios (logo ETK 3D com luz), no mesmo local do "Carregando…" da Consulta.
    const indicadorCarregamento = el('relatorio-carregamento');
    const botaoBaixarPdf = el('botao-baixar-pdf-comissao');
    const botaoBaixarExcel = el('botao-baixar-excel-comissao');
    const modalLinhaFundo = el('relatorio-modal-linha-fundo');
    const modalLinha = el('relatorio-modal-linha');
    const modalLinhaTitulo = el('relatorio-modal-linha-titulo');
    const modalLinhaFechar = el('relatorio-modal-linha-fechar');
    const modalLinhaCorpo = el('relatorio-modal-linha-corpo');
    let tipoAtivo = 'vendas';
    let vendedoresCarregados = false;
    let ativado = false;
    let requisicaoAtual = 0;
    let parametrosExcel = null;
    function mostrarCarregando(mostrar) {
        indicadorCarregamento.hidden = !mostrar;
    }
    function limparResultado() {
        avisoRelatorio.hidden = true;
        avisoRelatorio.textContent = '';
        indicadores.hidden = true;
        indicadores.textContent = '';
        areaTabela.hidden = true;
        areaErro.hidden = true;
        areaVazia.hidden = true;
        botaoBaixarPdf.hidden = true;
        botaoBaixarExcel.hidden = true;
        parametrosExcel = null;
        fecharModalLinha();
    }
    function mostrarErro(mensagem) {
        limparResultado();
        areaErro.hidden = false;
        areaErro.textContent = mensagem;
    }
    function aplicarAbaAtiva() {
        abaVendas.classList.toggle('aba-ativa', tipoAtivo === 'vendas');
        abaVendas.setAttribute('aria-selected', String(tipoAtivo === 'vendas'));
        abaOrcamentos.classList.toggle('aba-ativa', tipoAtivo === 'orcamentos');
        abaOrcamentos.setAttribute('aria-selected', String(tipoAtivo === 'orcamentos'));
        abaComissionamento.classList.toggle('aba-ativa', tipoAtivo === 'comissionamento');
        abaComissionamento.setAttribute('aria-selected', String(tipoAtivo === 'comissionamento'));
        abaFinanceiro.classList.toggle('aba-ativa', tipoAtivo === 'financeiro-comissao');
        abaFinanceiro.setAttribute('aria-selected', String(tipoAtivo === 'financeiro-comissao'));
        if (tipoAtivo === 'financeiro-comissao') {
            legendaPeriodo.textContent = 'Selecione o período de baixa/recebimento da empresa. Vendas anteriores também são consideradas quando recebidas nesse intervalo.';
            campoBusca.placeholder = 'Nº, nota fiscal, cliente ou vendedor…';
        }
        else {
            legendaPeriodo.replaceChildren(...legendaOriginal.map(n => n.cloneNode(true)));
            campoBusca.placeholder = 'Nº, cliente ou vendedor…';
        }
        textoVazio.textContent =
            tipoAtivo === 'vendas'
                ? 'Nenhuma venda encontrada para os filtros selecionados.'
                : tipoAtivo === 'orcamentos'
                    ? 'Nenhum orçamento encontrado para os filtros selecionados.'
                    : tipoAtivo === 'financeiro-comissao'
                        ? 'Nenhum recebimento com comissão a pagar no período selecionado.'
                        : 'Nenhum pedido elegível a comissionamento para os filtros selecionados.';
    }
    async function carregarVendedores() {
        if (vendedoresCarregados)
            return;
        try {
            const resposta = await fetch('/api/vendedores');
            const corpo = (await resposta.json());
            preencherFiltroVendedor(campoVendedor, corpo.vendedores, corpo.restritoAoProprioVendedor === true);
            vendedoresCarregados = true;
        }
        catch {
            // Filtro de vendedor fica apenas com "Todos" — não impede o uso do restante do relatório.
        }
    }
    function montarIndicador(rotulo, valor, destaque = false) {
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
    function renderizarIndicadoresRelatorio(resumo) {
        indicadores.textContent = '';
        indicadores.appendChild(montarIndicador('Quantidade', String(resumo.quantidadeDocumentos)));
        indicadores.appendChild(montarIndicador('Valor líquido', formatarMoeda(resumo.valorLiquidoTotal), true));
        indicadores.appendChild(montarIndicador('Custo total', formatarMoeda(resumo.custoTotal)));
        indicadores.appendChild(montarIndicador('Margem total', formatarMoeda(resumo.margemTotal)));
        indicadores.appendChild(montarIndicador('Margem média', formatarPercentual(resumo.margemMediaPercentual)));
        indicadores.appendChild(montarIndicador('Ticket médio', formatarMoeda(resumo.ticketMedio)));
        indicadores.hidden = false;
    }
    function renderizarIndicadoresComissionamento(resumo) {
        indicadores.textContent = '';
        indicadores.appendChild(montarIndicador('Pedidos', String(resumo.quantidadePedidos)));
        indicadores.appendChild(montarIndicador('Valor da venda', formatarMoeda(resumo.valorVendaTotal)));
        indicadores.appendChild(montarIndicador('Comissão calculada', formatarMoeda(resumo.comissaoTotalCalculada), true));
        indicadores.appendChild(montarIndicador('Comissão liberada', formatarMoeda(resumo.comissaoLiberada)));
        indicadores.appendChild(montarIndicador('Comissão pendente', formatarMoeda(resumo.comissaoPendente)));
        indicadores.appendChild(montarIndicador('Parcelas', `${resumo.quantidadeParcelasBaixadas} baixadas / ${resumo.quantidadeParcelasTotal}`));
        indicadores.hidden = false;
    }
    function celula(texto, classe) {
        const td = document.createElement('td');
        if (classe)
            td.className = classe;
        td.textContent = texto;
        return td;
    }
    function renderizarTabelaRelatorio(linhas) {
        cabecalhoTabela.textContent = '';
        const trCabecalho = document.createElement('tr');
        for (const titulo of ['Nº', 'Cliente', 'Vendedor', 'Data', 'Valor líquido', 'Custo', 'Margem R$', 'Margem %', 'Markup %']) {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = titulo;
            if (titulo !== 'Nº' && titulo !== 'Cliente' && titulo !== 'Vendedor' && titulo !== 'Data')
                th.className = 'col-num';
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
    function renderizarLinhaParcelas(linha, margemVisivel, totalColunas) {
        const tr = document.createElement('tr');
        tr.className = 'linha-parcelas';
        const td = document.createElement('td');
        td.colSpan = totalColunas;
        const detalheCalculo = document.createElement('div');
        detalheCalculo.className = 'detalhe-calculo-comissao';
        const par = (rotulo, valor) => {
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
            aviso.textContent = `Vendedor com comissão fixa: ${linha.vendedorComissaoFixaPercentual}% sobre todo o pedido — ignora a tabela de preços.`;
            td.appendChild(aviso);
        }
        par('Valor da venda (nota)', formatarMoeda(linha.valorBruto));
        par('Valor dos produtos', formatarMoeda(linha.receitaTotal));
        // Despesas/resultado/margem só para administrador (o servidor nem envia esses campos aos demais
        // papéis). Desde 2026-10-06 a margem é apenas informativa — a comissão vem da tabela de preços.
        if (margemVisivel && linha.vendedorComissaoFixaPercentual === undefined) {
            par('Despesas — IPI', formatarMoeda(linha.despesasIPI ?? 0));
            par('Despesas — ICMS-ST', formatarMoeda(linha.despesasIcmsSt ?? 0));
            par('Despesas — frete/seguro/outras', formatarMoeda(linha.despesasFreteSeguroOutras ?? 0));
            par('Resultado após despesas', formatarMoeda(linha.resultadoAposDespesas ?? 0));
            par('Percentual da venda após despesas — informativo', formatarPercentual(linha.margemComissionamentoPercentual ?? null));
        }
        const itensComTaxasDiferentes = new Set((linha.composicaoItens ?? []).map((i) => i.comissaoFinalPercentual)).size > 1;
        par(itensComTaxasDiferentes ? 'Comissão normal (média ponderada dos itens)' : 'Comissão normal', formatarPercentual(linha.comissaoNormalPercentual));
        par('Adicional do vendedor', formatarPercentual(linha.adicionalVendedorPercentual));
        par(itensComTaxasDiferentes ? 'Comissão final (efetiva do pedido)' : 'Comissão final', formatarPercentual(linha.comissaoFinalPercentual));
        par(linha.vendedorComissaoFixaPercentual !== undefined ? 'Base da comissão (valor dos produtos)' : 'Base da comissão (produtos após desconto)', formatarMoeda(linha.baseComissao));
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
        // Composição por item (tabela de preços) — só administrador; o servidor nem envia aos demais.
        if (margemVisivel && linha.composicaoItens !== undefined && linha.composicaoItens.length > 0) {
            const tituloItens = document.createElement('p');
            tituloItens.className = 'impostos-embutidos-titulo';
            const consultas = [...new Set(linha.composicaoItens.map((i) => i.precoConsultadoEm).filter((d) => d !== null))];
            const momento = consultas.length > 0 ? consultas.map((d) => new Date(d).toLocaleString('pt-BR')).join(', ') : 'não informado';
            tituloItens.textContent =
                `Comissão por item — referência: PREÇO ATUAL da tabela ativa (consultado em ${momento}), não preço histórico comprovado. ` +
                    'Custo de referência = Preço da Tabela ÷ multiplicador da tabela.';
            td.appendChild(tituloItens);
            const tabelaItens = document.createElement('table');
            tabelaItens.className = 'tabela-parcelas';
            const cabecalhoItens = document.createElement('tr');
            for (const titulo of ['Produto', 'Tabela', 'Qtd.', 'Preço vendido', 'Preço da Tabela', 'Custo de referência', 'Multiplicador', 'Acréscimo', 'Comissão normal', 'Adicional', 'Base', 'Comissão']) {
                const th = document.createElement('th');
                th.textContent = titulo;
                cabecalhoItens.appendChild(th);
            }
            const theadItens = document.createElement('thead');
            theadItens.appendChild(cabecalhoItens);
            tabelaItens.appendChild(theadItens);
            const tbodyItens = document.createElement('tbody');
            const numero = (valor, casas) => valor === null ? '—' : valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
            for (const item of linha.composicaoItens) {
                const tri = document.createElement('tr');
                const tdProduto = celula(item.codigo);
                tdProduto.title = item.descricao;
                tri.appendChild(tdProduto);
                const tdTabela = celula(item.tabelaCodigo);
                tdTabela.title =
                    `${item.tabelaNome} (ID ${item.tabelaId}) — ` +
                        (item.origemTabela === 'ID_INTERNO'
                            ? 'indicada no item do pedido'
                            : item.origemTabela === 'CODIGO_COMERCIAL'
                                ? 'código comercial indicado no item'
                                : 'única tabela ativa que contém o produto (o item não indica a tabela)');
                tri.appendChild(tdTabela);
                tri.appendChild(celula(numero(item.quantidade, 2)));
                tri.appendChild(celula(formatarMoeda(item.precoUnitarioVendido)));
                if (item.regra === 'FIXA') {
                    const tdFixa = celula('Comissão fixa da tabela');
                    tdFixa.colSpan = 4;
                    tri.appendChild(tdFixa);
                }
                else {
                    tri.appendChild(celula(formatarMoeda(item.precoTabela)));
                    tri.appendChild(celula(`${formatarMoeda(item.custoReferencia)} (÷ ${numero(item.multiplicadorTabela, 2)})`));
                    tri.appendChild(celula(numero(item.multiplicadorRealizado, 4)));
                    tri.appendChild(celula(formatarPercentual(item.acrescimoPercentual)));
                }
                tri.appendChild(celula(formatarPercentual(item.comissaoNormalPercentual)));
                tri.appendChild(celula(formatarPercentual(item.adicionalVendedorPercentual)));
                tri.appendChild(celula(formatarMoeda(item.baseComissao)));
                tri.appendChild(celula(formatarMoeda(item.comissaoValor)));
                tbodyItens.appendChild(tri);
            }
            tabelaItens.appendChild(tbodyItens);
            td.appendChild(tabelaItens);
        }
        const impostosEmbutidosTitulo = document.createElement('p');
        impostosEmbutidosTitulo.className = 'impostos-embutidos-titulo';
        impostosEmbutidosTitulo.textContent = 'Impostos já embutidos no valor dos produtos (informativo — não somam à nota)';
        td.appendChild(impostosEmbutidosTitulo);
        const impostosEmbutidos = document.createElement('div');
        impostosEmbutidos.className = 'detalhe-calculo-comissao detalhe-impostos-embutidos';
        const parImposto = (rotulo, valor) => {
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
            ? ['Fatura', 'Parcela', 'Faturamento', 'Vencimento', 'Valor', 'Situação financeira', 'Comissão', 'Situação da comissão']
            : ['Parcela', 'Faturamento', 'Vencimento', 'Valor', 'Situação financeira', 'Comissão', 'Situação da comissão'];
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
            trp.appendChild(celula(parcela.dataEmissao ?? '—'));
            trp.appendChild(celula(parcela.dataVencimento ?? '—'));
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
    function renderizarTabelaComissionamento(linhas, margemVisivel) {
        cabecalhoTabela.textContent = '';
        const trCabecalho = document.createElement('tr');
        const titulos = titulosTabelaComissionamento(margemVisivel);
        for (const titulo of titulos) {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = titulo;
            if (!['Nº', 'Cliente', 'Vendedor', 'Data de faturamento'].includes(titulo))
                th.className = 'col-num';
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
            const periodoAnterior = linha.origem === 'PARCELA_PERIODO_ANTERIOR';
            if (periodoAnterior) {
                tr.classList.add('linha-periodo-anterior');
                const badge = document.createElement('span');
                badge.className = 'badge-periodo-anterior';
                badge.textContent = 'Parcela de período anterior';
                badge.title =
                    'Venda de período anterior com parcela vencendo neste período — valor da venda e comissão total não somam nos totais do período; liberada/pendente consideram só as parcelas do período.';
                tdNumero.appendChild(badge);
            }
            tr.appendChild(tdNumero);
            const tdCliente = celula(linha.nomeCliente ?? 'Não localizado', 'col-nome');
            tdCliente.title = linha.nomeCliente ?? 'Não localizado';
            tr.appendChild(tdCliente);
            const tdVendedor = celula(linha.nomeVendedor ?? 'Não identificado', 'col-nome');
            tdVendedor.title = linha.nomeVendedor ?? 'Não identificado';
            tr.appendChild(tdVendedor);
            const faturamento = formatarDatasFaturamento(linha.datasFaturamento);
            const tdFaturamento = celula(faturamento.texto, 'col-data');
            tdFaturamento.title = faturamento.titulo;
            tr.appendChild(tdFaturamento);
            if (margemVisivel)
                tr.appendChild(celula(formatarPercentual(linha.margemComissionamentoPercentual ?? null), 'col-num'));
            // Percentual EFETIVO do pedido (comissão total ÷ base) — com itens de taxas diferentes é a
            // média ponderada; cada item foi calculado com o próprio percentual, sem arredondar.
            const tdFaixa = celula(formatarPercentual(linha.comissaoFinalPercentual), 'col-num');
            if (linha.vendedorComissaoFixaPercentual !== undefined) {
                tdFaixa.title = `Comissão fixa do vendedor: ${formatarPercentual(linha.vendedorComissaoFixaPercentual)} (ignora a tabela de preços)`;
            }
            else {
                tdFaixa.title =
                    linha.adicionalVendedorPercentual > 0
                        ? `Comissão normal ${formatarPercentual(linha.comissaoNormalPercentual)} + adicional do vendedor ${formatarPercentual(linha.adicionalVendedorPercentual)} — calculada item a item pela tabela de preços`
                        : `Comissão normal ${formatarPercentual(linha.comissaoNormalPercentual)} (sem adicional) — calculada item a item pela tabela de preços`;
            }
            tr.appendChild(tdFaixa);
            // Pedido anterior: venda e comissão total aparecem para referência, mas não somam no período.
            const classeForaDoTotal = periodoAnterior ? 'col-num valor-fora-do-total' : 'col-num';
            tr.appendChild(celula(formatarMoeda(linha.valorBruto), classeForaDoTotal));
            tr.appendChild(celula(formatarMoeda(linha.comissaoTotal), classeForaDoTotal));
            tr.appendChild(celula(formatarMoeda(linha.comissaoLiberada), 'col-num valor-positivo'));
            tr.appendChild(celula(formatarMoeda(linha.comissaoPendente), 'col-num'));
            tr.appendChild(celula(linha.semTitulosLocalizados ? 'Sem título' : `${linha.parcelas.filter((p) => p.baixado).length}/${linha.parcelas.length}`, 'col-num'));
            corpoTabela.appendChild(tr);
            const linhaDetalhe = renderizarLinhaParcelas(linha, margemVisivel, titulos.length);
            linhaDetalhe.hidden = true;
            corpoTabela.appendChild(linhaDetalhe);
            tr.addEventListener('click', () => {
                linhaDetalhe.hidden = !linhaDetalhe.hidden;
            });
        }
    }
    function renderizarFinanceiro(dados) {
        indicadores.textContent = '';
        indicadores.appendChild(montarIndicador('Pedidos', String(dados.resumo.quantidadePedidos)));
        indicadores.appendChild(montarIndicador('Recebimentos', String(dados.resumo.quantidadeRecebimentos)));
        indicadores.appendChild(montarIndicador('Valor recebido no período', formatarMoeda(dados.resumo.valorRecebido)));
        indicadores.appendChild(montarIndicador('Comissão a pagar', formatarMoeda(dados.resumo.comissaoAPagar), true));
        indicadores.hidden = false;
        const titulos = ['Pedido', 'Cliente', 'Vendedor', 'Nota fiscal', 'Parcela', 'Data de recebimento',
            ...(dados.margemVisivel ? [ROTULO_COLUNA_VENDA_APOS_DESPESAS] : []), 'Comissão %', 'Valor recebido', 'Comissão a pagar'];
        cabecalhoTabela.textContent = '';
        const cabecalho = document.createElement('tr');
        for (const titulo of titulos) {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = titulo;
            cabecalho.appendChild(th);
        }
        cabecalhoTabela.appendChild(cabecalho);
        corpoTabela.textContent = '';
        for (const linha of dados.linhas) {
            const tr = document.createElement('tr');
            tr.className = 'linha-comissionamento-clicavel';
            tr.tabIndex = 0;
            tr.setAttribute('aria-expanded', 'false');
            tr.title = 'Ver composição da comissão e dados do pedido';
            const valores = [linha.numeroPedido, linha.nomeCliente ?? 'Não localizado', linha.nomeVendedor ?? 'Não identificado',
                linha.numeroNotaFiscal ?? 'Não informado', linha.numeroParcela ?? '—', linha.dataRecebimento,
                ...(dados.margemVisivel ? [formatarPercentual(linha.detalhe.margemComissionamentoPercentual ?? null)] : []),
                formatarPercentual(linha.comissaoPercentual), formatarMoeda(linha.valorRecebido), formatarMoeda(linha.comissaoAPagar)];
            valores.forEach((valor, i) => tr.appendChild(celula(valor, i >= 6 ? 'col-num' : undefined)));
            corpoTabela.appendChild(tr);
            const detalhe = renderizarLinhaParcelas(linha.detalhe, dados.margemVisivel, titulos.length);
            const nota = document.createElement('p');
            nota.textContent = `Recebido em ${linha.dataRecebimento}: ${formatarMoeda(linha.valorRecebido)}. Comissão a pagar: ${formatarMoeda(linha.comissaoAPagar)}. A composição do pedido é apresentada como referência; a parcela abaixo corresponde somente a este recebimento.`;
            detalhe.firstElementChild?.prepend(nota);
            detalhe.hidden = true;
            corpoTabela.appendChild(detalhe);
            const alternar = () => { detalhe.hidden = !detalhe.hidden; tr.setAttribute('aria-expanded', String(!detalhe.hidden)); };
            tr.addEventListener('click', alternar);
            tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                alternar();
            } });
        }
    }
    async function carregarRelatorio() {
        const idRequisicao = ++requisicaoAtual;
        limparResultado();
        mostrarCarregando(true);
        try {
            const parametros = new URLSearchParams();
            if (campoDataDe.value.trim() !== '')
                parametros.set('data_de', campoDataDe.value.trim());
            if (campoDataAte.value.trim() !== '')
                parametros.set('data_ate', campoDataAte.value.trim());
            if (campoVendedor.value !== '')
                parametros.set('vendedor', campoVendedor.value);
            if (campoBusca.value.trim() !== '')
                parametros.set('busca', campoBusca.value.trim());
            const resposta = await fetch(`${CAMINHO_POR_TIPO[tipoAtivo]}?${parametros.toString()}`);
            const corpo = await resposta.json().catch(() => null);
            if (idRequisicao !== requisicaoAtual)
                return;
            if (!resposta.ok) {
                const corpoErro = corpo && typeof corpo === 'object' ? corpo : null;
                const erroBase = typeof corpoErro?.erro === 'string' ? corpoErro.erro : 'Não foi possível consultar a Omie neste momento.';
                const motivo = typeof corpoErro?.motivo === 'string' ? corpoErro.motivo : null;
                throw new Error(motivo ? `${erroBase} ${motivo}` : erroBase);
            }
            const avisos = [];
            if (tipoAtivo === 'financeiro-comissao') {
                const dados = corpo;
                avisoRelatorio.textContent = ['Comissão apurada pela data de recebimento da empresa. Não comprova pagamento ao funcionário.', ...dados.avisos].join(' ');
                avisoRelatorio.hidden = false;
                renderizarFinanceiro(dados);
                parametrosExcel = parametros.toString();
                botaoBaixarExcel.hidden = false;
                if (dados.linhas.length === 0)
                    areaVazia.hidden = false;
                else {
                    areaTabela.hidden = false;
                    botaoBaixarPdf.hidden = false;
                }
            }
            else if (tipoAtivo === 'comissionamento') {
                const dados = corpo;
                if (dados.pedidosSemVendedorExcluidos > 0) {
                    const numeros = dados.numerosPedidosSemVendedor.map((n) => `nº ${n}`).join(', ');
                    avisos.push(`${dados.pedidosSemVendedorExcluidos} pedido(s) sem vendedor identificado foram excluídos do comissionamento: ${numeros}.`);
                }
                if (dados.documentosAmbiguosExcluidos > 0) {
                    avisos.push(`${dados.documentosAmbiguosExcluidos} documento(s) com etapa não reconhecida foram excluídos.`);
                }
                const anterioresNaoLocalizados = dados.numerosPedidosAnterioresNaoLocalizados ?? [];
                if (anterioresNaoLocalizados.length > 0) {
                    avisos.push(`${anterioresNaoLocalizados.length} pedido(s) de período anterior com parcela neste período não puderam ser consultados na Omie e ficaram fora: ${anterioresNaoLocalizados.map((n) => `nº ${n}`).join(', ')}.`);
                }
                const excecoes = dados.excecoesRevisaoManual ?? [];
                if (excecoes.length > 0)
                    avisos.push(descreverExcecoesRevisaoManual(excecoes));
                const excecoesApuracao = dados.excecoesApuracao ?? [];
                if (excecoesApuracao.length > 0)
                    avisos.push(descreverExcecoesApuracao(excecoesApuracao));
                const qtdAnteriores = dados.linhas.filter((l) => l.origem === 'PARCELA_PERIODO_ANTERIOR').length;
                if (qtdAnteriores > 0) {
                    avisos.push(`${qtdAnteriores} pedido(s) de até 12 meses antes aparecem por terem parcela vencendo no período — não somam em Pedidos, Valor da venda nem Comissão calculada.`);
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
                // `margemVisivel` vem do servidor (decidido pelo papel autenticado) — para quem não é
                // administrador a margem nem chega no payload; aqui só se ajusta o layout (tela e PDF).
                renderizarTabelaComissionamento(dados.linhas, dados.margemVisivel === true);
                areaTabela.hidden = false;
                botaoBaixarPdf.hidden = false;
            }
            else {
                const dados = corpo;
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
        }
        catch (erro) {
            if (idRequisicao !== requisicaoAtual)
                return;
            mostrarErro(erro instanceof Error ? erro.message : 'Erro desconhecido.');
        }
        finally {
            if (idRequisicao === requisicaoAtual)
                mostrarCarregando(false);
        }
    }
    function trocarAbaRelatorio(tipo) {
        if (tipo === tipoAtivo)
            return;
        tipoAtivo = tipo;
        aplicarAbaAtiva();
        void carregarRelatorio();
    }
    abaVendas.addEventListener('click', () => trocarAbaRelatorio('vendas'));
    abaOrcamentos.addEventListener('click', () => trocarAbaRelatorio('orcamentos'));
    abaComissionamento.addEventListener('click', () => trocarAbaRelatorio('comissionamento'));
    abaFinanceiro.addEventListener('click', () => trocarAbaRelatorio('financeiro-comissao'));
    botaoBaixarPdf.addEventListener('click', () => window.print());
    botaoBaixarExcel.addEventListener('click', () => {
        if (parametrosExcel === null)
            return;
        const consulta = parametrosExcel;
        botaoBaixarExcel.disabled = true;
        void (async () => {
            try {
                const resposta = await fetch(`/api/relatorios/financeiro-comissao/excel?${consulta}`);
                if (!resposta.ok) {
                    const erro = await resposta.json().catch(() => ({}));
                    throw new Error(erro.erro ?? 'Não foi possível baixar o Excel.');
                }
                const url = URL.createObjectURL(await resposta.blob());
                const link = document.createElement('a');
                link.href = url;
                link.download = 'financeiro-comissao.xlsx';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            catch (erro) {
                avisoRelatorio.textContent = erro instanceof Error ? erro.message : 'Erro ao baixar Excel.';
                avisoRelatorio.hidden = false;
            }
            finally {
                botaoBaixarExcel.disabled = false;
            }
        })();
    });
    /**
     * Máscara automática dd/mm/aaaa: o usuário digita só números, sem precisar
     * da barra (ex.: "01012026" vira "01/01/2026" enquanto digita). Se parar
     * com o ano em 2 dígitos (ex.: "010126" -> "01/01/26"), completa para
     * "01/01/2026" ao sair do campo — sistema opera só com datas recentes,
     * então o século 2000 é assumido.
     */
    function aplicarMascaraData(campo) {
        campo.addEventListener('input', () => {
            const digitos = campo.value.replace(/\D/g, '').slice(0, 8);
            if (digitos.length > 4) {
                campo.value = `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
            }
            else if (digitos.length > 2) {
                campo.value = `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
            }
            else {
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
    function conectarCalendario(campoTexto, campoCalendario, botao) {
        botao.addEventListener('click', () => {
            const comShowPicker = campoCalendario;
            if (typeof comShowPicker.showPicker === 'function') {
                comShowPicker.showPicker();
            }
            else {
                campoCalendario.click();
            }
        });
        campoCalendario.addEventListener('change', () => {
            if (campoCalendario.value === '')
                return;
            const [ano, mes, dia] = campoCalendario.value.split('-');
            campoTexto.value = `${dia}/${mes}/${ano}`;
        });
    }
    conectarCalendario(campoDataDe, campoDataDeCalendario, botaoCalendarioDe);
    conectarCalendario(campoDataAte, campoDataAteCalendario, botaoCalendarioAte);
    // Expande em tela cheia apenas a LINHA selecionada (não a tabela inteira): move o conteúdo do
    // <td> de detalhe daquele pedido para dentro do modal e devolve ao fechar — nunca clona/recria
    // os nós (preserva os dados, sem re-parsear texto não confiável vindo da Omie).
    let tdOrigemModalExpandido = null;
    function fecharModalLinha() {
        if (tdOrigemModalExpandido !== null) {
            while (modalLinhaCorpo.firstChild)
                tdOrigemModalExpandido.appendChild(modalLinhaCorpo.firstChild);
            tdOrigemModalExpandido = null;
        }
        modalLinha.hidden = true;
        modalLinhaFundo.hidden = true;
        document.body.classList.remove('corpo-tabela-expandida');
    }
    function alternarModalLinha(td, numeroPedido) {
        if (tdOrigemModalExpandido === td) {
            fecharModalLinha();
            return;
        }
        if (tdOrigemModalExpandido !== null)
            fecharModalLinha();
        while (td.firstChild)
            modalLinhaCorpo.appendChild(td.firstChild);
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
        ativar() {
            if (ativado)
                return;
            ativado = true;
            void carregarVendedores();
            void carregarRelatorio();
        },
    };
}
