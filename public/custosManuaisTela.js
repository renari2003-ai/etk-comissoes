/**
 * Modo "Precificação" — etapa 3: custos manuais salvos.
 * Quem tem a permissão `precificacao` lê, inclui, altera e remove; toda mudança fica no histórico.
 * Apresentação apenas: toda validação e toda regra (PTA só em MG, importada só fora de MG, IPI 0
 * no Simples, prioridade sobre o Omie) ficam no servidor (`/api/precificacao/custos-manuais`).
 * A tela só esconde/trava os campos que não se aplicam, para o operador não errar.
 */
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const ROTULO_TIPO = {
    INDUSTRIA_NORMAL: 'Indústria normal (Lucro Real/Presumido)',
    SIMPLES_NACIONAL: 'Simples Nacional',
    COMERCIO: 'Comércio/distribuidor',
};
const ROTULO_CAMPO = {
    valorNota: 'Valor da nota',
    ufFornecedor: 'UF do fornecedor',
    diferimentoPta: 'Fornecedor de MG com PTA',
    mercadoriaImportada: 'Mercadoria importada',
    tipoFornecedor: 'Tipo de fornecedor',
    ipiPercentual: 'IPI %',
    registro: 'Custo manual',
};
const DICA_IPI = {
    INDUSTRIA_NORMAL: 'Vazio = alíquota do NCM no cadastro do componente no Omie. Sem NCM/IPI no cadastro, o item entra sem crédito e o preço fica incompleto.',
    SIMPLES_NACIONAL: 'Simples Nacional não dá crédito de IPI: sempre 0.',
    COMERCIO: 'Só se a nota destacar IPI (ex.: distribuidor de importado equiparado a indústria).',
};
function el(id) {
    const elemento = document.getElementById(id);
    if (elemento === null)
        throw new Error(`Elemento #${id} não encontrado`);
    return elemento;
}
async function lerMensagemDeErro(resposta) {
    try {
        const corpo = (await resposta.json());
        return corpo.erro ?? corpo.mensagem ?? `Erro ${resposta.status}`;
    }
    catch {
        return `Erro ${resposta.status}`;
    }
}
/** "12,86" ou "12.86" → 12.86; vazio → null; qualquer outra coisa → NaN (o servidor recusaria). */
function lerNumero(texto) {
    const t = texto.trim();
    if (t === '')
        return null;
    if (!/^\d+([.,]\d+)?$/.test(t))
        return Number.NaN;
    return Number(t.replace(',', '.'));
}
function numeroBr(v, casas = 6) {
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
}
function textoHistorico(campo, valor) {
    if (valor === null)
        return '—';
    if (campo === 'registro')
        return valor === 'removido' ? 'removido (volta a valer o Omie)' : valor;
    if (campo === 'diferimentoPta' || campo === 'mercadoriaImportada')
        return valor === 'true' ? 'Sim' : 'Não';
    if (campo === 'tipoFornecedor')
        return ROTULO_TIPO[valor] ?? valor;
    if (campo === 'valorNota' && /^\d+(\.\d+)?$/.test(valor))
        return `R$ ${numeroBr(Number(valor))}`;
    return valor;
}
export function inicializarCustosManuais() {
    const form = el('precificacao-form-custo-manual');
    const inputCodigo = el('precificacao-custo-codigo');
    const inputValor = el('precificacao-custo-valor');
    const selectUf = el('precificacao-custo-uf');
    const campoPta = el('precificacao-custo-campo-pta');
    const selectPta = el('precificacao-custo-pta');
    const campoImportada = el('precificacao-custo-campo-importada');
    const selectImportada = el('precificacao-custo-importada');
    const selectTipo = el('precificacao-custo-tipo');
    const inputIpi = el('precificacao-custo-ipi');
    const dicaIpi = el('precificacao-custo-ipi-dica');
    const botaoSalvar = el('precificacao-custo-salvar');
    const botaoLimpar = el('precificacao-custo-limpar');
    const textoModo = el('precificacao-custo-modo');
    const textoErro = el('precificacao-custo-erro');
    const textoOk = el('precificacao-custo-ok');
    const tbody = el('precificacao-tbody-custos');
    const tbodyHistorico = el('precificacao-tbody-custos-historico');
    const textoErroHistorico = el('precificacao-custos-historico-erro');
    selectUf.replaceChildren(...['', ...UFS].map((uf) => {
        const opcao = document.createElement('option');
        opcao.value = uf;
        opcao.textContent = uf === '' ? 'Escolha…' : uf;
        return opcao;
    }));
    selectUf.value = 'MG';
    let custos = [];
    /** Versão do item em edição (`null` = item novo). */
    let versaoEmEdicao = null;
    function mostrarErro(mensagem) {
        textoErro.textContent = mensagem ?? '';
        textoErro.hidden = mensagem === null;
    }
    function mostrarOk(mensagem) {
        textoOk.textContent = mensagem ?? '';
        textoOk.hidden = mensagem === null;
    }
    /** Tipo de fornecedor do último ajuste — para saber quando o operador TROCOU de tipo. */
    let tipoAnterior = null;
    /**
     * Mostra só os campos que se aplicam (PTA só MG; importada só fora de MG) e ajusta o IPI quando o
     * tipo de fornecedor muda: Simples trava em 0; ao sair do Simples o 0 automático é limpo (vazio =
     * cadastro do Omie, na indústria normal); comércio/distribuidor começa em 0.
     */
    function ajustarCampos() {
        const ehMg = selectUf.value === 'MG';
        campoPta.hidden = !ehMg;
        campoImportada.hidden = ehMg || selectUf.value === '';
        if (!ehMg)
            selectPta.value = '';
        if (ehMg)
            selectImportada.value = 'nao';
        const tipo = selectTipo.value;
        if (tipo !== tipoAnterior) {
            if (tipo === 'SIMPLES_NACIONAL')
                inputIpi.value = '0';
            else if (tipo === 'COMERCIO')
                inputIpi.value = '0';
            else if (tipoAnterior === 'SIMPLES_NACIONAL' || tipoAnterior === 'COMERCIO')
                inputIpi.value = '';
        }
        inputIpi.disabled = tipo === 'SIMPLES_NACIONAL';
        tipoAnterior = tipo;
        dicaIpi.textContent = DICA_IPI[tipo] ?? '';
    }
    function limparFormulario() {
        form.reset();
        versaoEmEdicao = null;
        inputCodigo.readOnly = false;
        selectUf.value = 'MG';
        // PTA sem resposta: o operador escolhe (ICMS 0% é o caso de menor custo, nunca o padrão).
        selectPta.value = '';
        selectImportada.value = 'nao';
        selectTipo.value = 'INDUSTRIA_NORMAL';
        inputIpi.value = '';
        tipoAnterior = null;
        textoModo.textContent = 'Novo custo manual';
        botaoSalvar.textContent = 'Salvar custo manual';
        ajustarCampos();
    }
    function editar(c) {
        versaoEmEdicao = c.versao;
        inputCodigo.value = c.codigo;
        inputCodigo.readOnly = true;
        inputValor.value = c.valorNota === null ? '' : String(c.valorNota).replace('.', ',');
        selectUf.value = c.ufFornecedor;
        selectPta.value = c.diferimentoPta ? 'sim' : 'nao';
        selectImportada.value = c.mercadoriaImportada ? 'sim' : 'nao';
        selectTipo.value = c.tipoFornecedor;
        inputIpi.value = c.ipiPercentual === null ? '' : String(c.ipiPercentual).replace('.', ',');
        // O IPI gravado vale como está: não é um tipo "trocado" agora.
        tipoAnterior = c.tipoFornecedor;
        textoModo.textContent = `Alterando ${c.codigo}`;
        botaoSalvar.textContent = 'Salvar alteração';
        ajustarCampos();
        mostrarErro(null);
        mostrarOk(null);
        inputValor.focus();
    }
    function celula(tr, texto) {
        const td = document.createElement('td');
        td.textContent = texto;
        tr.append(td);
    }
    function renderizar() {
        tbody.replaceChildren();
        if (custos.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 8;
            td.textContent = 'Nenhum custo manual salvo.';
            tr.append(td);
            tbody.append(tr);
            return;
        }
        for (const c of custos) {
            const tr = document.createElement('tr');
            celula(tr, c.codigo);
            celula(tr, c.valorNota === null ? '— (só dados fiscais)' : `R$ ${numeroBr(c.valorNota)}`);
            celula(tr, c.ufFornecedor);
            celula(tr, c.ufFornecedor === 'MG' ? `PTA: ${c.diferimentoPta ? 'Sim' : 'Não'}` : `Importada: ${c.mercadoriaImportada ? 'Sim' : 'Não'}`);
            celula(tr, ROTULO_TIPO[c.tipoFornecedor] ?? c.tipoFornecedor);
            celula(tr, c.ipiPercentual === null ? 'do cadastro' : `${numeroBr(c.ipiPercentual, 4)}%`);
            celula(tr, `${c.atualizadoPor} — ${new Date(c.atualizadoEm).toLocaleString('pt-BR')}`);
            const tdAcoes = document.createElement('td');
            const botaoEditar = document.createElement('button');
            botaoEditar.type = 'button';
            botaoEditar.className = 'botao-secundario';
            botaoEditar.textContent = 'Alterar';
            botaoEditar.setAttribute('aria-label', `Alterar o custo manual de ${c.codigo}`);
            botaoEditar.addEventListener('click', () => editar(c));
            const botaoRemover = document.createElement('button');
            botaoRemover.type = 'button';
            botaoRemover.className = 'botao-secundario';
            botaoRemover.textContent = 'Remover';
            botaoRemover.setAttribute('aria-label', `Remover o custo manual de ${c.codigo}`);
            botaoRemover.addEventListener('click', () => void remover(c));
            tdAcoes.append(botaoEditar, ' ', botaoRemover);
            tr.append(tdAcoes);
            tbody.append(tr);
        }
    }
    async function carregarHistorico() {
        textoErroHistorico.hidden = true;
        try {
            const resposta = await fetch('/api/precificacao/custos-manuais/historico?limite=100');
            if (!resposta.ok) {
                textoErroHistorico.textContent = `Não foi possível carregar o histórico: ${await lerMensagemDeErro(resposta)}`;
                textoErroHistorico.hidden = false;
                return;
            }
            const registros = (await resposta.json());
            tbodyHistorico.replaceChildren();
            if (registros.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 6;
                td.textContent = 'Nenhuma alteração registrada.';
                tr.append(td);
                tbodyHistorico.append(tr);
                return;
            }
            for (const r of registros) {
                const tr = document.createElement('tr');
                celula(tr, new Date(r.alteradoEm).toLocaleString('pt-BR'));
                celula(tr, r.usuarioNome);
                celula(tr, r.codigo);
                celula(tr, ROTULO_CAMPO[r.campo] ?? r.campo);
                celula(tr, textoHistorico(r.campo, r.valorAnterior));
                celula(tr, textoHistorico(r.campo, r.valorNovo));
                tbodyHistorico.append(tr);
            }
        }
        catch {
            textoErroHistorico.textContent = 'Falha de rede ao carregar o histórico.';
            textoErroHistorico.hidden = false;
        }
    }
    async function carregar() {
        mostrarErro(null);
        try {
            const resposta = await fetch('/api/precificacao/custos-manuais');
            if (!resposta.ok) {
                mostrarErro(`Não foi possível carregar os custos manuais: ${await lerMensagemDeErro(resposta)}`);
                return;
            }
            custos = (await resposta.json());
            renderizar();
        }
        catch {
            mostrarErro('Falha de rede ao carregar os custos manuais. Tente de novo.');
            return;
        }
        await carregarHistorico();
    }
    async function remover(c) {
        if (!window.confirm(`Remover o custo manual de ${c.codigo}? Volta a valer o custo do Omie (ou "sem custo").`))
            return;
        mostrarErro(null);
        mostrarOk(null);
        try {
            const resposta = await fetch(`/api/precificacao/custos-manuais/${encodeURIComponent(c.codigo)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ versao: c.versao }),
            });
            if (!resposta.ok) {
                mostrarErro(await lerMensagemDeErro(resposta));
                return;
            }
            if (versaoEmEdicao !== null && inputCodigo.value === c.codigo)
                limparFormulario();
            mostrarOk(`Custo manual de ${c.codigo} removido.`);
            await carregar();
        }
        catch {
            mostrarErro('Falha de rede ao remover. Tente de novo.');
        }
    }
    selectUf.addEventListener('change', ajustarCampos);
    selectTipo.addEventListener('change', ajustarCampos);
    botaoLimpar.addEventListener('click', () => {
        limparFormulario();
        mostrarErro(null);
        mostrarOk(null);
    });
    form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            mostrarErro(null);
            mostrarOk(null);
            const codigo = inputCodigo.value.trim().toUpperCase();
            const valorNota = lerNumero(inputValor.value);
            const ipiPercentual = lerNumero(inputIpi.value);
            if (codigo === '')
                return mostrarErro('Informe o código do componente.');
            if (Number.isNaN(valorNota))
                return mostrarErro('Valor da nota não entendido (ex.: 12,86).');
            if (Number.isNaN(ipiPercentual))
                return mostrarErro('IPI % não entendido (ex.: 12 ou 6,5).');
            if (selectUf.value === '')
                return mostrarErro('Escolha a UF do fornecedor.');
            if (selectUf.value === 'MG' && selectPta.value === '')
                return mostrarErro('Diga se o fornecedor de MG tem PTA (Sim ou Não).');
            const corpo = {
                versao: versaoEmEdicao,
                valorNota,
                ufFornecedor: selectUf.value,
                diferimentoPta: selectUf.value === 'MG' && selectPta.value === 'sim',
                mercadoriaImportada: selectUf.value !== 'MG' && selectImportada.value === 'sim',
                tipoFornecedor: selectTipo.value,
                ipiPercentual,
            };
            botaoSalvar.disabled = true;
            try {
                const resposta = await fetch(`/api/precificacao/custos-manuais/${encodeURIComponent(codigo)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(corpo),
                });
                if (!resposta.ok) {
                    mostrarErro(await lerMensagemDeErro(resposta));
                    return;
                }
                const dados = (await resposta.json());
                limparFormulario();
                mostrarOk(dados.alteracoes === 0 ? `Nada mudou em ${dados.custo.codigo} — nada foi gravado.` : `Custo manual de ${dados.custo.codigo} salvo. Vale nos próximos cálculos, na frente do custo do Omie.`);
                await carregar();
            }
            catch {
                mostrarErro('Falha de rede ao salvar. Tente de novo.');
            }
            finally {
                botaoSalvar.disabled = false;
            }
        })();
    });
    limparFormulario();
    return {
        ativar: () => {
            // Edição em andamento: não recarrega por cima (o operador pode ter só trocado de aba).
            if (versaoEmEdicao !== null)
                return;
            void carregar();
        },
    };
}
