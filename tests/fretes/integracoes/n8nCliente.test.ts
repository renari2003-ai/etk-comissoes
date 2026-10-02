import type { IncomingHttpHeaders } from 'node:http';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 15000 });

interface Chamada {
  body: string;
  headers: IncomingHttpHeaders;
}

interface MockN8n {
  url: string;
  chamadas: Chamada[];
  fechar: () => Promise<void>;
}

function iniciarMockN8n(
  responder: (chamada: Chamada) => { status: number; atrasoMs?: number; corpo?: string; contentType?: string },
): Promise<MockN8n> {
  const chamadas: Chamada[] = [];
  let servidor: Server;
  return new Promise((resolve) => {
    servidor = createServer((req, res) => {
      let dados = '';
      req.on('data', (pedaco) => (dados += pedaco));
      req.on('end', () => {
        const chamada: Chamada = { body: dados, headers: req.headers };
        chamadas.push(chamada);
        const resultado = responder(chamada);
        const enviar = () => {
          res.writeHead(resultado.status, { 'Content-Type': resultado.contentType ?? 'application/json' });
          res.end(resultado.corpo ?? '{}');
        };
        if (resultado.atrasoMs !== undefined) setTimeout(enviar, resultado.atrasoMs);
        else enviar();
      });
    });
    servidor.listen(0, () => {
      const endereco = servidor.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${endereco.port}/webhook`,
        chamadas,
        fechar: () => new Promise<void>((res) => servidor.close(() => res())),
      });
    });
  });
}

async function importarN8nCliente(): Promise<typeof import('../../../src/fretes/integracoes/n8nCliente.js')> {
  vi.resetModules();
  return import('../../../src/fretes/integracoes/n8nCliente.js');
}

const SECRET_TESTE = 'segredo-n8n-teste-fase-4a2';

function payloadDeTeste(): import('../../../src/fretes/integracoes/n8nCliente.js').PayloadSolicitacaoN8n {
  return {
    versao: 1,
    evento: 'SOLICITACAO_COTACAO',
    solicitacaoId: '11111111-1111-1111-1111-111111111111',
    referencia: 'FRE-2026-000001-abcd1234',
    cotacaoId: '22222222-2222-2222-2222-222222222222',
    transportadora: { id: '33333333-3333-3333-3333-333333333333' },
    canal: 'EMAIL',
    logistica: {
      origem: 'São Paulo',
      destino: 'Curitiba',
      cepOrigem: '01000-000',
      cepDestino: '80000-000',
      pesoBruto: 100,
      pesoLiquido: 95,
      peso: 100,
      volumes: 5,
      especie: 'Caixas',
      cnpjOrigem: '11222333000181',
      cnpjDestino: null,
      modalidade: 'CIF',
      observacoes: null,
      embalagens: [
        { altura: 0.27, largura: 0.36, comprimento: 0.77, quantidade: 6 },
        { altura: 1.2, largura: 0.8, comprimento: 1, quantidade: 2 },
      ],
    },
  };
}

describe('n8nCliente (Fase 4A.2, seção 9/10/12/13/31/36/37) — cliente outbound isolado', () => {
  let mock: MockN8n | null = null;

  beforeEach(() => {
    delete process.env.N8N_WEBHOOK_URL;
    delete process.env.N8N_WEBHOOK_SECRET;
    delete process.env.N8N_TIMEOUT_MS;
  });

  afterEach(async () => {
    if (mock !== null) await mock.fechar();
    mock = null;
    delete process.env.N8N_WEBHOOK_URL;
    delete process.env.N8N_WEBHOOK_SECRET;
    delete process.env.N8N_TIMEOUT_MS;
  });

  it('rejeita com erro controlado (fail closed) quando N8N_WEBHOOK_URL/SECRET não estão configurados', async () => {
    const { enviarSolicitacaoAoN8n, ErroIntegracaoN8nNaoConfigurada } = await importarN8nCliente();
    await expect(enviarSolicitacaoAoN8n(payloadDeTeste())).rejects.toBeInstanceOf(ErroIntegracaoN8nNaoConfigurada);
  });

  it('envia o segredo no header (nunca no corpo) e o payload correto, sem nenhum dado comercial interno', async () => {
    mock = await iniciarMockN8n(() => ({ status: 200 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = SECRET_TESTE;
    const { enviarSolicitacaoAoN8n } = await importarN8nCliente();

    await enviarSolicitacaoAoN8n(payloadDeTeste());

    expect(mock.chamadas).toHaveLength(1);
    const chamada = mock.chamadas[0];
    if (chamada === undefined) throw new Error('setup falhou');
    expect(chamada.headers['x-n8n-webhook-secret']).toBe(SECRET_TESTE);
    const corpo = JSON.parse(chamada.body) as Record<string, unknown>;
    expect(corpo.versao).toBe(1);
    expect(corpo.referencia).toBe('FRE-2026-000001-abcd1234');
    // Nunca deve existir nenhum campo comercial interno no payload (seção 13).
    const corpoTexto = chamada.body.toLowerCase();
    for (const proibido of ['margem', 'comissao', 'comissão', 'markup', 'custoproduto', 'valorvenda', 'senha', 'secret']) {
      expect(corpoTexto).not.toContain(proibido);
    }
  });

  it('trata HTTP 500 do n8n como falha controlada (ErroEnvioN8nFalhou), nunca lança um erro genérico', async () => {
    mock = await iniciarMockN8n(() => ({ status: 500 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = SECRET_TESTE;
    const { enviarSolicitacaoAoN8n, ErroEnvioN8nFalhou } = await importarN8nCliente();

    await expect(enviarSolicitacaoAoN8n(payloadDeTeste())).rejects.toBeInstanceOf(ErroEnvioN8nFalhou);
  });

  it('envia logistica.embalagens (uma linha por tipo, medidas como informadas) mantendo volumes/peso/espécie', async () => {
    mock = await iniciarMockN8n(() => ({ status: 200 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = SECRET_TESTE;
    const { enviarSolicitacaoAoN8n } = await importarN8nCliente();

    await enviarSolicitacaoAoN8n(payloadDeTeste());

    const corpo = JSON.parse(mock.chamadas[0]?.body ?? '{}') as { logistica: Record<string, unknown> };
    expect(corpo.logistica.embalagens).toEqual([
      { altura: 0.27, largura: 0.36, comprimento: 0.77, quantidade: 6 },
      { altura: 1.2, largura: 0.8, comprimento: 1, quantidade: 2 },
    ]);
    expect(corpo.logistica).toMatchObject({ volumes: 5, peso: 100, especie: 'Caixas' });
  });

  it('HTTP 500: guarda resumo da resposta (message/error/details) sem o segredo nem tokens', async () => {
    const corpoErro = JSON.stringify({
      code: 0,
      message: 'Error in workflow',
      details: `Node "Send Email" falhou: Authorization: Bearer abc.def.ghi password=hunter2 x-n8n-webhook-secret=${SECRET_TESTE} apiKey: chave-ficticia-de-teste-000`,
    });
    mock = await iniciarMockN8n(() => ({ status: 500, corpo: corpoErro }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = SECRET_TESTE;
    const { enviarSolicitacaoAoN8n } = await importarN8nCliente();

    const erro = await enviarSolicitacaoAoN8n(payloadDeTeste()).catch((e: unknown) => e as Error);
    expect(erro.message).toMatch(/^O webhook do n8n respondeu HTTP 500\. Resposta: Error in workflow \| Node "Send Email" falhou:/);
    for (const segredo of [SECRET_TESTE, 'hunter2', 'abc.def.ghi', 'chave-ficticia-de-teste-000']) {
      expect(erro.message).not.toContain(segredo);
    }
    expect(erro.message).toContain('[oculto]');
  });

  it('HTTP 500 com HTML enorme: só texto, sem tags, truncado; corpo vazio mantém só o status', async () => {
    const html = `<html><head><style>body{}</style><script>var t=1</script></head><body><h1>Internal Server Error</h1>${'<p>x</p>'.repeat(5000)}</body></html>`;
    mock = await iniciarMockN8n((c) => (c.body.includes('vazio') ? { status: 502, corpo: '' } : { status: 500, corpo: html, contentType: 'text/html' }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = SECRET_TESTE;
    const { enviarSolicitacaoAoN8n } = await importarN8nCliente();

    const erro = await enviarSolicitacaoAoN8n(payloadDeTeste()).catch((e: unknown) => e as Error);
    expect(erro.message).toContain('HTTP 500. Resposta: Internal Server Error');
    expect(erro.message).not.toMatch(/<|var t=1|body\{/);
    expect(erro.message.length).toBeLessThan(400);

    const vazio = { ...payloadDeTeste(), referencia: 'vazio' };
    const erroVazio = await enviarSolicitacaoAoN8n(vazio).catch((e: unknown) => e as Error);
    expect(erroVazio.message).toBe('O webhook do n8n respondeu HTTP 502.');
  });

  it('trata timeout como falha controlada (ErroEnvioN8nFalhou), nunca deixa a chamada pendurada', async () => {
    mock = await iniciarMockN8n(() => ({ status: 200, atrasoMs: 500 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = SECRET_TESTE;
    process.env.N8N_TIMEOUT_MS = '100'; // bem menor que o atraso do mock (500ms)
    const { enviarSolicitacaoAoN8n, ErroEnvioN8nFalhou } = await importarN8nCliente();

    await expect(enviarSolicitacaoAoN8n(payloadDeTeste())).rejects.toBeInstanceOf(ErroEnvioN8nFalhou);
  });

  it('sucesso (HTTP 2xx) resolve com o status HTTP recebido', async () => {
    mock = await iniciarMockN8n(() => ({ status: 201 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = SECRET_TESTE;
    const { enviarSolicitacaoAoN8n } = await importarN8nCliente();

    const resultado = await enviarSolicitacaoAoN8n(payloadDeTeste());
    expect(resultado.statusHttp).toBe(201);
  });
});
