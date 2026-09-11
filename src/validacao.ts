import type { IdentificadorPedido } from './relatorio/montarRelatorio.js';

export class ErroValidacao extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroValidacao';
  }
}

const REGEX_DATA = /^\d{2}\/\d{2}\/\d{4}$/;

const LIMITE_MAX_POR_PAGINA = 200;
const PADRAO_POR_PAGINA = 50;

export function validarPaginacao(
  paginaBruta: unknown,
  porPaginaBruta: unknown,
): { pagina: number; porPagina: number } {
  let pagina = 1;
  if (paginaBruta !== undefined) {
    const numero = Number(paginaBruta);
    if (!Number.isInteger(numero) || numero < 1) {
      throw new ErroValidacao('O parâmetro "pagina" deve ser um número inteiro maior ou igual a 1.');
    }
    pagina = numero;
  }

  let porPagina = PADRAO_POR_PAGINA;
  if (porPaginaBruta !== undefined) {
    const numero = Number(porPaginaBruta);
    if (!Number.isInteger(numero) || numero < 1 || numero > LIMITE_MAX_POR_PAGINA) {
      throw new ErroValidacao(
        `O parâmetro "por_pagina" deve ser um número inteiro entre 1 e ${LIMITE_MAX_POR_PAGINA}.`,
      );
    }
    porPagina = numero;
  }

  return { pagina, porPagina };
}

export function validarData(valor: unknown, nomeCampo: string): string | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'string' || !REGEX_DATA.test(valor)) {
    throw new ErroValidacao(`O parâmetro "${nomeCampo}" deve estar no formato dd/mm/aaaa.`);
  }
  const [diaStr, mesStr, anoStr] = valor.split('/');
  const dia = Number(diaStr);
  const mes = Number(mesStr);
  const ano = Number(anoStr);
  const dataValida = new Date(ano, mes - 1, dia);
  if (dataValida.getFullYear() !== ano || dataValida.getMonth() !== mes - 1 || dataValida.getDate() !== dia) {
    throw new ErroValidacao(`O parâmetro "${nomeCampo}" contém uma data inválida.`);
  }
  return valor;
}

export function validarEtapa(valor: unknown): string | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'string' || !/^[a-zA-Z0-9]{1,10}$/.test(valor)) {
    throw new ErroValidacao('O parâmetro "etapa" deve ser um código alfanumérico de até 10 caracteres.');
  }
  return valor;
}

export function validarCodigoVendedor(valor: unknown): number | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new ErroValidacao('O parâmetro "vendedor" deve ser um código inteiro positivo.');
  }
  return numero;
}

export function validarBusca(valor: unknown): string | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'string') {
    throw new ErroValidacao('O parâmetro "busca" deve ser um texto.');
  }
  const texto = valor.trim();
  if (texto.length > 100) {
    throw new ErroValidacao('O parâmetro "busca" é muito longo (máximo 100 caracteres).');
  }
  return texto === '' ? undefined : texto;
}

export function validarIdentificadorPedido(valor: unknown, porCodigoBruto: unknown): IdentificadorPedido {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErroValidacao('É necessário informar o identificador do pedido.');
  }
  const identificador = valor.trim();
  if (identificador.length > 50) {
    throw new ErroValidacao('O identificador do pedido é inválido.');
  }

  const porCodigo = porCodigoBruto === 'true' || porCodigoBruto === true;

  if (porCodigo) {
    const numero = Number(identificador);
    if (!Number.isInteger(numero) || numero <= 0) {
      throw new ErroValidacao('Quando "por_codigo" é verdadeiro, o identificador deve ser um número inteiro positivo.');
    }
    return { codigoPedido: numero };
  }

  if (!/^[0-9A-Za-z._-]+$/.test(identificador)) {
    throw new ErroValidacao('O número do pedido contém caracteres inválidos.');
  }
  return { numeroPedido: identificador };
}
