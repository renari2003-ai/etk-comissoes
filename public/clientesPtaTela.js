/**
 * Modo "Precificação" — "Cliente com PTA (compra para industrialização)", marcado no app
 * (decisão de 26/11/2026: o Omie não tem esse campo). Apresentação apenas: a busca no Omie é só
 * leitura e toda regra (só administrador marca, versão, histórico) fica no servidor
 * (`/api/precificacao/clientes-pta` e `/api/precificacao/clientes/busca`).
 */
const ROTULO_CAMPO = { comPta: 'Cliente com PTA', nomeCliente: 'Nome do cliente', cnpjCpf: 'CNPJ/CPF' };
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
function documento(cnpjCpf) {
    if (cnpjCpf === null)
        return '—';
    if (cnpjCpf.length === 14)
        return cnpjCpf.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (cnpjCpf.length === 11)
        return cnpjCpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return cnpjCpf;
}
function textoValor(campo, valor) {
    if (valor === null)
        return '—';
    if (campo === 'comPta')
        return valor === 'true' ? 'Sim' : 'Não';
    if (campo === 'cnpjCpf')
        return documento(valor);
    return valor;
}
export function inicializarClientesPta() {
    const formBusca = el('precificacao-pta-form-busca');
    const inputBusca = el('precificacao-pta-busca');
    const botaoBuscar = el('precificacao-pta-buscar');
    const tbodyResultado = el('precificacao-pta-tbody-busca');
    const tbodyLista = el('precificacao-pta-tbody-lista');
    const textoErro = el('precificacao-pta-erro');
    const textoOk = el('precificacao-pta-ok');
    const secaoHistorico = el('precificacao-pta-secao-historico');
    const tbodyHistorico = el('precificacao-pta-tbody-historico');
    let ehAdmin = false;
    function mostrarErro(mensagem) {
        textoErro.textContent = mensagem ?? '';
        textoErro.hidden = mensagem === null;
    }
    function mostrarOk(mensagem) {
        textoOk.textContent = mensagem ?? '';
        textoOk.hidden = mensagem === null;
    }
    function celula(tr, texto) {
        const td = document.createElement('td');
        td.textContent = texto;
        tr.append(td);
    }
    /** Botão de marcar/desmarcar (só administrador). Manda a versão lida: 409 se outro admin mudou antes. */
    function botaoAlternar(cliente, salvo) {
        const comPta = salvo?.comPta ?? false;
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'botao-secundario';
        botao.textContent = comPta ? 'Desmarcar PTA' : 'Marcar com PTA';
        botao.addEventListener('click', () => {
            const pergunta = comPta
                ? `Desmarcar "cliente com PTA" de ${cliente.nome}? As vendas para ele deixam de usar o cenário A.`
                : `Marcar ${cliente.nome} como "cliente com PTA (compra para industrialização)"?`;
            if (!window.confirm(pergunta))
                return;
            void (async () => {
                mostrarErro(null);
                mostrarOk(null);
                botao.disabled = true;
                try {
                    const resposta = await fetch(`/api/precificacao/clientes-pta/${cliente.codigoCliente}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ versao: salvo?.versao ?? null, comPta: !comPta }),
                    });
                    if (!resposta.ok) {
                        mostrarErro(await lerMensagemDeErro(resposta));
                        return;
                    }
                    mostrarOk(`${cliente.nome}: ${comPta ? 'desmarcado' : 'marcado como cliente com PTA'}.`);
                    tbodyResultado.replaceChildren();
                    await carregar();
                }
                catch {
                    mostrarErro('Falha de rede ao salvar. Tente de novo.');
                }
                finally {
                    botao.disabled = false;
                }
            })();
        });
        return botao;
    }
    function renderizarLista(lista) {
        tbodyLista.replaceChildren();
        if (lista.length === 0) {
            const tr = document.createElement('tr');
            celula(tr, 'Nenhum cliente marcado com PTA.');
            tbodyLista.append(tr);
            return;
        }
        for (const c of lista) {
            const tr = document.createElement('tr');
            celula(tr, c.nomeCliente);
            celula(tr, documento(c.cnpjCpf));
            celula(tr, `${new Date(c.atualizadoEm).toLocaleString('pt-BR')} — ${c.atualizadoPor}`);
            const tdAcoes = document.createElement('td');
            if (ehAdmin)
                tdAcoes.append(botaoAlternar({ codigoCliente: c.codigoCliente, nome: c.nomeCliente, cnpjCpf: c.cnpjCpf }, c));
            tr.append(tdAcoes);
            tbodyLista.append(tr);
        }
    }
    function renderizarBusca(encontrados) {
        tbodyResultado.replaceChildren();
        if (encontrados.length === 0) {
            const tr = document.createElement('tr');
            celula(tr, 'Nenhum cliente encontrado no Omie.');
            tbodyResultado.append(tr);
            return;
        }
        for (const c of encontrados) {
            const tr = document.createElement('tr');
            celula(tr, c.nomeFantasia === null ? c.razaoSocial : `${c.razaoSocial} (${c.nomeFantasia})`);
            celula(tr, documento(c.cnpjCpf));
            celula(tr, c.salvo?.comPta === true ? 'Com PTA' : 'Sem PTA');
            const tdAcoes = document.createElement('td');
            if (ehAdmin)
                tdAcoes.append(botaoAlternar({ codigoCliente: c.codigoCliente, nome: c.razaoSocial, cnpjCpf: c.cnpjCpf }, c.salvo));
            tr.append(tdAcoes);
            tbodyResultado.append(tr);
        }
    }
    async function carregarHistorico() {
        secaoHistorico.hidden = !ehAdmin;
        if (!ehAdmin)
            return;
        try {
            const resposta = await fetch('/api/precificacao/clientes-pta/historico?limite=50');
            if (!resposta.ok)
                return;
            const registros = (await resposta.json());
            tbodyHistorico.replaceChildren();
            for (const r of registros) {
                const tr = document.createElement('tr');
                celula(tr, new Date(r.alteradoEm).toLocaleString('pt-BR'));
                celula(tr, r.usuarioNome);
                celula(tr, String(r.codigoCliente));
                celula(tr, ROTULO_CAMPO[r.campo] ?? r.campo);
                celula(tr, textoValor(r.campo, r.valorAnterior));
                celula(tr, textoValor(r.campo, r.valorNovo));
                tbodyHistorico.append(tr);
            }
        }
        catch {
            // Histórico é só consulta: a falha não impede o resto da tela.
        }
    }
    async function carregar() {
        try {
            const resposta = await fetch('/api/precificacao/clientes-pta');
            if (!resposta.ok) {
                mostrarErro(await lerMensagemDeErro(resposta));
                return;
            }
            renderizarLista((await resposta.json()));
        }
        catch {
            mostrarErro('Falha de rede ao carregar os clientes com PTA. Tente de novo.');
            return;
        }
        await carregarHistorico();
    }
    formBusca.addEventListener('submit', (evento) => {
        evento.preventDefault();
        void (async () => {
            mostrarErro(null);
            mostrarOk(null);
            const termo = inputBusca.value.trim();
            const digitos = termo.replace(/\D/g, '');
            // Só dígitos (com ou sem pontuação) = CNPJ/CPF; senão, parte da razão social.
            const parametro = /^[\d.\-/\s]+$/.test(termo) && digitos !== '' ? `cnpj=${encodeURIComponent(digitos)}` : `nome=${encodeURIComponent(termo)}`;
            botaoBuscar.disabled = true;
            try {
                const resposta = await fetch(`/api/precificacao/clientes/busca?${parametro}`);
                if (!resposta.ok) {
                    mostrarErro(await lerMensagemDeErro(resposta));
                    return;
                }
                renderizarBusca((await resposta.json()));
            }
            catch {
                mostrarErro('Falha de rede ao buscar no Omie. Tente de novo.');
            }
            finally {
                botaoBuscar.disabled = false;
            }
        })();
    });
    return {
        ativar: (admin) => {
            ehAdmin = admin;
            void carregar();
        },
    };
}
