import { describe, expect, it } from 'vitest';
import { validarBuscaCliente, validarCodigoCliente, validarGravacaoClientePta } from '../../src/precificacao/clientesPta.js';
import { diferencasClientePta } from '../../src/precificacao/clientesPtaRepositorio.js';

const corpo = (sobrescrever: Record<string, unknown> = {}) => ({ versao: null, comPta: true, nomeCliente: 'Cliente Teste Ltda', cnpjCpf: '12345678000199', ...sobrescrever });

describe('cliente com PTA (decisão de 26/11/2026) — validação estrita', () => {
  it('código do cliente: inteiro positivo, na URL como dígitos', () => {
    expect(validarCodigoCliente('123')).toBe(123);
    expect(validarCodigoCliente(456)).toBe(456);
    for (const ruim of ['0', '-1', 'abc', '1.5', '', 0, 1.5, null, '1234567890123456']) {
      expect(() => validarCodigoCliente(ruim)).toThrow(/inválido/);
    }
  });

  it('gravação: só as 4 chaves, comPta booleano, nome obrigatório, CNPJ/CPF só dígitos (ou null)', () => {
    expect(validarGravacaoClientePta('10', corpo({ nomeCliente: '  Cliente  ' }))).toEqual({
      versao: null,
      cliente: { codigoCliente: 10, comPta: true, nomeCliente: 'Cliente', cnpjCpf: '12345678000199' },
    });
    expect(validarGravacaoClientePta('10', corpo({ versao: 3, comPta: false, cnpjCpf: null })).versao).toBe(3);
    expect(() => validarGravacaoClientePta('10', { ...corpo(), extra: 1 })).toThrow(/desconhecido/);
    const { cnpjCpf: _x, ...semCnpj } = corpo();
    expect(() => validarGravacaoClientePta('10', semCnpj)).toThrow(/faltam/);
    expect(() => validarGravacaoClientePta('10', corpo({ comPta: 'S' }))).toThrow(/verdadeiro ou falso/);
    expect(() => validarGravacaoClientePta('10', corpo({ nomeCliente: '  ' }))).toThrow(/Nome do cliente/);
    expect(() => validarGravacaoClientePta('10', corpo({ cnpjCpf: '12.345.678/0001-99' }))).toThrow(/CNPJ/);
    expect(() => validarGravacaoClientePta('10', corpo({ versao: 0 }))).toThrow(/Versão/);
  });

  it('busca no Omie: CNPJ/CPF (11 ou 14 dígitos) OU nome (3+ letras), nunca os dois nem vazio', () => {
    expect(validarBuscaCliente({ cnpj: '12.345.678/0001-99' })).toEqual({ cnpj: '12345678000199' });
    expect(validarBuscaCliente({ nome: ' Acme ' })).toEqual({ nome: 'Acme' });
    expect(() => validarBuscaCliente({})).toThrow(/pelo menos 3 letras/);
    expect(() => validarBuscaCliente({ nome: 'ab' })).toThrow(/pelo menos 3 letras/);
    expect(() => validarBuscaCliente({ cnpj: '123' })).toThrow(/11 ou 14/);
    expect(() => validarBuscaCliente({ cnpj: '12345678000199', nome: 'Acme' })).toThrow(/não pelos dois/);
    expect(() => validarBuscaCliente({ nome: ['a', 'b'] })).toThrow(/único/);
    expect(() => validarBuscaCliente({ nome: 'Acme', x: '1' })).toThrow(/desconhecido/);
  });

  it('histórico: primeira gravação lista os campos preenchidos; depois, só o que mudou', () => {
    const c = { codigoCliente: 1, comPta: true, nomeCliente: 'A', cnpjCpf: null };
    expect(diferencasClientePta(null, c)).toEqual([
      { campo: 'comPta', valorAnterior: null, valorNovo: 'true' },
      { campo: 'nomeCliente', valorAnterior: null, valorNovo: 'A' },
    ]);
    expect(diferencasClientePta(c, { ...c, comPta: false })).toEqual([{ campo: 'comPta', valorAnterior: 'true', valorNovo: 'false' }]);
    expect(diferencasClientePta(c, c)).toEqual([]);
  });
});
