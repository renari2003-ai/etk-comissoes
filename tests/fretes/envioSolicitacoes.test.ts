import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { config } from '../../src/config.js';
import {
  canaisDisponiveis,
  canalSugerido,
  escolherCanonicasPorCnpj,
  MENSAGENS_ENVIO,
  paraTransportadoraBusca,
  servicoEnviarSolicitacoes,
  type DependenciasEnvio,
  type ItemEnvioSolicitacao,
} from '../../src/fretes/envioSolicitacoesServico.js';
import { ErroDadosCotacaoIncompletos } from '../../src/fretes/braspressServico.js';
import { ErroBraspressFalhou } from '../../src/fretes/integracoes/braspressCliente.js';
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

// Regra de 2026-10-06: API só com integração cadastrada E configurada. Aqui a integração Braspress
// é dada como configurada com valores FICTÍCIOS (a chamada real é sempre mock) — nunca as credenciais reais.
const credenciaisOriginais = { cnpj: config.braspressCnpj, senha: config.braspressPassword };
beforeEach(() => {
  config.braspressCnpj = 'cnpj-teste';
  config.braspressPassword = 'senha-teste';
});
afterEach(() => {
  config.braspressCnpj = credenciaisOriginais.cnpj;
  config.braspressPassword = credenciaisOriginais.senha;
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
    // Cotação completa (como vem do banco): o envio por WhatsApp mede a mensagem real antes de criar a solicitação.
    return {
      id: COTACAO_ID,
      codigo: 'FR-1',
      status: 'AGUARDANDO_PROPOSTAS',
      modalidadeExecucao: 'TRANSPORTADORA',
      origem: null,
      cepOrigem: '13295-000',
      destino: 'Curitiba/PR',
      cepDestino: '80000-000',
      origemDestino: null,
      logradouroDestino: null,
      numeroDestino: null,
      complementoDestino: null,
      bairroDestino: null,
      cidadeDestino: null,
      ufDestino: null,
      peso: 80,
      pesoBruto: 80,
      pesoLiquido: null,
      volumes: 3,
      especieVolumes: null,
      modalidade: 'CIF',
      observacoes: null,
      ...parcial,
    } as CotacaoFrete;
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
      registrarAuditoria: vi.fn(async () => undefined),
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
    // EMAIL também recebe as embalagens (uma por tipo, medidas como informadas) para gravar na solicitação.
    expect(d.solicitar).toHaveBeenCalledWith(
      cliente,
      COTACAO_ID,
      [
        {
          transportadoraId: XYZ.id,
          emailManual: 'manual@xyz.com.br',
          embalagens: [
            { altura: 0.5, largura: 0.4, comprimento: 0.6, quantidade: 5 },
            { altura: 1.2, largura: 0.8, comprimento: 1, quantidade: 2 },
          ],
          observacoesTransportadora: null,
        },
      ],
      'EMAIL',
      USUARIO_TESTE,
    );
    expect(r).toEqual([
      expect.objectContaining({ transportadora: 'BRASPRESS', canal: 'API', status: 'ENVIADO', propostaId: 'prop-1' }),
      expect.objectContaining({ transportadora: 'Transportes XYZ', canal: 'EMAIL', status: 'ENVIADO', solicitacaoId: `sol-${XYZ.id}` }),
      expect.objectContaining({ transportadora: 'Transportadora ABC', canal: 'WHATSAPP', status: 'FALHOU', mensagem: MENSAGENS_ENVIO.WHATSAPP_INVALIDO }),
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
      ['FALHOU', MENSAGENS_ENVIO.API_NAO_CADASTRADA],
      ['FALHOU', MENSAGENS_ENVIO.EMAIL_INVALIDO],
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
    expect(r[1]).toMatchObject({ status: 'FALHOU', mensagem: MENSAGENS_ENVIO.EMAIL_INVALIDO });

    const comErroN8n = deps({
      solicitar: vi.fn(async () => [{ id: 'sol-erro', status: 'ERRO', emailDestino: 'a@b.com' } as SolicitacaoCotacao]) as unknown as DependenciasEnvio['solicitar'],
    });
    const [n8n] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null }], null, USUARIO_TESTE, comErroN8n);
    expect(n8n).toMatchObject({ status: 'FALHOU', solicitacaoId: 'sol-erro', mensagem: MENSAGENS_ENVIO.EMAIL_FALHOU });
  });

  it('lote EMAIL: destinatário recusado pelo SMTP e falha de SMTP não impedem as demais; mensagens amigáveis por transportadora', async () => {
    const cadastroEmail = new Map([
      [XYZ.id, { ...XYZ, email: 'cotacao@xyz.com.br' }],
      [ABC.id, { ...ABC, email: 'cotacao@abc.com.br' }],
      [BRASPRESS.id, { ...BRASPRESS, email: 'cotacao@braspress.com.br' }],
    ]);
    const respostas: Record<string, Partial<SolicitacaoCotacao>> = {
      [XYZ.id]: { status: 'ERRO', erroUltimaTentativa: 'SMTP_DESTINATARIO_RECUSADO: o servidor SMTP recusou o destinatário. Servidor: 550 5.1.1' },
      [ABC.id]: { status: 'ERRO', erroUltimaTentativa: 'SMTP_CONEXAO: não foi possível conectar ao servidor SMTP.' },
      [BRASPRESS.id]: { status: 'ENVIADA', erroUltimaTentativa: null },
    };
    const d = deps({
      buscarTransportadora: vi.fn(async (id: string) => cadastroEmail.get(id) ?? null) as unknown as DependenciasEnvio['buscarTransportadora'],
      solicitar: vi.fn(async (_c: unknown, _cot: string, itens: { transportadoraId: string }[]) => {
        const id = itens[0]?.transportadoraId ?? '';
        return [{ id: `sol-${id}`, ...respostas[id] } as SolicitacaoCotacao];
      }) as unknown as DependenciasEnvio['solicitar'],
    });
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [XYZ, ABC, BRASPRESS].map((t) => ({ transportadoraId: t.id, canal: 'EMAIL' as const, emailManual: null })),
      null,
      USUARIO_TESTE,
      d,
    );
    expect(d.solicitar).toHaveBeenCalledTimes(3);
    expect(r.map((x) => [x.status, x.mensagem])).toEqual([
      ['FALHOU', MENSAGENS_ENVIO.EMAIL_INVALIDO],
      ['FALHOU', MENSAGENS_ENVIO.EMAIL_FALHOU],
      ['ENVIADO', MENSAGENS_ENVIO.EMAIL_ENVIADO],
    ]);
    // Detalhe técnico só na auditoria, nunca na mensagem da tela.
    expect(r.every((x) => !x.mensagem.includes('SMTP_'))).toBe(true);
    expect(d.registrarAuditoria).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ valorNovo: expect.objectContaining({ detalheTecnico: expect.stringMatching(/^SMTP_DESTINATARIO_RECUSADO/) }) }),
    );
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
    expect(d.solicitar).toHaveBeenCalledWith(cliente, COTACAO_ID, [{ transportadoraId: ABC.id, emailManual: null, embalagens: null, observacoesTransportadora: null }], 'WHATSAPP', USUARIO_TESTE);
    expect(r).toMatchObject({ canal: 'WHATSAPP', status: 'ENVIADO', mensagem: MENSAGENS_ENVIO.WHATSAPP_ENVIADO });
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

  describe('status de envio por canal', () => {
    it('EMAIL válido envia: "Enviado por e-mail." (nunca "Entregue")', async () => {
      const d = deps();
      const [r] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null }], null, USUARIO_TESTE, d);
      expect(r).toMatchObject({ status: 'ENVIADO', canal: 'EMAIL', mensagem: MENSAGENS_ENVIO.EMAIL_ENVIADO });
      expect(r?.mensagem).not.toMatch(/entregue/i);
    });

    it('EMAIL inválido informa erro sem tentar enviar (manual malformado, cadastro sem e-mail, Omie sem e-mail)', async () => {
      const semEmail = transportadora({ id: 'b0000000-0000-0000-0000-000000000010', nomeRazaoSocial: 'Sem e-mail', email: 'nao-e-email' });
      const d = deps({
        buscarTransportadora: vi.fn(async (id: string) => (id === semEmail.id ? semEmail : XYZ)) as unknown as DependenciasEnvio['buscarTransportadora'],
      });
      const r = await servicoEnviarSolicitacoes(
        cliente,
        COTACAO_ID,
        [
          { transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: 'sem-arroba' },
          { transportadoraId: semEmail.id, canal: 'EMAIL', emailManual: null },
        ],
        null,
        USUARIO_TESTE,
        d,
      );
      expect(r.map((x) => [x.status, x.mensagem])).toEqual([
        ['FALHOU', MENSAGENS_ENVIO.EMAIL_INVALIDO],
        ['FALHOU', MENSAGENS_ENVIO.EMAIL_INVALIDO],
      ]);
      expect(d.solicitar).not.toHaveBeenCalled();

      // Omie vinculada mas sem e-mail: a resolução MANUAL > CADASTRO > OMIE bloqueia → mesma mensagem simples.
      const omieSemEmail = deps({
        solicitar: vi.fn(async () => {
          throw new ErroValidacao('EMAIL_TRANSPORTADORA_NAO_CADASTRADO: nenhum e-mail disponível.');
        }) as unknown as DependenciasEnvio['solicitar'],
      });
      const [o] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null }], null, USUARIO_TESTE, omieSemEmail);
      expect(o).toMatchObject({ status: 'FALHOU', mensagem: MENSAGENS_ENVIO.EMAIL_INVALIDO });
    });

    it('falha do n8n: "Erro ao enviar e-mail." / "Erro ao enviar WhatsApp." — motivo técnico só na auditoria', async () => {
      const comWhatsapp = { ...XYZ, whatsappCotacao: '11999990000' };
      const d = deps({
        buscarTransportadora: vi.fn(async () => comWhatsapp) as unknown as DependenciasEnvio['buscarTransportadora'],
        solicitar: vi.fn(async (_c: unknown, _cot: string, _i: unknown, canal: string) => [
          { id: `sol-${canal}`, status: 'ERRO', emailDestino: null, erroUltimaTentativa: 'O webhook do n8n respondeu HTTP 500.' } as SolicitacaoCotacao,
        ]) as unknown as DependenciasEnvio['solicitar'],
      });
      const [email] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null }], null, USUARIO_TESTE, d);
      const [whats] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'WHATSAPP', emailManual: null }], null, USUARIO_TESTE, d);
      expect(email).toMatchObject({ status: 'FALHOU', mensagem: MENSAGENS_ENVIO.EMAIL_FALHOU });
      expect(whats).toMatchObject({ status: 'FALHOU', mensagem: MENSAGENS_ENVIO.WHATSAPP_FALHOU });
      expect(email?.mensagem).not.toContain('HTTP 500');
      expect(d.registrarAuditoria).toHaveBeenCalledWith(
        expect.objectContaining({ valorNovo: expect.objectContaining({ detalheTecnico: 'O webhook do n8n respondeu HTTP 500.' }) }),
      );
    });

    it('WHATSAPP inválido ou só telefone genérico: "Erro: WhatsApp inválido ou não cadastrado." sem tentar enviar', async () => {
      const d = deps({
        buscarTransportadora: vi.fn(async () => ({ ...ABC, whatsappCotacao: '999' })) as unknown as DependenciasEnvio['buscarTransportadora'],
      });
      const [invalido] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: null }], null, USUARIO_TESTE, d);
      expect(invalido).toMatchObject({ status: 'FALHOU', mensagem: MENSAGENS_ENVIO.WHATSAPP_INVALIDO });
      const soTelefone = deps(); // ABC tem só `telefone`
      const [generico] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: null }], null, USUARIO_TESTE, soTelefone);
      expect(generico).toMatchObject({ status: 'FALHOU', mensagem: MENSAGENS_ENVIO.WHATSAPP_INVALIDO });
      expect(d.solicitar).not.toHaveBeenCalled();
      expect(soTelefone.solicitar).not.toHaveBeenCalled();
    });

    it('API: configurada envia; não configurada → "API não cadastrada"; falha na chamada → "Erro na API da transportadora."', async () => {
      const ok = deps();
      const [enviado] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null }], CUBAGEM, USUARIO_TESTE, ok);
      expect(enviado).toMatchObject({ status: 'ENVIADO', canal: 'API', propostaId: 'prop-1' });

      const [semApi] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'API', emailManual: null }], CUBAGEM, USUARIO_TESTE, ok);
      expect(semApi).toMatchObject({ status: 'FALHOU', mensagem: MENSAGENS_ENVIO.API_NAO_CADASTRADA });

      const falhou = deps({
        cotarBraspress: vi.fn(async () => {
          throw new ErroBraspressFalhou('A Braspress respondeu HTTP 503.');
        }) as unknown as DependenciasEnvio['cotarBraspress'],
      });
      const [erroApi] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null }], CUBAGEM, USUARIO_TESTE, falhou);
      expect(erroApi).toMatchObject({ status: 'FALHOU', mensagem: `${MENSAGENS_ENVIO.API_FALHOU} A Braspress respondeu HTTP 503.` });
      expect(falhou.registrarAuditoria).toHaveBeenCalledWith(
        expect.objectContaining({ valorNovo: expect.objectContaining({ detalheTecnico: 'A Braspress respondeu HTTP 503.' }) }),
      );
    });

    it('portal/site nunca é tratado como API', async () => {
      const comPortal = transportadora({ id: 'b0000000-0000-0000-0000-000000000011', nomeRazaoSocial: 'Patrus', urlPortal: 'https://portal.patrus', canalPrincipal: 'API' });
      const d = deps({ buscarTransportadora: vi.fn(async () => comPortal) as unknown as DependenciasEnvio['buscarTransportadora'] });
      const [r] = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: comPortal.id, canal: 'API', emailManual: null }], CUBAGEM, USUARIO_TESTE, d);
      expect(r).toMatchObject({ status: 'FALHOU', mensagem: MENSAGENS_ENVIO.API_NAO_CADASTRADA });
      expect(d.cotarBraspress).not.toHaveBeenCalled();
    });

    it('duas transportadoras com o MESMO nome usam só o próprio cadastro (id), sem misturar canais', async () => {
      const nome = 'J. SEDA NETO TRANSPORTES LTDA';
      const comEmail = transportadora({ id: 'b0000000-0000-0000-0000-000000000021', nomeRazaoSocial: nome, email: 'cotacao@a.com.br' });
      const comWhatsapp = transportadora({ id: 'b0000000-0000-0000-0000-000000000022', nomeRazaoSocial: nome, whatsappCotacao: '11999990000' });
      const cadastro = new Map([comEmail, comWhatsapp].map((t) => [t.id, t]));
      const d = deps({ buscarTransportadora: vi.fn(async (id: string) => cadastro.get(id) ?? null) as unknown as DependenciasEnvio['buscarTransportadora'] });
      const r = await servicoEnviarSolicitacoes(
        cliente,
        COTACAO_ID,
        [
          { transportadoraId: comEmail.id, canal: 'EMAIL', emailManual: null },
          { transportadoraId: comWhatsapp.id, canal: 'EMAIL', emailManual: null }, // e-mail do homônimo NÃO vale
        ],
        null,
        USUARIO_TESTE,
        d,
      );
      expect(r).toEqual([
        expect.objectContaining({ transportadoraId: comEmail.id, status: 'ENVIADO', mensagem: MENSAGENS_ENVIO.EMAIL_ENVIADO }),
        expect.objectContaining({ transportadoraId: comWhatsapp.id, status: 'FALHOU', mensagem: MENSAGENS_ENVIO.EMAIL_INVALIDO }),
      ]);
      expect(d.solicitar).toHaveBeenCalledTimes(1);
      expect(d.solicitar).toHaveBeenCalledWith(cliente, COTACAO_ID, [{ transportadoraId: comEmail.id, emailManual: null, embalagens: null, observacoesTransportadora: null }], 'EMAIL', USUARIO_TESTE);
    });

    it('lote: falha de uma transportadora não bloqueia as demais (A ok, B WhatsApp inválido, C sem API, D ok)', async () => {
      const a = transportadora({ id: 'b0000000-0000-0000-0000-000000000031', nomeRazaoSocial: 'A', email: 'a@a.com.br' });
      const b = transportadora({ id: 'b0000000-0000-0000-0000-000000000032', nomeRazaoSocial: 'B', whatsappCotacao: '12' });
      const c = transportadora({ id: 'b0000000-0000-0000-0000-000000000033', nomeRazaoSocial: 'C', email: 'c@c.com.br' });
      const dT = transportadora({ id: 'b0000000-0000-0000-0000-000000000034', nomeRazaoSocial: 'D', email: 'd@d.com.br' });
      const cadastro = new Map([a, b, c, dT].map((t) => [t.id, t]));
      const d = deps({ buscarTransportadora: vi.fn(async (id: string) => cadastro.get(id) ?? null) as unknown as DependenciasEnvio['buscarTransportadora'] });
      const r = await servicoEnviarSolicitacoes(
        cliente,
        COTACAO_ID,
        [
          { transportadoraId: a.id, canal: 'EMAIL', emailManual: null },
          { transportadoraId: b.id, canal: 'WHATSAPP', emailManual: null },
          { transportadoraId: c.id, canal: 'API', emailManual: null },
          { transportadoraId: dT.id, canal: 'EMAIL', emailManual: null },
        ],
        null,
        USUARIO_TESTE,
        d,
      );
      expect(r.map((x) => [x.transportadora, x.canal, x.status, x.mensagem])).toEqual([
        ['A', 'EMAIL', 'ENVIADO', MENSAGENS_ENVIO.EMAIL_ENVIADO],
        ['B', 'WHATSAPP', 'FALHOU', MENSAGENS_ENVIO.WHATSAPP_INVALIDO],
        ['C', 'API', 'FALHOU', MENSAGENS_ENVIO.API_NAO_CADASTRADA],
        ['D', 'EMAIL', 'ENVIADO', MENSAGENS_ENVIO.EMAIL_ENVIADO],
      ]);
      expect(d.solicitar).toHaveBeenCalledTimes(2);
    });

    it('auditoria: um registro por transportadora/canal com status e erro; falha ao auditar não derruba o lote', async () => {
      const d = deps({
        registrarAuditoria: vi.fn(async () => {
          throw new Error('banco indisponível');
        }) as unknown as DependenciasEnvio['registrarAuditoria'],
      });
      const erroLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const r = await servicoEnviarSolicitacoes(
        cliente,
        COTACAO_ID,
        [
          { transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null },
          { transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: null },
        ],
        null,
        USUARIO_TESTE,
        d,
      );
      erroLog.mockRestore();
      expect(r.map((x) => x.status)).toEqual(['ENVIADO', 'FALHOU']);
      expect(d.registrarAuditoria).toHaveBeenCalledTimes(2);
      expect(d.registrarAuditoria).toHaveBeenNthCalledWith(1, {
        usuarioId: USUARIO_TESTE,
        acao: 'ENVIO_SOLICITACAO_RESULTADO',
        entidade: 'cotacao_frete',
        entidadeId: COTACAO_ID,
        valorNovo: {
          transportadoraId: XYZ.id,
          transportadora: 'Transportes XYZ',
          canal: 'EMAIL',
          status: 'ENVIADO',
          mensagem: MENSAGENS_ENVIO.EMAIL_ENVIADO,
          detalheTecnico: null,
          solicitacaoId: `sol-${XYZ.id}`,
          propostaId: null,
        },
      });
      expect(d.registrarAuditoria).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          valorNovo: expect.objectContaining({ transportadoraId: ABC.id, canal: 'WHATSAPP', status: 'FALHOU', mensagem: MENSAGENS_ENVIO.WHATSAPP_INVALIDO, detalheTecnico: expect.any(String) }),
        }),
      );
    });
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
    // API só é canal disponível com as credenciais da Braspress presentes no servidor (regra de
    // 2026-10-06, `canaisTransportadora.ts`) — valores fictícios no `config` desta cópia do módulo.
    const { config } = await import('../../src/config.js');
    config.braspressCnpj = 'cnpj-teste';
    config.braspressPassword = 'senha-teste';
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
