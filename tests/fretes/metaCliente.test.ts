import { expect, it, vi } from 'vitest';
import { enviarTemplateMeta } from '../../src/fretes/integracoes/metaCliente.js';
const token = 'credencial-ficticia-meta';
const mensagem = { para: '+5511987654321', nome: 'cotacao_frete_etk', idioma: 'pt_BR', parametros: ['ref', 'origem', 'destino', 'peso volume nota', 'embalagens', 'obs'] };
const base = { token, phoneNumberId: '1433778859808018', versao: 'v26.0', timeoutMs: 20 };
it('preserva código específico da Meta sem expor token', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 131042, message: `Pagamento pendente ${token}` } }), { status: 400 }));
  const erro = await enviarTemplateMeta(mensagem, { ...base, fetchImpl }).catch((e: Error) => e);
  expect((erro as Error).message).toContain('131042');
  expect((erro as Error).message).not.toContain(token);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('não chama a rede sem configuração ou template válido', async () => {
  const fetchImpl = vi.fn();
  await expect(enviarTemplateMeta(mensagem, { ...base, token: '', fetchImpl })).rejects.toThrow('META_NAO_CONFIGURADA');
  await expect(enviarTemplateMeta({ ...mensagem, parametros: ['incompleto'] }, { ...base, fetchImpl })).rejects.toThrow('META_TEMPLATE_INVALIDO');
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('timeout não repete automaticamente a chamada', async () => {
  const fetchImpl = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
  })) as unknown as typeof fetch;
  await expect(enviarTemplateMeta(mensagem, { ...base, fetchImpl })).rejects.toThrow('META_TIMEOUT');
});
