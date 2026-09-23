import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import {
  canaisDisponiveis,
  canalSugerido,
  escolherCanonicasPorCnpj,
  paraTransportadoraBusca,
  servicoEnviarSolicitacoes,
  type DependenciasEnvio,
  type ItemEnvioSolicitacao,
} from '../../src/fretes/envioSolicitacoesServico.js';
import { ErroDadosCotacaoIncompletos } from '../../src/fretes/braspressServico.js';
import { ErroValidacao } from '../../src/validacao.js';
import type { CotacaoFrete, SolicitacaoCotacao, Transportadora } from '../../src/fretes/tipos.js';
import { droparTabelasRemanescentes, isolarTabelasComerciais, limparTabelasComerciais } from './isolamentoTabelasComerciais.js';

// Envio único do detalhe da cotação: canais disponíveis, dedupe por CNPJ e despacho para os
// serviços EXISTENTES (mockados aqui — nenhuma chamada real a n8n/Braspress/Omie).
vi.setConfig({ testTimeout: 30000 });

const USUARIO_TESTE = '11111111-1111-1111-1111-111111111111';
const COTACAO_ID = '22222222-2222-2222-2222-222222222222';
const cliente = {} as ClienteOmie;

function transportadora(parcial: Partial<Transportadora> & { id: string; nomeRazaoSocial: string }): Transportadora {
  return {
    nomeFantasia: null,
    cnpj: null,
    email: null,
    telefone: null,
    contato: null,
    ativo: true,
    observacoes: null,
    codigoClienteOmie: null,
    canalPrincipal: null,
    urlPortal: null,
    whatsappCotacao: null,
    criadoEm: '2026-01-01T00:00:00.000Z',
    atualizadoEm: '2026-01-01T00:00:00.000Z',
    ...parcial,
  };
}

const BRASPRESS = transportadora({ id: 'b0000000-0000-0000-0000-000000000001', nomeRazaoSocial: 'BRASPRESS TRANSPORTES URGENTES LTDA', nomeFantasia: 'BRASPRESS' });
const XYZ = transportadora({ id: 'b0000000-0000-0000-0000-000000000002', nomeRazaoSocial: 'Transportes XYZ', codigoClienteOmie: 555 });
const ABC = transportadora({
  id: 'b0000000-0000-0000-0000-000000000003',
  nomeRazaoSocial: 'Transportadora ABC',
  telefone: '(11) 99999-0000',
  canalPrincipal: 'WHATSAPP',
});

describe('canais disponíveis', () => {
  it('API só para Braspress; urlPortal/canalPrincipal SITE/API nunca viram API', () => {
    expect(canaisDisponiveis(BRASPRESS)).toEqual(['API']);
    const comPortal = transportadora({ id: 'x', nomeRazaoSocial: 'Patrus', urlPortal: 'https://portal', canalPrincipal: 'API' });
    expect(canaisDisponiveis(comPortal)).toEqual([]);
  });

  it('EMAIL com e-mail para cotação válido no cadastro ETK ou código Omie (MANUAL > CADASTRO > OMIE); e-mail inválido não conta', () => {
    expect(canaisDisponiveis(XYZ)).toEqual(['EMAIL']);
    expect(canaisDisponiveis(transportadora({ id: 'y', nomeRazaoSocial: 'Só cadastro', email: 'cotacao@b.com.br' }))).toEqual(['EMAIL']);
    expect(canaisDisponiveis(transportadora({ id: 'w', nomeRazaoSocial: 'E-mail ruim', email: 'nao-e-email' }))).toEqual([]);
  });

  it('WHATSAPP só com whatsappCotacao válido (10 a 13 dígitos): telefone comum ou canalPrincipal nunca liberam; número inválido não conta', () => {
    expect(canaisDisponiveis(ABC)).toEqual([]);
    expect(canaisDisponiveis({ ...ABC, whatsappCotacao: '11999990000' })).toEqual(['WHATSAPP']);
    expect(canaisDisponiveis({ ...ABC, whatsappCotacao: '5511999990000' })).toEqual(['WHATSAPP']);
    expect(canaisDisponiveis({ ...ABC, whatsappCotacao: '999' })).toEqual([]);
    expect(canaisDisponiveis({ ...ABC, whatsappCotacao: '(11) 99999-0000' })).toEqual([]);
    expect(canaisDisponiveis({ ...XYZ, whatsappCotacao: '11999990000' })).toEqual(['EMAIL', 'WHATSAPP']);
  });

  it('canal sugerido: único canal → ele; vários → canalPrincipal válido; senão null (operador escolhe)', () => {
    expect(canalSugerido(BRASPRESS, ['API'])).toBe('API');
    const ambos = transportadora({ id: 'z', nomeRazaoSocial: 'Braspress Filial', codigoClienteOmie: 1 });
    expect(canalSugerido(ambos, ['EMAIL', 'API'])).toBeNull();
    expect(canalSugerido({ ...ambos, canalPrincipal: 'API' }, ['EMAIL', 'API'])).toBe('API');
    expect(canalSugerido({ ...ambos, canalPrincipal: 'SITE' }, ['EMAIL', 'API'])).toBeNull();
  });

  it('canal principal exposto na busca (para o "*"): só EMAIL/WHATSAPP/API; SITE ou vazio → null', () => {
    const ambos = transportadora({ id: 'z', nomeRazaoSocial: 'Braspress Filial', codigoClienteOmie: 1 });
    expect(paraTransportadoraBusca({ ...ambos, canalPrincipal: 'EMAIL' })).toMatchObject({ canalPrincipal: 'EMAIL', canalSugerido: 'EMAIL' });
    expect(paraTransportadoraBusca({ ...ambos, canalPrincipal: 'SITE' })).toMatchObject({ canalPrincipal: null, canalSugerido: null });
    expect(paraTransportadoraBusca(ambos).canalPrincipal).toBeNull();
  });
});

describe('dedupe por CNPJ normalizado (sem apagar nada)', () => {
  it('mesmo CNPJ com/sem máscara vira um só resultado; escolha canônica determinística; sem CNPJ nunca agrupa', () => {
    const antigo = transportadora({ id: 'a1', nomeRazaoSocial: 'HOMOLOGAÇÃO A', cnpj: '11.222.333/0001-81', criadoEm: '2026-01-01T00:00:00.000Z' });
    const novoComOmie = transportadora({ id: 'a2', nomeRazaoSocial: 'HOMOLOGAÇÃO B', cnpj: '11222333000181', criadoEm: '2026-02-01T00:00:00.000Z', codigoClienteOmie: 9 });
    const semCnpj1 = transportadora({ id: 'c1', nomeRazaoSocial: 'Mesmo Nome' });
    const semCnpj2 = transportadora({ id: 'c2', nomeRazaoSocial: 'Mesmo Nome' });
    const r = escolherCanonicasPorCnpj([antigo, novoComOmie, semCnpj1, semCnpj2]);
    expect(r.map((t) => t.id)).toEqual(['a2', 'c1', 'c2']);
    // mesma entrada em outra ordem → mesma escolha
    expect(escolherCanonicasPorCnpj([novoComOmie, antigo]).map((t) => t.id)).toEqual(['a2']);
    // sem código Omie em nenhum: o mais antigo vence
    expect(escolherCanonicasPorCnpj([{ ...novoComOmie, codigoClienteOmie: null }, antigo]).map((t) => t.id)).toEqual(['a1']);
  });
});

describe('orquestrador de envio (serviços existentes mockados)', () => {
  function cotacao(parcial: Partial<CotacaoFrete> = {}): CotacaoFrete {
    return { id: COTACAO_ID, codigo: 'FR-1', status: 'AGUARDANDO_PROPOSTAS', modalidadeExecucao: 'TRANSPORTADORA', ...parcial } as CotacaoFrete;
  }

  function deps(extra: Partial<DependenciasEnvio> = {}) {
    const cadastro = new Map([BRASPRESS, XYZ, ABC].map((t) => [t.id, t]));
    const d = {
      buscarCotacao: vi.fn(async () => cotacao()),
      buscarTransportadora: vi.fn(async (id: string) => cadastro.get(id) ?? null),
      listarSolicitacoes: vi.fn(async () => [] as SolicitacaoCotacao[]),
      solicitar: vi.fn(async (_c: unknown, _cot: string, itens: { transportadoraId: string }[], canal: string) => [
        { id: `sol-${itens[0]?.transportadoraId}`, status: 'ENVIADA', emailDestino: canal === 'EMAIL' ? 'cotacao@xyz.com.br' : null } as SolicitacaoCotacao,
      ]),
      cotarBraspress: vi.fn(async () => ({
        cotacaoExterna: { transportadora: 'BRASPRESS' as const, idCotacaoExterna: '99', valorFrete: 321.5, prazoDias: 4, validade: null },
        proposta: { id: 'prop-1' },
        duplicada: false,
      })),
      ...extra,
    };
    return d as unknown as DependenciasEnvio & typeof d;
  }

  const CUBAGEM = [
    { altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 5 },
    { altura: 1.2, largura: 0.8, comprimento: 1, volumes: 2 },
  ];

  it('limite de 7 e duplicidade: recusados no servidor antes de qualquer envio', async () => {
    const d = deps();
    const oito: ItemEnvioSolicitacao[] = Array.from({ length: 8 }, (_, i) => ({
      transportadoraId: `c0000000-0000-0000-0000-00000000000${i}`,
      canal: 'EMAIL',
      emailManual: null,
    }));
    await expect(servicoEnviarSolicitacoes(cliente, COTACAO_ID, oito, null, USUARIO_TESTE, d)).rejects.toThrow(/no máximo 7/);
    const repetida: ItemEnvioSolicitacao[] = [
      { transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null },
      { transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null },
    ];
    await expect(servicoEnviarSolicitacoes(cliente, COTACAO_ID, repetida, null, USUARIO_TESTE, d)).rejects.toThrow(/mais de uma vez/);
    await expect(servicoEnviarSolicitacoes(cliente, COTACAO_ID, [], null, USUARIO_TESTE, d)).rejects.toBeInstanceOf(ErroValidacao);
    expect(d.solicitar).not.toHaveBeenCalled();
    expect(d.cotarBraspress).not.toHaveBeenCalled();
  });

  it('canal obrigatório: qualquer transportadora sem canal bloqueia TODO o envio (nada despachado) e diz qual está sem canal', async () => {
    const d = deps();
    const itens: ItemEnvioSolicitacao[] = [
      { transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null },
      { transportadoraId: XYZ.id, canal: null, emailManual: null },
    ];
    const envio = servicoEnviarSolicitacoes(cliente, COTACAO_ID, itens, CUBAGEM, USUARIO_TESTE, d);
    await expect(envio).rejects.toBeInstanceOf(ErroValidacao);
    await expect(servicoEnviarSolicitacoes(cliente, COTACAO_ID, itens, CUBAGEM, USUARIO_TESTE, d)).rejects.toThrow(
      'Selecione o canal de envio para todas as transportadoras. Sem canal: Transportes XYZ.',
    );
    const invalido = [{ transportadoraId: XYZ.id, canal: 'SITE', emailManual: null }] as unknown as ItemEnvioSolicitacao[];
    await expect(servicoEnviarSolicitacoes(cliente, COTACAO_ID, invalido, null, USUARIO_TESTE, d)).rejects.toThrow(/Selecione o canal de envio/);
    expect(d.cotarBraspress).not.toHaveBeenCalled();
    expect(d.solicitar).not.toHaveBeenCalled();
  });

  it('despacha cada canal ao serviço existente e devolve resultado individual; falha de uma não impede as outras', async () => {
    const d = deps();
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [
        { transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null },
        { transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: 'manual@xyz.com.br' },
        { transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: null },
      ],
      CUBAGEM,
      USUARIO_TESTE,
      d,
    );
    // API → integração Braspress existente, com TODAS as embalagens (volumes = soma calculada lá)
    expect(d.cotarBraspress).toHaveBeenCalledTimes(1);
    expect(d.cotarBraspress).toHaveBeenCalledWith(cliente, COTACAO_ID, { cepOrigem: null, cubagem: CUBAGEM }, USUARIO_TESTE);
    // EMAIL → fluxo de solicitação existente (resolução MANUAL > OMIE acontece lá)
    expect(d.solicitar).toHaveBeenCalledTimes(1);
    expect(d.solicitar).toHaveBeenCalledWith(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, emailManual: 'manual@xyz.com.br' }], 'EMAIL', USUARIO_TESTE);
    expect(r).toEqual([
      expect.objectContaining({ transportadora: 'BRASPRESS', canal: 'API', status: 'ENVIADO', propostaId: 'prop-1' }),
      expect.objectContaining({ transportadora: 'Transportes XYZ', canal: 'EMAIL', status: 'ENVIADO', solicitacaoId: `sol-${XYZ.id}` }),
      expect.objectContaining({ transportadora: 'Transportadora ABC', canal: 'WHATSAPP', status: 'FALHOU', mensagem: 'WhatsApp não disponível para esta transportadora.' }),
    ]);
  });

  it('canal não disponível é recusado no servidor (nunca confia no navegador): API para não-Braspress, EMAIL sem Omie', async () => {
    const d = deps();
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [
        { transportadoraId: XYZ.id, canal: 'API', emailManual: null },
        { transportadoraId: BRASPRESS.id, canal: 'EMAIL', emailManual: 'x@y.com' },
      ],
      CUBAGEM,
      USUARIO_TESTE,
      d,
    );
    expect(r.map((x) => [x.status, x.mensagem])).toEqual([
      ['FALHOU', 'API não disponível para esta transportadora.'],
      ['FALHOU', 'E-mail não disponível para esta transportadora.'],
    ]);
    expect(d.cotarBraspress).not.toHaveBeenCalled();
    expect(d.solicitar).not.toHaveBeenCalled();
  });

  it('erros dos serviços viram FALHOU com a mensagem explícita (Braspress sem dimensões, e-mail não cadastrado, envio n8n com erro)', async () => {
    const d = deps({
      cotarBraspress: vi.fn(async () => {
        throw new ErroDadosCotacaoIncompletos(['cubagem (altura, largura e comprimento em metros)']);
      }) as unknown as DependenciasEnvio['cotarBraspress'],
      solicitar: vi.fn(async () => {
        throw new ErroValidacao('EMAIL_TRANSPORTADORA_NAO_CADASTRADO: nenhum e-mail disponível para "Transportes XYZ".');
      }) as unknown as DependenciasEnvio['solicitar'],
    });
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [
        { transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null },
        { transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null },
      ],
      null,
      USUARIO_TESTE,
      d,
    );
    expect(r[0]).toMatchObject({ status: 'FALHOU', mensagem: expect.stringContaining('cubagem') });
    expect(r[1]).toMatchObject({ status: 'FALHOU', mensagem: expect.stringContaining('EMAIL_TRANSPORTADORA_NAO_CADASTRADO') });

    const comErroN8n = deps({
      solicitar: vi.fn(async () => [{ id: 'sol-erro', status: 'ERRO', emailDestino: 'a@b.com' } as SolicitacaoCotacao]) as unknown as DependenciasEnvio['solicitar'],
    });
    const [n8n] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null }], null, USUARIO_TESTE, comErroN8n);
    expect(n8n).toMatchObject({ status: 'FALHOU', solicitacaoId: 'sol-erro', mensagem: expect.stringContaining('Reenviar') });
  });

  it('WHATSAPP com número válido é despachado ao fluxo n8n existente (canal WHATSAPP, sem e-mail manual)', async () => {
    const comWhatsapp = { ...ABC, whatsappCotacao: '11999990000' };
    const d = deps({ buscarTransportadora: vi.fn(async () => comWhatsapp) as unknown as DependenciasEnvio['buscarTransportadora'] });
    const [r] = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [{ transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: 'ignorado@x.com' }],
      null,
      USUARIO_TESTE,
      d,
    );
    expect(d.solicitar).toHaveBeenCalledWith(cliente, COTACAO_ID, [{ transportadoraId: ABC.id, emailManual: null }], 'WHATSAPP', USUARIO_TESTE);
    expect(r).toMatchObject({ canal: 'WHATSAPP', status: 'ENVIADO', mensagem: 'Enviado via WhatsApp.' });
  });

  it('idempotência: transportadora/canal já solicitados nesta cotação não geram nova solicitação', async () => {
    const d = deps({
      listarSolicitacoes: vi.fn(async () => [
        { id: 'sol-antiga', transportadoraId: XYZ.id, canal: 'EMAIL', status: 'ENVIADA' } as SolicitacaoCotacao,
      ]) as unknown as DependenciasEnvio['listarSolicitacoes'],
    });
    const [r] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null }], null, USUARIO_TESTE, d);
    expect(r).toMatchObject({ status: 'NAO_ENVIADO', solicitacaoId: 'sol-antiga' });
    expect(d.solicitar).not.toHaveBeenCalled();
  });

  it('cotação encerrada ou de outra modalidade: recusa tudo', async () => {
    const itens: ItemEnvioSolicitacao[] = [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null }];
    await expect(
      servicoEnviarSolicitacoes(cliente, COTACAO_ID, itens, null, USUARIO_TESTE, deps({ buscarCotacao: vi.fn(async () => cotacao({ status: 'FECHADA' })) as never })),
    ).rejects.toThrow(/FECHADA/);
    await expect(
      servicoEnviarSolicitacoes(cliente, COTACAO_ID, itens, null, USUARIO_TESTE, deps({ buscarCotacao: vi.fn(async () => cotacao({ modalidadeExecucao: 'RETIRA' })) as never })),
    ).rejects.toThrow(/TRANSPORTADORA/);
  });
});

describe('busca de transportadoras (Postgres real, tabelas isoladas)', () => {
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
    for (const n of NOMES) process.env[n] = `${n.toLowerCase()}_busca_${sufixo}`;
    process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_busca_${sufixo}`;
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

  it('por nome/fantasia e por CNPJ com ou sem máscara; só ativas; mesmo CNPJ não duplica; nada é apagado', async () => {
    vi.resetModules();
    const repo = await import('../../src/fretes/transportadorasRepositorio.js');
    const envio = await import('../../src/fretes/envioSolicitacoesServico.js');
    const base = { nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null };
    const braspress = await repo.criarTransportadora({ ...base, nomeRazaoSocial: 'BRASPRESS TRANSPORTES URGENTES', nomeFantasia: 'BRASPRESS', cnpj: '12.345.678/0001-90' });
    const dupA = await repo.criarTransportadora({ ...base, nomeRazaoSocial: 'PATRUS HOMOLOGAÇÃO A', cnpj: '11.222.333/0001-81' });
    const dupB = await repo.criarTransportadora({ ...base, nomeRazaoSocial: 'PATRUS HOMOLOGAÇÃO B', cnpj: '11222333000181' });
    const inativa = await repo.criarTransportadora({ ...base, nomeRazaoSocial: 'Patrus Inativa' });
    const pool = (await import('../../src/db.js')).obterPool();
    await pool.query(`UPDATE ${process.env.TRANSPORTADORAS_TABELA} SET ativo = false WHERE id = $1`, [inativa.id]);

    const porNome = await envio.servicoBuscarTransportadorasParaSolicitacao('brasp');
    expect(porNome.map((t) => t.id)).toEqual([braspress.id]);
    expect(porNome[0]).toMatchObject({ canaisDisponiveis: ['API'], canalSugerido: 'API' });

    for (const termo of ['12.345.678/0001-90', '12345678000190', '12345678']) {
      expect((await envio.servicoBuscarTransportadorasParaSolicitacao(termo)).map((t) => t.id)).toEqual([braspress.id]);
    }

    const patrus = await envio.servicoBuscarTransportadorasParaSolicitacao('patrus');
    expect(patrus).toHaveLength(1); // dupA/dupB = mesmo CNPJ → um só; inativa não aparece
    const canonica = [dupA, dupB].sort((a, b) => (a.criadoEm !== b.criadoEm ? (a.criadoEm < b.criadoEm ? -1 : 1) : a.id < b.id ? -1 : 1))[0];
    expect(patrus[0]?.id).toBe(canonica?.id); // sem Omie em nenhum: o cadastro mais antigo
    expect(patrus[0]?.canaisDisponiveis).toEqual([]); // Patrus: nenhuma API implementada, sem Omie

    // curinga de LIKE digitado pelo operador não vira "tudo"
    expect(await envio.servicoBuscarTransportadorasParaSolicitacao('%%')).toEqual([]);
    // nada foi apagado
    expect(await repo.listarTransportadoras(false)).toHaveLength(4);
  });
});
