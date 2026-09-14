/**
 * Login e controle de acesso (regra de 2026-09-11): administrador tem acesso
 * total; convidado só vê as seções que o administrador liberou (ver aba
 * "Usuários", só visível para administrador — `usuarios.ts`). Roda antes de
 * qualquer outra coisa e cobre a tela inteira com um overlay de login até a
 * sessão ser confirmada — como `app.ts`/`relatorios.ts` nunca disparam uma
 * chamada de API sozinhos ao carregar a página (só reagem a clique), não
 * precisa reordenar a inicialização deles: só bloquear visualmente até logar.
 */
let usuarioLogadoAtual = null;
/** Usado por `usuarios.ts` pra saber se o usuário atual pode redefinir a senha de outra pessoa (`mestre`), sem precisar buscar `/api/auth/eu` de novo. */
export function obterUsuarioLogado() {
    return usuarioLogadoAtual;
}
function el(id) {
    const elemento = document.getElementById(id);
    if (elemento === null)
        throw new Error(`Elemento #${id} não encontrado`);
    return elemento;
}
const overlay = el('overlay-login');
const formLogin = el('form-login');
const campoUsuario = el('login-usuario');
const campoSenha = el('login-senha');
const loginErro = el('login-erro');
const botaoLogin = el('botao-login');
const formDefinirSenha = el('form-definir-senha');
const campoNovaSenha = el('definir-senha-nova');
const campoConfirmarSenha = el('definir-senha-confirmar');
const definirSenhaErro = el('definir-senha-erro');
const botaoDefinirSenha = el('botao-definir-senha');
const usuarioLogadoBox = el('usuario-logado');
const usuarioLogadoNome = el('usuario-logado-nome');
const botaoSair = el('botao-sair');
const modoUsuariosBotao = el('modo-usuarios-botao');
const modoConsultaBotao = el('modo-consulta-botao');
const modoRelatoriosBotao = el('modo-relatorios-botao');
const semAcesso = el('sem-acesso');
const modoConsultaSecao = el('modo-consulta');
const modoRelatoriosSecao = el('modo-relatorios');
async function extrairMensagemErro(resposta) {
    const corpo = await resposta.json().catch(() => null);
    if (corpo && typeof corpo === 'object' && typeof corpo.erro === 'string') {
        return corpo.erro;
    }
    return 'Não foi possível completar a operação.';
}
/** Clica no primeiro botão visível do grupo se o botão atualmente "ativo" (classe `classeAtiva`) ficou escondido — nunca deixa uma aba escondida marcada como ativa. */
function garantirAbaAtivaVisivel(botoes, classeAtiva) {
    const ativoAtual = botoes.find((botao) => botao.classList.contains(classeAtiva));
    if (ativoAtual !== undefined && !ativoAtual.hidden)
        return;
    botoes.find((botao) => !botao.hidden)?.click();
}
/** Mostra o painel "defina sua senha" dentro do mesmo overlay do login, no lugar do formulário de login. */
function mostrarPainelDefinirSenha() {
    usuarioLogadoBox.hidden = true;
    overlay.hidden = false;
    formLogin.hidden = true;
    formDefinirSenha.hidden = false;
    campoNovaSenha.value = '';
    campoConfirmarSenha.value = '';
    definirSenhaErro.hidden = true;
    campoNovaSenha.focus();
}
function processarLoginOuPedirTrocaDeSenha(usuarioLogado) {
    usuarioLogadoAtual = usuarioLogado;
    if (usuarioLogado.senhaProvisoria) {
        mostrarPainelDefinirSenha();
        return;
    }
    aplicarPermissoes(usuarioLogado);
}
function aplicarPermissoes(usuarioLogado) {
    overlay.hidden = true;
    formLogin.hidden = false;
    formDefinirSenha.hidden = true;
    usuarioLogadoBox.hidden = false;
    usuarioLogadoNome.textContent = `${usuarioLogado.nome} — ${usuarioLogado.papel === 'administrador' ? 'Administrador' : 'Convidado'}`;
    semAcesso.hidden = true;
    modoConsultaSecao.hidden = false; // pode ter sido escondida por um mostrarSemAcesso() de uma sessão anterior (ex.: admin trocou permissões e a página recarregou)
    if (usuarioLogado.papel === 'administrador') {
        modoUsuariosBotao.hidden = false;
        return; // acesso total — nada pra esconder
    }
    const p = usuarioLogado.permissoes;
    const secoesPorId = [
        ['aba-pedidos', p.consultaPedidos],
        ['aba-orcamentos', p.consultaOrcamentos],
        ['aba-relatorio-vendas', p.relatorioVendas],
        ['aba-relatorio-orcamentos', p.relatorioOrcamentos],
        ['aba-relatorio-comissionamento', p.relatorioComissionamento],
    ];
    for (const [id, liberado] of secoesPorId) {
        const elemento = document.getElementById(id);
        if (elemento !== null)
            elemento.hidden = !liberado;
    }
    const consultaLiberada = p.consultaPedidos || p.consultaOrcamentos;
    const relatoriosLiberados = p.relatorioVendas || p.relatorioOrcamentos || p.relatorioComissionamento;
    modoConsultaBotao.hidden = !consultaLiberada;
    modoRelatoriosBotao.hidden = !relatoriosLiberados;
    if (!consultaLiberada && !relatoriosLiberados) {
        modoConsultaSecao.hidden = true;
        modoRelatoriosSecao.hidden = true;
        semAcesso.hidden = false;
        return;
    }
    garantirAbaAtivaVisivel([modoConsultaBotao, modoRelatoriosBotao], 'aba-modo-ativa');
    const abaPedidos = document.getElementById('aba-pedidos');
    const abaOrcamentos = document.getElementById('aba-orcamentos');
    if (abaPedidos !== null && abaOrcamentos !== null)
        garantirAbaAtivaVisivel([abaPedidos, abaOrcamentos], 'aba-ativa');
    const abaVendas = document.getElementById('aba-relatorio-vendas');
    const abaOrcamentosRel = document.getElementById('aba-relatorio-orcamentos');
    const abaComissao = document.getElementById('aba-relatorio-comissionamento');
    if (abaVendas !== null && abaOrcamentosRel !== null && abaComissao !== null) {
        garantirAbaAtivaVisivel([abaVendas, abaOrcamentosRel, abaComissao], 'aba-ativa');
    }
}
function mostrarOverlayLogin() {
    usuarioLogadoBox.hidden = true;
    overlay.hidden = false;
    campoUsuario.focus();
}
async function verificarSessao() {
    const resposta = await fetch('/api/auth/eu');
    if (!resposta.ok)
        return null;
    return (await resposta.json());
}
formLogin.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void (async () => {
        loginErro.hidden = true;
        botaoLogin.disabled = true;
        try {
            const resposta = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario: campoUsuario.value, senha: campoSenha.value }),
            });
            if (!resposta.ok)
                throw new Error(await extrairMensagemErro(resposta));
            const usuarioLogado = (await resposta.json());
            campoSenha.value = '';
            processarLoginOuPedirTrocaDeSenha(usuarioLogado);
        }
        catch (erro) {
            loginErro.textContent = erro instanceof Error ? erro.message : 'Erro desconhecido ao entrar.';
            loginErro.hidden = false;
        }
        finally {
            botaoLogin.disabled = false;
        }
    })();
});
formDefinirSenha.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void (async () => {
        definirSenhaErro.hidden = true;
        if (campoNovaSenha.value !== campoConfirmarSenha.value) {
            definirSenhaErro.textContent = 'As duas senhas digitadas são diferentes.';
            definirSenhaErro.hidden = false;
            return;
        }
        botaoDefinirSenha.disabled = true;
        try {
            const resposta = await fetch('/api/auth/definir-senha', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha: campoNovaSenha.value }),
            });
            if (!resposta.ok)
                throw new Error(await extrairMensagemErro(resposta));
            campoNovaSenha.value = '';
            campoConfirmarSenha.value = '';
            const usuarioAtualizado = await verificarSessao();
            if (usuarioAtualizado !== null) {
                usuarioLogadoAtual = usuarioAtualizado;
                aplicarPermissoes(usuarioAtualizado);
            }
        }
        catch (erro) {
            definirSenhaErro.textContent = erro instanceof Error ? erro.message : 'Erro desconhecido ao salvar a senha.';
            definirSenhaErro.hidden = false;
        }
        finally {
            botaoDefinirSenha.disabled = false;
        }
    })();
});
botaoSair.addEventListener('click', () => {
    void (async () => {
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        window.location.reload();
    })();
});
void verificarSessao().then((usuarioLogado) => {
    if (usuarioLogado === null) {
        mostrarOverlayLogin();
    }
    else {
        processarLoginOuPedirTrocaDeSenha(usuarioLogado);
    }
});
