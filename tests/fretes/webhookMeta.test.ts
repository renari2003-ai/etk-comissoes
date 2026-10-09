import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { desafioWebhookMeta, validarEventosMeta, verificarAssinaturaMeta } from '../../src/fretes/webhookMeta.js';
import { capturarCorpoBruto, obterCorpoBruto } from '../../src/rotas/corpoBruto.js';
import type { IncomingMessage } from 'node:http';
const phone = '1433778859808018';
const body = (value: unknown) => ({ object: 'whatsapp_business_account', entry: [{ id: '2965164870494763', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phone }, ...value as object } }] }] });
it('desafio exige token e modo exatos; retorna apenas challenge', () => {
  expect(desafioWebhookMeta({ 'hub.mode': 'subscribe', 'hub.verify_token': 'teste', 'hub.challenge': '123' }, 'teste')).toBe('123');
  expect(desafioWebhookMeta({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '123' }, 'teste')).toBeNull();
  expect(desafioWebhookMeta({}, '')).toBeNull();
});
it('valida assinatura sobre bytes exatos; corpo alterado/segredo ausente recusados', () => {
  const b = Buffer.from('{"x":1}');
  const sig = `sha256=${createHmac('sha256', 'segredo-teste').update(b).digest('hex')}`;
  expect(verificarAssinaturaMeta(sig, b, 'segredo-teste')).toBe(true);
  expect(verificarAssinaturaMeta(sig, Buffer.from('{}'), 'segredo-teste')).toBe(false);
  expect(verificarAssinaturaMeta(sig, b, '')).toBe(false);
  const req = { url: '/api/fretes/integracoes/meta/webhook' } as IncomingMessage;
  capturarCorpoBruto(req, null, b);
  expect(obterCorpoBruto(req)).toEqual(b);
});
it('converte lote, preservando WAMID/contexto e status de falha', () => {
  const eventos = validarEventosMeta(body({ messages: [{ id: 'wamid.resposta', from: '5511987654321', timestamp: '1791540000', type: 'text', text: { body: 'VALOR_FRETE: 100' }, context: { id: 'wamid.envio' } }], statuses: [{ id: 'wamid.envio', status: 'failed', errors: [{ code: 131042, message: 'Pagamento' }] }] }), phone);
  expect(eventos).toHaveLength(2);
  expect(eventos[0]).toMatchObject({ tipo: 'MENSAGEM_RECEBIDA', mensagem: { wamid: 'wamid.resposta', contextoId: 'wamid.envio' } });
  expect(eventos[1]).toMatchObject({ tipo: 'STATUS', mensagem: { erroCodigo: '131042' } });
});
it('não processa outro telefone nem envelope malformado', () => {
  expect(validarEventosMeta(body({}), '9999999999')).toEqual([]);
  expect(() => validarEventosMeta({}, phone)).toThrow();
  expect(() => validarEventosMeta(body({ messages: [{ id: 'wamid.x', from: 1 }] }), phone)).toThrow();
});
