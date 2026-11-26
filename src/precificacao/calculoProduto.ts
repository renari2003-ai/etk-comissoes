/**
 * Etapa 5 — cálculo completo de UM produto para a tela: junta a leitura do Omie (`coletaOmie`), o
 * custo por folha (`montagemCusto`), o cliente da venda (`clienteVenda`), o custo (`calcularCusto`),
 * o cenário, os preços, o modo reverso e os avisos da tabela fiscal. FUNÇÃO PURA (o Omie e o banco
 * são lidos pela rota, `rotas/precificacaoCalculo.ts`).
 *
 * Contrato (spec, "Etapa 4 — como foi implementada"): o resultado junta SEMPRE os avisos de todas
 * as partes — inclusive os da tabela fiscal (`avisosDaTabelaFiscal`, item obrigatório da etapa 5) —
 * sem repetir (mesmo código e mesmo item = uma tarja). "Bloqueado" = qualquer vermelho da lista;
 * "incompleto" = qualquer amarelo. Erro de regra (`ErroPrecificacao`) vira tarja vermelha, nunca
 * preço errado.
 *
 * Unidades: na entrada da API os percentuais vêm em PONTOS (12 = 12%); o cálculo usa FRAÇÃO.
 */

import { ErroValidacao } from '../validacao.js';
import { ErroPrecificacao, ordenarAvisos, precoBloqueado, precoIncompleto, type Aviso } from './avisos.js';
import {
  calcularCusto,
  calcularPrecos,
  calcularReverso,
  determinarCenario,
  margemAntesDoIrCs,
  validarUf,
  type ClienteVenda,
  type EntradaPreco,
  type ResultadoCenario,
  type ResultadoCusto,
  type ResultadoPrecos,
  type ResultadoReverso,
  type Uf,
} from './calculo.js';
import { FINALIDADES_VENDA, type FinalidadeVenda } from './clienteVenda.js';
import type { DadosOmieProduto } from './coletaOmie.js';
import { validarCodigoComponente, validarCustoManual, type CustoManual } from './custoManual.js';
import { montarCusto, type ItemCustoMontado } from './montagemCusto.js';
import { avisosDaTabelaFiscal, excecaoIcmsMgDoNcm, paraParametrosDoCalculo, type TabelaFiscalComMetadados } from './parametrosFiscais.js';

// ─────────────────────────────── entrada (validação estrita) ───────────────────────────────

/** Cliente do Omie (código) OU simulação rápida (UF + tipo de cliente). */
export type ClienteDaEntrada = { codigo: number } | { uf: Uf; contribuinte: boolean; comPta: boolean };

export interface EntradaCalculo {
  produto: string;
  quantidade: number;
  cliente: ClienteDaEntrada;
  finalidade: FinalidadeVenda;
  /** Pontos (12 = 12%). */
  despesas: number;
  comissao: number;
  margem: number;
  /** A margem digitada é líquida (depois do IR/CS)? Então é convertida para antes do IR/CS. */
  margemLiquida: boolean;
  /** Preço-alvo SEM IPI (modo reverso); `null` = desligado. */
  precoAlvo: number | null;
  /** Custo manual "só nesta simulação", por código (nunca gravado). */
  custosSimulacao: CustoManual[];
  /** Escolha do operador quando o manual salvo e o Omie divergem. */
  escolhas: Record<string, 'MANUAL' | 'OMIE'>;
}

/** Teto dos itens que a tela pode mandar (igual ao teto de componentes consultados). */
export const MAX_ITENS_SIMULACAO = 150;
export const QUANTIDADE_MAXIMA = 1_000_000;
export const PRECO_ALVO_MAXIMO = 100_000_000;

const CHAVES_ENTRADA = ['produto', 'quantidade', 'cliente', 'finalidade', 'despesas', 'comissao', 'margem', 'margemLiquida', 'precoAlvo', 'custosSimulacao', 'escolhas'] as const;

function objetoComChaves(valor: unknown, chaves: readonly string[], nome: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new ErroValidacao(`${nome} deve ser um objeto.`);
  const o = valor as Record<string, unknown>;
  const desconhecidas = Object.keys(o).filter((k) => !chaves.includes(k));
  if (desconhecidas.length > 0) throw new ErroValidacao(`${nome}: campo(s) desconhecido(s): ${desconhecidas.join(', ')}.`);
  const faltando = chaves.filter((k) => !Object.hasOwn(o, k));
  if (faltando.length > 0) throw new ErroValidacao(`${nome}: faltam o(s) campo(s) ${faltando.join(', ')}.`);
  return o;
}

function booleano(valor: unknown, nome: string): boolean {
  if (typeof valor !== 'boolean') throw new ErroValidacao(`${nome} deve ser verdadeiro ou falso.`);
  return valor;
}

function casasDecimais(n: number): number {
  const texto = String(n);
  if (texto.includes('e')) return 99;
  const i = texto.indexOf('.');
  return i < 0 ? 0 : texto.length - i - 1;
}

/** Percentual em pontos: 0 ≤ p < 100, até 4 casas. */
function pontos(valor: unknown, nome: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor >= 100) {
    throw new ErroValidacao(`${nome} deve ser um percentual de 0 a 100 (exclusive).`);
  }
  if (casasDecimais(valor) > 4) throw new ErroValidacao(`${nome} com mais de 4 casas decimais.`);
  return valor;
}

function validarCliente(valor: unknown): ClienteDaEntrada {
  if (typeof valor === 'object' && valor !== null && !Array.isArray(valor) && Object.hasOwn(valor, 'codigo')) {
    const o = objetoComChaves(valor, ['codigo'], 'Cliente');
    if (typeof o.codigo !== 'number' || !Number.isSafeInteger(o.codigo) || o.codigo < 1) throw new ErroValidacao('Código do cliente inválido.');
    return { codigo: o.codigo };
  }
  const o = objetoComChaves(valor, ['uf', 'contribuinte', 'comPta'], 'Cliente (simulação rápida)');
  const uf = validarUf(o.uf, 'UF do cliente');
  return { uf, contribuinte: booleano(o.contribuinte, 'Cliente contribuinte'), comPta: booleano(o.comPta, 'Cliente com PTA') };
}

function validarCustosSimulacao(valor: unknown): CustoManual[] {
  if (!Array.isArray(valor)) throw new ErroValidacao('custosSimulacao deve ser uma lista.');
  if (valor.length > MAX_ITENS_SIMULACAO) throw new ErroValidacao(`custosSimulacao com mais de ${MAX_ITENS_SIMULACAO} itens.`);
  const vistos = new Set<string>();
  return valor.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new ErroValidacao('Custo da simulação deve ser um objeto.');
    const { codigo, ...resto } = item as Record<string, unknown>;
    const custo = validarCustoManual(codigo, resto);
    if (vistos.has(custo.codigo)) throw new ErroValidacao(`Custo da simulação repetido para o item ${custo.codigo}.`);
    vistos.add(custo.codigo);
    return custo;
  });
}

function validarEscolhas(valor: unknown): Record<string, 'MANUAL' | 'OMIE'> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new ErroValidacao('escolhas deve ser um objeto.');
  const entradas = Object.entries(valor as Record<string, unknown>);
  if (entradas.length > MAX_ITENS_SIMULACAO) throw new ErroValidacao(`escolhas com mais de ${MAX_ITENS_SIMULACAO} itens.`);
  const escolhas: Record<string, 'MANUAL' | 'OMIE'> = {};
  for (const [codigo, escolha] of entradas) {
    if (escolha !== 'MANUAL' && escolha !== 'OMIE') throw new ErroValidacao(`Escolha de custo inválida para ${codigo} (MANUAL ou OMIE).`);
    const cod = validarCodigoComponente(codigo);
    if (Object.hasOwn(escolhas, cod)) throw new ErroValidacao(`Escolha repetida para o item ${cod}.`);
    escolhas[cod] = escolha;
  }
  return escolhas;
}

/** Corpo do `POST /api/precificacao/calculo`. Validação estrita: chave desconhecida, tipo errado → 400. */
export function validarEntradaCalculo(valor: unknown): EntradaCalculo {
  const o = objetoComChaves(valor, CHAVES_ENTRADA, 'Cálculo');
  let produto: string;
  try {
    produto = validarCodigoComponente(o.produto);
  } catch {
    throw new ErroValidacao('Código do produto inválido (use só letras, números, ponto, hífen ou sublinhado; até 60 caracteres).');
  }
  const quantidade = o.quantidade;
  if (typeof quantidade !== 'number' || !Number.isFinite(quantidade) || quantidade <= 0 || quantidade > QUANTIDADE_MAXIMA) {
    throw new ErroValidacao(`Quantidade deve ser um número maior que zero (até ${QUANTIDADE_MAXIMA.toLocaleString('pt-BR')}).`);
  }
  if (casasDecimais(quantidade) > 4) throw new ErroValidacao('Quantidade com mais de 4 casas decimais.');
  if (typeof o.finalidade !== 'string' || !(FINALIDADES_VENDA as readonly string[]).includes(o.finalidade)) {
    throw new ErroValidacao('Finalidade da venda inválida (INDUSTRIALIZACAO, REVENDA ou USO_CONSUMO).');
  }
  let precoAlvo: number | null = null;
  if (o.precoAlvo !== null) {
    if (typeof o.precoAlvo !== 'number' || !Number.isFinite(o.precoAlvo) || o.precoAlvo <= 0 || o.precoAlvo > PRECO_ALVO_MAXIMO) {
      throw new ErroValidacao('Preço-alvo deve ser um número maior que zero, ou vazio.');
    }
    if (casasDecimais(o.precoAlvo) > 6) throw new ErroValidacao('Preço-alvo com mais de 6 casas decimais.');
    precoAlvo = o.precoAlvo;
  }
  return {
    produto,
    quantidade,
    cliente: validarCliente(o.cliente),
    finalidade: o.finalidade as FinalidadeVenda,
    despesas: pontos(o.despesas, 'Despesas fixas %'),
    comissao: pontos(o.comissao, 'Comissão %'),
    margem: pontos(o.margem, 'Margem %'),
    margemLiquida: booleano(o.margemLiquida, 'Margem líquida'),
    precoAlvo,
    custosSimulacao: validarCustosSimulacao(o.custosSimulacao),
    escolhas: validarEscolhas(o.escolhas),
  };
}

/** Cliente da simulação rápida (UF + tipo), sem consultar o Omie. */
export function clienteSimulado(cliente: { uf: Uf; contribuinte: boolean; comPta: boolean }, finalidade: FinalidadeVenda): { cliente: ClienteVenda; descricao: string } {
  return {
    cliente: {
      uf: cliente.uf,
      contribuinte: cliente.contribuinte,
      usoConsumo: finalidade === 'USO_CONSUMO',
      clienteComPta: cliente.comPta,
      vendaParaIndustrializacao: finalidade === 'INDUSTRIALIZACAO',
    },
    descricao: `Simulação: ${cliente.uf} ${cliente.contribuinte ? 'contribuinte' : 'não contribuinte'}${cliente.comPta ? ', com PTA' : ''}`,
  };
}

// ─────────────────────────────── cálculo ───────────────────────────────

export interface DadosDoCalculo {
  entrada: EntradaCalculo;
  dados: DadosOmieProduto;
  tabela: TabelaFiscalComMetadados;
  manuaisSalvos: ReadonlyMap<string, CustoManual>;
  /** Cliente pronto para o cenário (`null` = não deu: o motivo está em `avisosCliente`). */
  cliente: ClienteVenda | null;
  /** Descrição do cliente para a tela ("Acme Ltda (MG)", "Simulação: SP contribuinte"). */
  descricaoCliente: string;
  avisosCliente: Aviso[];
}

export interface ResultadoCalculoProduto {
  produto: { codigo: string; descricao: string | null; ncm: string | null; conteudoImportado: boolean | null };
  quantidade: number;
  cliente: string;
  itens: ItemCustoMontado[];
  custo: ResultadoCusto | null;
  cenario: ResultadoCenario | null;
  /** Margem usada no divisor, ANTES do IR/CS (fração). */
  margemAntesIrCs: number | null;
  aliquotaIpiVenda: number | null;
  precos: ResultadoPrecos | null;
  reverso: ResultadoReverso | null;
  /** Todos os avisos, sem repetir, na ordem vermelho → amarelo → azul. */
  avisos: Aviso[];
  bloqueado: boolean;
  incompleto: boolean;
}

function juntar(destino: Aviso[], novos: readonly Aviso[]): void {
  for (const a of novos) if (!destino.some((x) => x.codigo === a.codigo && x.item === a.item)) destino.push(a);
}

/** Roda `fn`; erro de regra vira tarja vermelha (e `null`). Qualquer outro erro sobe. */
function ouTarja<T>(avisos: Aviso[], fn: () => T): T | null {
  try {
    return fn();
  } catch (erro) {
    if (erro instanceof ErroPrecificacao) {
      juntar(avisos, [erro.aviso]);
      return null;
    }
    throw erro;
  }
}

export function calcularProduto(d: DadosDoCalculo): ResultadoCalculoProduto {
  const { entrada, dados, tabela } = d;
  const parametros = paraParametrosDoCalculo(tabela);
  const avisos: Aviso[] = [];
  juntar(avisos, dados.avisos);
  juntar(avisos, d.avisosCliente);
  // Item obrigatório da etapa 5: a tarja da tabela fiscal entra em TODO resultado.
  juntar(avisos, avisosDaTabelaFiscal(tabela));

  const resultado: ResultadoCalculoProduto = {
    produto: {
      codigo: entrada.produto,
      descricao: dados.produto?.descricao ?? null,
      ncm: dados.produto?.ncm ?? null,
      conteudoImportado: dados.produto?.conteudoImportado ?? null,
    },
    quantidade: entrada.quantidade,
    cliente: d.descricaoCliente,
    itens: [],
    custo: null,
    cenario: null,
    margemAntesIrCs: null,
    aliquotaIpiVenda: null,
    precos: null,
    reverso: null,
    avisos,
    bloqueado: false,
    incompleto: false,
  };
  const fechar = (): ResultadoCalculoProduto => {
    resultado.avisos = ordenarAvisos(avisos);
    resultado.bloqueado = precoBloqueado(avisos);
    resultado.incompleto = precoIncompleto(avisos);
    return resultado;
  };

  // Sem estrutura ou Omie fora: os dados do Omie não servem para custo nenhum.
  if (dados.avisos.some((a) => a.nivel === 'VERMELHO')) return fechar();

  const montagem = montarCusto({
    dados,
    tabela,
    manuaisSalvos: d.manuaisSalvos,
    manuaisSimulacao: new Map(entrada.custosSimulacao.map((c) => [c.codigo, c])),
    escolhas: entrada.escolhas,
  });
  juntar(avisos, montagem.avisos);
  resultado.itens = montagem.itens;
  resultado.aliquotaIpiVenda = montagem.aliquotaIpiVenda;

  const custo = calcularCusto(montagem.itens);
  juntar(avisos, custo.avisos);
  resultado.custo = custo;

  if (d.cliente === null || montagem.aliquotaIpiVenda === null) return fechar();

  const produtoVenda = {
    icmsInternoMgExcecaoNcm: excecaoIcmsMgDoNcm(tabela, dados.produto?.ncm ?? null),
    // Origem não informada no cadastro = nacional (sem a alíquota de 4% de importado).
    conteudoImportado: dados.produto?.conteudoImportado ?? false,
  };
  const cenario = ouTarja(avisos, () => determinarCenario(d.cliente!, produtoVenda, parametros.venda));
  if (cenario === null) return fechar();
  juntar(avisos, cenario.avisos);
  resultado.cenario = cenario;

  const margem = entrada.margemLiquida ? margemAntesDoIrCs(entrada.margem / 100, parametros.irCs) : entrada.margem / 100;
  resultado.margemAntesIrCs = margem;
  const entradaPreco: EntradaPreco = {
    custoLiquido: custo.custoLiquido,
    cenario,
    comercial: { comissao: entrada.comissao / 100, despesas: entrada.despesas / 100, margem },
    irCs: parametros.irCs,
    aliquotaIpiVenda: montagem.aliquotaIpiVenda,
  };
  const precos = ouTarja(avisos, () => calcularPrecos(entradaPreco));
  if (precos === null) return fechar();
  juntar(avisos, precos.avisos);
  resultado.precos = precos;

  // A tarja do modo reverso fica no bloco do reverso (não bloqueia o preço principal).
  if (entrada.precoAlvo !== null) resultado.reverso = calcularReverso(entrada.precoAlvo, entradaPreco);
  return fechar();
}
