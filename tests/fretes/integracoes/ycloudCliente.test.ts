import { afterEach, describe, expect, it, vi } from 'vitest';

// Cliente YCloud com `fetch` simulado — nenhuma chamada real à API.

const CHAVE = 'ycloud-api-key-de-teste-0123456789';

async function cliente(env: Record<string, string> = {}) {
  Object.assign(process.env, { YCLOUD_API_KEY: CHAVE, YCLOUD_WHATSAPP_FROM: '+5511900000000', YCLOUD_API_URL: 'https://api.ycloud.test/v2', ...env });
  vi.resetModules();
  return import('../../../src/fretes/integracoes/ycloudCliente.js');
}

function fetchFalso(status: number, corpo: unknown) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, chamadas };
}

afterEach(() => {
  for (const n of ['YCLOUD_API_KEY', 'YCLOUD_WHATSAPP_FROM', 'YCLOUD_API_URL']) delete process.env[n];
});

describe('telefoneE164 (só whatsapp_cotacao do cadastro)', () => {
  it('DDD + número vira +55; com 55 mantém; o resto é recusado (nunca adivinha)', async () => {
    const { telefoneE164 } = await cliente();
    expect(telefoneE164('11987654321')).toBe('+5511987654321');
    expect(telefoneE164('1133334444')).toBe('+551133334444');
    expect(telefoneE164('5511987654321')).toBe('+5511987654321');
    for (const v of [null, '', '987654321', '01187654321', '4411987654321', '119876543210000']) expect(telefoneE164(v)).toBeNull();
  });
});

describe('envio pela YCloud', () => {
  it.each(['WHATSAPP_TEMPLATE_UNAVAILABLE', 'BALANCE_INSUFFICIENT', 'ACCOUNT_LIMITED', 'WHATSAPP_PHONE_NUMBER_UNAVAILABLE'])('preserva motivo %s do erro 403 aninhado sem expor segredo', async (code) => {
    const { enviarWhatsappYCloud } = await cliente();
    const f = fetchFalso(403, { error: { code, message: `Motivo API key=${CHAVE}` } });
    const erro = await enviarWhatsappYCloud({ tipo: 'texto', para: '+5511987654321', texto: 'x' }, f.impl).catch((e: unknown) => e) as Error;
    expect(erro.message).toContain(code);
    expect(erro.message).toContain('HTTP 403');
    expect(erro.message).not.toContain('YCLOUD_AUTENTICACAO');
    expect(erro.message).not.toContain(CHAVE);
    expect(f.chamadas).toHaveLength(1);
  });
  it('403 sem JSON não acusa chave inválida', async () => {
    const { enviarWhatsappYCloud } = await cliente();
    const erro = await enviarWhatsappYCloud({ tipo: 'texto', para: '+5511987654321', texto: 'x' }, (async () => new Response('Forbidden', { status: 403 })) as typeof fetch).catch((e: unknown) => e) as Error;
    expect(erro.message).toBe('YCLOUD_RECUSADO: envio negado (HTTP 403).');
  });
  it('aceita: POST sendDirectly com X-API-Key, from/to e texto; devolve id, wamid e status', async () => {
    const { enviarWhatsappYCloud } = await cliente();
    const f = fetchFalso(200, { id: 'yc-1', wamid: 'wamid.ABC', status: 'sent' });
    const r = await enviarWhatsappYCloud({ tipo: 'texto', para: '+5511987654321', texto: 'Olá' }, f.impl);
    expect(r).toEqual({ ycloudMessageId: 'yc-1', wamid: 'wamid.ABC', status: 'sent' });
    expect(f.chamadas[0]?.url).toBe('https://api.ycloud.test/v2/whatsapp/messages/sendDirectly');
    expect((f.chamadas[0]?.init.headers as Record<string, string>)['X-API-Key']).toBe(CHAVE);
    expect(JSON.parse(String(f.chamadas[0]?.init.body))).toEqual({ from: '+5511900000000', to: '+5511987654321', type: 'text', text: { body: 'Olá', preview_url: false } });
  });

  it('template: nome, idioma e parâmetros no corpo', async () => {
    const { enviarWhatsappYCloud } = await cliente();
    const f = fetchFalso(200, { id: 'yc-2', status: 'accepted' });
    const r = await enviarWhatsappYCloud({ tipo: 'template', para: '+5511987654321', nome: 'cotacao_frete', idioma: 'pt_BR', parametros: ['FRE-1', 'SP'] }, f.impl);
    expect(r.wamid).toBeNull();
    expect(JSON.parse(String(f.chamadas[0]?.init.body)).template).toEqual({
      name: 'cotacao_frete',
      language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'FRE-1' }, { type: 'text', text: 'SP' }] }],
    });
  });

  it('rejeita número inválido (HTTP 400) → YCLOUD_DESTINO_INVALIDO; erro de API key → YCLOUD_AUTENTICACAO sem a chave', async () => {
    const { enviarWhatsappYCloud, ErroEnvioYCloudFalhou } = await cliente();
    const invalido = fetchFalso(400, { errorCode: 'INVALID_PARAMETER', errorMessage: 'to: not a valid WhatsApp phone number' });
    const e1 = (await enviarWhatsappYCloud({ tipo: 'texto', para: '+5511987654321', texto: 'x' }, invalido.impl).catch((e: unknown) => e)) as InstanceType<typeof ErroEnvioYCloudFalhou>;
    expect(e1.destinoInvalido).toBe(true);
    expect(e1.message).toMatch(/^YCLOUD_DESTINO_INVALIDO: /);
    const auth = fetchFalso(401, { errorMessage: `invalid api key ${CHAVE}` });
    const e2 = (await enviarWhatsappYCloud({ tipo: 'texto', para: '+5511987654321', texto: 'x' }, auth.impl).catch((e: unknown) => e)) as Error;
    expect(e2.message).toMatch(/^YCLOUD_AUTENTICACAO: /);
    expect(e2.message).not.toContain(CHAVE);
  });

  it('status "failed" no corpo também é falha; detalhe sanitizado', async () => {
    const { enviarWhatsappYCloud } = await cliente();
    const f = fetchFalso(200, { id: 'yc-3', status: 'failed', errorCode: '131047', errorMessage: `Re-engagement message apikey=${CHAVE}` });
    const e = (await enviarWhatsappYCloud({ tipo: 'texto', para: '+5511987654321', texto: 'x' }, f.impl).catch((x: unknown) => x)) as Error;
    expect(e.message).toMatch(/^YCLOUD_FALHOU: .*131047 Re-engagement message/);
    expect(e.message).not.toContain(CHAVE);
  });

  it('sem configuração ou destino fora do E.164 → nada é chamado', async () => {
    const semChave = await cliente({ YCLOUD_API_KEY: '' });
    const f = fetchFalso(200, {});
    await expect(semChave.enviarWhatsappYCloud({ tipo: 'texto', para: '+5511987654321', texto: 'x' }, f.impl)).rejects.toBeInstanceOf(semChave.ErroYCloudNaoConfigurada);
    const ok = await cliente();
    await expect(ok.enviarWhatsappYCloud({ tipo: 'texto', para: '11987654321', texto: 'x' }, f.impl)).rejects.toMatchObject({ destinoInvalido: true });
    expect(f.chamadas).toHaveLength(0);
  });
});
