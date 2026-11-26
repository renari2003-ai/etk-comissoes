/**
 * Modo "Precificação" — relatório de conferência do cadastro (só administrador; Omie só leitura).
 * Apresentação apenas: a regra (sem NCM no Omie / NCM fora da tabela NCM → IPI) fica no servidor
 * (`GET /api/precificacao/conferencia-cadastro`). "Todos os produtos" chama lote por lote.
 */

interface LinhaConferencia {
  produto: string;
  codigo: string;
  descricao: string | null;
  ehProdutoAcabado: boolean;
  ncm: string | null;
  problema: 'SEM_NCM' | 'NCM_SEM_IPI_NA_TABELA' | 'SEM_ESTRUTURA' | 'OMIE_INDISPONIVEL';
  detalhe: string;
}

interface RespostaConferencia {
  pagina: number;
  totalPaginas: number;
  produtosConferidos: number;
  linhas: LinhaConferencia[];
}

const NOME_PROBLEMA: Record<LinhaConferencia['problema'], string> = {
  SEM_NCM: 'Sem NCM',
  NCM_SEM_IPI_NA_TABELA: 'NCM sem IPI na tabela',
  SEM_ESTRUTURA: 'Sem estrutura',
  OMIE_INDISPONIVEL: 'Omie indisponível',
};

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

export function inicializarConferenciaCadastro(): { ativar: (ehAdmin: boolean) => void } {
  const secao = el<HTMLElement>('precificacao-secao-conferencia');
  const form = el<HTMLFormElement>('precificacao-conferencia-form');
  const inputProduto = el<HTMLInputElement>('precificacao-conferencia-produto');
  const botaoProduto = el<HTMLButtonElement>('precificacao-conferencia-um');
  const botaoTodos = el<HTMLButtonElement>('precificacao-conferencia-todos');
  const botaoParar = el<HTMLButtonElement>('precificacao-conferencia-parar');
  const textoStatus = el<HTMLElement>('precificacao-conferencia-status');
  const textoErro = el<HTMLElement>('precificacao-conferencia-erro');
  const tbody = el<HTMLTableSectionElement>('precificacao-conferencia-tbody');

  let parar = false;

  function mostrarErro(mensagem: string | null): void {
    textoErro.textContent = mensagem ?? '';
    textoErro.hidden = mensagem === null;
  }

  function acrescentar(linhas: LinhaConferencia[]): void {
    for (const l of linhas) {
      const tr = document.createElement('tr');
      for (const texto of [l.produto, l.ehProdutoAcabado ? `${l.codigo} (produto acabado)` : l.codigo, l.descricao ?? '—', l.ncm ?? '—', NOME_PROBLEMA[l.problema] ?? l.problema, l.detalhe]) {
        const td = document.createElement('td');
        td.textContent = texto;
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  async function buscar(parametro: string): Promise<RespostaConferencia | null> {
    const resposta = await fetch(`/api/precificacao/conferencia-cadastro?${parametro}`);
    if (!resposta.ok) {
      mostrarErro(await lerMensagemDeErro(resposta));
      return null;
    }
    return (await resposta.json()) as RespostaConferencia;
  }

  function ocupado(sim: boolean): void {
    botaoProduto.disabled = sim;
    botaoTodos.disabled = sim;
    botaoParar.hidden = !sim;
  }

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void (async () => {
      mostrarErro(null);
      const produto = inputProduto.value.trim();
      if (produto === '') return mostrarErro('Digite o código do produto.');
      tbody.replaceChildren();
      ocupado(true);
      textoStatus.textContent = `Conferindo ${produto}…`;
      try {
        const r = await buscar(`produto=${encodeURIComponent(produto)}`);
        if (r === null) return;
        acrescentar(r.linhas);
        textoStatus.textContent = r.linhas.length === 0 ? `${produto}: nenhum problema de cadastro.` : `${produto}: ${r.linhas.length} problema(s).`;
      } catch {
        mostrarErro('Falha de rede. Tente de novo.');
      } finally {
        ocupado(false);
      }
    })();
  });

  botaoTodos.addEventListener('click', () => {
    if (!window.confirm('Conferir TODOS os produtos com estrutura no Omie? Pode levar vários minutos (só consultas ao Omie).')) return;
    void (async () => {
      mostrarErro(null);
      tbody.replaceChildren();
      parar = false;
      ocupado(true);
      let pagina = 1;
      let total = 1;
      let produtos = 0;
      let problemas = 0;
      try {
        while (pagina <= total && !parar) {
          textoStatus.textContent = `Lote ${pagina} de ${total}… (${produtos} produtos conferidos, ${problemas} problema(s))`;
          const r = await buscar(`pagina=${pagina}`);
          if (r === null) return;
          total = r.totalPaginas;
          produtos += r.produtosConferidos;
          problemas += r.linhas.length;
          acrescentar(r.linhas);
          pagina += 1;
        }
        textoStatus.textContent = `${parar ? 'Interrompido' : 'Concluído'}: ${produtos} produtos conferidos, ${problemas} problema(s).`;
      } catch {
        mostrarErro('Falha de rede no meio da varredura. O que já apareceu na tabela vale; rode de novo para continuar.');
      } finally {
        ocupado(false);
      }
    })();
  });

  botaoParar.addEventListener('click', () => {
    parar = true;
  });

  return {
    ativar: (ehAdmin: boolean) => {
      secao.hidden = !ehAdmin;
    },
  };
}
