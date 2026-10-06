import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Repositórios mockados: nenhum acesso ao banco (o DDL novo nunca roda aqui) e nenhum envio real.
vi.mock('../../src/fretes/transportadorasRepositorio.js', () => ({
  atualizarTransportadora: vi.fn(),
  buscarTransportadoraPorCnpj: vi.fn(),
  buscarTransportadoraPorId: vi.fn(),
  criarTransportadora: vi.fn(),
  definirAtivaTransportadora: vi.fn(),
  listarTransportadoras: vi.fn(),
}));
vi.mock('../../src/fretes/cotacoesRepositorio.js', () => ({
  atualizarCotacao: vi.fn(),
  buscarCotacaoPorId: vi.fn(),
  buscarCotacoesRelacionadasAoPedidoOmie: vi.fn(),
  criarCotacao: vi.fn(),
  definirStatusCotacao: vi.fn(),
  listarCotacoes: vi.fn(),
}));
vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({
  registrarAuditoria: vi.fn(async () => undefined),
  listarAuditoriaPorEntidade: vi.fn(async () => []),
}));

import { config } from '../../src/config.js';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import {
  MENSAGEM_OBSERVACAO_API_NAO_ENVIADA,
  MENSAGEM_OBSERVACAO_API_SEM_CONFIRMACAO,
  servicoEnviarSolicitacoes,
  type DependenciasEnvio,
  type ItemEnvioSolicitacao,
} from '../../src/fretes/envioSolicitacoesServico.js';
import { servicoAtualizarCotacao, servicoAtualizarTransportadora, servicoCriarTransportadora } from '../../src/fretes/fretesServico.js';
import * as transportadorasRepo from '../../src/fretes/transportadorasRepositorio.js';
import * as cotacoesRepo from '../../src/fretes/cotacoesRepositorio.js';
import * as auditoriaRepo from '../../src/fretes/auditoriaRepositorio.js';
import { ErroValidacao } from '../../src/validacao.js';
import type { CotacaoFrete, SolicitacaoCotacao, Transportadora } from '../../src/fretes/tipos.js';

const USUARIO = '11111111-1111-1111-1111-111111111111';
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
const XYZ = transportadora({ id: 'b0000000-0000-0000-0000-000000000002', nomeRazaoSocial: 'Transportes XYZ', email: 'cotacao@xyz.com.br' });
const ABC = transportadora({ id: 'b0000000-0000-0000-0000-000000000003', nomeRazaoSocial: 'Transportadora ABC', whatsappCotacao: '11999990000' });

function cotacao(parcial: Partial<CotacaoFrete> = {}): CotacaoFrete {
  return {
    id: COTACAO_ID,
    codigo: 'FR-1',
    status: 'AGUARDANDO_PROPOSTAS',
    modalidadeExecucao: 'TRANSPORTADORA',
    observacoes: null,
    origem: 'Itupeva/SP',
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
    especieVolumes: 'CAIXA',
    modalidade: 'CIF',
    ...parcial,
  } as CotacaoFrete;
}

function deps(cot: CotacaoFrete = cotacao()) {
  const cadastro = new Map([BRASPRESS, XYZ, ABC].map((t) => [t.id, t]));
  const d = {
    buscarCotacao: vi.fn(async () => cot),
    buscarTransportadora: vi.fn(async (id: string) => cadastro.get(id) ?? null),
    listarSolicitacoes: vi.fn(async () => [] as SolicitacaoCotacao[]),
    solicitar: vi.fn(async (_c: unknown, _cot: string, itens: { transportadoraId: string }[]) => [
      { id: `sol-${itens[0]?.transportadoraId}`, status: 'ENVIADA' } as SolicitacaoCotacao,
    ]),
    cotarBraspress: vi.fn(async () => ({
      cotacaoExterna: { transportadora: 'BRASPRESS' as const, idCotacaoExterna: '99', valorFrete: 321.5, prazoDias: 4, validade: null },
      proposta: { id: 'prop-1' },
      duplicada: false,
    })),
    registrarAuditoria: vi.fn(async () => undefined),
  };
  return d as unknown as DependenciasEnvio & typeof d;
}

const CUBAGEM = [{ altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 5 }];

describe('envio: "Observações para a transportadora" por transportadora (serviços mockados)', () => {
  const original = {
    fretesWhatsapp: config.fretesWhatsapp,
    fretesEmailOutbound: config.fretesEmailOutbound,
    ycloudTemplateNome: config.ycloudTemplateNome,
    braspressCnpj: config.braspressCnpj,
    braspressPassword: config.braspressPassword,
  };
  beforeEach(() => {
    // Integração API "configurada" com valores fictícios (nunca as credenciais reais; cotarBraspress é mock).
    config.braspressCnpj = 'cnpj-teste';
    config.braspressPassword = 'senha-teste';
  });
  afterEach(() => {
    Object.assign(config, original);
  });

  it('duas transportadoras com observações DIFERENTES: cada uma recebe só a sua (nunca a da outra)', async () => {
    const d = deps();
    const itens: ItemEnvioSolicitacao[] = [
      { transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null, observacoesTransportadora: 'Só XYZ: doca 1' },
      { transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: null, observacoesTransportadora: 'Só ABC: portão 2' },
    ];
    config.ycloudTemplateNome = '';
    const r = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, itens, null, USUARIO, d);
    expect(r.map((x) => x.status)).toEqual(['ENVIADO', 'ENVIADO']);
    expect(d.solicitar).toHaveBeenCalledTimes(2);
    expect(d.solicitar.mock.calls[0]?.[2]).toEqual([expect.objectContaining({ transportadoraId: XYZ.id, observacoesTransportadora: 'Só XYZ: doca 1' })]);
    expect(d.solicitar.mock.calls[1]?.[2]).toEqual([expect.objectContaining({ transportadoraId: ABC.id, observacoesTransportadora: 'Só ABC: portão 2' })]);
    expect(JSON.stringify(d.solicitar.mock.calls[0])).not.toContain('ABC: portão');
    expect(JSON.stringify(d.solicitar.mock.calls[1])).not.toContain('XYZ: doca');
  });

  it('WhatsApp texto livre: mensagem total acima de 4096 → recusado antes de criar a solicitação (sem corte)', async () => {
    config.fretesWhatsapp = 'ycloud';
    config.ycloudTemplateNome = '';
    const d = deps(cotacao({ observacoes: 'y'.repeat(3500) }));
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [{ transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: null, observacoesTransportadora: 'x'.repeat(900) }],
      null,
      USUARIO,
      d,
    );
    expect(r[0]?.status).toBe('FALHOU');
    expect(r[0]?.mensagem).toMatch(/limite 4096/);
    expect(d.solicitar).not.toHaveBeenCalled();
  });

  it('contingência n8n: observação preenchida → recusada antes de criar (o n8n não transmite o campo); sem observação segue', async () => {
    config.fretesEmailOutbound = 'n8n';
    const d = deps();
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null, observacoesTransportadora: 'Doca 3' }],
      null,
      USUARIO,
      d,
    );
    expect(r[0]).toMatchObject({ status: 'FALHOU' });
    expect(r[0]?.mensagem).toContain('modo de contingência (n8n)');
    expect(d.solicitar).not.toHaveBeenCalled();
    const semNota = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: XYZ.id, canal: 'EMAIL', emailManual: null }], null, USUARIO, d);
    expect(semNota[0]?.status).toBe('ENVIADO');
  });

  it('API não configurada no servidor: Braspress via API recusada com mensagem explícita, nada chamado', async () => {
    config.braspressCnpj = '';
    config.braspressPassword = '';
    const d = deps();
    const r = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null }], CUBAGEM, USUARIO, d);
    expect(r[0]).toMatchObject({ status: 'FALHOU' });
    expect(r[0]?.mensagem).toMatch(/não está configurada/);
    expect(d.cotarBraspress).not.toHaveBeenCalled();
  });

  it('Braspress (API) com observação SEM confirmação: bloqueado antes de chamar a API, com aviso explícito', async () => {
    const d = deps();
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [{ transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null, observacoesTransportadora: 'Entregar na doca 3' }],
      CUBAGEM,
      USUARIO,
      d,
    );
    expect(r[0]).toMatchObject({ status: 'FALHOU', mensagem: MENSAGEM_OBSERVACAO_API_SEM_CONFIRMACAO });
    expect(d.cotarBraspress).not.toHaveBeenCalled();
  });

  it('Braspress (API) com observação CONFIRMADA: cota e informa que a observação NÃO foi enviada (auditado)', async () => {
    const d = deps();
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [{ transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null, observacoesTransportadora: 'Entregar na doca 3', cienteObservacaoNaoEnviadaApi: true }],
      CUBAGEM,
      USUARIO,
      d,
    );
    expect(r[0]?.status).toBe('ENVIADO');
    expect(r[0]?.mensagem).toContain(MENSAGEM_OBSERVACAO_API_NAO_ENVIADA);
    expect(d.cotarBraspress).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(d.registrarAuditoria.mock.calls)).toContain('não transmitida');
  });

  it('Braspress sem observação: fluxo inalterado (nenhum aviso)', async () => {
    const d = deps();
    const r = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, [{ transportadoraId: BRASPRESS.id, canal: 'API', emailManual: null }], CUBAGEM, USUARIO, d);
    expect(r[0]?.status).toBe('ENVIADO');
    expect(r[0]?.mensagem).not.toContain('observação');
  });

  it('WhatsApp por template: observações acima do limite do {{6}} → recusado antes de criar a solicitação', async () => {
    config.fretesWhatsapp = 'ycloud';
    config.ycloudTemplateNome = 'cotacao_frete_teste';
    const d = deps(cotacao({ observacoes: 'y'.repeat(200) }));
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [{ transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: null, observacoesTransportadora: 'x'.repeat(900) }],
      null,
      USUARIO,
      d,
    );
    expect(r[0]).toMatchObject({ status: 'FALHOU' });
    expect(r[0]?.mensagem).toMatch(/limite de 1024/);
    expect(r[0]?.mensagem).toContain('Total: 1138 caracteres');
    expect(d.solicitar).not.toHaveBeenCalled();
  });

  it('WhatsApp por template: observação dentro do limite segue normalmente', async () => {
    config.fretesWhatsapp = 'ycloud';
    config.ycloudTemplateNome = 'cotacao_frete_teste';
    const d = deps();
    const r = await servicoEnviarSolicitacoes(
      cliente,
      COTACAO_ID,
      [{ transportadoraId: ABC.id, canal: 'WHATSAPP', emailManual: null, observacoesTransportadora: 'x'.repeat(900) }],
      null,
      USUARIO,
      d,
    );
    expect(r[0]?.status).toBe('ENVIADO');
  });
});

describe('cadastro: canal principal editável (repositórios mockados)', () => {
  const buscarPorId = vi.mocked(transportadorasRepo.buscarTransportadoraPorId);
  const atualizar = vi.mocked(transportadorasRepo.atualizarTransportadora);
  const criar = vi.mocked(transportadorasRepo.criarTransportadora);
  const auditar = vi.mocked(auditoriaRepo.registrarAuditoria);

  beforeEach(() => {
    vi.clearAllMocks();
    atualizar.mockImplementation(async (id, dados) => ({ ...(XYZ as Transportadora), id, ...dados }) as Transportadora);
  });

  it('troca de canal válida grava SÓ o canal (demais contatos intactos) e audita antes/depois', async () => {
    const anterior = { ...ABC, email: 'abc@abc.com.br', canalPrincipal: 'EMAIL' as const };
    buscarPorId.mockResolvedValue(anterior);
    await servicoAtualizarTransportadora(ABC.id, { canalPrincipal: 'WHATSAPP' }, USUARIO);
    expect(atualizar).toHaveBeenCalledWith(ABC.id, { canalPrincipal: 'WHATSAPP' });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'TRANSPORTADORA_EDITADA', valorAnterior: anterior }));
  });

  it('canal sem o contato exigido é recusado (nada gravado)', async () => {
    buscarPorId.mockResolvedValue({ ...XYZ });
    await expect(servicoAtualizarTransportadora(XYZ.id, { canalPrincipal: 'WHATSAPP' }, USUARIO)).rejects.toBeInstanceOf(ErroValidacao);
    await expect(servicoAtualizarTransportadora(XYZ.id, { canalPrincipal: 'API' }, USUARIO)).rejects.toThrow(/integração existente/);
    expect(atualizar).not.toHaveBeenCalled();
  });

  it('apagar o contato do canal principal que funcionava é recusado; cadastro legado inconsistente não bloqueia outras edições', async () => {
    buscarPorId.mockResolvedValue({ ...ABC, canalPrincipal: 'WHATSAPP' });
    await expect(servicoAtualizarTransportadora(ABC.id, { whatsappCotacao: null }, USUARIO)).rejects.toThrow(/WhatsApp para cotação/);
    buscarPorId.mockResolvedValue({ ...XYZ, email: null, canalPrincipal: 'WHATSAPP' });
    await expect(servicoAtualizarTransportadora(XYZ.id, { contato: 'Fulano' }, USUARIO)).resolves.toBeDefined();
  });

  it('API como canal principal: só Braspress com a integração configurada no servidor', async () => {
    const original = { cnpj: config.braspressCnpj, senha: config.braspressPassword };
    try {
      buscarPorId.mockResolvedValue({ ...BRASPRESS });
      config.braspressCnpj = '';
      config.braspressPassword = '';
      await expect(servicoAtualizarTransportadora(BRASPRESS.id, { canalPrincipal: 'API' }, USUARIO)).rejects.toThrow(/não está configurada/);
      expect(atualizar).not.toHaveBeenCalled();
      config.braspressCnpj = 'cnpj-teste';
      config.braspressPassword = 'senha-teste';
      await servicoAtualizarTransportadora(BRASPRESS.id, { canalPrincipal: 'API' }, USUARIO);
      expect(atualizar).toHaveBeenCalledWith(BRASPRESS.id, { canalPrincipal: 'API' });
    } finally {
      config.braspressCnpj = original.cnpj;
      config.braspressPassword = original.senha;
    }
  });

  it('criação valida o canal com os dados informados', async () => {
    const base = { nomeRazaoSocial: 'Nova', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null };
    await expect(servicoCriarTransportadora({ ...base, canalPrincipal: 'EMAIL' } as never, USUARIO)).rejects.toBeInstanceOf(ErroValidacao);
    expect(criar).not.toHaveBeenCalled();
  });
});

describe('cotação: edição do destino em texto vira MANUAL (repositórios mockados)', () => {
  const buscarCotacao = vi.mocked(cotacoesRepo.buscarCotacaoPorId);
  const atualizarCotacao = vi.mocked(cotacoesRepo.atualizarCotacao);
  const auditar = vi.mocked(auditoriaRepo.registrarAuditoria);
  const daOmie = {
    id: COTACAO_ID,
    modalidadeExecucao: 'TRANSPORTADORA',
    veiculoId: null,
    destino: 'Rua Omie, nº 10, Centro, Curitiba/PR',
    cepDestino: '80000-000',
    origemDestino: 'PEDIDO',
    logradouroDestino: 'Rua Omie',
    numeroDestino: '10',
    bairroDestino: 'Centro',
    cidadeDestino: 'Curitiba',
    ufDestino: 'PR',
  } as CotacaoFrete;

  beforeEach(() => {
    vi.clearAllMocks();
    buscarCotacao.mockResolvedValue(daOmie);
    atualizarCotacao.mockImplementation(async (_id, dados) => ({ ...daOmie, ...dados }) as CotacaoFrete);
  });

  it('editar destino/CEP: origem MANUAL, estrutura antiga descartada (sem mistura) e auditoria própria', async () => {
    await servicoAtualizarCotacao(COTACAO_ID, { destino: 'Av. Nova, 99 - Pinhais/PR', cepDestino: '83320-000' }, USUARIO);
    expect(atualizarCotacao).toHaveBeenCalledWith(
      COTACAO_ID,
      expect.objectContaining({ origemDestino: 'MANUAL', logradouroDestino: null, numeroDestino: null, cidadeDestino: null, ufDestino: null }),
    );
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'DESTINO_ALTERADO_MANUALMENTE' }));
  });

  it('salvar sem mexer no destino (ou com o MESMO valor pré-preenchido da Omie) não marca MANUAL', async () => {
    await servicoAtualizarCotacao(COTACAO_ID, { observacoes: 'x', destino: daOmie.destino, cepDestino: daOmie.cepDestino }, USUARIO);
    const dados = atualizarCotacao.mock.calls[0]?.[1];
    expect(dados).not.toHaveProperty('origemDestino');
    expect(auditar).not.toHaveBeenCalledWith(expect.objectContaining({ acao: 'DESTINO_ALTERADO_MANUALMENTE' }));
  });
});
