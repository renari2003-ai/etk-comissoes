/**
 * Modo "Precificação" — etapa 5: tela do cálculo do preço de um produto.
 * Apresentação apenas: toda regra (custo, créditos, cenário, preços, avisos) fica no servidor
 * (`POST /api/precificacao/calculo`). A tela só junta as entradas, mostra o resultado e multiplica o
 * unitário pela quantidade para os totais. Percentuais digitados em pontos (12 = 12%), como na API.
 */
const ORIGEM = {
    OMIE: 'Omie (já líquido)',
    MANUAL_SALVO: 'Manual salvo',
    MANUAL_SIMULACAO: 'Manual (só nesta simulação)',
    SEM_CUSTO: 'Sem custo',
};
const CLASSE_TARJA = { VERMELHO: 'tarja-vermelha', AMARELO: 'tarja-amarela', AZUL: 'tarja-azul' };
const CHAVE_DESPESAS = 'precificacao.ultimasDespesas';
function el(id) {
    const elemento = document.getElementById(id);
    if (elemento === null)
        throw new Error(`Elemento #${id} não encontrado.`);
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
/**
 * Número digitado em pt-BR; vazio = `null`; texto inválido = NaN.
 * Ponto com grupos de 3 dígitos é milhar ("1.500" = 1500; "1.500,25" = 1500,25); vírgula é decimal.
 * Sem vírgula, um ponto só seguido de 1, 2 ou 4+ dígitos é decimal ("12.86" = 12,86).
 */
function lerNumero(texto) {
    const t = texto.trim();
    if (t === '')
        return null;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t))
        return Number(t.replace(/\./g, '').replace(',', '.'));
    if (!/^\d+([.,]\d+)?$/.test(t))
        return Number.NaN;
    return Number(t.replace(',', '.'));
}
const reais = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (fracao) => (fracao === null ? '—' : `${(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
function celula(tr, texto) {
    const td = document.createElement('td');
    td.textContent = texto;
    tr.appendChild(td);
    return td;
}
function desenharTarjas(destino, avisos) {
    destino.replaceChildren(...avisos.map((a) => {
        const p = document.createElement('p');
        p.className = CLASSE_TARJA[a.nivel];
        p.setAttribute('role', a.nivel === 'VERMELHO' ? 'alert' : 'status');
        p.textContent = a.mensagem;
        return p;
    }));
}
export function inicializarCalculoPreco() {
    const form = el('precificacao-calculo-form');
    const inputProduto = el('precificacao-calculo-produto');
    const inputQuantidade = el('precificacao-calculo-quantidade');
    const selectTipoCliente = el('precificacao-calculo-tipo-cliente');
    const selectFinalidade = el('precificacao-calculo-finalidade');
    const blocoOmie = el('precificacao-calculo-bloco-omie');
    const blocoSimulacao = el('precificacao-calculo-bloco-simulacao');
    const inputBusca = el('precificacao-calculo-cliente-busca');
    const botaoBuscar = el('precificacao-calculo-cliente-buscar');
    const selectCliente = el('precificacao-calculo-cliente');
    const selectUf = el('precificacao-calculo-uf');
    const selectContribuinte = el('precificacao-calculo-contribuinte');
    const selectPta = el('precificacao-calculo-pta');
    const inputDespesas = el('precificacao-calculo-despesas');
    const selectComissao = el('precificacao-calculo-comissao');
    const inputMargem = el('precificacao-calculo-margem');
    const selectTipoMargem = el('precificacao-calculo-tipo-margem');
    const inputAlvo = el('precificacao-calculo-alvo');
    const botaoCalcular = el('precificacao-calculo-calcular');
    const textoStatus = el('precificacao-calculo-status');
    const textoErro = el('precificacao-calculo-erro');
    const areaResultado = el('precificacao-calculo-resultado');
    const areaAvisos = el('precificacao-calculo-avisos');
    const tarjaIncompleto = el('precificacao-calculo-incompleto');
    const cabecalho = el('precificacao-calculo-cabecalho');
    const blocoPrecos = el('precificacao-calculo-precos');
    const tbodyPrecos = el('precificacao-calculo-tbody-precos');
    const blocoReverso = el('precificacao-calculo-reverso');
    const avisosReverso = el('precificacao-calculo-reverso-avisos');
    const textoReverso = el('precificacao-calculo-reverso-texto');
    const tbodyCascata = el('precificacao-calculo-tbody-cascata');
    const tbodyItens = el('precificacao-calculo-tbody-itens');
    /** Escolhas manual × Omie feitas nesta tela (vão no próximo cálculo). */
    let escolhas = {};
    let ultimoProduto = '';
    /** Só a resposta do cálculo mais recente é desenhada (respostas fora de ordem são descartadas). */
    let numeroCalculo = 0;
    function mostrarErro(mensagem) {
        textoErro.textContent = mensagem ?? '';
        textoErro.hidden = mensagem === null;
    }
    function atualizarTipoCliente() {
        const simulacao = selectTipoCliente.value === 'simulacao';
        blocoSimulacao.hidden = !simulacao;
        blocoOmie.hidden = simulacao;
    }
    selectTipoCliente.addEventListener('change', atualizarTipoCliente);
    botaoBuscar.addEventListener('click', () => {
        void (async () => {
            mostrarErro(null);
            const termo = inputBusca.value.trim();
            const digitos = termo.replace(/\D/g, '');
            const parametro = digitos.length === 11 || digitos.length === 14 ? `cnpj=${encodeURIComponent(digitos)}` : `nome=${encodeURIComponent(termo)}`;
            botaoBuscar.disabled = true;
            try {
                const resposta = await fetch(`/api/precificacao/clientes/busca?${parametro}`, { credentials: 'same-origin' });
                if (!resposta.ok)
                    return mostrarErro(await lerMensagemDeErro(resposta));
                const clientes = (await resposta.json());
                selectCliente.replaceChildren(...(clientes.length === 0
                    ? [new Option('— nenhum cliente encontrado —', '')]
                    : clientes.map((c) => new Option(`${c.razaoSocial}${c.cnpjCpf === null ? '' : ` — ${c.cnpjCpf}`}`, String(c.codigoCliente)))));
            }
            catch {
                mostrarErro('Não foi possível buscar o cliente. Verifique a conexão.');
            }
            finally {
                botaoBuscar.disabled = false;
            }
        })();
    });
    function desenharPrecos(r) {
        tbodyPrecos.replaceChildren();
        blocoPrecos.hidden = r.precos === null;
        if (r.precos === null)
            return;
        const linhas = [
            ['Piso', r.precos.piso],
            ['Cheio', r.precos.cheio],
        ];
        for (const [nome, p] of linhas) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.scope = 'row';
            th.textContent = nome;
            tr.appendChild(th);
            if (p === null) {
                celula(tr, 'indisponível').colSpan = 7;
            }
            else {
                celula(tr, reais(p.preco));
                celula(tr, reais(p.preco * r.quantidade));
                celula(tr, reais(p.ipi));
                celula(tr, reais(p.precoComIpi));
                celula(tr, reais(p.precoComIpi * r.quantidade));
                celula(tr, pct(p.lucro.margemAntesIrCs));
                celula(tr, pct(p.lucro.margemDepoisIrCs));
            }
            tbodyPrecos.appendChild(tr);
        }
    }
    function desenharCascata(r) {
        tbodyCascata.replaceChildren();
        if (r.custo === null)
            return;
        const piso = r.precos?.piso ?? null;
        const cheio = r.precos?.cheio ?? null;
        const linhas = [
            ['Custo bruto', () => r.custo.custoBruto, r.custo.custoBruto],
            ['(−) Créditos retirados (só custo manual)', () => r.custo.creditos, r.custo.creditos],
            ['Custo líquido', () => r.custo.custoLiquido, r.custo.custoLiquido],
            ['Preço sem IPI', (p) => p.preco, null],
            ['ICMS destacado', (p) => p.lucro.icmsDestacado, null],
            ['   dele, fica no lucro', (p) => p.lucro.icmsNoLucro, null],
            ['ICMS recolhido', (p) => p.lucro.icmsRecolhido, null],
            ['PIS/COFINS', (p) => p.lucro.pisCofins, null],
            ['DIFAL', (p) => p.lucro.difal, null],
            ['Comissão', (p) => p.lucro.comissao, null],
            ['Despesas fixas', (p) => p.lucro.despesas, null],
            ['Lucro antes do IR/CS', (p) => p.lucro.lucroAntesIrCs, null],
            ['IR/CS', (p) => p.lucro.irCs, null],
            ['Lucro líquido', (p) => p.lucro.lucroDepoisIrCs, null],
        ];
        for (const [nome, valor, semPreco] of linhas) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.scope = 'row';
            th.textContent = nome;
            tr.appendChild(th);
            for (const p of [piso, cheio]) {
                celula(tr, p !== null ? reais(valor(p)) : semPreco !== null ? reais(semPreco) : '—');
            }
            tbodyCascata.appendChild(tr);
        }
    }
    function desenharItens(r) {
        tbodyItens.replaceChildren();
        for (const item of r.itens) {
            const tr = document.createElement('tr');
            celula(tr, item.codigo);
            celula(tr, item.descricao ?? '');
            celula(tr, item.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 6 }));
            celula(tr, ORIGEM[item.origem]);
            celula(tr, item.custoBrutoUnitario === null ? '—' : reais(item.custoBrutoUnitario));
            const creditos = item.fonteCreditos === 'OMIE_LIQUIDO'
                ? 'já líquido'
                : item.custoBrutoUnitario === null
                    ? '—'
                    : item.custoLiquidoUnitario === null
                        ? 'sem crédito'
                        : reais(item.custoBrutoUnitario - item.custoLiquidoUnitario);
            celula(tr, creditos);
            celula(tr, item.custoLiquidoUnitario === null ? (item.custoBrutoUnitario === null ? '—' : reais(item.custoBrutoUnitario)) : reais(item.custoLiquidoUnitario));
            const acoes = celula(tr, '');
            if (item.conflito !== null) {
                const select = document.createElement('select');
                select.setAttribute('aria-label', `Custo a usar no item ${item.codigo}`);
                select.append(new Option(`Manual (${reais(item.conflito.valorManualLiquido)} líquido)`, 'MANUAL'), new Option(`Omie (${reais(item.conflito.valorOmie)})`, 'OMIE'));
                select.value = item.conflito.escolhido;
                select.addEventListener('change', () => {
                    escolhas[item.codigo.toUpperCase()] = select.value;
                    if (!botaoCalcular.disabled)
                        form.requestSubmit();
                });
                acoes.appendChild(select);
            }
            // Atalho só para item SEM custo manual salvo (com manual salvo, edita-se na lista de custos manuais).
            if ((item.origem === 'SEM_CUSTO' || item.origem === 'OMIE') && item.conflito === null) {
                const botao = document.createElement('button');
                botao.type = 'button';
                botao.className = 'botao-secundario';
                botao.textContent = item.origem === 'SEM_CUSTO' ? 'Digitar custo' : 'Custo manual';
                botao.addEventListener('click', () => {
                    const campo = document.getElementById('precificacao-custo-codigo');
                    if (campo === null)
                        return;
                    if (campo.readOnly) {
                        mostrarErro(`O formulário de custo manual está editando o item ${campo.value}. Cancele ou salve essa edição antes.`);
                        campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return;
                    }
                    campo.value = item.codigo;
                    campo.dispatchEvent(new Event('input'));
                    campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    document.getElementById('precificacao-custo-valor')?.focus();
                });
                acoes.appendChild(botao);
            }
            tbodyItens.appendChild(tr);
        }
    }
    function desenhar(r) {
        areaResultado.hidden = false;
        desenharTarjas(areaAvisos, r.avisos);
        tarjaIncompleto.hidden = !(r.incompleto && !r.bloqueado);
        const semCusto = r.custo?.itensSemCusto.length ?? 0;
        tarjaIncompleto.replaceChildren();
        const forte = document.createElement('strong');
        forte.textContent = 'INCOMPLETO – não usar em cotação.';
        tarjaIncompleto.append(forte, semCusto > 0 ? ` Preço incompleto: ${semCusto} ${semCusto === 1 ? 'item' : 'itens'} sem custo.` : '');
        const ncm = r.produto.ncm === null ? 'sem NCM' : `NCM ${r.produto.ncm}`;
        const ipi = r.aliquotaIpiVenda === null ? '' : `, IPI ${pct(r.aliquotaIpiVenda)}`;
        const cenario = r.cenario === null ? '' : ` · Cenário ${r.cenario.cenario}: ${r.cenario.motivo}`;
        cabecalho.textContent = `${r.produto.codigo}${r.produto.descricao === null ? '' : ` — ${r.produto.descricao}`} (${ncm}${ipi}) · ${r.cliente} · quantidade ${r.quantidade.toLocaleString('pt-BR')}${cenario}`;
        desenharPrecos(r);
        blocoReverso.hidden = r.reverso === null || r.bloqueado;
        if (r.reverso !== null) {
            desenharTarjas(avisosReverso, r.reverso.avisos);
            const l = r.reverso.lucro;
            textoReverso.textContent = `Preço-alvo ${reais(l.preco)} sem IPI (${reais(r.reverso.precoComIpi)} com IPI): lucro antes do IR/CS ${reais(l.lucroAntesIrCs)} (${pct(l.margemAntesIrCs)}), depois ${reais(l.lucroDepoisIrCs)} (${pct(l.margemDepoisIrCs)}).${r.reverso.precoPiso === null ? '' : ` Piso: ${reais(r.reverso.precoPiso)}.`}`;
        }
        desenharCascata(r);
        desenharItens(r);
    }
    form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            mostrarErro(null);
            const produto = inputProduto.value.trim().toUpperCase();
            const quantidade = lerNumero(inputQuantidade.value);
            const despesas = lerNumero(inputDespesas.value);
            const margem = lerNumero(inputMargem.value);
            const alvo = lerNumero(inputAlvo.value);
            if (produto === '')
                return mostrarErro('Informe o código do produto.');
            if (quantidade === null || Number.isNaN(quantidade))
                return mostrarErro('Quantidade não entendida (ex.: 10).');
            if (despesas === null || Number.isNaN(despesas))
                return mostrarErro('Informe as despesas fixas % (ex.: 10).');
            if (margem === null || Number.isNaN(margem))
                return mostrarErro('Informe a margem desejada % (ex.: 12).');
            if (Number.isNaN(alvo))
                return mostrarErro('Preço-alvo não entendido (ex.: 150,00).');
            let cliente;
            if (selectTipoCliente.value === 'simulacao') {
                cliente = { uf: selectUf.value, contribuinte: selectContribuinte.value === 'sim', comPta: selectPta.value === 'sim' };
            }
            else {
                if (selectCliente.value === '')
                    return mostrarErro('Busque e escolha o cliente, ou use a simulação rápida.');
                cliente = { codigo: Number(selectCliente.value) };
            }
            // Escolhas manual × Omie valem só para o produto em que foram feitas.
            if (produto !== ultimoProduto)
                escolhas = {};
            ultimoProduto = produto;
            const corpo = {
                produto,
                quantidade,
                cliente,
                finalidade: selectFinalidade.value,
                despesas,
                comissao: Number(selectComissao.value),
                margem,
                margemLiquida: selectTipoMargem.value === 'liquida',
                precoAlvo: alvo,
                custosSimulacao: [],
                escolhas,
            };
            const meu = ++numeroCalculo;
            botaoCalcular.disabled = true;
            textoStatus.textContent = 'Calculando… (a primeira consulta de um produto pode demorar: o Omie é lido item a item)';
            try {
                const resposta = await fetch('/api/precificacao/calculo', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(corpo),
                });
                if (meu !== numeroCalculo)
                    return;
                if (!resposta.ok) {
                    areaResultado.hidden = true;
                    // Escolhas manual × Omie nunca ficam presas a um cálculo que falhou.
                    escolhas = {};
                    if (resposta.status === 504 || resposta.status === 502) {
                        return mostrarErro('O Omie demorou demais para responder. Tente de novo: as consultas já feitas ficam guardadas e a próxima tentativa vai mais longe.');
                    }
                    return mostrarErro(await lerMensagemDeErro(resposta));
                }
                try {
                    localStorage.setItem(CHAVE_DESPESAS, inputDespesas.value.trim());
                }
                catch {
                    // Sem localStorage: só não lembra as despesas.
                }
                const resultado = (await resposta.json());
                if (meu === numeroCalculo)
                    desenhar(resultado);
            }
            catch {
                if (meu === numeroCalculo)
                    mostrarErro('Não foi possível calcular. Verifique a conexão e tente de novo.');
            }
            finally {
                if (meu === numeroCalculo) {
                    botaoCalcular.disabled = false;
                    textoStatus.textContent = '';
                }
            }
        })();
    });
    return {
        ativar: () => {
            atualizarTipoCliente();
            if (inputDespesas.value === '') {
                try {
                    inputDespesas.value = localStorage.getItem(CHAVE_DESPESAS) ?? '';
                }
                catch {
                    // Sem localStorage: campo vazio.
                }
            }
        },
    };
}
