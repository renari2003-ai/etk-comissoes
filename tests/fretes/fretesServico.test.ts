import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie, Cliente } from '../../src/omie/cliente.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';

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
  process.env.VEICULOS_FRETE_TABELA = `veiculos_frete_teste_${sufixo}`;
  process.env.COTACOES_FRETE_TABELA = `cotacoes_frete_teste_${sufixo}`;
  process.env.PROPOSTAS_FRETE_TABELA = `propostas_frete_teste_${sufixo}`;
  process.env.FECHAMENTOS_FRETE_TABELA = `fechamentos_frete_teste_${sufixo}`;
  process.env.AUDITORIA_FRETES_TABELA = `auditoria_fretes_teste_${sufixo}`;
  process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_teste_${sufixo}`;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  // Ordem inversa às FKs (fechamentos/propostas antes de cotações/transportadoras/veículos).
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
      modalidadeExecucao: 'TRANSPORTADORA',
      veiculoId: null,
      motoristaNome: null,
      custoManual: null,
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

// ============================================================================
// FASE 2 — modalidades TRANSPORTADORA / VEICULO_PROPRIO / RETIRA
// ============================================================================

async function criarCotacaoComModalidade(
  servico: Awaited<ReturnType<typeof importarServico>>,
  modalidadeExecucao: 'TRANSPORTADORA' | 'VEICULO_PROPRIO' | 'RETIRA',
  extras: { veiculoId?: string | null; motoristaNome?: string | null; custoManual?: number | null } = {},
) {
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
      modalidadeExecucao,
      veiculoId: extras.veiculoId ?? null,
      motoristaNome: extras.motoristaNome ?? null,
      custoManual: extras.custoManual ?? null,
      observacoes: null,
    },
    USUARIO_TESTE,
  );
}

describe('modalidade TRANSPORTADORA (Fase 2 — preserva o fluxo da Fase 1)', () => {
  it('exige proposta antes do fechamento', async () => {
    const servico = await importarServico();
    const cotacao = await criarCotacaoComModalidade(servico, 'TRANSPORTADORA');
    await expect(
      servico.servicoFecharCotacao({ cotacaoId: cotacao.id, percentualAcrescimo: 10, observacoes: null }, USUARIO_TESTE),
    ).rejects.toThrow('Selecione uma proposta');
  });

  it('permite seleção de proposta normalmente', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'ABC', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoComModalidade(servico, 'TRANSPORTADORA');
    const proposta = await servico.servicoCriarProposta(
      {
        cotacaoId: cotacao.id,
        transportadoraId: transportadora.id,
        valorCusto: 300,
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
    const selecionada = await servico.servicoSelecionarProposta(cotacao.id, proposta.id, USUARIO_TESTE);
    expect(selecionada.selecionada).toBe(true);
  });
});

describe('modalidade VEICULO_PROPRIO (Fase 2)', () => {
  it('não exige transportadora nem proposta — fechamento direto com custo manual', async () => {
    const servico = await importarServico();
    const veiculo = await servico.servicoCriarVeiculo(
      {
        descricao: 'Caminhão ETK 01',
        placa: 'ABC-1D23',
        tipo: 'Caminhão',
        marca: null,
        modelo: null,
        ano: null,
        capacidadeKg: 5000,
        capacidadeM3: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoComModalidade(servico, 'VEICULO_PROPRIO', {
      veiculoId: veiculo.id,
      motoristaNome: 'João',
      custoManual: 500,
    });

    const fechamento = await servico.servicoFecharCotacao(
      { cotacaoId: cotacao.id, percentualAcrescimo: 20, observacoes: null },
      USUARIO_TESTE,
    );
    expect(fechamento.modalidadeExecucao).toBe('VEICULO_PROPRIO');
    expect(fechamento.propostaId).toBeNull();
    expect(fechamento.transportadoraId).toBeNull();
    expect(fechamento.veiculoId).toBe(veiculo.id);
    expect(fechamento.motoristaNome).toBe('João');
    expect(fechamento.custoFrete).toBe(500);
    expect(fechamento.valorAcrescimo).toBe(100);
    expect(fechamento.valorFreteCliente).toBe(600);
  });

  it('veículo ativo pode ser vinculado a uma nova cotação', async () => {
    const servico = await importarServico();
    const veiculo = await servico.servicoCriarVeiculo(
      { descricao: 'Van ETK 02', placa: null, tipo: null, marca: null, modelo: null, ano: null, capacidadeKg: null, capacidadeM3: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoComModalidade(servico, 'VEICULO_PROPRIO', { veiculoId: veiculo.id });
    expect(cotacao.veiculoId).toBe(veiculo.id);
  });

  it('veículo inativo não pode ser selecionado numa nova cotação', async () => {
    const servico = await importarServico();
    const veiculo = await servico.servicoCriarVeiculo(
      { descricao: 'Van Inativa', placa: null, tipo: null, marca: null, modelo: null, ano: null, capacidadeKg: null, capacidadeM3: null, observacoes: null },
      USUARIO_TESTE,
    );
    await servico.servicoDefinirAtivoVeiculo(veiculo.id, false, USUARIO_TESTE);

    await expect(criarCotacaoComModalidade(servico, 'VEICULO_PROPRIO', { veiculoId: veiculo.id })).rejects.toThrow('inativo');
  });

  it('não permite criar proposta de transportadora numa cotação VEICULO_PROPRIO', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'ABC', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const veiculo = await servico.servicoCriarVeiculo(
      { descricao: 'Caminhão ETK 03', placa: null, tipo: null, marca: null, modelo: null, ano: null, capacidadeKg: null, capacidadeM3: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoComModalidade(servico, 'VEICULO_PROPRIO', { veiculoId: veiculo.id });

    await expect(
      servico.servicoCriarProposta(
        {
          cotacaoId: cotacao.id,
          transportadoraId: transportadora.id,
          valorCusto: 100,
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
      ),
    ).rejects.toThrow('TRANSPORTADORA');
  });

  it('exige um veículo vinculado antes de fechar', async () => {
    const servico = await importarServico();
    const cotacao = await criarCotacaoComModalidade(servico, 'VEICULO_PROPRIO');
    await expect(
      servico.servicoFecharCotacao({ cotacaoId: cotacao.id, percentualAcrescimo: 0, observacoes: null }, USUARIO_TESTE),
    ).rejects.toThrow('Vincule um veículo');
  });

  it('bloqueia o fechamento se o veículo for desativado DEPOIS de já vinculado à cotação (revalidação no fechamento, Prompt 2.2)', async () => {
    const servico = await importarServico();
    const veiculo = await servico.servicoCriarVeiculo(
      { descricao: 'Caminhão ETK 05', placa: null, tipo: null, marca: null, modelo: null, ano: null, capacidadeKg: null, capacidadeM3: null, observacoes: null },
      USUARIO_TESTE,
    );
    const cotacao = await criarCotacaoComModalidade(servico, 'VEICULO_PROPRIO', { veiculoId: veiculo.id, custoManual: 300 });

    // Vínculo feito com o veículo ainda ativo — só depois disso ele é desativado.
    await servico.servicoDefinirAtivoVeiculo(veiculo.id, false, USUARIO_TESTE);

    await expect(
      servico.servicoFecharCotacao({ cotacaoId: cotacao.id, percentualAcrescimo: 0, observacoes: null }, USUARIO_TESTE),
    ).rejects.toThrow('inativo');
  });
});

describe('modalidade RETIRA (Fase 2)', () => {
  it('não exige transportadora, veículo nem proposta', async () => {
    const servico = await importarServico();
    const cotacao = await criarCotacaoComModalidade(servico, 'RETIRA');
    expect(cotacao.modalidadeExecucao).toBe('RETIRA');
    expect(cotacao.veiculoId).toBeNull();
  });

  it('gera frete R$ 0,00 no fechamento direto', async () => {
    const servico = await importarServico();
    const cotacao = await criarCotacaoComModalidade(servico, 'RETIRA');
    const fechamento = await servico.servicoFecharCotacao({ cotacaoId: cotacao.id, observacoes: null }, USUARIO_TESTE);
    expect(fechamento.modalidadeExecucao).toBe('RETIRA');
    expect(fechamento.custoFrete).toBe(0);
    expect(fechamento.valorFreteCliente).toBe(0);
    expect(fechamento.propostaId).toBeNull();
    expect(fechamento.transportadoraId).toBeNull();
    expect(fechamento.veiculoId).toBeNull();
  });

  it('nunca gera acréscimo, mesmo que um percentual seja enviado por engano', async () => {
    const servico = await importarServico();
    const cotacao = await criarCotacaoComModalidade(servico, 'RETIRA');
    const fechamento = await servico.servicoFecharCotacao(
      { cotacaoId: cotacao.id, percentualAcrescimo: 50, observacoes: null },
      USUARIO_TESTE,
    );
    expect(fechamento.percentualAcrescimo).toBe(0);
    expect(fechamento.valorAcrescimo).toBe(0);
    expect(fechamento.valorFreteCliente).toBe(0);
  });
});

describe('isolamento entre modalidades (Fase 2)', () => {
  it('cada modalidade é contada separadamente no dashboard', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'ABC', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const veiculo = await servico.servicoCriarVeiculo(
      { descricao: 'Caminhão ETK 04', placa: null, tipo: null, marca: null, modelo: null, ano: null, capacidadeKg: null, capacidadeM3: null, observacoes: null },
      USUARIO_TESTE,
    );
    await criarCotacaoComModalidade(servico, 'TRANSPORTADORA');
    await criarCotacaoComModalidade(servico, 'VEICULO_PROPRIO', { veiculoId: veiculo.id });
    await criarCotacaoComModalidade(servico, 'VEICULO_PROPRIO', { veiculoId: veiculo.id });
    await criarCotacaoComModalidade(servico, 'RETIRA');
    void transportadora;

    const dashboard = await servico.servicoDashboard();
    expect(dashboard.cotacoesPorModalidadeExecucao.TRANSPORTADORA).toBe(1);
    expect(dashboard.cotacoesPorModalidadeExecucao.VEICULO_PROPRIO).toBe(2);
    expect(dashboard.cotacoesPorModalidadeExecucao.RETIRA).toBe(1);
  });
});

// ============================================================================
// FASE 3.2 — importação de pedido Omie (servicoPrepararCotacaoDeOmie / servicoCriarCotacaoDeOmie)
// ============================================================================

function pedidoOmieDeTeste(extra: Record<string, unknown> = {}): PedidoOmie {
  return {
    cabecalho: { codigo_pedido: 888001, numero_pedido: '888001', etapa: '10', codigo_cliente: 321 },
    det: [{ produto: { codigo_produto: 1, codigo: 'X1', descricao: 'Item', quantidade: 1, valor_unitario: 50 } }],
    total_pedido: { valor_total_pedido: 50 },
    informacoes_adicionais: { codVend: 7 },
    frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0, peso_bruto: 8, peso_liquido: 7, quantidade_volumes: 1 } as PedidoOmie['frete'],
    ...extra,
  } as PedidoOmie;
}

function clienteOmieFakeComEndereco(pedido: PedidoOmie, cliente: Cliente | null): ClienteOmie {
  return {
    consultarPedido: async () => pedido,
    consultarCliente: async () => cliente,
    classificarPedido: async () => ({ tipo: 'PEDIDO', ambiguo: false, rotulo: '10 - Em andamento' }),
  } as unknown as ClienteOmie;
}

const CLIENTE_TESTE_COM_ENTREGA: Cliente = {
  codigo: 321,
  razaoSocial: 'Cliente Omie Teste',
  nomeFantasia: 'Cliente Teste',
  enderecoCadastral: {
    cep: '04000-000',
    logradouro: 'Rua Cadastral',
    numero: '1',
    complemento: null,
    bairro: 'Bairro',
    cidade: 'Cidade Cadastral',
    uf: 'SP',
    codigoMunicipio: null,
  },
  enderecoEntrega: { cep: '05000-000', logradouro: 'Rua de Entrega', numero: '2', bairro: 'Bairro Entrega', cidade: 'Cidade Entrega', uf: 'RJ' },
};

describe('servicoPrepararCotacaoDeOmie (Fase 3.2 — preparação, nunca persiste)', () => {
  it('retorna a preparação com o destino resolvido e sem cotações existentes', async () => {
    const servico = await importarServico();
    const cliente = clienteOmieFakeComEndereco(pedidoOmieDeTeste(), CLIENTE_TESTE_COM_ENTREGA);
    const preparacao = await servico.servicoPrepararCotacaoDeOmie(cliente, '888001', 'PEDIDO');
    expect(preparacao.destino?.origem).toBe('CLIENTE_ENTREGA');
    expect(preparacao.cotacoesExistentes).toEqual([]);
  });

  it('avisa (sem bloquear) quando já existe cotação para o mesmo pedido Omie', async () => {
    const servico = await importarServico();
    const cliente = clienteOmieFakeComEndereco(pedidoOmieDeTeste(), CLIENTE_TESTE_COM_ENTREGA);
    await servico.servicoCriarCotacaoDeOmie(
      cliente,
      '888001',
      'PEDIDO',
      null,
      { modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null },
      USUARIO_TESTE,
    );
    const preparacao = await servico.servicoPrepararCotacaoDeOmie(cliente, '888001', 'PEDIDO');
    expect(preparacao.cotacoesExistentes).toHaveLength(1);
  });
});

describe('servicoCriarCotacaoDeOmie (Fase 3.2 — confirmação)', () => {
  it('cria a cotação com snapshot do destino resolvido (CLIENTE_ENTREGA) e dados logísticos preservados', async () => {
    const servico = await importarServico();
    const cliente = clienteOmieFakeComEndereco(pedidoOmieDeTeste(), CLIENTE_TESTE_COM_ENTREGA);
    const cotacao = await servico.servicoCriarCotacaoDeOmie(
      cliente,
      '888001',
      'PEDIDO',
      null,
      { modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null },
      USUARIO_TESTE,
    );
    expect(cotacao.pedidoOmieId).toBe(888001);
    expect(cotacao.pedidoOmieNumero).toBe('888001');
    expect(cotacao.clienteOmieId).toBe(321);
    expect(cotacao.clienteNomeSnapshot).toBe('Cliente Omie Teste');
    expect(cotacao.origemDestino).toBe('CLIENTE_ENTREGA');
    expect(cotacao.cepDestino).toBe('05000-000');
    expect(cotacao.cidadeDestino).toBe('Cidade Entrega');
    expect(cotacao.pesoBruto).toBe(8);
    expect(cotacao.pesoLiquido).toBe(7);
    expect(cotacao.volumes).toBe(1);
  });

  it('override manual do destino grava origemDestino = MANUAL, ignorando o endereço resolvido automaticamente', async () => {
    const servico = await importarServico();
    const cliente = clienteOmieFakeComEndereco(pedidoOmieDeTeste(), CLIENTE_TESTE_COM_ENTREGA);
    const cotacao = await servico.servicoCriarCotacaoDeOmie(
      cliente,
      '888001',
      'PEDIDO',
      { cep: '09999-000', logradouro: 'Rua Manual', numero: '9', complemento: null, bairro: 'Bairro Manual', cidade: 'Cidade Manual', uf: 'MG' },
      { modalidade: 'FOB', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null },
      USUARIO_TESTE,
    );
    expect(cotacao.origemDestino).toBe('MANUAL');
    expect(cotacao.cepDestino).toBe('09999-000');
    expect(cotacao.cidadeDestino).toBe('Cidade Manual');
  });

  it('rejeita a confirmação quando não há destino resolvido nem override manual', async () => {
    const servico = await importarServico();
    const clienteSemEndereco: Cliente = {
      codigo: 321,
      razaoSocial: '',
      nomeFantasia: '',
      enderecoCadastral: { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, codigoMunicipio: null },
      enderecoEntrega: null,
    };
    const cliente = clienteOmieFakeComEndereco(pedidoOmieDeTeste(), clienteSemEndereco);
    await expect(
      servico.servicoCriarCotacaoDeOmie(
        cliente,
        '888001',
        'PEDIDO',
        null,
        { modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null },
        USUARIO_TESTE,
      ),
    ).rejects.toThrow('Informe o destino manualmente');
  });

  it('nunca altera o frete usado em Comissão/Margem — cotação Fretes é uma estrutura totalmente separada', async () => {
    // Confirma isolamento (seção 4): a criação via Omie não lê nem escreve em nenhuma
    // estrutura de Comissão/Margem/Relatórios — só usa `pedido.frete.peso_bruto` etc.
    // (logística), nunca `pedido.frete.valor_frete` (financeiro, protegido).
    const servico = await importarServico();
    const pedidoComFreteFinanceiro = pedidoOmieDeTeste({
      frete: { valor_frete: 999, valor_seguro: 50, outras_despesas: 10, peso_bruto: 8, peso_liquido: 7, quantidade_volumes: 1 },
    });
    const cliente = clienteOmieFakeComEndereco(pedidoComFreteFinanceiro, CLIENTE_TESTE_COM_ENTREGA);
    const cotacao = await servico.servicoCriarCotacaoDeOmie(
      cliente,
      '888001',
      'PEDIDO',
      null,
      { modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null },
      USUARIO_TESTE,
    );
    // Nenhum campo da cotação carrega o valor_frete/valor_seguro/outras_despesas da Omie.
    expect(cotacao.custoManual).toBeNull();
    expect(cotacao.valorMercadoria).toBe(50); // valor_total_pedido, não valor_frete
  });
});

// ============================================================================
// FASE 3.6 — correção da detecção de duplicidade (compatibilidade com cotações manuais antigas)
// ============================================================================

async function importarRepositorio(): Promise<typeof import('../../src/fretes/cotacoesRepositorio.js')> {
  vi.resetModules();
  return import('../../src/fretes/cotacoesRepositorio.js');
}

/** Cria uma cotação "legada" (fluxo manual, Fase 1) — nunca preenche `pedidoOmieNumero`, exatamente como cotações reais criadas antes da Fase 3.2. */
async function criarCotacaoLegado(servico: Awaited<ReturnType<typeof importarServico>>, pedidoOmieIdDigitado: number) {
  return servico.servicoCriarCotacao(
    {
      clienteOmieId: null,
      pedidoOmieId: pedidoOmieIdDigitado,
      vendedorOmieId: null,
      origem: null,
      cepOrigem: null,
      destino: null,
      cepDestino: null,
      peso: null,
      volumes: null,
      valorMercadoria: null,
      modalidade: 'CIF',
      modalidadeExecucao: 'TRANSPORTADORA',
      veiculoId: null,
      motoristaNome: null,
      custoManual: null,
      observacoes: null,
    },
    USUARIO_TESTE,
  );
}

describe('buscarCotacoesRelacionadasAoPedidoOmie (Fase 3.6 — correção de duplicidade)', () => {
  it('caso 1: nova cotação com identificador Omie correto é detectada ao consultar novamente', async () => {
    const repo = await importarRepositorio();
    await repo.criarCotacao(
      {
        clienteOmieId: null,
        pedidoOmieId: 2421339467,
        pedidoOmieNumero: '130',
        vendedorOmieId: null,
        origem: null,
        cepOrigem: null,
        destino: null,
        cepDestino: null,
        peso: null,
        volumes: null,
        valorMercadoria: null,
        modalidade: 'CIF',
        modalidadeExecucao: 'TRANSPORTADORA',
        veiculoId: null,
        motoristaNome: null,
        custoManual: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    const encontradas = await repo.buscarCotacoesRelacionadasAoPedidoOmie(2421339467, '130');
    expect(encontradas).toHaveLength(1);
  });

  it('caso 2: cotação legada com pedido_omie_id = número do pedido (não o codigo_pedido) é detectada via fallback', async () => {
    const servico = await importarServico();
    const repo = await importarRepositorio();
    // Legado: usuário digitou "130" (o número visível), nunca o codigo_pedido real (2421339467).
    await criarCotacaoLegado(servico, 130);

    const encontradas = await repo.buscarCotacoesRelacionadasAoPedidoOmie(2421339467, '130');
    expect(encontradas).toHaveLength(1);
  });

  it('caso 3: pedido diferente não gera correspondência', async () => {
    const servico = await importarServico();
    const repo = await importarRepositorio();
    await criarCotacaoLegado(servico, 130);

    const encontradas = await repo.buscarCotacoesRelacionadasAoPedidoOmie(999999999, '999');
    expect(encontradas).toHaveLength(0);
  });

  it('caso 4: mesmo cliente, pedido diferente — não associa por cliente', async () => {
    const servico = await importarServico();
    const repo = await importarRepositorio();
    await servico.servicoCriarCotacao(
      {
        clienteOmieId: 321,
        pedidoOmieId: 111,
        vendedorOmieId: null,
        origem: null,
        cepOrigem: null,
        destino: null,
        cepDestino: null,
        peso: null,
        volumes: null,
        valorMercadoria: null,
        modalidade: 'CIF',
        modalidadeExecucao: 'TRANSPORTADORA',
        veiculoId: null,
        motoristaNome: null,
        custoManual: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    // Mesmo clienteOmieId (321), mas outro pedido (codigo/número 222).
    const encontradas = await repo.buscarCotacoesRelacionadasAoPedidoOmie(222, '222');
    expect(encontradas).toHaveLength(0);
  });

  it('caso 5: cotação sem pedido_omie_id nunca é associada', async () => {
    const servico = await importarServico();
    const repo = await importarRepositorio();
    await criarCotacaoDeTeste(servico); // pedidoOmieId: null

    const encontradas = await repo.buscarCotacoesRelacionadasAoPedidoOmie(2421339467, '130');
    expect(encontradas).toHaveLength(0);
  });

  it('caso 6: identificadores conflitantes — linha do fluxo novo cujo pedido_omie_id coincide com o número buscado NÃO é pega pelo fallback (só linhas comprovadamente legadas, com pedido_omie_numero NULL)', async () => {
    const repo = await importarRepositorio();
    // Linha "nova" cujo pedido_omie_id (codigo_pedido) é, por coincidência, igual ao NÚMERO
    // que vamos buscar (999) — mas pedido_omie_numero está preenchido com outro valor,
    // provando que essa linha já passou pela importação Omie e não é legado ambíguo.
    await repo.criarCotacao(
      {
        clienteOmieId: null,
        pedidoOmieId: 999,
        pedidoOmieNumero: '777', // valor real e diferente do número buscado
        vendedorOmieId: null,
        origem: null,
        cepOrigem: null,
        destino: null,
        cepDestino: null,
        peso: null,
        volumes: null,
        valorMercadoria: null,
        modalidade: 'CIF',
        modalidadeExecucao: 'TRANSPORTADORA',
        veiculoId: null,
        motoristaNome: null,
        custoManual: null,
        observacoes: null,
      },
      USUARIO_TESTE,
    );
    // Buscando por um pedido totalmente diferente (codigo_pedido 123456) cujo número visível é "999".
    const encontradas = await repo.buscarCotacoesRelacionadasAoPedidoOmie(123456, '999');
    expect(encontradas).toHaveLength(0);
  });

  it('caso 7: recotação — aviso não impede criar uma nova cotação para o mesmo pedido', async () => {
    const servico = await importarServico();
    const cliente = clienteOmieFakeComEndereco(pedidoOmieDeTeste(), CLIENTE_TESTE_COM_ENTREGA);
    const primeira = await servico.servicoCriarCotacaoDeOmie(
      cliente,
      '888001',
      'PEDIDO',
      null,
      { modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null },
      USUARIO_TESTE,
    );
    const preparacao = await servico.servicoPrepararCotacaoDeOmie(cliente, '888001', 'PEDIDO');
    expect(preparacao.cotacoesExistentes).toHaveLength(1);
    expect(preparacao.cotacoesExistentes[0]?.id).toBe(primeira.id);

    // Recotação intencional: nada no fluxo impede criar uma segunda cotação para o mesmo pedido.
    const segunda = await servico.servicoCriarCotacaoDeOmie(
      cliente,
      '888001',
      'PEDIDO',
      null,
      { modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null },
      USUARIO_TESTE,
    );
    expect(segunda.id).not.toBe(primeira.id);

    const preparacaoFinal = await servico.servicoPrepararCotacaoDeOmie(cliente, '888001', 'PEDIDO');
    expect(preparacaoFinal.cotacoesExistentes).toHaveLength(2);
  });
});
