import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// CEP de destino informado/corrigido manualmente (2026-10-20) — criação via Omie, edição posterior,
// persistência e uso no envio (payload n8n → e-mail/WhatsApp, e API Braspress).
// Repositórios, Omie e Braspress mockados: nenhum banco, nenhuma chamada externa, nenhum envio real.
vi.mock('../../src/fretes/cotacoesRepositorio.js', () => ({
  atualizarCotacao: vi.fn(),
  buscarCotacaoPorId: vi.fn(),
  buscarCotacoesRelacionadasAoPedidoOmie: vi.fn(async () => []),
  criarCotacao: vi.fn(async (dados: Record<string, unknown>) => ({ id: 'cot-nova', ...dados })),
  definirStatusCotacao: vi.fn(),
  listarCotacoes: vi.fn(),
}));
vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({
  registrarAuditoria: vi.fn(async () => undefined),
  listarAuditoriaPorEntidade: vi.fn(async () => []),
}));
vi.mock('../../src/fretes/omieFretes.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/omieFretes.js')>()),
  prepararCotacaoDeOmie: vi.fn(),
}));
vi.mock('../../src/fretes/solicitacoesRepositorio.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/solicitacoesRepositorio.js')>()),
  listarSolicitacoesPorCotacao: vi.fn(),
}));
vi.mock('../../src/fretes/integracoes/braspressCliente.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/integracoes/braspressCliente.js')>()),
  cotarNaBraspress: vi.fn(async () => {
    throw new Error('interrompido no teste');
  }),
}));

import type { ClienteOmie } from '../../src/omie/cliente.js';
import * as cotacoesRepo from '../../src/fretes/cotacoesRepositorio.js';
import * as auditoriaRepo from '../../src/fretes/auditoriaRepositorio.js';
import { prepararCotacaoDeOmie } from '../../src/fretes/omieFretes.js';
import { cotarNaBraspress } from '../../src/fretes/integracoes/braspressCliente.js';
import { servicoAtualizarCotacao, servicoCriarCotacaoDeOmie } from '../../src/fretes/fretesServico.js';
import { servicoCotarBraspress } from '../../src/fretes/braspressServico.js';
import * as solicitacoesRepo from '../../src/fretes/solicitacoesRepositorio.js';
import { cepDestinoDesatualizado, destinoEnviadoDesatualizado, mesmoDestino, montarDestinoEnviado } from '../../src/fretes/destinoEnviado.js';
import { montarPayloadN8n, servicoListarSolicitacoes } from '../../src/fretes/integracaoCotacoesServico.js';
import { servicoEnviarSolicitacoes, type DependenciasEnvio } from '../../src/fretes/envioSolicitacoesServico.js';
import { montarEmailCotacao } from '../../src/fretes/email/templateCotacao.js';
import { montarTextoWhatsapp } from '../../src/fretes/whatsapp/mensagemCotacao.js';
import { validarCepDestinoOpcional, validarDestinoManualOpcional } from '../../src/fretes/validacao.js';
import { ErroValidacao } from '../../src/validacao.js';
import type { CotacaoFrete, SolicitacaoCotacao } from '../../src/fretes/tipos.js';

const USUARIO = '11111111-1111-1111-1111-111111111111';
const COTACAO_ID = '22222222-2222-2222-2222-222222222222';
const cliente = {} as ClienteOmie;

const criarCotacao = vi.mocked(cotacoesRepo.criarCotacao);
const buscarCotacao = vi.mocked(cotacoesRepo.buscarCotacaoPorId);
const atualizarCotacao = vi.mocked(cotacoesRepo.atualizarCotacao);
const auditar = vi.mocked(auditoriaRepo.registrarAuditoria);

/** Endereço de entrega da Omie SEM CEP (caso do orçamento 313 / ADS CONEXAO). */
const destinoOmieSemCep = {
  origem: 'PEDIDO' as const,
  codigoMunicipio: null,
  cep: null as string | null,
  logradouro: 'Rua das Indústrias',
  numero: '500',
  complemento: 'Galpão B',
  bairro: 'Distrito Industrial',
  cidade: 'Jundiaí',
  uf: 'SP',
};

function prepararOmie(destino: typeof destinoOmieSemCep | null) {
  vi.mocked(prepararCotacaoDeOmie).mockResolvedValue({
    clienteOmieId: 321,
    pedidoOmieId: 5001,
    pedidoOmieNumero: '313',
    documentoOmieTipo: 'ORCAMENTO',
    vendedorOmieId: null,
    clienteNome: 'CLIENTE TESTE LTDA',
    destino,
    logistica: { pesoBruto: 10, pesoLiquido: null, quantidadeVolumes: 1, especieVolumes: null, cifFobOmie: null, transportadoraOmieCodigo: null },
    valorTotalPedido: 100,
  } as unknown as Awaited<ReturnType<typeof prepararCotacaoDeOmie>>);
}

const complementar = {
  modalidade: 'CIF' as const,
  modalidadeExecucao: 'TRANSPORTADORA' as const,
  veiculoId: null,
  motoristaNome: null,
  custoManual: null,
  valorMercadoria: null,
  observacoes: null,
};

/** Cotação já criada a partir da Omie, com endereço estruturado e sem CEP. */
function cotacaoOmieSemCep(parcial: Partial<CotacaoFrete> = {}): CotacaoFrete {
  return {
    id: COTACAO_ID,
    codigo: 'FRE-2026-000044',
    status: 'RASCUNHO',
    modalidadeExecucao: 'TRANSPORTADORA',
    veiculoId: null,
    clienteOmieId: 321,
    origem: null,
    cepOrigem: '13295-000',
    destino: 'Rua das Indústrias, nº 500, Galpão B, Distrito Industrial, Jundiaí/SP',
    cepDestino: null,
    origemDestino: 'PEDIDO',
    logradouroDestino: 'Rua das Indústrias',
    numeroDestino: '500',
    complementoDestino: 'Galpão B',
    bairroDestino: 'Distrito Industrial',
    cidadeDestino: 'Jundiaí',
    ufDestino: 'SP',
    codigoMunicipioDestino: null,
    peso: 10,
    pesoBruto: 10,
    pesoLiquido: null,
    volumes: 1,
    especieVolumes: null,
    valorMercadoria: 100,
    modalidade: 'CIF',
    observacoes: null,
    ...parcial,
  } as CotacaoFrete;
}

function solicitacao(parcial: Partial<SolicitacaoCotacao> = {}): SolicitacaoCotacao {
  return {
    id: 'sol-1',
    cotacaoFreteId: COTACAO_ID,
    transportadoraId: 'tr-1',
    canal: 'EMAIL',
    codigoReferencia: 'FRE-2026-000044-abcd1234',
    emailDestino: 'cotacao@transportadora.com.br',
    emailOrigem: 'CADASTRO',
    embalagens: null,
    observacoesTransportadora: null,
    destinoEnviado: null,
    ...parcial,
  } as SolicitacaoCotacao;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validação do CEP de destino', () => {
  it.each([
    ['01310100', '01310-100'],
    ['01310-100', '01310-100'],
    ['  01310-100 ', '01310-100'],
    ['01.310-100', '01310-100'],
    ['00100000', '00100-000'], // zeros à esquerda preservados
  ])('"%s" → "%s"', (entrada, esperado) => {
    expect(validarCepDestinoOpcional(entrada, 'cepDestino')).toBe(esperado);
  });

  it('ausente/vazio = null (nada inventado)', () => {
    expect(validarCepDestinoOpcional(undefined, 'cepDestino')).toBeNull();
    expect(validarCepDestinoOpcional(null, 'cepDestino')).toBeNull();
    expect(validarCepDestinoOpcional('', 'cepDestino')).toBeNull();
    expect(validarCepDestinoOpcional('   ', 'cepDestino')).toBeNull();
  });

  it.each([['1310-100'], ['013101000'], ['01310-10A'], ['CEP 01310100'], ['0131-0100-00']])('malformado "%s" → erro explícito', (entrada) => {
    expect(() => validarCepDestinoOpcional(entrada, 'cepDestino')).toThrow(ErroValidacao);
  });

  it('número (perderia zeros à esquerda) → erro explícito', () => {
    expect(() => validarCepDestinoOpcional(1310100, 'cepDestino')).toThrow(ErroValidacao);
  });

  it('endereço manual completo continua com a mesma regra de CEP', () => {
    expect(validarDestinoManualOpcional({ cep: '01310100', logradouro: 'Av. Paulista', cidade: 'São Paulo' })?.cep).toBe('01310-100');
    expect(() => validarDestinoManualOpcional({ cep: '123', logradouro: 'X', cidade: 'Y' })).toThrow(ErroValidacao);
  });
});

describe('criação via Omie com CEP informado pelo operador', () => {
  it('Omie sem CEP + CEP informado: grava o CEP e PRESERVA o endereço estruturado e a origem da Omie; auditoria própria', async () => {
    prepararOmie(destinoOmieSemCep);
    await servicoCriarCotacaoDeOmie(cliente, '313', 'ORCAMENTO', null, { ...complementar, cepDestino: '01310-100' }, USUARIO);
    expect(criarCotacao.mock.calls[0]?.[0]).toMatchObject({
      cepDestino: '01310-100',
      origemDestino: 'PEDIDO',
      logradouroDestino: 'Rua das Indústrias',
      numeroDestino: '500',
      complementoDestino: 'Galpão B',
      bairroDestino: 'Distrito Industrial',
      cidadeDestino: 'Jundiaí',
      ufDestino: 'SP',
      destino: 'Rua das Indústrias, nº 500, Galpão B, Distrito Industrial, Jundiaí/SP',
    });
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'CEP_DESTINO_ALTERADO_MANUALMENTE',
        valorAnterior: { cepDestino: null, fonte: 'OMIE' },
        valorNovo: { cepDestino: '01310-100', origemDestino: 'PEDIDO' },
      }),
    );
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'DESTINO_IMPORTADO_OMIE' }));
  });

  it('Omie com CEP + CEP diferente: corrige só o CEP (auditado)', async () => {
    prepararOmie({ ...destinoOmieSemCep, cep: '13200-000' });
    await servicoCriarCotacaoDeOmie(cliente, '313', 'ORCAMENTO', null, { ...complementar, cepDestino: '13201-005' }, USUARIO);
    expect(criarCotacao.mock.calls[0]?.[0]).toMatchObject({ cepDestino: '13201-005', origemDestino: 'PEDIDO', logradouroDestino: 'Rua das Indústrias' });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'CEP_DESTINO_ALTERADO_MANUALMENTE', valorAnterior: { cepDestino: '13200-000', fonte: 'OMIE' } }));
  });

  it('CEP igual ao da Omie (só formato diferente) ou ausente: nenhuma intervenção registrada', async () => {
    prepararOmie({ ...destinoOmieSemCep, cep: '13200000' });
    await servicoCriarCotacaoDeOmie(cliente, '313', 'ORCAMENTO', null, { ...complementar, cepDestino: '13200-000' }, USUARIO);
    await servicoCriarCotacaoDeOmie(cliente, '313', 'ORCAMENTO', null, complementar, USUARIO);
    expect(criarCotacao.mock.calls[0]?.[0]).toMatchObject({ cepDestino: '13200000' });
    expect(criarCotacao.mock.calls[1]?.[0]).toMatchObject({ cepDestino: '13200000' });
    expect(auditar).not.toHaveBeenCalledWith(expect.objectContaining({ acao: 'CEP_DESTINO_ALTERADO_MANUALMENTE' }));
  });

  it('Omie sem CEP e operador não informa: cotação nasce sem CEP (nunca inventado)', async () => {
    prepararOmie(destinoOmieSemCep);
    await servicoCriarCotacaoDeOmie(cliente, '313', 'ORCAMENTO', null, complementar, USUARIO);
    expect(criarCotacao.mock.calls[0]?.[0]).toMatchObject({ cepDestino: null, origemDestino: 'PEDIDO' });
  });

  it('CEP avulso junto com endereço manual completo → erro explícito, nada criado', async () => {
    prepararOmie(destinoOmieSemCep);
    const override = { cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', complemento: null, bairro: null, cidade: 'São Paulo', uf: 'SP' };
    await expect(servicoCriarCotacaoDeOmie(cliente, '313', 'ORCAMENTO', override, { ...complementar, cepDestino: '04538-132' }, USUARIO)).rejects.toBeInstanceOf(ErroValidacao);
    expect(criarCotacao).not.toHaveBeenCalled();
  });

  it('sem endereço algum na Omie: CEP avulso não basta — continua exigindo o endereço manual', async () => {
    prepararOmie(null);
    await expect(servicoCriarCotacaoDeOmie(cliente, '313', 'ORCAMENTO', null, { ...complementar, cepDestino: '01310-100' }, USUARIO)).rejects.toBeInstanceOf(ErroValidacao);
    expect(criarCotacao).not.toHaveBeenCalled();
  });
});

describe('edição posterior: completar/corrigir só o CEP', () => {
  beforeEach(() => {
    buscarCotacao.mockResolvedValue(cotacaoOmieSemCep());
    atualizarCotacao.mockImplementation(async (_id, dados) => ({ ...cotacaoOmieSemCep(), ...dados }) as CotacaoFrete);
  });

  it('endereço estruturado da Omie: grava só o CEP, mantém endereço e origem; auditoria CEP com antes/depois', async () => {
    const cotacao = await servicoAtualizarCotacao(COTACAO_ID, { cepDestino: '01310-100' }, USUARIO);
    expect(atualizarCotacao).toHaveBeenCalledWith(COTACAO_ID, { cepDestino: '01310-100' });
    expect(cotacao).toMatchObject({ cepDestino: '01310-100', origemDestino: 'PEDIDO', logradouroDestino: 'Rua das Indústrias', cidadeDestino: 'Jundiaí' });
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'CEP_DESTINO_ALTERADO_MANUALMENTE',
        valorAnterior: { cepDestino: null, origemDestino: 'PEDIDO' },
        valorNovo: { cepDestino: '01310-100', origemDestino: 'PEDIDO' },
      }),
    );
    expect(auditar).not.toHaveBeenCalledWith(expect.objectContaining({ acao: 'DESTINO_ALTERADO_MANUALMENTE' }));
  });

  it('reenviar o mesmo CEP (só formato diferente) não registra intervenção', async () => {
    buscarCotacao.mockResolvedValue(cotacaoOmieSemCep({ cepDestino: '01310-100' }));
    await servicoAtualizarCotacao(COTACAO_ID, { cepDestino: '01310-100' }, USUARIO);
    expect(auditar).not.toHaveBeenCalledWith(expect.objectContaining({ acao: 'CEP_DESTINO_ALTERADO_MANUALMENTE' }));
  });

  it('texto do destino editado junto: regra anterior (MANUAL, estrutura descartada — sem mistura)', async () => {
    await servicoAtualizarCotacao(COTACAO_ID, { destino: 'Av. Nova, 99 - Pinhais/PR', cepDestino: '83320-000' }, USUARIO);
    expect(atualizarCotacao).toHaveBeenCalledWith(COTACAO_ID, expect.objectContaining({ origemDestino: 'MANUAL', logradouroDestino: null, cidadeDestino: null }));
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'DESTINO_ALTERADO_MANUALMENTE' }));
    expect(auditar).not.toHaveBeenCalledWith(expect.objectContaining({ acao: 'CEP_DESTINO_ALTERADO_MANUALMENTE' }));
  });

  it('cotação só com texto livre (sem estrutura): CEP editado segue a regra anterior', async () => {
    const livre = cotacaoOmieSemCep({
      origemDestino: null,
      logradouroDestino: null,
      numeroDestino: null,
      complementoDestino: null,
      bairroDestino: null,
      cidadeDestino: null,
      ufDestino: null,
      destino: 'Curitiba/PR',
    });
    buscarCotacao.mockResolvedValue(livre);
    await servicoAtualizarCotacao(COTACAO_ID, { cepDestino: '80000-000' }, USUARIO);
    expect(atualizarCotacao).toHaveBeenCalledWith(COTACAO_ID, expect.objectContaining({ cepDestino: '80000-000', origemDestino: 'MANUAL' }));
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'DESTINO_ALTERADO_MANUALMENTE' }));
  });
});

describe('uso do CEP salvo no envio', () => {
  const corrigida = cotacaoOmieSemCep({ cepDestino: '01310-100' });
  const CNPJS = { cnpjOrigem: '11222333000181', cnpjDestino: null };

  it('destino enviado: endereço estruturado + CEP informado, texto igual ao da Omie (sem divergência)', () => {
    const destino = montarDestinoEnviado(corrigida);
    expect(destino).toMatchObject({ origem: 'PEDIDO', cep: '01310-100', logradouro: 'Rua das Indústrias', cidade: 'Jundiaí', uf: 'SP' });
    expect(destino.texto).toBe(corrigida.destino);
  });

  it('nova solicitação (snapshot) → payload n8n, e-mail e WhatsApp levam o CEP informado', () => {
    const payload = montarPayloadN8n(corrigida, solicitacao({ destinoEnviado: montarDestinoEnviado(corrigida) }), CNPJS, null);
    expect(payload.logistica.cepDestino).toBe('01310-100');
    expect(payload.logistica.destino).toBe(corrigida.destino);
    const email = montarEmailCotacao(payload);
    expect(email.texto).toContain('01310-100');
    expect(email.html).toContain('01310-100');
    expect(montarTextoWhatsapp({ ...payload, canal: 'WHATSAPP' })).toContain('01310-100');
  });

  it('API Braspress recebe o CEP salvo na cotação', async () => {
    buscarCotacao.mockResolvedValue(corrigida);
    const clienteOmie = { consultarCliente: vi.fn(async () => ({ cnpjCpf: '11222333000181' })) };
    await expect(servicoCotarBraspress(clienteOmie as never, COTACAO_ID, { cepOrigem: null, cubagem: null } as never, USUARIO)).rejects.toThrow('interrompido no teste');
    expect(vi.mocked(cotarNaBraspress).mock.calls[0]?.[0]).toMatchObject({ cepDestino: '01310-100' });
  });
});

describe('tela (código-fonte do frontend)', () => {
  const codigo = readFileSync('public-src/fretes.ts', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');

  it('Nova cotação com documento Omie: CEP não fica travado e vai à parte na confirmação', () => {
    expect(codigo).not.toContain("for (const id of ['fretes-cotacao-destino', 'fretes-cotacao-cep-destino']) el<HTMLInputElement>(id).readOnly = comDocumento;");
    expect(codigo).toContain('function atualizarCampoCepDestinoDocumento');
    const bloco = codigo.slice(codigo.indexOf('formNovaCotacao.addEventListener'), codigo.indexOf("el<HTMLSelectElement>('fretes-filtro-status')"));
    expect(bloco).toMatch(/destinoOverride,\s*cepDestino,/);
  });

  it('Nova cotação com endereço manual: CEP da Omie não fica exibido como se valesse; lembrete quando o CEP é o mesmo', () => {
    const bloco = codigo.slice(codigo.indexOf('function atualizarCampoCepDestinoDocumento'), codigo.indexOf('function atualizarLembreteCepEnderecoManual') + 1200);
    expect(bloco).toContain("inputCep.value = usaEnderecoManual ? '' : (p.destino?.cep ?? '')");
    expect(bloco).toContain('confira se ele corresponde ao novo endereço');
    expect(html).toContain('id="fretes-cotacao-destino-manual-lembrete"');
  });

  it('detalhe: "Salvar CEP" manda só cepDestino; "Salvar endereço" manda o endereço completo; lembrete sem afirmar erro', () => {
    const bloco = codigo.slice(codigo.indexOf('function criarEditorDestino'), codigo.indexOf('function criarEditorDestino') + 7000);
    expect(bloco).toContain("method: 'PUT'");
    expect(bloco).toContain('{ cepDestino: inputCep.value.trim() }');
    expect(bloco).toContain('{ destinoOverride: endereco }');
    expect(bloco).toContain('confira se ele corresponde ao novo endereço');
    expect(bloco).not.toContain('/api/fretes/omie');
  });
});

describe('destino corrigido depois do envio: comparação, aviso e nova solicitação (histórico preservado)', () => {
  const corrigida = cotacaoOmieSemCep({ cepDestino: '01310-100' });
  const snapshotSemCep = montarDestinoEnviado(cotacaoOmieSemCep());
  const TRANSPORTADORA = {
    id: 'tr-1',
    nomeRazaoSocial: 'Transportes XYZ',
    nomeFantasia: null,
    cnpj: null,
    email: 'cotacao@xyz.com.br',
    telefone: null,
    contato: null,
    ativo: true,
    observacoes: null,
    codigoClienteOmie: null,
    canalPrincipal: null,
    urlPortal: null,
    whatsappCotacao: null,
  };

  function depsEnvio(existentes: SolicitacaoCotacao[], cot: CotacaoFrete = corrigida) {
    const d = {
      buscarCotacao: vi.fn(async () => cot),
      buscarTransportadora: vi.fn(async () => TRANSPORTADORA),
      listarSolicitacoes: vi.fn(async () => existentes),
      solicitar: vi.fn(async () => [{ id: 'sol-nova', status: 'ENVIADA' } as SolicitacaoCotacao]),
      cotarBraspress: vi.fn(),
      registrarAuditoria: vi.fn(async () => undefined),
    };
    return d as unknown as DependenciasEnvio & typeof d;
  }
  const item = [{ transportadoraId: 'tr-1', canal: 'EMAIL' as const, emailManual: null }];
  /** Mesmo CEP, outro número/complemento — mudança real de endereço. */
  const outroNumeroMesmoCep = cotacaoOmieSemCep({
    cepDestino: '01310-100',
    numeroDestino: '720',
    complementoDestino: null,
    destino: 'Rua das Indústrias, nº 720, Distrito Industrial, Jundiaí/SP',
  });

  it('normalização: máscara, espaços, caixa, acentos e pontuação não contam; número/complemento contam', () => {
    const base = { cep: '01310-100', texto: 'Rua das Indústrias, nº 500, Galpão B, Distrito Industrial, Jundiaí/SP' };
    expect(mesmoDestino(base, { cep: '01310100', texto: '  RUA DAS INDUSTRIAS nº 500 galpao b   distrito industrial - jundiai sp ' })).toBe(true);
    expect(mesmoDestino(base, { ...base, texto: 'Rua das Indústrias, nº 501, Galpão B, Distrito Industrial, Jundiaí/SP' })).toBe(false);
    expect(mesmoDestino(base, { ...base, texto: 'Rua das Indústrias, nº 500, Distrito Industrial, Jundiaí/SP' })).toBe(false);
    expect(mesmoDestino(base, { ...base, cep: '01310-101' })).toBe(false);
  });

  it('sinaliza quando CEP OU endereço mudou; não sinaliza sem snapshot, sem mudança real ou com destino atual vazio', () => {
    expect(destinoEnviadoDesatualizado({ destinoEnviado: snapshotSemCep }, corrigida)).toBe(true); // CEP completado
    const enviadoComCep = montarDestinoEnviado(corrigida);
    expect(destinoEnviadoDesatualizado({ destinoEnviado: enviadoComCep }, outroNumeroMesmoCep)).toBe(true); // endereço mudou, CEP igual
    expect(destinoEnviadoDesatualizado({ destinoEnviado: { ...enviadoComCep, cep: '01310100', texto: enviadoComCep.texto?.toUpperCase() ?? null } }, corrigida)).toBe(false);
    expect(destinoEnviadoDesatualizado({ destinoEnviado: { ...enviadoComCep, origem: 'MANUAL' } }, corrigida)).toBe(false); // só a origem: não é mudança
    expect(destinoEnviadoDesatualizado({ destinoEnviado: null }, corrigida)).toBe(false); // sem snapshot: usa o destino atual
    const vazia = cotacaoOmieSemCep({ origemDestino: null, logradouroDestino: null, numeroDestino: null, complementoDestino: null, bairroDestino: null, cidadeDestino: null, ufDestino: null, destino: null, cepDestino: null });
    expect(destinoEnviadoDesatualizado({ destinoEnviado: enviadoComCep }, vazia)).toBe(false);
  });

  it('CEP completado depois: nova solicitação é criada; a anterior não é alterada', async () => {
    const antiga = solicitacao({ id: 'sol-antiga', status: 'ENVIADA', destinoEnviado: snapshotSemCep } as Partial<SolicitacaoCotacao>);
    const copia = structuredClone(antiga);
    const d = depsEnvio([antiga]);
    const r = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, item, null, USUARIO, d);
    expect(r[0]?.status).toBe('ENVIADO');
    expect(d.solicitar).toHaveBeenCalledTimes(1);
    expect(antiga).toEqual(copia);
  });

  it('endereço mudou mantendo o CEP: nova solicitação é criada (antes ficava bloqueada)', async () => {
    const antiga = solicitacao({ id: 'sol-antiga', status: 'ERRO', destinoEnviado: montarDestinoEnviado(corrigida) } as Partial<SolicitacaoCotacao>);
    const copia = structuredClone(antiga);
    const d = depsEnvio([antiga], outroNumeroMesmoCep);
    const r = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, item, null, USUARIO, d);
    expect(r[0]?.status).toBe('ENVIADO');
    expect(d.solicitar).toHaveBeenCalledTimes(1);
    expect(antiga).toEqual(copia);
  });

  it('mesmo destino (só formatação diferente): duplicidade continua bloqueada, com ENVIADA ou ERRO', async () => {
    const enviado = montarDestinoEnviado(corrigida);
    for (const status of ['ENVIADA', 'ERRO'] as const) {
      const anterior = solicitacao({ status, destinoEnviado: { ...enviado, cep: '01310100', texto: `  ${enviado.texto?.toLowerCase() ?? ''}  ` } } as Partial<SolicitacaoCotacao>);
      const d = depsEnvio([anterior]);
      const r = await servicoEnviarSolicitacoes(cliente, COTACAO_ID, item, null, USUARIO, d);
      expect(r[0]?.status).toBe('NAO_ENVIADO');
      expect(d.solicitar).not.toHaveBeenCalled();
    }
  });

  it('listagem: destinoDesatualizado + destinoAtual (aditivos); destinoEnviado devolvido exatamente como gravado', async () => {
    buscarCotacao.mockResolvedValue(outroNumeroMesmoCep);
    const enviado = montarDestinoEnviado(corrigida);
    vi.mocked(solicitacoesRepo.listarSolicitacoesPorCotacao).mockResolvedValue([
      solicitacao({ id: 'a', destinoEnviado: enviado }),
      solicitacao({ id: 'b', destinoEnviado: montarDestinoEnviado(outroNumeroMesmoCep) }),
    ]);
    const lista = await servicoListarSolicitacoes(COTACAO_ID);
    expect(lista[0]).toMatchObject({ id: 'a', destinoDesatualizado: true, destinoEnviado: enviado });
    expect(lista[0]?.destinoAtual).toEqual({ texto: 'Rua das Indústrias, nº 720, Distrito Industrial, Jundiaí/SP', cep: '01310-100' });
    expect(lista[1]).toMatchObject({ id: 'b', destinoDesatualizado: false, destinoAtual: null });
  });

  it('compatibilidade: cepDestinoDesatualizado mantém a semântica antiga (só CEP) ao lado dos campos novos', async () => {
    // a: CEP completado depois → os dois campos sinalizam. b: endereço mudou com o MESMO CEP → só o novo sinaliza.
    // c: nada mudou → nenhum sinaliza.
    const daOmieComCep = cotacaoOmieSemCep({ cepDestino: '01310-100' });
    buscarCotacao.mockResolvedValue(outroNumeroMesmoCep);
    vi.mocked(solicitacoesRepo.listarSolicitacoesPorCotacao).mockResolvedValue([
      solicitacao({ id: 'a', destinoEnviado: snapshotSemCep }),
      solicitacao({ id: 'b', destinoEnviado: montarDestinoEnviado(daOmieComCep) }),
      solicitacao({ id: 'c', destinoEnviado: montarDestinoEnviado(outroNumeroMesmoCep) }),
    ]);
    const lista = await servicoListarSolicitacoes(COTACAO_ID);
    expect(lista.map((s) => [s.id, s.cepDestinoDesatualizado, s.destinoDesatualizado])).toEqual([
      ['a', true, true],
      ['b', false, true],
      ['c', false, false],
    ]);
    expect(cepDestinoDesatualizado({ destinoEnviado: null }, daOmieComCep)).toBe(false);
    expect(cepDestinoDesatualizado({ destinoEnviado: { ...snapshotSemCep, cep: '01310100' } }, daOmieComCep)).toBe(false);
  });

  it('reenvio de solicitação antiga usa o snapshot original (histórico), não o destino atual', () => {
    const enviado = montarDestinoEnviado(corrigida);
    const p = montarPayloadN8n(outroNumeroMesmoCep, solicitacao({ destinoEnviado: enviado }), { cnpjOrigem: '11222333000181', cnpjDestino: null }, null);
    expect(p.logistica.destino).toBe(enviado.texto);
    expect(p.logistica.destino).toContain('nº 500');
  });

  it('tela: aviso mostra o destino usado e o atual; "Reenviar" pede confirmação e nunca reenvia sozinho', () => {
    const codigo = readFileSync('public-src/fretes.ts', 'utf8');
    expect(codigo).toContain('Esta solicitação usou: ${descreverDestino(s.destinoEnviado)}. A cotação agora tem: ${descreverDestino(s.destinoAtual)}.');
    expect(codigo).toContain('"Reenviar" repete os dados ORIGINAIS desta solicitação. Para enviar o endereço e o CEP atuais, crie uma nova solicitação');
    expect(codigo).toContain('window.confirm(`${avisoCepDesatualizado}');
  });
});

describe('edição posterior: endereço completo (destinoOverride)', () => {
  const daOmieComCep = cotacaoOmieSemCep({ cepDestino: '01310-100' });
  const novoEndereco = { cep: '04538-132', logradouro: 'Av. Brigadeiro Faria Lima', numero: '3477', complemento: null, bairro: 'Itaim Bibi', cidade: 'São Paulo', uf: 'SP' };

  beforeEach(() => {
    buscarCotacao.mockResolvedValue(daOmieComCep);
    atualizarCotacao.mockImplementation(async (_id, dados) => ({ ...daOmieComCep, ...dados }) as CotacaoFrete);
  });

  it('substitui a estrutura INTEIRA (nada da antiga sobrevive), vira MANUAL, texto remontado; auditoria antes/depois', async () => {
    const cotacao = await servicoAtualizarCotacao(COTACAO_ID, { destinoOverride: novoEndereco }, USUARIO);
    expect(atualizarCotacao).toHaveBeenCalledWith(COTACAO_ID, {
      destino: 'Av. Brigadeiro Faria Lima, nº 3477, Itaim Bibi, São Paulo/SP',
      cepDestino: '04538-132',
      origemDestino: 'MANUAL',
      logradouroDestino: 'Av. Brigadeiro Faria Lima',
      numeroDestino: '3477',
      complementoDestino: null, // o "Galpão B" da Omie não prevalece
      bairroDestino: 'Itaim Bibi',
      cidadeDestino: 'São Paulo',
      ufDestino: 'SP',
      codigoMunicipioDestino: null,
    });
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'DESTINO_ALTERADO_MANUALMENTE',
        valorAnterior: expect.objectContaining({ origemDestino: 'PEDIDO', complementoDestino: 'Galpão B', cepDestino: '01310-100' }),
        valorNovo: expect.objectContaining({ origemDestino: 'MANUAL', complementoDestino: null, cepDestino: '04538-132' }),
      }),
    );
    // envio seguinte usa o endereço novo inteiro
    const p = montarPayloadN8n(cotacao, solicitacao({ destinoEnviado: montarDestinoEnviado(cotacao) }), { cnpjOrigem: '11222333000181', cnpjDestino: null }, null);
    expect(p.logistica).toMatchObject({ destino: 'Av. Brigadeiro Faria Lima, nº 3477, Itaim Bibi, São Paulo/SP', cepDestino: '04538-132' });
  });

  it('endereço mudou mantendo o CEP: grava e audita (o lembrete é só da tela)', async () => {
    await servicoAtualizarCotacao(COTACAO_ID, { destinoOverride: { ...novoEndereco, cep: '01310-100' } }, USUARIO);
    expect(atualizarCotacao).toHaveBeenCalledWith(COTACAO_ID, expect.objectContaining({ cepDestino: '01310-100', logradouroDestino: 'Av. Brigadeiro Faria Lima' }));
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'DESTINO_ALTERADO_MANUALMENTE' }));
  });

  it('mesmo endereço reenviado (só formatação): nada muda e nenhuma intervenção é registrada', async () => {
    const mesmo = { cep: '01310100', logradouro: 'Rua das Indústrias', numero: '500', complemento: 'Galpão B', bairro: 'Distrito Industrial', cidade: 'Jundiaí', uf: 'SP' };
    await servicoAtualizarCotacao(COTACAO_ID, { destinoOverride: mesmo }, USUARIO);
    expect(atualizarCotacao).toHaveBeenCalledWith(COTACAO_ID, {}); // nem a origem (PEDIDO) é trocada
    expect(auditar).not.toHaveBeenCalledWith(expect.objectContaining({ acao: 'DESTINO_ALTERADO_MANUALMENTE' }));
  });

  it('endereço completo junto com destino/CEP avulsos → erro explícito, nada gravado', async () => {
    await expect(servicoAtualizarCotacao(COTACAO_ID, { destinoOverride: novoEndereco, cepDestino: '04538-132' }, USUARIO)).rejects.toBeInstanceOf(ErroValidacao);
    await expect(servicoAtualizarCotacao(COTACAO_ID, { destinoOverride: novoEndereco, destino: 'x' }, USUARIO)).rejects.toBeInstanceOf(ErroValidacao);
    expect(atualizarCotacao).not.toHaveBeenCalled();
  });
});
