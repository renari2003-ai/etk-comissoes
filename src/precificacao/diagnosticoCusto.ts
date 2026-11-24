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
 * SOMENTE LEITURA: só chamadas de consulta à Omie, sempre pelo `chamar` do `ClienteOmie` (limitador
 * compartilhado com a produção). No banco só grava o que o `ClienteOmie` já grava: o cache existente
 * (`omie_cache`: produto e posição de estoque) e o controle do limitador. Nenhuma tabela nova.
 */

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

/** Teto de componentes consultados por diagnóstico (cada um custa 1 chamada `ConsultarProduto`). */
export const MAX_COMPONENTES_DIAGNOSTICO = 60;

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
  conferencia: ConferenciaValor[] | null;
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
  if (typeof valor === 'string' && /^d{1,15}$/.test(valor.trim())) {
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

  const todosItens = Array.isArray(estrutura.itens) ? (estrutura.itens as Record<string, unknown>[]) : [];
  const itens = todosItens.slice(0, MAX_COMPONENTES_DIAGNOSTICO);
  const componentes: ComponenteDiagnostico[] = [];
  for (const item of itens) {
    const idProdMalha = paraId(item.idProdMalha);
    const componente: ComponenteDiagnostico = {
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
    if (idProdMalha === null) {
      componente.erros.push('Item sem idProdMalha — custo não consultado.');
    } else {
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
    }
    componentes.push(componente);
  }

  return {
    aviso: 'Rota TEMPORÁRIA de diagnóstico (somente leitura) — remover antes de produção.',
    codigo,
    dataReferenciaEstoque,
    estrutura,
    dadosProducao,
    produtoAcabado,
    componentes,
    componentesNaoConsultados: todosItens.length - itens.length,
    conferencia: conferir(codigo, estrutura, dadosProducao, componentes),
  };
}

function conferir(
  codigo: string,
  estrutura: Record<string, unknown>,
  dadosProducao: Record<string, unknown> | { erro: string },
  componentes: ComponenteDiagnostico[],
): ConferenciaValor[] | null {
  const referencia = referenciaDoRelatorio(codigo);
  if (referencia === undefined) return null;

  const custoProducao = (estrutura.custoProducao ?? {}) as Record<string, unknown>;
  const conferencia: ConferenciaValor[] = [
    {
      rotulo: 'Valor GGF',
      esperado: referencia.ggf,
      confere: camposQueConferem(referencia.ggf, [
        { origem: 'ConsultarEstrutura.custoProducao', campos: camposNumericos(custoProducao) },
        { origem: 'ConsultarDadosProducao', campos: 'erro' in dadosProducao ? null : camposNumericos(dadosProducao) },
      ]),
    },
  ];

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
