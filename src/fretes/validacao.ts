/** Validações específicas do módulo de Fretes (seção 11) — nunca confia só no frontend. */

import { ErroValidacao } from '../validacao.js';
import type { CanalOrigemProposta, CanalPrincipalTransportadora, Modalidade, ModalidadeExecucao } from './tipos.js';

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

/**
 * Versão que nunca lança (Fase 4A.4.1, seção 5) — usada para checar o e-mail devolvido pela
 * Omie: um e-mail ausente/vazio/malformado no cadastro Omie deve ser tratado como "fonte
 * indisponível" (segue para bloqueio ou exige manual), nunca como um erro de validação de
 * entrada do usuário.
 */
export function emailValido(valor: string | null): valor is string {
  return valor !== null && REGEX_EMAIL.test(valor.trim());
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

/** Fase 3.2 — usado só para o override manual de destino vindo do frontend (seção 16). */
export interface DestinoManualInformado {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/**
 * Um override manual só é aceito se tiver ao menos CEP, ou logradouro + cidade — mesmo
 * critério de "endereço usável" de `resolucaoDestino.ts`, aplicado aqui na borda HTTP para
 * nunca persistir uma cotação com destino incompleto por engano (seção 29).
 */
export function validarDestinoManualOpcional(valor: unknown): DestinoManualInformado | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'object') throw new ErroValidacao('O campo "destinoOverride" deve ser um objeto.');
  const bruto = valor as Record<string, unknown>;
  const destino: DestinoManualInformado = {
    cep: validarTextoOpcional(bruto.cep, 'destinoOverride.cep'),
    logradouro: validarTextoOpcional(bruto.logradouro, 'destinoOverride.logradouro'),
    numero: validarTextoOpcional(bruto.numero, 'destinoOverride.numero'),
    complemento: validarTextoOpcional(bruto.complemento, 'destinoOverride.complemento'),
    bairro: validarTextoOpcional(bruto.bairro, 'destinoOverride.bairro'),
    cidade: validarTextoOpcional(bruto.cidade, 'destinoOverride.cidade'),
    uf: validarTextoOpcional(bruto.uf, 'destinoOverride.uf'),
  };
  const temCep = destino.cep !== null;
  const temLogradouroECidade = destino.logradouro !== null && destino.cidade !== null;
  if (!temCep && !temLogradouroECidade) {
    throw new ErroValidacao('O destino informado manualmente precisa de ao menos CEP, ou logradouro e cidade.');
  }
  return destino;
}

// --- Fase 4A.1 — automação de cotações com transportadoras ----------------------------

const CANAIS_ORIGEM: readonly CanalOrigemProposta[] = ['EMAIL', 'WHATSAPP', 'MANUAL', 'API', 'OUTRO'];

export function validarCanalOrigem(valor: unknown, campo: string): CanalOrigemProposta {
  if (typeof valor !== 'string' || !CANAIS_ORIGEM.includes(valor as CanalOrigemProposta)) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um dos: ${CANAIS_ORIGEM.join(', ')}.`);
  }
  return valor as CanalOrigemProposta;
}

/** Limite conservador (seção 22/50) — nunca guarda um corpo de e-mail/WhatsApp inteiro sem limite. */
export function validarTextoComTamanhoMaximo(valor: unknown, campo: string, tamanhoMaximo: number): string | null {
  const texto = validarTextoOpcional(valor, campo);
  if (texto !== null && texto.length > tamanhoMaximo) {
    throw new ErroValidacao(`O campo "${campo}" excede o tamanho máximo de ${tamanhoMaximo} caracteres.`);
  }
  return texto;
}

// --- Arquitetura de canais — Fase 1 (só cadastro/exibição de transportadora) -----------

const CANAIS_PRINCIPAIS_TRANSPORTADORA: readonly CanalPrincipalTransportadora[] = ['EMAIL', 'WHATSAPP', 'SITE', 'API'];

/** `null`/ausente = canal não definido (permitido nesta fase) — qualquer valor fora da lista falha explicitamente. */
export function validarCanalPrincipalOpcional(valor: unknown): CanalPrincipalTransportadora | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !CANAIS_PRINCIPAIS_TRANSPORTADORA.includes(valor as CanalPrincipalTransportadora)) {
    throw new ErroValidacao(`O campo "canalPrincipal" deve ser um dos: ${CANAIS_PRINCIPAIS_TRANSPORTADORA.join(', ')}.`);
  }
  return valor as CanalPrincipalTransportadora;
}

/** Confiança da extração (seção 38) — só um número entre 0 e 1; NUNCA usado para decisão financeira, só para alerta/priorização visual. */
export function validarConfiancaOpcional(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0 || numero > 1) {
    throw new ErroValidacao('O campo "confianca" deve ser um número entre 0 e 1.');
  }
  return numero;
}
