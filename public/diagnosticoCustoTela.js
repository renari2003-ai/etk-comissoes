/**
 * TEMPORÁRIO (2026-11-24) — REMOVER ANTES DE IR PARA PRODUÇÃO, junto com a rota
 * `GET /api/precificacao/diagnostico/:codigo` (`src/rotas/precificacaoDiagnostico.ts`) e a seção
 * `#precificacao-secao-diagnostico` do `index.html`.
 *
 * Os elementos novos (quadro "Conclusão", botão "Ver detalhes técnicos", cabeçalho da tabela) e o
 * estilo deles são montados aqui, para a seção temporária sair inteira junto com este arquivo.
 *
 * Só administrador. Apresentação apenas: a tabela e a conclusão vêm prontas do servidor
 * (`resumo`, gerado por `resumirDiagnostico`). Aqui só se formata, mostra o JSON bruto em
 * "Ver detalhes técnicos" e copia o resumo em texto.
 */
const ESTILO = `
.diagnostico-conclusao { margin: 12px 0 16px; padding: 12px 16px; border: 1px solid var(--cor-borda); border-left: 4px solid var(--cor-alerta); border-radius: 8px; background: var(--cor-superficie-alt); }
.diagnostico-conclusao.pode-usar { border-left-color: var(--cor-positivo); }
.diagnostico-conclusao h3 { margin: 0 0 8px; font-size: 1rem; }
.diagnostico-conclusao ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.diagnostico-conclusao li { display: flex; gap: 8px; line-height: 1.4; }
.diagnostico-conclusao li::before { flex: none; width: 1.2em; font-weight: 700; }
.diagnostico-conclusao li.ok::before { content: '✔'; color: var(--cor-positivo); }
.diagnostico-conclusao li.problema::before { content: '✘'; color: var(--cor-negativo); }
.diagnostico-conclusao li.info::before { content: 'ℹ'; color: var(--cor-texto-suave); }
.diagnostico-tabela td.bate { text-align: center; font-weight: 700; }
.diagnostico-tabela td.bate.sim { color: var(--cor-positivo); }
.diagnostico-tabela td.bate.nao { color: var(--cor-negativo); }
.diagnostico-tabela td.sem-custo { color: var(--cor-negativo); font-style: italic; }
.diagnostico-tabela tr.ggf td { font-weight: 600; background: var(--cor-primaria-fundo); }
.diagnostico-tabela .descricao-item { display: block; color: var(--cor-texto-suave); font-size: 0.85em; }
.diagnostico-detalhes { max-height: 420px; overflow: auto; margin-top: 8px; padding: 12px; border: 1px solid var(--cor-borda); border-radius: 8px; background: var(--cor-superficie-alt); font-size: 0.8rem; white-space: pre; }
.diagnostico-botao-detalhes { margin-top: 12px; }
`;
/** Cria (uma vez) o quadro de conclusão, o botão/área de detalhes, o estilo e o novo cabeçalho da tabela. */
function montarElementos(secao, areaTabela) {
    if (document.getElementById('precificacao-diagnostico-conclusao') !== null)
        return;
    const estilo = document.createElement('style');
    estilo.textContent = ESTILO;
    document.head.append(estilo);
    const quadro = document.createElement('div');
    quadro.id = 'precificacao-diagnostico-conclusao';
    quadro.className = 'diagnostico-conclusao';
    quadro.hidden = true;
    const titulo = document.createElement('h3');
    titulo.textContent = 'Conclusão';
    const lista = document.createElement('ul');
    lista.id = 'precificacao-diagnostico-conclusao-lista';
    quadro.append(titulo, lista);
    areaTabela.before(quadro);
    const tabela = areaTabela.querySelector('table');
    tabela?.classList.add('diagnostico-tabela');
    const linhaCabecalho = tabela?.querySelector('thead tr');
    if (linhaCabecalho) {
        linhaCabecalho.replaceChildren(...['Item', 'Valor no relatório do Omie', 'Valor que o sistema encontrou', 'De onde veio', 'Bate?'].map((t) => {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = t;
            return th;
        }));
    }
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.id = 'precificacao-diagnostico-detalhes-botao';
    botao.className = 'botao-secundario diagnostico-botao-detalhes';
    botao.textContent = 'Ver detalhes técnicos';
    botao.setAttribute('aria-expanded', 'false');
    botao.setAttribute('aria-controls', 'precificacao-diagnostico-detalhes');
    botao.hidden = true;
    const pre = document.createElement('pre');
    pre.id = 'precificacao-diagnostico-detalhes';
    pre.className = 'diagnostico-detalhes';
    pre.hidden = true;
    secao.append(botao, pre);
    const legenda = secao.querySelector('p.filtro-data-legenda');
    if (legenda)
        legenda.textContent = 'Compara o relatório "Imprimir Estrutura" do Omie com o custo que o sistema encontra para cada item (inclusive dentro dos kits). Só leitura.';
}
function el(id) {
    const elemento = document.getElementById(id);
    if (elemento === null)
        throw new Error(`Elemento #${id} não encontrado`);
    return elemento;
}
function valorSistemaTexto(l) {
    if (l.valorSistema === null)
        return 'sem custo';
    return `R$ ${l.valorSistema.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}
function valorRelatorioTexto(l) {
    return /^[\d.,]+$/.test(l.valorRelatorio) ? `R$ ${l.valorRelatorio}` : l.valorRelatorio;
}
function bateTexto(l) {
    return l.bate === null ? '—' : l.bate ? '✔' : '✘';
}
function textoParaCopiar(r) {
    return [
        `Diagnóstico do custo — ${r.codigo} (estoque de ${r.dataReferenciaEstoque})`,
        '',
        'Conclusão:',
        ...r.resumo.conclusao.map((c) => `${c.tipo === 'ok' ? '✔' : c.tipo === 'problema' ? '✘' : 'ℹ'} ${c.texto}`),
        '',
        'Item | Relatório do Omie | Sistema encontrou | De onde veio | Bate?',
        ...r.resumo.linhas.map((l) => `${'  '.repeat(Math.max(0, l.nivel - 1))}${l.item} | ${valorRelatorioTexto(l)} | ${valorSistemaTexto(l)} | ${l.origem} | ${bateTexto(l)}`),
    ].join('\n');
}
async function copiarTexto(texto) {
    try {
        await navigator.clipboard.writeText(texto);
        return true;
    }
    catch {
        // Sem permissão de área de transferência: seleciona um textarea temporário e usa o comando antigo.
        const area = document.createElement('textarea');
        area.value = texto;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    }
}
export function inicializarDiagnosticoCusto() {
    const secao = el('precificacao-secao-diagnostico');
    const form = el('precificacao-form-diagnostico');
    const inputCodigo = el('precificacao-diagnostico-codigo');
    const botaoExecutar = el('precificacao-diagnostico-executar');
    const botaoCopiar = el('precificacao-diagnostico-copiar');
    const status = el('precificacao-diagnostico-status');
    const erro = el('precificacao-diagnostico-erro');
    const areaTabela = el('precificacao-diagnostico-resultado');
    const tbody = el('precificacao-tbody-diagnostico');
    montarElementos(secao, areaTabela);
    const quadroConclusao = el('precificacao-diagnostico-conclusao');
    const listaConclusao = el('precificacao-diagnostico-conclusao-lista');
    const botaoDetalhes = el('precificacao-diagnostico-detalhes-botao');
    const detalhes = el('precificacao-diagnostico-detalhes');
    let ultimoTexto = '';
    function mostrarErro(mensagem) {
        erro.textContent = mensagem ?? '';
        erro.hidden = mensagem === null;
    }
    function esconderResultado() {
        quadroConclusao.hidden = true;
        areaTabela.hidden = true;
        botaoCopiar.hidden = true;
        botaoDetalhes.hidden = true;
        detalhes.hidden = true;
        detalhes.textContent = '';
        botaoDetalhes.textContent = 'Ver detalhes técnicos';
        botaoDetalhes.setAttribute('aria-expanded', 'false');
    }
    function celula(tr, texto, classe) {
        const td = document.createElement('td');
        td.textContent = texto;
        if (classe !== undefined)
            td.className = classe;
        tr.append(td);
        return td;
    }
    function renderizar(r) {
        listaConclusao.replaceChildren();
        for (const c of r.resumo.conclusao) {
            const li = document.createElement('li');
            li.className = c.tipo;
            li.textContent = c.texto;
            listaConclusao.append(li);
        }
        quadroConclusao.classList.toggle('pode-usar', r.resumo.podeUsar);
        quadroConclusao.hidden = false;
        tbody.replaceChildren();
        for (const l of r.resumo.linhas) {
            const tr = document.createElement('tr');
            if (l.nivel === 0)
                tr.className = 'ggf';
            const tdItem = celula(tr, `${l.nivel > 1 ? `${'\u00a0\u00a0'.repeat(l.nivel - 1)}↳ ` : ''}${l.item}`);
            const detalhe = [l.descricao, l.nivel > 1 && l.pai !== null ? `dentro de ${l.pai}` : null].filter((x) => x !== null).join(' · ');
            if (detalhe !== '') {
                const desc = document.createElement('span');
                desc.className = 'descricao-item';
                desc.textContent = detalhe;
                tdItem.append(desc);
            }
            celula(tr, valorRelatorioTexto(l), l.valorRelatorio === 'sem custo' ? 'sem-custo' : undefined);
            celula(tr, valorSistemaTexto(l), l.valorSistema === null ? 'sem-custo' : undefined);
            celula(tr, l.origem);
            const tdBate = celula(tr, bateTexto(l), `bate${l.bate === true ? ' sim' : l.bate === false ? ' nao' : ''}`);
            tdBate.setAttribute('aria-label', l.bate === null ? 'sem valor do relatório para comparar' : l.bate ? 'bate' : 'não bate');
            tbody.append(tr);
        }
        areaTabela.hidden = false;
        detalhes.textContent = JSON.stringify(r, null, 2);
        botaoDetalhes.hidden = false;
        ultimoTexto = textoParaCopiar(r);
        botaoCopiar.hidden = false;
        status.textContent = `${r.codigo}: ${r.componentes.length} item(ns) consultado(s), incluindo os de dentro dos kits — estoque de ${r.dataReferenciaEstoque}.`;
    }
    form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            const codigo = inputCodigo.value.trim();
            mostrarErro(null);
            if (!/^[A-Za-z0-9._-]{1,60}$/.test(codigo)) {
                mostrarErro('Código de produto inválido (letras, números, ponto, hífen ou sublinhado).');
                return;
            }
            botaoExecutar.disabled = true;
            esconderResultado();
            status.textContent = 'Consultando o Omie (produto e kits)… a primeira consulta do dia lê a posição de estoque inteira e pode levar alguns minutos.';
            try {
                const resposta = await fetch(`/api/precificacao/diagnostico/${encodeURIComponent(codigo)}`);
                const corpo = (await resposta.json().catch(() => null));
                if (!resposta.ok || corpo === null || corpo.resumo === undefined) {
                    status.textContent = '';
                    mostrarErro(`Falha no diagnóstico (${resposta.status}): ${corpo?.erro ?? corpo?.motivo ?? 'resposta inválida'}`);
                    return;
                }
                renderizar(corpo);
            }
            catch {
                status.textContent = '';
                mostrarErro('Falha de rede ao consultar o diagnóstico. Tente de novo.');
            }
            finally {
                botaoExecutar.disabled = false;
            }
        })();
    });
    botaoDetalhes.addEventListener('click', () => {
        const abrir = detalhes.hidden;
        detalhes.hidden = !abrir;
        botaoDetalhes.textContent = abrir ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos';
        botaoDetalhes.setAttribute('aria-expanded', String(abrir));
    });
    botaoCopiar.addEventListener('click', () => {
        void (async () => {
            const ok = await copiarTexto(ultimoTexto);
            botaoCopiar.textContent = ok ? 'Copiado!' : 'Não foi possível copiar';
            setTimeout(() => {
                botaoCopiar.textContent = 'Copiar resultado';
            }, 2000);
        })();
    });
    return {
        ativar: (ehAdmin) => {
            secao.hidden = !ehAdmin;
        },
    };
}
