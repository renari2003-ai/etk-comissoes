/**
 * Login e controle de acesso (regra de 2026-09-11): administrador tem acesso
 * total; convidado só vê as seções que o administrador liberou (ver aba
 * "Usuários", só visível para administrador — `usuarios.ts`). Roda antes de
 * qualquer outra coisa e cobre a tela inteira com um overlay de login até a
 * sessão ser confirmada — como `app.ts`/`relatorios.ts` nunca disparam uma
 * chamada de API sozinhos ao carregar a página (só reagem a clique), não
 * precisa reordenar a inicialização deles: só bloquear visualmente até logar.
 */

export type Papel = 'administrador' | 'convidado';

export interface Permissoes {
  consultaPedidos: boolean;
  consultaOrcamentos: boolean;
  relatorioVendas: boolean;
  relatorioOrcamentos: boolean;
  relatorioComissionamento: boolean;
}

export interface UsuarioLogado {
  id: string;
  usuario: string;
  nome: string;
  papel: Papel;
  permissoes: Permissoes;
  /** true = senha foi definida por outra pessoa (seed inicial ou redefinição pelo admin master) — precisa trocar antes de continuar (regra de 2026-09-11). */
  senhaProvisoria: boolean;
  /** "Administrador master" (só Ricardo/Wendell) — único papel que pode redefinir a senha de outra pessoa. */
  mestre: boolean;
}

let usuarioLogadoAtual: UsuarioLogado | null = null;

/** Usado por `usuarios.ts` pra saber se o usuário atual pode redefinir a senha de outra pessoa (`mestre`), sem precisar buscar `/api/auth/eu` de novo. */
export function obterUsuarioLogado(): UsuarioLogado | null {
  return usuarioLogadoAtual;
}

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`Elemento #${id} não encontrado`);
  return elemento as T;
}

const overlay = el<HTMLElement>('overlay-login');
const formLogin = el<HTMLFormElement>('form-login');
const campoUsuario = el<HTMLInputElement>('login-usuario');
const campoSenha = el<HTMLInputElement>('login-senha');
const loginErro = el<HTMLElement>('login-erro');
const botaoLogin = el<HTMLButtonElement>('botao-login');

const formDefinirSenha = el<HTMLFormElement>('form-definir-senha');
const campoNovaSenha = el<HTMLInputElement>('definir-senha-nova');
const campoConfirmarSenha = el<HTMLInputElement>('definir-senha-confirmar');
const definirSenhaErro = el<HTMLElement>('definir-senha-erro');
const botaoDefinirSenha = el<HTMLButtonElement>('botao-definir-senha');

const usuarioLogadoBox = el<HTMLElement>('usuario-logado');
const usuarioLogadoNome = el<HTMLElement>('usuario-logado-nome');
const botaoSair = el<HTMLButtonElement>('botao-sair');
const modoUsuariosBotao = el<HTMLButtonElement>('modo-usuarios-botao');
const modoConsultaBotao = el<HTMLButtonElement>('modo-consulta-botao');
const modoRelatoriosBotao = el<HTMLButtonElement>('modo-relatorios-botao');
const semAcesso = el<HTMLElement>('sem-acesso');
const modoConsultaSecao = el<HTMLElement>('modo-consulta');
const modoRelatoriosSecao = el<HTMLElement>('modo-relatorios');

async function extrairMensagemErro(resposta: Response): Promise<string> {
  const corpo = await resposta.json().catch(() => null);
  if (corpo && typeof corpo === 'object' && typeof (corpo as { erro?: unknown }).erro === 'string') {
    return (corpo as { erro: string }).erro;
  }
  return 'Não foi possível completar a operação.';
}

/** Clica no primeiro botão visível do grupo se o botão atualmente "ativo" (classe `classeAtiva`) ficou escondido — nunca deixa uma aba escondida marcada como ativa. */
function garantirAbaAtivaVisivel(botoes: HTMLButtonElement[], classeAtiva: string): void {
  const ativoAtual = botoes.find((botao) => botao.classList.contains(classeAtiva));
  if (ativoAtual !== undefined && !ativoAtual.hidden) return;
  botoes.find((botao) => !botao.hidden)?.click();
}

/** Mostra o painel "defina sua senha" dentro do mesmo overlay do login, no lugar do formulário de login. */
function mostrarPainelDefinirSenha(): void {
  usuarioLogadoBox.hidden = true;
  overlay.hidden = false;
  formLogin.hidden = true;
  formDefinirSenha.hidden = false;
  campoNovaSenha.value = '';
  campoConfirmarSenha.value = '';
  definirSenhaErro.hidden = true;
  campoNovaSenha.focus();
}

function processarLoginOuPedirTrocaDeSenha(usuarioLogado: UsuarioLogado): void {
  usuarioLogadoAtual = usuarioLogado;
  if (usuarioLogado.senhaProvisoria) {
    mostrarPainelDefinirSenha();
    return;
  }
  aplicarPermissoes(usuarioLogado);
}

function aplicarPermissoes(usuarioLogado: UsuarioLogado): void {
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
  const secoesPorId: Array<[string, boolean]> = [
    ['aba-pedidos', p.consultaPedidos],
    ['aba-orcamentos', p.consultaOrcamentos],
    ['aba-relatorio-vendas', p.relatorioVendas],
    ['aba-relatorio-orcamentos', p.relatorioOrcamentos],
    ['aba-relatorio-comissionamento', p.relatorioComissionamento],
  ];
  for (const [id, liberado] of secoesPorId) {
    const elemento = document.getElementById(id);
    if (elemento !== null) elemento.hidden = !liberado;
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
  const abaPedidos = document.getElementById('aba-pedidos') as HTMLButtonElement | null;
  const abaOrcamentos = document.getElementById('aba-orcamentos') as HTMLButtonElement | null;
  if (abaPedidos !== null && abaOrcamentos !== null) garantirAbaAtivaVisivel([abaPedidos, abaOrcamentos], 'aba-ativa');
  const abaVendas = document.getElementById('aba-relatorio-vendas') as HTMLButtonElement | null;
  const abaOrcamentosRel = document.getElementById('aba-relatorio-orcamentos') as HTMLButtonElement | null;
  const abaComissao = document.getElementById('aba-relatorio-comissionamento') as HTMLButtonElement | null;
  if (abaVendas !== null && abaOrcamentosRel !== null && abaComissao !== null) {
    garantirAbaAtivaVisivel([abaVendas, abaOrcamentosRel, abaComissao], 'aba-ativa');
  }
}

function mostrarOverlayLogin(): void {
  usuarioLogadoBox.hidden = true;
  overlay.hidden = false;
  campoUsuario.focus();
}

async function verificarSessao(): Promise<UsuarioLogado | null> {
  const resposta = await fetch('/api/auth/eu');
  if (!resposta.ok) return null;
  return (await resposta.json()) as UsuarioLogado;
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
      if (!resposta.ok) throw new Error(await extrairMensagemErro(resposta));
      const usuarioLogado = (await resposta.json()) as UsuarioLogado;
      campoSenha.value = '';
      processarLoginOuPedirTrocaDeSenha(usuarioLogado);
    } catch (erro) {
      loginErro.textContent = erro instanceof Error ? erro.message : 'Erro desconhecido ao entrar.';
      loginErro.hidden = false;
    } finally {
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
      if (!resposta.ok) throw new Error(await extrairMensagemErro(resposta));
      campoNovaSenha.value = '';
      campoConfirmarSenha.value = '';
      const usuarioAtualizado = await verificarSessao();
      if (usuarioAtualizado !== null) {
        usuarioLogadoAtual = usuarioAtualizado;
        aplicarPermissoes(usuarioAtualizado);
      }
    } catch (erro) {
      definirSenhaErro.textContent = erro instanceof Error ? erro.message : 'Erro desconhecido ao salvar a senha.';
      definirSenhaErro.hidden = false;
    } finally {
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
  } else {
    processarLoginOuPedirTrocaDeSenha(usuarioLogado);
  }
});
