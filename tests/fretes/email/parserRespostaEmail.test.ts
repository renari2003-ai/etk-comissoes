import { describe, expect, it } from 'vitest';
import {
  extrairReferencias,
  extrairRespostaEmail,
  interpretarValidade,
  interpretarValorMonetario,
  removerCitacao,
} from '../../../src/fretes/email/parserRespostaEmail.js';

// Parser determinístico das respostas por e-mail — função pura.

describe('valor monetário', () => {
  it.each([
    ['1500', 1500],
    ['1500,00', 1500],
    ['1.500,00', 1500],
    ['1500.00', 1500],
    ['1,500.00', 1500],
    ['R$ 1.234,56', 1234.56],
    ['1.500.000,00', 1500000],
    ['1,500,000.00', 1500000],
    ['  980,5 ', 980.5],
  ])('"%s" → %s', (bruto, esperado) => {
    expect(interpretarValorMonetario(bruto)).toEqual({ tipo: 'OK', valor: esperado });
  });

  it('1500.00 nunca vira 150000 (bug do extrator do n8n)', () => {
    expect(interpretarValorMonetario('1500.00')).toEqual({ tipo: 'OK', valor: 1500 });
  });

  it.each(['1.500', '1,500', '1.500.000', '1500.000', '1.500,000', '15OO', 'a combinar', '1.50.0,00', '-100'])('"%s" é ambíguo → revisão', (bruto) => {
    expect(interpretarValorMonetario(bruto).tipo).toBe('AMBIGUO');
  });

  it('vazio/ausente → AUSENTE', () => {
    expect(interpretarValorMonetario('')).toEqual({ tipo: 'AUSENTE' });
    expect(interpretarValorMonetario(null)).toEqual({ tipo: 'AUSENTE' });
  });
});

describe('validade', () => {
  it('DD/MM/AAAA e AAAA-MM-DD normalizadas para AAAA-MM-DD', () => {
    expect(interpretarValidade('15/10/2026')).toBe('2026-10-15');
    expect(interpretarValidade('5/1/2027')).toBe('2027-01-05');
    expect(interpretarValidade('2026-10-15')).toBe('2026-10-15');
  });
  it('data inexistente ou outro formato → null', () => {
    for (const v of ['31/02/2026', '2026-13-01', '15-10-2026', 'outubro', '10/15/2026']) expect(interpretarValidade(v)).toBeNull();
  });
});

describe('referência FRE', () => {
  it('encontra a referência no assunto (normalizada) e remove repetições', () => {
    expect(extrairReferencias('RE: Cotação de Frete ETK | FRE-2026-000123-ABCD1234')).toEqual(['FRE-2026-000123-abcd1234']);
    expect(extrairReferencias('fre-2026-000123-abcd1234 e FRE-2026-000123-abcd1234')).toEqual(['FRE-2026-000123-abcd1234']);
    expect(extrairReferencias('Cotação FRE-2026-123')).toEqual([]);
  });
});

describe('extração da resposta', () => {
  const ORIGINAL_CITADO = [
    '',
    'Em sex., 2 de out. de 2026 às 10:00, ETK <nfe@etk.ind.br> escreveu:',
    '> Referência: FRE-2026-000123-abcd1234',
    '> VALOR_FRETE:',
    '> PRAZO_DIAS:',
  ].join('\n');

  it('resposta completa: valor real, prazo, validade e observações multilinha; ignora o modelo citado', () => {
    const texto = ['Boa tarde,', '', 'VALOR_FRETE: 1.500,00', 'PRAZO_DIAS: 4 dias úteis', 'VALIDADE: 15/10/2026', 'OBSERVACOES: Cobrar TDE.', 'Agendar entrega.', ORIGINAL_CITADO].join('\n');
    const r = extrairRespostaEmail(texto);
    expect(r.problemas).toEqual([]);
    expect(r.extracao).toMatchObject({ valorFrete: 1500, prazoDias: 4, validade: '2026-10-15', observacoes: 'Cobrar TDE.\nAgendar entrega.', confianca: null });
  });

  it('formato internacional 1500.00 e validade AAAA-MM-DD', () => {
    const r = extrairRespostaEmail('VALOR_FRETE: 1500.00\nVALIDADE: 2026-10-15');
    expect(r.extracao.valorFrete).toBe(1500);
    expect(r.extracao.validade).toBe('2026-10-15');
  });

  it('sem valor → valorFrete null e motivo de revisão (o modelo citado não conta)', () => {
    const r = extrairRespostaEmail(`Segue em anexo.${ORIGINAL_CITADO}`);
    expect(r.extracao.valorFrete).toBeNull();
    expect(r.problemas).toContain('VALOR_FRETE ausente');
  });

  it('valor ambíguo → null e revisão; nunca inventa', () => {
    const r = extrairRespostaEmail('VALOR_FRETE: 1.500');
    expect(r.extracao.valorFrete).toBeNull();
    expect(r.problemas[0]).toMatch(/VALOR_FRETE ambíguo/);
  });

  it('valor repetido com números diferentes → revisão', () => {
    const r = extrairRespostaEmail('VALOR_FRETE: 1500,00\nVALOR_FRETE: 1800,00');
    expect(r.extracao.valorFrete).toBeNull();
    expect(r.problemas[0]).toMatch(/mais de uma vez/);
  });

  it('validade em formato inesperado não bloqueia o valor, mas pede revisão', () => {
    const r = extrairRespostaEmail('VALOR_FRETE: 1500,00\nVALIDADE: 30 dias');
    expect(r.extracao.valorFrete).toBe(1500);
    expect(r.extracao.validade).toBeNull();
    expect(r.problemas[0]).toMatch(/VALIDADE/);
  });

  it('nenhum imposto/encargo aplicado: o valor extraído é exatamente o informado', () => {
    expect(extrairRespostaEmail('VALOR_FRETE: 1.234,56\nGRIS: 10,00\nPEDAGIO: 5,50').extracao).toMatchObject({ valorFrete: 1234.56, gris: 10, pedagio: 5.5 });
  });

  it('remove citação estilo Outlook (De:/From:) e linhas ">"', () => {
    expect(removerCitacao('VALOR_FRETE: 10\n> VALOR_FRETE: 99\nDe: ETK\nVALOR_FRETE: 77')).toBe('VALOR_FRETE: 10');
  });
});
