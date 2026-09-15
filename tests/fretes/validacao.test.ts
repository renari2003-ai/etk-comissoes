import { describe, expect, it } from 'vitest';
import { ErroValidacao } from '../../src/validacao.js';
import {
  validarCnpjOpcional,
  validarEmailOpcional,
  validarModalidade,
  validarNumeroNaoNegativoObrigatorio,
  validarNumeroNaoNegativoOpcional,
} from '../../src/fretes/validacao.js';

describe('validarNumeroNaoNegativoObrigatorio', () => {
  it('aceita zero e positivos', () => {
    expect(validarNumeroNaoNegativoObrigatorio(0, 'valorCusto')).toBe(0);
    expect(validarNumeroNaoNegativoObrigatorio(1000, 'valorCusto')).toBe(1000);
  });

  it('rejeita custo negativo', () => {
    expect(() => validarNumeroNaoNegativoObrigatorio(-1, 'valorCusto')).toThrow(ErroValidacao);
  });

  it('rejeita percentual negativo', () => {
    expect(() => validarNumeroNaoNegativoObrigatorio(-15, 'percentualAcrescimo')).toThrow(ErroValidacao);
  });
});

describe('validarNumeroNaoNegativoOpcional', () => {
  it('permite ausência (peso/volume opcionais)', () => {
    expect(validarNumeroNaoNegativoOpcional(undefined, 'peso')).toBeNull();
  });

  it('rejeita peso negativo', () => {
    expect(() => validarNumeroNaoNegativoOpcional(-5, 'peso')).toThrow(ErroValidacao);
  });
});

describe('validarCnpjOpcional', () => {
  it('normaliza CNPJ com máscara para 14 dígitos', () => {
    expect(validarCnpjOpcional('12.345.678/0001-95')).toBe('12345678000195');
  });

  it('rejeita CNPJ com menos de 14 dígitos', () => {
    expect(() => validarCnpjOpcional('123')).toThrow(ErroValidacao);
  });

  it('permite ausência', () => {
    expect(validarCnpjOpcional(undefined)).toBeNull();
  });
});

describe('validarEmailOpcional', () => {
  it('aceita e-mail válido', () => {
    expect(validarEmailOpcional('contato@transportadora.com.br')).toBe('contato@transportadora.com.br');
  });

  it('rejeita formato inválido', () => {
    expect(() => validarEmailOpcional('nao-e-email')).toThrow(ErroValidacao);
  });
});

describe('validarModalidade', () => {
  it('aceita CIF e FOB', () => {
    expect(validarModalidade('CIF')).toBe('CIF');
    expect(validarModalidade('FOB')).toBe('FOB');
  });

  it('rejeita qualquer outro valor', () => {
    expect(() => validarModalidade('OUTRO')).toThrow(ErroValidacao);
  });
});
