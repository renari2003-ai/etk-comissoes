import { describe, expect, it } from 'vitest';
import { validarPayloadWebhookResposta, VERSAO_CONTRATO_WEBHOOK } from '../../src/fretes/webhookCotacoes.js';
import { ErroValidacao } from '../../src/validacao.js';

function payloadBase(): Record<string, unknown> {
  return {
    versao: VERSAO_CONTRATO_WEBHOOK,
    referencia: 'FRE-2026-000001-a1b2c3d4',
    canal: 'EMAIL',
    mensagemId: 'msg-123',
    conteudoBruto: 'Prezados, segue nossa cotação: R$ 1.234,56, prazo 5 dias úteis.',
    versaoExtrator: 'n8n-ia-v1',
    extracao: {
      valorFrete: 1234.56,
      prazoDias: 5,
      validade: '2026-12-31',
      pedagio: 45.0,
      gris: 10.5,
      adValorem: null,
      taxas: [{ nome: 'Seguro', valor: 20 }],
      observacoes: 'Frete rodoviário fracionado.',
      numeroProposta: 'PROP-998',
      confianca: 0.92,
    },
  };
}

describe('validarPayloadWebhookResposta — contrato Fase 4A.1 (seção 43/44)', () => {
  it('aceita um payload completo e bem formado', () => {
    const resultado = validarPayloadWebhookResposta(payloadBase());
    expect(resultado.referencia).toBe('FRE-2026-000001-a1b2c3d4');
    expect(resultado.canal).toBe('EMAIL');
    expect(resultado.extracao.valorFrete).toBe(1234.56);
    expect(resultado.extracao.taxas).toEqual([{ nome: 'Seguro', valor: 20 }]);
  });

  it('rejeita versão de contrato diferente da suportada (seção 44)', () => {
    const payload = { ...payloadBase(), versao: 2 };
    expect(() => validarPayloadWebhookResposta(payload)).toThrow(ErroValidacao);
  });

  it('rejeita payload sem "referencia" (seção 22 — nunca confia no payload)', () => {
    const payload = payloadBase();
    delete (payload as Record<string, unknown>).referencia;
    expect(() => validarPayloadWebhookResposta(payload)).toThrow(ErroValidacao);
  });

  it('rejeita "canal" fora do enum', () => {
    const payload = { ...payloadBase(), canal: 'TELEGRAM' };
    expect(() => validarPayloadWebhookResposta(payload)).toThrow(ErroValidacao);
  });

  it('rejeita "mensagemId" ausente', () => {
    const payload = payloadBase();
    delete (payload as Record<string, unknown>).mensagemId;
    expect(() => validarPayloadWebhookResposta(payload)).toThrow(ErroValidacao);
  });

  it('rejeita "extracao" ausente', () => {
    const payload = payloadBase();
    delete (payload as Record<string, unknown>).extracao;
    expect(() => validarPayloadWebhookResposta(payload)).toThrow(ErroValidacao);
  });

  it('aceita extração incompleta (sem valorFrete) sem lançar erro — a decisão de criar ou não proposta é do serviço, não da validação de payload', () => {
    const payload = payloadBase();
    (payload.extracao as Record<string, unknown>).valorFrete = null;
    const resultado = validarPayloadWebhookResposta(payload);
    expect(resultado.extracao.valorFrete).toBeNull();
  });

  it('rejeita confiança fora do intervalo [0,1]', () => {
    const payload = payloadBase();
    (payload.extracao as Record<string, unknown>).confianca = 1.5;
    expect(() => validarPayloadWebhookResposta(payload)).toThrow(ErroValidacao);
  });

  it('estrutura múltiplos componentes de valor separadamente, sem somar nada automaticamente (seção 40)', () => {
    const payload = payloadBase();
    (payload.extracao as Record<string, unknown>).taxas = [
      { nome: 'GRIS', valor: 10 },
      { nome: 'Pedágio', valor: 45 },
    ];
    const resultado = validarPayloadWebhookResposta(payload);
    expect(resultado.extracao.valorFrete).toBe(1234.56); // nunca alterado por causa das taxas
    expect(resultado.extracao.taxas).toHaveLength(2);
  });

  it('rejeita item de "taxas" sem nome', () => {
    const payload = payloadBase();
    (payload.extracao as Record<string, unknown>).taxas = [{ valor: 10 }];
    expect(() => validarPayloadWebhookResposta(payload)).toThrow(ErroValidacao);
  });

  it('rejeita conteudoBruto acima do tamanho máximo (seção 22/50)', () => {
    const payload = { ...payloadBase(), conteudoBruto: 'x'.repeat(20001) };
    expect(() => validarPayloadWebhookResposta(payload)).toThrow(ErroValidacao);
  });

  it('usa "externo" como versaoExtrator padrão quando omitido', () => {
    const payload = payloadBase();
    delete (payload as Record<string, unknown>).versaoExtrator;
    const resultado = validarPayloadWebhookResposta(payload);
    expect(resultado.versaoExtrator).toBe('externo');
  });
});
