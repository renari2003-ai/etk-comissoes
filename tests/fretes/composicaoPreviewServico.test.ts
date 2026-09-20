import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Permissoes, type UsuarioPublico } from '../../src/auth/tipos.js';

// Fase 4A.7 (ajuste — simplificação da Central do Vendedor): confirma o contrato exato que a
// tela simplificada depende — "valor mínimo automático" (preview sem exigir composição
// prévia), frete base correto, ausência estrutural de acréscimo/valor final no preview, erro
// claro quando os parâmetros fiscais não estão configurados, e que "escolher frete" continua
// funcionando com acréscimo fixo em 0% (a tela não pede mais esse valor ao vendedor). Mesmo
// padrão de isolamento de `composicaoComercialServico.test.ts`.
vi.setConfig({ testTimeout: 20000 });

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
  process.env.SOLICITACOES_COTACAO_TABELA = `solicitacoes_cotacao_teste_${sufixo}`;
  process.env.RESPOSTAS_COTACAO_TABELA = `respostas_cotacao_teste_${sufixo}`;
  process.env.EXTRACOES_PROPOSTA_TABELA = `extracoes_proposta_teste_${sufixo}`;
  process.env.PARAMETROS_FISCAIS_FRETE_TABELA = `parametros_fiscais_teste_${sufixo}`;
  process.env.COMPOSICOES_COMERCIAIS_FRETE_TABELA = `composicoes_comerciais_teste_${sufixo}`;
  process.env.APROVACOES_VALOR_MINIMO_FRETE_TABELA = `aprovacoes_valor_minimo_teste_${sufixo}`;
});

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
const VENDEDOR_A = 701;

function usuarioFake(opts: { permissoes?: Partial<Permissoes>; vendedorOmieId?: number | null } = {}): UsuarioPublico {
  return {
    id: randomUUID(),
    usuario: 'teste',
    nome: 'Usuário de teste',
    papel: 'convidado',
    permissoes: { ...PERMISSOES_VAZIAS, ...opts.permissoes },
    senhaProvisoria: false,
    mestre: false,
    vendedorOmieId: opts.vendedorOmieId ?? null,
  };
}

async function prepararCenario(
  servico: Awaited<ReturnType<typeof importarServico>>,
  vendedorOmieId: number | null,
  valorCusto = 1000,
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
    { cotacaoId: cotacao.id, transportadoraId: transportadora.id, valorCusto, prazoDias: 3, validade: null, peso: null, volumes: null, origem: null, destino: null, tipoServico: null, observacoes: null },
    USUARIO_TESTE,
  );
  await servico.servicoLiberarPropostaLogistica(proposta.id, usuarioFake({ permissoes: { fretesLogistica: true } }));
  return { cotacaoId: cotacao.id, propostaId: proposta.id };
}

describe('Fase 4A.7 (ajuste) — preview automático do valor mínimo', () => {
  it('valor mínimo aparece automaticamente assim que a proposta é liberada, sem nenhuma ação extra (composição prévia)', async () => {
    const servico = await importarServico();
    await servico.servicoAtualizarParametrosFiscais({ pisPercentual: 1.65, cofinsPercentual: 7.6, icmsPercentual: 18 }, USUARIO_TESTE);
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A, 1250);

    // Nenhuma chamada de "compor"/"escolher" foi feita ainda — só liberação. O preview deve
    // funcionar de imediato, exatamente como a tela simplificada espera.
    const preview = await servico.servicoCalcularPreviewComposicao(propostaId);
    expect(preview.freteBase).toBe(1250);
    expect(preview.valorMinimo).toBeCloseTo(1718.21, 1);
  });

  it('frete base do preview é sempre o custo exato da proposta (proposta.valorCusto)', async () => {
    const servico = await importarServico();
    await servico.servicoAtualizarParametrosFiscais({ pisPercentual: 1, cofinsPercentual: 3, icmsPercentual: 18 }, USUARIO_TESTE);
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A, 777.5);

    const preview = await servico.servicoCalcularPreviewComposicao(propostaId);
    expect(preview.freteBase).toBe(777.5);
  });

  it('o preview nunca expõe acréscimo ou valor final ao cliente — só freteBase e valorMinimo (o vendedor não vê essas informações)', async () => {
    const servico = await importarServico();
    await servico.servicoAtualizarParametrosFiscais({ pisPercentual: 1, cofinsPercentual: 3, icmsPercentual: 18 }, USUARIO_TESTE);
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A);

    const preview = await servico.servicoCalcularPreviewComposicao(propostaId);
    const chaves = Object.keys(preview).sort();
    expect(chaves).toEqual(['freteBase', 'valorMinimo']);
    expect(preview).not.toHaveProperty('acrescimoPercentual');
    expect(preview).not.toHaveProperty('valorFinalCliente');
  });

  it('parâmetros fiscais ausentes geram um erro claro no preview — nunca assume 0%', async () => {
    const servico = await importarServico();
    // Nenhum servicoAtualizarParametrosFiscais chamado — alíquotas continuam null (não configuradas).
    const { propostaId } = await prepararCenario(servico, VENDEDOR_A);

    await expect(servico.servicoCalcularPreviewComposicao(propostaId)).rejects.toThrow(/não configurados/);
  });
});

describe('Fase 4A.7 (ajuste) — escolher frete sem pedir acréscimo (sempre 0% nesta tela)', () => {
  it('escolha de frete continua funcionando: acréscimo 0% + frete base cobrindo o mínimo confirma a escolha normalmente', async () => {
    const servico = await importarServico();
    // Alíquotas 0% -> valor mínimo = frete base, então acréscimo 0% sempre atinge o mínimo.
    await servico.servicoAtualizarParametrosFiscais({ pisPercentual: 0, cofinsPercentual: 0, icmsPercentual: 0 }, USUARIO_TESTE);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    const composicao = await servico.servicoRegistrarComposicaoComercial(cotacaoId, propostaId, 0, vendedor);
    expect(composicao.acrescimoPercentual).toBe(0);
    expect(composicao.valorFinalCliente).toBe(composicao.freteBase);

    const propostas = await servico.servicoListarPropostas(cotacaoId);
    expect(propostas.find((p) => p.id === propostaId)?.statusRevisao).toBe('ESCOLHIDA');
  });

  it('escolha de frete com acréscimo fixo 0% ainda bloqueia corretamente quando o frete base fica abaixo do mínimo', async () => {
    const servico = await importarServico();
    await servico.servicoAtualizarParametrosFiscais({ pisPercentual: 1.65, cofinsPercentual: 7.6, icmsPercentual: 18 }, USUARIO_TESTE);
    const { cotacaoId, propostaId } = await prepararCenario(servico, VENDEDOR_A, 1250);
    const vendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_A });

    await expect(servico.servicoRegistrarComposicaoComercial(cotacaoId, propostaId, 0, vendedor)).rejects.toThrow(
      /abaixo do mínimo permitido.*aprovação da gerência/,
    );
  });
});
