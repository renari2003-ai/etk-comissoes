import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';

// Mesmo motivo de `tests/fretes/fretesServico.test.ts`: cria/derruba tabelas novas no
// Postgres real por teste.
vi.setConfig({ testTimeout: 20000 });

const SEGREDO_TESTE = 'segredo-de-teste-fase-4a1-nao-e-real';

let sufixo: string;

beforeEach(() => {
  sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
  await pool.query(`DROP TABLE IF EXISTS ${process.env.EXTRACOES_PROPOSTA_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.RESPOSTAS_COTACAO_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.SOLICITACOES_COTACAO_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.FECHAMENTOS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.PROPOSTAS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.COTACOES_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.TRANSPORTADORAS_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.VEICULOS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.AUDITORIA_FRETES_TABELA}`).catch(() => undefined);
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

/** `vi.resetModules()` é obrigatório aqui: `config.ts` lê `process.env.FRETES_WEBHOOK_SECRET` só na primeira importação (mesmo padrão de `garantirEsquemaFretes`). */
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

async function prepararSolicitacao(servico: typeof import('../../src/fretes/fretesServico.js')) {
  const { servicoSolicitarCotacoes } = await import('../../src/fretes/integracaoCotacoesServico.js');
  const transportadora = await servico.servicoCriarTransportadora(
    { nomeRazaoSocial: 'Transportes Webhook Teste', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
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
  // Fase 4A.4.1: `servicoSolicitarCotacoes` exige `ClienteOmie` + e-mail resolvido para canal
  // EMAIL — este arquivo testa o webhook inbound, não a resolução de e-mail, então usa um
  // e-mail manual fixo (a Omie nunca é consultada nestes testes).
  const clienteOmieFake = { consultarCliente: async () => null } as unknown as ClienteOmie;
  const [solicitacao] = await servicoSolicitarCotacoes(
    clienteOmieFake,
    cotacao.id,
    [{ transportadoraId: transportadora.id, emailManual: 'transportadora@teste.com' }],
    'EMAIL',
    USUARIO_TESTE,
  );
  if (solicitacao === undefined) throw new Error('Falha ao preparar solicitação de teste.');
  return { transportadora, cotacao, solicitacao };
}

function payloadWebhook(referencia: string, mensagemId: string, valorFrete: number | null = 1500) {
  return {
    versao: 1,
    referencia,
    canal: 'EMAIL',
    mensagemId,
    conteudoBruto: 'Segue nossa cotação: R$ 1.500,00, prazo 4 dias.',
    versaoExtrator: 'teste',
    extracao: {
      valorFrete,
      prazoDias: 4,
      validade: null,
      pedagio: null,
      gris: null,
      adValorem: null,
      taxas: null,
      observacoes: null,
      numeroProposta: null,
      confianca: 0.8,
    },
  };
}

describe('webhook de cotações (Fase 4A.1, seção 20/21/52) — autenticação máquina-a-máquina', () => {
  it('rejeita a chamada sem o header de segredo', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/cotacoes/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadWebhook('QUALQUER', 'msg-1')),
      });
      expect(resposta.status).toBe(403);
    } finally {
      fechar();
    }
  });

  it('rejeita a chamada com um segredo incorreto', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/cotacoes/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': 'valor-errado' },
        body: JSON.stringify(payloadWebhook('QUALQUER', 'msg-2')),
      });
      expect(resposta.status).toBe(403);
    } finally {
      fechar();
    }
  });

  it('nunca aceita quando o segredo não está configurado no servidor, mesmo enviando um header (fail closed)', async () => {
    delete process.env.FRETES_WEBHOOK_SECRET; // simula ambiente sem a variável configurada
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/cotacoes/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': '' },
        body: JSON.stringify(payloadWebhook('QUALQUER', 'msg-3')),
      });
      expect(resposta.status).toBe(403);
    } finally {
      fechar();
      process.env.FRETES_WEBHOOK_SECRET = SEGREDO_TESTE;
    }
  });

  it('aceita a chamada com o segredo correto e cria uma proposta PENDENTE_VALIDACAO (nunca aprovada automaticamente)', async () => {
    const { baseUrl, fechar, servico } = await subirServidorDeTeste();
    try {
      const { solicitacao } = await prepararSolicitacao(servico);
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/cotacoes/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payloadWebhook(solicitacao.codigoReferencia, 'msg-4')),
      });
      expect(resposta.status).toBe(200);
      const corpo = (await resposta.json()) as { propostaId: string | null; duplicado: boolean };
      expect(corpo.propostaId).not.toBeNull();
      expect(corpo.duplicado).toBe(false);

      const propostas = await servico.servicoListarPropostas(solicitacao.cotacaoFreteId);
      expect(propostas).toHaveLength(1);
      expect(propostas[0]?.status).toBe('PENDENTE_VALIDACAO');
    } finally {
      fechar();
    }
  });

  it('idempotência: a mesma mensagem (canal + mensagemId) enviada duas vezes nunca cria uma segunda proposta', async () => {
    const { baseUrl, fechar, servico } = await subirServidorDeTeste();
    try {
      const { solicitacao } = await prepararSolicitacao(servico);
      const chamar = () =>
        fetch(`${baseUrl}/api/fretes/integracoes/cotacoes/resposta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
          body: JSON.stringify(payloadWebhook(solicitacao.codigoReferencia, 'msg-repetida')),
        });

      const primeira = await chamar();
      const segunda = await chamar();
      expect(primeira.status).toBe(200);
      expect(segunda.status).toBe(200);
      const corpoSegunda = (await segunda.json()) as { duplicado: boolean };
      expect(corpoSegunda.duplicado).toBe(true);

      const propostas = await servico.servicoListarPropostas(solicitacao.cotacaoFreteId);
      expect(propostas).toHaveLength(1); // nunca duas
    } finally {
      fechar();
    }
  });

  it('rejeita payload inválido (400) mesmo com segredo correto — nunca confia no payload (seção 22)', async () => {
    const { baseUrl, fechar } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/cotacoes/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify({ versao: 1 }), // faltando praticamente tudo
      });
      expect(resposta.status).toBe(400);
    } finally {
      fechar();
    }
  });

  it('referência desconhecida é rejeitada sem criar nada (nunca associa por aproximação, seção 23)', async () => {
    const { baseUrl, fechar, servico } = await subirServidorDeTeste();
    try {
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/cotacoes/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payloadWebhook('REFERENCIA-QUE-NAO-EXISTE', 'msg-5')),
      });
      expect(resposta.status).toBe(400);
      void servico;
    } finally {
      fechar();
    }
  });

  it('extração sem valorFrete não cria proposta (nunca infere valor, seção 39/40) — fica só como resposta/extração para revisão manual', async () => {
    const { baseUrl, fechar, servico } = await subirServidorDeTeste();
    try {
      const { solicitacao } = await prepararSolicitacao(servico);
      const resposta = await fetch(`${baseUrl}/api/fretes/integracoes/cotacoes/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fretes-webhook-secret': SEGREDO_TESTE },
        body: JSON.stringify(payloadWebhook(solicitacao.codigoReferencia, 'msg-sem-valor', null)),
      });
      expect(resposta.status).toBe(200);
      const corpo = (await resposta.json()) as { propostaId: string | null; extracaoStatus: string };
      expect(corpo.propostaId).toBeNull();
      expect(corpo.extracaoStatus).toBe('REQUER_REVISAO');

      const propostas = await servico.servicoListarPropostas(solicitacao.cotacaoFreteId);
      expect(propostas).toHaveLength(0);
    } finally {
      fechar();
    }
  });
});
