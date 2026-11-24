/**
 * TEMPORÁRIO (2026-11-24) — REMOVER ANTES DE IR PARA PRODUÇÃO, junto com a rota
 * `GET /api/precificacao/diagnostico/:codigo` (`src/rotas/precificacaoDiagnostico.ts`) e a seção
 * `#precificacao-secao-diagnostico` do `index.html`.
 *
 * Só administrador. Mostra a "conferencia" do diagnóstico numa tabela legível — número do
 * relatório, valor que veio da API, campo de onde saiu e se bate — e copia o resultado em texto
 * para colar no chat. Apresentação apenas: a conferência é calculada no servidor.
 */

interface CampoQueConfere {
  origem: string;
  campo: string;
  valor: number;
}
interface ConferenciaValor {
  rotulo: string;
  esperado: string | null;
  confere: CampoQueConfere[];
  observacao?: string;
}
interface ComponenteDiagnostico {
  codProdMalha: string | null;
  descricao: string | null;
  camposNumericosEstoque: Record<string, number> | null;
  camposNumericosProduto: Record<string, number> | null;
  erros: string[];
}
interface ResultadoDiagnostico {
  codigo: string;
  dataReferenciaEstoque: string;
  estrutura: { custoProducao?: Record<string, unknown> };
  dadosProducao: Record<string, unknown>;
  produtoAcabado: { camposNumericosEstoque: Record<string, number> | null; erros: string[] };
  componentes: ComponenteDiagnostico[];
  componentesNaoConsultados: number;
  conferencia: ConferenciaValor[] | null;
}

interface LinhaTabela {
  numero: string;
  esperado: string;
  valorApi: string;
  campo: string;
  bate: 'SIM' | 'NÃO' | '—';
}

const CAMPO_DE_CUSTO = /cmc|cust|preco|ggf|mod/i;

function el<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`Elemento #${id} não encontrado`);
  return elemento as T;
}

function numeroPtBr(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

/** "origem.campo = valor" dos campos de custo de um registro — mostra o que a API trouxe mesmo quando nada bate. */
function camposDeCusto(origem: string, campos: Record<string, unknown> | null | undefined): string[] {
  if (campos === null || campos === undefined) return [];
  return Object.entries(campos)
    .filter(([campo, valor]) => CAMPO_DE_CUSTO.test(campo) && typeof valor === 'number')
    .map(([campo, valor]) => `${origem}.${campo} = ${numeroPtBr(valor as number)}`);
}

function montarLinhas(r: ResultadoDiagnostico): LinhaTabela[] {
  const linhas: LinhaTabela[] = [];
  for (const c of r.conferencia ?? []) {
    if (c.confere.length > 0) {
      for (const campo of c.confere) {
        linhas.push({ numero: c.rotulo, esperado: c.esperado ?? '—', valorApi: numeroPtBr(campo.valor), campo: `${campo.origem}.${campo.campo}`, bate: 'SIM' });
      }
      continue;
    }
    // Nada bate (ou o relatório não tem custo unitário): mostra o que a API trouxe de custo para comparar.
    let candidatos: string[];
    if (c.rotulo === 'Valor GGF') {
      candidatos = [...camposDeCusto('ConsultarEstrutura.custoProducao', r.estrutura.custoProducao), ...camposDeCusto('ConsultarDadosProducao', r.dadosProducao)];
      if ('erro' in r.dadosProducao) candidatos.push(`ConsultarDadosProducao: ${String(r.dadosProducao.erro)}`);
    } else {
      const comp = r.componentes.find((x) => x.codProdMalha === c.rotulo);
      candidatos =
        comp === undefined
          ? ['componente não veio na estrutura']
          : [...camposDeCusto('ListarPosEstoque', comp.camposNumericosEstoque), ...camposDeCusto('ConsultarProduto', comp.camposNumericosProduto), ...comp.erros];
    }
    linhas.push({
      numero: c.rotulo,
      esperado: c.esperado ?? 'sem custo unitário',
      valorApi: candidatos.length === 0 ? 'nenhum campo de custo' : candidatos.join('; '),
      campo: c.observacao ?? '—',
      bate: c.esperado === null ? '—' : 'NÃO',
    });
  }
  return linhas;
}

function textoParaCopiar(r: ResultadoDiagnostico, linhas: LinhaTabela[]): string {
  const partes = [
    `Diagnóstico do custo — ${r.codigo} (posição de estoque de ${r.dataReferenciaEstoque})`,
    ...linhas.map((l) => `${l.numero} | relatório: ${l.esperado} | API: ${l.valorApi} | campo: ${l.campo} | bate: ${l.bate}`),
  ];
  if (r.componentesNaoConsultados > 0) partes.push(`Componentes não consultados (acima do limite): ${r.componentesNaoConsultados}`);
  const comErro = r.componentes.filter((c) => c.erros.length > 0);
  if (comErro.length > 0) {
    partes.push('Componentes com erro:');
    for (const c of comErro) partes.push(`- ${c.codProdMalha ?? '?'}: ${c.erros.join('; ')}`);
  }
  if (r.produtoAcabado.erros.length > 0) partes.push(`Produto acabado: ${r.produtoAcabado.erros.join('; ')}`);
  partes.push(`Total de componentes na estrutura: ${r.componentes.length + r.componentesNaoConsultados}`);
  return partes.join('\n');
}

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
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

export function inicializarDiagnosticoCusto(): { ativar: (ehAdmin: boolean) => void } {
  const secao = el<HTMLElement>('precificacao-secao-diagnostico');
  const form = el<HTMLFormElement>('precificacao-form-diagnostico');
  const inputCodigo = el<HTMLInputElement>('precificacao-diagnostico-codigo');
  const botaoExecutar = el<HTMLButtonElement>('precificacao-diagnostico-executar');
  const botaoCopiar = el<HTMLButtonElement>('precificacao-diagnostico-copiar');
  const status = el<HTMLElement>('precificacao-diagnostico-status');
  const erro = el<HTMLElement>('precificacao-diagnostico-erro');
  const areaTabela = el<HTMLElement>('precificacao-diagnostico-resultado');
  const tbody = el<HTMLTableSectionElement>('precificacao-tbody-diagnostico');

  let ultimoTexto = '';

  function mostrarErro(mensagem: string | null): void {
    erro.textContent = mensagem ?? '';
    erro.hidden = mensagem === null;
  }

  function renderizar(r: ResultadoDiagnostico): void {
    const linhas = montarLinhas(r);
    tbody.replaceChildren();
    for (const l of linhas) {
      const tr = document.createElement('tr');
      for (const texto of [l.numero, l.esperado, l.valorApi, l.campo, l.bate]) {
        const td = document.createElement('td');
        td.textContent = texto;
        tr.append(td);
      }
      tbody.append(tr);
    }
    areaTabela.hidden = false;
    ultimoTexto = textoParaCopiar(r, linhas);
    botaoCopiar.hidden = false;
    const extra = r.conferencia === null ? ' Este produto não tem valores do relatório cadastrados para conferir — copie o resultado para ver os campos.' : '';
    status.textContent = `${r.codigo}: ${r.componentes.length} componente(s) consultado(s), posição de estoque de ${r.dataReferenciaEstoque}.${extra}`;
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
      botaoCopiar.hidden = true;
      areaTabela.hidden = true;
      status.textContent = 'Consultando o Omie… a primeira consulta do dia lê a posição de estoque inteira e pode levar alguns minutos.';
      try {
        const resposta = await fetch(`/api/precificacao/diagnostico/${encodeURIComponent(codigo)}`);
        const corpo = (await resposta.json().catch(() => null)) as (ResultadoDiagnostico & { erro?: string; motivo?: string }) | null;
        if (!resposta.ok || corpo === null) {
          status.textContent = '';
          mostrarErro(`Falha no diagnóstico (${resposta.status}): ${corpo?.erro ?? corpo?.motivo ?? 'resposta inválida'}`);
          return;
        }
        renderizar(corpo);
      } catch {
        status.textContent = '';
        mostrarErro('Falha de rede ao consultar o diagnóstico. Tente de novo.');
      } finally {
        botaoExecutar.disabled = false;
      }
    })();
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
    ativar: (ehAdmin: boolean) => {
      secao.hidden = !ehAdmin;
    },
  };
}
