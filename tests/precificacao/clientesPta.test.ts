import { describe, expect, it } from 'vitest';
import { nomeParaGravar, validarBuscaCliente, validarCodigoCliente, validarGravacaoClientePta } from '../../src/precificacao/clientesPta.js';
import { diferencasClientePta } from '../../src/precificacao/clientesPtaRepositorio.js';

const corpo = (sobrescrever: Record<string, unknown> = {}) => ({ versao: null, comPta: true, ...sobrescrever });

describe('cliente com PTA (decisão de 26/11/2026) — validação estrita', () => {
  it('código do cliente: inteiro positivo, na URL como dígitos', () => {
    expect(validarCodigoCliente('123')).toBe(123);
    expect(validarCodigoCliente(456)).toBe(456);
    for (const ruim of ['0', '-1', 'abc', '1.5', '', 0, 1.5, null, '1234567890123456']) {
      expect(() => validarCodigoCliente(ruim)).toThrow(/inválido/);
    }
  });

  it('gravação: só { versao, comPta } — nome e CNPJ do navegador são recusados (vêm do Omie)', () => {
    expect(validarGravacaoClientePta('10', corpo())).toEqual({ versao: null, codigoCliente: 10, comPta: true });
    expect(validarGravacaoClientePta('10', corpo({ versao: 3, comPta: false })).versao).toBe(3);
    expect(() => validarGravacaoClientePta('10', { ...corpo(), nomeCliente: 'X' })).toThrow(/desconhecido/);
    expect(() => validarGravacaoClientePta('10', { versao: null })).toThrow(/faltam/);
    expect(() => validarGravacaoClientePta('10', corpo({ comPta: 'S' }))).toThrow(/verdadeiro ou falso/);
    expect(() => validarGravacaoClientePta('10', corpo({ versao: 0 }))).toThrow(/Versão/);
  });

  it('nome gravado: razão social do Omie; vazia vira "Cliente <código>"; longa é cortada', () => {
    expect(nomeParaGravar(10, ' Acme ')).toBe('Acme');
    expect(nomeParaGravar(10, '')).toBe('Cliente 10');
    expect(nomeParaGravar(10, 'x'.repeat(300))).toHaveLength(200);
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
