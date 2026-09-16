/** Validações específicas do módulo de Fretes (seção 11) — nunca confia só no frontend. */

import { ErroValidacao } from '../validacao.js';
import type { Modalidade, ModalidadeExecucao } from './tipos.js';

export function validarTextoObrigatorio(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErroValidacao(`O campo "${campo}" é obrigatório.`);
  }
  return valor.trim();
}

export function validarTextoOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string') throw new ErroValidacao(`O campo "${campo}" deve ser um texto.`);
  const texto = valor.trim();
  return texto === '' ? null : texto;
}

const REGEX_CNPJ = /^\d{14}$/;

/** Aceita CNPJ com ou sem máscara — normaliza para 14 dígitos antes de validar. */
export function validarCnpjOpcional(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string') throw new ErroValidacao('O campo "cnpj" deve ser um texto.');
  const digitos = valor.replace(/\D/g, '');
  if (!REGEX_CNPJ.test(digitos)) throw new ErroValidacao('O campo "cnpj" deve conter 14 dígitos válidos.');
  return digitos;
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarEmailOpcional(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !REGEX_EMAIL.test(valor.trim())) {
    throw new ErroValidacao('O campo "email" não é um endereço de e-mail válido.');
  }
  return valor.trim();
}

export function validarNumeroNaoNegativoOpcional(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um número maior ou igual a zero.`);
  }
  return numero;
}

export function validarInteiroNaoNegativoOpcional(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um número inteiro maior ou igual a zero.`);
  }
  return numero;
}

export function validarNumeroNaoNegativoObrigatorio(valor: unknown, campo: string): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um número maior ou igual a zero.`);
  }
  return numero;
}

export function validarModalidade(valor: unknown): Modalidade {
  if (valor !== 'CIF' && valor !== 'FOB') {
    throw new ErroValidacao('O campo "modalidade" deve ser "CIF" ou "FOB".');
  }
  return valor;
}

const MODALIDADES_EXECUCAO: readonly ModalidadeExecucao[] = ['TRANSPORTADORA', 'VEICULO_PROPRIO', 'RETIRA'];

/** "Quem executa o frete" (Fase 2) — nunca confundir com `validarModalidade` (CIF/FOB) acima. */
export function validarModalidadeExecucao(valor: unknown): ModalidadeExecucao {
  if (typeof valor !== 'string' || !MODALIDADES_EXECUCAO.includes(valor as ModalidadeExecucao)) {
    throw new ErroValidacao(`O campo "modalidadeExecucao" deve ser um dos: ${MODALIDADES_EXECUCAO.join(', ')}.`);
  }
  return valor as ModalidadeExecucao;
}

export function validarIdOmieOpcional(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um código inteiro positivo da Omie.`);
  }
  return numero;
}

export function validarUuid(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)) {
    throw new ErroValidacao(`O campo "${campo}" é inválido.`);
  }
  return valor;
}

export function validarUuidOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  return validarUuid(valor, campo);
}
