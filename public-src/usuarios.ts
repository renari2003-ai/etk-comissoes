/** Painel "Usuários" — só carregado/ativado para administrador (ver `auth.ts`). CRUD simples de contas e permissões de convidado. */

import { obterUsuarioLogado, type Papel, type Permissoes } from './auth.js';

interface UsuarioListado {
  id: string;
  usuario: string;
  nome: string;
  papel: Papel;
  permissoes: Permissoes;
}

const CHAVES_PERMISSAO: Array<{ chave: keyof Permissoes; rotulo: string }> = [
  { chave: 'consultaPedidos', rotulo: 'Consulta — Pedidos' },
  { chave: 'consultaOrcamentos', rotulo: 'Consulta — Orçamentos' },
  { chave: 'relatorioVendas', rotulo: 'Relatórios — Vendas' },
  { chave: 'relatorioOrcamentos', rotulo: 'Relatórios — Orçamentos' },
  { chave: 'relatorioComissionamento', rotulo: 'Relatórios — Comissionamento' },
];

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`Elemento #${id} não encontrado`);
  return elemento as T;
}

async function extrairMensagemErro(resposta: Response): Promise<string> {
  const corpo = await resposta.json().catch(() => null);
  if (corpo && typeof corpo === 'object' && typeof (corpo as { erro?: unknown }).erro === 'string') {
    return (corpo as { erro: string }).erro;
  }
  return 'Não foi possível completar a operação.';
}

export function inicializarUsuarios(): { ativar: () => void } {
  const formNovoUsuario = el<HTMLFormElement>('form-novo-usuario');
  const campoPapel = el<HTMLSelectElement>('novo-usuario-papel');
  const fieldsetPermissoes = el<HTMLFieldSetElement>('novo-usuario-permissoes');
  const erroNovoUsuario = el<HTMLElement>('novo-usuario-erro');
  const corpoTabela = el<HTMLTableSectionElement>('tabela-usuarios-corpo');

  let ativado = false;

  function permissoesVazias(): Permissoes {
    return {
      consultaPedidos: false,
      consultaOrcamentos: false,
      relatorioVendas: false,
      relatorioOrcamentos: false,
      relatorioComissionamento: false,
    };
  }

  function atualizarVisibilidadePermissoes(): void {
    fieldsetPermissoes.hidden = campoPapel.value === 'administrador';
  }
  campoPapel.addEventListener('change', atualizarVisibilidadePermissoes);
  atualizarVisibilidadePermissoes();

  function celula(texto: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.textContent = texto;
    return td;
  }

  function renderizarLinha(usuarioListado: UsuarioListado): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.appendChild(celula(usuarioListado.nome));
    tr.appendChild(celula(usuarioListado.usuario));
    tr.appendChild(celula(usuarioListado.papel === 'administrador' ? 'Administrador' : 'Convidado'));

    const tdPermissoes = document.createElement('td');
    if (usuarioListado.papel === 'administrador') {
      tdPermissoes.textContent = 'Acesso total';
    } else {
      const listaCheckboxes = document.createElement('div');
      listaCheckboxes.className = 'permissoes-linha';
      const checkboxesPorChave = new Map<keyof Permissoes, HTMLInputElement>();
      for (const { chave, rotulo } of CHAVES_PERMISSAO) {
        const rotuloEl = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = usuarioListado.permissoes[chave];
        rotuloEl.appendChild(checkbox);
        rotuloEl.append(` ${rotulo}`);
        listaCheckboxes.appendChild(rotuloEl);
        checkboxesPorChave.set(chave, checkbox);
      }
      const botaoSalvar = document.createElement('button');
      botaoSalvar.type = 'button';
      botaoSalvar.className = 'botao-secundario';
      botaoSalvar.textContent = 'Salvar acesso';
      botaoSalvar.addEventListener('click', () => {
        void (async () => {
          const permissoes = permissoesVazias();
          for (const [chave, checkbox] of checkboxesPorChave) permissoes[chave] = checkbox.checked;
          const resposta = await fetch(`/api/auth/usuarios/${usuarioListado.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissoes }),
          });
          if (!resposta.ok) {
            window.alert(await extrairMensagemErro(resposta));
          }
        })();
      });
      listaCheckboxes.appendChild(botaoSalvar);
      tdPermissoes.appendChild(listaCheckboxes);
    }
    tr.appendChild(tdPermissoes);

    const tdAcoes = document.createElement('td');
    // Recuperação de acesso é restrita ao administrador master (regra de 2026-09-11: só Ricardo e
    // Wendell) — o backend já bloqueia (403) um admin comum, mas nem mostrar o botão evita o clique
    // frustrado. Um admin comum vê "(só o administrador master pode)" no lugar do botão.
    if (obterUsuarioLogado()?.mestre === true) {
      const botaoSenha = document.createElement('button');
      botaoSenha.type = 'button';
      botaoSenha.className = 'botao-secundario';
      botaoSenha.textContent = 'Redefinir senha';
      botaoSenha.addEventListener('click', () => {
        void (async () => {
          const novaSenha = window.prompt(`Nova senha para "${usuarioListado.usuario}" (mínimo 6 caracteres):`);
          if (novaSenha === null) return;
          const resposta = await fetch(`/api/auth/usuarios/${usuarioListado.id}/senha`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha: novaSenha }),
          });
          if (!resposta.ok) window.alert(await extrairMensagemErro(resposta));
          else window.alert('Senha redefinida com sucesso — a pessoa vai precisar escolher uma nova senha própria no próximo login.');
        })();
      });
      tdAcoes.appendChild(botaoSenha);
    } else {
      const aviso = document.createElement('span');
      aviso.className = 'permissoes-linha';
      aviso.textContent = 'Redefinir senha: só o administrador master';
      tdAcoes.appendChild(aviso);
    }

    const botaoExcluir = document.createElement('button');
    botaoExcluir.type = 'button';
    botaoExcluir.className = 'botao-secundario';
    botaoExcluir.textContent = 'Excluir';
    botaoExcluir.addEventListener('click', () => {
      void (async () => {
        if (!window.confirm(`Excluir o usuário "${usuarioListado.usuario}"? Essa ação não pode ser desfeita.`)) return;
        const resposta = await fetch(`/api/auth/usuarios/${usuarioListado.id}`, { method: 'DELETE' });
        if (!resposta.ok) {
          window.alert(await extrairMensagemErro(resposta));
          return;
        }
        void carregarUsuarios();
      })();
    });
    tdAcoes.appendChild(botaoExcluir);
    tr.appendChild(tdAcoes);

    return tr;
  }

  async function carregarUsuarios(): Promise<void> {
    const resposta = await fetch('/api/auth/usuarios');
    if (!resposta.ok) {
      corpoTabela.textContent = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = await extrairMensagemErro(resposta);
      tr.appendChild(td);
      corpoTabela.appendChild(tr);
      return;
    }
    const dados = (await resposta.json()) as { usuarios: UsuarioListado[] };
    corpoTabela.textContent = '';
    for (const usuarioListado of dados.usuarios) {
      corpoTabela.appendChild(renderizarLinha(usuarioListado));
    }
  }

  formNovoUsuario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void (async () => {
      erroNovoUsuario.hidden = true;
      const dadosForm = new FormData(formNovoUsuario);
      const papel = dadosForm.get('papel') as Papel;
      const permissoes = permissoesVazias();
      for (const { chave } of CHAVES_PERMISSAO) permissoes[chave] = dadosForm.get(chave) !== null;

      const resposta = await fetch('/api/auth/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: dadosForm.get('usuario'),
          nome: dadosForm.get('nome'),
          senha: dadosForm.get('senha'),
          papel,
          permissoes,
        }),
      });
      if (!resposta.ok) {
        erroNovoUsuario.textContent = await extrairMensagemErro(resposta);
        erroNovoUsuario.hidden = false;
        return;
      }
      formNovoUsuario.reset();
      atualizarVisibilidadePermissoes();
      void carregarUsuarios();
    })();
  });

  return {
    ativar(): void {
      if (ativado) return;
      ativado = true;
      void carregarUsuarios();
    },
  };
}
