/**
 * Custo manual da formação de preço (etapa 3) — FUNÇÕES PURAS (sem banco, sem Omie).
 * Spec: `docs/precificacao.md`, seção "Custo manual".
 *
 * - O custo é digitado como na nota de compra, COM impostos, junto dos dados fiscais da compra
 *   (UF do fornecedor, diferimento PTA, mercadoria importada, tipo de fornecedor e IPI %).
 * - Um registro com `valorNota = null` guarda só os dados fiscais de um item ESTIMADO (tem custo no
 *   Omie, mas não tem nota de entrada) — nunca troca o custo do Omie.
 * - Prioridade: manual desta simulação > manual salvo > Omie > sem custo. Manual salvo diferente do
 *   Omie: valem os dois na tela (aviso azul) e, até o operador escolher, vale o manual.
 * - Não há mais custo manual de GGF (decisão de 2026-11-25: sem GGF separado).
 *
 * Unidades: na API e no banco o IPI é em PONTOS (12 = 12%); o cálculo usa FRAÇÃO.
 * Validação ESTRITA: chave desconhecida, tipo errado ou combinação incoerente → `ErroValidacao`
 * (400). Nunca "melhor esforço".
 */

import { ErroValidacao } from '../validacao.js';
import type { Aviso } from './avisos.js';
import {
  aliquotaIcmsCompra,
  aliquotaIpiCompraSemNota,
  creditosDaCompra,
  decomporValorNota,
  validarUf,
  type ItemCusto,
  type ParametrosIcmsCompra,
  type TipoFornecedor,
  type Uf,
} from './calculo.js';

export const TIPOS_FORNECEDOR_VALIDOS: readonly TipoFornecedor[] = ['INDUSTRIA_NORMAL', 'SIMPLES_NACIONAL', 'COMERCIO'];

/** Dados fiscais da compra informados pelo operador (os mesmos para custo manual e item estimado). */
export interface DadosFiscaisCompra {
  ufFornecedor: Uf;
  /** Só MG; fora de MG é sempre `false`. */
  diferimentoPta: boolean;
  /** Só fora de MG; em MG é sempre `false`. */
  mercadoriaImportada: boolean;
  tipoFornecedor: TipoFornecedor;
  /**
   * IPI da compra em PONTOS. `null` = não informado: indústria normal usa a alíquota do NCM no
   * cadastro do Omie; comércio/distribuidor usa 0. Simples Nacional é sempre 0.
   */
  ipiPercentual: number | null;
}

export interface CustoManual extends DadosFiscaisCompra {
  /** Código do componente (maiúsculas). */
  codigo: string;
  /** Valor unitário da nota, COM impostos. `null` = só dados fiscais de item estimado. */
  valorNota: number | null;
}

const CODIGO_VALIDO = /^[A-Za-z0-9._-]{1,60}$/;
/** Teto do valor unitário digitado (proteção contra digitação absurda). */
export const VALOR_NOTA_MAXIMO = 10_000_000;

export function validarCodigoComponente(valor: unknown): string {
  if (typeof valor !== 'string' || !CODIGO_VALIDO.test(valor.trim())) {
    throw new ErroValidacao('Código do componente inválido (use só letras, números, ponto, hífen ou sublinhado; até 60 caracteres).');
  }
  const codigo = valor.trim().toUpperCase();
  // "historico" é um caminho da API (`/custos-manuais/historico`), nunca um código de componente.
  if (codigo === 'HISTORICO') throw new ErroValidacao('Código do componente inválido.');
  return codigo;
}

function casasDecimais(n: number): number {
  const texto = String(n);
  if (texto.includes('e')) return 99;
  const i = texto.indexOf('.');
  return i < 0 ? 0 : texto.length - i - 1;
}

function exigirObjetoComChaves(valor: unknown, chaves: readonly string[], nome: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new ErroValidacao(`${nome} deve ser um objeto.`);
  const o = valor as Record<string, unknown>;
  const desconhecidas = Object.keys(o).filter((k) => !chaves.includes(k));
  if (desconhecidas.length > 0) throw new ErroValidacao(`${nome}: campo(s) desconhecido(s): ${desconhecidas.join(', ')}.`);
  const faltando = chaves.filter((k) => !Object.hasOwn(o, k));
  if (faltando.length > 0) throw new ErroValidacao(`${nome}: faltam o(s) campo(s) ${faltando.join(', ')}.`);
  return o;
}

function exigirBooleano(valor: unknown, nome: string): boolean {
  if (typeof valor !== 'boolean') throw new ErroValidacao(`${nome} deve ser verdadeiro ou falso.`);
  return valor;
}

function validarValorNota(valor: unknown): number | null {
  if (valor === null) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    throw new ErroValidacao('Valor da nota deve ser um número maior que zero (ou vazio, para guardar só os dados fiscais).');
  }
  if (valor > VALOR_NOTA_MAXIMO) throw new ErroValidacao(`Valor da nota acima do limite (R$ ${VALOR_NOTA_MAXIMO.toLocaleString('pt-BR')}).`);
  if (casasDecimais(valor) > 6) throw new ErroValidacao('Valor da nota com mais de 6 casas decimais.');
  return valor;
}

function validarIpiPercentual(valor: unknown): number | null {
  if (valor === null) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor >= 100) {
    throw new ErroValidacao('IPI % deve ser um número de 0 a 100 (exclusive), ou vazio.');
  }
  if (casasDecimais(valor) > 4) throw new ErroValidacao('IPI % com mais de 4 casas decimais.');
  return valor;
}

/** Valida os dados fiscais e as combinações (PTA só em MG; importada só fora de MG; Simples = IPI 0). */
export function validarDadosFiscais(o: Record<string, unknown>): DadosFiscaisCompra {
  const ufFornecedor = validarUf(o.ufFornecedor, 'UF do fornecedor');
  const diferimentoPta = exigirBooleano(o.diferimentoPta, 'Compra com diferimento PTA');
  const mercadoriaImportada = exigirBooleano(o.mercadoriaImportada, 'Mercadoria importada');
  if (ufFornecedor !== 'MG' && diferimentoPta) throw new ErroValidacao('"Diferimento PTA" só se aplica a compras de MG.');
  if (ufFornecedor === 'MG' && mercadoriaImportada) throw new ErroValidacao('"Mercadoria importada" só se aplica a compras de fora de MG.');
  if (typeof o.tipoFornecedor !== 'string' || !(TIPOS_FORNECEDOR_VALIDOS as readonly string[]).includes(o.tipoFornecedor)) {
    throw new ErroValidacao('Tipo de fornecedor inválido (INDUSTRIA_NORMAL, SIMPLES_NACIONAL ou COMERCIO).');
  }
  const tipoFornecedor = o.tipoFornecedor as TipoFornecedor;
  let ipiPercentual = validarIpiPercentual(o.ipiPercentual);
  if (tipoFornecedor === 'SIMPLES_NACIONAL') {
    if (ipiPercentual !== null && ipiPercentual !== 0) {
      throw new ErroValidacao('Fornecedor do Simples Nacional não dá crédito de IPI: o IPI da compra é sempre 0.');
    }
    ipiPercentual = 0;
  }
  return { ufFornecedor, diferimentoPta, mercadoriaImportada, tipoFornecedor, ipiPercentual };
}

const CHAVES_CUSTO = ['valorNota', 'ufFornecedor', 'diferimentoPta', 'mercadoriaImportada', 'tipoFornecedor', 'ipiPercentual'] as const;

/** Custo manual (o código vem da URL). */
export function validarCustoManual(codigo: unknown, valor: unknown): CustoManual {
  const cod = validarCodigoComponente(codigo);
  const o = exigirObjetoComChaves(valor, CHAVES_CUSTO, 'Custo manual');
  return { codigo: cod, valorNota: validarValorNota(o.valorNota), ...validarDadosFiscais(o) };
}

function validarVersao(valor: unknown): number | null {
  if (valor === null) return null;
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 1) {
    throw new ErroValidacao('Versão do custo manual inválida — recarregue a tela.');
  }
  return valor;
}

/** Corpo do PUT: o custo + a `versao` lida (`null` = item novo). Concorrência otimista: 409 se mudou. */
export function validarGravacaoCustoManual(codigo: unknown, valor: unknown): { versao: number | null; custo: CustoManual } {
  const o = exigirObjetoComChaves(valor, ['versao', ...CHAVES_CUSTO], 'Custo manual');
  const { versao, ...resto } = o;
  return { versao: validarVersao(versao), custo: validarCustoManual(codigo, resto) };
}

/** Corpo do DELETE: só a `versao` lida. */
export function validarRemocaoCustoManual(valor: unknown): number {
  const o = exigirObjetoComChaves(valor, ['versao'], 'Remoção do custo manual');
  const versao = validarVersao(o.versao);
  if (versao === null) throw new ErroValidacao('Versão do custo manual é obrigatória para remover.');
  return versao;
}

// ─────────────────────────────── conversão para o cálculo ───────────────────────────────

export interface CustoDoItem extends Pick<ItemCusto, 'custoBrutoUnitario' | 'custoLiquidoUnitario'> {
  /** Alíquotas usadas (fração) — `aliquotaIpi = null` = sem NCM/IPI: entra pelo bruto, sem crédito. */
  aliquotaIpi: number | null;
  aliquotaIcms: number;
  creditoIpi: number;
  creditoPisCofins: number;
}

/**
 * Custo unitário bruto e líquido de uma compra SEM nota de entrada (valor da nota digitado, ou
 * custo do Omie de um item estimado), pelas regras de "Impostos na compra".
 * `ipiCadastroFracao` = alíquota de IPI do NCM no cadastro do componente no Omie (`null` = sem).
 */
export function custoDaCompraSemNota(
  valorUnitario: number,
  dados: DadosFiscaisCompra,
  ipiCadastroFracao: number | null,
  parametros: ParametrosIcmsCompra,
  pisCofins: number,
): CustoDoItem {
  const aliquotaIcms = aliquotaIcmsCompra(dados, parametros);
  const aliquotaIpi = aliquotaIpiCompraSemNota({
    tipoFornecedor: dados.tipoFornecedor,
    ipiCadastro: ipiCadastroFracao,
    ipiInformado: dados.ipiPercentual === null ? null : dados.ipiPercentual / 100,
  });
  if (aliquotaIpi === null) {
    // Indústria normal sem IPI informado e sem NCM/IPI no cadastro: pelo bruto, sem crédito nenhum.
    return { custoBrutoUnitario: valorUnitario, custoLiquidoUnitario: null, aliquotaIpi: null, aliquotaIcms, creditoIpi: 0, creditoPisCofins: 0 };
  }
  const compra = creditosDaCompra(decomporValorNota(valorUnitario, aliquotaIpi, aliquotaIcms), pisCofins);
  return {
    custoBrutoUnitario: compra.valorBruto,
    custoLiquidoUnitario: compra.custoLiquido,
    aliquotaIpi,
    aliquotaIcms,
    creditoIpi: compra.creditoIpi,
    creditoPisCofins: compra.creditoPisCofins,
  };
}

// ─────────────────────────────── prioridade Manual > Omie ───────────────────────────────

export type OrigemCusto = 'MANUAL_SIMULACAO' | 'MANUAL_SALVO' | 'OMIE' | 'SEM_CUSTO';

export interface EntradaResolucaoCusto {
  codigo: string;
  /** Custo médio do estoque no Omie (com impostos). `null` ou ≤ 0 = sem custo no Omie. */
  custoOmie: number | null;
  manualSalvo: CustoManual | null;
  /** "Só nesta simulação" — não grava nada, vale só para este cálculo. */
  manualSimulacao: CustoManual | null;
  /** Escolha do operador quando o manual salvo e o Omie divergem. Sem escolha, vale o manual. */
  escolhaConflito?: 'MANUAL' | 'OMIE' | null;
}

export interface CustoResolvido {
  codigo: string;
  origem: OrigemCusto;
  /** Valor unitário com impostos que entra no cálculo (`null` = sem custo, entra como zero). */
  valorUnitario: number | null;
  /** Dados fiscais informados pelo operador (do manual da simulação ou do salvo), se houver. */
  dadosFiscais: DadosFiscaisCompra | null;
  /** Manual salvo e Omie com valores diferentes: a tela mostra os dois para o operador escolher. */
  conflito: { valorManual: number; valorOmie: number; escolhido: 'MANUAL' | 'OMIE' } | null;
  avisos: Aviso[];
}

const dinheiro = (v: number): string => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

/** Diferença acima disto é "valor diferente" (abaixo é ruído de ponto flutuante). */
const TOLERANCIA_CONFLITO = 1e-9;

export function resolverCustoItem(entrada: EntradaResolucaoCusto): CustoResolvido {
  const codigo = validarCodigoComponente(entrada.codigo);
  for (const m of [entrada.manualSalvo, entrada.manualSimulacao]) {
    if (m !== null && m.codigo !== codigo) throw new ErroValidacao(`Custo manual de ${m.codigo} não pertence ao item ${codigo}.`);
  }
  if (entrada.custoOmie !== null && (typeof entrada.custoOmie !== 'number' || !Number.isFinite(entrada.custoOmie) || entrada.custoOmie < 0)) {
    throw new ErroValidacao(`Custo do Omie do item ${codigo} inválido.`);
  }
  const escolha = entrada.escolhaConflito ?? null;
  if (escolha !== null && escolha !== 'MANUAL' && escolha !== 'OMIE') throw new ErroValidacao('Escolha de custo inválida (MANUAL ou OMIE).');

  const omie = entrada.custoOmie !== null && entrada.custoOmie > 0 ? entrada.custoOmie : null;
  const salvo = entrada.manualSalvo;
  const simulacao = entrada.manualSimulacao;
  const dadosFiscais = simulacao ?? salvo;
  const fiscais = (m: CustoManual | null): DadosFiscaisCompra | null =>
    m === null
      ? null
      : { ufFornecedor: m.ufFornecedor, diferimentoPta: m.diferimentoPta, mercadoriaImportada: m.mercadoriaImportada, tipoFornecedor: m.tipoFornecedor, ipiPercentual: m.ipiPercentual };

  if (simulacao !== null && simulacao.valorNota !== null) {
    return { codigo, origem: 'MANUAL_SIMULACAO', valorUnitario: simulacao.valorNota, dadosFiscais: fiscais(simulacao), conflito: null, avisos: [] };
  }

  const manual = salvo?.valorNota ?? null;
  if (manual !== null && omie !== null && Math.abs(manual - omie) > TOLERANCIA_CONFLITO) {
    const escolhido = escolha ?? 'MANUAL';
    return {
      codigo,
      origem: escolhido === 'OMIE' ? 'OMIE' : 'MANUAL_SALVO',
      valorUnitario: escolhido === 'OMIE' ? omie : manual,
      dadosFiscais: fiscais(dadosFiscais),
      conflito: { valorManual: manual, valorOmie: omie, escolhido },
      avisos: [
        {
          nivel: 'AZUL',
          codigo: 'CUSTO_MANUAL_DIFERENTE_OMIE',
          item: codigo,
          mensagem: `Item ${codigo}: custo manual ${dinheiro(manual)} e custo do Omie ${dinheiro(omie)}. Está valendo o ${escolhido === 'OMIE' ? 'do Omie' : 'manual'}${escolha === null ? ' (até você escolher)' : ''}.`,
        },
      ],
    };
  }
  if (escolha === 'OMIE' && omie === null) throw new ErroValidacao(`Item ${codigo} não tem custo no Omie para escolher.`);
  if (manual !== null) return { codigo, origem: 'MANUAL_SALVO', valorUnitario: manual, dadosFiscais: fiscais(dadosFiscais), conflito: null, avisos: [] };
  if (omie !== null) return { codigo, origem: 'OMIE', valorUnitario: omie, dadosFiscais: fiscais(dadosFiscais), conflito: null, avisos: [] };
  return { codigo, origem: 'SEM_CUSTO', valorUnitario: null, dadosFiscais: fiscais(dadosFiscais), conflito: null, avisos: [] };
}
