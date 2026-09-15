/**
 * Painel "Fretes" (Fase 1) — só carregado/ativado para quem tem a permissão `fretes`
 * (ver `auth.ts`). Fluxo: cotação → propostas (manuais) → comparação → seleção manual →
 * fechamento (acréscimo sempre informado pelo usuário, nunca automático). Mesmo padrão
 * estrutural de `usuarios.ts`/`relatorios.ts`: `{ ativar }` plugado pelo `app.ts`.
 */

import { formatarMoeda, formatarPercentual } from './formatacao.js';

type StatusCotacao = 'RASCUNHO' | 'AGUARDANDO_PROPOSTAS' | 'EM_ANALISE' | 'AGUARDANDO_APROVACAO' | 'FECHADA' | 'CANCELADA';
type StatusProposta = 'RECEBIDA' | 'EM_ANALISE' | 'SELECIONADA' | 'REJEITADA';
type Modalidade = 'CIF' | 'FOB';

interface Transportadora {
  id: string;
  nomeRazaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  contato: string | null;
  ativo: boolean;
}

interface CotacaoFrete {
  id: string;
  codigo: string;
  origem: string | null;
  destino: string | null;
  modalidade: Modalidade;
  status: StatusCotacao;
  criadoEm: string;
}

interface PropostaFrete {
  id: string;
  cotacaoId: string;
  transportadoraId: string;
  valorCusto: number;
  prazoDias: number | null;
  validade: string | null;
  tipoServico: string | null;
  status: StatusProposta;
  selecionada: boolean;
}

interface FechamentoFrete {
  id: string;
  custoFrete: number;
  percentualAcrescimo: number;
  valorAcrescimo: number;
  valorFreteCliente: number;
  modoCalculo: 'PERCENTUAL' | 'VALOR_FINAL';
  criadoEm: string;
}

const ROTULOS_STATUS_COTACAO: Record<StatusCotacao, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_PROPOSTAS: 'Aguardando propostas',
  EM_ANALISE: 'Em análise',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  FECHADA: 'Fechada',
  CANCELADA: 'Cancelada',
};

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

function textoOuNulo(valor: FormDataEntryValue | null): string | null {
  if (valor === null) return null;
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

function numeroOuNulo(valor: FormDataEntryValue | null): number | null {
  const texto = textoOuNulo(valor);
  return texto === null ? null : Number(texto);
}

export function inicializarFretes(): { ativar: () => void } {
  const abaDashboard = el<HTMLButtonElement>('fretes-aba-dashboard');
  const abaCotacoes = el<HTMLButtonElement>('fretes-aba-cotacoes');
  const abaTransportadoras = el<HTMLButtonElement>('fretes-aba-transportadoras');
  const secaoDashboard = el<HTMLElement>('fretes-secao-dashboard');
  const secaoCotacoes = el<HTMLElement>('fretes-secao-cotacoes');
  const secaoDetalhe = el<HTMLElement>('fretes-secao-detalhe');
  const secaoTransportadoras = el<HTMLElement>('fretes-secao-transportadoras');

  let ativado = false;
  let transportadorasCache: Transportadora[] = [];
  let cotacaoAtualId: string | null = null;

  type SubAba = 'dashboard' | 'cotacoes' | 'detalhe' | 'transportadoras';
  function mostrarSubAba(sub: SubAba): void {
    secaoDashboard.hidden = sub !== 'dashboard';
    secaoCotacoes.hidden = sub !== 'cotacoes';
    secaoDetalhe.hidden = sub !== 'detalhe';
    secaoTransportadoras.hidden = sub !== 'transportadoras';
    abaDashboard.classList.toggle('aba-ativa', sub === 'dashboard');
    abaCotacoes.classList.toggle('aba-ativa', sub === 'cotacoes' || sub === 'detalhe');
    abaTransportadoras.classList.toggle('aba-ativa', sub === 'transportadoras');
  }

  // --- Dashboard -----------------------------------------------------------

  async function carregarDashboard(): Promise<void> {
    const container = el<HTMLElement>('fretes-dashboard-indicadores');
    container.textContent = '';
    const resposta = await fetch('/api/fretes/dashboard');
    if (!resposta.ok) {
      container.textContent = await extrairMensagemErro(resposta);
      return;
    }
    const dados = (await resposta.json()) as {
      cotacoesPorStatus: Record<StatusCotacao, number>;
      resumoFechamentos: { quantidade: number; custoTotal: number; valorClienteTotal: number; acrescimoTotal: number };
    };

    const indicadores: Array<{ rotulo: string; valor: string }> = [
      { rotulo: 'Aguardando propostas', valor: String(dados.cotacoesPorStatus.AGUARDANDO_PROPOSTAS + dados.cotacoesPorStatus.RASCUNHO) },
      { rotulo: 'Em análise', valor: String(dados.cotacoesPorStatus.EM_ANALISE) },
      { rotulo: 'Aguardando aprovação', valor: String(dados.cotacoesPorStatus.AGUARDANDO_APROVACAO) },
      { rotulo: 'Fechadas', valor: String(dados.cotacoesPorStatus.FECHADA) },
      { rotulo: 'Custo total de fretes', valor: formatarMoeda(dados.resumoFechamentos.custoTotal) },
      { rotulo: 'Valor total repassado', valor: formatarMoeda(dados.resumoFechamentos.valorClienteTotal) },
      { rotulo: 'Total de acréscimos', valor: formatarMoeda(dados.resumoFechamentos.acrescimoTotal) },
    ];
    for (const item of indicadores) {
      const div = document.createElement('div');
      div.className = 'metrica';
      const rotulo = document.createElement('span');
      rotulo.className = 'metrica-rotulo';
      rotulo.textContent = item.rotulo;
      const valor = document.createElement('span');
      valor.className = 'metrica-valor';
      valor.textContent = item.valor;
      div.appendChild(rotulo);
      div.appendChild(valor);
      container.appendChild(div);
    }
  }

  // --- Transportadoras -------------------------------------------------

  async function carregarTransportadoras(): Promise<void> {
    const resposta = await fetch('/api/fretes/transportadoras');
    if (resposta.ok) {
      const dados = (await resposta.json()) as { transportadoras: Transportadora[] };
      transportadorasCache = dados.transportadoras;
    }
    renderizarTabelaTransportadoras();
    renderizarSelectTransportadoras();
  }

  function renderizarTabelaTransportadoras(): void {
    const corpo = el<HTMLTableSectionElement>('fretes-tabela-transportadoras-corpo');
    corpo.textContent = '';
    for (const t of transportadorasCache) {
      const tr = document.createElement('tr');
      const celula = (texto: string) => {
        const td = document.createElement('td');
        td.textContent = texto;
        return td;
      };
      tr.appendChild(celula(t.nomeFantasia ? `${t.nomeRazaoSocial} (${t.nomeFantasia})` : t.nomeRazaoSocial));
      tr.appendChild(celula(t.cnpj ?? '—'));
      tr.appendChild(celula(t.contato ?? t.telefone ?? t.email ?? '—'));
      tr.appendChild(celula(t.ativo ? 'Ativa' : 'Inativa'));

      const tdAcoes = document.createElement('td');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'botao-secundario';
      botao.textContent = t.ativo ? 'Desativar' : 'Ativar';
      botao.addEventListener('click', () => {
        void (async () => {
          const resposta = await fetch(`/api/fretes/transportadoras/${t.id}/${t.ativo ? 'desativar' : 'ativar'}`, { method: 'POST' });
          if (!resposta.ok) {
            window.alert(await extrairMensagemErro(resposta));
            return;
          }
          void carregarTransportadoras();
        })();
      });
      tdAcoes.appendChild(botao);
      tr.appendChild(tdAcoes);
      corpo.appendChild(tr);
    }
  }

  function renderizarSelectTransportadoras(): void {
    const select = document.getElementById('fretes-proposta-transportadora') as HTMLSelectElement | null;
    if (select === null) return;
    const valorAtual = select.value;
    select.textContent = '';
    const optPlaceholder = document.createElement('option');
    optPlaceholder.value = '';
    optPlaceholder.textContent = 'Selecione…';
    select.appendChild(optPlaceholder);
    for (const t of transportadorasCache.filter((x) => x.ativo)) {
      const option = document.createElement('option');
      option.value = t.id;
      option.textContent = t.nomeRazaoSocial;
      select.appendChild(option);
    }
    select.value = valorAtual;
  }

  const formNovaTransportadora = el<HTMLFormElement>('fretes-form-nova-transportadora');
  const erroTransportadora = el<HTMLElement>('fretes-transportadora-erro');
  formNovaTransportadora.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void (async () => {
      erroTransportadora.hidden = true;
      const dadosForm = new FormData(formNovaTransportadora);
      const resposta = await fetch('/api/fretes/transportadoras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomeRazaoSocial: dadosForm.get('nomeRazaoSocial'),
          nomeFantasia: textoOuNulo(dadosForm.get('nomeFantasia')),
          cnpj: textoOuNulo(dadosForm.get('cnpj')),
          email: textoOuNulo(dadosForm.get('email')),
          telefone: textoOuNulo(dadosForm.get('telefone')),
          contato: textoOuNulo(dadosForm.get('contato')),
        }),
      });
      if (!resposta.ok) {
        erroTransportadora.textContent = await extrairMensagemErro(resposta);
        erroTransportadora.hidden = false;
        return;
      }
      formNovaTransportadora.reset();
      void carregarTransportadoras();
    })();
  });

  // --- Cotações ----------------------------------------------------------

  function classeStatus(status: StatusCotacao): string {
    if (status === 'FECHADA') return 'linha-status-positivo';
    if (status === 'CANCELADA') return 'linha-status-negativo';
    return 'linha-status-alerta';
  }

  async function carregarCotacoes(): Promise<void> {
    const status = (document.getElementById('fretes-filtro-status') as HTMLSelectElement | null)?.value ?? '';
    const url = status === '' ? '/api/fretes/cotacoes' : `/api/fretes/cotacoes?status=${encodeURIComponent(status)}`;
    const resposta = await fetch(url);
    const corpo = el<HTMLTableSectionElement>('fretes-tabela-cotacoes-corpo');
    corpo.textContent = '';
    if (!resposta.ok) return;
    const dados = (await resposta.json()) as { cotacoes: CotacaoFrete[] };
    for (const cotacao of dados.cotacoes) {
      const tr = document.createElement('tr');
      const celula = (texto: string) => {
        const td = document.createElement('td');
        td.textContent = texto;
        return td;
      };
      tr.appendChild(celula(cotacao.codigo));
      tr.appendChild(celula(`${cotacao.origem ?? '—'} → ${cotacao.destino ?? '—'}`));
      tr.appendChild(celula(cotacao.modalidade));

      const tdStatus = document.createElement('td');
      const spanStatus = document.createElement('span');
      spanStatus.className = `linha-status ${classeStatus(cotacao.status)}`;
      spanStatus.textContent = ROTULOS_STATUS_COTACAO[cotacao.status];
      tdStatus.appendChild(spanStatus);
      tr.appendChild(tdStatus);

      tr.appendChild(celula(new Date(cotacao.criadoEm).toLocaleDateString('pt-BR')));

      const tdAcoes = document.createElement('td');
      const botaoAbrir = document.createElement('button');
      botaoAbrir.type = 'button';
      botaoAbrir.className = 'botao-secundario';
      botaoAbrir.textContent = 'Abrir';
      botaoAbrir.addEventListener('click', () => void abrirDetalheCotacao(cotacao.id));
      tdAcoes.appendChild(botaoAbrir);
      tr.appendChild(tdAcoes);

      corpo.appendChild(tr);
    }
  }

  const formNovaCotacao = el<HTMLFormElement>('fretes-form-nova-cotacao');
  const erroCotacao = el<HTMLElement>('fretes-cotacao-erro');
  formNovaCotacao.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void (async () => {
      erroCotacao.hidden = true;
      const dadosForm = new FormData(formNovaCotacao);
      const resposta = await fetch('/api/fretes/cotacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoOmieId: numeroOuNulo(dadosForm.get('pedidoOmieId')),
          clienteOmieId: numeroOuNulo(dadosForm.get('clienteOmieId')),
          vendedorOmieId: numeroOuNulo(dadosForm.get('vendedorOmieId')),
          origem: textoOuNulo(dadosForm.get('origem')),
          cepOrigem: textoOuNulo(dadosForm.get('cepOrigem')),
          destino: textoOuNulo(dadosForm.get('destino')),
          cepDestino: textoOuNulo(dadosForm.get('cepDestino')),
          peso: numeroOuNulo(dadosForm.get('peso')),
          volumes: numeroOuNulo(dadosForm.get('volumes')),
          valorMercadoria: numeroOuNulo(dadosForm.get('valorMercadoria')),
          modalidade: dadosForm.get('modalidade'),
          observacoes: textoOuNulo(dadosForm.get('observacoes')),
        }),
      });
      if (!resposta.ok) {
        erroCotacao.textContent = await extrairMensagemErro(resposta);
        erroCotacao.hidden = false;
        return;
      }
      formNovaCotacao.reset();
      void carregarCotacoes();
    })();
  });

  el<HTMLSelectElement>('fretes-filtro-status').addEventListener('change', () => void carregarCotacoes());

  // --- Detalhe da cotação (propostas, comparação, fechamento) --------------

  async function abrirDetalheCotacao(id: string): Promise<void> {
    cotacaoAtualId = id;
    mostrarSubAba('detalhe');
    await Promise.all([carregarTransportadoras(), carregarDetalheCotacao()]);
  }

  async function carregarDetalheCotacao(): Promise<void> {
    if (cotacaoAtualId === null) return;
    const erroDetalhe = el<HTMLElement>('fretes-detalhe-erro');
    erroDetalhe.hidden = true;

    const respostaCotacao = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}`);
    if (!respostaCotacao.ok) {
      erroDetalhe.textContent = await extrairMensagemErro(respostaCotacao);
      erroDetalhe.hidden = false;
      return;
    }
    const cotacao = (await respostaCotacao.json()) as CotacaoFrete;

    el<HTMLElement>('fretes-detalhe-titulo').textContent = `Cotação ${cotacao.codigo}`;
    el<HTMLElement>('fretes-detalhe-info').textContent =
      `${cotacao.origem ?? '—'} → ${cotacao.destino ?? '—'} • ${cotacao.modalidade} • Status: ${ROTULOS_STATUS_COTACAO[cotacao.status]}`;

    const cotacaoEncerrada = cotacao.status === 'FECHADA' || cotacao.status === 'CANCELADA';
    el<HTMLElement>('fretes-detalhe-form-secao').hidden = cotacaoEncerrada;

    const respostaPropostas = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/propostas`);
    const propostas = respostaPropostas.ok ? ((await respostaPropostas.json()) as { propostas: PropostaFrete[] }).propostas : [];
    renderizarTabelaPropostas(propostas, cotacaoEncerrada);

    const propostaSelecionada = propostas.find((p) => p.selecionada) ?? null;
    const painelFechamento = el<HTMLElement>('fretes-painel-fechamento');
    const painelConcluido = el<HTMLElement>('fretes-fechamento-concluido');

    if (cotacao.status === 'FECHADA') {
      painelFechamento.hidden = true;
      const respostaFechamento = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/fechamento`);
      if (respostaFechamento.ok) {
        const fechamento = (await respostaFechamento.json()) as FechamentoFrete;
        renderizarFechamentoConcluido(fechamento);
        painelConcluido.hidden = false;
      }
    } else {
      painelConcluido.hidden = true;
      painelFechamento.hidden = propostaSelecionada === null;
      if (propostaSelecionada !== null) atualizarPreviewFechamento(propostaSelecionada.valorCusto);
    }
  }

  function renderizarTabelaPropostas(propostas: PropostaFrete[], cotacaoEncerrada: boolean): void {
    const corpo = el<HTMLTableSectionElement>('fretes-tabela-propostas-corpo');
    corpo.textContent = '';
    for (const proposta of propostas) {
      const transportadora = transportadorasCache.find((t) => t.id === proposta.transportadoraId);
      const tr = document.createElement('tr');
      if (proposta.selecionada) tr.className = 'linha-selecionada';
      const celula = (texto: string, numerica = false) => {
        const td = document.createElement('td');
        if (numerica) td.className = 'col-num';
        td.textContent = texto;
        return td;
      };
      tr.appendChild(celula(transportadora?.nomeRazaoSocial ?? '—'));
      tr.appendChild(celula(formatarMoeda(proposta.valorCusto), true));
      tr.appendChild(celula(proposta.prazoDias !== null ? `${proposta.prazoDias} dia(s)` : '—'));
      tr.appendChild(celula(proposta.validade ?? '—'));
      tr.appendChild(celula(proposta.tipoServico ?? '—'));
      tr.appendChild(celula(proposta.selecionada ? 'Selecionada' : proposta.status === 'REJEITADA' ? 'Rejeitada' : 'Recebida'));

      const tdAcoes = document.createElement('td');
      if (!cotacaoEncerrada && !proposta.selecionada && proposta.status !== 'REJEITADA') {
        const botaoSelecionar = document.createElement('button');
        botaoSelecionar.type = 'button';
        botaoSelecionar.className = 'botao-secundario';
        botaoSelecionar.textContent = 'Selecionar';
        botaoSelecionar.addEventListener('click', () => {
          void (async () => {
            const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/propostas/${proposta.id}/selecionar`, { method: 'POST' });
            if (!resposta.ok) {
              window.alert(await extrairMensagemErro(resposta));
              return;
            }
            void carregarDetalheCotacao();
          })();
        });
        tdAcoes.appendChild(botaoSelecionar);

        const botaoRejeitar = document.createElement('button');
        botaoRejeitar.type = 'button';
        botaoRejeitar.className = 'botao-secundario';
        botaoRejeitar.textContent = 'Rejeitar';
        botaoRejeitar.addEventListener('click', () => {
          void (async () => {
            const resposta = await fetch(`/api/fretes/propostas/${proposta.id}/rejeitar`, { method: 'POST' });
            if (!resposta.ok) {
              window.alert(await extrairMensagemErro(resposta));
              return;
            }
            void carregarDetalheCotacao();
          })();
        });
        tdAcoes.appendChild(botaoRejeitar);
      }
      tr.appendChild(tdAcoes);
      corpo.appendChild(tr);
    }
  }

  const formNovaProposta = el<HTMLFormElement>('fretes-form-nova-proposta');
  const erroProposta = el<HTMLElement>('fretes-proposta-erro');
  formNovaProposta.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void (async () => {
      if (cotacaoAtualId === null) return;
      erroProposta.hidden = true;
      const dadosForm = new FormData(formNovaProposta);
      const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/propostas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transportadoraId: dadosForm.get('transportadoraId'),
          valorCusto: numeroOuNulo(dadosForm.get('valorCusto')),
          prazoDias: numeroOuNulo(dadosForm.get('prazoDias')),
          validade: textoOuNulo(dadosForm.get('validade')),
          tipoServico: textoOuNulo(dadosForm.get('tipoServico')),
          observacoes: textoOuNulo(dadosForm.get('observacoes')),
        }),
      });
      if (!resposta.ok) {
        erroProposta.textContent = await extrairMensagemErro(resposta);
        erroProposta.hidden = false;
        return;
      }
      formNovaProposta.reset();
      void carregarDetalheCotacao();
    })();
  });

  // --- Fechamento ----------------------------------------------------------

  let custoDaPropostaSelecionada = 0;

  function atualizarPreviewFechamento(custo: number): void {
    custoDaPropostaSelecionada = custo;
    const resumo = el<HTMLElement>('fretes-fechamento-resumo');
    resumo.textContent = '';
    const linhaCusto = document.createElement('div');
    linhaCusto.innerHTML = '';
    const rotuloCusto = document.createElement('span');
    rotuloCusto.className = 'metrica-rotulo';
    rotuloCusto.textContent = 'Custo do frete';
    const valorCusto = document.createElement('span');
    valorCusto.className = 'metrica-valor';
    valorCusto.textContent = formatarMoeda(custo);
    linhaCusto.appendChild(rotuloCusto);
    linhaCusto.appendChild(valorCusto);
    resumo.appendChild(linhaCusto);
    recalcularPreview();
  }

  function recalcularPreview(): void {
    const modoPercentual = (document.querySelector('input[name="modoCalculo"]:checked') as HTMLInputElement | null)?.value !== 'VALOR_FINAL';
    const campoPercentual = el<HTMLElement>('fretes-fechamento-campo-percentual');
    const campoValorFinal = el<HTMLElement>('fretes-fechamento-campo-valor-final');
    campoPercentual.hidden = !modoPercentual;
    campoValorFinal.hidden = modoPercentual;

    const preview = el<HTMLElement>('fretes-fechamento-preview');
    if (modoPercentual) {
      const percentual = Number(el<HTMLInputElement>('fretes-fechamento-percentual').value || '0');
      const acrescimo = Math.round(custoDaPropostaSelecionada * (percentual / 100) * 100) / 100;
      const total = Math.round((custoDaPropostaSelecionada + acrescimo) * 100) / 100;
      preview.textContent = `Acréscimo: ${formatarMoeda(acrescimo)} • Frete para o cliente: ${formatarMoeda(total)}`;
    } else {
      const valorFinal = Number(el<HTMLInputElement>('fretes-fechamento-valor-final').value || '0');
      const percentual = custoDaPropostaSelecionada === 0 ? 0 : (valorFinal / custoDaPropostaSelecionada - 1) * 100;
      preview.textContent = `Acréscimo implícito: ${formatarPercentual(Math.round(percentual * 100) / 100)} (conferência — o custo original não é alterado)`;
    }
  }

  Array.from(document.querySelectorAll('input[name="modoCalculo"]')).forEach((radio) => {
    radio.addEventListener('change', recalcularPreview);
  });
  el<HTMLInputElement>('fretes-fechamento-percentual').addEventListener('input', recalcularPreview);
  el<HTMLInputElement>('fretes-fechamento-valor-final').addEventListener('input', recalcularPreview);

  function renderizarFechamentoConcluido(fechamento: FechamentoFrete): void {
    const container = el<HTMLElement>('fretes-fechamento-concluido');
    container.textContent = '';
    const linhas: Array<[string, string]> = [
      ['Custo do frete', formatarMoeda(fechamento.custoFrete)],
      ['Acréscimo', formatarPercentual(fechamento.percentualAcrescimo)],
      ['Valor do acréscimo', formatarMoeda(fechamento.valorAcrescimo)],
      ['Frete para o cliente', formatarMoeda(fechamento.valorFreteCliente)],
    ];
    for (const [rotulo, valor] of linhas) {
      const div = document.createElement('div');
      const spanRotulo = document.createElement('span');
      spanRotulo.className = 'metrica-rotulo';
      spanRotulo.textContent = rotulo;
      const spanValor = document.createElement('span');
      spanValor.className = 'metrica-valor valor-destaque-frete';
      spanValor.textContent = valor;
      div.appendChild(spanRotulo);
      div.appendChild(spanValor);
      container.appendChild(div);
    }
  }

  const formFechamento = el<HTMLFormElement>('fretes-form-fechamento');
  const erroFechamento = el<HTMLElement>('fretes-fechamento-erro');
  formFechamento.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void (async () => {
      if (cotacaoAtualId === null) return;
      if (!window.confirm('Confirmar o fechamento deste frete? Depois de fechada, a cotação não pode ser reaberta nesta fase.')) return;
      erroFechamento.hidden = true;
      const modoPercentual = (document.querySelector('input[name="modoCalculo"]:checked') as HTMLInputElement | null)?.value !== 'VALOR_FINAL';
      const corpo: Record<string, unknown> = {
        observacoes: textoOuNulo(el<HTMLInputElement>('fretes-fechamento-observacoes').value),
      };
      if (modoPercentual) {
        corpo.percentualAcrescimo = Number(el<HTMLInputElement>('fretes-fechamento-percentual').value || '0');
      } else {
        corpo.valorFreteClienteInformado = Number(el<HTMLInputElement>('fretes-fechamento-valor-final').value || '0');
      }
      const resposta = await fetch(`/api/fretes/cotacoes/${cotacaoAtualId}/fechamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      if (!resposta.ok) {
        erroFechamento.textContent = await extrairMensagemErro(resposta);
        erroFechamento.hidden = false;
        return;
      }
      void carregarDetalheCotacao();
      void carregarDashboard();
    })();
  });

  el<HTMLButtonElement>('fretes-detalhe-voltar').addEventListener('click', () => {
    cotacaoAtualId = null;
    mostrarSubAba('cotacoes');
    void carregarCotacoes();
  });

  // --- Navegação entre sub-abas ---------------------------------------

  abaDashboard.addEventListener('click', () => {
    mostrarSubAba('dashboard');
    void carregarDashboard();
  });
  abaCotacoes.addEventListener('click', () => {
    mostrarSubAba('cotacoes');
    void carregarCotacoes();
  });
  abaTransportadoras.addEventListener('click', () => {
    mostrarSubAba('transportadoras');
    void carregarTransportadoras();
  });

  return {
    ativar(): void {
      if (ativado) return;
      ativado = true;
      mostrarSubAba('dashboard');
      void carregarDashboard();
      void carregarTransportadoras();
    },
  };
}
