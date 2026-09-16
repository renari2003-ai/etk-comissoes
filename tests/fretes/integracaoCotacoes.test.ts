import type { IncomingHttpHeaders } from 'node:http';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20000 });

let sufixo: string;

beforeEach(() => {
  sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

async function importarServico(): Promise<typeof import('../../src/fretes/fretesServico.js')> {
  vi.resetModules();
  return import('../../src/fretes/fretesServico.js');
}

async function importarIntegracao(): Promise<typeof import('../../src/fretes/integracaoCotacoesServico.js')> {
  return import('../../src/fretes/integracaoCotacoesServico.js');
}

async function prepararCotacaoETransportadora(servico: Awaited<ReturnType<typeof importarServico>>) {
  const transportadora = await servico.servicoCriarTransportadora(
    { nomeRazaoSocial: 'ABC Transportes', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
    USUARIO_TESTE,
  );
  const outraTransportadora = await servico.servicoCriarTransportadora(
    { nomeRazaoSocial: 'XYZ Cargas', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
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
  return { transportadora, outraTransportadora, cotacao };
}

function extracaoBase(valorFrete: number | null, confianca: number | null) {
  return {
    valorFrete,
    prazoDias: 3,
    validade: null,
    pedagio: null,
    gris: null,
    adValorem: null,
    taxas: null,
    observacoes: null,
    numeroProposta: null,
    confianca,
  };
}

describe('solicitações de cotação (Fase 4A.1/4A.2, seção 12)', () => {
  it('cria uma solicitação por transportadora selecionada, com referência única — sem N8N_WEBHOOK_URL configurado, o envio falha de forma controlada (status ERRO, nunca perde a solicitação)', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora, outraTransportadora, cotacao } = await prepararCotacaoETransportadora(servico);

    const solicitacoes = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id, outraTransportadora.id], 'EMAIL', USUARIO_TESTE);
    expect(solicitacoes).toHaveLength(2);
    // Fase 4A.2: sem N8N_WEBHOOK_URL/SECRET no ambiente de teste, o envio é recusado de forma
    // controlada (fail closed, seção 8) — a solicitação fica registrada com status ERRO, nunca
    // some nem fica presa num estado ambíguo.
    expect(solicitacoes.every((s) => s.status === 'ERRO')).toBe(true);
    expect(solicitacoes.every((s) => s.erroUltimaTentativa?.includes('INTEGRACAO_N8N_NAO_CONFIGURADA') ?? false)).toBe(true);
    expect(solicitacoes[0]?.codigoReferencia).not.toBe(solicitacoes[1]?.codigoReferencia);

    const listadas = await integracao.servicoListarSolicitacoes(cotacao.id);
    expect(listadas).toHaveLength(2);
  });

  it('rejeita solicitar cotação sem nenhuma transportadora selecionada', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { cotacao } = await prepararCotacaoETransportadora(servico);
    await expect(integracao.servicoSolicitarCotacoes(cotacao.id, [], 'EMAIL', USUARIO_TESTE)).rejects.toThrow();
  });

  it('rejeita solicitar cotação numa cotação de modalidade VEICULO_PROPRIO (só se aplica a TRANSPORTADORA)', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora } = await prepararCotacaoETransportadora(servico);
    const veiculo = await servico.servicoCriarVeiculo({ descricao: 'Van', placa: null, tipo: null, marca: null, modelo: null, ano: null, capacidadeKg: null, capacidadeM3: null, observacoes: null }, USUARIO_TESTE);
    const cotacaoVeiculo = await servico.servicoCriarCotacao(
      {
        clienteOmieId: null, pedidoOmieId: null, vendedorOmieId: null, origem: 'SP', cepOrigem: null, destino: 'RJ', cepDestino: null,
        peso: 10, volumes: 1, valorMercadoria: 100, modalidade: 'CIF', modalidadeExecucao: 'VEICULO_PROPRIO',
        veiculoId: veiculo.id, motoristaNome: 'João', custoManual: 50, observacoes: null,
      },
      USUARIO_TESTE,
    );
    await expect(integracao.servicoSolicitarCotacoes(cotacaoVeiculo.id, [transportadora.id], 'EMAIL', USUARIO_TESTE)).rejects.toThrow();
  });
});

describe('proposta pendente de validação (Fase 4A.1, seção 7/38/39/40)', () => {
  async function receberResposta(
    servico: Awaited<ReturnType<typeof importarServico>>,
    integracao: Awaited<ReturnType<typeof importarIntegracao>>,
    valorFrete: number | null,
    confianca: number | null,
    mensagemId = `msg-${Math.random()}`,
  ) {
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico);
    const [solicitacao] = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id], 'EMAIL', USUARIO_TESTE);
    if (solicitacao === undefined) throw new Error('setup falhou');
    const payload = {
      referencia: solicitacao.codigoReferencia,
      canal: 'EMAIL' as const,
      mensagemId,
      conteudoBruto: 'mensagem de teste',
      versaoExtrator: 'teste',
      extracao: extracaoBase(valorFrete, confianca),
    };
    const resultado = await integracao.servicoProcessarRespostaWebhook(payload);
    return { resultado, cotacao, transportadora, solicitacao };
  }

  it('extração com valorFrete cria proposta com status PENDENTE_VALIDACAO — NUNCA RECEBIDA direto, mesmo com confiança 0.99', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado } = await receberResposta(servico, integracao, 1000, 0.99);
    expect(resultado.proposta).not.toBeNull();
    expect(resultado.proposta?.status).toBe('PENDENTE_VALIDACAO');
    expect(resultado.extracao.status).toBe('EXTRAIDA');
  });

  it('baixa confiança marca a extração como REQUER_REVISAO mas ainda cria a proposta pendente (nunca decide sozinha, só sinaliza)', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado } = await receberResposta(servico, integracao, 1000, 0.2);
    expect(resultado.proposta).not.toBeNull();
    expect(resultado.proposta?.status).toBe('PENDENTE_VALIDACAO');
    expect(resultado.proposta?.requerRevisao).toBe(true);
    expect(resultado.extracao.status).toBe('REQUER_REVISAO');
  });

  it('proposta pendente NUNCA pode ser selecionada antes da validação humana', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado, cotacao } = await receberResposta(servico, integracao, 1000, 0.9);
    const propostaId = resultado.proposta?.id;
    if (propostaId === undefined) throw new Error('setup falhou');
    await expect(servico.servicoSelecionarProposta(cotacao.id, propostaId, USUARIO_TESTE)).rejects.toThrow(/não foi validada/i);
  });

  it('CONFIRMAR (sem corrigir nada) move a proposta para RECEBIDA e ela passa a ser selecionável', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado, cotacao } = await receberResposta(servico, integracao, 1000, 0.9);
    const propostaId = resultado.proposta?.id;
    if (propostaId === undefined) throw new Error('setup falhou');

    const validada = await integracao.servicoValidarProposta(propostaId, {}, USUARIO_TESTE);
    expect(validada.status).toBe('RECEBIDA');

    const selecionada = await servico.servicoSelecionarProposta(cotacao.id, propostaId, USUARIO_TESTE);
    expect(selecionada.status).toBe('SELECIONADA');
  });

  it('CORRIGIR E CONFIRMAR altera o valor extraído (custo da transportadora) sem tocar o cálculo do acréscimo', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado } = await receberResposta(servico, integracao, 1000, 0.9);
    const propostaId = resultado.proposta?.id;
    if (propostaId === undefined) throw new Error('setup falhou');

    const corrigida = await integracao.servicoValidarProposta(propostaId, { valorCusto: 950 }, USUARIO_TESTE);
    expect(corrigida.status).toBe('RECEBIDA');
    expect(corrigida.valorCusto).toBe(950);
  });

  it('sem valorFrete: nenhuma proposta é criada (nunca infere valor) — extração fica REQUER_REVISAO sem proposta associada', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado, cotacao } = await receberResposta(servico, integracao, null, 0.9);
    expect(resultado.proposta).toBeNull();
    expect(resultado.extracao.status).toBe('REQUER_REVISAO');
    expect(resultado.extracao.propostaId).toBeNull();

    const propostas = await servico.servicoListarPropostas(cotacao.id);
    expect(propostas).toHaveLength(0);
  });

  it('idempotência via serviço: a mesma mensagem processada duas vezes nunca cria uma segunda proposta', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico);
    const [solicitacao] = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id], 'EMAIL', USUARIO_TESTE);
    if (solicitacao === undefined) throw new Error('setup falhou');
    const payload = {
      referencia: solicitacao.codigoReferencia,
      canal: 'EMAIL' as const,
      mensagemId: 'mesma-mensagem',
      conteudoBruto: 'texto',
      versaoExtrator: 'teste',
      extracao: extracaoBase(800, 0.9),
    };
    const primeira = await integracao.servicoProcessarRespostaWebhook(payload);
    const segunda = await integracao.servicoProcessarRespostaWebhook(payload);
    expect(primeira.duplicado).toBe(false);
    expect(segunda.duplicado).toBe(true);
    expect(segunda.resposta.id).toBe(primeira.resposta.id);
    expect(segunda.proposta?.id).toBe(primeira.proposta?.id);

    const propostas = await servico.servicoListarPropostas(cotacao.id);
    expect(propostas).toHaveLength(1);
  });

  it('inbox (PROPOSTAS RECEBIDAS) lista a proposta pendente de validação', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado } = await receberResposta(servico, integracao, 700, 0.9);
    const inbox = await integracao.servicoListarInboxPropostas();
    expect(inbox.pendentesValidacao.some((p) => p.id === resultado.proposta?.id)).toBe(true);
  });

  it('comparação de propostas continua sendo a MESMA tela — inclui a proposta pendente junto das demais (seção 33)', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado, cotacao, transportadora } = await receberResposta(servico, integracao, 600, 0.9);
    await servico.servicoCriarProposta(
      { cotacaoId: cotacao.id, transportadoraId: transportadora.id, valorCusto: 500, prazoDias: 2, validade: null, peso: null, volumes: null, origem: null, destino: null, tipoServico: null, observacoes: null },
      USUARIO_TESTE,
    );
    const comparacao = await servico.servicoCompararPropostas(cotacao.id);
    expect(comparacao).toHaveLength(2);
    const statusPresentes = comparacao.map((l) => l.proposta.status).sort();
    expect(statusPresentes).toEqual(['PENDENTE_VALIDACAO', 'RECEBIDA']);
    void resultado;
  });

  it('REJEITAR uma proposta pendente funciona (reutiliza a rejeição já existente, seção 17)', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado } = await receberResposta(servico, integracao, 400, 0.9);
    const propostaId = resultado.proposta?.id;
    if (propostaId === undefined) throw new Error('setup falhou');
    const rejeitada = await servico.servicoRejeitarProposta(propostaId, USUARIO_TESTE);
    expect(rejeitada.status).toBe('REJEITADA');
  });

  it('mensagem original nunca é alterada pela correção humana (seção 18)', async () => {
    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { resultado } = await receberResposta(servico, integracao, 900, 0.9);
    const propostaId = resultado.proposta?.id;
    if (propostaId === undefined) throw new Error('setup falhou');
    const origemAntes = await integracao.servicoBuscarOrigemProposta(propostaId);
    await integracao.servicoValidarProposta(propostaId, { valorCusto: 850, observacoes: 'ajustado pelo humano' }, USUARIO_TESTE);
    const origemDepois = await integracao.servicoBuscarOrigemProposta(propostaId);
    expect(origemDepois?.resposta.conteudoBruto).toBe(origemAntes?.resposta.conteudoBruto);
    expect(origemDepois?.resposta.conteudoBruto).toBe('mensagem de teste');
  });
});

// ============================================================================
// FASE 4A.2 — integração real ETK ↔ n8n (outbound + reenvio + round-trip completo)
// ============================================================================

interface ChamadaMock {
  body: string;
  headers: IncomingHttpHeaders;
}

interface MockN8n {
  url: string;
  chamadas: ChamadaMock[];
  fechar: () => Promise<void>;
}

function iniciarMockN8n(responder: (chamada: ChamadaMock) => { status: number }): Promise<MockN8n> {
  const chamadas: ChamadaMock[] = [];
  let servidor: Server;
  return new Promise((resolve) => {
    servidor = createServer((req, res) => {
      let dados = '';
      req.on('data', (pedaco) => (dados += pedaco));
      req.on('end', () => {
        const chamada: ChamadaMock = { body: dados, headers: req.headers };
        chamadas.push(chamada);
        const resultado = responder(chamada);
        res.writeHead(resultado.status, { 'Content-Type': 'application/json' });
        res.end('{}');
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

const N8N_SECRET_TESTE = 'segredo-n8n-fase-4a2-teste';

describe('integração real ETK ↔ n8n (Fase 4A.2)', () => {
  let mock: MockN8n | null = null;

  afterEach(async () => {
    if (mock !== null) await mock.fechar();
    mock = null;
    delete process.env.N8N_WEBHOOK_URL;
    delete process.env.N8N_WEBHOOK_SECRET;
  });

  it('outbound com sucesso: solicitação vai para ENVIADA e o payload chega ao n8n com o segredo no header', async () => {
    mock = await iniciarMockN8n(() => ({ status: 200 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = N8N_SECRET_TESTE;

    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico);

    const [solicitacao] = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id], 'EMAIL', USUARIO_TESTE);
    if (solicitacao === undefined) throw new Error('setup falhou');

    expect(solicitacao.status).toBe('ENVIADA');
    expect(solicitacao.dataEnvio).not.toBeNull();
    expect(mock.chamadas).toHaveLength(1);
    const chamada = mock.chamadas[0];
    if (chamada === undefined) throw new Error('setup falhou');
    expect(chamada.headers['x-n8n-webhook-secret']).toBe(N8N_SECRET_TESTE);
    const corpo = JSON.parse(chamada.body) as { referencia: string; solicitacaoId: string; cotacaoId: string };
    expect(corpo.referencia).toBe(solicitacao.codigoReferencia);
    expect(corpo.solicitacaoId).toBe(solicitacao.id);
    expect(corpo.cotacaoId).toBe(cotacao.id);
  });

  it('outbound com falha (HTTP 500 do n8n): solicitação fica ERRO, cotação continua íntegra, nenhuma proposta é criada', async () => {
    mock = await iniciarMockN8n(() => ({ status: 500 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = N8N_SECRET_TESTE;

    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico);

    const [solicitacao] = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id], 'EMAIL', USUARIO_TESTE);
    if (solicitacao === undefined) throw new Error('setup falhou');
    expect(solicitacao.status).toBe('ERRO');
    expect(solicitacao.erroUltimaTentativa).toContain('500');

    const cotacaoDepois = await servico.servicoBuscarCotacao(cotacao.id);
    expect(cotacaoDepois.status).not.toBe('CANCELADA');
    const propostas = await servico.servicoListarPropostas(cotacao.id);
    expect(propostas).toHaveLength(0);
  });

  it('reenvio manual reusa a MESMA solicitação (mesma referência/id) — nunca cria uma segunda linha', async () => {
    mock = await iniciarMockN8n(() => ({ status: 500 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = N8N_SECRET_TESTE;

    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico);
    const [solicitacao] = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id], 'EMAIL', USUARIO_TESTE);
    if (solicitacao === undefined) throw new Error('setup falhou');
    expect(solicitacao.status).toBe('ERRO');
    expect(solicitacao.tentativas).toBe(1);

    // Corrige o mock para responder com sucesso desta vez, e reenvia. `config.ts` só lê
    // `process.env.N8N_WEBHOOK_URL` na primeira importação do módulo (mesmo padrão de
    // `garantirEsquemaFretes`) — por isso resetamos os módulos antes de reimportar, sem
    // recriar as tabelas (os nomes em `process.env.*_TABELA` continuam os mesmos).
    await mock.fechar();
    mock = await iniciarMockN8n(() => ({ status: 200 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    vi.resetModules();
    const integracaoAtualizada = await import('../../src/fretes/integracaoCotacoesServico.js');

    const reenviada = await integracaoAtualizada.servicoReenviarSolicitacao(solicitacao.id, USUARIO_TESTE);
    expect(reenviada.id).toBe(solicitacao.id); // mesma linha, nunca uma nova
    expect(reenviada.codigoReferencia).toBe(solicitacao.codigoReferencia);
    expect(reenviada.status).toBe('ENVIADA');
    expect(reenviada.tentativas).toBe(2);

    const listadas = await integracaoAtualizada.servicoListarSolicitacoes(cotacao.id);
    expect(listadas).toHaveLength(1); // nunca duplicou
  });

  it('reenvio só é permitido quando o status atual é ERRO', async () => {
    mock = await iniciarMockN8n(() => ({ status: 200 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = N8N_SECRET_TESTE;

    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico);
    const [solicitacao] = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id], 'EMAIL', USUARIO_TESTE);
    if (solicitacao === undefined) throw new Error('setup falhou');
    expect(solicitacao.status).toBe('ENVIADA');

    await expect(integracao.servicoReenviarSolicitacao(solicitacao.id, USUARIO_TESTE)).rejects.toThrow(/status ERRO/);
  });

  it('SSRF: a URL do n8n vem só da configuração do servidor — um campo extra no corpo da requisição do usuário nunca é usado como destino do envio', async () => {
    mock = await iniciarMockN8n(() => ({ status: 200 }));
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = N8N_SECRET_TESTE;

    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico);

    // `servicoSolicitarCotacoes` nem aceita um parâmetro de URL — não há como o chamador
    // (rota HTTP) direcionar o envio para outro destino, mesmo que tentasse.
    const [solicitacao] = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id], 'EMAIL', USUARIO_TESTE);
    if (solicitacao === undefined) throw new Error('setup falhou');
    expect(solicitacao.status).toBe('ENVIADA');
    expect(mock.chamadas).toHaveLength(1); // o único destino possível é a URL configurada no servidor
  });

  it('round-trip completo: outbound (ETK → n8n) seguido de inbound real (n8n → ETK) usando a referência devolvida', async () => {
    mock = await iniciarMockN8n(() => ({ status: 200 })); // n8n "recebeu" a solicitação
    process.env.N8N_WEBHOOK_URL = mock.url;
    process.env.N8N_WEBHOOK_SECRET = N8N_SECRET_TESTE;

    const servico = await importarServico();
    const integracao = await importarIntegracao();
    const { transportadora, cotacao } = await prepararCotacaoETransportadora(servico);
    const [solicitacao] = await integracao.servicoSolicitarCotacoes(cotacao.id, [transportadora.id], 'EMAIL', USUARIO_TESTE);
    if (solicitacao === undefined) throw new Error('setup falhou');
    expect(solicitacao.status).toBe('ENVIADA');

    // Simula o n8n devolvendo uma resposta mock (seção 18) usando a MESMA referência.
    const resultado = await integracao.servicoProcessarRespostaWebhook({
      referencia: solicitacao.codigoReferencia,
      canal: 'API',
      mensagemId: 'teste-round-trip-1',
      conteudoBruto: 'resposta mock do n8n',
      versaoExtrator: 'n8n-mock',
      extracao: {
        valorFrete: 1000,
        prazoDias: 3,
        validade: null,
        pedagio: null,
        gris: null,
        adValorem: null,
        taxas: [],
        observacoes: 'teste',
        numeroProposta: null,
        confianca: 1,
      },
    });
    expect(resultado.proposta?.status).toBe('PENDENTE_VALIDACAO'); // nunca aprovada automaticamente

    const solicitacaoFinal = await integracao.servicoListarSolicitacoes(cotacao.id);
    expect(solicitacaoFinal[0]?.status).toBe('RESPONDIDA');
  });
});
