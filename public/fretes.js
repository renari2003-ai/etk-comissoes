/**
 * Painel "Fretes" (Fase 1) — só carregado/ativado para quem tem a permissão `fretes`
 * (ver `auth.ts`). Fluxo: cotação → propostas (manuais) → comparação → seleção manual →
 * fechamento (acréscimo sempre informado pelo usuário, nunca automático). Mesmo padrão
 * estrutural de `usuarios.ts`/`relatorios.ts`: `{ ativar }` plugado pelo `app.ts`.
 */
import { formatarMoeda, formatarPercentual } from './formatacao.js';
import { obterUsuarioLogado } from './auth.js';
const ROTULOS_STATUS_REVISAO = {
    AGUARDANDO_LOGISTICA: 'Aguardando triagem',
    LIBERADA: 'Liberada para o vendedor',
    DESCARTADA: 'Descartada pela Logística',
    EM_NEGOCIACAO: 'Em negociação',
    ESCOLHIDA: 'Frete escolhido',
};
const ROTULOS_CANAL = {
    EMAIL: 'E-mail',
    WHATSAPP: 'WhatsApp',
    MANUAL: 'Manual',
    API: 'API',
    OUTRO: 'Outro',
};
/** Arquitetura de canais — Fase 1 (só cadastro/exibição, ver `Transportadora.canalPrincipal`). */
const ROTULOS_CANAL_PRINCIPAL_TRANSPORTADORA = {
    EMAIL: 'E-mail',
    WHATSAPP: 'WhatsApp',
    SITE: 'Site',
    API: 'API',
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
    const abaCentralLogistica = el('fretes-aba-central-logistica');
    const abaCentralVendedor = el('fretes-aba-central-vendedor');
    const abaAprovacoesValorMinimo = el('fretes-aba-aprovacoes-valor-minimo');
    const abaHistoricoCliente = el('fretes-aba-historico-cliente');
    const secaoDashboard = el('fretes-secao-dashboard');
    const secaoCotacoes = el('fretes-secao-cotacoes');
    const secaoImportarOmie = el('fretes-secao-importar-omie');
    const secaoDetalhe = el('fretes-secao-detalhe');
    const secaoTransportadoras = el('fretes-secao-transportadoras');
    const secaoVeiculos = el('fretes-secao-veiculos');
    const secaoPropostasRecebidas = el('fretes-secao-propostas-recebidas');
    const secaoCentralLogistica = el('fretes-secao-central-logistica');
    const secaoCentralVendedor = el('fretes-secao-central-vendedor');
    const secaoAprovacoesValorMinimo = el('fretes-secao-aprovacoes-valor-minimo');
    const secaoHistoricoCliente = el('fretes-secao-historico-cliente');
    const secaoParametrosFiscais = el('fretes-secao-parametros-fiscais');
    const badgePendentes = el('fretes-badge-pendentes');
    let ativado = false;
    let transportadorasCache = [];
    let veiculosCache = [];
    let cotacaoAtualId = null;
    let modalidadeExecucaoAtual = 'TRANSPORTADORA';
    let preparacaoOmieAtual = null;
    let numeroPedidoOmieAtual = null;
    let tipoDocumentoOmieAtual = 'PEDIDO';
    // Fase 4A.8 — histórico por cliente.
    let clienteHistoricoSelecionado = null;
    let paginaHistoricoAtual = 1;
    let totalPaginasHistorico = 1;
    const TAMANHO_PAGINA_HISTORICO = 25;
    function mostrarSubAba(sub) {
        secaoDashboard.hidden = sub !== 'dashboard';
        secaoCotacoes.hidden = sub !== 'cotacoes';
        secaoImportarOmie.hidden = sub !== 'importar-omie';
        secaoDetalhe.hidden = sub !== 'detalhe';
        secaoTransportadoras.hidden = sub !== 'transportadoras';
        secaoVeiculos.hidden = sub !== 'veiculos';
        secaoPropostasRecebidas.hidden = sub !== 'propostas-recebidas';
        secaoCentralLogistica.hidden = sub !== 'central-logistica';
        secaoCentralVendedor.hidden = sub !== 'central-vendedor';
        secaoAprovacoesValorMinimo.hidden = sub !== 'aprovacoes-valor-minimo';
        secaoHistoricoCliente.hidden = sub !== 'historico-cliente';
        abaDashboard.classList.toggle('aba-ativa', sub === 'dashboard');
        abaCotacoes.classList.toggle('aba-ativa', sub === 'cotacoes' || sub === 'detalhe');
        abaImportarOmie.classList.toggle('aba-ativa', sub === 'importar-omie');
        abaTransportadoras.classList.toggle('aba-ativa', sub === 'transportadoras');
        abaVeiculos.classList.toggle('aba-ativa', sub === 'veiculos');
        abaPropostasRecebidas.classList.toggle('aba-ativa', sub === 'propostas-recebidas');
        abaCentralLogistica.classList.toggle('aba-ativa', sub === 'central-logistica');
        abaCentralVendedor.classList.toggle('aba-ativa', sub === 'central-vendedor');
        abaAprovacoesValorMinimo.classList.toggle('aba-ativa', sub === 'aprovacoes-valor-minimo');
        abaHistoricoCliente.classList.toggle('aba-ativa', sub === 'historico-cliente');
    }
    // --- Fase 4A.6 — Central da Logística + Central do Vendedor ---------------
    /** Abas visíveis só pra quem tem a permissão de "porta" — administrador sempre vê tudo. */
    function aplicarVisibilidadeCentrais() {
        const usuarioLogado = obterUsuarioLogado();
        const admin = usuarioLogado?.papel === 'administrador';
        abaCentralLogistica.hidden = !(admin || usuarioLogado?.permissoes.fretesLogistica);
        abaCentralVendedor.hidden = !(admin || usuarioLogado?.permissoes.fretesComercial);
        // Fase 4A.7 — aprovações e parâmetros fiscais.
        abaAprovacoesValorMinimo.hidden = !(admin || usuarioLogado?.permissoes.fretesGerencia);
        secaoParametrosFiscais.hidden = !admin;
        // Fase 4A.8 — histórico por cliente: mesma "porta" de acesso do backend (fretesComercial
        // OU fretesGerencia); o filtro de vendedor só aparece pra quem tem visão ampliada.
        const visaoAmpliadaHistorico = admin || usuarioLogado?.permissoes.fretesGerencia === true;
        abaHistoricoCliente.hidden = !(visaoAmpliadaHistorico || usuarioLogado?.permissoes.fretesComercial);
        const campoFiltroVendedor = document.getElementById('fretes-historico-filtro-vendedor-campo');
        if (campoFiltroVendedor !== null)
            campoFiltroVendedor.hidden = !visaoAmpliadaHistorico;
    }
    function formatarPrazo(prazoDias) {
        return prazoDias !== null ? `${prazoDias} dia(s)` : '—';
    }
    async function carregarCentralLogistica() {
        const corpo = el('fretes-tabela-central-logistica-corpo');
        const vazio = el('fretes-central-logistica-vazio');
        corpo.textContent = '';
        const resposta = await fetch('/api/fretes/central-logistica');
        if (!resposta.ok) {
            vazio.textContent = await extrairMensagemErro(resposta);
            vazio.hidden = false;
            return;
        }
        const dados = (await resposta.json());
        const pendentes = dados.linhas.filter((l) => l.proposta.statusRevisao === 'AGUARDANDO_LOGISTICA');
        vazio.hidden = pendentes.length > 0;
        const celula = (texto) => {
            const td = document.createElement('td');
            td.textContent = texto;
            return td;
        };
        for (const linha of pendentes) {
            const tr = document.createElement('tr');
            tr.appendChild(celula(linha.cotacao.codigo));
            tr.appendChild(celula(linha.cotacao.clienteNomeSnapshot ?? '—'));
            tr.appendChild(celula(linha.cotacao.vendedorOmieId !== null ? String(linha.cotacao.vendedorOmieId) : '—'));
            tr.appendChild(celula(linha.transportadora.nomeRazaoSocial));
            tr.appendChild(celula(formatarMoeda(linha.proposta.valorCusto)));
            tr.appendChild(celula(formatarPrazo(linha.proposta.prazoDias)));
            tr.appendChild(celula(ROTULOS_CANAL[linha.proposta.origemProposta] ?? linha.proposta.origemProposta));
            tr.appendChild(celula(ROTULOS_STATUS_REVISAO[linha.proposta.statusRevisao]));
            tr.appendChild(celula(new Date(linha.proposta.criadoEm).toLocaleString('pt-BR')));
            const tdAcoes = document.createElement('td');
            const botaoLiberar = document.createElement('button');
            botaoLiberar.type = 'button';
            botaoLiberar.className = 'botao-secundario';
            botaoLiberar.textContent = 'Liberar ao vendedor';
            botaoLiberar.addEventListener('click', () => {
                void (async () => {
                    const resp = await fetch(`/api/fretes/propostas/${linha.proposta.id}/liberar`, { method: 'POST' });
                    if (!resp.ok) {
                        window.alert(await extrairMensagemErro(resp));
                        return;
                    }
                    void carregarCentralLogistica();
                })();
            });
            const botaoDescartar = document.createElement('button');
            botaoDescartar.type = 'button';
            botaoDescartar.className = 'botao-secundario';
            botaoDescartar.textContent = 'Descartar';
            botaoDescartar.addEventListener('click', () => {
                void (async () => {
                    if (!window.confirm('Descartar esta proposta na triagem? O vendedor nunca vai vê-la.'))
                        return;
                    const resp = await fetch(`/api/fretes/propostas/${linha.proposta.id}/descartar`, { method: 'POST' });
                    if (!resp.ok) {
                        window.alert(await extrairMensagemErro(resp));
                        return;
                    }
                    void carregarCentralLogistica();
                })();
            });
            tdAcoes.appendChild(botaoLiberar);
            tdAcoes.appendChild(botaoDescartar);
            tr.appendChild(tdAcoes);
            corpo.appendChild(tr);
        }
    }
    /** Fase 4A.7 — só usado para montar o corpo de `substituicao` já existente da Fase 4A.6 (reaproveitado aqui). */
    function perguntarMotivoSubstituicao(ehResponsavel) {
        if (ehResponsavel)
            return undefined;
        const motivo = window.prompt('Este frete pertence a outro vendedor. Você está prestes a agir em SUBSTITUIÇÃO ao vendedor responsável — informe o motivo:');
        if (motivo === null)
            return 'cancelado';
        if (motivo.trim() === '') {
            window.alert('A ação em substituição exige um motivo.');
            return 'cancelado';
        }
        return { motivo: motivo.trim() };
    }
    /**
     * Fase 4A.7 (ajuste — simplificação): "Escolher frete" — sem pedir acréscimo comercial
     * nesta tela (sempre 0% aqui; o valor final ao cliente permanece um conceito do backend,
     * só não é pedido/exibido neste fluxo). Se o valor ficar abaixo do mínimo, bloqueia a
     * confirmação normal e oferece solicitar aprovação gerencial — nunca aprova sozinho.
     */
    async function escolherFrete(linha, preview, ehResponsavel) {
        const resumoValores = preview !== null
            ? `Frete base: ${formatarMoeda(preview.freteBase)}\nValor mínimo: ${formatarMoeda(preview.valorMinimo)}\n\n`
            : '';
        const substituicaoOuCancelado = perguntarMotivoSubstituicao(ehResponsavel);
        if (substituicaoOuCancelado === 'cancelado')
            return;
        const substituicao = substituicaoOuCancelado === undefined ? undefined : { substituicao: substituicaoOuCancelado };
        if (!window.confirm(`${resumoValores}Confirmar a escolha deste frete?`))
            return;
        const resp = await fetch(`/api/fretes/cotacoes/${linha.cotacao.id}/propostas/${linha.proposta.id}/composicao`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acrescimoPercentual: 0, ...substituicao }),
        });
        if (resp.ok) {
            void carregarCentralVendedor();
            return;
        }
        const mensagem = await extrairMensagemErro(resp);
        if (!mensagem.includes('abaixo do mínimo')) {
            window.alert(mensagem);
            return;
        }
        // Bloqueado — oferece solicitar aprovação gerencial (nunca aprova/escolhe sozinho).
        if (!window.confirm(`${mensagem}\n\nSolicitar aprovação da gerência para este valor?`))
            return;
        const motivoAprovacao = window.prompt('Motivo da solicitação de aprovação (valor abaixo do mínimo):');
        if (motivoAprovacao === null || motivoAprovacao.trim() === '') {
            if (motivoAprovacao !== null)
                window.alert('A solicitação de aprovação exige um motivo.');
            return;
        }
        const respAprovacao = await fetch(`/api/fretes/cotacoes/${linha.cotacao.id}/propostas/${linha.proposta.id}/composicao/solicitar-aprovacao`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acrescimoPercentual: 0, motivo: motivoAprovacao.trim() }),
        });
        if (!respAprovacao.ok) {
            window.alert(await extrairMensagemErro(respAprovacao));
            return;
        }
        window.alert('Solicitação de aprovação enviada à gerência.');
        void carregarCentralVendedor();
    }
    async function carregarCentralVendedor() {
        const corpo = el('fretes-tabela-central-vendedor-corpo');
        const vazio = el('fretes-central-vendedor-vazio');
        corpo.textContent = '';
        const resposta = await fetch('/api/fretes/central-vendedor');
        if (!resposta.ok) {
            vazio.textContent = await extrairMensagemErro(resposta);
            vazio.hidden = false;
            return;
        }
        const dados = (await resposta.json());
        vazio.hidden = dados.linhas.length > 0;
        const celula = (texto) => {
            const td = document.createElement('td');
            td.textContent = texto;
            return td;
        };
        for (const linha of dados.linhas) {
            const tr = document.createElement('tr');
            tr.appendChild(celula(linha.cotacao.codigo));
            tr.appendChild(celula(linha.cotacao.clienteNomeSnapshot ?? '—'));
            tr.appendChild(celula(linha.transportadora.nomeRazaoSocial));
            tr.appendChild(celula(formatarMoeda(linha.proposta.valorCusto)));
            // Fase 4A.7 (ajuste — "valor mínimo automático"): busca o preview assim que a linha é
            // renderizada, sem exigir nenhuma ação do vendedor. Se os parâmetros fiscais ainda não
            // estiverem configurados, mostra o erro exato devolvido pelo backend nesta célula —
            // nunca assume 0%.
            const tdValorMinimo = celula('Calculando…');
            let previewCarregado = null;
            const promessaPreview = fetch(`/api/fretes/propostas/${linha.proposta.id}/composicao-preview`)
                .then(async (r) => {
                if (!r.ok) {
                    tdValorMinimo.textContent = await extrairMensagemErro(r);
                    return null;
                }
                const preview = (await r.json());
                tdValorMinimo.textContent = formatarMoeda(preview.valorMinimo);
                return preview;
            })
                .catch(() => {
                tdValorMinimo.textContent = 'Erro ao calcular o valor mínimo.';
                return null;
            })
                .then((preview) => {
                previewCarregado = preview;
                return preview;
            });
            tr.appendChild(tdValorMinimo);
            tr.appendChild(celula(formatarPrazo(linha.proposta.prazoDias)));
            tr.appendChild(celula(ROTULOS_STATUS_REVISAO[linha.proposta.statusRevisao]));
            const tdAcoes = document.createElement('td');
            const ehResponsavel = obterUsuarioLogado()?.vendedorOmieId !== null && obterUsuarioLogado()?.vendedorOmieId === linha.cotacao.vendedorOmieId;
            if (linha.proposta.statusRevisao === 'LIBERADA') {
                const botaoNegociar = document.createElement('button');
                botaoNegociar.type = 'button';
                botaoNegociar.className = 'botao-secundario';
                botaoNegociar.textContent = 'Marcar em negociação';
                botaoNegociar.addEventListener('click', () => {
                    void (async () => {
                        const resp = await fetch(`/api/fretes/cotacoes/${linha.cotacao.id}/propostas/${linha.proposta.id}/negociar`, { method: 'POST' });
                        if (!resp.ok) {
                            window.alert(await extrairMensagemErro(resp));
                            return;
                        }
                        void carregarCentralVendedor();
                    })();
                });
                tdAcoes.appendChild(botaoNegociar);
            }
            if (linha.proposta.statusRevisao === 'LIBERADA' || linha.proposta.statusRevisao === 'EM_NEGOCIACAO') {
                const botaoEscolher = document.createElement('button');
                botaoEscolher.type = 'button';
                botaoEscolher.className = 'botao-secundario';
                botaoEscolher.textContent = 'Escolher frete';
                botaoEscolher.addEventListener('click', () => {
                    void (async () => {
                        await promessaPreview;
                        void escolherFrete(linha, previewCarregado, ehResponsavel);
                    })();
                });
                tdAcoes.appendChild(botaoEscolher);
            }
            tr.appendChild(tdAcoes);
            corpo.appendChild(tr);
        }
    }
    // --- Fase 4A.7 — Aprovações de valor abaixo do mínimo (gerência) ----------
    async function carregarAprovacoesValorMinimo() {
        const corpo = el('fretes-tabela-aprovacoes-valor-minimo-corpo');
        const vazio = el('fretes-aprovacoes-valor-minimo-vazio');
        corpo.textContent = '';
        const resposta = await fetch('/api/fretes/aprovacoes-valor-minimo');
        if (!resposta.ok) {
            vazio.textContent = await extrairMensagemErro(resposta);
            vazio.hidden = false;
            return;
        }
        const dados = (await resposta.json());
        vazio.hidden = dados.aprovacoes.length > 0;
        const celula = (texto) => {
            const td = document.createElement('td');
            td.textContent = texto;
            return td;
        };
        for (const aprovacao of dados.aprovacoes) {
            const tr = document.createElement('tr');
            tr.appendChild(celula(aprovacao.cotacaoId));
            tr.appendChild(celula(formatarMoeda(aprovacao.valorMinimo)));
            tr.appendChild(celula(formatarMoeda(aprovacao.valorProposto)));
            tr.appendChild(celula(formatarMoeda(aprovacao.diferenca)));
            tr.appendChild(celula(aprovacao.motivo));
            tr.appendChild(celula(new Date(aprovacao.criadoEm).toLocaleString('pt-BR')));
            const tdAcoes = document.createElement('td');
            const botaoAprovar = document.createElement('button');
            botaoAprovar.type = 'button';
            botaoAprovar.className = 'botao-secundario';
            botaoAprovar.textContent = 'Aprovar';
            botaoAprovar.addEventListener('click', () => {
                void (async () => {
                    if (!window.confirm(`Aprovar o valor de ${formatarMoeda(aprovacao.valorProposto)} (abaixo do mínimo de ${formatarMoeda(aprovacao.valorMinimo)})?`))
                        return;
                    const resp = await fetch(`/api/fretes/aprovacoes-valor-minimo/${aprovacao.id}/aprovar`, { method: 'POST' });
                    if (!resp.ok) {
                        window.alert(await extrairMensagemErro(resp));
                        return;
                    }
                    void carregarAprovacoesValorMinimo();
                })();
            });
            const botaoRejeitar = document.createElement('button');
            botaoRejeitar.type = 'button';
            botaoRejeitar.className = 'botao-secundario';
            botaoRejeitar.textContent = 'Rejeitar';
            botaoRejeitar.addEventListener('click', () => {
                void (async () => {
                    if (!window.confirm('Rejeitar esta solicitação? A proposta continua liberada, sem escolha.'))
                        return;
                    const resp = await fetch(`/api/fretes/aprovacoes-valor-minimo/${aprovacao.id}/rejeitar`, { method: 'POST' });
                    if (!resp.ok) {
                        window.alert(await extrairMensagemErro(resp));
                        return;
                    }
                    void carregarAprovacoesValorMinimo();
                })();
            });
            tdAcoes.appendChild(botaoAprovar);
            tdAcoes.appendChild(botaoRejeitar);
            tr.appendChild(tdAcoes);
            corpo.appendChild(tr);
        }
    }
    // --- Fase 4A.8 — Histórico de fretes por cliente (só leitura) -------------
    const ROTULOS_TIPO_DOCUMENTO = {
        PEDIDO: 'Pedido',
        ORCAMENTO: 'Orçamento',
        MANUAL: 'Manual',
    };
    function tipoDocumentoRotulo(tipo) {
        return ROTULOS_TIPO_DOCUMENTO[tipo ?? 'MANUAL'];
    }
    /** "Resultado" (seção 4): deriva de `statusRevisao` (Fase 4A.6) + `cotacaoStatus` — nunca inventa um status novo. */
    function calcularResultado(linha) {
        if (linha.cotacaoStatus === 'CANCELADA')
            return 'Cancelado';
        if (linha.statusRevisao === 'ESCOLHIDA')
            return 'Escolhido';
        if (linha.statusRevisao === 'DESCARTADA')
            return 'Descartado';
        if (linha.statusRevisao === 'EM_NEGOCIACAO')
            return 'Em negociação';
        return 'Não escolhido';
    }
    function formatarDataHora(iso) {
        return iso === null ? '—' : new Date(iso).toLocaleString('pt-BR');
    }
    function formatarDataCurta(iso) {
        return new Date(iso).toLocaleDateString('pt-BR');
    }
    function preencherSelectTransportadorasHistorico() {
        const select = document.getElementById('fretes-historico-filtro-transportadora');
        if (select === null)
            return;
        const valorAtual = select.value;
        select.textContent = '';
        const optTodas = document.createElement('option');
        optTodas.value = '';
        optTodas.textContent = 'Todas';
        select.appendChild(optTodas);
        for (const t of transportadorasCache) {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.nomeRazaoSocial;
            select.appendChild(option);
        }
        select.value = valorAtual;
    }
    async function buscarClientesHistoricoTela(termo) {
        const lista = el('fretes-historico-resultados-busca');
        lista.textContent = '';
        if (termo.trim() === '') {
            lista.hidden = true;
            return;
        }
        const resposta = await fetch(`/api/fretes/historico/clientes?termo=${encodeURIComponent(termo.trim())}`);
        if (!resposta.ok) {
            lista.hidden = true;
            window.alert(await extrairMensagemErro(resposta));
            return;
        }
        const dados = (await resposta.json());
        lista.hidden = dados.clientes.length === 0;
        for (const cliente of dados.clientes) {
            const li = document.createElement('li');
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'botao-secundario';
            botao.textContent = cliente.clienteNomeSnapshot !== null ? `${cliente.clienteNomeSnapshot} (Omie #${cliente.clienteOmieId})` : `Omie #${cliente.clienteOmieId}`;
            botao.addEventListener('click', () => {
                void selecionarClienteHistorico(cliente);
            });
            li.appendChild(botao);
            lista.appendChild(li);
        }
    }
    async function selecionarClienteHistorico(cliente) {
        clienteHistoricoSelecionado = cliente;
        paginaHistoricoAtual = 1;
        el('fretes-historico-resultados-busca').hidden = true;
        el('fretes-historico-cliente-selecionado').hidden = false;
        el('fretes-historico-cliente-nome').textContent =
            cliente.clienteNomeSnapshot !== null ? `${cliente.clienteNomeSnapshot} — Omie #${cliente.clienteOmieId}` : `Omie #${cliente.clienteOmieId}`;
        el('fretes-historico-detalhe').hidden = true;
        preencherSelectTransportadorasHistorico();
        await Promise.all([carregarResumoHistorico(), carregarTabelaHistorico()]);
    }
    function celulaMetrica(rotulo, valor) {
        const div = document.createElement('div');
        div.className = 'metrica';
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
    const SEM_DADOS = 'Sem dados';
    async function carregarResumoHistorico() {
        if (clienteHistoricoSelecionado === null)
            return;
        const container = el('fretes-historico-cards');
        container.textContent = '';
        const resposta = await fetch(`/api/fretes/historico/resumo?clienteOmieId=${clienteHistoricoSelecionado.clienteOmieId}`);
        if (!resposta.ok) {
            container.textContent = await extrairMensagemErro(resposta);
            return;
        }
        const resumo = (await resposta.json());
        const cards = [
            { rotulo: 'Fretes registrados', valor: String(resumo.totalFretes) },
            { rotulo: 'Fretes escolhidos/fechados', valor: String(resumo.totalEscolhidos) },
            { rotulo: 'Valor médio do frete base', valor: resumo.mediaFreteBase !== null ? formatarMoeda(resumo.mediaFreteBase) : SEM_DADOS },
            { rotulo: 'Valor médio do valor mínimo', valor: resumo.mediaValorMinimo !== null ? formatarMoeda(resumo.mediaValorMinimo) : SEM_DADOS },
            { rotulo: 'Prazo médio', valor: resumo.prazoMedioDias !== null ? `${resumo.prazoMedioDias.toFixed(1)} dia(s)` : SEM_DADOS },
            { rotulo: 'Transportadora mais utilizada', valor: resumo.transportadoraMaisUtilizada ?? SEM_DADOS },
            { rotulo: 'Última cotação', valor: resumo.ultimaCotacaoEm !== null ? formatarDataCurta(resumo.ultimaCotacaoEm) : SEM_DADOS },
            { rotulo: 'Último frete escolhido', valor: resumo.ultimoFreteEscolhidoEm !== null ? formatarDataCurta(resumo.ultimoFreteEscolhidoEm) : SEM_DADOS },
        ];
        for (const card of cards)
            container.appendChild(celulaMetrica(card.rotulo, card.valor));
    }
    async function carregarTabelaHistorico() {
        if (clienteHistoricoSelecionado === null)
            return;
        const corpo = el('fretes-tabela-historico-corpo');
        const vazio = el('fretes-historico-vazio');
        corpo.textContent = '';
        const formFiltros = el('fretes-form-filtros-historico');
        const dadosFiltros = new FormData(formFiltros);
        const params = new URLSearchParams();
        params.set('clienteOmieId', String(clienteHistoricoSelecionado.clienteOmieId));
        params.set('pagina', String(paginaHistoricoAtual));
        params.set('tamanhoPagina', String(TAMANHO_PAGINA_HISTORICO));
        const dataInicio = textoOuNulo(dadosFiltros.get('dataInicio'));
        const dataFim = textoOuNulo(dadosFiltros.get('dataFim'));
        const transportadoraId = textoOuNulo(dadosFiltros.get('transportadoraId'));
        const tipo = textoOuNulo(dadosFiltros.get('tipo'));
        const status = textoOuNulo(dadosFiltros.get('status'));
        const vendedorOmieId = textoOuNulo(dadosFiltros.get('vendedorOmieId'));
        if (dataInicio !== null)
            params.set('dataInicio', dataInicio);
        if (dataFim !== null)
            params.set('dataFim', dataFim);
        if (transportadoraId !== null)
            params.set('transportadoraId', transportadoraId);
        if (tipo !== null)
            params.set('tipo', tipo);
        if (status !== null)
            params.set('status', status);
        if (vendedorOmieId !== null)
            params.set('vendedorOmieId', vendedorOmieId);
        const resposta = await fetch(`/api/fretes/historico?${params.toString()}`);
        if (!resposta.ok) {
            vazio.textContent = await extrairMensagemErro(resposta);
            vazio.hidden = false;
            return;
        }
        const dados = (await resposta.json());
        vazio.hidden = dados.linhas.length > 0;
        totalPaginasHistorico = Math.max(1, Math.ceil(dados.total / dados.tamanhoPagina));
        el('fretes-historico-pagina-info').textContent = `Página ${dados.pagina} de ${totalPaginasHistorico} (${dados.total} registro(s))`;
        (el('fretes-historico-pagina-anterior')).disabled = dados.pagina <= 1;
        (el('fretes-historico-pagina-proxima')).disabled = dados.pagina >= totalPaginasHistorico;
        const celula = (texto) => {
            const td = document.createElement('td');
            td.textContent = texto;
            return td;
        };
        for (const linha of dados.linhas) {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.appendChild(celula(formatarDataCurta(linha.propostaCriadoEm)));
            tr.appendChild(celula(linha.pedidoOmieNumero ?? '—'));
            tr.appendChild(celula(tipoDocumentoRotulo(linha.documentoOmieTipo)));
            tr.appendChild(celula(linha.vendedorOmieId !== null ? String(linha.vendedorOmieId) : '—'));
            tr.appendChild(celula(linha.origem ?? '—'));
            tr.appendChild(celula(linha.destino ?? '—'));
            tr.appendChild(celula(linha.transportadoraNome));
            tr.appendChild(celula(linha.modalidadeExecucao === 'TRANSPORTADORA' ? linha.modalidade : linha.modalidadeExecucao));
            tr.appendChild(celula(formatarMoeda(linha.freteBase)));
            tr.appendChild(celula(linha.valorMinimo !== null ? formatarMoeda(linha.valorMinimo) : SEM_DADOS));
            tr.appendChild(celula(formatarPrazo(linha.prazoDias)));
            tr.appendChild(celula(calcularResultado(linha)));
            tr.addEventListener('click', () => {
                void abrirDetalheHistorico(linha.propostaId);
            });
            corpo.appendChild(tr);
        }
    }
    async function abrirDetalheHistorico(propostaId) {
        const resposta = await fetch(`/api/fretes/historico/${propostaId}`);
        if (!resposta.ok) {
            window.alert(await extrairMensagemErro(resposta));
            return;
        }
        const detalhe = (await resposta.json());
        const container = el('fretes-historico-detalhe-conteudo');
        container.textContent = '';
        const linhaInfoDetalhe = (rotulo, valor) => {
            const p = document.createElement('p');
            const forte = document.createElement('strong');
            forte.textContent = `${rotulo}: `;
            p.appendChild(forte);
            p.append(valor);
            container.appendChild(p);
        };
        linhaInfoDetalhe('Cotação', detalhe.codigo);
        linhaInfoDetalhe('Documento', `${tipoDocumentoRotulo(detalhe.documentoOmieTipo)}${detalhe.pedidoOmieNumero !== null ? ` — ${detalhe.pedidoOmieNumero}` : ''}`);
        linhaInfoDetalhe('Cliente', detalhe.clienteNomeSnapshot ?? '—');
        linhaInfoDetalhe('Vendedor (Omie)', detalhe.vendedorOmieId !== null ? String(detalhe.vendedorOmieId) : '—');
        linhaInfoDetalhe('Origem', detalhe.origem ?? '—');
        linhaInfoDetalhe('Destino', [detalhe.destino, detalhe.origemDestino.cidadeDestino, detalhe.origemDestino.ufDestino].filter((v) => v !== null && v !== '').join(' — ') || '—');
        linhaInfoDetalhe('Peso', detalhe.peso !== null ? `${detalhe.peso} kg` : '—');
        linhaInfoDetalhe('Volumes', detalhe.volumes !== null ? String(detalhe.volumes) : '—');
        linhaInfoDetalhe('Transportadora', detalhe.transportadoraNome);
        linhaInfoDetalhe('Modalidade', `${detalhe.modalidade} / ${detalhe.modalidadeExecucao}`);
        linhaInfoDetalhe('Frete base', formatarMoeda(detalhe.freteBase));
        linhaInfoDetalhe('Valor mínimo', detalhe.valorMinimo !== null ? formatarMoeda(detalhe.valorMinimo) : SEM_DADOS);
        linhaInfoDetalhe('Prazo', formatarPrazo(detalhe.prazoDias));
        linhaInfoDetalhe('Canal da cotação', detalhe.canal !== null ? ROTULOS_CANAL[detalhe.canal] : '—');
        linhaInfoDetalhe('Data da proposta', formatarDataHora(detalhe.propostaCriadoEm));
        linhaInfoDetalhe('Data da escolha', formatarDataHora(detalhe.dataEscolha));
        linhaInfoDetalhe('Usuário responsável', detalhe.usuarioResponsavelId ?? '—');
        linhaInfoDetalhe('Status', ROTULOS_STATUS_REVISAO[detalhe.statusRevisao]);
        linhaInfoDetalhe('Resultado', calcularResultado(detalhe));
        if (detalhe.auditoria.length > 0) {
            const tituloAuditoria = document.createElement('h4');
            tituloAuditoria.textContent = 'Auditoria relacionada';
            container.appendChild(tituloAuditoria);
            const listaAuditoria = document.createElement('ul');
            for (const registro of detalhe.auditoria) {
                const li = document.createElement('li');
                li.textContent = `${formatarDataHora(registro.criadoEm)} — ${registro.acao} (${registro.origem})`;
                listaAuditoria.appendChild(li);
            }
            container.appendChild(listaAuditoria);
        }
        el('fretes-historico-detalhe').hidden = false;
    }
    el('fretes-form-buscar-cliente-historico').addEventListener('submit', (evento) => {
        evento.preventDefault();
        const termo = textoOuNulo(new FormData(evento.target).get('termo')) ?? '';
        void buscarClientesHistoricoTela(termo);
    });
    el('fretes-form-filtros-historico').addEventListener('submit', (evento) => {
        evento.preventDefault();
        paginaHistoricoAtual = 1;
        void carregarTabelaHistorico();
    });
    el('fretes-historico-pagina-anterior').addEventListener('click', () => {
        if (paginaHistoricoAtual <= 1)
            return;
        paginaHistoricoAtual -= 1;
        void carregarTabelaHistorico();
    });
    el('fretes-historico-pagina-proxima').addEventListener('click', () => {
        if (paginaHistoricoAtual >= totalPaginasHistorico)
            return;
        paginaHistoricoAtual += 1;
        void carregarTabelaHistorico();
    });
    el('fretes-historico-detalhe-fechar').addEventListener('click', () => {
        el('fretes-historico-detalhe').hidden = true;
    });
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
    // --- Fase 4A.7 — parâmetros fiscais (só administrador) --------------------
    const formParametrosFiscais = document.getElementById('fretes-form-parametros-fiscais');
    const erroParametrosFiscais = document.getElementById('fretes-parametros-fiscais-erro');
    async function carregarParametrosFiscais() {
        if (formParametrosFiscais === null || obterUsuarioLogado()?.papel !== 'administrador')
            return;
        const resposta = await fetch('/api/fretes/parametros-fiscais');
        if (!resposta.ok)
            return;
        const dados = (await resposta.json());
        formParametrosFiscais.elements.namedItem('pisPercentual').value = dados.pisPercentual !== null ? String(dados.pisPercentual) : '';
        formParametrosFiscais.elements.namedItem('cofinsPercentual').value =
            dados.cofinsPercentual !== null ? String(dados.cofinsPercentual) : '';
        formParametrosFiscais.elements.namedItem('icmsPercentual').value = dados.icmsPercentual !== null ? String(dados.icmsPercentual) : '';
    }
    formParametrosFiscais?.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            if (erroParametrosFiscais === null || formParametrosFiscais === null)
                return;
            erroParametrosFiscais.hidden = true;
            const dadosForm = new FormData(formParametrosFiscais);
            const resposta = await fetch('/api/fretes/parametros-fiscais', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pisPercentual: numeroOuNulo(dadosForm.get('pisPercentual')),
                    cofinsPercentual: numeroOuNulo(dadosForm.get('cofinsPercentual')),
                    icmsPercentual: numeroOuNulo(dadosForm.get('icmsPercentual')),
                }),
            });
            if (!resposta.ok) {
                erroParametrosFiscais.textContent = await extrairMensagemErro(resposta);
                erroParametrosFiscais.hidden = false;
                return;
            }
            window.alert('Parâmetros fiscais salvos.');
        })();
    });
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
            tr.appendChild(celula(t.canalPrincipal === null ? 'Não definido' : ROTULOS_CANAL_PRINCIPAL_TRANSPORTADORA[t.canalPrincipal]));
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
    // Arquitetura de canais — Fase 1: só destaque visual discreto, nenhuma lógica de navegação/obrigatoriedade ainda.
    const selectCanalPrincipal = el('fretes-transportadora-canal-principal');
    const campoUrlPortal = el('fretes-transportadora-campo-url-portal');
    selectCanalPrincipal.addEventListener('change', () => {
        campoUrlPortal.classList.toggle('campo-filtro-destaque', selectCanalPrincipal.value === 'SITE');
    });
    const campoCodigoOmieOculto = el('fretes-transportadora-codigo-omie');
    const statusBuscaOmie = el('fretes-transportadora-omie-status');
    const areaOpcoesOmie = el('fretes-transportadora-omie-opcoes');
    const corpoOpcoesOmie = el('fretes-transportadora-omie-opcoes-corpo');
    const botaoBuscarOmie = el('fretes-transportadora-botao-buscar-omie');
    function formatarCnpjExibicao(cnpj) {
        if (cnpj === null)
            return '—';
        return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    function preencherCampoTransportadora(id, valor) {
        el(id).value = valor ?? '';
    }
    function aplicarTransportadoraOmie(o) {
        preencherCampoTransportadora('fretes-transportadora-razao', o.razaoSocial);
        preencherCampoTransportadora('fretes-transportadora-fantasia', o.nomeFantasia);
        preencherCampoTransportadora('fretes-transportadora-cnpj', formatarCnpjExibicao(o.cnpjCpf) === '—' ? null : formatarCnpjExibicao(o.cnpjCpf));
        preencherCampoTransportadora('fretes-transportadora-email', o.email);
        preencherCampoTransportadora('fretes-transportadora-telefone', o.telefone);
        preencherCampoTransportadora('fretes-transportadora-contato', o.contato);
        campoCodigoOmieOculto.value = String(o.codigo); // vínculo técnico interno — nunca exibido
        areaOpcoesOmie.hidden = true;
        statusBuscaOmie.textContent = 'Dados preenchidos a partir da Omie. Confira e clique em "Criar transportadora".';
        statusBuscaOmie.hidden = false;
    }
    // Alterar o CNPJ à mão invalida o vínculo escolhido — evita ligar um CNPJ a outro cadastro Omie.
    el('fretes-transportadora-cnpj').addEventListener('input', () => {
        campoCodigoOmieOculto.value = '';
    });
    botaoBuscarOmie.addEventListener('click', () => {
        void (async () => {
            erroTransportadora.hidden = true;
            areaOpcoesOmie.hidden = true;
            corpoOpcoesOmie.textContent = '';
            campoCodigoOmieOculto.value = '';
            const cnpj = textoOuNulo(el('fretes-transportadora-cnpj').value);
            const razaoSocial = textoOuNulo(el('fretes-transportadora-razao').value);
            const nomeFantasia = textoOuNulo(el('fretes-transportadora-fantasia').value);
            botaoBuscarOmie.disabled = true;
            statusBuscaOmie.textContent = 'Consultando a Omie…';
            statusBuscaOmie.hidden = false;
            try {
                const resposta = await fetch('/api/fretes/transportadoras/buscar-omie', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cnpj, razaoSocial, nomeFantasia }),
                });
                if (!resposta.ok) {
                    statusBuscaOmie.hidden = true;
                    erroTransportadora.textContent = await extrairMensagemErro(resposta);
                    erroTransportadora.hidden = false;
                    return;
                }
                const dados = (await resposta.json());
                if (dados.resultados.length === 0) {
                    statusBuscaOmie.textContent = 'Não encontrada na Omie. Você pode cadastrar manualmente — o vínculo com a Omie ficará vazio.';
                    return;
                }
                const unicoPorCnpj = dados.criterio === 'CNPJ' && dados.resultados.length === 1;
                if (unicoPorCnpj) {
                    const unico = dados.resultados[0];
                    aplicarTransportadoraOmie(unico);
                    if (unico.jaCadastrada !== null) {
                        statusBuscaOmie.textContent = `Atenção: este CNPJ já está cadastrado no ETK como "${unico.jaCadastrada.nomeRazaoSocial}".`;
                    }
                    return;
                }
                statusBuscaOmie.textContent = `${dados.resultados.length} resultado(s) na Omie. Confira o CNPJ e selecione a empresa correta.`;
                for (const o of dados.resultados) {
                    const tr = document.createElement('tr');
                    const tdCnpj = document.createElement('td');
                    const forte = document.createElement('strong');
                    forte.textContent = formatarCnpjExibicao(o.cnpjCpf);
                    tdCnpj.appendChild(forte);
                    const tdRazao = document.createElement('td');
                    tdRazao.textContent = o.razaoSocial;
                    const tdFantasia = document.createElement('td');
                    tdFantasia.textContent = o.nomeFantasia ?? '—';
                    const tdAcao = document.createElement('td');
                    if (o.jaCadastrada !== null) {
                        tdAcao.textContent = `Já cadastrada: ${o.jaCadastrada.nomeRazaoSocial}`;
                    }
                    else {
                        const botao = document.createElement('button');
                        botao.type = 'button';
                        botao.className = 'botao-secundario';
                        botao.textContent = 'Selecionar';
                        botao.addEventListener('click', () => aplicarTransportadoraOmie(o));
                        tdAcao.appendChild(botao);
                    }
                    tr.append(tdCnpj, tdRazao, tdFantasia, tdAcao);
                    corpoOpcoesOmie.appendChild(tr);
                }
                areaOpcoesOmie.hidden = false;
            }
            finally {
                botaoBuscarOmie.disabled = false;
            }
        })();
    });
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
                    codigoClienteOmie: numeroOuNulo(dadosForm.get('codigoClienteOmie')),
                    canalPrincipal: textoOuNulo(dadosForm.get('canalPrincipal')),
                    urlPortal: textoOuNulo(dadosForm.get('urlPortal')),
                    whatsappCotacao: textoOuNulo(dadosForm.get('whatsappCotacao')),
                }),
            });
            if (!resposta.ok) {
                erroTransportadora.textContent = await extrairMensagemErro(resposta);
                erroTransportadora.hidden = false;
                return;
            }
            formNovaTransportadora.reset();
            statusBuscaOmie.hidden = true;
            areaOpcoesOmie.hidden = true;
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
    // --- Documento Omie (orçamento OU pedido): consulta e conferência ANTES de criar (somente leitura) ---
    // O operador informa só o número; a Omie diz se é Orçamento ou Pedido. Ao criar, o tipo
    // conferido vai junto e o backend reconsulta a Omie (divergência de tipo é rejeitada).
    // Consultar NÃO cria cotação: só preenche a tela. A criação acontece apenas no botão "Criar cotação".
    const inputOrcamento = el('fretes-cotacao-orcamento');
    const infoOrcamento = el('fretes-cotacao-orcamento-info');
    const campoClienteManual = el('fretes-cotacao-cliente-manual-campo');
    const campoClienteNome = el('fretes-cotacao-cliente-nome-campo');
    const inputClienteNome = el('fretes-cotacao-cliente-nome');
    const campoVendedorManual = el('fretes-cotacao-vendedor-manual-campo');
    const campoVendedorNome = el('fretes-cotacao-vendedor-nome-campo');
    const inputVendedorNome = el('fretes-cotacao-vendedor-nome');
    /** Orçamento já localizado na Omie e exibido para conferência — `null` até a consulta dar certo. */
    let orcamentoPreparado = null;
    let consultaOrcamentoEmAndamento = false;
    const CAMPOS_PREENCHIDOS_PELO_ORCAMENTO = [
        'fretes-cotacao-valor-mercadoria',
        'fretes-cotacao-destino',
        'fretes-cotacao-cep-destino',
        'fretes-cotacao-peso',
        'fretes-cotacao-volumes',
    ];
    /** Alterna entre o campo de código Omie (digitado à mão, cotação manual) e o de nome (preenchido pelo orçamento). */
    function exibirClienteVendedorComoCodigo() {
        campoClienteManual.hidden = false;
        campoClienteNome.hidden = true;
        inputClienteNome.value = '';
        campoVendedorManual.hidden = false;
        campoVendedorNome.hidden = true;
        inputVendedorNome.value = '';
    }
    function exibirClienteVendedorComoNome(p) {
        campoClienteManual.hidden = true;
        campoClienteNome.hidden = false;
        inputClienteNome.value = textoOuTraco(p.clienteNome);
        campoVendedorManual.hidden = true;
        campoVendedorNome.hidden = false;
        inputVendedorNome.value = p.vendedorNome ?? 'Vendedor não identificado';
    }
    function definirValorCampoCotacao(id, valor) {
        el(id).value = valor === null ? '' : String(valor);
    }
    function resumoDestinoOrcamento(d) {
        const rua = [d.logradouro, d.numero !== null ? `nº ${d.numero}` : null, d.bairro].filter((v) => v !== null && v !== '').join(', ');
        const cidade = [d.cidade, d.uf].filter((v) => v !== null && v !== '').join('/');
        return [rua, cidade].filter((v) => v !== '').join(' — ');
    }
    /** Troca/edição do número: descarta o orçamento anterior e tudo que ele preencheu. */
    function limparDadosOrcamento() {
        orcamentoPreparado = null;
        infoOrcamento.hidden = true;
        exibirClienteVendedorComoCodigo();
        el('fretes-cotacao-cliente').value = '';
        el('fretes-cotacao-vendedor').value = '';
        for (const id of CAMPOS_PREENCHIDOS_PELO_ORCAMENTO)
            definirValorCampoCotacao(id, null);
    }
    /** Só consulta e preenche a tela — nunca cria cotação. Devolve true se o orçamento está localizado. */
    async function consultarOrcamentoNaOmie() {
        erroCotacao.hidden = true;
        const numero = inputOrcamento.value.trim();
        if (numero === '')
            return false;
        if (orcamentoPreparado !== null && orcamentoPreparado.numero === numero)
            return true;
        if (consultaOrcamentoEmAndamento)
            return false;
        consultaOrcamentoEmAndamento = true;
        infoOrcamento.textContent = 'Consultando a Omie…';
        infoOrcamento.hidden = false;
        try {
            const resposta = await fetch(`/api/fretes/omie/documentos/${encodeURIComponent(numero)}/preparar`);
            if (inputOrcamento.value.trim() !== numero)
                return false; // o operador já trocou o número durante a consulta
            if (!resposta.ok) {
                limparDadosOrcamento();
                erroCotacao.textContent = await extrairMensagemErro(resposta);
                erroCotacao.hidden = false;
                return false;
            }
            const p = (await resposta.json());
            orcamentoPreparado = { numero, preparacao: p };
            exibirClienteVendedorComoNome(p);
            definirValorCampoCotacao('fretes-cotacao-valor-mercadoria', p.valorTotalPedido || null);
            definirValorCampoCotacao('fretes-cotacao-destino', p.destino === null ? null : resumoDestinoOrcamento(p.destino));
            definirValorCampoCotacao('fretes-cotacao-cep-destino', p.destino?.cep ?? null);
            definirValorCampoCotacao('fretes-cotacao-peso', p.logistica.pesoBruto);
            definirValorCampoCotacao('fretes-cotacao-volumes', p.logistica.quantidadeVolumes);
            const tipo = p.documentoOmieTipo === 'ORCAMENTO' ? 'ORÇAMENTO OMIE' : 'PEDIDO OMIE';
            const extras = [
                p.logistica.cifFobOmie !== null ? `CIF/FOB (Omie): ${p.logistica.cifFobOmie}` : null,
                p.logistica.especieVolumes !== null ? `Espécie: ${p.logistica.especieVolumes}` : null,
                p.logistica.pesoLiquido !== null ? `Peso líquido: ${p.logistica.pesoLiquido} kg` : null,
            ].filter((x) => x !== null);
            infoOrcamento.textContent = `${tipo} Nº ${p.pedidoOmieNumero} localizado${extras.length > 0 ? ` — ${extras.join(' • ')}` : ''}. Confira os dados e clique em "Criar cotação" para confirmar.`;
            return true;
        }
        finally {
            consultaOrcamentoEmAndamento = false;
        }
    }
    inputOrcamento.addEventListener('input', limparDadosOrcamento);
    inputOrcamento.addEventListener('change', () => void consultarOrcamentoNaOmie());
    inputOrcamento.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Enter')
            return;
        evento.preventDefault(); // Enter no campo consulta o orçamento; nunca envia o formulário (não cria cotação)
        void consultarOrcamentoNaOmie();
    });
    formNovaCotacao.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            erroCotacao.hidden = true;
            const dadosForm = new FormData(formNovaCotacao);
            const entregaProgramadaTde = dadosForm.get('entregaProgramadaTde') !== null;
            const comuns = {
                modalidade: dadosForm.get('modalidade'),
                modalidadeExecucao: dadosForm.get('modalidadeExecucao'),
                veiculoId: textoOuNulo(dadosForm.get('veiculoId')),
                motoristaNome: textoOuNulo(dadosForm.get('motoristaNome')),
                custoManual: numeroOuNulo(dadosForm.get('custoManual')),
                valorMercadoria: numeroOuNulo(dadosForm.get('valorMercadoria')),
                observacoes: textoOuNulo(dadosForm.get('observacoes')),
                entregaProgramadaTde,
            };
            const numeroOrcamento = inputOrcamento.value.trim();
            let resposta;
            if (numeroOrcamento !== '') {
                if (orcamentoPreparado === null || orcamentoPreparado.numero !== numeroOrcamento) {
                    // Número ainda não conferido: consulta e exibe os dados, mas NÃO cria — o operador confirma num novo clique.
                    if (await consultarOrcamentoNaOmie()) {
                        erroCotacao.textContent = 'Confira os dados do documento Omie exibidos acima e clique em "Criar cotação" novamente para confirmar.';
                        erroCotacao.hidden = false;
                    }
                    return;
                }
                // Documento Omie: o backend relê a Omie (fonte da verdade) exigindo o MESMO tipo conferido
                // aqui; o destino só é enviado se a Omie não tiver um.
                const cepDestino = textoOuNulo(dadosForm.get('cepDestino'));
                const destinoOverride = orcamentoPreparado.preparacao.destino === null && cepDestino !== null ? { cep: cepDestino } : null;
                resposta = await fetch(`/api/fretes/omie/documentos/${encodeURIComponent(numeroOrcamento)}/confirmar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...comuns,
                        tipoDocumento: orcamentoPreparado.preparacao.documentoOmieTipo,
                        destinoOverride,
                        peso: numeroOuNulo(dadosForm.get('peso')),
                        volumes: numeroOuNulo(dadosForm.get('volumes')),
                    }),
                });
            }
            else {
                // Cotação manual (sem orçamento). O CEP de origem é definido pelo backend.
                resposta = await fetch('/api/fretes/cotacoes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...comuns,
                        clienteOmieId: numeroOuNulo(dadosForm.get('clienteOmieId')),
                        vendedorOmieId: numeroOuNulo(dadosForm.get('vendedorOmieId')),
                        origem: textoOuNulo(dadosForm.get('origem')),
                        destino: textoOuNulo(dadosForm.get('destino')),
                        cepDestino: textoOuNulo(dadosForm.get('cepDestino')),
                        peso: numeroOuNulo(dadosForm.get('peso')),
                        volumes: numeroOuNulo(dadosForm.get('volumes')),
                    }),
                });
            }
            if (!resposta.ok) {
                erroCotacao.textContent = await extrairMensagemErro(resposta);
                erroCotacao.hidden = false;
                return;
            }
            formNovaCotacao.reset();
            limparDadosOrcamento();
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
            prepararEnvioSolicitacoes(cotacao, cotacaoEncerrada);
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
    /**
     * Status de e-mail para o operador: só ENVIADO (envio aceito pelo fluxo SMTP/n8n existente,
     * ou já respondido, sem falha conhecida) ou FALHA (erro/bounce/rejeição registrada). Nunca
     * "Entregue": não há confirmação real de entrega. Os status técnicos continuam no banco;
     * pendente/cancelada e os demais canais mantêm o rótulo original.
     */
    function statusOperadorSolicitacao(s) {
        if (s.canal === 'EMAIL') {
            if (s.status === 'ERRO')
                return 'FALHA';
            if (s.status === 'ENVIADA' || s.status === 'ENTREGUE' || s.status === 'RESPONDIDA')
                return 'ENVIADO';
        }
        return ROTULOS_STATUS_SOLICITACAO[s.status];
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
            // A célula mostra só o status simplificado; o motivo técnico da falha (ex.: "550 5.4.1")
            // fica atrás de "Detalhes", na coluna de ações.
            tr.appendChild(celula(statusOperadorSolicitacao(s)));
            tr.appendChild(celula(formatarDataHoraOuTraco(s.dataEnvio)));
            tr.appendChild(celula(formatarDataHoraOuTraco(s.dataResposta)));
            tr.appendChild(celula(s.emailDestino ?? '—'));
            tr.appendChild(celula(s.emailOrigem === 'OMIE' ? 'Omie' : s.emailOrigem === 'MANUAL' ? 'Manual' : '—'));
            const tdAcoes = document.createElement('td');
            if (s.status === 'ERRO') {
                const detalhes = document.createElement('details');
                detalhes.className = 'fretes-solicitacao-detalhes';
                const resumo = document.createElement('summary');
                resumo.textContent = 'Detalhes';
                const motivo = document.createElement('p');
                motivo.textContent = s.erroUltimaTentativa ?? 'Motivo da falha não registrado.';
                detalhes.append(resumo, motivo);
                tdAcoes.appendChild(detalhes);
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
    const ROTULOS_CANAL_ENVIO = { EMAIL: 'E-mail', WHATSAPP: 'WhatsApp', API: 'API' };
    const LIMITE_TRANSPORTADORAS_SELECIONADAS = 7;
    let selecionadas = [];
    let cotacaoEnvioAtual = null;
    let envioBloqueadoPorStatus = false;
    const inputBuscaTransportadora = el('fretes-busca-transportadora');
    const infoBuscaTransportadora = el('fretes-busca-transportadora-info');
    const resultadosBuscaTransportadora = el('fretes-busca-transportadora-resultados');
    const corpoSelecionadas = el('fretes-tabela-selecionadas-corpo');
    const vazioSelecionadas = el('fretes-selecionadas-vazio');
    const contadorSelecionadas = el('fretes-selecionadas-contador');
    const dadosCarga = el('fretes-dados-carga');
    const conferenciaEnvio = el('fretes-envio-conferencia');
    const botaoEnviarSolicitacoes = el('fretes-botao-enviar-solicitacoes');
    const erroEnvio = el('fretes-envio-erro');
    const resultadoEnvio = el('fretes-envio-resultado');
    function nomeTransportadoraBusca(t) {
        return t.nomeFantasia ?? t.nomeRazaoSocial;
    }
    /** Rótulo do canal com "*" quando é o canal principal (prioritário) da transportadora. */
    function rotuloCanalEnvio(c, t) {
        return t.canalPrincipal === c ? `${ROTULOS_CANAL_ENVIO[c]} *` : ROTULOS_CANAL_ENVIO[c];
    }
    function descreverCanais(t) {
        const canais = t.canaisDisponiveis;
        return canais.length === 0 ? 'Nenhum canal disponível' : canais.map((c) => rotuloCanalEnvio(c, t)).join(' / ');
    }
    /** Portal/site é só informação operacional; WhatsApp só vira canal com número válido (decidido no backend). */
    function observacoesCanais(t) {
        const notas = [];
        if (t.urlPortal !== null && !t.apiIntegrada)
            notas.push('Portal cadastrado — integração API não disponível');
        if (t.whatsappCadastrado && !t.canaisDisponiveis.includes('WHATSAPP'))
            notas.push('WhatsApp cadastrado inválido — corrija o número no cadastro');
        return notas;
    }
    function formatarCnpjTransportadora(cnpj) {
        if (cnpj === null || cnpj.trim() === '')
            return 'Não informado';
        const digitos = cnpj.replace(/\D/g, '');
        return digitos.length === 14 ? digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : cnpj;
    }
    /** Regras de seleção: sem duplicidade, no máximo 7, e só com algum canal disponível. */
    function motivoNaoSelecionavel(t) {
        if (selecionadas.some((s) => s.id === t.id))
            return 'Já selecionada';
        if (selecionadas.length >= LIMITE_TRANSPORTADORAS_SELECIONADAS)
            return `Limite de ${LIMITE_TRANSPORTADORAS_SELECIONADAS} transportadoras`;
        if (t.canaisDisponiveis.length === 0)
            return 'Transportadora cadastrada, mas sem canal de cotação disponível.';
        return null;
    }
    function selecionarTransportadora(t) {
        if (motivoNaoSelecionavel(t) !== null)
            return;
        selecionadas.push({ ...t, canal: t.canalSugerido, emailManual: '' });
        renderizarSelecionadas();
        renderizarResultadosBusca(ultimosResultadosBusca);
    }
    function removerTransportadora(id) {
        selecionadas = selecionadas.filter((s) => s.id !== id);
        renderizarSelecionadas();
        renderizarResultadosBusca(ultimosResultadosBusca);
    }
    let ultimosResultadosBusca = [];
    function renderizarResultadosBusca(lista) {
        ultimosResultadosBusca = lista;
        resultadosBuscaTransportadora.textContent = '';
        for (const t of lista) {
            const card = document.createElement('div');
            card.className = 'fretes-busca-resultado';
            const info = document.createElement('div');
            info.className = 'fretes-busca-resultado-info';
            const nome = document.createElement('strong');
            nome.textContent = nomeTransportadoraBusca(t);
            info.appendChild(nome);
            const linhas = [
                t.nomeFantasia !== null && t.nomeFantasia !== t.nomeRazaoSocial ? `Razão social: ${t.nomeRazaoSocial}` : null,
                `CNPJ: ${formatarCnpjTransportadora(t.cnpj)}`,
                `Canais disponíveis: ${descreverCanais(t)}`,
                ...observacoesCanais(t),
            ];
            for (const texto of linhas) {
                if (texto === null)
                    continue;
                const span = document.createElement('span');
                span.textContent = texto;
                info.appendChild(span);
            }
            card.appendChild(info);
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'botao-secundario';
            const motivo = motivoNaoSelecionavel(t);
            botao.textContent = motivo === 'Já selecionada' ? 'Selecionada' : 'Selecionar';
            botao.disabled = motivo !== null || envioBloqueadoPorStatus;
            if (motivo !== null)
                botao.title = motivo;
            botao.addEventListener('click', () => selecionarTransportadora(t));
            card.appendChild(botao);
            resultadosBuscaTransportadora.appendChild(card);
        }
    }
    let temporizadorBusca;
    let sequenciaBusca = 0;
    inputBuscaTransportadora.addEventListener('input', () => {
        window.clearTimeout(temporizadorBusca);
        temporizadorBusca = window.setTimeout(() => void buscarTransportadoras(), 300);
    });
    async function buscarTransportadoras() {
        const termo = inputBuscaTransportadora.value.trim();
        const sequencia = ++sequenciaBusca;
        limparBuscaOmie();
        if (termo.length < 2) {
            infoBuscaTransportadora.hidden = true;
            renderizarResultadosBusca([]);
            return;
        }
        const resposta = await fetch(`/api/fretes/transportadoras/buscar?q=${encodeURIComponent(termo)}`);
        if (sequencia !== sequenciaBusca)
            return; // uma busca mais nova já foi disparada
        if (!resposta.ok) {
            infoBuscaTransportadora.textContent = await extrairMensagemErro(resposta);
            infoBuscaTransportadora.hidden = false;
            renderizarResultadosBusca([]);
            return;
        }
        const dados = (await resposta.json());
        infoBuscaTransportadora.hidden = true;
        // Não achou no cadastro ETK: oferece a busca na Omie (somente leitura, nunca cadastra sozinha).
        ofertaBuscaOmie.hidden = dados.transportadoras.length > 0 || envioBloqueadoPorStatus;
        renderizarResultadosBusca(dados.transportadoras);
    }
    const ofertaBuscaOmie = el('fretes-busca-omie-oferta');
    const infoBuscaOmie = el('fretes-busca-omie-info');
    const resultadosBuscaOmie = el('fretes-busca-omie-resultados');
    const painelConferir = el('fretes-conferir-transportadora');
    const formConferir = el('fretes-form-conferir-transportadora');
    const erroConferir = el('fretes-conferir-erro');
    const infoConferir = el('fretes-conferir-info');
    const apiConferir = el('fretes-conferir-api');
    function limparBuscaOmie() {
        ofertaBuscaOmie.hidden = true;
        infoBuscaOmie.hidden = true;
        resultadosBuscaOmie.textContent = '';
        painelConferir.hidden = true;
        erroConferir.hidden = true;
    }
    el('fretes-busca-omie-botao').addEventListener('click', () => void buscarTransportadoraNaOmie());
    async function buscarTransportadoraNaOmie() {
        const termo = inputBuscaTransportadora.value.trim();
        const digitos = termo.replace(/\D/g, '');
        // CNPJ completo → critério CNPJ; senão, nome (razão social e, na falta, nome fantasia).
        const filtro = digitos.length === 14 ? { cnpj: digitos } : { razaoSocial: termo, nomeFantasia: termo };
        infoBuscaOmie.textContent = 'Consultando a Omie…';
        infoBuscaOmie.hidden = false;
        resultadosBuscaOmie.textContent = '';
        const resposta = await fetch('/api/fretes/transportadoras/buscar-omie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filtro),
        });
        if (!resposta.ok) {
            infoBuscaOmie.textContent = await extrairMensagemErro(resposta);
            return;
        }
        const dados = (await resposta.json());
        infoBuscaOmie.textContent =
            dados.resultados.length === 0 ? 'Nenhum cadastro encontrado na Omie.' : 'Escolha pelo CNPJ. Nada é cadastrado sem a sua confirmação.';
        for (const o of dados.resultados) {
            const card = document.createElement('div');
            card.className = 'fretes-busca-resultado';
            const info = document.createElement('div');
            info.className = 'fretes-busca-resultado-info';
            const nome = document.createElement('strong');
            nome.textContent = o.razaoSocial;
            info.appendChild(nome);
            for (const texto of [
                o.nomeFantasia !== null ? `Nome fantasia: ${o.nomeFantasia}` : null,
                `CNPJ: ${formatarCnpjTransportadora(o.cnpjCpf)}`,
                o.jaCadastrada !== null ? 'Já cadastrada no ETK' : null,
            ]) {
                if (texto === null)
                    continue;
                const span = document.createElement('span');
                span.textContent = texto;
                info.appendChild(span);
            }
            card.appendChild(info);
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'botao-secundario';
            const cnpjValido = (o.cnpjCpf ?? '').replace(/\D/g, '').length === 14;
            botao.disabled = !cnpjValido;
            if (!cnpjValido)
                botao.title = 'Cadastro na Omie sem CNPJ válido';
            if (o.jaCadastrada !== null) {
                botao.textContent = 'Usar cadastro existente';
                botao.addEventListener('click', () => void confirmarCadastro({ nomeRazaoSocial: o.razaoSocial, cnpj: o.cnpjCpf }));
            }
            else {
                botao.textContent = 'Selecionar';
                botao.addEventListener('click', () => abrirConferencia(o));
            }
            card.appendChild(botao);
            resultadosBuscaOmie.appendChild(card);
        }
    }
    /** Braspress é a única integração API desta fase — o resto é "API integrada: NÃO" (portal/site nunca conta). */
    function descreverApiConferencia() {
        const dados = new FormData(formConferir);
        const nomes = `${String(dados.get('nomeRazaoSocial') ?? '')} ${String(dados.get('nomeFantasia') ?? '')}`;
        const portal = String(dados.get('urlPortal') ?? '').trim() !== '';
        apiConferir.textContent = /braspress/i.test(nomes)
            ? 'API INTEGRADA: SIM (Braspress)'
            : `API INTEGRADA: NÃO${portal ? ' — portal/site cadastrado é só informação operacional' : ''}. Integração futura só após análise técnica da transportadora.`;
    }
    formConferir.addEventListener('input', descreverApiConferencia);
    function abrirConferencia(o) {
        formConferir.reset();
        const preencher = (id, valor) => {
            el(id).value = valor === null ? '' : String(valor);
        };
        preencher('fretes-conferir-razao', o.razaoSocial);
        preencher('fretes-conferir-fantasia', o.nomeFantasia);
        preencher('fretes-conferir-cnpj', formatarCnpjTransportadora(o.cnpjCpf));
        preencher('fretes-conferir-email', o.email);
        preencher('fretes-conferir-telefone', o.telefone);
        preencher('fretes-conferir-contato', o.contato);
        preencher('fretes-conferir-codigo-omie', o.codigo);
        // WhatsApp nunca é pré-preenchido com o telefone: só vale o que o operador informar como WhatsApp.
        preencher('fretes-conferir-whatsapp', null);
        descreverApiConferencia();
        erroConferir.hidden = true;
        painelConferir.hidden = false;
        painelConferir.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    el('fretes-conferir-cancelar').addEventListener('click', () => {
        painelConferir.hidden = true;
    });
    formConferir.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const dados = new FormData(formConferir);
        void confirmarCadastro({
            nomeRazaoSocial: textoOuNulo(dados.get('nomeRazaoSocial')),
            nomeFantasia: textoOuNulo(dados.get('nomeFantasia')),
            cnpj: textoOuNulo(dados.get('cnpj')),
            email: textoOuNulo(dados.get('email')),
            whatsappCotacao: textoOuNulo(dados.get('whatsappCotacao')),
            telefone: textoOuNulo(dados.get('telefone')),
            contato: textoOuNulo(dados.get('contato')),
            urlPortal: textoOuNulo(dados.get('urlPortal')),
            canalPrincipal: textoOuNulo(dados.get('canalPrincipal')),
            codigoClienteOmie: numeroOuNulo(dados.get('codigoClienteOmie')),
        });
    });
    /** Grava (ou reaproveita, pelo CNPJ) e devolve a transportadora já selecionada na cotação. */
    async function confirmarCadastro(corpo) {
        erroConferir.hidden = true;
        infoConferir.hidden = true;
        const resposta = await fetch('/api/fretes/transportadoras/confirmar-cadastro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
        });
        if (!resposta.ok) {
            const mensagem = await extrairMensagemErro(resposta);
            if (painelConferir.hidden) {
                infoConferir.textContent = mensagem;
                infoConferir.hidden = false;
            }
            else {
                erroConferir.textContent = mensagem;
                erroConferir.hidden = false;
            }
            return;
        }
        const { transportadora, existente, ativa } = (await resposta.json());
        limparBuscaOmie();
        void carregarTransportadoras(); // mantém nomes/listas da tela em dia com o cadastro
        const origem = existente ? 'Já existia no cadastro ETK (mesmo CNPJ) — usando o cadastro existente.' : 'Transportadora cadastrada.';
        let complemento;
        if (!ativa) {
            complemento = 'Ela está inativa no cadastro — reative-a em Transportadoras para usar na cotação.';
        }
        else if (transportadora.canaisDisponiveis.length === 0) {
            complemento = 'Transportadora cadastrada, mas sem canal de cotação disponível.';
        }
        else if (motivoNaoSelecionavel(transportadora) !== null) {
            complemento = `Não selecionada: ${motivoNaoSelecionavel(transportadora)}.`;
        }
        else {
            selecionarTransportadora(transportadora);
            complemento = `Selecionada — canais disponíveis: ${descreverCanais(transportadora)}.`;
        }
        infoConferir.textContent = `${nomeTransportadoraBusca(transportadora)}: ${origem} ${complemento}`;
        infoConferir.hidden = false;
    }
    function renderizarSelecionadas() {
        corpoSelecionadas.textContent = '';
        contadorSelecionadas.textContent = `${selecionadas.length}/${LIMITE_TRANSPORTADORAS_SELECIONADAS}`;
        vazioSelecionadas.hidden = selecionadas.length > 0;
        for (const s of selecionadas) {
            const tr = document.createElement('tr');
            const celula = (texto) => {
                const td = document.createElement('td');
                td.textContent = texto;
                return td;
            };
            tr.appendChild(celula(nomeTransportadoraBusca(s)));
            tr.appendChild(celula(formatarCnpjTransportadora(s.cnpj)));
            tr.appendChild(celula([descreverCanais(s), ...observacoesCanais(s)].join(' — ')));
            const tdCanal = document.createElement('td');
            if (s.canaisDisponiveis.length === 1) {
                // Um canal só: selecionado automaticamente (canalSugerido do backend).
                tdCanal.textContent = rotuloCanalEnvio(s.canaisDisponiveis[0], s);
            }
            else {
                // Vários canais: pré-seleciona o principal válido; sem ele, o operador precisa escolher (nunca arbitrário).
                const select = document.createElement('select');
                select.setAttribute('aria-label', `Canal do envio para ${nomeTransportadoraBusca(s)}`);
                const vazio = document.createElement('option');
                vazio.value = '';
                vazio.textContent = 'Escolha o canal...';
                select.appendChild(vazio);
                for (const c of s.canaisDisponiveis) {
                    const opcao = document.createElement('option');
                    opcao.value = c;
                    opcao.textContent = rotuloCanalEnvio(c, s);
                    select.appendChild(opcao);
                }
                select.value = s.canal ?? '';
                select.addEventListener('change', () => {
                    s.canal = select.value === '' ? null : select.value;
                    renderizarSelecionadas();
                });
                tdCanal.appendChild(select);
            }
            if (s.canal === 'EMAIL') {
                const inputEmail = document.createElement('input');
                inputEmail.type = 'email';
                inputEmail.className = 'fretes-selecionada-email';
                inputEmail.value = s.emailManual;
                inputEmail.placeholder = 'E-mail só desta solicitação (opcional — em branco usa o Omie)';
                inputEmail.setAttribute('aria-label', `E-mail manual para ${nomeTransportadoraBusca(s)}`);
                inputEmail.addEventListener('input', () => {
                    s.emailManual = inputEmail.value;
                    atualizarConferenciaEnvio();
                });
                tdCanal.appendChild(inputEmail);
            }
            tr.appendChild(tdCanal);
            const tdRemover = document.createElement('td');
            const botaoRemover = document.createElement('button');
            botaoRemover.type = 'button';
            botaoRemover.className = 'botao-secundario';
            botaoRemover.textContent = 'Remover';
            botaoRemover.addEventListener('click', () => removerTransportadora(s.id));
            tdRemover.appendChild(botaoRemover);
            tr.appendChild(tdRemover);
            corpoSelecionadas.appendChild(tr);
        }
        atualizarConferenciaEnvio();
    }
    /** Dados da carga: só leitura, direto da cotação (nenhuma segunda fonte de verdade). */
    function renderizarDadosCarga() {
        const c = cotacaoEnvioAtual;
        dadosCarga.textContent = '';
        if (c === null)
            return;
        const naoInformado = (v) => (v === null || v === '' ? 'Não informado' : String(v));
        const peso = c.pesoBruto ?? c.peso;
        const totalEmbalagens = totalVolumesEmbalagensValidas();
        linhaInfo(dadosCarga, 'Origem', naoInformado(c.origem));
        linhaInfo(dadosCarga, 'Destino', naoInformado(c.destino));
        linhaInfo(dadosCarga, 'CEP destino', naoInformado(c.cepDestino));
        linhaInfo(dadosCarga, 'Cliente', c.clienteNomeSnapshot ?? (c.clienteOmieId !== null ? `Código Omie ${c.clienteOmieId}` : 'Não informado'));
        linhaInfo(dadosCarga, 'CNPJ destinatário', c.clienteOmieId !== null ? 'Consultado na Omie no envio via API' : 'Não disponível');
        linhaInfo(dadosCarga, 'Valor da mercadoria', c.valorMercadoria === null ? 'Não informado' : formatarMoeda(c.valorMercadoria));
        linhaInfo(dadosCarga, 'Peso bruto', peso === null ? 'Não informado' : `${peso} kg`);
        linhaInfo(dadosCarga, 'Total de volumes', totalEmbalagens > 0 ? `${totalEmbalagens} (embalagens)` : naoInformado(c.volumes));
        linhaInfo(dadosCarga, 'Modalidade', c.modalidade);
        linhaInfo(dadosCarga, 'Observações', naoInformado(c.observacoes));
    }
    // Várias embalagens: cada linha vira um item de `cubagem` (formato já aceito pela rota,
    // até 50 itens). Linhas totalmente em branco são ignoradas.
    const CAMPOS_EMBALAGEM = [
        { campo: 'altura', rotulo: 'Altura (m)', step: '0.01' },
        { campo: 'largura', rotulo: 'Largura (m)', step: '0.01' },
        { campo: 'comprimento', rotulo: 'Comprimento (m)', step: '0.01' },
        { campo: 'volumes', rotulo: 'Quantidade', step: '1' },
    ];
    const containerEmbalagens = el('fretes-embalagens');
    const totalVolumesEmbalagens = el('fretes-embalagens-total-volumes');
    function linhasEmbalagem() {
        return Array.from(containerEmbalagens.querySelectorAll('.fretes-embalagem-linha'));
    }
    function valorEmbalagem(linha, campo) {
        return linha.querySelector(`input[data-campo="${campo}"]`)?.value.trim() ?? '';
    }
    function totalVolumesEmbalagensValidas() {
        return linhasEmbalagem().reduce((soma, linha) => {
            const quantidade = Number(valorEmbalagem(linha, 'volumes'));
            return Number.isInteger(quantidade) && quantidade > 0 ? soma + quantidade : soma;
        }, 0);
    }
    function atualizarTotalVolumes() {
        totalVolumesEmbalagens.textContent = String(totalVolumesEmbalagensValidas());
        renderizarDadosCarga();
        atualizarConferenciaEnvio();
    }
    function adicionarLinhaEmbalagem() {
        const linha = document.createElement('div');
        linha.className = 'filtros-relatorio fretes-embalagem-linha';
        for (const { campo, rotulo, step } of CAMPOS_EMBALAGEM) {
            const div = document.createElement('div');
            div.className = 'campo-filtro';
            const label = document.createElement('label');
            label.textContent = rotulo;
            const input = document.createElement('input');
            input.type = 'number';
            input.min = campo === 'volumes' ? '1' : '0';
            input.step = step;
            input.dataset.campo = campo;
            input.addEventListener('input', atualizarTotalVolumes);
            label.appendChild(input);
            div.appendChild(label);
            linha.appendChild(div);
        }
        const botaoRemover = document.createElement('button');
        botaoRemover.type = 'button';
        botaoRemover.className = 'botao-secundario';
        botaoRemover.textContent = 'Remover';
        botaoRemover.addEventListener('click', () => {
            linha.remove();
            if (linhasEmbalagem().length === 0)
                adicionarLinhaEmbalagem();
            atualizarTotalVolumes();
        });
        linha.appendChild(botaoRemover);
        containerEmbalagens.appendChild(linha);
    }
    /** Lê as linhas preenchidas; lança Error com mensagem amigável se alguma for inválida. */
    function lerEmbalagens() {
        const itens = [];
        linhasEmbalagem().forEach((linha, i) => {
            const brutos = CAMPOS_EMBALAGEM.map(({ campo }) => valorEmbalagem(linha, campo));
            if (brutos.every((v) => v === ''))
                return;
            const [altura, largura, comprimento, volumes] = brutos.map(Number);
            if (![altura, largura, comprimento].every((v) => Number.isFinite(v) && v > 0)) {
                throw new Error(`Embalagem ${i + 1}: altura, largura e comprimento devem ser maiores que zero.`);
            }
            if (!Number.isInteger(volumes) || volumes < 1) {
                throw new Error(`Embalagem ${i + 1}: quantidade deve ser um número inteiro maior ou igual a 1.`);
            }
            itens.push({ altura, largura, comprimento, volumes });
        });
        return itens;
    }
    el('fretes-embalagens-adicionar').addEventListener('click', adicionarLinhaEmbalagem);
    adicionarLinhaEmbalagem();
    /** Conferência antes do envio: lista o problema por transportadora/canal; vazio = pode enviar. */
    function problemasEnvio() {
        const problemas = [];
        if (selecionadas.length === 0)
            problemas.push('Selecione ao menos uma transportadora.');
        let embalagens = [];
        try {
            embalagens = lerEmbalagens();
        }
        catch (erro) {
            problemas.push(erro.message);
        }
        // Canal obrigatório: qualquer transportadora sem canal bloqueia o envio inteiro.
        const semCanal = selecionadas.filter((s) => s.canal === null).map((s) => nomeTransportadoraBusca(s).toUpperCase());
        if (semCanal.length > 0)
            problemas.push(`Selecione o canal de envio para todas as transportadoras. Sem canal: ${semCanal.join(', ')}.`);
        const c = cotacaoEnvioAtual;
        for (const s of selecionadas) {
            const nome = nomeTransportadoraBusca(s).toUpperCase();
            if (s.canal === null)
                continue;
            if (s.canal === 'EMAIL' && s.emailManual.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.emailManual.trim())) {
                problemas.push(`${nome}: e-mail manual inválido.`);
            }
            if (s.canal === 'API') {
                if (embalagens.length === 0)
                    problemas.push(`${nome}: informe as dimensões da carga.`);
                if (c !== null && (c.peso === null || c.peso <= 0))
                    problemas.push(`${nome}: peso da cotação não informado.`);
                if (c !== null && (c.valorMercadoria === null || c.valorMercadoria <= 0))
                    problemas.push(`${nome}: valor da mercadoria não informado.`);
                if (c !== null && (c.cepDestino === null || c.cepDestino.trim() === ''))
                    problemas.push(`${nome}: CEP de destino não informado.`);
            }
        }
        return problemas;
    }
    function atualizarConferenciaEnvio() {
        const problemas = problemasEnvio();
        conferenciaEnvio.textContent = '';
        conferenciaEnvio.className = problemas.length === 0 ? 'fretes-conferencia fretes-conferencia-ok' : 'fretes-conferencia fretes-conferencia-alerta';
        if (problemas.length === 0) {
            conferenciaEnvio.textContent = '✓ Dados da carga completos';
        }
        else {
            for (const p of problemas) {
                const linha = document.createElement('div');
                linha.textContent = `⚠ ${p}`;
                conferenciaEnvio.appendChild(linha);
            }
        }
        const quantidade = selecionadas.length;
        botaoEnviarSolicitacoes.textContent =
            quantidade === 1 ? 'Enviar solicitação para 1 transportadora' : `Enviar solicitação para ${quantidade} transportadoras`;
        botaoEnviarSolicitacoes.disabled = problemas.length > 0 || envioBloqueadoPorStatus;
    }
    /** Chamado a cada carga do detalhe: zera a seleção ao trocar de cotação, mantém ao recarregar a mesma. */
    function prepararEnvioSolicitacoes(cotacao, encerrada) {
        if (cotacaoEnvioAtual?.id !== cotacao.id) {
            selecionadas = [];
            inputBuscaTransportadora.value = '';
            infoBuscaTransportadora.hidden = true;
            renderizarResultadosBusca([]);
            limparBuscaOmie();
            infoConferir.hidden = true;
            containerEmbalagens.textContent = '';
            adicionarLinhaEmbalagem();
            resultadoEnvio.textContent = '';
            resultadoEnvio.hidden = true;
            erroEnvio.hidden = true;
        }
        cotacaoEnvioAtual = cotacao;
        envioBloqueadoPorStatus = encerrada;
        inputBuscaTransportadora.disabled = encerrada;
        totalVolumesEmbalagens.textContent = String(totalVolumesEmbalagensValidas());
        renderizarDadosCarga();
        renderizarSelecionadas();
    }
    const ROTULOS_RESULTADO_ENVIO = {
        ENVIADO: 'ENVIADO VIA',
        FALHOU: 'FALHOU',
        NAO_ENVIADO: 'NÃO ENVIADO',
    };
    botaoEnviarSolicitacoes.addEventListener('click', () => {
        void (async () => {
            if (cotacaoAtualId === null)
                return;
            erroEnvio.hidden = true;
            const problemas = problemasEnvio();
            if (problemas.length > 0) {
                erroEnvio.textContent = problemas.join(' ');
                erroEnvio.hidden = false;
                atualizarConferenciaEnvio();
                return;
            }
            const embalagens = lerEmbalagens();
            const corpo = {
                transportadoras: selecionadas.map((s) => ({
                    id: s.id,
                    canal: s.canal,
                    emailManual: s.canal === 'EMAIL' ? textoOuNulo(s.emailManual) : null,
                })),
                cubagem: embalagens.length > 0 ? embalagens : null,
            };
            botaoEnviarSolicitacoes.disabled = true;
            try {
                const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/enviar-solicitacoes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(corpo),
                });
                if (!resposta.ok) {
                    erroEnvio.textContent = await extrairMensagemErro(resposta);
                    erroEnvio.hidden = false;
                    return;
                }
                const { resultados } = (await resposta.json());
                resultadoEnvio.textContent = '';
                for (const r of resultados) {
                    const li = document.createElement('li');
                    li.className = r.status === 'ENVIADO' ? 'fretes-envio-ok' : 'fretes-envio-falha';
                    const rotulo = r.status === 'ENVIADO' ? `${ROTULOS_RESULTADO_ENVIO.ENVIADO} ${ROTULOS_CANAL_ENVIO[r.canal].toUpperCase()}` : ROTULOS_RESULTADO_ENVIO[r.status];
                    li.textContent = `${r.transportadora.toUpperCase()} — ${rotulo}: ${r.mensagem}`;
                    resultadoEnvio.appendChild(li);
                }
                resultadoEnvio.hidden = false;
                // Só sai da seleção quem foi efetivamente enviado; falhas ficam para correção.
                const enviados = new Set(resultados.filter((r) => r.status === 'ENVIADO').map((r) => r.transportadoraId));
                selecionadas = selecionadas.filter((s) => !enviados.has(s.id));
                await carregarDetalheCotacao();
            }
            finally {
                atualizarConferenciaEnvio();
            }
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
        if (dados.pendentesValidacao.length > 0) {
            // Cabeçalho das colunas — só aparece no layout em linha (desktop), via CSS.
            const cabecalho = document.createElement('div');
            cabecalho.className = 'fretes-proposta-recebida-grade fretes-proposta-recebida-cabecalho';
            for (const rotulo of ['Transportadora', 'Canal', 'Custo', 'Prazo (dias)', 'Validade', 'Confiança', 'Observações', 'Ações']) {
                const span = document.createElement('span');
                span.textContent = rotulo;
                cabecalho.appendChild(span);
            }
            lista.appendChild(cabecalho);
        }
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
        // Layout em linha (desktop: uma proposta por linha, colunas alinhadas com o cabeçalho
        // da lista; tela estreita: empilhado). Só apresentação — mesmos campos e mesmas ações.
        const card = document.createElement('section');
        card.className = 'fretes-proposta-recebida';
        const grade = document.createElement('div');
        grade.className = 'fretes-proposta-recebida-grade';
        card.appendChild(grade);
        /** Célula com rótulo próprio (visível só no layout empilhado; no desktop o cabeçalho da lista faz esse papel). */
        const celula = (rotulo, classeExtra = '') => {
            const div = document.createElement('div');
            div.className = `fretes-proposta-celula ${classeExtra}`.trim();
            const span = document.createElement('span');
            span.className = 'fretes-proposta-celula-rotulo';
            span.textContent = rotulo;
            div.appendChild(span);
            grade.appendChild(div);
            return div;
        };
        const texto = (container, valor, classe = 'fretes-proposta-celula-valor') => {
            const span = document.createElement('span');
            span.className = classe;
            span.textContent = valor;
            container.appendChild(span);
        };
        const celulaTransportadora = celula('Transportadora', 'fretes-proposta-celula-transportadora');
        texto(celulaTransportadora, transportadora?.nomeRazaoSocial ?? 'Transportadora');
        if (proposta.requerRevisao)
            texto(celulaTransportadora, '⚠ Requer revisão', 'fretes-proposta-alerta');
        const celulaCanal = celula('Canal');
        texto(celulaCanal, origem !== null ? ROTULOS_CANAL[origem.resposta.canal] : '—');
        if (origem !== null)
            texto(celulaCanal, formatarDataHoraOuTraco(origem.resposta.dataRecebimento), 'fretes-proposta-celula-detalhe');
        const campoEditavel = (rotulo, input, classeExtra = '') => {
            input.setAttribute('aria-label', rotulo);
            celula(rotulo, classeExtra).appendChild(input);
        };
        const inputCusto = document.createElement('input');
        inputCusto.type = 'number';
        inputCusto.min = '0';
        inputCusto.step = '0.01';
        inputCusto.value = String(proposta.valorCusto);
        campoEditavel('Custo (transportadora)', inputCusto);
        const inputPrazo = document.createElement('input');
        inputPrazo.type = 'number';
        inputPrazo.min = '0';
        inputPrazo.step = '1';
        inputPrazo.value = proposta.prazoDias !== null ? String(proposta.prazoDias) : '';
        campoEditavel('Prazo (dias)', inputPrazo);
        const inputValidade = document.createElement('input');
        inputValidade.type = 'date';
        inputValidade.value = proposta.validade ?? '';
        campoEditavel('Validade', inputValidade);
        const confiancaExtraida = origem?.extracao.dadosExtraidos.confianca ?? null;
        const celulaConfianca = celula('Confiança');
        texto(celulaConfianca, confiancaExtraida !== null ? `${Math.round(confiancaExtraida * 100)}%` : '—');
        celulaConfianca.title = 'Apenas alerta — nunca decide sozinha';
        const inputObs = document.createElement('input');
        inputObs.type = 'text';
        inputObs.value = proposta.observacoes ?? '';
        campoEditavel('Observações', inputObs, 'fretes-proposta-celula-observacoes');
        const celulaAcoes = celula('Ações', 'fretes-proposta-celula-acoes');
        // Informações de apoio (abaixo da linha): componentes adicionais sempre visíveis (afetam a
        // conferência do custo); a mensagem original fica recolhida para não alongar o card.
        if (origem !== null) {
            if (origem.extracao.dadosExtraidos.taxas !== null && origem.extracao.dadosExtraidos.taxas.length > 0) {
                const taxas = document.createElement('p');
                taxas.className = 'filtro-data-legenda fretes-proposta-apoio';
                taxas.textContent = `Componentes adicionais informados: ${origem.extracao.dadosExtraidos.taxas.map((t) => `${t.nome}: ${formatarMoeda(t.valor)}`).join(', ')} — confira se devem ser somados ao custo.`;
                card.appendChild(taxas);
            }
            const detalhes = document.createElement('details');
            detalhes.className = 'fretes-proposta-apoio';
            const resumo = document.createElement('summary');
            resumo.textContent = `Mensagem original (${ROTULOS_CANAL[origem.resposta.canal]}, ${formatarDataHoraOuTraco(origem.resposta.dataRecebimento)})`;
            detalhes.appendChild(resumo);
            const conteudo = document.createElement('p');
            conteudo.className = 'filtro-data-legenda fretes-proposta-mensagem';
            conteudo.textContent = origem.resposta.conteudoBruto ?? '—';
            detalhes.appendChild(conteudo);
            card.appendChild(detalhes);
        }
        const erro = document.createElement('p');
        erro.className = 'painel-login-erro';
        erro.hidden = true;
        card.appendChild(erro);
        const botaoConfirmar = document.createElement('button');
        botaoConfirmar.type = 'button';
        botaoConfirmar.className = 'botao-secundario';
        botaoConfirmar.textContent = 'Confirmar';
        botaoConfirmar.title = 'Confirma usando os valores desta linha';
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
        celulaAcoes.appendChild(botaoConfirmar);
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
        celulaAcoes.appendChild(botaoRejeitar);
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
    /** Fase 4A.5 — "Pedido" (padrão, preserva o fluxo já existente) ou "Orçamento"; mesmo formulário, endpoint diferente. */
    function tipoDocumentoOmieSelecionado() {
        const marcado = document.querySelector('input[name="tipoDocumentoOmie"]:checked');
        return marcado?.value === 'ORCAMENTO' ? 'ORCAMENTO' : 'PEDIDO';
    }
    function segmentoRotaOmie(tipo) {
        return tipo === 'ORCAMENTO' ? 'orcamentos' : 'pedidos';
    }
    function rotuloDocumentoOmie(tipo) {
        return tipo === 'ORCAMENTO' ? 'orçamento' : 'pedido';
    }
    Array.from(document.querySelectorAll('input[name="tipoDocumentoOmie"]')).forEach((radio) => {
        radio.addEventListener('change', () => {
            const tipo = tipoDocumentoOmieSelecionado();
            el('fretes-importar-titulo').textContent = `Importar cotação de um ${tipo === 'ORCAMENTO' ? 'Orçamento' : 'Pedido'} Omie`;
            el('fretes-importar-numero-label').textContent = `Número do ${tipo === 'ORCAMENTO' ? 'Orçamento' : 'Pedido'} Omie`;
            el('fretes-importar-botao-buscar').textContent = `Buscar ${rotuloDocumentoOmie(tipo)}`;
        });
    });
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
        linhaInfo(infoPedido, 'Tipo de documento', preparacao.documentoOmieTipo === 'ORCAMENTO' ? `Orçamento (etapa: ${preparacao.rotuloEtapaOmie})` : `Pedido (etapa: ${preparacao.rotuloEtapaOmie})`);
        linhaInfo(infoPedido, 'Número do documento', preparacao.pedidoOmieNumero);
        linhaInfo(infoPedido, 'Cliente', textoOuTraco(preparacao.clienteNome));
        linhaInfo(infoPedido, 'Vendedor', preparacao.vendedorNome ?? 'Vendedor não identificado');
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
            const segmento = segmentoRotaOmie(tipoDocumentoOmieSelecionado());
            carregandoImportarOmie.hidden = false;
            el('fretes-importar-botao-buscar').disabled = true;
            try {
                const resposta = await fetch(`/api/fretes/omie/${segmento}/${encodeURIComponent(numero)}/preparar`);
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
                tipoDocumentoOmieAtual = tipoDocumentoOmieSelecionado();
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
            const resposta = await fetch(`/api/fretes/omie/${segmentoRotaOmie(tipoDocumentoOmieAtual)}/${encodeURIComponent(numeroPedidoOmieAtual)}/confirmar`, {
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
    abaCentralLogistica.addEventListener('click', () => {
        mostrarSubAba('central-logistica');
        void carregarCentralLogistica();
    });
    abaCentralVendedor.addEventListener('click', () => {
        mostrarSubAba('central-vendedor');
        void carregarCentralVendedor();
    });
    abaAprovacoesValorMinimo.addEventListener('click', () => {
        mostrarSubAba('aprovacoes-valor-minimo');
        void carregarAprovacoesValorMinimo();
    });
    abaHistoricoCliente.addEventListener('click', () => {
        mostrarSubAba('historico-cliente');
    });
    return {
        ativar() {
            if (ativado)
                return;
            ativado = true;
            aplicarVisibilidadeCentrais();
            mostrarSubAba('dashboard');
            void carregarDashboard();
            void carregarParametrosFiscais();
            void carregarTransportadoras();
            void carregarVeiculos();
            void atualizarBadgePendentes();
        },
    };
}
