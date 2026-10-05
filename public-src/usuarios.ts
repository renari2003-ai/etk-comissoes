/** Painel "Usuários" — só carregado/ativado para administrador (ver `auth.ts`). CRUD simples de contas e permissões dos papéis não-administradores. */

import { obterUsuarioLogado, ROTULOS_PAPEL, type Papel, type Permissoes } from './auth.js';

interface UsuarioListado {
  id: string;
  usuario: string;
  nome: string;
  papel: Papel;
  permissoes: Permissoes;
  /** Fase 4A.6 — código de vendedor na Omie vinculado a este login (legado). */
  vendedorOmieId: number | null;
  /** Vínculo operacional por nome do vendedor na Omie (2026-09-28). */
  vendedorOmieNome: string | null;
}

const CHAVES_PERMISSAO: Array<{ chave: keyof Permissoes; rotulo: string }> = [
  { chave: 'consultaPedidos', rotulo: 'Consulta — Pedidos' },
  { chave: 'consultaOrcamentos', rotulo: 'Consulta — Orçamentos' },
  { chave: 'relatorioVendas', rotulo: 'Relatórios — Vendas' },
  { chave: 'relatorioOrcamentos', rotulo: 'Relatórios — Orçamentos' },
  { chave: 'relatorioComissionamento', rotulo: 'Relatórios — Comissionamento' },
  { chave: 'relatorioFinanceiroComissao', rotulo: 'Relatórios — Financeiro / Comissão' },
  { chave: 'fretes', rotulo: 'Fretes' },
  { chave: 'fretesLogistica', rotulo: 'Fretes — Central da Logística' },
  { chave: 'fretesComercial', rotulo: 'Fretes — Central do Vendedor' },
  { chave: 'fretesSubstituicao', rotulo: 'Fretes — Aprovar em substituição' },
  { chave: 'fretesGerencia', rotulo: 'Fretes — Visão ampliada (gerência)' },
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

/** Nomes únicos (comparação por trim/maiúsculas-minúsculas, igual ao backend), ordenados — um mesmo nome com mais de um código na Omie aparece uma vez só. */
export function nomesDistintosOrdenados(nomes: string[]): string[] {
  const porChave = new Map<string, string>();
  for (const nome of nomes) {
    const limpo = nome.trim();
    if (limpo === '') continue;
    const chave = limpo.toLocaleLowerCase('pt-BR');
    if (!porChave.has(chave)) porChave.set(chave, limpo);
  }
  return [...porChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** "Sem vínculo" + nomes da Omie. Um nome já vinculado que sumiu da Omie continua visível (marcado), nunca trocado em silêncio. */
export function preencherSelectVendedor(select: HTMLSelectElement, nomes: string[], atual: string | null): void {
  select.textContent = '';
  const semVinculo = document.createElement('option');
  semVinculo.value = '';
  semVinculo.textContent = 'Sem vínculo';
  select.appendChild(semVinculo);
  const lista = atual !== null && !nomes.some((n) => n.toLocaleLowerCase('pt-BR') === atual.trim().toLocaleLowerCase('pt-BR')) ? [atual, ...nomes] : nomes;
  for (const nome of lista) {
    const opcao = document.createElement('option');
    opcao.value = nome;
    opcao.textContent = nome === atual && lista !== nomes ? `${nome} (não encontrado na Omie)` : nome;
    select.appendChild(opcao);
  }
  select.value = atual ?? '';
}

export function inicializarUsuarios(): { ativar: () => void } {
  const formNovoUsuario = el<HTMLFormElement>('form-novo-usuario');
  const campoPapel = el<HTMLSelectElement>('novo-usuario-papel');
  const fieldsetPermissoes = el<HTMLFieldSetElement>('novo-usuario-permissoes');
  const erroNovoUsuario = el<HTMLElement>('novo-usuario-erro');
  const corpoTabela = el<HTMLTableSectionElement>('tabela-usuarios-corpo');
  const dicaVendedor = el<HTMLElement>('novo-usuario-dica-vendedor');
  const avisoNovoUsuario = el<HTMLElement>('novo-usuario-aviso');
  const botaoVincularPorLogin = el<HTMLButtonElement>('botao-vincular-vendedores-login');
  const resultadoVincularPorLogin = el<HTMLElement>('vincular-vendedores-resultado');

  let ativado = false;
  /** Nomes de vendedores conhecidos pela integração Omie (mesma lista dos relatórios, somente leitura). */
  let nomesVendedoresOmie: string[] = [];

  async function carregarNomesVendedoresOmie(): Promise<void> {
    const resposta = await fetch('/api/vendedores');
    if (!resposta.ok) return;
    const corpo = (await resposta.json()) as { vendedores: Array<{ nome: string }> };
    nomesVendedoresOmie = nomesDistintosOrdenados(corpo.vendedores.map((v) => v.nome));
  }

  function permissoesVazias(): Permissoes {
    return {
      consultaPedidos: false,
      consultaOrcamentos: false,
      relatorioVendas: false,
      relatorioOrcamentos: false,
      relatorioComissionamento: false,
      relatorioFinanceiroComissao: false,
      fretes: false,
      fretesLogistica: false,
      fretesComercial: false,
      fretesSubstituicao: false,
      fretesGerencia: false,
    };
  }

  function atualizarVisibilidadePermissoes(): void {
    fieldsetPermissoes.hidden = campoPapel.value === 'administrador';
    dicaVendedor.hidden = campoPapel.value !== 'vendedor';
  }
  campoPapel.addEventListener('change', atualizarVisibilidadePermissoes);
  atualizarVisibilidadePermissoes();

  function celula(texto: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.textContent = texto;
    return td;
  }

  /** "Alterar vendedor Omie": lista só de NOMES vindos da Omie (+ "Sem vínculo"), salva em `vendedorOmieNome`. */
  function anexarEditorVendedor(destino: HTMLElement, usuarioListado: UsuarioListado): void {
    const botaoVendedor = document.createElement('button');
    botaoVendedor.type = 'button';
    botaoVendedor.className = 'botao-secundario';
    botaoVendedor.textContent = 'Alterar vendedor Omie';
    const editorVendedor = document.createElement('span');
    editorVendedor.hidden = true;
    const seletorVendedor = document.createElement('select');
    seletorVendedor.setAttribute('aria-label', `Vendedor Omie associado a ${usuarioListado.usuario}`);
    const botaoSalvarVendedor = document.createElement('button');
    botaoSalvarVendedor.type = 'button';
    botaoSalvarVendedor.className = 'botao-secundario';
    botaoSalvarVendedor.textContent = 'Salvar vínculo';
    const botaoCancelarVendedor = document.createElement('button');
    botaoCancelarVendedor.type = 'button';
    botaoCancelarVendedor.className = 'botao-secundario';
    botaoCancelarVendedor.textContent = 'Cancelar';
    editorVendedor.append(seletorVendedor, botaoSalvarVendedor, botaoCancelarVendedor);
    botaoVendedor.addEventListener('click', () => {
      preencherSelectVendedor(seletorVendedor, nomesVendedoresOmie, usuarioListado.vendedorOmieNome);
      botaoVendedor.hidden = true;
      editorVendedor.hidden = false;
    });
    botaoCancelarVendedor.addEventListener('click', () => {
      editorVendedor.hidden = true;
      botaoVendedor.hidden = false;
    });
    botaoSalvarVendedor.addEventListener('click', () => {
      void (async () => {
        const vendedorOmieNome = seletorVendedor.value === '' ? null : seletorVendedor.value;
        const resposta = await fetch(`/api/auth/usuarios/${usuarioListado.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendedorOmieNome }),
        });
        if (!resposta.ok) {
          window.alert(await extrairMensagemErro(resposta));
          return;
        }
        void carregarUsuarios();
      })();
    });
    destino.appendChild(editorVendedor);
    destino.appendChild(botaoVendedor);
  }

  function renderizarLinha(usuarioListado: UsuarioListado): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.appendChild(celula(usuarioListado.nome));
    tr.appendChild(celula(usuarioListado.usuario));
    // Troca de papel sempre explícita (nunca conversão automática) — o backend valida o valor e
    // impede rebaixar o último administrador.
    const tdPapel = document.createElement('td');
    const seletorPapel = document.createElement('select');
    seletorPapel.setAttribute('aria-label', `Papel de ${usuarioListado.usuario}`);
    for (const [valor, rotulo] of Object.entries(ROTULOS_PAPEL) as Array<[Papel, string]>) {
      const opcao = document.createElement('option');
      opcao.value = valor;
      opcao.textContent = rotulo;
      opcao.selected = valor === usuarioListado.papel;
      seletorPapel.appendChild(opcao);
    }
    seletorPapel.addEventListener('change', () => {
      void (async () => {
        const novoPapel = seletorPapel.value as Papel;
        if (!window.confirm(`Alterar o papel de "${usuarioListado.usuario}" para ${ROTULOS_PAPEL[novoPapel]}?`)) {
          seletorPapel.value = usuarioListado.papel;
          return;
        }
        const resposta = await fetch(`/api/auth/usuarios/${usuarioListado.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ papel: novoPapel }),
        });
        if (!resposta.ok) {
          window.alert(await extrairMensagemErro(resposta));
          seletorPapel.value = usuarioListado.papel;
          return;
        }
        void carregarUsuarios();
      })();
    });
    tdPapel.appendChild(seletorPapel);
    tr.appendChild(tdPapel);

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

    // Vínculo login↔vendedor Omie por NOME (2026-09-28): só para o papel "vendedor". O administrador
    // escolhe o nome numa lista vinda da própria Omie — nunca digita código.
    if (usuarioListado.papel === 'vendedor') {
      const rotuloVinculo = document.createElement('div');
      rotuloVinculo.className = 'permissoes-linha';
      rotuloVinculo.textContent = `Vendedor Omie: ${usuarioListado.vendedorOmieNome ?? 'Não vinculado'}`;
      tdAcoes.appendChild(rotuloVinculo);
      anexarEditorVendedor(tdAcoes, usuarioListado);
    }

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
      avisoNovoUsuario.hidden = true;
      const dadosForm = new FormData(formNovoUsuario);
      const papel = dadosForm.get('papel') as Papel;
      const permissoes = permissoesVazias();
      for (const { chave } of CHAVES_PERMISSAO) permissoes[chave] = dadosForm.get(chave) !== null;

      // O vínculo com o vendedor Omie não é enviado daqui: para papel "vendedor" o backend tenta o
      // login como nome Omie (igualdade exata) e devolve o resultado em `vinculoVendedorOmie`.
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
      const criado = (await resposta.json()) as { vinculoVendedorOmie?: { status: string; nome?: string; mensagem?: string } };
      const vinculo = criado.vinculoVendedorOmie;
      if (vinculo?.status === 'VINCULADO' && vinculo.nome !== undefined) {
        avisoNovoUsuario.textContent = `Usuário criado e vinculado ao vendedor Omie "${vinculo.nome}".`;
        avisoNovoUsuario.hidden = false;
      } else if (vinculo?.mensagem !== undefined) {
        avisoNovoUsuario.textContent = vinculo.mensagem;
        avisoNovoUsuario.hidden = false;
      }
      formNovoUsuario.reset();
      atualizarVisibilidadePermissoes();
      void carregarUsuarios();
    })();
  });

  botaoVincularPorLogin.addEventListener('click', () => {
    void (async () => {
      if (!window.confirm('Vincular vendedores sem vínculo pelo login? Só usuários com papel Vendedor e sem vendedor Omie associado; só nome idêntico ao login. Vínculos existentes não são alterados.')) return;
      botaoVincularPorLogin.disabled = true;
      try {
        const resposta = await fetch('/api/auth/usuarios/vincular-vendedores-por-login', { method: 'POST' });
        if (!resposta.ok) {
          resultadoVincularPorLogin.textContent = await extrairMensagemErro(resposta);
          resultadoVincularPorLogin.hidden = false;
          return;
        }
        const relatorio = (await resposta.json()) as {
          vinculados: Array<{ usuario: string; vendedorOmieNome: string }>;
          naoEncontrados: string[];
          ambiguos: string[];
        };
        const partes = [`Vinculados: ${relatorio.vinculados.length === 0 ? 'nenhum' : relatorio.vinculados.map((v) => `${v.usuario} → ${v.vendedorOmieNome}`).join(', ')}.`];
        if (relatorio.naoEncontrados.length > 0) partes.push(`Sem vendedor Omie com o mesmo nome: ${relatorio.naoEncontrados.join(', ')}.`);
        if (relatorio.ambiguos.length > 0) partes.push(`Ambíguos (não alterados): ${relatorio.ambiguos.join(', ')}.`);
        resultadoVincularPorLogin.textContent = partes.join(' ');
        resultadoVincularPorLogin.hidden = false;
        void carregarUsuarios();
      } finally {
        botaoVincularPorLogin.disabled = false;
      }
    })();
  });

  return {
    ativar(): void {
      // Defesa extra no cliente (o backend já responde 403): quem não é administrador nunca
      // carrega a lista de usuários, mesmo que a aba seja aberta por fora do menu.
      if (obterUsuarioLogado()?.papel !== 'administrador') {
        formNovoUsuario.hidden = true;
        botaoVincularPorLogin.hidden = true;
        corpoTabela.textContent = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = 'Acesso não autorizado.';
        tr.appendChild(td);
        corpoTabela.appendChild(tr);
        return;
      }
      formNovoUsuario.hidden = false;
      botaoVincularPorLogin.hidden = false;
      if (ativado) return;
      ativado = true;
      // Nomes primeiro: as linhas usam a lista ao abrir "Alterar vendedor Omie". Falha na Omie
      // não impede a lista de usuários — o seletor só fica com "Sem vínculo" (e o nome atual).
      void carregarNomesVendedoresOmie()
        .catch(() => undefined)
        .then(() => carregarUsuarios());
    },
  };
}
