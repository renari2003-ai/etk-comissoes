import type { IncomingHttpHeaders } from 'node:http';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente, ClienteOmie } from '../../src/omie/cliente.js';
import { droparTabelasRemanescentes, isolarTabelasComerciais, limparTabelasComerciais } from './isolamentoTabelasComerciais.js';

// Homologação Fase 4A.4.1 — resolução do destinatário de e-mail (MANUAL > OMIE > BLOQUEIO).
vi.setConfig({ testTimeout: 20000 });

let sufixo: string;

beforeEach(() => {
  sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  isolarTabelasComerciais(sufixo);
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

async function importarModulos() {
  vi.resetModules();
  const servico = await import('../../src/fretes/fretesServico.js');
  const integracao = await import('../../src/fretes/integracaoCotacoesServico.js');
  return { servico, integracao };
}

function clienteOmieComEmail(email: string | null, consultarCliente = vi.fn()): ClienteOmie {
  const cliente: Cliente | null =
    email === null
      ? null
      : {
          codigo: 999,
          razaoSocial: 'Fornecedor Omie Teste',
          nomeFantasia: 'Fornecedor Teste',
          enderecoCadastral: { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, codigoMunicipio: null },
          enderecoEntrega: null,
          email,
        };
  consultarCliente.mockImplementation(async () => cliente);
  return { consultarCliente } as unknown as ClienteOmie;
}

async function prepararCotacaoETransportadora(
  servico: Awaited<ReturnType<typeof importarModulos>>['servico'],
  codigoClienteOmie: number | null = null,
) {
  const transportadora = await servico.servicoCriarTransportadora(
    { nomeRazaoSocial: 'Transportes E-mail Teste', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null, codigoClienteOmie },
    USUARIO_TESTE,
  );
  const cotacao = await servico.servicoCriarCotacao(
    {
      clienteOmieId: null, pedidoOmieId: null, vendedorOmieId: null, origem: 'SP', cepOrigem: null, destino: 'RJ', cepDestino: null,
      peso: 10, volumes: 1, valorMercadoria: 100, modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA',
      veiculoId: null, motoristaNome: null, custoManual: null, observacoes: null,
    },
    USUARIO_TESTE,
  );
  return { transportadora, cotacao };
}

describe('resolução do e-mail de destino (Fase 4A.4.1) — MANUAL > OMIE > BLOQUEIO', () => {
  it('1) manual válido + Omie válido → MANUAL vence', async () => {
    const { servico, integracao } = await importarModulos();
    const clienteOmie = clienteOmieComEmail('omie@fornecedor.com.br');
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, 999);

    const [solicitacao] = await integracao.servicoSolicitarCotacoes(
      clienteOmie,
      cotacao.id,
      [{ transportadoraId: transportadora.id, emailManual: 'manual@etk.ind.br' }],
      'EMAIL',
      USUARIO_TESTE,
    );
    expect(solicitacao?.emailDestino).toBe('manual@etk.ind.br');
    expect(solicitacao?.emailOrigem).toBe('MANUAL');
  });

  it('2) sem manual + Omie válido → usa OMIE', async () => {
    const { servico, integracao } = await importarModulos();
    const clienteOmie = clienteOmieComEmail('omie@fornecedor.com.br');
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, 999);

    const [solicitacao] = await integracao.servicoSolicitarCotacoes(
      clienteOmie,
      cotacao.id,
      [{ transportadoraId: transportadora.id }],
      'EMAIL',
      USUARIO_TESTE,
    );
    expect(solicitacao?.emailDestino).toBe('omie@fornecedor.com.br');
    expect(solicitacao?.emailOrigem).toBe('OMIE');
  });

  it('3) manual inválido → rejeita (nunca cai silenciosamente para Omie)', async () => {
    const { servico, integracao } = await importarModulos();
    const clienteOmie = clienteOmieComEmail('omie@fornecedor.com.br');
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, 999);

    await expect(
      integracao.servicoSolicitarCotacoes(
        clienteOmie,
        cotacao.id,
        [{ transportadoraId: transportadora.id, emailManual: 'nao-e-um-email' }],
        'EMAIL',
        USUARIO_TESTE,
      ),
    ).rejects.toThrow(/e-mail manual/i);
  });

  it('4) sem manual + sem codigo_cliente_omie → rejeita (BLOQUEIO)', async () => {
    const { servico, integracao } = await importarModulos();
    const clienteOmie = clienteOmieComEmail(null);
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, null);

    await expect(
      integracao.servicoSolicitarCotacoes(clienteOmie, cotacao.id, [{ transportadoraId: transportadora.id }], 'EMAIL', USUARIO_TESTE),
    ).rejects.toThrow(/EMAIL_TRANSPORTADORA_NAO_CADASTRADO/);
  });

  it('5) codigo_cliente_omie existe mas Omie não possui e-mail → rejeita', async () => {
    const { servico, integracao } = await importarModulos();
    const clienteOmie = clienteOmieComEmail(null); // registro existe, mas sem e-mail
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, 999);

    await expect(
      integracao.servicoSolicitarCotacoes(clienteOmie, cotacao.id, [{ transportadoraId: transportadora.id }], 'EMAIL', USUARIO_TESTE),
    ).rejects.toThrow(/EMAIL_TRANSPORTADORA_NAO_CADASTRADO/);
  });

  it('6) canal diferente de EMAIL → e-mail não é obrigatório (sem manual, sem Omie, sem bloqueio)', async () => {
    const { servico, integracao } = await importarModulos();
    const consultarCliente = vi.fn();
    const clienteOmie = clienteOmieComEmail(null, consultarCliente);
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, null);

    const [solicitacao] = await integracao.servicoSolicitarCotacoes(
      clienteOmie,
      cotacao.id,
      [{ transportadoraId: transportadora.id }],
      'API',
      USUARIO_TESTE,
    );
    expect(solicitacao?.emailDestino).toBeNull();
    expect(solicitacao?.emailOrigem).toBeNull();
    expect(consultarCliente).not.toHaveBeenCalled(); // canal API nunca consulta a Omie
  });

  it('7) snapshot permanece estável — mudar o e-mail da Omie depois não altera a solicitação já criada', async () => {
    const { servico, integracao } = await importarModulos();
    const consultarCliente = vi.fn();
    const clienteOmie = clienteOmieComEmail('primeiro@fornecedor.com.br', consultarCliente);
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, 999);

    const [solicitacao] = await integracao.servicoSolicitarCotacoes(
      clienteOmie,
      cotacao.id,
      [{ transportadoraId: transportadora.id }],
      'EMAIL',
      USUARIO_TESTE,
    );
    expect(solicitacao?.emailDestino).toBe('primeiro@fornecedor.com.br');

    // "Muda" o cadastro na Omie (novo e-mail) — a solicitação já criada não deve mudar.
    consultarCliente.mockResolvedValue({
      codigo: 999,
      razaoSocial: 'Fornecedor Omie Teste',
      nomeFantasia: null,
      enderecoCadastral: { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, codigoMunicipio: null },
      enderecoEntrega: null,
      email: 'segundo@fornecedor.com.br',
    } satisfies Cliente);

    const releitura = await integracao.servicoListarSolicitacoes(cotacao.id);
    expect(releitura[0]?.emailDestino).toBe('primeiro@fornecedor.com.br');
  });

  it('8) payload enviado ao n8n contém transportadora.email e transportadora.fonteEmail (snapshot já resolvido)', async () => {
    const chamadas: { body: string; headers: IncomingHttpHeaders }[] = [];
    let servidor: Server;
    const mock = await new Promise<{ url: string; fechar: () => Promise<void> }>((resolve) => {
      servidor = createServer((req, res) => {
        let dados = '';
        req.on('data', (p) => (dados += p));
        req.on('end', () => {
          chamadas.push({ body: dados, headers: req.headers });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
        });
      });
      servidor.listen(0, () => {
        const endereco = servidor.address() as AddressInfo;
        resolve({ url: `http://127.0.0.1:${endereco.port}/webhook`, fechar: () => new Promise((r) => servidor.close(() => r())) });
      });
    });
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = 'segredo-teste-4a4-1';
    try {
      const { servico, integracao } = await importarModulos();
      const clienteOmie = clienteOmieComEmail('omie@fornecedor.com.br');
      const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, 999);

      await integracao.servicoSolicitarCotacoes(clienteOmie, cotacao.id, [{ transportadoraId: transportadora.id }], 'EMAIL', USUARIO_TESTE);

      expect(chamadas).toHaveLength(1);
      const corpo = JSON.parse(chamadas[0]?.body ?? '{}') as { transportadora: { email: string; fonteEmail: string } };
      expect(corpo.transportadora.email).toBe('omie@fornecedor.com.br');
      expect(corpo.transportadora.fonteEmail).toBe('OMIE');
    } finally {
      await mock.fechar();
      delete process.env.N8N_WEBHOOK_URL;
      delete process.env.N8N_WEBHOOK_SECRET;
    }
  });

  it('9) transportadora antiga sem codigo_cliente_omie continua funcionando para canal API/MANUAL (compatibilidade)', async () => {
    const { servico, integracao } = await importarModulos();
    const clienteOmie = clienteOmieComEmail(null);
    // Transportadora "legada" — nunca teve codigoClienteOmie, igual a qualquer cadastro da Fase 1.
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, null);
    expect(transportadora.codigoClienteOmie).toBeNull();

    // A solicitação é criada com sucesso (nenhum bloqueio de e-mail) — o envio outbound ao
    // n8n em si fica com status ERRO neste teste só porque N8N_WEBHOOK_URL/SECRET não estão
    // configurados no ambiente de teste (mesmo comportamento de todo o resto da suíte,
    // nada a ver com e-mail); por isso a prova aqui é sobre `emailDestino`/`emailOrigem`
    // (null = nunca tentou resolver e-mail para canal não-EMAIL) e `erroUltimaTentativa`
    // (não deve mencionar e-mail).
    const [solicitacao] = await integracao.servicoSolicitarCotacoes(
      clienteOmie,
      cotacao.id,
      [{ transportadoraId: transportadora.id }],
      'MANUAL',
      USUARIO_TESTE,
    );
    expect(solicitacao?.emailDestino).toBeNull();
    expect(solicitacao?.emailOrigem).toBeNull();
    expect(solicitacao?.erroUltimaTentativa ?? '').not.toMatch(/e-mail|email/i);
  });

  it('10) nenhuma escrita é feita na Omie — o fake só expõe consultarCliente, nunca é chamado com outro método', async () => {
    const { servico, integracao } = await importarModulos();
    const consultarCliente = vi.fn();
    const clienteOmie = clienteOmieComEmail('omie@fornecedor.com.br', consultarCliente);
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico, 999);

    await integracao.servicoSolicitarCotacoes(clienteOmie, cotacao.id, [{ transportadoraId: transportadora.id }], 'EMAIL', USUARIO_TESTE);

    expect(consultarCliente).toHaveBeenCalledTimes(1);
    expect(consultarCliente).toHaveBeenCalledWith(999);
    // O objeto fake não tem NENHUM método de escrita (IncluirCliente/AlterarCliente/etc.) —
    // se o serviço tentasse chamar um, o TypeScript já teria barrado a chamada em tempo de build.
  });
});
