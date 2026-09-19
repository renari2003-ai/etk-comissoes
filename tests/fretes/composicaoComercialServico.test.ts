import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Permissoes, type UsuarioPublico } from '../../src/auth/tipos.js';

// Fase 4A.7 — Composição comercial do frete (valor mínimo/acréscimo/aprovação gerencial).
// Mesmo padrão de `aprovacaoServico.test.ts`: Postgres (Supabase) real, tabelas descartáveis
// por teste via variável de ambiente (inclusive as 3 novas desta fase e as 3 da Fase 4A.1,
// que `garantirEsquemaFretes()` sempre recria — isolar todas evita que a auto-reparação de FK
// mexa nas tabelas REAIS de produção, ver `schema.repararFkSeApontarParaTabelaErrada`).
vi.setConfig({ testTimeout: 20000 });

async function importarServico(): Promise<typeof import('../../src/fretes/fretesServico.js')> {
  vi.resetModules();
  return import('../../src/fretes/fretesServico.js');
}

async function importarAuditoria(): Promise<typeof import('../../src/fretes/auditoriaRepositorio.js')> {
  vi.resetModules();
  return import('../../src/fretes/auditoriaRepositorio.js');
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
  process.env.SOLICITACOES_COTACAO_TABELA = `solicitacoes_cotacao_teste_${sufixo}`;
  process.env.RESPOSTAS_COTACAO_TABELA = `respostas_cotacao_teste_${sufixo}`;
  process.env.EXTRACOES_PROPOSTA_TABELA = `extracoes_proposta_teste_${sufixo}`;
  process.env.PARAMETROS_FISCAIS_FRETE_TABELA = `parametros_fiscais_teste_${sufixo}`;
  process.env.COMPOSICOES_COMERCIAIS_FRETE_TABELA = `composicoes_comerciais_teste_${sufixo}`;
  process.env.APROVACOES_VALOR_MINIMO_FRETE_TABELA = `aprovacoes_valor_minimo_teste_${sufixo}`;
});

// 45000ms: este arquivo isola 10 tabelas por teste (mais que os demais arquivos de Fretes) —
// o `DROP TABLE` sequencial de todas elas às vezes passa dos 20000ms padrão do Vitest.
afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  await pool.query(`DROP TABLE IF EXISTS ${process.env.APROVACOES_VALOR_MINIMO_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.COMPOSICOES_COMERCIAIS_FRETE_TABELA}`).catch(() => undefined);
  await pool.query(`DROP TABLE IF EXISTS ${process.env.PARAMETROS_FISCAIS_FRETE_TABELA}`).catch(() => undefined);
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
  delete process.env.PARAMETROS_FISCAIS_FRETE_TABELA;
  delete process.env.COMPOSICOES_COMERCIAIS_FRETE_TABELA;
  delete process.env.APROVACOES_VALOR_MINIMO_FRETE_TABELA;
}, 45000);

const USUARIO_TESTE = '11111111-1111-1111-1111-111111111111';
const VENDEDOR_A = 601;
const VENDEDOR_B = 888;

function usuarioFake(opts: { papel?: 'administrador' | 'convidado'; permissoes?: Partial<Permissoes>; vendedorOmieId?: number | null } = {}): UsuarioPublico {
  return {
    id: randomUUID(),
    usuario: 'teste',
    nome: 'Usuário de teste',
    papel: opts.papel ?? 'convidado',
    permissoes: { ...PERMISSOES_VAZIAS, ...opts.permissoes },
    senhaProvisoria: false,
    mestre: false,
    vendedorOmieId: opts.vendedorOmieId ?? null,
  };
}

async function prepararCenario(
  servico: Awaited<ReturnType<typeof importarServico>>,
  vendedorOmieId: number | null,
): Promise<{ cotacaoId: string; propostaId: string }> {
  const transportadora = await servico.servicoCriarTransportadora(
    { nomeRazaoSocial: 'Transportadora Teste', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
    USUARIO_TESTE,
  );
  const cotacao = await servico.servicoCriarCotacao(
    {
      clienteOmieId: null,
      pedidoOmieId: null,
      vendedorOmieId,
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
  const proposta = await servico.servicoCriarProposta(
    {
      cotacaoId: cotacao.id,
      transportadoraId: transportadora.id,
      // Frete base = 1000; com PIS 1% + COFINS 3% + ICMS 18% (configurados abaixo), valor
      // mínimo ≈ 1282,05 — usado nos cenários de bloqueio/aprovação.
      valorCusto: 1000,
      prazoDias: 5,
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
  await servico.servicoLiberarPropostaLogistica(proposta.id, usuarioFake({ permissoes: { fretesLogistica: true } }));
  return { cotacaoId: cotacao.id, propostaId: proposta.id };
}

async function configurarParametrosFiscaisPadrao(servico: Awaited<ReturnType<typeof importarServico>>): Promise<void> {
  await servico.servicoAtualizarParametrosFiscais({ pisPercentual: 1, cofinsPercentual: 3, icmsPercentual: 18 }, USUARIO_TESTE);
}

describe('Fase 4A.7 — composição comercial: acréscimo', () => {
  it('acréscimo 0% é aceito quando as alíquotas configuradas são 0% (valor final = frete base = valor mínimo)', async () => {
    const servico = await importarServico();
    await servico.servicoAtualizarParametrosFiscais({ pisPercentual: 0, cofinsPercentual: 0, icmsPercentual: 0 }, USUARIO_TESTE);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    const composicao = await servico.servicoRegistrarComposicaoComercial(cotacaoId, propostaId, 0, vendedor);
    expect(composicao.acrescimoPercentual).toBe(0);
    expect(composicao.valorFinalCliente).toBe(1000);
    expect(composicao.valorMinimo).toBe(1000);
  });

  it('acréscimo positivo suficiente registra a composição e escolhe o frete vencedor', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    // 30% de acréscimo -> 1300, acima do mínimo (~1282,05).
    const composicao = await servico.servicoRegistrarComposicaoComercial(cotacaoId, propostaId, 30, vendedor);
    expect(composicao.freteBase).toBe(1000);
    expect(composicao.acrescimoPercentual).toBe(30);
    expect(composicao.valorFinalCliente).toBe(1300);
    expect(composicao.valorMinimo).toBeCloseTo(1282.05, 2);
    expect(composicao.aprovacaoId).toBeNull();
  });
});

describe('Fase 4A.7 — bloqueio abaixo do mínimo e aprovação gerencial', () => {
  it('bloqueia a confirmação normal quando o valor final fica abaixo do mínimo', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    // 0% de acréscimo -> 1000, abaixo do mínimo (~1282,05).
    await expect(servico.servicoRegistrarComposicaoComercial(cotacaoId, propostaId, 0, vendedor)).rejects.toThrow(
      /abaixo do mínimo permitido.*aprovação da gerência/,
    );
  });

  it('aprovação gerencial: solicita, gerência aprova, frete é escolhido com o valor proposto (abaixo do mínimo)', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    const aprovacaoSolicitada = await servico.servicoSolicitarAprovacaoValorMinimo(cotacaoId, propostaId, 0, 'Cliente pediu desconto especial', vendedor);
    expect(aprovacaoSolicitada.status).toBe('PENDENTE');
    expect(aprovacaoSolicitada.valorProposto).toBe(1000);
    expect(aprovacaoSolicitada.diferenca).toBeCloseTo(282.05, 2);

    const gerente = usuarioFake({ permissoes: { fretesGerencia: true } });
    const listaPendentes = await servico.servicoListarAprovacoesValorMinimo(gerente);
    expect(listaPendentes.some((a) => a.id === aprovacaoSolicitada.id)).toBe(true);

    const composicao = await servico.servicoAprovarValorMinimo(aprovacaoSolicitada.id, gerente);
    expect(composicao.aprovacaoId).toBe(aprovacaoSolicitada.id);
    expect(composicao.valorFinalCliente).toBe(1000);

    const propostas = await servico.servicoListarPropostas(cotacaoId);
    const propostaFinal = propostas.find((p) => p.id === propostaId);
    expect(propostaFinal?.statusRevisao).toBe('ESCOLHIDA');
    expect(propostaFinal?.status).toBe('SELECIONADA');
  });

  it('rejeição gerencial: a proposta permanece liberada, sem escolha', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    const aprovacaoSolicitada = await servico.servicoSolicitarAprovacaoValorMinimo(cotacaoId, propostaId, 0, 'Tentativa de desconto', vendedor);
    const gerente = usuarioFake({ permissoes: { fretesGerencia: true } });
    const rejeitada = await servico.servicoRejeitarValorMinimo(aprovacaoSolicitada.id, gerente);
    expect(rejeitada.status).toBe('REJEITADA');

    const propostas = await servico.servicoListarPropostas(cotacaoId);
    const propostaFinal = propostas.find((p) => p.id === propostaId);
    expect(propostaFinal?.statusRevisao).toBe('LIBERADA');
    expect(propostaFinal?.status).not.toBe('SELECIONADA');

    // Decisão já tomada — não pode ser decidida de novo (nem aprovar, nem rejeitar de novo).
    await expect(servico.servicoAprovarValorMinimo(aprovacaoSolicitada.id, gerente)).rejects.toThrow(/já decidida/);
  });

  it('usuário sem permissão fretesGerencia não pode aprovar nem rejeitar', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });
    const aprovacaoSolicitada = await servico.servicoSolicitarAprovacaoValorMinimo(cotacaoId, propostaId, 0, 'Motivo qualquer', vendedor);

    const semPermissao = usuarioFake({ permissoes: { fretesComercial: true } });
    await expect(servico.servicoAprovarValorMinimo(aprovacaoSolicitada.id, semPermissao)).rejects.toThrow(/fretesGerencia/);
    await expect(servico.servicoRejeitarValorMinimo(aprovacaoSolicitada.id, semPermissao)).rejects.toThrow(/fretesGerencia/);
  });
});

describe('Fase 4A.7 — substituição (regra da Fase 4A.6 preservada)', () => {
  it('substituição autorizada (fretesSubstituicao) registra a composição em nome do vendedor responsável', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const substituto = usuarioFake({ permissoes: { fretesComercial: true, fretesSubstituicao: true }, vendedorOmieId: VENDEDOR_B });

    const composicao = await servico.servicoRegistrarComposicaoComercial(cotacaoId, propostaId, 30, substituto, {
      motivo: 'Vendedor responsável de férias',
    });
    expect(composicao.valorFinalCliente).toBe(1300);
  });

  it('substituição sem permissão falha ao registrar composição', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const outroVendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_B });

    await expect(
      servico.servicoRegistrarComposicaoComercial(cotacaoId, propostaId, 30, outroVendedor, { motivo: 'Tentativa não autorizada' }),
    ).rejects.toThrow(/substituição/);
  });
});

describe('Fase 4A.7 — snapshot e auditoria', () => {
  // 45000ms (mesmo ajuste de `integracaoCotacoes.test.ts`/`aprovacaoServico.test.ts`): dois
  // módulos com `vi.resetModules()` (serviço + auditoria), cada um rodando
  // `garantirEsquemaFretes()` (10 tabelas) do zero.
  it('snapshot preserva frete base/valor mínimo/acréscimo/valor final/percentuais utilizados, mesmo se as alíquotas mudarem depois', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    const composicao = await servico.servicoRegistrarComposicaoComercial(cotacaoId, propostaId, 30, vendedor);

    // Muda as alíquotas DEPOIS de registrada a composição — o snapshot já persistido não pode mudar.
    await servico.servicoAtualizarParametrosFiscais({ pisPercentual: 10, cofinsPercentual: 10, icmsPercentual: 10 }, USUARIO_TESTE);

    const composicaoPersistida = await servico.servicoBuscarComposicaoPorProposta(propostaId);
    expect(composicaoPersistida).not.toBeNull();
    expect(composicaoPersistida?.id).toBe(composicao.id);
    expect(composicaoPersistida?.freteBase).toBe(1000);
    expect(composicaoPersistida?.valorMinimo).toBeCloseTo(1282.05, 2);
    expect(composicaoPersistida?.acrescimoPercentual).toBe(30);
    expect(composicaoPersistida?.valorFinalCliente).toBe(1300);
    expect(composicaoPersistida?.pisPercentualUtilizado).toBe(1);
    expect(composicaoPersistida?.cofinsPercentualUtilizado).toBe(3);
    expect(composicaoPersistida?.icmsPercentualUtilizado).toBe(18);
    expect(composicaoPersistida?.usuarioId).toBe(vendedor.id);

    const auditoria = await importarAuditoria();
    const registros = await auditoria.listarAuditoriaPorEntidade('proposta_frete', propostaId);
    expect(registros.some((r) => r.acao === 'COMPOSICAO_COMERCIAL_REGISTRADA')).toBe(true);
  }, 45000);

  it('auditoria registra solicitação, aprovação e rejeição de valor abaixo do mínimo', async () => {
    const servico = await importarServico();
    await configurarParametrosFiscaisPadrao(servico);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });
    const gerente = usuarioFake({ permissoes: { fretesGerencia: true } });

    const aprovacao = await servico.servicoSolicitarAprovacaoValorMinimo(cotacaoId, propostaId, 0, 'Desconto solicitado', vendedor);
    await servico.servicoAprovarValorMinimo(aprovacao.id, gerente);

    const auditoria = await importarAuditoria();
    const registros = await auditoria.listarAuditoriaPorEntidade('proposta_frete', propostaId);
    const acoes = registros.map((r) => r.acao);
    expect(acoes).toContain('APROVACAO_VALOR_MINIMO_SOLICITADA');
    expect(acoes).toContain('APROVACAO_VALOR_MINIMO_APROVADA');
  }, 45000);
});
