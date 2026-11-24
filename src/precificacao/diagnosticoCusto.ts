/**
 * DIAGNÓSTICO TEMPORÁRIO (2026-11-24) — REMOVER ANTES DE IR PARA PRODUÇÃO, junto com
 * `rotas/precificacaoDiagnostico.ts`.
 *
 * Objetivo: descobrir de quais campos da API Omie saem o custo unitário de cada componente e o
 * "Valor GGF" do relatório "Imprimir Estrutura → Do custo total do produto e itens da estrutura",
 * comparando com valores conhecidos do PA00000001. A estrutura (`ConsultarEstrutura`) não traz
 * custo por item (confirmado na documentação), então para cada componente são devolvidos os campos
 * numéricos do registro de estoque (`ListarPosEstoque`, onde vive o `nCMC`) e do cadastro
 * (`ConsultarProduto`), e é dito quais deles batem com o valor do relatório.
 *
 * Desde 2026-11-24 (tarde) também abre os SUBNÍVEIS: itens "produto em processo"/"produto acabado"
 * (tipo 03/04) têm estrutura própria na Omie (ex.: os kits do PA00000001), e é nela que estão MP/MO.
 * O resultado traz ainda um `resumo` em linguagem simples (tabela + conclusão), gerado por regras
 * fixas aqui no servidor (`resumirDiagnostico`) — a tela só apresenta.
 *
 * SOMENTE LEITURA: só chamadas de consulta à Omie, sempre pelo `chamar` do `ClienteOmie` (limitador
 * compartilhado com a produção). No banco só grava o que o `ClienteOmie` já grava: o cache existente
 * (`omie_cache`: produto e posição de estoque) e o controle do limitador. Nenhuma tabela nova.
 */

import { CAMPOS_CUSTO_CANDIDATOS } from '../calculo/custo.js';
import type { EstoqueOmie } from '../calculo/tipos.js';
import type { ProdutoOmie } from '../omie/cliente.js';
import { OmieError } from '../omie/erros.js';
import { ErroValidacao } from '../validacao.js';

export interface ClienteOmieDiagnosticoCusto {
  consultarEstrutura(codProduto: string): Promise<Record<string, unknown>>;
  consultarDadosProducao(idProduto: number): Promise<Record<string, unknown>>;
  consultarProduto(codigoProduto: number): Promise<ProdutoOmie>;
  obterEstoqueProduto(codigoProduto: number, dataReferencia: string): Promise<EstoqueOmie>;
}

/** Valor esperado escrito como no relatório (vírgula decimal); `null` = relatório não mostra custo unitário. */
interface ReferenciaRelatorio {
  ggf: string;
  componentes: Record<string, string | null>;
}

/** Valores lidos do relatório da Omie pelo usuário (2026-11-24). */
export const REFERENCIAS_RELATORIO: Record<string, ReferenciaRelatorio> = {
  PA00000001: {
    ggf: '59,76',
    componentes: {
      PI10000014: '0,192111',
      MP00000008: '17,06279',
      MO00000013: '5,238053',
      MO00000037: null,
      MP00000045: null,
    },
  },
};

const CODIGO_VALIDO = /^[A-Za-z0-9._-]{1,60}$/;

/**
 * Teto de componentes consultados por diagnóstico, somando todos os níveis (cada um custa 1 chamada
 * `ConsultarProduto`, com cache). O PA00000001 tem 69 itens em 4 níveis.
 */
export const MAX_COMPONENTES_DIAGNOSTICO = 150;

/** Profundidade máxima da abertura de subníveis (1 = só os itens diretos do produto). */
export const MAX_NIVEIS_DIAGNOSTICO = 6;

/** Tipos de item da Omie que têm estrutura própria e são abertos: 03 = produto em processo, 04 = produto acabado. */
const TIPOS_COM_ESTRUTURA = new Set(['03', '04']);

function referenciaDoRelatorio(codigo: string): ReferenciaRelatorio | undefined {
  const chave = codigo.toUpperCase();
  return Object.hasOwn(REFERENCIAS_RELATORIO, chave) ? REFERENCIAS_RELATORIO[chave] : undefined;
}

export function validarCodigoProduto(valor: unknown): string {
  if (typeof valor !== 'string' || !CODIGO_VALIDO.test(valor)) {
    throw new ErroValidacao('Código de produto inválido (use só letras, números, ponto, hífen ou sublinhado; até 60 caracteres).');
  }
  return valor;
}

export interface CampoQueConfere {
  origem: string;
  campo: string;
  valor: number;
}

export interface ConferenciaValor {
  rotulo: string;
  esperado: string | null;
  confere: CampoQueConfere[];
  observacao?: string;
}

export interface ComponenteDiagnostico {
  /** 1 = item direto do produto; 2 = item de um kit/subestrutura; … */
  nivel: number;
  /** Código do produto/subestrutura de onde o item veio. */
  pai: string;
  tipo: string | null;
  codProdMalha: string | null;
  idProdMalha: number | null;
  descricao: string | null;
  quantidade: unknown;
  unidade: unknown;
  percPerda: unknown;
  camposNumericosEstoque: Record<string, number> | null;
  camposNumericosProduto: Record<string, number> | null;
  erros: string[];
}

/** GGF por unidade de cada estrutura aberta (o produto e seus subníveis). */
export interface SubestruturaDiagnostico {
  codigo: string;
  nivel: number;
  /** Quantas unidades desta estrutura entram em 1 unidade do produto (já com o % de perda). */
  quantidadeNoProduto: number;
  custoProducao: Record<string, number> | null;
  dadosProducao: Record<string, number> | null;
  erro?: string;
}

export interface ResultadoDiagnosticoCusto {
  aviso: string;
  codigo: string;
  dataReferenciaEstoque: string;
  estrutura: Record<string, unknown>;
  dadosProducao: Record<string, unknown> | { erro: string };
  produtoAcabado: { camposNumericosEstoque: Record<string, number> | null; erros: string[] };
  componentes: ComponenteDiagnostico[];
  /** Preenchido quando a estrutura tem mais itens que `MAX_COMPONENTES_DIAGNOSTICO`. */
  componentesNaoConsultados: number;
  subestruturas: SubestruturaDiagnostico[];
  conferencia: ConferenciaValor[] | null;
  resumo: ResumoDiagnostico;
}

function paraNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Id da Omie: inteiro positivo (nunca 0, negativo, fração ou "0x10"). */
function paraId(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
  if (typeof valor === 'string' && /^\d{1,15}$/.test(valor.trim())) {
    const n = Number(valor.trim());
    return n > 0 ? n : null;
  }
  return null;
}

function textoOuNull(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null;
}

/** Só os campos numéricos de primeiro nível (número ou texto numérico) — é entre eles que se procura o custo. */
export function camposNumericos(registro: Record<string, unknown> | undefined | null): Record<string, number> | null {
  if (registro === undefined || registro === null) return null;
  const saida: Record<string, number> = {};
  for (const [chave, valor] of Object.entries(registro)) {
    const n = paraNumero(valor);
    if (n !== null) saida[chave] = n;
  }
  return saida;
}

/** "17,06279" → { valor: 17.06279, tolerancia: 0,000005 } (meia unidade da última casa mostrada no relatório). */
export function interpretarValorRelatorio(texto: string): { valor: number; tolerancia: number } {
  const normalizado = texto.trim().replace(/\./g, '').replace(',', '.');
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) throw new Error(`Valor de referência inválido: ${texto}`);
  const casas = normalizado.includes('.') ? normalizado.split('.')[1]!.length : 0;
  return { valor, tolerancia: 0.5 * 10 ** -casas + 1e-12 };
}

function camposQueConferem(esperado: string, fontes: { origem: string; campos: Record<string, number> | null }[]): CampoQueConfere[] {
  const { valor, tolerancia } = interpretarValorRelatorio(esperado);
  const saida: CampoQueConfere[] = [];
  for (const fonte of fontes) {
    for (const [campo, v] of Object.entries(fonte.campos ?? {})) {
      if (Math.abs(v - valor) <= tolerancia) saida.push({ origem: fonte.origem, campo, valor: v });
    }
  }
  return saida;
}

/** Só repassa a mensagem de erros da Omie (faultstring); qualquer outro erro (banco, programação) vira genérico e vai para o log. */
function mensagemDeErro(erro: unknown, contexto: string): string {
  if (erro instanceof OmieError) return erro.message;
  console.error(`[diagnostico-custo] erro interno em ${contexto}:`, erro instanceof Error ? erro.message : erro);
  return 'Erro interno (detalhe no log do servidor).';
}

export async function diagnosticarCusto(
  cliente: ClienteOmieDiagnosticoCusto,
  codigo: string,
  dataReferenciaEstoque: string,
): Promise<ResultadoDiagnosticoCusto> {
  const estrutura = await cliente.consultarEstrutura(codigo);
  const ident = (estrutura.ident ?? {}) as Record<string, unknown>;
  const idProduto = paraId(ident.idProduto);

  let dadosProducao: Record<string, unknown> | { erro: string };
  if (idProduto === null) {
    dadosProducao = { erro: 'ConsultarEstrutura não devolveu ident.idProduto — ConsultarDadosProducao não foi chamado.' };
  } else {
    try {
      dadosProducao = await cliente.consultarDadosProducao(idProduto);
    } catch (erro) {
      dadosProducao = { erro: mensagemDeErro(erro, 'ConsultarDadosProducao') };
    }
  }

  const produtoAcabado: ResultadoDiagnosticoCusto['produtoAcabado'] = { camposNumericosEstoque: null, erros: [] };
  if (idProduto !== null) {
    try {
      const estoque = await cliente.obterEstoqueProduto(idProduto, dataReferenciaEstoque);
      produtoAcabado.camposNumericosEstoque = camposNumericos(estoque.listaEstoque?.[0] as Record<string, unknown> | undefined);
      if (produtoAcabado.camposNumericosEstoque === null) produtoAcabado.erros.push('Produto acabado não aparece na posição de estoque.');
    } catch (erro) {
      produtoAcabado.erros.push(`estoque: ${mensagemDeErro(erro, 'estoque do produto acabado')}`);
    }
  }

  const subestruturas: SubestruturaDiagnostico[] = [
    {
      codigo,
      nivel: 0,
      quantidadeNoProduto: 1,
      custoProducao: camposNumericos(estrutura.custoProducao as Record<string, unknown> | undefined),
      dadosProducao: 'erro' in dadosProducao ? null : camposNumericos(dadosProducao),
    },
  ];
  const componentes: ComponenteDiagnostico[] = [];
  let componentesNaoConsultados = 0;
  const jaAbertos = new Set<string>([codigo.toUpperCase()]);

  // Fila em largura: (itens da estrutura, nível, de quem são, quantas unidades do pai entram no produto).
  const fila: { itens: Record<string, unknown>[]; nivel: number; pai: string; qtdPai: number }[] = [
    { itens: Array.isArray(estrutura.itens) ? (estrutura.itens as Record<string, unknown>[]) : [], nivel: 1, pai: codigo, qtdPai: 1 },
  ];
  while (fila.length > 0) {
    const { itens, nivel, pai, qtdPai } = fila.shift()!;
    for (const item of itens) {
      if (componentes.length >= MAX_COMPONENTES_DIAGNOSTICO) {
        componentesNaoConsultados++;
        continue;
      }
      const idProdMalha = paraId(item.idProdMalha);
      const componente: ComponenteDiagnostico = {
        nivel,
        pai,
        tipo: textoOuNull(item.tipoProdMalha),
        codProdMalha: textoOuNull(item.codProdMalha),
        idProdMalha,
        descricao: textoOuNull(item.descrProdMalha),
        quantidade: item.quantProdMalha,
        unidade: item.unidProdMalha,
        percPerda: item.percPerdaProdMalha,
        camposNumericosEstoque: null,
        camposNumericosProduto: null,
        erros: [],
      };
      componentes.push(componente);
      if (idProdMalha === null) {
        componente.erros.push('Item sem idProdMalha — custo não consultado.');
        continue;
      }
      try {
        const estoque = await cliente.obterEstoqueProduto(idProdMalha, dataReferenciaEstoque);
        componente.camposNumericosEstoque = camposNumericos(estoque.listaEstoque?.[0] as Record<string, unknown> | undefined);
        if (componente.camposNumericosEstoque === null) componente.erros.push('Componente não aparece na posição de estoque.');
      } catch (erro) {
        componente.erros.push(`estoque: ${mensagemDeErro(erro, 'estoque do componente')}`);
      }
      try {
        const produto = await cliente.consultarProduto(idProdMalha);
        componente.camposNumericosProduto = camposNumericos(produto as unknown as Record<string, unknown>);
      } catch (erro) {
        componente.erros.push(`produto: ${mensagemDeErro(erro, 'ConsultarProduto')}`);
      }

      // Subnível: só itens que têm estrutura própria, dentro do limite de níveis, e nunca o mesmo código duas vezes (evita ciclo).
      const cod = componente.codProdMalha;
      if (cod === null || componente.tipo === null || !TIPOS_COM_ESTRUTURA.has(componente.tipo)) continue;
      if (nivel >= MAX_NIVEIS_DIAGNOSTICO || jaAbertos.has(cod.toUpperCase())) continue;
      jaAbertos.add(cod.toUpperCase());
      const qtdNoProduto = qtdPai * quantidadeComPerda(componente);
      const sub: SubestruturaDiagnostico = { codigo: cod, nivel, quantidadeNoProduto: qtdNoProduto, custoProducao: null, dadosProducao: null };
      subestruturas.push(sub);
      try {
        const estruturaSub = await cliente.consultarEstrutura(cod);
        sub.custoProducao = camposNumericos(estruturaSub.custoProducao as Record<string, unknown> | undefined);
        if (!((sub.custoProducao?.vGGF ?? 0) > 0)) {
          try {
            sub.dadosProducao = camposNumericos(await cliente.consultarDadosProducao(idProdMalha));
          } catch (erro) {
            sub.erro = `dados de produção: ${mensagemDeErro(erro, 'ConsultarDadosProducao (subnível)')}`;
          }
        }
        const itensSub = Array.isArray(estruturaSub.itens) ? (estruturaSub.itens as Record<string, unknown>[]) : [];
        fila.push({ itens: itensSub, nivel: nivel + 1, pai: cod, qtdPai: qtdNoProduto });
      } catch (erro) {
        sub.erro = `estrutura: ${mensagemDeErro(erro, 'ConsultarEstrutura (subnível)')}`;
      }
    }
  }

  const conferencia = conferir(codigo, subestruturas, componentes);
  return {
    aviso: 'Rota TEMPORÁRIA de diagnóstico (somente leitura) — remover antes de produção.',
    codigo,
    dataReferenciaEstoque,
    estrutura,
    dadosProducao,
    produtoAcabado,
    componentes,
    componentesNaoConsultados,
    subestruturas,
    conferencia,
    resumo: resumirDiagnostico(codigo, subestruturas, componentes, componentesNaoConsultados, conferencia),
  };
}

/** Quantidade do item com o % de perda da estrutura: quantidade × (1 + perda/100). Valor ilegível conta como 1 / 0%. */
function quantidadeComPerda(c: Pick<ComponenteDiagnostico, 'quantidade' | 'percPerda'>): number {
  const q = paraNumero(c.quantidade);
  const p = paraNumero(c.percPerda);
  return (q !== null && q >= 0 ? q : 1) * (1 + (p !== null && p > 0 ? p / 100 : 0));
}

/** GGF por unidade de uma estrutura: `custoProducao.vGGF` ou, se zerado, `ConsultarDadosProducao.nValorGGF`. */
function ggfUnitario(s: SubestruturaDiagnostico): { valor: number; fonte: 'estrutura' | 'dadosProducao' } | null {
  const v = s.custoProducao?.vGGF ?? 0;
  if (v > 0) return { valor: v, fonte: 'estrutura' };
  const n = s.dadosProducao?.nValorGGF ?? 0;
  if (n > 0) return { valor: n, fonte: 'dadosProducao' };
  return null;
}

/** Candidatos a "Valor GGF", do mais simples (só o produto) ao acumulado com os subníveis. */
function candidatosGgf(subestruturas: SubestruturaDiagnostico[]): { origem: string; campo: string; valor: number }[] {
  const raiz = subestruturas[0]!;
  const saida: { origem: string; campo: string; valor: number }[] = [
    { origem: 'ConsultarEstrutura.custoProducao', campo: 'vGGF', valor: raiz.custoProducao?.vGGF ?? 0 },
    { origem: 'ConsultarDadosProducao', campo: 'nValorGGF', valor: raiz.dadosProducao?.nValorGGF ?? 0 },
  ];
  if (subestruturas.length > 1) {
    let total = 0;
    for (const s of subestruturas) total += (ggfUnitario(s)?.valor ?? 0) * s.quantidadeNoProduto;
    saida.push({ origem: 'Subestruturas', campo: 'GGF somado de todos os níveis', valor: total });
  }
  return saida;
}

function conferir(codigo: string, subestruturas: SubestruturaDiagnostico[], componentes: ComponenteDiagnostico[]): ConferenciaValor[] | null {
  const referencia = referenciaDoRelatorio(codigo);
  if (referencia === undefined) return null;

  const raiz = subestruturas[0]!;
  const { valor: ggfRelatorio, tolerancia } = interpretarValorRelatorio(referencia.ggf);
  const ggfQueConfere = [
    ...camposQueConferem(referencia.ggf, [
      { origem: 'ConsultarEstrutura.custoProducao', campos: raiz.custoProducao },
      { origem: 'ConsultarDadosProducao', campos: raiz.dadosProducao },
    ]),
    ...candidatosGgf(subestruturas)
      .slice(2)
      .filter((c) => Math.abs(c.valor - ggfRelatorio) <= tolerancia),
  ];
  const conferencia: ConferenciaValor[] = [{ rotulo: 'Valor GGF', esperado: referencia.ggf, confere: ggfQueConfere }];

  for (const [cod, esperado] of Object.entries(referencia.componentes)) {
    const componente = componentes.find((c) => c.codProdMalha === cod);
    if (componente === undefined) {
      conferencia.push({ rotulo: cod, esperado, confere: [], observacao: 'Componente não encontrado na estrutura devolvida pela API.' });
      continue;
    }
    if (esperado === null) {
      const custos = [
        ...Object.entries(componente.camposNumericosEstoque ?? {}).map(([c, v]) => [`ListarPosEstoque.${c}`, v] as const),
        ...Object.entries(componente.camposNumericosProduto ?? {}).map(([c, v]) => [`ConsultarProduto.${c}`, v] as const),
      ].filter(([campo]) => /cmc|cust|preco/i.test(campo));
      conferencia.push({
        rotulo: cod,
        esperado: null,
        confere: [],
        observacao:
          custos.length === 0
            ? 'Relatório sem custo unitário; a API também não traz campo de custo (estoque nem cadastro).'
            : `Relatório sem custo unitário; na API: ${custos.map(([c, v]) => `${c}=${v}`).join(', ')}.`,
      });
      continue;
    }
    conferencia.push({
      rotulo: cod,
      esperado,
      confere: camposQueConferem(esperado, [
        { origem: 'ListarPosEstoque', campos: componente.camposNumericosEstoque },
        { origem: 'ConsultarProduto', campos: componente.camposNumericosProduto },
      ]),
    });
  }
  return conferencia;
}

// ─────────────────────────── resumo em linguagem simples ───────────────────────────

/** Uma linha da tabela "Item | Valor no relatório | Valor que o sistema encontrou | De onde veio | Bate?". */
export interface LinhaResumo {
  item: string;
  descricao: string | null;
  /** 0 = GGF; 1 = item direto do produto; 2+ = item de um kit/subnível. */
  nivel: number;
  /** Código do kit/subestrutura onde o item está (`null` no GGF). */
  pai: string | null;
  /** Como está no relatório do Omie; "sem custo" = relatório não mostra custo; "—" = não informado. */
  valorRelatorio: string;
  /** `null` = sem custo. */
  valorSistema: number | null;
  /** Em português: "custo médio do estoque", "GGF da estrutura do produto"… */
  origem: string;
  /** `null` = não há valor do relatório para comparar. */
  bate: boolean | null;
}

export interface ItemConclusao {
  tipo: 'ok' | 'problema' | 'info';
  texto: string;
}

export interface ResumoDiagnostico {
  linhas: LinhaResumo[];
  conclusao: ItemConclusao[];
  /** `true` só quando tudo bate e nenhum item está sem custo. */
  podeUsar: boolean;
}

const NOME_CAMPO_ESTOQUE: Record<string, string> = {
  nCMC: 'custo médio do estoque',
  nCustoMedio: 'custo médio do estoque',
  nPrecoUnitario: 'preço unitário da posição de estoque',
  nCustoUnitario: 'custo unitário da posição de estoque',
};

const NOME_ORIGEM_GGF: Record<string, string> = {
  'ConsultarEstrutura.custoProducao.vGGF': 'GGF da estrutura do produto',
  'ConsultarDadosProducao.nValorGGF': 'GGF dos dados de produção do produto',
  'Subestruturas.GGF somado de todos os níveis': 'GGF somado das estruturas dos kits/subníveis',
};

function nomeOrigem(c: CampoQueConfere): string {
  const chave = `${c.origem}.${c.campo}`;
  if (NOME_ORIGEM_GGF[chave] !== undefined) return NOME_ORIGEM_GGF[chave]!;
  if (c.origem === 'ListarPosEstoque') return NOME_CAMPO_ESTOQUE[c.campo] ?? `posição de estoque (campo ${c.campo})`;
  if (c.origem === 'ConsultarProduto') return `cadastro do produto (campo ${c.campo})`;
  return `${c.origem} (campo ${c.campo})`;
}

/** O custo que o sistema usa hoje para um item: o mesmo critério do `resolverCusto` (1º candidato positivo do estoque). */
function custoDoSistema(c: ComponenteDiagnostico): { valor: number; origem: string } | null {
  for (const campo of CAMPOS_CUSTO_CANDIDATOS) {
    const v = c.camposNumericosEstoque?.[campo];
    if (v !== undefined && v > 0) return { valor: v, origem: NOME_CAMPO_ESTOQUE[campo] ?? `posição de estoque (campo ${campo})` };
  }
  return null;
}

function numeroBr(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function listaBr(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * Regras fixas que transformam o diagnóstico em tabela + conclusão sem termos técnicos.
 * Não decide preço nenhum: só diz o que bate, o que falta e se o custo já é confiável.
 */
export function resumirDiagnostico(
  codigo: string,
  subestruturas: SubestruturaDiagnostico[],
  componentes: ComponenteDiagnostico[],
  componentesNaoConsultados: number,
  conferencia: ConferenciaValor[] | null,
): ResumoDiagnostico {
  const referencia = referenciaDoRelatorio(codigo);
  const linhas: LinhaResumo[] = [];
  const conclusao: ItemConclusao[] = [];
  const pendencias: string[] = [];

  // ── GGF ──
  const confGgf = conferencia?.find((c) => c.rotulo === 'Valor GGF');
  const candidatos = candidatosGgf(subestruturas);
  const ggfBate = confGgf !== undefined && confGgf.confere.length > 0;
  const ggfEscolhido = ggfBate
    ? { valor: confGgf.confere[0]!.valor, origem: nomeOrigem(confGgf.confere[0]!) }
    : (() => {
        const positivo = candidatos.find((c) => c.valor > 0);
        return positivo === undefined
          ? { valor: 0, origem: 'o Omie devolve GGF zero (produto e subníveis)' }
          : { valor: positivo.valor, origem: nomeOrigem(positivo) };
      })();
  linhas.push({
    item: 'GGF (gastos gerais de fabricação)',
    descricao: null,
    nivel: 0,
    pai: null,
    valorRelatorio: referencia?.ggf ?? '—',
    valorSistema: ggfEscolhido.valor,
    origem: ggfEscolhido.origem,
    bate: referencia === undefined ? null : ggfBate,
  });
  if (referencia === undefined) {
    conclusao.push({
      tipo: 'info',
      texto: `O GGF encontrado é R$ ${numeroBr(ggfEscolhido.valor)} (${ggfEscolhido.origem}). Não há valor do relatório do Omie cadastrado para conferir este produto.`,
    });
  } else if (ggfBate) {
    conclusao.push({ tipo: 'ok', texto: `O GGF bate com o relatório (R$ ${referencia.ggf}) e vem do ${ggfEscolhido.origem}.` });
  } else {
    conclusao.push({
      tipo: 'problema',
      texto:
        ggfEscolhido.valor === 0
          ? `O GGF não bate: o relatório mostra R$ ${referencia.ggf}, mas o Omie devolve GGF zero para este produto e para os kits. É preciso descobrir onde esse valor está cadastrado no Omie ou informá-lo à mão.`
          : `O GGF não bate: o relatório mostra R$ ${referencia.ggf} e o sistema encontrou R$ ${numeroBr(ggfEscolhido.valor)} (${ggfEscolhido.origem}).`,
    });
    pendencias.push('o GGF');
  }

  // ── itens ──
  const semCusto: string[] = [];
  const naoBatem: string[] = [];
  const fontesQueBatem = new Set<string>();
  let conferidos = 0;
  let batem = 0;
  for (const c of componentes) {
    const cod = c.codProdMalha ?? '(sem código)';
    const sistema = custoDoSistema(c);
    if (sistema === null) semCusto.push(cod);
    const ref = referencia !== undefined && c.codProdMalha !== null && Object.hasOwn(referencia.componentes, c.codProdMalha) ? referencia.componentes[c.codProdMalha] : undefined;
    let bate: boolean | null = null;
    let origem = sistema?.origem ?? (c.camposNumericosEstoque === null ? 'não encontrado no estoque do Omie' : 'custo zero no estoque do Omie');
    if (ref === null) {
      bate = sistema === null;
    } else if (typeof ref === 'string') {
      conferidos++;
      const { valor, tolerancia } = interpretarValorRelatorio(ref);
      bate = sistema !== null && Math.abs(sistema.valor - valor) <= tolerancia;
      if (bate) {
        batem++;
        fontesQueBatem.add(sistema!.origem);
      } else {
        const outro = conferencia?.find((x) => x.rotulo === c.codProdMalha)?.confere[0];
        if (outro !== undefined) origem += ` (o relatório bate com: ${nomeOrigem(outro)})`;
        naoBatem.push(`${cod} (relatório ${ref}; sistema ${sistema === null ? 'sem custo' : numeroBr(sistema.valor)})`);
      }
    }
    linhas.push({
      item: cod,
      descricao: c.descricao,
      nivel: c.nivel,
      pai: c.pai,
      valorRelatorio: ref === undefined ? '—' : ref === null ? 'sem custo' : ref,
      valorSistema: sistema?.valor ?? null,
      origem,
      bate,
    });
  }
  // Itens que o relatório mostra mas que não vieram da API (nem nos subníveis).
  const naoEncontrados: string[] = [];
  for (const [cod, ref] of Object.entries(referencia?.componentes ?? {})) {
    if (componentes.some((c) => c.codProdMalha === cod)) continue;
    naoEncontrados.push(cod);
    linhas.push({ item: cod, descricao: null, nivel: 1, pai: null, valorRelatorio: ref ?? 'sem custo', valorSistema: null, origem: 'não aparece na estrutura do Omie (nem nos kits)', bate: false });
  }

  if (referencia === undefined) {
    // sem conferência de itens
  } else if (conferidos === 0) {
    conclusao.push({ tipo: 'info', texto: 'Nenhum item com custo do relatório foi encontrado na estrutura para conferir.' });
  } else if (batem === conferidos) {
    conclusao.push({
      tipo: 'ok',
      texto: `Os custos dos itens conferidos batem com o relatório (${batem} de ${conferidos}) e usam o ${listaBr([...fontesQueBatem])} do Omie.`,
    });
  } else {
    conclusao.push({ tipo: 'problema', texto: `${conferidos - batem} de ${conferidos} itens conferidos não batem com o relatório: ${listaBr(naoBatem)}.` });
    pendencias.push('os itens cujo custo não bate');
  }
  if (naoEncontrados.length > 0) {
    conclusao.push({ tipo: 'problema', texto: `O relatório mostra ${listaBr(naoEncontrados)}, mas ${naoEncontrados.length === 1 ? 'esse item não aparece' : 'esses itens não aparecem'} na estrutura que o Omie devolve (nem dentro dos kits).` });
    pendencias.push('os itens que não aparecem na estrutura');
  }

  // ── sem custo ──
  const diretos = componentes.filter((c) => c.nivel === 1);
  const diretosSemCusto = diretos.filter((c) => custoDoSistema(c) === null).length;
  if (componentes.some((c) => c.nivel > 1)) {
    conclusao.push({
      tipo: diretosSemCusto === 0 ? 'ok' : 'problema',
      texto:
        diretosSemCusto === 0
          ? `Os ${diretos.length} itens diretos do produto (incluindo os kits) têm custo no estoque do Omie.`
          : `${diretosSemCusto} de ${diretos.length} itens diretos do produto estão sem custo no estoque do Omie.`,
    });
  }
  if (semCusto.length === 0) {
    conclusao.push({ tipo: 'ok', texto: `Todos os ${componentes.length} itens da estrutura têm custo.` });
  } else {
    conclusao.push({
      tipo: 'problema',
      texto: `Sem custo: ${listaBr(semCusto)}. Se o preço for montado item a item (abrindo os kits), eles entram como zero — precisam de custo digitado à mão (ou de uma compra lançada no Omie).`,
    });
    pendencias.push(semCusto.length === 1 ? 'o item sem custo' : `os ${semCusto.length} itens sem custo`);
  }
  if (componentesNaoConsultados > 0) {
    conclusao.push({ tipo: 'problema', texto: `A estrutura é grande: ${componentesNaoConsultados} item(ns) ficaram de fora deste diagnóstico.` });
    pendencias.push('os itens que ficaram de fora do diagnóstico');
  }

  // ── perda ──
  const comPerda = componentes.filter((c) => (paraNumero(c.percPerda) ?? 0) > 0);
  conclusao.push(
    comPerda.length === 0
      ? { tipo: 'info', texto: 'Nenhum item tem % de perda cadastrado na estrutura (todos 0%), então a perda não muda nenhuma quantidade.' }
      : {
          tipo: 'info',
          texto: `${comPerda.length} item(ns) têm % de perda cadastrado: ${listaBr(comPerda.map((c) => `${c.codProdMalha ?? '?'} (${(paraNumero(c.percPerda) ?? 0).toLocaleString('pt-BR')}%)`))}. A perda não muda o custo unitário de nenhum item; ela só conta quando o preço é montado item a item, e aí a quantidade deve ser quantidade × (1 + perda). Se o preço usar o custo pronto dos kits, vale o custo médio que o Omie já tem para eles.`,
        },
  );

  // ── veredito ──
  const podeUsar = referencia !== undefined && pendencias.length === 0;
  if (podeUsar) {
    conclusao.push({ tipo: 'ok', texto: 'Pode usar: o custo encontrado pelo sistema confere com o relatório do Omie e nenhum item está sem custo.' });
  } else if (referencia === undefined) {
    conclusao.push({
      tipo: 'info',
      texto: `Não dá para confirmar este custo: não há valores do relatório do Omie cadastrados para ${codigo}.${semCusto.length > 0 ? ' E há itens sem custo.' : ''}`,
    });
  } else {
    conclusao.push({ tipo: 'problema', texto: `Ainda não dá para usar este custo para formar preço. Falta resolver: ${listaBr(pendencias)}.` });
  }

  return { linhas, conclusao, podeUsar };
}
