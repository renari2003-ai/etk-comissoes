import { describe, expect, it, vi } from 'vitest';
import {
  cotarNaBraspress,
  ErroBraspressFalhou,
  ErroBraspressNaoConfigurada,
  ErroDadosBraspressIncompletos,
  type EntradaCotacaoBraspress,
} from '../../src/fretes/integracoes/braspressCliente.js';

// Fase Braspress 1 — cliente isolado; sem rede real (fetch injetado), sem banco.
const CNPJ_TESTE = '11222333000181';
const SENHA_TESTE = 'senha-de-teste-nao-e-real';

const entrada: EntradaCotacaoBraspress = {
  cnpjDestinatario: '44.555.666/0001-81',
  cepOrigem: '01000-000',
  cepDestino: '80000-000',
  valorMercadoria: 5000,
  peso: 100,
  volumes: 5,
  tipoFrete: 'CIF',
  cubagem: [{ altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 5 }],
};

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

const base = { cnpj: CNPJ_TESTE, senha: SENHA_TESTE, url: 'https://exemplo.invalido/cotar', timeoutMs: 200 };

describe('Fase Braspress 1 — cliente', () => {
  it('autentica com Basic (CNPJ:senha) e monta o request conforme a API oficial', async () => {
    const fetchImpl = vi.fn(async () => respostaJson({ id: 147670114, prazo: 5, totalFrete: 42.14 }));
    await cotarNaBraspress(entrada, { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(base.url);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${CNPJ_TESTE}:${SENHA_TESTE}`).toString('base64')}`);
    expect(JSON.parse(init.body as string)).toEqual({
      cnpjRemetente: Number(CNPJ_TESTE),
      cnpjDestinatario: 44555666000181,
      modal: 'R',
      tipoFrete: '1',
      cepOrigem: 1000000,
      cepDestino: 80000000,
      vlrMercadoria: 5000,
      peso: 100,
      volumes: 5,
      cubagem: [{ altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 5 }],
    });
  });

  it('normaliza a resposta com os nomes reais da API', async () => {
    const fetchImpl = async () => respostaJson({ id: 147670114, prazo: 5, totalFrete: 42.14, validade: '2022-08-29 23:59:59' });
    const r = await cotarNaBraspress(entrada, { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ transportadora: 'BRASPRESS', idCotacaoExterna: '147670114', valorFrete: 42.14, prazoDias: 5, validade: '2022-08-29' });
  });

  it('sem credenciais configuradas: recusa sem chamar a rede (fail closed)', async () => {
    const fetchImpl = vi.fn();
    await expect(cotarNaBraspress(entrada, { ...base, cnpj: '', fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toBeInstanceOf(
      ErroBraspressNaoConfigurada,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('dados incompletos: lista exatamente o que falta e não chama a rede', async () => {
    const fetchImpl = vi.fn();
    const erro = await cotarNaBraspress(
      { ...entrada, cnpjDestinatario: null, cubagem: null, peso: null },
      { ...base, fetchImpl: fetchImpl as unknown as typeof fetch },
    ).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDadosBraspressIncompletos);
    expect((erro as ErroDadosBraspressIncompletos).faltando).toEqual(['CNPJ do destinatário', 'peso', 'cubagem (altura, largura e comprimento em metros)']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('timeout: aborta e devolve erro sanitizado', async () => {
    const fetchImpl = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('abortado'), { name: 'AbortError' })));
      });
    await expect(cotarNaBraspress(entrada, { ...base, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/Tempo limite/);
  });

  it('erro da API: HTTP 500, 401 e resposta inválida viram ErroBraspressFalhou sem vazar credenciais', async () => {
    for (const resposta of [respostaJson({}, 500), respostaJson({}, 401), respostaJson({ semId: true })]) {
      const erro = await cotarNaBraspress(entrada, { ...base, fetchImpl: (async () => resposta) as unknown as typeof fetch }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroBraspressFalhou);
      const msg = (erro as Error).message;
      expect(msg).not.toContain(SENHA_TESTE);
      expect(msg).not.toContain('Basic');
    }
  });
});
