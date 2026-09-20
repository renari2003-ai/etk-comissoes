import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Permissoes, type UsuarioPublico } from '../../src/auth/tipos.js';

// Fase 4A.8 — Histórico de Fretes por Cliente. Mesmo padrão de isolamento das demais suítes
// de Fretes: Postgres real, tabelas descartáveis por teste, todas as 10 tabelas que
// `garantirEsquemaFretes()` sempre recria (inclusive as da Fase 4A.1/4A.7, mesmo não usadas
// diretamente aqui) — nunca deixa a auto-reparação de FK mexer nas tabelas reais.
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
const VENDEDOR_A = 901;
const VENDEDOR_B = 902;
const CLIENTE_A = 5001;
const CLIENTE_B = 5002;

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

async function criarCotacaoComProposta(
  servico: Awaited<ReturnType<typeof importarServico>>,
  transportadoraId: string,
  opts: {
    clienteOmieId: number;
    clienteNomeSnapshot: string;
    vendedorOmieId: number | null;
    documentoOmieTipo?: 'PEDIDO' | 'ORCAMENTO';
    valorCusto: number;
    prazoDias: number;
    origem?: string;
    destino?: string;
  },
): Promise<{ cotacaoId: string; propostaId: string }> {
  const cotacao = await servico.servicoCriarCotacao(
    {
      clienteOmieId: opts.clienteOmieId,
      pedidoOmieId: null,
      documentoOmieTipo: opts.documentoOmieTipo ?? null,
      pedidoOmieNumero: opts.documentoOmieTipo !== undefined ? `NUM-${Math.floor(Math.random() * 100000)}` : null,
      clienteNomeSnapshot: opts.clienteNomeSnapshot,
      vendedorOmieId: opts.vendedorOmieId,
      origem: opts.origem ?? 'São Paulo',
      cepOrigem: '01000-000',
      destino: opts.destino ?? 'Curitiba',
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
      transportadoraId,
      valorCusto: opts.valorCusto,
      prazoDias: opts.prazoDias,
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

describe('Fase 4A.8 — busca de clientes', () => {
  it('busca por nome (parcial) e por código Omie do cliente', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora X', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Indústria Alfa LTDA',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 500,
      prazoDias: 2,
    });
    const admin = usuarioFake({ papel: 'administrador' });

    const porNome = await servico.servicoBuscarClientesHistorico('Alfa', admin);
    expect(porNome.some((c) => c.clienteOmieId === CLIENTE_A)).toBe(true);

    const porCodigo = await servico.servicoBuscarClientesHistorico(String(CLIENTE_A), admin);
    expect(porCodigo.some((c) => c.clienteOmieId === CLIENTE_A)).toBe(true);

    const semResultado = await servico.servicoBuscarClientesHistorico('NomeQueNaoExiste123', admin);
    expect(semResultado).toEqual([]);
  });
});

describe('Fase 4A.8 — histórico só do cliente selecionado', () => {
  it('histórico de um cliente nunca inclui registros de outro cliente', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora Y', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 100,
      prazoDias: 1,
    });
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_B,
      clienteNomeSnapshot: 'Cliente B',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 200,
      prazoDias: 1,
    });
    const admin = usuarioFake({ papel: 'administrador' });

    const resultado = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A }, admin);
    expect(resultado.linhas.length).toBe(1);
    expect(resultado.linhas.every((l) => l.clienteOmieId === CLIENTE_A)).toBe(true);
  });

  it('cliente sem histórico: lista vazia e resumo com "sem dados" (nunca inventa valores)', async () => {
    const servico = await importarServico();
    const admin = usuarioFake({ papel: 'administrador' });

    const resultado = await servico.servicoListarHistoricoCliente({ clienteOmieId: 999999 }, admin);
    expect(resultado.linhas).toEqual([]);
    expect(resultado.total).toBe(0);

    const resumo = await servico.servicoResumoClienteHistorico(999999, admin);
    expect(resumo).toBeNull();
  });

  it('separa corretamente ORÇAMENTO / PEDIDO / MANUAL', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora Z', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      documentoOmieTipo: 'ORCAMENTO',
      valorCusto: 100,
      prazoDias: 1,
    });
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      documentoOmieTipo: 'PEDIDO',
      valorCusto: 150,
      prazoDias: 1,
    });
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      // sem documentoOmieTipo -> MANUAL
      valorCusto: 200,
      prazoDias: 1,
    });
    const admin = usuarioFake({ papel: 'administrador' });

    const resultado = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A }, admin);
    // `.sort()` default converte pra string ("null" vs "ORCAMENTO"/"PEDIDO") — não é a ordem
    // alfabética "esperada" de um humano, mas é determinística; comparar como conjunto evita
    // depender dessa ordem específica.
    const tipos = new Set(resultado.linhas.map((l) => l.documentoOmieTipo));
    expect(tipos).toEqual(new Set([null, 'ORCAMENTO', 'PEDIDO']));

    const somenteManual = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A, documentoOmieTipo: 'MANUAL' }, admin);
    expect(somenteManual.linhas.length).toBe(1);
    expect(somenteManual.linhas[0]?.documentoOmieTipo).toBeNull();

    const somentePedido = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A, documentoOmieTipo: 'PEDIDO' }, admin);
    expect(somentePedido.linhas.length).toBe(1);
    expect(somentePedido.linhas[0]?.documentoOmieTipo).toBe('PEDIDO');
  });

  it('ordena do mais recente para o mais antigo', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora W', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    const primeira = await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 100,
      prazoDias: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const segunda = await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 200,
      prazoDias: 1,
    });
    const admin = usuarioFake({ papel: 'administrador' });

    const resultado = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A }, admin);
    expect(resultado.linhas[0]?.propostaId).toBe(segunda.propostaId);
    expect(resultado.linhas[1]?.propostaId).toBe(primeira.propostaId);
  });
});

describe('Fase 4A.8 — permissões (regra da Fase 4A.6 preservada)', () => {
  it('vendedor não consegue visualizar histórico de outro vendedor', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora V', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 100,
      prazoDias: 1,
    });
    const outroVendedor = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: VENDEDOR_B });

    const resultado = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A }, outroVendedor);
    expect(resultado.linhas).toEqual([]);

    const resumo = await servico.servicoResumoClienteHistorico(CLIENTE_A, outroVendedor);
    expect(resumo).toBeNull();
  });

  it('admin e gerência conseguem visualizar o histórico de qualquer vendedor', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora U', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 100,
      prazoDias: 1,
    });
    const admin = usuarioFake({ papel: 'administrador' });
    const gerente = usuarioFake({ permissoes: { fretesGerencia: true } });

    const resultadoAdmin = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A }, admin);
    expect(resultadoAdmin.linhas.length).toBe(1);
    const resultadoGerente = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A }, gerente);
    expect(resultadoGerente.linhas.length).toBe(1);
  });

  it('vendedor sem vendedorOmieId vinculado nunca vê histórico de ninguém', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora T', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 100,
      prazoDias: 1,
    });
    const semVinculo = usuarioFake({ permissoes: { fretesComercial: true }, vendedorOmieId: null });

    const resultado = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A }, semVinculo);
    expect(resultado.linhas).toEqual([]);
    const clientes = await servico.servicoBuscarClientesHistorico('Cliente', semVinculo);
    expect(clientes).toEqual([]);
  });
});

describe('Fase 4A.8 — métricas e paginação', () => {
  it('calcula médias (frete base/prazo) corretamente a partir dos registros', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora Média', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 100,
      prazoDias: 2,
    });
    await criarCotacaoComProposta(servico, transportadora.id, {
      clienteOmieId: CLIENTE_A,
      clienteNomeSnapshot: 'Cliente A',
      vendedorOmieId: VENDEDOR_A,
      valorCusto: 300,
      prazoDias: 6,
    });
    const admin = usuarioFake({ papel: 'administrador' });

    const resumo = await servico.servicoResumoClienteHistorico(CLIENTE_A, admin);
    expect(resumo?.totalFretes).toBe(2);
    expect(resumo?.mediaFreteBase).toBe(200); // (100+300)/2
    expect(resumo?.prazoMedioDias).toBe(4); // (2+6)/2
    expect(resumo?.transportadoraMaisUtilizada).toBe('Transportadora Média');
  });

  it('pagina os resultados (25 por padrão, respeitando tamanhoPagina informado)', async () => {
    const servico = await importarServico();
    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transportadora Paginação', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      USUARIO_TESTE,
    );
    for (let i = 0; i < 5; i += 1) {
      await criarCotacaoComProposta(servico, transportadora.id, {
        clienteOmieId: CLIENTE_A,
        clienteNomeSnapshot: 'Cliente A',
        vendedorOmieId: VENDEDOR_A,
        valorCusto: 100 + i,
        prazoDias: 1,
      });
    }
    const admin = usuarioFake({ papel: 'administrador' });

    const pagina1 = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A, pagina: 1, tamanhoPagina: 2 }, admin);
    expect(pagina1.linhas.length).toBe(2);
    expect(pagina1.total).toBe(5);

    const pagina2 = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A, pagina: 2, tamanhoPagina: 2 }, admin);
    expect(pagina2.linhas.length).toBe(2);
    const pagina3 = await servico.servicoListarHistoricoCliente({ clienteOmieId: CLIENTE_A, pagina: 3, tamanhoPagina: 2 }, admin);
    expect(pagina3.linhas.length).toBe(1);

    // Nenhuma linha repetida entre páginas.
    const idsPagina1 = new Set(pagina1.linhas.map((l) => l.propostaId));
    const idsPagina2 = new Set(pagina2.linhas.map((l) => l.propostaId));
    expect([...idsPagina1].some((id) => idsPagina2.has(id))).toBe(false);
  });
});
