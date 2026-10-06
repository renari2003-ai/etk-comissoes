import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import type { CotacaoFrete, Transportadora } from '../../src/fretes/tipos.js';

// Rotas HTTP do envio/cadastro/criação com documento Omie — validação estrita na borda.
// Serviços de envio e repositórios mockados: nenhum banco, nenhum envio, nenhuma chamada à Omie.

vi.mock('../../src/auth/sessoes.js', () => ({ validarSessao: vi.fn(async () => 'operador') }));
vi.mock('../../src/auth/usuariosRepositorio.js', () => ({
  buscarPorId: vi.fn(async () => ({ id: 'u-1', papel: 'usuario', permissoes: { fretes: true }, vendedorOmieNome: null })),
}));
vi.mock('../../src/fretes/envioSolicitacoesServico.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/envioSolicitacoesServico.js')>()),
  servicoEnviarSolicitacoes: vi.fn(async () => []),
  servicoBuscarTransportadorasParaSolicitacao: vi.fn(async () => []),
}));
vi.mock('../../src/fretes/omieFretes.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/omieFretes.js')>()),
  prepararCotacaoDeOmie: vi.fn(),
}));
vi.mock('../../src/fretes/cotacoesRepositorio.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/cotacoesRepositorio.js')>()),
  criarCotacao: vi.fn(async (dados: Record<string, unknown>) => ({ id: 'cot-nova', ...dados })),
}));
vi.mock('../../src/fretes/transportadorasRepositorio.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/transportadorasRepositorio.js')>()),
  listarTransportadoras: vi.fn(async () => []),
  buscarTransportadoraPorId: vi.fn(),
  atualizarTransportadora: vi.fn(),
}));
vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({
  registrarAuditoria: vi.fn(async () => undefined),
  listarAuditoriaPorEntidade: vi.fn(async () => []),
}));

import { servicoEnviarSolicitacoes } from '../../src/fretes/envioSolicitacoesServico.js';
import { prepararCotacaoDeOmie } from '../../src/fretes/omieFretes.js';
import { criarCotacao } from '../../src/fretes/cotacoesRepositorio.js';
import { atualizarTransportadora, buscarTransportadoraPorId, listarTransportadoras } from '../../src/fretes/transportadorasRepositorio.js';
import { criarRotaFretes } from '../../src/rotas/fretes.js';
import { tratadorDeErros } from '../../src/rotas/erroHttp.js';
import { NOME_COOKIE_SESSAO } from '../../src/auth/cookies.js';
import { config } from '../../src/config.js';

let servidor: ReturnType<express.Express['listen']>;
let base: string;
beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use(criarRotaFretes({} as ClienteOmie));
  app.use(tratadorDeErros);
  servidor = app.listen(0);
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => servidor.close());
beforeEach(() => vi.clearAllMocks());

const headers = { cookie: `${NOME_COOKIE_SESSAO}=sessao-teste`, 'Content-Type': 'application/json' };
const COTACAO = '22222222-2222-2222-2222-222222222222';
const T1 = 'b0000000-0000-0000-0000-000000000001';
const T2 = 'b0000000-0000-0000-0000-000000000002';

function enviar(corpo: unknown) {
  return fetch(`${base}/api/fretes/cotacoes/${COTACAO}/enviar-solicitacoes`, { method: 'POST', headers, body: JSON.stringify(corpo) });
}

describe('POST enviar-solicitacoes — observação por transportadora', () => {
  it('duas transportadoras com observações diferentes: cada item chega ao serviço com a sua (CRLF → LF, acentos preservados)', async () => {
    const r = await enviar({
      transportadoras: [
        { id: T1, canal: 'EMAIL', observacoesTransportadora: 'Doca 1 — não empilhar\r\nLigar antes' },
        { id: T2, canal: 'API', observacoesTransportadora: 'Portão 2', cienteObservacaoNaoEnviadaApi: true },
      ],
    });
    expect(r.status).toBe(200);
    const itens = vi.mocked(servicoEnviarSolicitacoes).mock.calls[0]?.[2];
    expect(itens).toEqual([
      expect.objectContaining({ transportadoraId: T1, observacoesTransportadora: 'Doca 1 — não empilhar\nLigar antes', cienteObservacaoNaoEnviadaApi: false }),
      expect.objectContaining({ transportadoraId: T2, observacoesTransportadora: 'Portão 2', cienteObservacaoNaoEnviadaApi: true }),
    ]);
  });

  it.each([
    ['tipo inválido', { observacoesTransportadora: 123 }],
    ['acima de 900', { observacoesTransportadora: 'x'.repeat(901) }],
    ['caractere de controle', { observacoesTransportadora: 'a\u0007b' }],
    ['confirmação não booleana', { cienteObservacaoNaoEnviadaApi: 'sim' }],
  ])('payload malformado (%s) → 400, nada enviado', async (_nome, extra) => {
    const r = await enviar({ transportadoras: [{ id: T1, canal: 'EMAIL', ...extra }] });
    expect(r.status).toBe(400);
    expect(servicoEnviarSolicitacoes).not.toHaveBeenCalled();
  });
});

describe('POST omie/documentos/:numero/confirmar — endereço de entrega', () => {
  const destinoOmie = {
    origem: 'PEDIDO' as const,
    codigoMunicipio: '4106902',
    cep: '80000-000',
    logradouro: 'Rua Omie',
    numero: '10',
    complemento: null,
    bairro: 'Centro',
    cidade: 'Curitiba',
    uf: 'PR',
  };
  function prepararOmie(destino: typeof destinoOmie | null) {
    vi.mocked(prepararCotacaoDeOmie).mockResolvedValue({
      clienteOmieId: 1,
      pedidoOmieId: 2,
      pedidoOmieNumero: '123',
      documentoOmieTipo: 'ORCAMENTO',
      vendedorOmieId: null,
      clienteNome: 'Cliente',
      destino,
      logistica: { pesoBruto: 10, pesoLiquido: null, quantidadeVolumes: 1, especieVolumes: null, cifFobOmie: null, transportadoraOmieCodigo: null },
      valorTotalPedido: 100,
    } as unknown as Awaited<ReturnType<typeof prepararCotacaoDeOmie>>);
  }
  function confirmar(destinoOverride: unknown) {
    return fetch(`${base}/api/fretes/omie/documentos/123/confirmar`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tipoDocumento: 'ORCAMENTO', modalidade: 'CIF', destinoOverride }),
    });
  }

  it('sem intervenção do operador: endereço da Omie, origem da Omie (nunca MANUAL)', async () => {
    prepararOmie(destinoOmie);
    expect((await confirmar(null)).status).toBe(201);
    expect(vi.mocked(criarCotacao).mock.calls[0]?.[0]).toMatchObject({ origemDestino: 'PEDIDO', logradouroDestino: 'Rua Omie', cepDestino: '80000-000' });
  });

  it('endereço manual completo: substitui o da Omie INTEIRO (sem mistura), origem MANUAL', async () => {
    prepararOmie(destinoOmie);
    const r = await confirmar({ cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', complemento: 'Galpão 3', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'sp' });
    expect(r.status).toBe(201);
    expect(vi.mocked(criarCotacao).mock.calls[0]?.[0]).toMatchObject({
      origemDestino: 'MANUAL',
      cepDestino: '01310-100',
      logradouroDestino: 'Av. Paulista',
      numeroDestino: '1000',
      complementoDestino: 'Galpão 3',
      bairroDestino: 'Bela Vista',
      cidadeDestino: 'São Paulo',
      ufDestino: 'SP',
      codigoMunicipioDestino: null,
      destino: 'Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP',
    });
  });

  it('endereço manual malformado → 400 explícito, nada criado (nunca cai no da Omie)', async () => {
    prepararOmie(destinoOmie);
    expect((await confirmar({ cep: '123', logradouro: 'X', cidade: 'Y' })).status).toBe(400);
    expect(criarCotacao).not.toHaveBeenCalled();
  });
});

describe('cadastro de transportadoras — canal', () => {
  const t = { id: T1, nomeRazaoSocial: 'ABC', nomeFantasia: null, email: 'a@abc.com.br', whatsappCotacao: null, codigoClienteOmie: null, canalPrincipal: 'EMAIL' } as Transportadora;

  it('GET lista inclui canaisDisponiveis (aditivo)', async () => {
    vi.mocked(listarTransportadoras).mockResolvedValue([t]);
    const corpo = (await (await fetch(`${base}/api/fretes/transportadoras`, { headers })).json()) as { transportadoras: { canaisDisponiveis: string[] }[] };
    expect(corpo.transportadoras[0]?.canaisDisponiveis).toEqual(['EMAIL']);
  });

  it('PUT só com canalPrincipal: grava só o canal; canal inválido no enum → 400; sem contato → 400', async () => {
    vi.mocked(buscarTransportadoraPorId).mockResolvedValue({ ...t, whatsappCotacao: '11999990000' });
    vi.mocked(atualizarTransportadora).mockImplementation(async (id, dados) => ({ ...t, id, ...dados }) as Transportadora);
    const ok = await fetch(`${base}/api/fretes/transportadoras/${T1}`, { method: 'PUT', headers, body: JSON.stringify({ canalPrincipal: 'WHATSAPP' }) });
    expect(ok.status).toBe(200);
    expect(atualizarTransportadora).toHaveBeenCalledWith(T1, { canalPrincipal: 'WHATSAPP' });

    vi.mocked(atualizarTransportadora).mockClear();
    const enumInvalido = await fetch(`${base}/api/fretes/transportadoras/${T1}`, { method: 'PUT', headers, body: JSON.stringify({ canalPrincipal: 'FAX' }) });
    expect(enumInvalido.status).toBe(400);
    vi.mocked(buscarTransportadoraPorId).mockResolvedValue(t);
    const semContato = await fetch(`${base}/api/fretes/transportadoras/${T1}`, { method: 'PUT', headers, body: JSON.stringify({ canalPrincipal: 'WHATSAPP' }) });
    expect(semContato.status).toBe(400);
    expect(atualizarTransportadora).not.toHaveBeenCalled();
  });

  it('busca informa o modo do WhatsApp (aditivo) para a tela calcular o {{6}}', async () => {
    const original = { modo: config.fretesWhatsapp, template: config.ycloudTemplateNome };
    try {
      config.fretesWhatsapp = 'ycloud';
      config.ycloudTemplateNome = 'cotacao_frete';
      const corpo = (await (await fetch(`${base}/api/fretes/transportadoras/buscar?q=abc`, { headers })).json()) as { whatsappModo: string };
      expect(corpo.whatsappModo).toBe('TEMPLATE');
    } finally {
      config.fretesWhatsapp = original.modo;
      config.ycloudTemplateNome = original.template;
    }
  });
});
