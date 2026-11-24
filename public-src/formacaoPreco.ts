/**
 * Modo "Precificação" — etapa 2: tabela fiscal da formação de preço.
 * Quem tem a permissão `precificacao` VÊ a tabela; só o administrador edita e vê o histórico.
 * Apresentação apenas: toda validação e toda regra ficam no servidor (`/api/precificacao/...`).
 * Percentuais em pontos (9,25 = 9,25%), como na API.
 */
import { obterUsuarioLogado } from './auth.js';
// TEMPORÁRIO: diagnóstico do custo — remover junto com a rota antes de produção.
import { inicializarDiagnosticoCusto } from './diagnosticoCustoTela.js';

interface ParametrosGerais {
  pisCofins: number;
  irCs: number;
  ganhoIcmsNaBasePisCofins: boolean;
  percentualRecolhimentoIcms: number;
  percentualRecolhimentoIcmsMgNaoContribuinte: number;
  icmsInternoMgVenda: number;
  icmsInternoMgCompra: number;
  icmsInterestadualCompra: number;
  icmsImportadoVenda: number;
  icmsImportadoCompra: number;
}
interface IcmsUf {
  uf: string;
  icmsInterestadualVenda: number;
  aliquotaInterna: number | null;
}
interface ExcecaoNcm {
  ncm: string;
  aliquota: number;
}
interface TabelaFiscal {
  gerais: ParametrosGerais;
  ufs: IcmsUf[];
  excecoesNcm: ExcecaoNcm[];
  versao: number;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}
interface RegistroHistorico {
  alteradoEm: string;
  usuarioNome: string;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
}

type CampoNumerico = Exclude<keyof ParametrosGerais, 'ganhoIcmsNaBasePisCofins'>;

const CAMPOS_GERAIS: Array<{ chave: CampoNumerico; rotulo: string; dica?: string }> = [
  { chave: 'pisCofins', rotulo: 'PIS/COFINS não cumulativo (%)', dica: 'Crédito na compra e débito na venda' },
  { chave: 'irCs', rotulo: 'IRPJ + CSLL sobre o lucro (%)' },
  { chave: 'icmsInternoMgVenda', rotulo: 'ICMS interno de MG na venda — geral (%)', dica: 'Cenário B, quando o NCM não tem exceção' },
  { chave: 'icmsInternoMgCompra', rotulo: 'ICMS interno de MG na compra sem PTA (%)' },
  { chave: 'icmsInterestadualCompra', rotulo: 'ICMS interestadual na compra (%)', dica: 'Entrada em MG vinda de qualquer UF' },
  { chave: 'icmsImportadoVenda', rotulo: 'ICMS de importado na venda (%)' },
  { chave: 'icmsImportadoCompra', rotulo: 'ICMS de importado na compra (%)' },
  { chave: 'percentualRecolhimentoIcms', rotulo: 'Recolhimento do ICMS na venda (%)', dica: 'Transição da Reforma (2029–2033)' },
  {
    chave: 'percentualRecolhimentoIcmsMgNaoContribuinte',
    rotulo: 'Recolhimento do ICMS em MG para não contribuinte (%)',
    dica: 'Pendente de confirmação do fiscal sobre o PTA',
  },
];

const ROTULOS_CAMPO_HISTORICO: Record<string, string> = Object.fromEntries([
  ...CAMPOS_GERAIS.map((c) => [`gerais.${c.chave}`, c.rotulo] as const),
  ['gerais.ganhoIcmsNaBasePisCofins', 'Ganho do ICMS na base de PIS/COFINS'],
]);

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`Elemento #${id} não encontrado`);
  return elemento as T;
}

function rotuloCampoHistorico(campo: string): string {
  const fixo = ROTULOS_CAMPO_HISTORICO[campo];
  if (fixo !== undefined) return fixo;
  const uf = /^uf\.([A-Z]{2})\.(icmsInterestadualVenda|aliquotaInterna)$/.exec(campo);
  if (uf !== null) return `${uf[1]} — ${uf[2] === 'aliquotaInterna' ? 'alíquota interna' : 'ICMS interestadual de venda'}`;
  const ncm = /^ncm\.(\d{8})$/.exec(campo);
  if (ncm !== null) return `Exceção MG — NCM ${ncm[1]}`;
  return campo;
}

async function lerMensagemDeErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { erro?: string; mensagem?: string; motivo?: string };
    return corpo.erro ?? corpo.mensagem ?? corpo.motivo ?? `Erro ${resposta.status}`;
  } catch {
    return `Erro ${resposta.status}`;
  }
}

export function inicializarFormacaoPreco(): { ativar: () => void } {
  const form = el<HTMLFormElement>('precificacao-form-parametros');
  const camposGerais = el<HTMLElement>('precificacao-campos-gerais');
  const tbodyUfs = el<HTMLTableSectionElement>('precificacao-tbody-ufs');
  const tbodyNcm = el<HTMLTableSectionElement>('precificacao-tbody-ncm');
  const botaoAdicionarNcm = el<HTMLButtonElement>('precificacao-adicionar-ncm');
  const botaoSalvar = el<HTMLButtonElement>('precificacao-salvar');
  const textoAtualizado = el<HTMLElement>('precificacao-parametros-atualizado');
  const textoErro = el<HTMLElement>('precificacao-parametros-erro');
  const textoOk = el<HTMLElement>('precificacao-parametros-ok');
  const secaoHistorico = el<HTMLElement>('precificacao-secao-historico');
  const tbodyHistorico = el<HTMLTableSectionElement>('precificacao-tbody-historico');
  const textoErroHistorico = el<HTMLElement>('precificacao-historico-erro');
  const botaoRecarregar = el<HTMLButtonElement>('precificacao-recarregar');

  const diagnostico = inicializarDiagnosticoCusto();

  let ehAdmin = false;
  /** Versão lida do servidor — volta no PUT (concorrência otimista: 409 se outro admin salvou antes). */
  let versaoLida: number | null = null;
  /** Há edição não salva? Então trocar de aba e voltar não descarta o que foi digitado. */
  let sujo = false;

  function mostrarErro(mensagem: string | null, oferecerRecarga = false): void {
    textoErro.textContent = mensagem ?? '';
    textoErro.hidden = mensagem === null;
    botaoRecarregar.hidden = !oferecerRecarga;
  }

  function inputNumero(valor: number | null, rotulo: string, nome: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '0.0001';
    input.name = nome;
    input.value = valor === null ? '' : String(valor);
    input.setAttribute('aria-label', rotulo);
    input.disabled = !ehAdmin;
    return input;
  }

  function renderizarGerais(g: ParametrosGerais): void {
    camposGerais.replaceChildren();
    for (const campo of CAMPOS_GERAIS) {
      const div = document.createElement('div');
      div.className = 'campo-filtro';
      const label = document.createElement('label');
      label.htmlFor = `precificacao-geral-${campo.chave}`;
      label.textContent = campo.rotulo;
      const input = inputNumero(g[campo.chave], campo.rotulo, campo.chave);
      input.id = `precificacao-geral-${campo.chave}`;
      input.required = true;
      div.append(label, input);
      if (campo.dica !== undefined) {
        const dica = document.createElement('small');
        dica.className = 'filtro-data-legenda';
        dica.textContent = campo.dica;
        div.append(dica);
      }
      camposGerais.append(div);
    }
    const divChave = document.createElement('div');
    divChave.className = 'campo-filtro campo-filtro-checkbox';
    const labelChave = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'ganhoIcmsNaBasePisCofins';
    checkbox.checked = g.ganhoIcmsNaBasePisCofins;
    checkbox.disabled = !ehAdmin;
    labelChave.append(checkbox, ' Ganho do ICMS entra na base de PIS/COFINS (desligado pela decisão de 2025)');
    divChave.append(labelChave);
    camposGerais.append(divChave);
  }

  function renderizarUfs(ufs: IcmsUf[]): void {
    tbodyUfs.replaceChildren();
    for (const linha of ufs) {
      const tr = document.createElement('tr');
      tr.dataset.uf = linha.uf;
      const tdUf = document.createElement('td');
      tdUf.textContent = linha.uf;
      const tdVenda = document.createElement('td');
      tdVenda.append(inputNumero(linha.icmsInterestadualVenda, `ICMS interestadual de venda para ${linha.uf} (%)`, 'icmsInterestadualVenda'));
      const tdInterna = document.createElement('td');
      const interna = inputNumero(linha.aliquotaInterna, `Alíquota interna de ${linha.uf} (%)`, 'aliquotaInterna');
      interna.placeholder = 'não configurada';
      tdInterna.append(interna);
      tr.append(tdUf, tdVenda, tdInterna);
      tbodyUfs.append(tr);
    }
  }

  function adicionarLinhaNcm(excecao: ExcecaoNcm | null): void {
    const tr = document.createElement('tr');
    const tdNcm = document.createElement('td');
    const inputNcm = document.createElement('input');
    inputNcm.type = 'text';
    inputNcm.name = 'ncm';
    inputNcm.inputMode = 'numeric';
    inputNcm.pattern = '\\d{8}';
    inputNcm.maxLength = 8;
    inputNcm.placeholder = '8 dígitos';
    inputNcm.value = excecao?.ncm ?? '';
    inputNcm.setAttribute('aria-label', 'NCM (8 dígitos, sem pontos)');
    inputNcm.disabled = !ehAdmin;
    tdNcm.append(inputNcm);
    const tdAliquota = document.createElement('td');
    tdAliquota.append(inputNumero(excecao?.aliquota ?? null, 'Alíquota interna de MG para o NCM (%)', 'aliquota'));
    const tdAcoes = document.createElement('td');
    if (ehAdmin) {
      const remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'botao-secundario';
      remover.textContent = 'Remover';
      remover.addEventListener('click', () => tr.remove());
      tdAcoes.append(remover);
    }
    tr.append(tdNcm, tdAliquota, tdAcoes);
    tbodyNcm.append(tr);
  }

  function renderizar(tabela: TabelaFiscal): void {
    versaoLida = tabela.versao;
    sujo = false;
    renderizarGerais(tabela.gerais);
    renderizarUfs(tabela.ufs);
    tbodyNcm.replaceChildren();
    for (const e of tabela.excecoesNcm) adicionarLinhaNcm(e);
    textoAtualizado.textContent =
      tabela.atualizadoEm === null
        ? 'Valores iniciais — ainda não editados.'
        : `Última alteração: ${new Date(tabela.atualizadoEm).toLocaleString('pt-BR')} por ${tabela.atualizadoPor ?? '—'}.`;
    botaoSalvar.hidden = !ehAdmin;
    botaoAdicionarNcm.hidden = !ehAdmin;
  }

  /** Número do campo; vazio → `null` (só onde a API aceita). Entrada que o navegador não entende nunca vira "vazio": ver `camposInvalidos`. */
  function lerNumero(input: HTMLInputElement | null): number | null {
    if (input === null || input.value.trim() === '') return null;
    return input.valueAsNumber;
  }

  /**
   * Campos numéricos com texto que o navegador não conseguiu ler (ex.: "17,5" num navegador que só
   * aceita ponto, "1.2.3"). O `value` deles volta vazio — sem esta checagem, a alíquota interna da
   * UF viraria "não configurada" sem aviso nenhum.
   */
  function camposInvalidos(): HTMLInputElement[] {
    const numericos = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    const invalidos = numericos.filter((i) => i.validity.badInput);
    for (const input of numericos) {
      input.toggleAttribute('aria-invalid', invalidos.includes(input));
    }
    return invalidos;
  }

  function montarPayload(): unknown {
    const gerais: Record<string, number | boolean | null> = {};
    for (const campo of CAMPOS_GERAIS) gerais[campo.chave] = lerNumero(form.querySelector<HTMLInputElement>(`input[name="${campo.chave}"]`));
    gerais.ganhoIcmsNaBasePisCofins = form.querySelector<HTMLInputElement>('input[name="ganhoIcmsNaBasePisCofins"]')?.checked ?? false;
    const ufs = Array.from(tbodyUfs.querySelectorAll<HTMLTableRowElement>('tr')).map((tr) => ({
      uf: tr.dataset.uf,
      icmsInterestadualVenda: lerNumero(tr.querySelector<HTMLInputElement>('input[name="icmsInterestadualVenda"]')),
      aliquotaInterna: lerNumero(tr.querySelector<HTMLInputElement>('input[name="aliquotaInterna"]')),
    }));
    const excecoesNcm = Array.from(tbodyNcm.querySelectorAll<HTMLTableRowElement>('tr')).map((tr) => ({
      ncm: tr.querySelector<HTMLInputElement>('input[name="ncm"]')?.value.trim() ?? '',
      aliquota: lerNumero(tr.querySelector<HTMLInputElement>('input[name="aliquota"]')),
    }));
    return { versao: versaoLida, gerais, ufs, excecoesNcm };
  }

  async function carregarHistorico(): Promise<void> {
    secaoHistorico.hidden = !ehAdmin;
    textoErroHistorico.hidden = true;
    if (!ehAdmin) return;
    let registros: RegistroHistorico[];
    try {
      const resposta = await fetch('/api/precificacao/parametros-fiscais/historico?limite=100');
      if (!resposta.ok) throw new Error(await lerMensagemDeErro(resposta));
      registros = (await resposta.json()) as RegistroHistorico[];
    } catch (erro) {
      textoErroHistorico.textContent = `Não foi possível carregar o histórico: ${erro instanceof Error ? erro.message : 'falha de rede'}.`;
      textoErroHistorico.hidden = false;
      return;
    }
    tbodyHistorico.replaceChildren();
    if (registros.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'Nenhuma alteração registrada.';
      tr.append(td);
      tbodyHistorico.append(tr);
      return;
    }
    for (const r of registros) {
      const tr = document.createElement('tr');
      for (const texto of [new Date(r.alteradoEm).toLocaleString('pt-BR'), r.usuarioNome, rotuloCampoHistorico(r.campo), r.valorAnterior ?? '—', r.valorNovo ?? '— (removido)']) {
        const td = document.createElement('td');
        td.textContent = texto;
        tr.append(td);
      }
      tbodyHistorico.append(tr);
    }
  }

  async function carregar(): Promise<void> {
    ehAdmin = obterUsuarioLogado()?.papel === 'administrador';
    mostrarErro(null);
    textoOk.hidden = true;
    try {
      const resposta = await fetch('/api/precificacao/parametros-fiscais');
      if (!resposta.ok) {
        mostrarErro(`Não foi possível carregar a tabela fiscal: ${await lerMensagemDeErro(resposta)}`);
        return;
      }
      renderizar((await resposta.json()) as TabelaFiscal);
    } catch {
      mostrarErro('Falha de rede ao carregar a tabela fiscal. Tente de novo.');
      return;
    }
    await carregarHistorico();
  }

  botaoAdicionarNcm.addEventListener('click', () => {
    adicionarLinhaNcm(null);
    sujo = true;
  });
  form.addEventListener('input', () => {
    sujo = true;
  });
  tbodyNcm.addEventListener('click', (evento) => {
    if ((evento.target as HTMLElement).closest('button') !== null) sujo = true;
  });
  botaoRecarregar.addEventListener('click', () => {
    void carregar();
  });

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    if (!ehAdmin) return;
    void (async () => {
      mostrarErro(null);
      textoOk.hidden = true;
      const invalidos = camposInvalidos();
      if (invalidos.length > 0) {
        mostrarErro(`${invalidos.length} campo(s) com número que não foi entendido (use ponto como separador decimal, ex.: 17.5). Corrija os campos destacados antes de salvar.`);
        invalidos[0]!.focus();
        return;
      }
      botaoSalvar.disabled = true;
      try {
        const resposta = await fetch('/api/precificacao/parametros-fiscais', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(montarPayload()),
        });
        if (!resposta.ok) {
          mostrarErro(await lerMensagemDeErro(resposta), resposta.status === 409);
          return;
        }
        const dados = (await resposta.json()) as TabelaFiscal & { alteracoes: number };
        renderizar(dados);
        textoOk.textContent = dados.alteracoes === 0 ? 'Nada mudou — nada foi gravado.' : `Tabela fiscal salva (${dados.alteracoes} alteração(ões) no histórico).`;
        textoOk.hidden = false;
        await carregarHistorico();
      } catch {
        mostrarErro('Falha de rede ao salvar. Tente de novo.');
      } finally {
        botaoSalvar.disabled = false;
      }
    })();
  });

  return {
    ativar: () => {
      diagnostico.ativar(obterUsuarioLogado()?.papel === 'administrador');
      // Edição não salva: não recarrega por cima (o admin pode ter só trocado de aba).
      if (sujo) return;
      void carregar();
    },
  };
}
