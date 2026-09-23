import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { droparTabelasRemanescentes, isolarTabelasComerciais, limparTabelasComerciais } from './isolamentoTabelasComerciais.js';

// Fase Braspress 1 — criação/idempotência da proposta. Postgres real, tabelas descartáveis
// (todas as ~10 tabelas isoladas), API Braspress simulada via fetch injetado.
vi.setConfig({ testTimeout: 30000 });

const USUARIO_TESTE = '11111111-1111-1111-1111-111111111111';
const NOMES = [
  'TRANSPORTADORAS_TABELA',
  'VEICULOS_FRETE_TABELA',
  'COTACOES_FRETE_TABELA',
  'PROPOSTAS_FRETE_TABELA',
  'FECHAMENTOS_FRETE_TABELA',
  'AUDITORIA_FRETES_TABELA',
  'SOLICITACOES_COTACAO_TABELA',
  'RESPOSTAS_COTACAO_TABELA',
  'EXTRACOES_PROPOSTA_TABELA',
] as const;

beforeEach(() => {
  const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  isolarTabelasComerciais(sufixo);
  for (const n of NOMES) process.env[n] = `${n.toLowerCase()}_bp_${sufixo}`;
  process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_bp_${sufixo}`;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  await limparTabelasComerciais(pool);
  for (const n of [...NOMES].reverse()) await pool.query(`DROP TABLE IF EXISTS ${process.env[n]}`).catch(() => undefined);
  await droparTabelasRemanescentes(pool);
  await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
  for (const n of NOMES) delete process.env[n];
  delete process.env.COTACOES_FRETE_SEQ;
}, 30000);

const CUBAGEM = [{ altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 5 }];

async function preparar() {
  vi.resetModules();
  const servico = await import('../../src/fretes/fretesServico.js');
  const bp = await import('../../src/fretes/braspressServico.js');
  const cotacao = await servico.servicoCriarCotacao(
    {
      clienteOmieId: 123, pedidoOmieId: null, vendedorOmieId: null,
      origem: 'São Paulo', cepOrigem: '01000-000', destino: 'Curitiba', cepDestino: '80000-000',
      peso: 100, volumes: 5, valorMercadoria: 5000, modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA',
      veiculoId: null, motoristaNome: null, custoManual: null, observacoes: null,
    },
    USUARIO_TESTE,
  );
  const api = (corpo: unknown) => ({
    cnpj: '11222333000181', senha: 'senha-de-teste-nao-e-real', url: 'https://exemplo.invalido/x', timeoutMs: 1000,
    fetchImpl: (async () => new Response(JSON.stringify(corpo), { status: 200 })) as unknown as typeof fetch,
  });
  const dados = { cepOrigem: null, cubagem: CUBAGEM };
  const omie = (cnpjCpf: string | null) => ({ consultarCliente: vi.fn(async () => ({ cnpjCpf })) });
  return { servico, bp, cotacao, api, dados, omie };
}

describe('Fase Braspress 1 — proposta no fluxo ETK', () => {
  it('cria proposta API_BRASPRESS (RECEBIDA, aguardando logística) e auditoria', async () => {
    const { servico, bp, cotacao, api, dados, omie } = await preparar();
    const r = await bp.servicoCotarBraspress(omie('11222333000181'), cotacao.id, dados, USUARIO_TESTE, api({ id: 900, prazo: 4, totalFrete: 321.5 }));
    expect(r.duplicada).toBe(false);
    expect(r.proposta).toMatchObject({ origemProposta: 'API_BRASPRESS', valorCusto: 321.5, prazoDias: 4, status: 'RECEBIDA', statusRevisao: 'AGUARDANDO_LOGISTICA' });
    const propostas = await servico.servicoListarPropostas(cotacao.id);
    expect(propostas).toHaveLength(1);
    const { obterPool } = await import('../../src/db.js');
    const { rows } = await obterPool().query(`SELECT acao FROM ${process.env.AUDITORIA_FRETES_TABELA} WHERE acao = 'PROPOSTA_API_BRASPRESS_CRIADA'`);
    expect(rows).toHaveLength(1);
  });

  it('idempotência: mesma cotação externa não duplica proposta nem transportadora', async () => {
    const { servico, bp, cotacao, api, dados, omie } = await preparar();
    const a = await bp.servicoCotarBraspress(omie('11222333000181'), cotacao.id, dados, USUARIO_TESTE, api({ id: 901, prazo: 4, totalFrete: 100 }));
    const b = await bp.servicoCotarBraspress(omie('11222333000181'), cotacao.id, dados, USUARIO_TESTE, api({ id: 901, prazo: 4, totalFrete: 100 }));
    expect(b.duplicada).toBe(true);
    expect(b.proposta.id).toBe(a.proposta.id);
    expect(await servico.servicoListarPropostas(cotacao.id)).toHaveLength(1);
    expect((await servico.servicoListarTransportadoras(false)).filter((t) => /braspress/i.test(t.nomeRazaoSocial))).toHaveLength(1);
  });

  it('dados incompletos: erro 400 com a lista do que falta, sem criar proposta', async () => {
    const { servico, bp, cotacao, api, omie } = await preparar();
    const erro = await bp
      .servicoCotarBraspress(omie('11222333000181'), cotacao.id, { cepOrigem: null, cubagem: null }, USUARIO_TESTE, api({ id: 1, prazo: 1, totalFrete: 1 }))
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(bp.ErroDadosCotacaoIncompletos);
    expect((erro as InstanceType<typeof bp.ErroDadosCotacaoIncompletos>).faltando).toContain('cubagem (altura, largura e comprimento em metros)');
    expect(await servico.servicoListarPropostas(cotacao.id)).toHaveLength(0);
  });
});

describe('Ajuste Braspress 1 — CNPJ do destinatário via Omie (somente leitura)', () => {
  it('obtém o CNPJ pelo clienteOmieId, normaliza a pontuação e envia só dígitos à Braspress', async () => {
    const { bp, cotacao, dados, omie } = await preparar();
    const cliente = omie('11.222.333/0001-81');
    let corpoEnviado = '';
    const opcoes = {
      cnpj: '11222333000181', senha: 'senha-de-teste-nao-e-real', url: 'https://exemplo.invalido/x', timeoutMs: 1000,
      fetchImpl: (async (_u: string, init: RequestInit) => {
        corpoEnviado = init.body as string;
        return new Response(JSON.stringify({ id: 950, prazo: 3, totalFrete: 50 }), { status: 200 });
      }) as unknown as typeof fetch,
    };
    await bp.servicoCotarBraspress(cliente, cotacao.id, dados, USUARIO_TESTE, opcoes);
    expect(cliente.consultarCliente).toHaveBeenCalledWith(123);
    expect(JSON.parse(corpoEnviado).cnpjDestinatario).toBe(11222333000181);
  });

  it('cliente sem CNPJ válido (ausente, CPF, dígitos inválidos): CNPJ_DESTINATARIO_NAO_DISPONIVEL e nenhuma chamada à Braspress', async () => {
    const { servico, bp, cotacao, dados, omie } = await preparar();
    const fetchImpl = vi.fn();
    const opcoes = { cnpj: '11222333000181', senha: 'x', url: 'https://exemplo.invalido/x', timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch };
    for (const valor of [null, '123.456.789-09', '11222333000182']) {
      const erro = await bp.servicoCotarBraspress(omie(valor), cotacao.id, dados, USUARIO_TESTE, opcoes).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(bp.ErroCnpjDestinatarioNaoDisponivel);
      expect((erro as Error).message).toContain('CNPJ_DESTINATARIO_NAO_DISPONIVEL');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await servico.servicoListarPropostas(cotacao.id)).toHaveLength(0);
  });
});

describe('Várias embalagens — volumes enviados à Braspress', () => {
  async function volumesEnviados(cubagem: { altura: number; largura: number; comprimento: number; volumes: number }[]) {
    const { bp, cotacao, omie } = await preparar();
    let corpo: { volumes: number; cubagem: unknown } | null = null;
    const opcoes = {
      cnpj: '11222333000181', senha: 'senha-de-teste-nao-e-real', url: 'https://exemplo.invalido/x', timeoutMs: 1000,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        corpo = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ id: 950, prazo: 2, totalFrete: 50 }), { status: 200 });
      }) as unknown as typeof fetch,
    };
    const r = await bp.servicoCotarBraspress(omie('11222333000181'), cotacao.id, { cepOrigem: null, cubagem }, USUARIO_TESTE, opcoes);
    return Object.assign(corpo as unknown as { volumes: number; cubagem: unknown }, { resultado: r, cotacaoId: cotacao.id });
  }

  it('envia a soma das quantidades das linhas (5 + 2 = 7), não cotacao.volumes, com todas as dimensões', async () => {
    const cubagem = [
      { altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 5 },
      { altura: 1.2, largura: 0.8, comprimento: 1, volumes: 2 },
    ];
    const corpo = await volumesEnviados(cubagem);
    expect(corpo.volumes).toBe(7);
    expect(corpo.cubagem).toEqual(cubagem);
  });

  it('proposta e auditoria registram os 7 volumes enviados; cotação original continua com 5', async () => {
    const cubagem = [
      { altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 5 },
      { altura: 1.2, largura: 0.8, comprimento: 1, volumes: 2 },
    ];
    const { resultado, cotacaoId } = await volumesEnviados(cubagem);
    expect(resultado.proposta.volumes).toBe(7);
    const servico = await import('../../src/fretes/fretesServico.js');
    expect((await servico.servicoListarPropostas(cotacaoId))[0]?.volumes).toBe(7);
    expect((await servico.servicoBuscarCotacao(cotacaoId)).volumes).toBe(5);
    const { obterPool } = await import('../../src/db.js');
    const { rows } = await obterPool().query(
      `SELECT valor_novo FROM ${process.env.AUDITORIA_FRETES_TABELA} WHERE acao = 'PROPOSTA_API_BRASPRESS_CRIADA'`,
    );
    expect(rows).toHaveLength(1);
    const valorNovo = typeof rows[0].valor_novo === 'string' ? JSON.parse(rows[0].valor_novo) : rows[0].valor_novo;
    expect(valorNovo).toMatchObject({ volumes: 7, cubagem });
  });

  it('uma única linha: volumes = quantidade da linha (equivalente ao comportamento anterior)', async () => {
    const corpo = await volumesEnviados([{ altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 5 }]);
    expect(corpo.volumes).toBe(5);
  });
});
