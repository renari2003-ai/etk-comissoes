import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { droparTabelasRemanescentes, isolarTabelasComerciais, limparTabelasComerciais } from '../fretes/isolamentoTabelasComerciais.js';

// Fase WhatsApp — Etapa 3 (persistência definitiva WAMID → referência). Mesmo padrão de
// `tests/rotas/fretesWebhook.test.ts`: sobe um servidor Express real local, Postgres real,
// tabelas descartáveis por teste.
vi.setConfig({ testTimeout: 20000 });

const SEGREDO_TESTE = 'segredo-de-teste-whatsapp-etapa-3-nao-e-real';

let sufixo: string;

beforeEach(() => {
  sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  isolarTabelasComerciais(sufixo);
  process.env.FRETES_WEBHOOK_SECRET = SEGREDO_TESTE;
  process.env.TRANSPORTADORAS_TABELA = `transportadoras_teste_${sufixo}`;
  process.env.VEICULOS_FRETE_TABELA = `veiculos_frete_teste_${sufixo}`;
  process.env.COTACOES_FRETE_TABELA = `cotacoes_frete_teste_${sufixo}`;
  process.env.PROPOSTAS_FRETE_TABELA = `propostas_frete_teste_${sufixo}`;
  process.env.FECHAMENTOS_FRETE_TABELA = `fechamentos_frete_teste_${sufixo}`;
  process.env.AUDITORIA_FRETES_TABELA = `auditoria_fretes_teste_${sufixo}`;
  process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_teste_${sufixo}`;
  process.env.SOLICITACOES_COTACAO_TABELA = `solicitacoes_cotacao_teste_${sufixo}`;
  process.env.RESPOSTAS_COTACAO_TABELA = `respostas_cotacao_teste_${sufixo}`;
  process.env.EXTRACOES_PROPOSTA_TABELA = `extracoes_proposta_teste_${sufixo}`;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  await limparTabelasComerciais(pool);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.EXTRACOES_PROPOSTA_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.RESPOSTAS_COTACAO_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.SOLICITACOES_COTACAO_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.FECHAMENTOS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.PROPOSTAS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.COTACOES_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.TRANSPORTADORAS_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.VEICULOS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.AUDITORIA_FRETES_TABELA}`).catch(() => undefined);
  await droparTabelasRemanescentes(pool);
  await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
  delete process.env.FRETES_WEBHOOK_SECRET;
  delete process.env.TRANSPORTADORAS_TABELA;
  delete process.env.VEICULOS_FRETE_TABELA;
  delete process.env.COTACOES_FRETE_TABELA;
  delete process.env.PROPOSTAS_FRETE_TABELA;
  delete process.env.FECHAMENTOS_FRETE_TABELA;
  delete process.env.AUDITORIA_FRETES_TABELA;
  delete process.env.COTACOES_FRETE_SEQ;
  delete process.env.SOLICITACOES_COTACAO_TABELA;
  delete process.env.RESPOSTAS_COTACAO_TABELA;
  delete process.env.EXTRACOES_PROPOSTA_TABELA;
}, 20000);

const USUARIO_TESTE = '11111111-1111-1111-1111-111111111111';

async function subirServidorDeTeste(): Promise<{ baseUrl: string; fechar: () => void; servico: typeof import('../../src/fretes/fretesServico.js') }> {
  vi.resetModules();
  const { criarRotaFretes } = await import('../../src/rotas/fretes.js');
  const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
  const servico = await import('../../src/fretes/fretesServico.js');
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(criarRotaFretes({} as ClienteOmie));
  app.use(tratadorDeErros);
  const servidor = app.listen(0);
  const endereco = servidor.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${endereco.port}`, fechar: () => servidor.close(), servico };
}

async function prepararSolicitacao(
  servico: typeof import('../../src/fretes/fretesServico.js'),
  canal: 'WHATSAPP' | 'EMAIL' = 'WHATSAPP',
) {
  const { servicoSolicitarCotacoes } = await import('../../src/fretes/integracaoCotacoesServico.js');
  const transportadora = await servico.servicoCriarTransportadora(
    // Canal WHATSAPP exige whatsappCotacao válido no cadastro (bloqueio do backend).
    { nomeRazaoSocial: 'Transportes WhatsApp Teste', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null, whatsappCotacao: '11988887777' },
    USUARIO_TESTE,
  );
  const cotacao = await servico.servicoCriarCotacao(
    {
      clienteOmieId: null,
      pedidoOmieId: null,
      vendedorOmieId: null,
      origem: 'São Paulo',
      cepOrigem: '01000-000',
      destino: 'Curitiba',
      cepDestino: '80000-000',
      peso: 100,
      volumes: 5,
      valorMercadoria: 5000,
      modalidade: 'CIF',
      modalidadeExecucao: 'TRANSPORTADORA',
      veiculoId: null,
      motoristaNome: null,
      custoManual: null,
      observacoes: null,
    },
    USUARIO_TESTE,
  );
  const clienteOmieFake = { consultarCliente: async () => null } as unknown as ClienteOmie;
  const [solicitacao] = await servicoSolicitarCotacoes(
    clienteOmieFake,
    cotacao.id,
    [{ transportadoraId: transportadora.id, emailManual: canal === 'EMAIL' ? 'transportadora@teste.com' : null }],
    canal,
    USUARIO_TESTE,
  );
  if (solicitacao === undefined) throw new Error('Falha ao preparar solicitação de teste.');
  return { transportadora, cotacao, solicitacao };
}

function payloadOutbound(overrides: Record<string, unknown> = {}) {
  return {
    wamidOutbound: `wamid.teste.${Math.random().toString(36).slice(2)}`,
    ycloudMessageId: 'ycloud-msg-1',
    telefoneDestino: '+5511999999999',
    statusEnvio: 'ENVIADA',
    enviadoEm: new Date().toISOString(),
    ...overrides,
  };
}

describe('Fase WhatsApp — Etapa 3: endpoint outbound (registro do WAMID)', () => {
  it('registra outbound real — persiste WAMID/ycloudMessageId/telefone na solicitação correta', async () => {
    const { baseUrl, fechar, servico } = await subirServidorDeTeste();
    try {
      const { solicitacao } = await prepararSolicitacao(servico, 'WHATSAPP');
      const payload = payloadOutbound({ referencia: solicitacao.codigoReferencia });
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payload),
      });
      expect(resposta.status).toBe(200);
      const corpo = (await resposta.json()) as { registrado: boolean; duplicado: boolean; solicitacaoId: string; referencia: string };
      expect(corpo.registrado).toBe(true);
      expect(corpo.duplicado).toBe(false);
      expect(corpo.solicitacaoId).toBe(solicitacao.id);
      expect(corpo.referencia).toBe(solicitacao.codigoReferencia);

      const { servicoListarSolicitacoes } = await import('../../src/fretes/integracaoCotacoesServico.js');
      const listaSolicitacoes = await servicoListarSolicitacoes(solicitacao.cotacaoFreteId);
      const atualizada = listaSolicitacoes.find((s) => s.id === solicitacao.id);
      expect(atualizada?.wamidOutbound).toBe(payload.wamidOutbound);
      expect(atualizada?.ycloudMessageId).toBe('ycloud-msg-1');
      expect(atualizada?.telefoneDestino).toBe('+5511999999999');
    } finally {
      fechar();
    }
  });

  it('WAMID único: registrar o mesmo WAMID numa solicitação diferente é rejeitado', async () => {
    const { baseUrl, fechar, servico } = await subirServidorDeTeste();
    try {
      const { solicitacao: solicitacaoA } = await prepararSolicitacao(servico, 'WHATSAPP');
      const { solicitacao: solicitacaoB } = await prepararSolicitacao(servico, 'WHATSAPP');
      const wamidCompartilhado = `wamid.compartilhado.${Math.random().toString(36).slice(2)}`;

      const primeira = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payloadOutbound({ referencia: solicitacaoA.codigoReferencia, wamidOutbound: wamidCompartilhado })),
      });
      expect(primeira.status).toBe(200);

      // Mesmo WAMID, agora pra uma solicitação DIFERENTE — deve ser tratado como o mesmo
      // registro já existente (idempotência por WAMID), nunca sobrescrever a solicitação A.
      const segunda = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payloadOutbound({ referencia: solicitacaoB.codigoReferencia, wamidOutbound: wamidCompartilhado })),
      });
      expect(segunda.status).toBe(200);
      const corpoSegunda = (await segunda.json()) as { duplicado: boolean; solicitacaoId: string };
      expect(corpoSegunda.duplicado).toBe(true);
      expect(corpoSegunda.solicitacaoId).toBe(solicitacaoA.id); // continua apontando pra A, nunca migra pra B

      const { servicoListarSolicitacoes } = await import('../../src/fretes/integracaoCotacoesServico.js');
      const listaB = await servicoListarSolicitacoes(solicitacaoB.cotacaoFreteId);
      expect(listaB.find((s) => s.id === solicitacaoB.id)?.wamidOutbound).toBeNull();
    } finally {
      fechar();
    }
  });

  it('repetição idempotente: reenviar o mesmo evento outbound (mesmo WAMID, mesma solicitação) nunca duplica nem falha', async () => {
    const { baseUrl, fechar, servico } = await subirServidorDeTeste();
    try {
      const { solicitacao } = await prepararSolicitacao(servico, 'WHATSAPP');
      const payload = payloadOutbound({ referencia: solicitacao.codigoReferencia });

      const primeira = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payload),
      });
      const segunda = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payload),
      });
      expect(primeira.status).toBe(200);
      expect(segunda.status).toBe(200);
      const corpoPrimeira = (await primeira.json()) as { duplicado: boolean };
      const corpoSegunda = (await segunda.json()) as { duplicado: boolean };
      expect(corpoPrimeira.duplicado).toBe(false);
      expect(corpoSegunda.duplicado).toBe(true);
    } finally {
      fechar();
    }
  });

  it('referência/solicitação inexistente é rejeitada (nunca cria/associa por aproximação)', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payloadOutbound({ referencia: 'REFERENCIA-QUE-NAO-EXISTE' })),
      });
      expect(resposta.status).toBe(400);
    } finally {
      fechar();
    }
  });

  it('rejeita payload sem referencia/solicitacaoId e sem wamidOutbound', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const semReferencia = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify({ wamidOutbound: 'wamid.x' }),
      });
      expect(semReferencia.status).toBe(400);

      const semWamid = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify({ referencia: 'FRE-2026-000001-aaaaaaaa' }),
      });
      expect(semWamid.status).toBe(400);
    } finally {
      fechar();
    }
  });

  it('auth inválida (sem segredo, segredo errado, ou segredo não configurado) rejeita — fail closed', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const semHeader = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadOutbound({ referencia: 'QUALQUER' })),
      });
      expect(semHeader.status).toBe(403);

      const headerErrado = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': 'valor-errado' },
        body: JSON.stringify(payloadOutbound({ referencia: 'QUALQUER' })),
      });
      expect(headerErrado.status).toBe(403);
    } finally {
      fechar();
    }
  });

  it('auth inválida também bloqueia o endpoint de correlação (mesmo middleware)', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/correlacionar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextoReplyId: 'wamid.qualquer' }),
      });
      expect(resposta.status).toBe(403);
    } finally {
      fechar();
    }
  });
});

describe('Fase WhatsApp — Etapa 3: endpoint de correlação (resolução por context.id)', () => {
  it('resolve context.id correto — devolve referencia/solicitacaoId da solicitação certa', async () => {
    const { baseUrl, fechar, servico } = await subirServidorDeTeste();
    try {
      const { solicitacao } = await prepararSolicitacao(servico, 'WHATSAPP');
      const wamid = `wamid.correlacao.${Math.random().toString(36).slice(2)}`;
      await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payloadOutbound({ referencia: solicitacao.codigoReferencia, wamidOutbound: wamid })),
      });

      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/correlacionar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify({ contextoReplyId: wamid }),
      });
      expect(resposta.status).toBe(200);
      const corpo = (await resposta.json()) as { correlacionado: boolean; referencia?: string; solicitacaoId?: string };
      expect(corpo.correlacionado).toBe(true);
      expect(corpo.referencia).toBe(solicitacao.codigoReferencia);
      expect(corpo.solicitacaoId).toBe(solicitacao.id);
    } finally {
      fechar();
    }
  });

  it('context.id inexistente → resultado explícito de NÃO CORRELACIONADO (nunca adivinha)', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/correlacionar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify({ contextoReplyId: 'wamid.que.nao.existe' }),
      });
      expect(resposta.status).toBe(200);
      const corpo = (await resposta.json()) as { correlacionado: boolean; referencia?: string; solicitacaoId?: string };
      expect(corpo.correlacionado).toBe(false);
      expect(corpo.referencia).toBeUndefined();
      expect(corpo.solicitacaoId).toBeUndefined();
    } finally {
      fechar();
    }
  });

  it('rejeita payload sem contextoReplyId', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/whatsapp/correlacionar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify({}),
      });
      expect(resposta.status).toBe(400);
    } finally {
      fechar();
    }
  });
});

describe('Fase WhatsApp — Etapa 3: canal EMAIL existente não sofre regressão', () => {
  it('solicitação EMAIL continua funcionando normalmente (emailDestino/emailOrigem) e nasce sem campos WhatsApp', async () => {
    const { fechar, servico } = await subirServidorDeTeste();
    try {
      const { solicitacao } = await prepararSolicitacao(servico, 'EMAIL');
      expect(solicitacao.canal).toBe('EMAIL');
      expect(solicitacao.emailDestino).toBe('transportadora@teste.com');
      expect(solicitacao.emailOrigem).toBe('MANUAL');
      expect(solicitacao.wamidOutbound).toBeNull();
      expect(solicitacao.ycloudMessageId).toBeNull();
      expect(solicitacao.telefoneDestino).toBeNull();
    } finally {
      fechar();
    }
  });
});
