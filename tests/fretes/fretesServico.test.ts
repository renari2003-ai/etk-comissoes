import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Este arquivo cria/derruba 5 tabelas novas por teste (Supabase real, sobre a rede) —
// bem mais round-trips que os demais testes de integração do projeto. 5000ms (padrão do
// Vitest) não é suficiente; aumentado só neste arquivo, sem tocar em configuração global.
vi.setConfig({ testTimeout: 20000 });

/**
 * Roda contra o Postgres (Supabase) real — mesmo padrão de
 * `tests/omie/limitador.test.ts`/`tests/auth/usuarios.test.ts`: uma tabela nova e
 * descartável por teste (uma var de ambiente por tabela do módulo), nunca toca nas
 * tabelas de verdade. `vi.resetModules()` + `import()` dinâmico porque os nomes de
 * tabela são lidos na primeira chamada de cada módulo (cache de "tabela garantida").
 */
async function importarServico(): Promise<typeof import('../../src/fretes/fretesServico.js')> {
  vi.resetModules();
  return import('../../src/fretes/fretesServico.js');
}

let sufixo: string;

beforeEach(() => {
  sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  process.env.TRANSPORTADORAS_TABELA = `transportadoras_teste_${sufixo}`;
  process.env.COTACOES_FRETE_TABELA = `cotacoes_frete_teste_${sufixo}`;
  process.env.PROPOSTAS_FRETE_TABELA = `propostas_frete_teste_${sufixo}`;
  process.env.FECHAMENTOS_FRETE_TABELA = `fechamentos_frete_teste_${sufixo}`;
  process.env.AUDITORIA_FRETES_TABELA = `auditoria_fretes_teste_${sufixo}`;
  process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_teste_${sufixo}`;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  // Ordem inversa às FKs (fechamentos/propostas antes de cotações/transportadoras).
  await pool.query(`DROP TABLE IF EXISTS ${process.env.FECHAMENTOS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.PROPOSTAS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.COTACOES_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.TRANSPORTADORAS_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.AUDITORIA_FRETES_TABELA}`).catch(() => undefined);
  await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
  delete process.env.TRANSPORTADORAS_TABELA;
  delete process.env.COTACOES_FRETE_TABELA;
  delete process.env.PROPOSTAS_FRETE_TABELA;
  delete process.env.FECHAMENTOS_FRETE_TABELA;
  delete process.env.AUDITORIA_FRETES_TABELA;
  delete process.env.COTACOES_FRETE_SEQ;
}, 20000);

const USUARIO_TESTE = '11111111-1111-1111-1111-111111111111';

async function criarCotacaoDeTeste(servico: Awaited<ReturnType<typeof importarServico>>) {
  return servico.servicoCriarCotacao(
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
      observacoes: null,
    },
    USUARIO_TESTE,
  );
}

describe('código da cotação', () => {
  it('gera código único no formato FRE-{ano}-{6 dígitos}', async () => {
    const servico = await importarServico();
    const cotacao = await criarCotacaoDeTeste(servico);
    expect(cotacao.codigo).toMatch(/^FRE-\d{4}-\d{6}$/);
    expect(cotacao.status).toBe('RASCUNHO');
  });

  it('nunca gera dois códigos iguais em criações sucessivas', async () => {
    const servico = await importarServico();
    const a = await criarCotacaoDeTeste(servico);
    const b = await criarCotacaoDeTeste(servico);
    expect(a.codigo).not.toBe(b.codigo);
  });
});

describe('fluxo completo: cotação → proposta → seleção → fechamento', () => {
  it('avança os status corretamente e calcula o fechamento (modo percentual)', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'ABC Transportes', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoDeTeste(servico);

    const proposta = await servico.servicoCriarProposta(
      {
        cotacaoId: cotacao.id,
        transportadoraId: transportadora.id,
        valorCusto: 1000,
        prazoDias: 4,
        validade: null,
        peso: null,
        volumes: null,
        origem: null,
        destino: null,
        tipoServico: 'Rodoviário',
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    expect(proposta.status).toBe('RECEBIDA');
    expect(proposta.selecionada).toBe(false);

    const cotacaoAposProposta = await servico.servicoBuscarCotacao(cotacao.id);
    expect(cotacaoAposProposta.status).toBe('EM_ANALISE');

    const selecionada = await servico.servicoSelecionarProposta(cotacao.id, proposta.id, USUARIO_TESTE);
    expect(selecionada.selecionada).toBe(true);
    expect(selecionada.status).toBe('SELECIONADA');

    const cotacaoAposSelecao = await servico.servicoBuscarCotacao(cotacao.id);
    expect(cotacaoAposSelecao.status).toBe('AGUARDANDO_APROVACAO');

    const fechamento = await servico.servicoFecharCotacao(
      { cotacaoId: cotacao.id, percentualAcrescimo: 15, observacoes: 'Fechamento de teste' },
      USUARIO_TESTE,
    );
    expect(fechamento.custoFrete).toBe(1000);
    expect(fechamento.percentualAcrescimo).toBe(15);
    expect(fechamento.valorAcrescimo).toBe(150);
    expect(fechamento.valorFreteCliente).toBe(1150);
    expect(fechamento.modoCalculo).toBe('PERCENTUAL');

    const cotacaoFinal = await servico.servicoBuscarCotacao(cotacao.id);
    expect(cotacaoFinal.status).toBe('FECHADA');
    expect(cotacaoFinal.fechadoEm).not.toBeNull();
  });

  it('modo valor final: calcula o percentual implícito sem alterar o custo original', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'XYZ Log', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoDeTeste(servico);
    const proposta = await servico.servicoCriarProposta(
      {
        cotacaoId: cotacao.id,
        transportadoraId: transportadora.id,
        valorCusto: 1000,
        prazoDias: null,
        validade: null,
        peso: null,
        volumes: null,
        origem: null,
        destino: null,
        tipoServico: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    await servico.servicoSelecionarProposta(cotacao.id, proposta.id, USUARIO_TESTE);

    const fechamento = await servico.servicoFecharCotacao(
      { cotacaoId: cotacao.id, valorFreteClienteInformado: 1200, observacoes: null },
      USUARIO_TESTE,
    );
    expect(fechamento.custoFrete).toBe(1000);
    expect(fechamento.percentualAcrescimo).toBe(20);
    expect(fechamento.valorFreteCliente).toBe(1200);
    expect(fechamento.modoCalculo).toBe('VALOR_FINAL');
  });

  it('impede fechar duas vezes a mesma cotação (idempotência, seção 35/36)', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'ABC Transportes', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoDeTeste(servico);
    const proposta = await servico.servicoCriarProposta(
      {
        cotacaoId: cotacao.id,
        transportadoraId: transportadora.id,
        valorCusto: 500,
        prazoDias: null,
        validade: null,
        peso: null,
        volumes: null,
        origem: null,
        destino: null,
        tipoServico: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    await servico.servicoSelecionarProposta(cotacao.id, proposta.id, USUARIO_TESTE);
    await servico.servicoFecharCotacao({ cotacaoId: cotacao.id, percentualAcrescimo: 0, observacoes: null }, USUARIO_TESTE);

    await expect(
      servico.servicoFecharCotacao({ cotacaoId: cotacao.id, percentualAcrescimo: 10, observacoes: null }, USUARIO_TESTE),
    ).rejects.toThrow('já foi fechada');
  });

  it('impede fechar sem nenhuma proposta selecionada', async () => {
    const servico = await importarServico();
    const cotacao = await criarCotacaoDeTeste(servico);
    await expect(
      servico.servicoFecharCotacao({ cotacaoId: cotacao.id, percentualAcrescimo: 10, observacoes: null }, USUARIO_TESTE),
    ).rejects.toThrow('Selecione uma proposta');
  });

  it('selecionar uma segunda proposta desmarca a primeira (só uma selecionada por vez)', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora A', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoDeTeste(servico);
    const propostaA = await servico.servicoCriarProposta(
      {
        cotacaoId: cotacao.id,
        transportadoraId: transportadora.id,
        valorCusto: 900,
        prazoDias: null,
        validade: null,
        peso: null,
        volumes: null,
        origem: null,
        destino: null,
        tipoServico: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    const propostaB = await servico.servicoCriarProposta(
      {
        cotacaoId: cotacao.id,
        transportadoraId: transportadora.id,
        valorCusto: 950,
        prazoDias: null,
        validade: null,
        peso: null,
        volumes: null,
        origem: null,
        destino: null,
        tipoServico: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );

    await servico.servicoSelecionarProposta(cotacao.id, propostaA.id, USUARIO_TESTE);
    await servico.servicoSelecionarProposta(cotacao.id, propostaB.id, USUARIO_TESTE);

    const propostas = await servico.servicoListarPropostas(cotacao.id);
    const selecionadas = propostas.filter((p) => p.selecionada);
    expect(selecionadas).toHaveLength(1);
    expect(selecionadas[0]?.id).toBe(propostaB.id);
  });
});

describe('validação de valor final menor que o custo', () => {
  it('rejeita valor final abaixo do custo da transportadora', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'ABC', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoDeTeste(servico);
    const proposta = await servico.servicoCriarProposta(
      {
        cotacaoId: cotacao.id,
        transportadoraId: transportadora.id,
        valorCusto: 1000,
        prazoDias: null,
        validade: null,
        peso: null,
        volumes: null,
        origem: null,
        destino: null,
        tipoServico: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    await servico.servicoSelecionarProposta(cotacao.id, proposta.id, USUARIO_TESTE);

    await expect(
      servico.servicoFecharCotacao({ cotacaoId: cotacao.id, valorFreteClienteInformado: 900, observacoes: null }, USUARIO_TESTE),
    ).rejects.toThrow('não pode ser menor que o custo');
  });
});

describe('dashboard', () => {
  it('deriva os totais exclusivamente das cotações/fechamentos do módulo', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'ABC', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoDeTeste(servico);
    const proposta = await servico.servicoCriarProposta(
      {
        cotacaoId: cotacao.id,
        transportadoraId: transportadora.id,
        valorCusto: 200,
        prazoDias: null,
        validade: null,
        peso: null,
        volumes: null,
        origem: null,
        destino: null,
        tipoServico: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    await servico.servicoSelecionarProposta(cotacao.id, proposta.id, USUARIO_TESTE);
    await servico.servicoFecharCotacao({ cotacaoId: cotacao.id, percentualAcrescimo: 10, observacoes: null }, USUARIO_TESTE);

    const dashboard = await servico.servicoDashboard();
    expect(dashboard.cotacoesPorStatus.FECHADA).toBe(1);
    expect(dashboard.resumoFechamentos.quantidade).toBe(1);
    expect(dashboard.resumoFechamentos.custoTotal).toBe(200);
    expect(dashboard.resumoFechamentos.valorClienteTotal).toBe(220);
    expect(dashboard.resumoFechamentos.acrescimoTotal).toBe(20);
  });
});
