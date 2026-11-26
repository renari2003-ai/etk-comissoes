/**
 * Modo "Precificação" — etapa 2: tabela fiscal da formação de preço.
 * Quem tem a permissão `precificacao` VÊ a tabela; só o administrador edita e vê o histórico.
 * Apresentação apenas: toda validação e toda regra ficam no servidor (`/api/precificacao/...`).
 * Percentuais em pontos (9,25 = 9,25%), como na API.
 */
import { obterUsuarioLogado } from './auth.js';
import { inicializarCustosManuais } from './custosManuaisTela.js';
// TEMPORÁRIO: diagnóstico do custo — remover junto com a rota antes de produção.
import { inicializarDiagnosticoCusto } from './diagnosticoCustoTela.js';
const CAMPOS_GERAIS = [
    { chave: 'pisCofins', rotulo: 'PIS/COFINS não cumulativo (%)', dica: 'Crédito na compra e débito na venda' },
    { chave: 'irCs', rotulo: 'IRPJ + CSLL sobre o lucro (%)' },
    { chave: 'icmsInternoMgVenda', rotulo: 'ICMS interno de MG na venda — geral (%)', dica: 'Cenário B, quando o NCM não tem exceção' },
    { chave: 'icmsInternoMgCompra', rotulo: 'ICMS interno de MG na compra — fornecedor de MG sem PTA (%)', dica: 'Fornecedor de MG com PTA: 0% (diferimento)' },
    { chave: 'icmsInterestadualCompra', rotulo: 'ICMS interestadual na compra (%)', dica: 'Entrada em MG vinda de qualquer UF' },
    { chave: 'icmsImportadoVenda', rotulo: 'ICMS de importado na venda (%)' },
    { chave: 'icmsImportadoCompra', rotulo: 'ICMS de importado na compra (%)' },
    {
        chave: 'percentualRecolhimentoIcms',
        rotulo: 'Recolhimento do ICMS na venda a contribuinte (%)',
        dica: 'PTA da ETK: 0% hoje; transição da Reforma (2029–2033)',
    },
    {
        chave: 'percentualRecolhimentoIcmsConsumidorFinal',
        rotulo: 'Recolhimento do ICMS na venda a não contribuinte / consumidor final (%)',
        dica: 'O PTA não se aplica: padrão 100% (MG e outras UFs, com DIFAL fora de MG)',
    },
];
const ROTULOS_CAMPO_HISTORICO = Object.fromEntries([
    ...CAMPOS_GERAIS.map((c) => [`gerais.${c.chave}`, c.rotulo]),
    ['gerais.ganhoIcmsNaBasePisCofins', 'Ganho do ICMS na base de PIS/COFINS'],
    ['gerais.percentualRecolhimentoIcmsMgNaoContribuinte', 'Recolhimento do ICMS em MG para não contribuinte (campo antigo)'],
    ['status', 'Status da tabela fiscal'],
]);
const NOME_STATUS = { PROVISORIO: 'Provisório', VALIDADO: 'Validado pelo fiscal' };
/** No histórico, o status aparece por extenso ("Validado pelo fiscal"), nunca o código cru. */
function valorHistorico(campo, valor) {
    if (valor === null || campo !== 'status')
        return valor;
    return NOME_STATUS[valor] ?? valor;
}
function el(id) {
    const elemento = document.getElementById(id);
    if (elemento === null)
        throw new Error(`Elemento #${id} não encontrado`);
    return elemento;
}
function rotuloCampoHistorico(campo) {
    const fixo = ROTULOS_CAMPO_HISTORICO[campo];
    if (fixo !== undefined)
        return fixo;
    const uf = /^uf\.([A-Z]{2})\.(icmsInterestadualVenda|aliquotaInterna)$/.exec(campo);
    if (uf !== null)
        return `${uf[1]} — ${uf[2] === 'aliquotaInterna' ? 'alíquota interna' : 'ICMS interestadual de venda'}`;
    const ncm = /^ncm\.(\d{8})$/.exec(campo);
    if (ncm !== null)
        return `Exceção MG — NCM ${ncm[1]}`;
    const ipi = /^ipi.(d{8})$/.exec(campo);
    if (ipi !== null)
        return `IPI — NCM ${ipi[1]}`;
    return campo;
}
async function lerMensagemDeErro(resposta) {
    try {
        const corpo = (await resposta.json());
        return corpo.erro ?? corpo.mensagem ?? corpo.motivo ?? `Erro ${resposta.status}`;
    }
    catch {
        return `Erro ${resposta.status}`;
    }
}
const ROTULO_IPI_NCM = 'Alíquota de IPI do NCM (%)';
export function inicializarFormacaoPreco() {
    const form = el('precificacao-form-parametros');
    const camposGerais = el('precificacao-campos-gerais');
    const tbodyUfs = el('precificacao-tbody-ufs');
    const tbodyNcm = el('precificacao-tbody-ncm');
    const botaoAdicionarNcm = el('precificacao-adicionar-ncm');
    const tbodyIpi = el('precificacao-tbody-ipi');
    const botaoAdicionarIpi = el('precificacao-adicionar-ipi');
    const botaoSalvar = el('precificacao-salvar');
    const textoAtualizado = el('precificacao-parametros-atualizado');
    const textoErro = el('precificacao-parametros-erro');
    const textoOk = el('precificacao-parametros-ok');
    const secaoHistorico = el('precificacao-secao-historico');
    const tbodyHistorico = el('precificacao-tbody-historico');
    const textoErroHistorico = el('precificacao-historico-erro');
    const botaoRecarregar = el('precificacao-recarregar');
    const textoStatus = el('precificacao-status-fiscal-texto');
    const textoStatusQuem = el('precificacao-status-fiscal-quem');
    const botaoStatus = el('precificacao-status-fiscal-botao');
    const tarjaStatus = el('precificacao-status-fiscal-tarja');
    let statusAtual = 'PROVISORIO';
    const diagnostico = inicializarDiagnosticoCusto();
    const custosManuais = inicializarCustosManuais();
    let ehAdmin = false;
    /** Versão lida do servidor — volta no PUT (concorrência otimista: 409 se outro admin salvou antes). */
    let versaoLida = null;
    /** Há edição não salva? Então trocar de aba e voltar não descarta o que foi digitado. */
    let sujo = false;
    function mostrarErro(mensagem, oferecerRecarga = false) {
        textoErro.textContent = mensagem ?? '';
        textoErro.hidden = mensagem === null;
        botaoRecarregar.hidden = !oferecerRecarga;
    }
    function inputNumero(valor, rotulo, nome) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '100';
        input.step = '0.0001';
        input.name = nome;
        input.value = valor === null ? '' : String(valor);
        input.setAttribute('aria-label', rotulo);
        input.disabled = !ehAdmin;
        return input;
    }
    function renderizarGerais(g) {
        camposGerais.replaceChildren();
        for (const campo of CAMPOS_GERAIS) {
            const div = document.createElement('div');
            div.className = 'campo-filtro';
            const label = document.createElement('label');
            label.htmlFor = `precificacao-geral-${campo.chave}`;
            label.textContent = campo.rotulo;
            const input = inputNumero(g[campo.chave], campo.rotulo, campo.chave);
            input.id = `precificacao-geral-${campo.chave}`;
            input.required = true;
            div.append(label, input);
            if (campo.dica !== undefined) {
                const dica = document.createElement('small');
                dica.className = 'filtro-data-legenda';
                dica.textContent = campo.dica;
                div.append(dica);
            }
            camposGerais.append(div);
        }
        const divChave = document.createElement('div');
        divChave.className = 'campo-filtro campo-filtro-checkbox';
        const labelChave = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'ganhoIcmsNaBasePisCofins';
        checkbox.checked = g.ganhoIcmsNaBasePisCofins;
        checkbox.disabled = !ehAdmin;
        labelChave.append(checkbox, ' Ganho do ICMS entra na base de PIS/COFINS (desligado pela decisão de 2025)');
        divChave.append(labelChave);
        camposGerais.append(divChave);
    }
    function renderizarUfs(ufs) {
        tbodyUfs.replaceChildren();
        for (const linha of ufs) {
            const tr = document.createElement('tr');
            tr.dataset.uf = linha.uf;
            const tdUf = document.createElement('td');
            tdUf.textContent = linha.uf;
            const tdVenda = document.createElement('td');
            tdVenda.append(inputNumero(linha.icmsInterestadualVenda, `ICMS interestadual de venda para ${linha.uf} (%)`, 'icmsInterestadualVenda'));
            const tdInterna = document.createElement('td');
            const interna = inputNumero(linha.aliquotaInterna, `Alíquota interna de ${linha.uf} (%)`, 'aliquotaInterna');
            interna.placeholder = 'não configurada';
            tdInterna.append(interna);
            tr.append(tdUf, tdVenda, tdInterna);
            tbodyUfs.append(tr);
        }
    }
    /** Linha de NCM + alíquota (exceção de ICMS de MG ou IPI por NCM). */
    function adicionarLinhaNcm(excecao, tbody = tbodyNcm, rotuloAliquota = 'Alíquota interna de MG para o NCM (%)') {
        const tr = document.createElement('tr');
        const tdNcm = document.createElement('td');
        const inputNcm = document.createElement('input');
        inputNcm.type = 'text';
        inputNcm.name = 'ncm';
        inputNcm.inputMode = 'numeric';
        inputNcm.pattern = '\\d{8}';
        inputNcm.maxLength = 8;
        inputNcm.placeholder = '8 dígitos';
        inputNcm.value = excecao?.ncm ?? '';
        inputNcm.setAttribute('aria-label', 'NCM (8 dígitos, sem pontos)');
        inputNcm.disabled = !ehAdmin;
        tdNcm.append(inputNcm);
        const tdAliquota = document.createElement('td');
        tdAliquota.append(inputNumero(excecao?.aliquota ?? null, rotuloAliquota, 'aliquota'));
        const tdAcoes = document.createElement('td');
        if (ehAdmin) {
            const remover = document.createElement('button');
            remover.type = 'button';
            remover.className = 'botao-secundario';
            remover.textContent = 'Remover';
            remover.addEventListener('click', () => tr.remove());
            tdAcoes.append(remover);
        }
        tr.append(tdNcm, tdAliquota, tdAcoes);
        tbody.append(tr);
    }
    function renderizar(tabela) {
        versaoLida = tabela.versao;
        sujo = false;
        renderizarGerais(tabela.gerais);
        renderizarUfs(tabela.ufs);
        tbodyNcm.replaceChildren();
        for (const e of tabela.excecoesNcm)
            adicionarLinhaNcm(e);
        tbodyIpi.replaceChildren();
        for (const e of tabela.ipiNcm)
            adicionarLinhaNcm(e, tbodyIpi, ROTULO_IPI_NCM);
        textoAtualizado.textContent =
            tabela.atualizadoEm === null
                ? 'Valores iniciais — ainda não editados.'
                : `Última alteração: ${new Date(tabela.atualizadoEm).toLocaleString('pt-BR')} por ${tabela.atualizadoPor ?? '—'}.`;
        botaoSalvar.hidden = !ehAdmin;
        botaoAdicionarNcm.hidden = !ehAdmin;
        botaoAdicionarIpi.hidden = !ehAdmin;
        renderizarStatus(tabela);
    }
    function renderizarStatus(tabela) {
        statusAtual = tabela.status;
        textoStatus.textContent = NOME_STATUS[tabela.status] ?? tabela.status;
        textoStatusQuem.textContent =
            tabela.statusAlteradoEm === null ? '' : ` — desde ${new Date(tabela.statusAlteradoEm).toLocaleString('pt-BR')}, por ${tabela.statusAlteradoPor ?? '—'}`;
        tarjaStatus.hidden = tabela.status === 'VALIDADO';
        botaoStatus.hidden = !ehAdmin;
        botaoStatus.textContent = tabela.status === 'VALIDADO' ? 'Voltar para "Provisório"' : 'Marcar como "Validado pelo fiscal"';
    }
    /** Número do campo; vazio → `null` (só onde a API aceita). Entrada que o navegador não entende nunca vira "vazio": ver `camposInvalidos`. */
    function lerNumero(input) {
        if (input === null || input.value.trim() === '')
            return null;
        return input.valueAsNumber;
    }
    /**
     * Campos numéricos com texto que o navegador não conseguiu ler (ex.: "17,5" num navegador que só
     * aceita ponto, "1.2.3"). O `value` deles volta vazio — sem esta checagem, a alíquota interna da
     * UF viraria "não configurada" sem aviso nenhum.
     */
    function camposInvalidos() {
        const numericos = Array.from(form.querySelectorAll('input[type="number"]'));
        const invalidos = numericos.filter((i) => i.validity.badInput);
        for (const input of numericos) {
            input.toggleAttribute('aria-invalid', invalidos.includes(input));
        }
        return invalidos;
    }
    function montarPayload() {
        const gerais = {};
        for (const campo of CAMPOS_GERAIS)
            gerais[campo.chave] = lerNumero(form.querySelector(`input[name="${campo.chave}"]`));
        gerais.ganhoIcmsNaBasePisCofins = form.querySelector('input[name="ganhoIcmsNaBasePisCofins"]')?.checked ?? false;
        const ufs = Array.from(tbodyUfs.querySelectorAll('tr')).map((tr) => ({
            uf: tr.dataset.uf,
            icmsInterestadualVenda: lerNumero(tr.querySelector('input[name="icmsInterestadualVenda"]')),
            aliquotaInterna: lerNumero(tr.querySelector('input[name="aliquotaInterna"]')),
        }));
        const lerListaNcm = (tbody) => Array.from(tbody.querySelectorAll('tr')).map((tr) => ({
            ncm: tr.querySelector('input[name="ncm"]')?.value.trim() ?? '',
            aliquota: lerNumero(tr.querySelector('input[name="aliquota"]')),
        }));
        return { versao: versaoLida, gerais, ufs, excecoesNcm: lerListaNcm(tbodyNcm), ipiNcm: lerListaNcm(tbodyIpi) };
    }
    async function carregarHistorico() {
        secaoHistorico.hidden = !ehAdmin;
        textoErroHistorico.hidden = true;
        if (!ehAdmin)
            return;
        let registros;
        try {
            const resposta = await fetch('/api/precificacao/parametros-fiscais/historico?limite=100');
            if (!resposta.ok)
                throw new Error(await lerMensagemDeErro(resposta));
            registros = (await resposta.json());
        }
        catch (erro) {
            textoErroHistorico.textContent = `Não foi possível carregar o histórico: ${erro instanceof Error ? erro.message : 'falha de rede'}.`;
            textoErroHistorico.hidden = false;
            return;
        }
        tbodyHistorico.replaceChildren();
        if (registros.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5;
            td.textContent = 'Nenhuma alteração registrada.';
            tr.append(td);
            tbodyHistorico.append(tr);
            return;
        }
        for (const r of registros) {
            const tr = document.createElement('tr');
            for (const texto of [new Date(r.alteradoEm).toLocaleString('pt-BR'), r.usuarioNome, rotuloCampoHistorico(r.campo), valorHistorico(r.campo, r.valorAnterior) ?? '—', valorHistorico(r.campo, r.valorNovo) ?? '— (removido)']) {
                const td = document.createElement('td');
                td.textContent = texto;
                tr.append(td);
            }
            tbodyHistorico.append(tr);
        }
    }
    async function carregar() {
        ehAdmin = obterUsuarioLogado()?.papel === 'administrador';
        mostrarErro(null);
        textoOk.hidden = true;
        try {
            const resposta = await fetch('/api/precificacao/parametros-fiscais');
            if (!resposta.ok) {
                mostrarErro(`Não foi possível carregar a tabela fiscal: ${await lerMensagemDeErro(resposta)}`);
                return;
            }
            renderizar((await resposta.json()));
        }
        catch {
            mostrarErro('Falha de rede ao carregar a tabela fiscal. Tente de novo.');
            return;
        }
        await carregarHistorico();
    }
    botaoAdicionarNcm.addEventListener('click', () => {
        adicionarLinhaNcm(null);
        sujo = true;
    });
    form.addEventListener('input', () => {
        sujo = true;
    });
    botaoAdicionarIpi.addEventListener('click', () => {
        adicionarLinhaNcm(null, tbodyIpi, ROTULO_IPI_NCM);
        sujo = true;
    });
    for (const tbody of [tbodyNcm, tbodyIpi]) {
        tbody.addEventListener('click', (evento) => {
            if (evento.target.closest('button') !== null)
                sujo = true;
        });
    }
    botaoRecarregar.addEventListener('click', () => {
        void carregar();
    });
    botaoStatus.addEventListener('click', () => {
        if (!ehAdmin)
            return;
        if (sujo) {
            mostrarErro('Salve (ou recarregue) as alterações da tabela antes de mudar o status.');
            return;
        }
        if (versaoLida === null) {
            mostrarErro('A tabela fiscal não foi carregada. Recarregue a tela antes de mudar o status.', true);
            return;
        }
        const novo = statusAtual === 'VALIDADO' ? 'PROVISORIO' : 'VALIDADO';
        const pergunta = novo === 'VALIDADO'
            ? 'Confirmar que o fiscal validou TODOS os parâmetros desta tabela? A tarja azul sai de todos os cálculos. (Qualquer edição posterior volta a tabela para "Provisório".)'
            : 'Voltar a tabela para "Provisório"? Todos os cálculos voltam a mostrar a tarja azul.';
        if (!window.confirm(pergunta))
            return;
        void (async () => {
            mostrarErro(null);
            textoOk.hidden = true;
            botaoStatus.disabled = true;
            try {
                const resposta = await fetch('/api/precificacao/parametros-fiscais/status', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ versao: versaoLida, status: novo }),
                });
                if (!resposta.ok) {
                    mostrarErro(await lerMensagemDeErro(resposta), resposta.status === 409);
                    return;
                }
                renderizar((await resposta.json()));
                textoOk.textContent = `Status alterado para "${NOME_STATUS[novo]}".`;
                textoOk.hidden = false;
                await carregarHistorico();
            }
            catch {
                mostrarErro('Falha de rede ao mudar o status. Tente de novo.');
            }
            finally {
                botaoStatus.disabled = false;
            }
        })();
    });
    form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        if (!ehAdmin)
            return;
        void (async () => {
            mostrarErro(null);
            textoOk.hidden = true;
            const invalidos = camposInvalidos();
            if (invalidos.length > 0) {
                mostrarErro(`${invalidos.length} campo(s) com número que não foi entendido (use ponto como separador decimal, ex.: 17.5). Corrija os campos destacados antes de salvar.`);
                invalidos[0].focus();
                return;
            }
            botaoSalvar.disabled = true;
            try {
                const resposta = await fetch('/api/precificacao/parametros-fiscais', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(montarPayload()),
                });
                if (!resposta.ok) {
                    mostrarErro(await lerMensagemDeErro(resposta), resposta.status === 409);
                    return;
                }
                const dados = (await resposta.json());
                renderizar(dados);
                textoOk.textContent = dados.alteracoes === 0 ? 'Nada mudou — nada foi gravado.' : `Tabela fiscal salva (${dados.alteracoes} alteração(ões) no histórico).`;
                textoOk.hidden = false;
                await carregarHistorico();
            }
            catch {
                mostrarErro('Falha de rede ao salvar. Tente de novo.');
            }
            finally {
                botaoSalvar.disabled = false;
            }
        })();
    });
    return {
        ativar: () => {
            diagnostico.ativar(obterUsuarioLogado()?.papel === 'administrador');
            custosManuais.ativar();
            // Edição não salva: não recarrega por cima (o admin pode ter só trocado de aba).
            if (sujo)
                return;
            void carregar();
        },
    };
}
