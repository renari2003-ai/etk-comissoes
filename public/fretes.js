/**
 * Painel "Fretes" (Fase 1) — só carregado/ativado para quem tem a permissão `fretes`
 * (ver `auth.ts`). Fluxo: cotação → propostas (manuais) → comparação → seleção manual →
 * fechamento (acréscimo sempre informado pelo usuário, nunca automático). Mesmo padrão
 * estrutural de `usuarios.ts`/`relatorios.ts`: `{ ativar }` plugado pelo `app.ts`.
 */
import { formatarMoeda, formatarPercentual } from './formatacao.js';
const ROTULOS_CANAL = {
    EMAIL: 'E-mail',
    WHATSAPP: 'WhatsApp',
    MANUAL: 'Manual',
    API: 'API',
    OUTRO: 'Outro',
};
const ROTULOS_STATUS_SOLICITACAO = {
    PENDENTE_ENVIO: 'Pendente de envio',
    ENVIADA: 'Enviada',
    ENTREGUE: 'Entregue',
    RESPONDIDA: 'Respondida',
    ERRO: 'Erro',
    CANCELADA: 'Cancelada',
};
const ROTULOS_MODALIDADE_EXECUCAO = {
    TRANSPORTADORA: 'Transportadora',
    VEICULO_PROPRIO: 'Veículo próprio',
    RETIRA: 'Retira',
};
const ROTULOS_ORIGEM_DESTINO = {
    PEDIDO: 'Endereço específico do Pedido Omie',
    CLIENTE_ENTREGA: 'Endereço de Entrega do Cliente Omie',
    CLIENTE_CADASTRAL: 'Endereço Cadastral do Cliente',
    MANUAL: 'Informado manualmente',
};
const ROTULOS_STATUS_COTACAO = {
    RASCUNHO: 'Rascunho',
    AGUARDANDO_PROPOSTAS: 'Aguardando propostas',
    EM_ANALISE: 'Em análise',
    AGUARDANDO_APROVACAO: 'Aguardando aprovação',
    FECHADA: 'Fechada',
    CANCELADA: 'Cancelada',
};
function el(id) {
    const elemento = document.getElementById(id);
    if (elemento === null)
        throw new Error(`Elemento #${id} não encontrado`);
    return elemento;
}
async function extrairMensagemErro(resposta) {
    const corpo = await resposta.json().catch(() => null);
    if (corpo && typeof corpo === 'object' && typeof corpo.erro === 'string') {
        return corpo.erro;
    }
    return 'Não foi possível completar a operação.';
}
function textoOuNulo(valor) {
    if (valor === null)
        return null;
    const texto = String(valor).trim();
    return texto === '' ? null : texto;
}
function numeroOuNulo(valor) {
    const texto = textoOuNulo(valor);
    return texto === null ? null : Number(texto);
}
export function inicializarFretes() {
    const abaDashboard = el('fretes-aba-dashboard');
    const abaCotacoes = el('fretes-aba-cotacoes');
    const abaImportarOmie = el('fretes-aba-importar-omie');
    const abaTransportadoras = el('fretes-aba-transportadoras');
    const abaVeiculos = el('fretes-aba-veiculos');
    const abaPropostasRecebidas = el('fretes-aba-propostas-recebidas');
    const secaoDashboard = el('fretes-secao-dashboard');
    const secaoCotacoes = el('fretes-secao-cotacoes');
    const secaoImportarOmie = el('fretes-secao-importar-omie');
    const secaoDetalhe = el('fretes-secao-detalhe');
    const secaoTransportadoras = el('fretes-secao-transportadoras');
    const secaoVeiculos = el('fretes-secao-veiculos');
    const secaoPropostasRecebidas = el('fretes-secao-propostas-recebidas');
    const badgePendentes = el('fretes-badge-pendentes');
    let ativado = false;
    let transportadorasCache = [];
    let veiculosCache = [];
    let cotacaoAtualId = null;
    let modalidadeExecucaoAtual = 'TRANSPORTADORA';
    let preparacaoOmieAtual = null;
    let numeroPedidoOmieAtual = null;
    function mostrarSubAba(sub) {
        secaoDashboard.hidden = sub !== 'dashboard';
        secaoCotacoes.hidden = sub !== 'cotacoes';
        secaoImportarOmie.hidden = sub !== 'importar-omie';
        secaoDetalhe.hidden = sub !== 'detalhe';
        secaoTransportadoras.hidden = sub !== 'transportadoras';
        secaoVeiculos.hidden = sub !== 'veiculos';
        secaoPropostasRecebidas.hidden = sub !== 'propostas-recebidas';
        abaDashboard.classList.toggle('aba-ativa', sub === 'dashboard');
        abaCotacoes.classList.toggle('aba-ativa', sub === 'cotacoes' || sub === 'detalhe');
        abaImportarOmie.classList.toggle('aba-ativa', sub === 'importar-omie');
        abaTransportadoras.classList.toggle('aba-ativa', sub === 'transportadoras');
        abaVeiculos.classList.toggle('aba-ativa', sub === 'veiculos');
        abaPropostasRecebidas.classList.toggle('aba-ativa', sub === 'propostas-recebidas');
    }
    // --- Dashboard -----------------------------------------------------------
    async function carregarDashboard() {
        const container = el('fretes-dashboard-indicadores');
        container.textContent = '';
        const resposta = await fetch('/api/fretes/dashboard');
        if (!resposta.ok) {
            container.textContent = await extrairMensagemErro(resposta);
            return;
        }
        const dados = (await resposta.json());
        const indicadores = [
            { rotulo: 'Aguardando propostas', valor: String(dados.cotacoesPorStatus.AGUARDANDO_PROPOSTAS + dados.cotacoesPorStatus.RASCUNHO) },
            { rotulo: 'Em análise', valor: String(dados.cotacoesPorStatus.EM_ANALISE) },
            { rotulo: 'Aguardando aprovação', valor: String(dados.cotacoesPorStatus.AGUARDANDO_APROVACAO) },
            { rotulo: 'Fechadas', valor: String(dados.cotacoesPorStatus.FECHADA) },
            { rotulo: 'Cotações — Transportadora', valor: String(dados.cotacoesPorModalidadeExecucao.TRANSPORTADORA) },
            { rotulo: 'Cotações — Veículo próprio', valor: String(dados.cotacoesPorModalidadeExecucao.VEICULO_PROPRIO) },
            { rotulo: 'Cotações — Retira', valor: String(dados.cotacoesPorModalidadeExecucao.RETIRA) },
            { rotulo: 'Custo total de fretes', valor: formatarMoeda(dados.resumoFechamentos.custoTotal) },
            { rotulo: 'Valor total repassado', valor: formatarMoeda(dados.resumoFechamentos.valorClienteTotal) },
            { rotulo: 'Total de acréscimos', valor: formatarMoeda(dados.resumoFechamentos.acrescimoTotal) },
            { rotulo: 'Fretes fechados — Transportadora', valor: String(dados.resumoFechamentosPorModalidadeExecucao.TRANSPORTADORA.quantidade) },
            { rotulo: 'Fretes fechados — Veículo próprio', valor: String(dados.resumoFechamentosPorModalidadeExecucao.VEICULO_PROPRIO.quantidade) },
            { rotulo: 'Retiradas fechadas', valor: String(dados.resumoFechamentosPorModalidadeExecucao.RETIRA.quantidade) },
        ];
        for (const item of indicadores) {
            const div = document.createElement('div');
            div.className = 'metrica';
            const rotulo = document.createElement('span');
            rotulo.className = 'metrica-rotulo';
            rotulo.textContent = item.rotulo;
            const valor = document.createElement('span');
            valor.className = 'metrica-valor';
            valor.textContent = item.valor;
            div.appendChild(rotulo);
            div.appendChild(valor);
            container.appendChild(div);
        }
    }
    // --- Transportadoras -------------------------------------------------
    async function carregarTransportadoras() {
        const resposta = await fetch('/api/fretes/transportadoras');
        if (resposta.ok) {
            const dados = (await resposta.json());
            transportadorasCache = dados.transportadoras;
        }
        renderizarTabelaTransportadoras();
        renderizarSelectTransportadoras();
    }
    function renderizarTabelaTransportadoras() {
        const corpo = el('fretes-tabela-transportadoras-corpo');
        corpo.textContent = '';
        for (const t of transportadorasCache) {
            const tr = document.createElement('tr');
            const celula = (texto) => {
                const td = document.createElement('td');
                td.textContent = texto;
                return td;
            };
            tr.appendChild(celula(t.nomeFantasia ? `${t.nomeRazaoSocial} (${t.nomeFantasia})` : t.nomeRazaoSocial));
            tr.appendChild(celula(t.cnpj ?? '—'));
            tr.appendChild(celula(t.contato ?? t.telefone ?? t.email ?? '—'));
            tr.appendChild(celula(t.ativo ? 'Ativa' : 'Inativa'));
            const tdAcoes = document.createElement('td');
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'botao-secundario';
            botao.textContent = t.ativo ? 'Desativar' : 'Ativar';
            botao.addEventListener('click', () => {
                void (async () => {
                    const resposta = await fetch(`/api/fretes/transportadoras/${t.id}/${t.ativo ? 'desativar' : 'ativar'}`, { method: 'POST' });
                    if (!resposta.ok) {
                        window.alert(await extrairMensagemErro(resposta));
                        return;
                    }
                    void carregarTransportadoras();
                })();
            });
            tdAcoes.appendChild(botao);
            tr.appendChild(tdAcoes);
            corpo.appendChild(tr);
        }
    }
    function renderizarSelectTransportadoras() {
        const select = document.getElementById('fretes-proposta-transportadora');
        if (select === null)
            return;
        const valorAtual = select.value;
        select.textContent = '';
        const optPlaceholder = document.createElement('option');
        optPlaceholder.value = '';
        optPlaceholder.textContent = 'Selecione…';
        select.appendChild(optPlaceholder);
        for (const t of transportadorasCache.filter((x) => x.ativo)) {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.nomeRazaoSocial;
            select.appendChild(option);
        }
        select.value = valorAtual;
    }
    const formNovaTransportadora = el('fretes-form-nova-transportadora');
    const erroTransportadora = el('fretes-transportadora-erro');
    formNovaTransportadora.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            erroTransportadora.hidden = true;
            const dadosForm = new FormData(formNovaTransportadora);
            const resposta = await fetch('/api/fretes/transportadoras', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nomeRazaoSocial: dadosForm.get('nomeRazaoSocial'),
                    nomeFantasia: textoOuNulo(dadosForm.get('nomeFantasia')),
                    cnpj: textoOuNulo(dadosForm.get('cnpj')),
                    email: textoOuNulo(dadosForm.get('email')),
                    telefone: textoOuNulo(dadosForm.get('telefone')),
                    contato: textoOuNulo(dadosForm.get('contato')),
                }),
            });
            if (!resposta.ok) {
                erroTransportadora.textContent = await extrairMensagemErro(resposta);
                erroTransportadora.hidden = false;
                return;
            }
            formNovaTransportadora.reset();
            void carregarTransportadoras();
        })();
    });
    // --- Veículos próprios (Fase 2) -------------------------------------------
    async function carregarVeiculos() {
        const resposta = await fetch('/api/fretes/veiculos');
        if (resposta.ok) {
            const dados = (await resposta.json());
            veiculosCache = dados.veiculos;
        }
        renderizarTabelaVeiculos();
        renderizarSelectVeiculos();
    }
    function renderizarTabelaVeiculos() {
        const corpo = el('fretes-tabela-veiculos-corpo');
        corpo.textContent = '';
        for (const v of veiculosCache) {
            const tr = document.createElement('tr');
            const celula = (texto) => {
                const td = document.createElement('td');
                td.textContent = texto;
                return td;
            };
            tr.appendChild(celula(v.descricao));
            tr.appendChild(celula(v.placa ?? '—'));
            tr.appendChild(celula(v.tipo ?? '—'));
            tr.appendChild(celula(v.capacidadeKg !== null ? `${v.capacidadeKg} kg` : '—'));
            tr.appendChild(celula(v.ativo ? 'Ativo' : 'Inativo'));
            const tdAcoes = document.createElement('td');
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'botao-secundario';
            botao.textContent = v.ativo ? 'Desativar' : 'Ativar';
            botao.addEventListener('click', () => {
                void (async () => {
                    const resposta = await fetch(`/api/fretes/veiculos/${v.id}/${v.ativo ? 'desativar' : 'ativar'}`, { method: 'POST' });
                    if (!resposta.ok) {
                        window.alert(await extrairMensagemErro(resposta));
                        return;
                    }
                    void carregarVeiculos();
                })();
            });
            tdAcoes.appendChild(botao);
            tr.appendChild(tdAcoes);
            corpo.appendChild(tr);
        }
    }
    /** Só veículos ATIVOS aparecem para seleção em novas cotações/entregas (seção 18). Preenche os dois selects (manual e importação Omie). */
    function renderizarSelectVeiculos() {
        for (const idSelect of ['fretes-cotacao-veiculo', 'fretes-importar-veiculo']) {
            const select = document.getElementById(idSelect);
            if (select === null)
                continue;
            const valorAtual = select.value;
            select.textContent = '';
            const optPlaceholder = document.createElement('option');
            optPlaceholder.value = '';
            optPlaceholder.textContent = 'Selecione…';
            select.appendChild(optPlaceholder);
            for (const v of veiculosCache.filter((x) => x.ativo)) {
                const option = document.createElement('option');
                option.value = v.id;
                option.textContent = v.placa ? `${v.descricao} (${v.placa})` : v.descricao;
                select.appendChild(option);
            }
            select.value = valorAtual;
        }
    }
    const formNovoVeiculo = el('fretes-form-novo-veiculo');
    const erroVeiculo = el('fretes-veiculo-erro');
    formNovoVeiculo.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            erroVeiculo.hidden = true;
            const dadosForm = new FormData(formNovoVeiculo);
            const resposta = await fetch('/api/fretes/veiculos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    descricao: dadosForm.get('descricao'),
                    placa: textoOuNulo(dadosForm.get('placa')),
                    tipo: textoOuNulo(dadosForm.get('tipo')),
                    marca: textoOuNulo(dadosForm.get('marca')),
                    modelo: textoOuNulo(dadosForm.get('modelo')),
                    ano: numeroOuNulo(dadosForm.get('ano')),
                    capacidadeKg: numeroOuNulo(dadosForm.get('capacidadeKg')),
                    capacidadeM3: numeroOuNulo(dadosForm.get('capacidadeM3')),
                }),
            });
            if (!resposta.ok) {
                erroVeiculo.textContent = await extrairMensagemErro(resposta);
                erroVeiculo.hidden = false;
                return;
            }
            formNovoVeiculo.reset();
            void carregarVeiculos();
        })();
    });
    // --- Cotações ----------------------------------------------------------
    function classeStatus(status) {
        if (status === 'FECHADA')
            return 'linha-status-positivo';
        if (status === 'CANCELADA')
            return 'linha-status-negativo';
        return 'linha-status-alerta';
    }
    async function carregarCotacoes() {
        const status = document.getElementById('fretes-filtro-status')?.value ?? '';
        const url = status === '' ? '/api/fretes/cotacoes' : `/api/fretes/cotacoes?status=${encodeURIComponent(status)}`;
        const resposta = await fetch(url);
        const corpo = el('fretes-tabela-cotacoes-corpo');
        corpo.textContent = '';
        if (!resposta.ok)
            return;
        const dados = (await resposta.json());
        for (const cotacao of dados.cotacoes) {
            const tr = document.createElement('tr');
            const celula = (texto) => {
                const td = document.createElement('td');
                td.textContent = texto;
                return td;
            };
            tr.appendChild(celula(cotacao.codigo));
            tr.appendChild(celula(`${cotacao.origem ?? '—'} → ${cotacao.destino ?? '—'}`));
            tr.appendChild(celula(ROTULOS_MODALIDADE_EXECUCAO[cotacao.modalidadeExecucao]));
            tr.appendChild(celula(cotacao.modalidade));
            const tdStatus = document.createElement('td');
            const spanStatus = document.createElement('span');
            spanStatus.className = `linha-status ${classeStatus(cotacao.status)}`;
            spanStatus.textContent = ROTULOS_STATUS_COTACAO[cotacao.status];
            tdStatus.appendChild(spanStatus);
            tr.appendChild(tdStatus);
            tr.appendChild(celula(new Date(cotacao.criadoEm).toLocaleDateString('pt-BR')));
            const tdAcoes = document.createElement('td');
            const botaoAbrir = document.createElement('button');
            botaoAbrir.type = 'button';
            botaoAbrir.className = 'botao-secundario';
            botaoAbrir.textContent = 'Abrir';
            botaoAbrir.addEventListener('click', () => void abrirDetalheCotacao(cotacao.id));
            tdAcoes.appendChild(botaoAbrir);
            tr.appendChild(tdAcoes);
            corpo.appendChild(tr);
        }
    }
    const formNovaCotacao = el('fretes-form-nova-cotacao');
    const erroCotacao = el('fretes-cotacao-erro');
    const campoVeiculoCotacao = el('fretes-cotacao-campo-veiculo');
    const campoMotoristaCotacao = el('fretes-cotacao-campo-motorista');
    const campoCustoManualCotacao = el('fretes-cotacao-campo-custo-manual');
    const campoVeiculoSelect = el('fretes-cotacao-veiculo');
    /** Mostra só os campos relevantes pra cada modalidade (seção 13/15/16) — veículo é exigido no frontend para VEICULO_PROPRIO, mas a validação real está no backend (nunca confia só na UI). */
    function atualizarCamposPorModalidadeExecucao() {
        const modalidade = document.querySelector('input[name="modalidadeExecucao"]:checked')?.value;
        const ehVeiculoProprio = modalidade === 'VEICULO_PROPRIO';
        campoVeiculoCotacao.hidden = !ehVeiculoProprio;
        campoMotoristaCotacao.hidden = !ehVeiculoProprio;
        campoCustoManualCotacao.hidden = !ehVeiculoProprio;
        campoVeiculoSelect.required = ehVeiculoProprio;
    }
    Array.from(document.querySelectorAll('input[name="modalidadeExecucao"]')).forEach((radio) => {
        radio.addEventListener('change', atualizarCamposPorModalidadeExecucao);
    });
    atualizarCamposPorModalidadeExecucao();
    formNovaCotacao.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            erroCotacao.hidden = true;
            const dadosForm = new FormData(formNovaCotacao);
            const resposta = await fetch('/api/fretes/cotacoes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pedidoOmieId: numeroOuNulo(dadosForm.get('pedidoOmieId')),
                    clienteOmieId: numeroOuNulo(dadosForm.get('clienteOmieId')),
                    vendedorOmieId: numeroOuNulo(dadosForm.get('vendedorOmieId')),
                    origem: textoOuNulo(dadosForm.get('origem')),
                    cepOrigem: textoOuNulo(dadosForm.get('cepOrigem')),
                    destino: textoOuNulo(dadosForm.get('destino')),
                    cepDestino: textoOuNulo(dadosForm.get('cepDestino')),
                    peso: numeroOuNulo(dadosForm.get('peso')),
                    volumes: numeroOuNulo(dadosForm.get('volumes')),
                    valorMercadoria: numeroOuNulo(dadosForm.get('valorMercadoria')),
                    modalidade: dadosForm.get('modalidade'),
                    modalidadeExecucao: dadosForm.get('modalidadeExecucao'),
                    veiculoId: textoOuNulo(dadosForm.get('veiculoId')),
                    motoristaNome: textoOuNulo(dadosForm.get('motoristaNome')),
                    custoManual: numeroOuNulo(dadosForm.get('custoManual')),
                    observacoes: textoOuNulo(dadosForm.get('observacoes')),
                }),
            });
            if (!resposta.ok) {
                erroCotacao.textContent = await extrairMensagemErro(resposta);
                erroCotacao.hidden = false;
                return;
            }
            formNovaCotacao.reset();
            atualizarCamposPorModalidadeExecucao();
            void carregarCotacoes();
        })();
    });
    el('fretes-filtro-status').addEventListener('change', () => void carregarCotacoes());
    // --- Detalhe da cotação (propostas, comparação, fechamento) --------------
    async function abrirDetalheCotacao(id) {
        cotacaoAtualId = id;
        mostrarSubAba('detalhe');
        await Promise.all([carregarTransportadoras(), carregarVeiculos(), carregarDetalheCotacao()]);
    }
    function renderizarInfoVeiculo(cotacao) {
        const container = el('fretes-detalhe-veiculo-info');
        container.textContent = '';
        const veiculo = veiculosCache.find((v) => v.id === cotacao.veiculoId);
        const linhas = [
            ['Veículo', veiculo ? (veiculo.placa ? `${veiculo.descricao} (${veiculo.placa})` : veiculo.descricao) : 'Nenhum vinculado'],
            ['Motorista', cotacao.motoristaNome ?? '—'],
            ['Custo interno informado na cotação', cotacao.custoManual !== null ? formatarMoeda(cotacao.custoManual) : 'Não informado ainda'],
        ];
        for (const [rotulo, valor] of linhas) {
            const div = document.createElement('div');
            const spanRotulo = document.createElement('span');
            spanRotulo.className = 'metrica-rotulo';
            spanRotulo.textContent = rotulo;
            const spanValor = document.createElement('span');
            spanValor.className = 'metrica-valor';
            spanValor.textContent = valor;
            div.appendChild(spanRotulo);
            div.appendChild(spanValor);
            container.appendChild(div);
        }
    }
    async function carregarDetalheCotacao() {
        if (cotacaoAtualId === null)
            return;
        const erroDetalhe = el('fretes-detalhe-erro');
        erroDetalhe.hidden = true;
        const respostaCotacao = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}`);
        if (!respostaCotacao.ok) {
            erroDetalhe.textContent = await extrairMensagemErro(respostaCotacao);
            erroDetalhe.hidden = false;
            return;
        }
        const cotacao = (await respostaCotacao.json());
        const modalidadeExecucao = cotacao.modalidadeExecucao;
        modalidadeExecucaoAtual = modalidadeExecucao;
        el('fretes-detalhe-titulo').textContent = `Cotação ${cotacao.codigo}`;
        el('fretes-detalhe-info').textContent =
            `${cotacao.origem ?? '—'} → ${cotacao.destino ?? '—'} • ${ROTULOS_MODALIDADE_EXECUCAO[modalidadeExecucao]} • ${cotacao.modalidade} • Status: ${ROTULOS_STATUS_COTACAO[cotacao.status]}`;
        const cotacaoEncerrada = cotacao.status === 'FECHADA' || cotacao.status === 'CANCELADA';
        // Cada modalidade mostra só os blocos relevantes (seção 14/15/16) — nunca transportadora/proposta
        // para VEICULO_PROPRIO/RETIRA, nunca veículo para as outras duas.
        el('fretes-detalhe-bloco-transportadora').hidden = modalidadeExecucao !== 'TRANSPORTADORA';
        el('fretes-detalhe-bloco-veiculo').hidden = modalidadeExecucao !== 'VEICULO_PROPRIO';
        el('fretes-detalhe-bloco-retira').hidden = modalidadeExecucao !== 'RETIRA';
        el('fretes-detalhe-form-secao').hidden = cotacaoEncerrada;
        let propostaSelecionada = null;
        if (modalidadeExecucao === 'TRANSPORTADORA') {
            const respostaPropostas = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/propostas`);
            const propostas = respostaPropostas.ok ? (await respostaPropostas.json()).propostas : [];
            renderizarTabelaPropostas(propostas, cotacaoEncerrada);
            propostaSelecionada = propostas.find((p) => p.selecionada) ?? null;
            renderizarCheckboxesSolicitacao();
            el('fretes-botao-solicitar-cotacao').disabled = cotacaoEncerrada;
            void carregarSolicitacoes();
        }
        else if (modalidadeExecucao === 'VEICULO_PROPRIO') {
            renderizarInfoVeiculo(cotacao);
        }
        const painelFechamento = el('fretes-painel-fechamento');
        const painelConcluido = el('fretes-fechamento-concluido');
        const campoCustoManualFechamento = el('fretes-fechamento-campo-custo-manual');
        const blocoAcrescimo = el('fretes-fechamento-bloco-acrescimo');
        const botaoConfirmar = el('fretes-fechamento-botao-confirmar');
        if (cotacao.status === 'FECHADA') {
            painelFechamento.hidden = true;
            const respostaFechamento = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/fechamento`);
            if (respostaFechamento.ok) {
                const fechamento = (await respostaFechamento.json());
                renderizarFechamentoConcluido(fechamento);
                painelConcluido.hidden = false;
            }
            return;
        }
        painelConcluido.hidden = true;
        if (modalidadeExecucao === 'TRANSPORTADORA') {
            campoCustoManualFechamento.hidden = true;
            blocoAcrescimo.hidden = false;
            botaoConfirmar.textContent = 'Confirmar fechamento';
            painelFechamento.hidden = propostaSelecionada === null;
            if (propostaSelecionada !== null)
                atualizarPreviewFechamento(propostaSelecionada.valorCusto);
        }
        else if (modalidadeExecucao === 'VEICULO_PROPRIO') {
            campoCustoManualFechamento.hidden = false;
            blocoAcrescimo.hidden = false;
            botaoConfirmar.textContent = 'Confirmar fechamento';
            painelFechamento.hidden = cotacao.veiculoId === null;
            const custoInicial = cotacao.custoManual ?? 0;
            el('fretes-fechamento-custo-manual').value = String(custoInicial);
            if (cotacao.veiculoId !== null)
                atualizarPreviewFechamento(custoInicial);
        }
        else {
            // RETIRA (seção 12/16): sem custo, sem acréscimo — só confirmação direta.
            campoCustoManualFechamento.hidden = true;
            blocoAcrescimo.hidden = true;
            botaoConfirmar.textContent = 'Confirmar retirada (frete R$ 0,00)';
            painelFechamento.hidden = false;
            el('fretes-fechamento-resumo').textContent = '';
        }
    }
    function renderizarTabelaPropostas(propostas, cotacaoEncerrada) {
        const corpo = el('fretes-tabela-propostas-corpo');
        corpo.textContent = '';
        for (const proposta of propostas) {
            const transportadora = transportadorasCache.find((t) => t.id === proposta.transportadoraId);
            const tr = document.createElement('tr');
            if (proposta.selecionada)
                tr.className = 'linha-selecionada';
            const celula = (texto, numerica = false) => {
                const td = document.createElement('td');
                if (numerica)
                    td.className = 'col-num';
                td.textContent = texto;
                return td;
            };
            tr.appendChild(celula(transportadora?.nomeRazaoSocial ?? '—'));
            tr.appendChild(celula(formatarMoeda(proposta.valorCusto), true));
            tr.appendChild(celula(proposta.prazoDias !== null ? `${proposta.prazoDias} dia(s)` : '—'));
            tr.appendChild(celula(proposta.validade ?? '—'));
            tr.appendChild(celula(proposta.tipoServico ?? '—'));
            const rotuloStatus = proposta.status === 'PENDENTE_VALIDACAO'
                ? 'Pendente de validação'
                : proposta.selecionada
                    ? 'Selecionada'
                    : proposta.status === 'REJEITADA'
                        ? 'Rejeitada'
                        : 'Recebida';
            tr.appendChild(celula(rotuloStatus));
            if (proposta.status === 'PENDENTE_VALIDACAO')
                tr.className = 'linha-pendente-validacao';
            const tdAcoes = document.createElement('td');
            if (proposta.status === 'PENDENTE_VALIDACAO') {
                tdAcoes.textContent = 'Revise em "Propostas recebidas"';
            }
            else if (!cotacaoEncerrada && !proposta.selecionada && proposta.status !== 'REJEITADA') {
                const botaoSelecionar = document.createElement('button');
                botaoSelecionar.type = 'button';
                botaoSelecionar.className = 'botao-secundario';
                botaoSelecionar.textContent = 'Selecionar';
                botaoSelecionar.addEventListener('click', () => {
                    void (async () => {
                        const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/propostas/${proposta.id}/selecionar`, { method: 'POST' });
                        if (!resposta.ok) {
                            window.alert(await extrairMensagemErro(resposta));
                            return;
                        }
                        void carregarDetalheCotacao();
                    })();
                });
                tdAcoes.appendChild(botaoSelecionar);
                const botaoRejeitar = document.createElement('button');
                botaoRejeitar.type = 'button';
                botaoRejeitar.className = 'botao-secundario';
                botaoRejeitar.textContent = 'Rejeitar';
                botaoRejeitar.addEventListener('click', () => {
                    void (async () => {
                        const resposta = await fetch(`/api/fretes/propostas/${proposta.id}/rejeitar`, { method: 'POST' });
                        if (!resposta.ok) {
                            window.alert(await extrairMensagemErro(resposta));
                            return;
                        }
                        void carregarDetalheCotacao();
                    })();
                });
                tdAcoes.appendChild(botaoRejeitar);
            }
            tr.appendChild(tdAcoes);
            corpo.appendChild(tr);
        }
    }
    // --- Fase 4A.1: solicitar cotação (seção 12/25/35) ------------------------
    function formatarDataHoraOuTraco(iso) {
        if (iso === null)
            return '—';
        const data = new Date(iso);
        return Number.isNaN(data.getTime()) ? '—' : data.toLocaleString('pt-BR');
    }
    function renderizarCheckboxesSolicitacao() {
        const container = el('fretes-solicitacoes-checkboxes');
        container.textContent = '';
        for (const t of transportadorasCache.filter((t) => t.ativo)) {
            const label = document.createElement('label');
            label.className = 'campo-filtro';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = t.id;
            input.name = 'solicitacao-transportadora';
            label.appendChild(input);
            label.append(` ${t.nomeFantasia ? `${t.nomeRazaoSocial} (${t.nomeFantasia})` : t.nomeRazaoSocial}`);
            container.appendChild(label);
        }
    }
    async function carregarSolicitacoes() {
        if (cotacaoAtualId === null)
            return;
        const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/solicitacoes`);
        const solicitacoes = resposta.ok ? (await resposta.json()).solicitacoes : [];
        const corpo = el('fretes-tabela-solicitacoes-corpo');
        corpo.textContent = '';
        for (const s of solicitacoes) {
            const transportadora = transportadorasCache.find((t) => t.id === s.transportadoraId);
            const tr = document.createElement('tr');
            const celula = (texto) => {
                const td = document.createElement('td');
                td.textContent = texto;
                return td;
            };
            tr.appendChild(celula(transportadora?.nomeRazaoSocial ?? '—'));
            tr.appendChild(celula(ROTULOS_CANAL[s.canal]));
            // Fase 4A.2, seção 33: nunca expõe o motivo técnico bruto (ex.: código HTTP, mensagem
            // do cliente n8n) na tela — só o rótulo de status. O detalhe fica na auditoria/log.
            tr.appendChild(celula(ROTULOS_STATUS_SOLICITACAO[s.status]));
            tr.appendChild(celula(formatarDataHoraOuTraco(s.dataEnvio)));
            tr.appendChild(celula(formatarDataHoraOuTraco(s.dataResposta)));
            const tdAcoes = document.createElement('td');
            if (s.status === 'ERRO') {
                const botaoReenviar = document.createElement('button');
                botaoReenviar.type = 'button';
                botaoReenviar.className = 'botao-secundario';
                botaoReenviar.textContent = 'Reenviar';
                botaoReenviar.addEventListener('click', () => {
                    void (async () => {
                        const respostaReenvio = await fetch(`/api/fretes/solicitacoes/${s.id}/reenviar`, { method: 'POST' });
                        if (!respostaReenvio.ok) {
                            window.alert('Falha ao enviar solicitação ao serviço de automação. Tente novamente em instantes.');
                            return;
                        }
                        void carregarSolicitacoes();
                    })();
                });
                tdAcoes.appendChild(botaoReenviar);
            }
            tr.appendChild(tdAcoes);
            corpo.appendChild(tr);
        }
    }
    const botaoSolicitarCotacao = el('fretes-botao-solicitar-cotacao');
    const erroSolicitacao = el('fretes-solicitacao-erro');
    botaoSolicitarCotacao.addEventListener('click', () => {
        void (async () => {
            if (cotacaoAtualId === null)
                return;
            erroSolicitacao.hidden = true;
            const marcadas = Array.from(document.querySelectorAll('input[name="solicitacao-transportadora"]:checked'));
            const transportadoraIds = marcadas.map((i) => i.value);
            if (transportadoraIds.length === 0) {
                erroSolicitacao.textContent = 'Selecione ao menos uma transportadora.';
                erroSolicitacao.hidden = false;
                return;
            }
            const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/solicitacoes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transportadoraIds, canal: 'EMAIL' }),
            });
            if (!resposta.ok) {
                erroSolicitacao.textContent = await extrairMensagemErro(resposta);
                erroSolicitacao.hidden = false;
                return;
            }
            for (const i of marcadas)
                i.checked = false;
            void carregarSolicitacoes();
        })();
    });
    // --- Fase 4A.1: "Propostas recebidas" — validação humana (seção 17/36/37/38) ---
    async function atualizarBadgePendentes() {
        const resposta = await fetch('/api/fretes/propostas/pendentes');
        if (!resposta.ok)
            return;
        const dados = (await resposta.json());
        const quantidade = dados.pendentesValidacao.length;
        badgePendentes.textContent = String(quantidade);
        badgePendentes.hidden = quantidade === 0;
    }
    async function carregarPropostasRecebidas() {
        const resposta = await fetch('/api/fretes/propostas/pendentes');
        const lista = el('fretes-propostas-recebidas-lista');
        const vazio = el('fretes-propostas-recebidas-vazio');
        lista.textContent = '';
        if (!resposta.ok)
            return;
        const dados = (await resposta.json());
        vazio.hidden = dados.pendentesValidacao.length > 0;
        for (const proposta of dados.pendentesValidacao) {
            lista.appendChild(await construirCardPropostaPendente(proposta));
        }
        const corpoSemProposta = el('fretes-tabela-respostas-sem-proposta-corpo');
        corpoSemProposta.textContent = '';
        for (const r of dados.respostasSemProposta) {
            const tr = document.createElement('tr');
            const celula = (texto) => {
                const td = document.createElement('td');
                td.textContent = texto;
                return td;
            };
            tr.appendChild(celula(ROTULOS_CANAL[r.canal]));
            tr.appendChild(celula(formatarDataHoraOuTraco(r.dataRecebimento)));
            tr.appendChild(celula(r.conteudoBruto ?? '—'));
            corpoSemProposta.appendChild(tr);
        }
        void atualizarBadgePendentes();
    }
    async function construirCardPropostaPendente(proposta) {
        const transportadora = transportadorasCache.find((t) => t.id === proposta.transportadoraId);
        const respostaOrigem = await fetch(`/api/fretes/propostas/${proposta.id}/origem`);
        const origem = respostaOrigem.ok ? (await respostaOrigem.json()) : null;
        const card = document.createElement('section');
        card.className = 'painel-fechamento';
        const titulo = document.createElement('h3');
        titulo.className = 'titulo-secao';
        titulo.textContent = `${transportadora?.nomeRazaoSocial ?? 'Transportadora'} ${proposta.requerRevisao ? '⚠️ requer revisão' : ''}`;
        card.appendChild(titulo);
        if (origem !== null) {
            const mensagem = document.createElement('p');
            mensagem.className = 'filtro-data-legenda';
            mensagem.textContent = `Mensagem original (${ROTULOS_CANAL[origem.resposta.canal]}, ${formatarDataHoraOuTraco(origem.resposta.dataRecebimento)}): ${origem.resposta.conteudoBruto ?? '—'}`;
            card.appendChild(mensagem);
            if (origem.extracao.dadosExtraidos.confianca !== null) {
                const confianca = document.createElement('p');
                confianca.className = 'filtro-data-legenda';
                confianca.textContent = `Confiança da extração: ${Math.round(origem.extracao.dadosExtraidos.confianca * 100)}% (apenas alerta — nunca decide sozinha)`;
                card.appendChild(confianca);
            }
            if (origem.extracao.dadosExtraidos.taxas !== null && origem.extracao.dadosExtraidos.taxas.length > 0) {
                const taxas = document.createElement('p');
                taxas.className = 'filtro-data-legenda';
                taxas.textContent = `Componentes adicionais informados: ${origem.extracao.dadosExtraidos.taxas.map((t) => `${t.nome}: ${formatarMoeda(t.valor)}`).join(', ')} — confira se devem ser somados ao custo abaixo.`;
                card.appendChild(taxas);
            }
        }
        const form = document.createElement('form');
        form.className = 'filtros-relatorio';
        form.autocomplete = 'off';
        const campoCusto = document.createElement('div');
        campoCusto.className = 'campo-filtro';
        campoCusto.innerHTML = '<label>Custo (transportadora)</label>';
        const inputCusto = document.createElement('input');
        inputCusto.type = 'number';
        inputCusto.min = '0';
        inputCusto.step = '0.01';
        inputCusto.value = String(proposta.valorCusto);
        campoCusto.appendChild(inputCusto);
        form.appendChild(campoCusto);
        const campoPrazo = document.createElement('div');
        campoPrazo.className = 'campo-filtro';
        campoPrazo.innerHTML = '<label>Prazo (dias)</label>';
        const inputPrazo = document.createElement('input');
        inputPrazo.type = 'number';
        inputPrazo.min = '0';
        inputPrazo.step = '1';
        inputPrazo.value = proposta.prazoDias !== null ? String(proposta.prazoDias) : '';
        campoPrazo.appendChild(inputPrazo);
        form.appendChild(campoPrazo);
        const campoValidade = document.createElement('div');
        campoValidade.className = 'campo-filtro';
        campoValidade.innerHTML = '<label>Validade</label>';
        const inputValidade = document.createElement('input');
        inputValidade.type = 'date';
        inputValidade.value = proposta.validade ?? '';
        campoValidade.appendChild(inputValidade);
        form.appendChild(campoValidade);
        const campoObs = document.createElement('div');
        campoObs.className = 'campo-filtro campo-filtro-busca';
        campoObs.innerHTML = '<label>Observações</label>';
        const inputObs = document.createElement('input');
        inputObs.type = 'text';
        inputObs.value = proposta.observacoes ?? '';
        campoObs.appendChild(inputObs);
        form.appendChild(campoObs);
        card.appendChild(form);
        const erro = document.createElement('p');
        erro.className = 'painel-login-erro';
        erro.hidden = true;
        card.appendChild(erro);
        const botaoConfirmar = document.createElement('button');
        botaoConfirmar.type = 'button';
        botaoConfirmar.className = 'botao-secundario';
        botaoConfirmar.textContent = 'Confirmar (usa os valores acima)';
        botaoConfirmar.addEventListener('click', () => {
            void (async () => {
                erro.hidden = true;
                const resposta = await fetch(`/api/fretes/propostas/${proposta.id}/validar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        valorCusto: numeroOuNulo(inputCusto.value),
                        prazoDias: numeroOuNulo(inputPrazo.value),
                        validade: textoOuNulo(inputValidade.value),
                        observacoes: textoOuNulo(inputObs.value),
                    }),
                });
                if (!resposta.ok) {
                    erro.textContent = await extrairMensagemErro(resposta);
                    erro.hidden = false;
                    return;
                }
                void carregarPropostasRecebidas();
            })();
        });
        card.appendChild(botaoConfirmar);
        const botaoRejeitar = document.createElement('button');
        botaoRejeitar.type = 'button';
        botaoRejeitar.className = 'botao-secundario';
        botaoRejeitar.textContent = 'Rejeitar';
        botaoRejeitar.addEventListener('click', () => {
            void (async () => {
                const resposta = await fetch(`/api/fretes/propostas/${proposta.id}/rejeitar`, { method: 'POST' });
                if (!resposta.ok) {
                    erro.textContent = await extrairMensagemErro(resposta);
                    erro.hidden = false;
                    return;
                }
                void carregarPropostasRecebidas();
            })();
        });
        card.appendChild(botaoRejeitar);
        return card;
    }
    const formNovaProposta = el('fretes-form-nova-proposta');
    const erroProposta = el('fretes-proposta-erro');
    formNovaProposta.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            if (cotacaoAtualId === null)
                return;
            erroProposta.hidden = true;
            const dadosForm = new FormData(formNovaProposta);
            const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/propostas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transportadoraId: dadosForm.get('transportadoraId'),
                    valorCusto: numeroOuNulo(dadosForm.get('valorCusto')),
                    prazoDias: numeroOuNulo(dadosForm.get('prazoDias')),
                    validade: textoOuNulo(dadosForm.get('validade')),
                    tipoServico: textoOuNulo(dadosForm.get('tipoServico')),
                    observacoes: textoOuNulo(dadosForm.get('observacoes')),
                }),
            });
            if (!resposta.ok) {
                erroProposta.textContent = await extrairMensagemErro(resposta);
                erroProposta.hidden = false;
                return;
            }
            formNovaProposta.reset();
            void carregarDetalheCotacao();
        })();
    });
    // --- Fechamento ----------------------------------------------------------
    let custoDaPropostaSelecionada = 0;
    function atualizarPreviewFechamento(custo) {
        custoDaPropostaSelecionada = custo;
        const resumo = el('fretes-fechamento-resumo');
        resumo.textContent = '';
        const linhaCusto = document.createElement('div');
        linhaCusto.innerHTML = '';
        const rotuloCusto = document.createElement('span');
        rotuloCusto.className = 'metrica-rotulo';
        rotuloCusto.textContent = 'Custo do frete';
        const valorCusto = document.createElement('span');
        valorCusto.className = 'metrica-valor';
        valorCusto.textContent = formatarMoeda(custo);
        linhaCusto.appendChild(rotuloCusto);
        linhaCusto.appendChild(valorCusto);
        resumo.appendChild(linhaCusto);
        recalcularPreview();
    }
    /** Custo base do fechamento: fixo (proposta selecionada) para TRANSPORTADORA, editável (custo interno) para VEICULO_PROPRIO. */
    function obterCustoBaseAtual() {
        if (modalidadeExecucaoAtual === 'VEICULO_PROPRIO') {
            return Number(el('fretes-fechamento-custo-manual').value || '0');
        }
        return custoDaPropostaSelecionada;
    }
    function recalcularPreview() {
        const custoBase = obterCustoBaseAtual();
        const modoPercentual = document.querySelector('input[name="modoCalculo"]:checked')?.value !== 'VALOR_FINAL';
        const campoPercentual = el('fretes-fechamento-campo-percentual');
        const campoValorFinal = el('fretes-fechamento-campo-valor-final');
        campoPercentual.hidden = !modoPercentual;
        campoValorFinal.hidden = modoPercentual;
        const preview = el('fretes-fechamento-preview');
        if (modoPercentual) {
            const percentual = Number(el('fretes-fechamento-percentual').value || '0');
            const acrescimo = Math.round(custoBase * (percentual / 100) * 100) / 100;
            const total = Math.round((custoBase + acrescimo) * 100) / 100;
            preview.textContent = `Acréscimo: ${formatarMoeda(acrescimo)} • Frete para o cliente: ${formatarMoeda(total)}`;
        }
        else {
            const valorFinal = Number(el('fretes-fechamento-valor-final').value || '0');
            const percentual = custoBase === 0 ? 0 : (valorFinal / custoBase - 1) * 100;
            preview.textContent = `Acréscimo implícito: ${formatarPercentual(Math.round(percentual * 100) / 100)} (conferência — o custo original não é alterado)`;
        }
    }
    Array.from(document.querySelectorAll('input[name="modoCalculo"]')).forEach((radio) => {
        radio.addEventListener('change', recalcularPreview);
    });
    el('fretes-fechamento-percentual').addEventListener('input', recalcularPreview);
    el('fretes-fechamento-valor-final').addEventListener('input', recalcularPreview);
    el('fretes-fechamento-custo-manual').addEventListener('input', recalcularPreview);
    function renderizarFechamentoConcluido(fechamento) {
        const container = el('fretes-fechamento-concluido');
        container.textContent = '';
        const linhas = [
            ['Modalidade', ROTULOS_MODALIDADE_EXECUCAO[fechamento.modalidadeExecucao]],
            ...(fechamento.motoristaNome !== null ? [['Motorista', fechamento.motoristaNome]] : []),
            ['Custo do frete', formatarMoeda(fechamento.custoFrete)],
            ['Acréscimo', formatarPercentual(fechamento.percentualAcrescimo)],
            ['Valor do acréscimo', formatarMoeda(fechamento.valorAcrescimo)],
            ['Frete para o cliente', formatarMoeda(fechamento.valorFreteCliente)],
        ];
        for (const [rotulo, valor] of linhas) {
            const div = document.createElement('div');
            const spanRotulo = document.createElement('span');
            spanRotulo.className = 'metrica-rotulo';
            spanRotulo.textContent = rotulo;
            const spanValor = document.createElement('span');
            spanValor.className = 'metrica-valor valor-destaque-frete';
            spanValor.textContent = valor;
            div.appendChild(spanRotulo);
            div.appendChild(spanValor);
            container.appendChild(div);
        }
    }
    const formFechamento = el('fretes-form-fechamento');
    const erroFechamento = el('fretes-fechamento-erro');
    formFechamento.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            if (cotacaoAtualId === null)
                return;
            const mensagemConfirmacao = modalidadeExecucaoAtual === 'RETIRA'
                ? 'Confirmar a retirada desta cotação (frete R$ 0,00)? Depois de fechada, não pode ser reaberta nesta fase.'
                : 'Confirmar o fechamento deste frete? Depois de fechada, a cotação não pode ser reaberta nesta fase.';
            if (!window.confirm(mensagemConfirmacao))
                return;
            erroFechamento.hidden = true;
            const corpo = {
                observacoes: textoOuNulo(el('fretes-fechamento-observacoes').value),
            };
            if (modalidadeExecucaoAtual === 'VEICULO_PROPRIO') {
                corpo.custoManual = Number(el('fretes-fechamento-custo-manual').value || '0');
            }
            if (modalidadeExecucaoAtual !== 'RETIRA') {
                const modoPercentual = document.querySelector('input[name="modoCalculo"]:checked')?.value !== 'VALOR_FINAL';
                if (modoPercentual) {
                    corpo.percentualAcrescimo = Number(el('fretes-fechamento-percentual').value || '0');
                }
                else {
                    corpo.valorFreteClienteInformado = Number(el('fretes-fechamento-valor-final').value || '0');
                }
            }
            const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/fechamento`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo),
            });
            if (!resposta.ok) {
                erroFechamento.textContent = await extrairMensagemErro(resposta);
                erroFechamento.hidden = false;
                return;
            }
            void carregarDetalheCotacao();
            void carregarDashboard();
        })();
    });
    el('fretes-detalhe-voltar').addEventListener('click', () => {
        cotacaoAtualId = null;
        mostrarSubAba('cotacoes');
        void carregarCotacoes();
    });
    // --- Importar do Pedido Omie (Fase 3.2) -----------------------------------
    const formBuscarPedidoOmie = el('fretes-form-buscar-pedido-omie');
    const carregandoImportarOmie = el('fretes-importar-omie-carregando');
    const erroImportarOmie = el('fretes-importar-omie-erro');
    const previewImportarOmie = el('fretes-importar-omie-preview');
    const avisoDuplicidade = el('fretes-importar-aviso-duplicidade');
    const formDestinoManual = el('fretes-form-destino-manual');
    const botaoAlterarDestino = el('fretes-importar-botao-alterar-destino');
    const campoVeiculoImportar = el('fretes-importar-campo-veiculo');
    const campoMotoristaImportar = el('fretes-importar-campo-motorista');
    const campoCustoManualImportar = el('fretes-importar-campo-custo-manual');
    const selectVeiculoImportar = el('fretes-importar-veiculo');
    const formConfirmarImportacao = el('fretes-form-confirmar-importacao');
    const erroConfirmarImportacao = el('fretes-importar-confirmar-erro');
    function textoOuTraco(valor) {
        return valor === null || valor.trim() === '' ? '—' : valor;
    }
    function linhaInfo(container, rotulo, valor) {
        const div = document.createElement('div');
        const spanRotulo = document.createElement('span');
        spanRotulo.className = 'metrica-rotulo';
        spanRotulo.textContent = rotulo;
        const spanValor = document.createElement('span');
        spanValor.className = 'metrica-valor';
        spanValor.textContent = valor;
        div.appendChild(spanRotulo);
        div.appendChild(spanValor);
        container.appendChild(div);
    }
    /** Mostra só os campos relevantes pra cada modalidade — mesmo padrão do formulário manual de cotação (seção 13/15/16). */
    function atualizarCamposImportarPorModalidadeExecucao() {
        const modalidade = document.querySelector('#fretes-importar-modalidade-execucao-fieldset input[name="modalidadeExecucao"]:checked')
            ?.value;
        const ehVeiculoProprio = modalidade === 'VEICULO_PROPRIO';
        campoVeiculoImportar.hidden = !ehVeiculoProprio;
        campoMotoristaImportar.hidden = !ehVeiculoProprio;
        campoCustoManualImportar.hidden = !ehVeiculoProprio;
        selectVeiculoImportar.required = ehVeiculoProprio;
    }
    Array.from(document.querySelectorAll('#fretes-importar-modalidade-execucao-fieldset input[name="modalidadeExecucao"]')).forEach((radio) => {
        radio.addEventListener('change', atualizarCamposImportarPorModalidadeExecucao);
    });
    atualizarCamposImportarPorModalidadeExecucao();
    function preencherFormDestinoManual(destino) {
        el('fretes-importar-destino-cep').value = destino?.cep ?? '';
        el('fretes-importar-destino-logradouro').value = destino?.logradouro ?? '';
        el('fretes-importar-destino-numero').value = destino?.numero ?? '';
        el('fretes-importar-destino-complemento').value = destino?.complemento ?? '';
        el('fretes-importar-destino-bairro').value = destino?.bairro ?? '';
        el('fretes-importar-destino-cidade').value = destino?.cidade ?? '';
        el('fretes-importar-destino-uf').value = destino?.uf ?? '';
    }
    botaoAlterarDestino.addEventListener('click', () => {
        formDestinoManual.hidden = !formDestinoManual.hidden;
        if (!formDestinoManual.hidden)
            preencherFormDestinoManual(preparacaoOmieAtual?.destino ?? null);
    });
    function renderizarPreviewImportacao(preparacao) {
        const infoPedido = el('fretes-importar-pedido-info');
        infoPedido.textContent = '';
        linhaInfo(infoPedido, 'Número do pedido', preparacao.pedidoOmieNumero);
        linhaInfo(infoPedido, 'Cliente', textoOuTraco(preparacao.clienteNome));
        linhaInfo(infoPedido, 'Vendedor (código Omie)', preparacao.vendedorOmieId !== null ? String(preparacao.vendedorOmieId) : '—');
        linhaInfo(infoPedido, 'Valor total do pedido', formatarMoeda(preparacao.valorTotalPedido));
        if (preparacao.cotacoesExistentes.length > 0) {
            avisoDuplicidade.textContent = `Este pedido já possui ${preparacao.cotacoesExistentes.length} cotação(ões) de frete: ${preparacao.cotacoesExistentes.map((c) => `${c.codigo} (${ROTULOS_STATUS_COTACAO[c.status]})`).join(', ')}. Você ainda pode continuar — isso é só um aviso.`;
            avisoDuplicidade.hidden = false;
        }
        else {
            avisoDuplicidade.hidden = true;
        }
        const rotuloOrigem = el('fretes-importar-destino-origem');
        const infoDestino = el('fretes-importar-destino-info');
        infoDestino.textContent = '';
        if (preparacao.destino === null) {
            rotuloOrigem.textContent = 'Origem do destino: nenhum endereço encontrado automaticamente — informe manualmente abaixo.';
            formDestinoManual.hidden = false;
            preencherFormDestinoManual(null);
        }
        else {
            rotuloOrigem.textContent = `Origem do destino: ${ROTULOS_ORIGEM_DESTINO[preparacao.destino.origem]}`;
            linhaInfo(infoDestino, 'CEP', textoOuTraco(preparacao.destino.cep));
            linhaInfo(infoDestino, 'Endereço', textoOuTraco(preparacao.destino.logradouro));
            linhaInfo(infoDestino, 'Número', textoOuTraco(preparacao.destino.numero));
            linhaInfo(infoDestino, 'Complemento', textoOuTraco(preparacao.destino.complemento));
            linhaInfo(infoDestino, 'Bairro', textoOuTraco(preparacao.destino.bairro));
            linhaInfo(infoDestino, 'Cidade/UF', preparacao.destino.cidade !== null || preparacao.destino.uf !== null ? `${textoOuTraco(preparacao.destino.cidade)}/${textoOuTraco(preparacao.destino.uf)}` : '—');
            formDestinoManual.hidden = true;
        }
        const infoLogistica = el('fretes-importar-logistica-info');
        infoLogistica.textContent = '';
        linhaInfo(infoLogistica, 'Peso bruto', preparacao.logistica.pesoBruto !== null ? `${preparacao.logistica.pesoBruto} kg` : 'Não informado');
        linhaInfo(infoLogistica, 'Peso líquido', preparacao.logistica.pesoLiquido !== null ? `${preparacao.logistica.pesoLiquido} kg` : 'Não informado');
        linhaInfo(infoLogistica, 'Volumes', preparacao.logistica.quantidadeVolumes !== null ? String(preparacao.logistica.quantidadeVolumes) : 'Não informado');
        linhaInfo(infoLogistica, 'Espécie', textoOuTraco(preparacao.logistica.especieVolumes) === '—' ? 'Não informado' : preparacao.logistica.especieVolumes);
        linhaInfo(infoLogistica, 'CIF/FOB (Omie)', textoOuTraco(preparacao.logistica.cifFobOmie) === '—' ? 'Não informado' : preparacao.logistica.cifFobOmie);
        linhaInfo(infoLogistica, 'Transportadora vinculada na Omie (código)', preparacao.logistica.transportadoraOmieCodigo !== null ? String(preparacao.logistica.transportadoraOmieCodigo) : 'Não informado');
        const corpoItens = el('fretes-importar-tabela-itens-corpo');
        corpoItens.textContent = '';
        for (const item of preparacao.itens) {
            const tr = document.createElement('tr');
            const tdCodigo = document.createElement('td');
            tdCodigo.textContent = item.codigo;
            const tdDescricao = document.createElement('td');
            tdDescricao.textContent = item.descricao;
            const tdQuantidade = document.createElement('td');
            tdQuantidade.className = 'col-num';
            tdQuantidade.textContent = String(item.quantidade);
            tr.appendChild(tdCodigo);
            tr.appendChild(tdDescricao);
            tr.appendChild(tdQuantidade);
            corpoItens.appendChild(tr);
        }
        el('fretes-importar-valor-mercadoria').value = String(preparacao.valorTotalPedido);
        previewImportarOmie.hidden = false;
    }
    formBuscarPedidoOmie.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            erroImportarOmie.hidden = true;
            previewImportarOmie.hidden = true;
            const numero = textoOuNulo(new FormData(formBuscarPedidoOmie).get('numeroPedido'));
            if (numero === null)
                return;
            carregandoImportarOmie.hidden = false;
            el('fretes-importar-botao-buscar').disabled = true;
            try {
                const resposta = await fetch(`/api/fretes/omie/pedidos/${encodeURIComponent(numero)}/preparar`);
                if (!resposta.ok) {
                    erroImportarOmie.textContent = await extrairMensagemErro(resposta);
                    erroImportarOmie.hidden = false;
                    preparacaoOmieAtual = null;
                    numeroPedidoOmieAtual = null;
                    return;
                }
                const preparacao = (await resposta.json());
                preparacaoOmieAtual = preparacao;
                numeroPedidoOmieAtual = numero;
                renderizarPreviewImportacao(preparacao);
            }
            finally {
                carregandoImportarOmie.hidden = true;
                el('fretes-importar-botao-buscar').disabled = false;
            }
        })();
    });
    formConfirmarImportacao.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            if (numeroPedidoOmieAtual === null)
                return;
            erroConfirmarImportacao.hidden = true;
            const dadosForm = new FormData(formConfirmarImportacao);
            let destinoOverride = null;
            if (!formDestinoManual.hidden) {
                const dadosDestino = new FormData(formDestinoManual);
                destinoOverride = {
                    cep: textoOuNulo(dadosDestino.get('cep')),
                    logradouro: textoOuNulo(dadosDestino.get('logradouro')),
                    numero: textoOuNulo(dadosDestino.get('numero')),
                    complemento: textoOuNulo(dadosDestino.get('complemento')),
                    bairro: textoOuNulo(dadosDestino.get('bairro')),
                    cidade: textoOuNulo(dadosDestino.get('cidade')),
                    uf: textoOuNulo(dadosDestino.get('uf')),
                };
            }
            const resposta = await fetch(`/api/fretes/omie/pedidos/${encodeURIComponent(numeroPedidoOmieAtual)}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinoOverride,
                    modalidade: dadosForm.get('modalidade'),
                    modalidadeExecucao: dadosForm.get('modalidadeExecucao'),
                    veiculoId: textoOuNulo(dadosForm.get('veiculoId')),
                    motoristaNome: textoOuNulo(dadosForm.get('motoristaNome')),
                    custoManual: numeroOuNulo(dadosForm.get('custoManual')),
                    valorMercadoria: numeroOuNulo(dadosForm.get('valorMercadoria')),
                    observacoes: textoOuNulo(dadosForm.get('observacoes')),
                }),
            });
            if (!resposta.ok) {
                erroConfirmarImportacao.textContent = await extrairMensagemErro(resposta);
                erroConfirmarImportacao.hidden = false;
                return;
            }
            const cotacao = (await resposta.json());
            formBuscarPedidoOmie.reset();
            formConfirmarImportacao.reset();
            previewImportarOmie.hidden = true;
            preparacaoOmieAtual = null;
            numeroPedidoOmieAtual = null;
            void abrirDetalheCotacao(cotacao.id);
        })();
    });
    // --- Navegação entre sub-abas ---------------------------------------
    abaDashboard.addEventListener('click', () => {
        mostrarSubAba('dashboard');
        void carregarDashboard();
    });
    abaCotacoes.addEventListener('click', () => {
        mostrarSubAba('cotacoes');
        void carregarCotacoes();
    });
    abaImportarOmie.addEventListener('click', () => {
        mostrarSubAba('importar-omie');
    });
    abaTransportadoras.addEventListener('click', () => {
        mostrarSubAba('transportadoras');
        void carregarTransportadoras();
    });
    abaVeiculos.addEventListener('click', () => {
        mostrarSubAba('veiculos');
        void carregarVeiculos();
    });
    abaPropostasRecebidas.addEventListener('click', () => {
        mostrarSubAba('propostas-recebidas');
        void carregarPropostasRecebidas();
    });
    return {
        ativar() {
            if (ativado)
                return;
            ativado = true;
            mostrarSubAba('dashboard');
            void carregarDashboard();
            void carregarTransportadoras();
            void carregarVeiculos();
            void atualizarBadgePendentes();
        },
    };
}
