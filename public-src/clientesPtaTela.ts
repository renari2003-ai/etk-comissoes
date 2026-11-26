/**
 * Modo "Precificação" — "Cliente com PTA (compra para industrialização)", marcado no app
 * (decisão de 26/11/2026: o Omie não tem esse campo). Apresentação apenas: a busca no Omie é só
 * leitura e toda regra (só administrador marca, versão, histórico) fica no servidor
 * (`/api/precificacao/clientes-pta` e `/api/precificacao/clientes/busca`).
 */

interface ClientePtaSalvo {
  codigoCliente: number;
  comPta: boolean;
  nomeCliente: string;
  cnpjCpf: string | null;
  versao: number;
  atualizadoEm: string;
  atualizadoPor: string;
}

interface ClienteEncontrado {
  codigoCliente: number;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpjCpf: string | null;
  salvo: ClientePtaSalvo | null;
}

interface RegistroHistorico {
  alteradoEm: string;
  usuarioNome: string;
  codigoCliente: number;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
}

const ROTULO_CAMPO: Record<string, string> = { comPta: 'Cliente com PTA', nomeCliente: 'Nome do cliente', cnpjCpf: 'CNPJ/CPF' };

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`Elemento #${id} não encontrado.`);
  return elemento as T;
}

async function lerMensagemDeErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { erro?: string; mensagem?: string };
    return corpo.erro ?? corpo.mensagem ?? `Erro ${resposta.status}`;
  } catch {
    return `Erro ${resposta.status}`;
  }
}

function documento(cnpjCpf: string | null): string {
  if (cnpjCpf === null) return '—';
  if (cnpjCpf.length === 14) return cnpjCpf.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (cnpjCpf.length === 11) return cnpjCpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return cnpjCpf;
}

function textoValor(campo: string, valor: string | null): string {
  if (valor === null) return '—';
  if (campo === 'comPta') return valor === 'true' ? 'Sim' : 'Não';
  if (campo === 'cnpjCpf') return documento(valor);
  return valor;
}

export function inicializarClientesPta(): { ativar: (ehAdmin: boolean) => void } {
  const formBusca = el<HTMLFormElement>('precificacao-pta-form-busca');
  const inputBusca = el<HTMLInputElement>('precificacao-pta-busca');
  const botaoBuscar = el<HTMLButtonElement>('precificacao-pta-buscar');
  const tbodyResultado = el<HTMLTableSectionElement>('precificacao-pta-tbody-busca');
  const tbodyLista = el<HTMLTableSectionElement>('precificacao-pta-tbody-lista');
  const textoErro = el<HTMLElement>('precificacao-pta-erro');
  const textoOk = el<HTMLElement>('precificacao-pta-ok');
  const secaoHistorico = el<HTMLElement>('precificacao-pta-secao-historico');
  const tbodyHistorico = el<HTMLTableSectionElement>('precificacao-pta-tbody-historico');

  let ehAdmin = false;

  function mostrarErro(mensagem: string | null): void {
    textoErro.textContent = mensagem ?? '';
    textoErro.hidden = mensagem === null;
  }
  function mostrarOk(mensagem: string | null): void {
    textoOk.textContent = mensagem ?? '';
    textoOk.hidden = mensagem === null;
  }

  function celula(tr: HTMLTableRowElement, texto: string): void {
    const td = document.createElement('td');
    td.textContent = texto;
    tr.append(td);
  }

  /** Botão de marcar/desmarcar (só administrador). Manda a versão lida: 409 se outro admin mudou antes. */
  function botaoAlternar(cliente: { codigoCliente: number; nome: string; cnpjCpf: string | null }, salvo: ClientePtaSalvo | null): HTMLButtonElement {
    const comPta = salvo?.comPta ?? false;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'botao-secundario';
    botao.textContent = comPta ? 'Desmarcar PTA' : 'Marcar com PTA';
    botao.addEventListener('click', () => {
      const pergunta = comPta
        ? `Desmarcar "cliente com PTA" de ${cliente.nome}? As vendas para ele deixam de usar o cenário A.`
        : `Marcar ${cliente.nome} como "cliente com PTA (compra para industrialização)"?`;
      if (!window.confirm(pergunta)) return;
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
        } catch {
          mostrarErro('Falha de rede ao salvar. Tente de novo.');
        } finally {
          botao.disabled = false;
        }
      })();
    });
    return botao;
  }

  function renderizarLista(lista: ClientePtaSalvo[]): void {
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
      if (ehAdmin) tdAcoes.append(botaoAlternar({ codigoCliente: c.codigoCliente, nome: c.nomeCliente, cnpjCpf: c.cnpjCpf }, c));
      tr.append(tdAcoes);
      tbodyLista.append(tr);
    }
  }

  function renderizarBusca(encontrados: ClienteEncontrado[]): void {
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
      if (ehAdmin) tdAcoes.append(botaoAlternar({ codigoCliente: c.codigoCliente, nome: c.razaoSocial, cnpjCpf: c.cnpjCpf }, c.salvo));
      tr.append(tdAcoes);
      tbodyResultado.append(tr);
    }
  }

  async function carregarHistorico(): Promise<void> {
    secaoHistorico.hidden = !ehAdmin;
    if (!ehAdmin) return;
    try {
      const resposta = await fetch('/api/precificacao/clientes-pta/historico?limite=50');
      if (!resposta.ok) return;
      const registros = (await resposta.json()) as RegistroHistorico[];
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
    } catch {
      // Histórico é só consulta: a falha não impede o resto da tela.
    }
  }

  async function carregar(): Promise<void> {
    try {
      const resposta = await fetch('/api/precificacao/clientes-pta');
      if (!resposta.ok) {
        mostrarErro(await lerMensagemDeErro(resposta));
        return;
      }
      renderizarLista((await resposta.json()) as ClientePtaSalvo[]);
    } catch {
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
        renderizarBusca((await resposta.json()) as ClienteEncontrado[]);
      } catch {
        mostrarErro('Falha de rede ao buscar no Omie. Tente de novo.');
      } finally {
        botaoBuscar.disabled = false;
      }
    })();
  });

  return {
    ativar: (admin: boolean) => {
      ehAdmin = admin;
      void carregar();
    },
  };
}
