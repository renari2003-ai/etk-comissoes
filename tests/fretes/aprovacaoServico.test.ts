import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Permissoes, type UsuarioPublico } from '../../src/auth/tipos.js';

// Fase 4A.6 — Central da Logística + Central do Vendedor. Mesmo padrão de
// `fretesServico.test.ts`: Postgres (Supabase) real, tabelas descartáveis por teste via
// variável de ambiente, `vi.resetModules()` + `import()` dinâmico. `garantirEsquemaFretes()`
// roda o esquema INTEIRO do módulo (inclusive solicitações/respostas/extrações da Fase 4A.1,
// mesmo este arquivo nunca as usando) — por isso isola TAMBÉM essas 3 tabelas (mesmo padrão
// de `integracaoCotacoes.test.ts`), nunca deixando a auto-reparação de FK
// (`repararFkSeApontarParaTabelaErrada`, schema.ts) mexer nas tabelas REAIS de produção.
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
const VENDEDOR_A = 501;
const VENDEDOR_B = 777;

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
  return { cotacaoId: cotacao.id, propostaId: proposta.id };
}

describe('Fase 4A.6 — Central da Logística', () => {
  it('logística libera proposta: statusRevisao vai de AGUARDANDO_LOGISTICA para LIBERADA', async () => {
    const servico = await importarServico();
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const logistica = usuarioFake({ permissoes: { fretesLogistica: true } });

    const liberada = await servico.servicoLiberarPropostaLogistica(propostaId, logistica);
    expect(liberada.statusRevisao).toBe('LIBERADA');
  });

  it('rejeita liberar/descartar sem a permissão fretesLogistica', async () => {
    const servico = await importarServico();
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const semPermissao = usuarioFake();

    await expect(servico.servicoLiberarPropostaLogistica(propostaId, semPermissao)).rejects.toThrow(/fretesLogistica/);
    await expect(servico.servicoDescartarPropostaLogistica(propostaId, semPermissao)).rejects.toThrow(/fretesLogistica/);
  });
});

describe('Fase 4A.6 — Central do Vendedor: visibilidade', () => {
  it('vendedor correto visualiza a proposta liberada', async () => {
    const servico = await importarServico();
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const logistica = usuarioFake({ permissoes: { fretesLogistica: true } });
    await servico.servicoLiberarPropostaLogistica(propostaId, logistica);

    const vendedorDono = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });
    const linhas = await servico.servicoListarCentralVendedor(vendedorDono);
    expect(linhas.some((l) => l.proposta.id === propostaId)).toBe(true);
  });

  it('vendedor errado NÃO visualiza a proposta de outro vendedor', async () => {
    const servico = await importarServico();
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const logistica = usuarioFake({ permissoes: { fretesLogistica: true } });
    await servico.servicoLiberarPropostaLogistica(propostaId, logistica);

    const outroVendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_B });
    const linhas = await servico.servicoListarCentralVendedor(outroVendedor);
    expect(linhas.some((l) => l.proposta.id === propostaId)).toBe(false);
  });

  it('gerência (fretesGerencia) vê propostas de qualquer vendedor — visão ampliada', async () => {
    const servico = await importarServico();
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const logistica = usuarioFake({ permissoes: { fretesLogistica: true } });
    await servico.servicoLiberarPropostaLogistica(propostaId, logistica);

    const gerente = usuarioFake({ permissoes: { fretesGerencia: true }, vendedorOmieId: VENDEDOR_B });
    const linhas = await servico.servicoListarCentralVendedor(gerente);
    expect(linhas.some((l) => l.proposta.id === propostaId)).toBe(true);
  });
});

describe('Fase 4A.6 — Central do Vendedor: escolha do frete vencedor', () => {
  it('vendedor escolhe a proposta vencedora (já liberada) — statusRevisao vira ESCOLHIDA', async () => {
    const servico = await importarServico();
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const logistica = usuarioFake({ permissoes: { fretesLogistica: true } });
    await servico.servicoLiberarPropostaLogistica(propostaId, logistica);

    const vendedorDono = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });
    const escolhida = await servico.servicoEscolherFreteVencedor(cotacaoId, propostaId, vendedorDono);
    expect(escolhida.statusRevisao).toBe('ESCOLHIDA');
    expect(escolhida.status).toBe('SELECIONADA');
  });

  it('rejeita escolher uma proposta ainda não liberada pela Logística', async () => {
    const servico = await importarServico();
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedorDono = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });
    await expect(servico.servicoEscolherFreteVencedor(cotacaoId, propostaId, vendedorDono)).rejects.toThrow(/ainda não foi liberada/);
  });

  it('usuário com ambas as permissões (fretesLogistica + fretesComercial) faz as duas etapas sozinho', async () => {
    const servico = await importarServico();
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const ambasPermissoes = usuarioFake({ permissoes: { fretesLogistica: true, fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    const liberada = await servico.servicoLiberarPropostaLogistica(propostaId, ambasPermissoes);
    expect(liberada.statusRevisao).toBe('LIBERADA');

    const negociando = await servico.servicoMarcarPropostaEmNegociacao(cotacaoId, propostaId, ambasPermissoes);
    expect(negociando.statusRevisao).toBe('EM_NEGOCIACAO');

    const escolhida = await servico.servicoEscolherFreteVencedor(cotacaoId, propostaId, ambasPermissoes);
    expect(escolhida.statusRevisao).toBe('ESCOLHIDA');
  });

  it('substituição autorizada (fretesSubstituicao) funciona e exige motivo', async () => {
    const servico = await importarServico();
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const logistica = usuarioFake({ permissoes: { fretesLogistica: true } });
    await servico.servicoLiberarPropostaLogistica(propostaId, logistica);

    const substituto = usuarioFake({ permissoes: { fretesComercial: true, fretesSubstituicao: true }, vendedorOmieId: VENDEDOR_B });

    // Sem motivo: rejeita explicitamente.
    await expect(servico.servicoEscolherFreteVencedor(cotacaoId, propostaId, substituto)).rejects.toThrow(/motivo/);

    // Com motivo: funciona.
    const escolhida = await servico.servicoEscolherFreteVencedor(cotacaoId, propostaId, substituto, { motivo: 'Vendedor responsável em férias' });
    expect(escolhida.statusRevisao).toBe('ESCOLHIDA');
  });

  it('substituição SEM permissão falha (mesmo com fretesComercial, sem fretesSubstituicao)', async () => {
    const servico = await importarServico();
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const logistica = usuarioFake({ permissoes: { fretesLogistica: true } });
    await servico.servicoLiberarPropostaLogistica(propostaId, logistica);

    const outroVendedorSemSubstituicao = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_B });
    await expect(
      servico.servicoEscolherFreteVencedor(cotacaoId, propostaId, outroVendedorSemSubstituicao, { motivo: 'Tentativa não autorizada' }),
    ).rejects.toThrow(/substituição/);
  });

  // 45000ms (mesmo ajuste de `integracaoCotacoes.test.ts`, Fase 4A.4.1): este teste importa
  // dois módulos com `vi.resetModules()` (serviço + auditoria), cada um rodando
  // `garantirEsquemaFretes()` (7 tabelas) do zero — mais round-trips que os demais testes
  // deste arquivo, passa dos 20000ms padrão do Vitest sob rede mais lenta.
  it('auditoria registrada: liberação e escolha (com substituição) ficam no histórico da proposta', async () => {
    const servico = await importarServico();
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const logistica = usuarioFake({ permissoes: { fretesLogistica: true } });
    await servico.servicoLiberarPropostaLogistica(propostaId, logistica);

    const substituto = usuarioFake({ permissoes: { fretesComercial: true, fretesSubstituicao: true }, vendedorOmieId: VENDEDOR_B });
    await servico.servicoEscolherFreteVencedor(cotacaoId, propostaId, substituto, { motivo: 'Vendedor responsável em férias' });

    const auditoria = await importarAuditoria();
    const registros = await auditoria.listarAuditoriaPorEntidade('proposta_frete', propostaId);
    const acoes = registros.map((r) => r.acao);
    expect(acoes).toContain('PROPOSTA_LIBERADA_LOGISTICA');
    expect(acoes).toContain('PROPOSTA_SELECIONADA');

    const registroSubstituicao = registros.find(
      (r) => r.acao === 'PROPOSTA_SELECIONADA' && (r.valorNovo as { substituicao?: boolean } | null)?.substituicao === true,
    );
    expect(registroSubstituicao).toBeDefined();
    const detalhes = registroSubstituicao?.valorNovo as { vendedorResponsavelOmieId: number; usuarioResponsavelId: string; motivo: string };
    expect(detalhes.vendedorResponsavelOmieId).toBe(VENDEDOR_A);
    expect(detalhes.usuarioResponsavelId).toBe(substituto.id);
    expect(detalhes.motivo).toBe('Vendedor responsável em férias');
  }, 45000);
});
