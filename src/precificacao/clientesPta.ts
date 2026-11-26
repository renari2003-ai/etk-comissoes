/**
 * "Cliente com PTA (compra para industrialização)" — marcado no app, por cliente do Omie (decisão
 * de 26/11/2026: o Omie não tem esse campo). FUNÇÕES PURAS de validação (sem banco, sem Omie).
 * Só o administrador marca/desmarca; toda mudança vai para o histórico. Nada é gravado no Omie.
 *
 * O cenário A (venda com diferimento) exige este marcador E a venda ser para industrialização
 * (`calculo.ts`, `determinarCenario`). Validação ESTRITA: chave desconhecida ou tipo errado → 400.
 */

import { ErroValidacao } from '../validacao.js';

export interface ClientePta {
  /** `codigo_cliente_omie` do cadastro do Omie. */
  codigoCliente: number;
  comPta: boolean;
  /** Razão social no momento da gravação (só para a lista e o histórico; a fonte é o Omie). */
  nomeCliente: string;
  /** CNPJ/CPF só com dígitos, se o Omie tiver. */
  cnpjCpf: string | null;
}

export const TAMANHO_MAXIMO_NOME_CLIENTE = 200;

function exigirObjetoComChaves(valor: unknown, chaves: readonly string[], nome: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new ErroValidacao(`${nome} deve ser um objeto.`);
  const o = valor as Record<string, unknown>;
  const desconhecidas = Object.keys(o).filter((k) => !chaves.includes(k));
  if (desconhecidas.length > 0) throw new ErroValidacao(`${nome}: campo(s) desconhecido(s): ${desconhecidas.join(', ')}.`);
  const faltando = chaves.filter((k) => !Object.hasOwn(o, k));
  if (faltando.length > 0) throw new ErroValidacao(`${nome}: faltam o(s) campo(s) ${faltando.join(', ')}.`);
  return o;
}

/** Código do cliente no Omie: inteiro positivo (na URL chega como texto de dígitos). */
export function validarCodigoCliente(valor: unknown): number {
  const n = typeof valor === 'string' && /^\d{1,15}$/.test(valor.trim()) ? Number(valor.trim()) : valor;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new ErroValidacao('Código do cliente no Omie inválido.');
  return n;
}

function validarVersao(valor: unknown): number | null {
  if (valor === null) return null;
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 1) {
    throw new ErroValidacao('Versão do cliente com PTA inválida — recarregue a tela.');
  }
  return valor;
}

/**
 * Corpo do PUT: só `{ versao, comPta }` (`versao = null` = cliente ainda não marcado no app). Nome e
 * CNPJ/CPF NÃO vêm do navegador: a rota confere o cliente no Omie (só leitura) e usa o cadastro de
 * lá (revisão de 26/11/2026).
 */
export function validarGravacaoClientePta(codigo: unknown, valor: unknown): { versao: number | null; codigoCliente: number; comPta: boolean } {
  const codigoCliente = validarCodigoCliente(codigo);
  const o = exigirObjetoComChaves(valor, ['versao', 'comPta'], 'Cliente com PTA');
  if (typeof o.comPta !== 'boolean') throw new ErroValidacao('"Cliente com PTA" deve ser verdadeiro ou falso.');
  return { versao: validarVersao(o.versao), codigoCliente, comPta: o.comPta };
}

/** Nome para a lista e o histórico: a razão social do Omie (vazia → "Cliente <código>"), até o tamanho máximo. */
export function nomeParaGravar(codigoCliente: number, razaoSocial: string): string {
  const nome = razaoSocial.trim() === '' ? `Cliente ${codigoCliente}` : razaoSocial.trim();
  return nome.slice(0, TAMANHO_MAXIMO_NOME_CLIENTE);
}

/** Busca de cliente no Omie (só leitura): CNPJ/CPF OU parte do nome — nunca os dois, nunca vazio. */
export function validarBuscaCliente(query: Record<string, unknown>): { cnpj: string } | { nome: string } {
  const desconhecidas = Object.keys(query).filter((k) => k !== 'cnpj' && k !== 'nome');
  if (desconhecidas.length > 0) throw new ErroValidacao(`Busca de cliente: parâmetro(s) desconhecido(s): ${desconhecidas.join(', ')}.`);
  const cnpj = typeof query.cnpj === 'string' ? query.cnpj.replace(/\D/g, '') : '';
  const nome = typeof query.nome === 'string' ? query.nome.trim() : '';
  if ((query.cnpj !== undefined && typeof query.cnpj !== 'string') || (query.nome !== undefined && typeof query.nome !== 'string')) {
    throw new ErroValidacao('Busca de cliente: use um único "cnpj" ou um único "nome".');
  }
  if (cnpj !== '' && nome !== '') throw new ErroValidacao('Busque por CNPJ/CPF ou por nome, não pelos dois.');
  if (cnpj !== '') {
    if (cnpj.length !== 11 && cnpj.length !== 14) throw new ErroValidacao('CNPJ/CPF deve ter 11 ou 14 dígitos.');
    return { cnpj };
  }
  if (nome.length < 3 || nome.length > 100) throw new ErroValidacao('Digite o CNPJ/CPF ou pelo menos 3 letras do nome do cliente.');
  return { nome };
}
