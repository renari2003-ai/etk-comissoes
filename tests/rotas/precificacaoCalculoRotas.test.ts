import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Usuario } from '../../src/auth/tipos.js';

// Sessão, banco e Omie simulados: conferem proteção, validação e que o Omie só é CONSULTADO.
function usuario(papel: Usuario['papel'], precificacao: boolean): Usuario {
  return {
    id: `id-${papel}-${precificacao}`,
    usuario: papel,
    nome: `Nome ${papel}`,
    papel,
    senhaHash: 'x',
    permissoes: { ...PERMISSOES_VAZIAS, precificacao },
    senhaProvisoria: false,
    mestre: false,
    vendedorOmieId: null,
    vendedorOmieNome: null,
  } as Usuario;
}
const USUARIOS: Record<string, Usuario> = {
  comPermissao: usuario('usuario', true),
  semPermissao: usuario('usuario', false),
};

vi.mock('../../src/auth/sessoes.js', () => ({
  validarSessao: vi.fn(async (token: string) => (token in USUARIOS ? token : null)),
}));
vi.mock('../../src/auth/usuariosRepositorio.js', () => ({
  buscarPorId: vi.fn(async (id: string) => USUARIOS[id] ?? null),
}));
const banco = vi.hoisted(() => ({
  lerTabelaFiscal: vi.fn(),
  obterCustosManuais: vi.fn(),
  obterClientePta: vi.fn(),
}));
vi.mock('../../src/precificacao/parametrosFiscaisRepositorio.js', () => ({ lerTabelaFiscal: banco.lerTabelaFiscal }));
vi.mock('../../src/precificacao/custosManuaisRepositorio.js', () => ({ obterCustosManuais: banco.obterCustosManuais }));
vi.mock('../../src/precificacao/clientesPtaRepositorio.js', () => ({ obterClientePta: banco.obterClientePta }));

const { criarRotasCalculo, hojeEmBrasiliaFormatoOmie } = await import('../../src/rotas/precificacaoCalculo.js');
const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
const { NOME_COOKIE_SESSAO } = await import('../../src/auth/cookies.js');
const { OmieErroTransitorio } = await import('../../src/omie/erros.js');
const { PARAMETROS_GERAIS_INICIAIS, UFS_INICIAIS } = await import('../../src/precificacao/parametrosFiscais.js');

const chamadas: string[] = [];
const omie = {
  consultarEstrutura: vi.fn(async (cod: string) => {
    chamadas.push(`estrutura:${cod}`);
    return { ident: { idProduto: 1, descrProduto: 'Produto 1' }, itens: [{ codProdMalha: 'MP1', idProdMalha: 10, quantProdMalha: 1, tipoProdMalha: '01' }] };
  }),
  consultarProduto: vi.fn(async (id: number) => {
    chamadas.push(`produto:${id}`);
    return { codigo_produto: id, ncm: '85447000' } as never;
  }),
  obterEstoqueProduto: vi.fn(async (id: number, data: string) => {
    chamadas.push(`estoque:${id}:${data}`);
    return { listaEstoque: [{ nCodProd: id, nCMC: 90.75 }] };
  }),
  consultarClienteFiscal: vi.fn(),
};

const corpo = (s: Record<string, unknown> = {}) => ({
  produto: 'PA1',
  quantidade: 2,
  cliente: { uf: 'SP', contribuinte: true, comPta: false },
  finalidade: 'REVENDA',
  despesas: 10,
  comissao: 3,
  margem: 12,
  margemLiquida: false,
  precoAlvo: null,
  custosSimulacao: [],
  escolhas: {},
  ...s,
});

describe('POST /api/precificacao/calculo — proteção, validação e Omie só leitura', () => {
  const app = express();
  let servidor: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(() => {
    app.use(express.json({ limit: '100kb' }));
    app.use(criarRotasCalculo(omie, () => '26/11/2026'));
    app.use(tratadorDeErros);
    servidor = app.listen(0);
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    servidor.close();
  });

  beforeEach(() => {
    chamadas.length = 0;
    banco.lerTabelaFiscal.mockReset().mockResolvedValue({
      gerais: { ...PARAMETROS_GERAIS_INICIAIS },
      ufs: UFS_INICIAIS.map((u) => ({ ...u })),
      excecoesNcm: [],
      ipiNcm: [{ ncm: '85447000', aliquota: 5 }],
      status: 'PROVISORIO',
      statusAlteradoEm: null,
      statusAlteradoPor: null,
      versao: 1,
      atualizadoEm: null,
      atualizadoPor: null,
    });
    banco.obterCustosManuais.mockReset().mockResolvedValue(new Map());
    banco.obterClientePta.mockReset().mockResolvedValue(null);
    omie.consultarClienteFiscal.mockReset().mockResolvedValue({ codigo: 10, razaoSocial: 'Acme Ltda', cnpjCpf: null, uf: 'SP', contribuinte: true, inscricaoEstadual: '1' });
  });

  const post = (token: string | null, body: unknown) =>
    fetch(`${baseUrl}/api/precificacao/calculo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Cookie: `${NOME_COOKIE_SESSAO}=${token}` }) },
      body: JSON.stringify(body),
    });

  it('sem sessão 401; sem a permissão "precificacao" 403 — sem tocar banco nem Omie', async () => {
    expect((await post(null, corpo())).status).toBe(401);
    expect((await post('semPermissao', corpo())).status).toBe(403);
    expect(chamadas).toEqual([]);
    expect(banco.lerTabelaFiscal).not.toHaveBeenCalled();
  });

  it('entrada inválida: 400, sem consultar o Omie', async () => {
    expect((await post('comPermissao', corpo({ extra: 1 }))).status).toBe(400);
    expect((await post('comPermissao', corpo({ margem: '12' }))).status).toBe(400);
    expect(chamadas).toEqual([]);
  });

  it('simulação rápida: calcula com o custo do Omie já líquido, data do estoque no formato do Omie, só consultas', async () => {
    const r = await post('comPermissao', corpo());
    expect(r.status).toBe(200);
    const json = (await r.json()) as { precos: { piso: { preco: number } }; avisos: { codigo: string }[]; quantidade: number };
    expect(json.precos.piso.preco).toBeCloseTo(135.73, 2);
    expect(json.quantidade).toBe(2);
    expect(json.avisos.map((a) => a.codigo)).toContain('PARAMETROS_FISCAIS_PROVISORIOS');
    expect(chamadas).toContain('estoque:10:26/11/2026');
    expect(chamadas.every((c) => /^(estrutura|produto|estoque):/.test(c))).toBe(true);
    expect(omie.consultarClienteFiscal).not.toHaveBeenCalled();
    expect(banco.obterCustosManuais).toHaveBeenCalledWith(['MP1']);
  });

  it('estrutura em ciclo: 400 com a mensagem; cliente que o Omie diz não existir: CLIENTE_INCONSISTENTE', async () => {
    omie.consultarEstrutura.mockImplementationOnce(async () => ({ ident: { idProduto: 1 }, itens: [{ codProdMalha: 'PA1', idProdMalha: 1, quantProdMalha: 1, tipoProdMalha: '04' }] }));
    const ciclo = await post('comPermissao', corpo());
    expect(ciclo.status).toBe(400);
    expect(((await ciclo.json()) as { erro: string }).erro).toContain('ciclo');
    omie.consultarClienteFiscal.mockResolvedValueOnce(null);
    const inexistente = (await (await post('comPermissao', corpo({ cliente: { codigo: 99 } }))).json()) as object;
    expect(inexistente).toMatchObject({ bloqueado: true, avisos: expect.arrayContaining([expect.objectContaining({ codigo: 'CLIENTE_INCONSISTENTE', item: '99' })]) });
  });

  it('data do estoque: hoje em Brasília (no Vercel o relógio é UTC)', () => {
    expect(hojeEmBrasiliaFormatoOmie(new Date('2026-11-27T01:30:00Z'))).toBe('26/11/2026');
    expect(hojeEmBrasiliaFormatoOmie(new Date('2026-11-27T03:30:00Z'))).toBe('27/11/2026');
  });

  it('cliente do Omie: lê o cadastro e o "cliente com PTA" do app; Omie fora vira tarja vermelha, nunca 500', async () => {
    const ok = (await (await post('comPermissao', corpo({ cliente: { codigo: 10 } }))).json()) as { cliente: string; cenario: { cenario: string } };
    expect(ok).toMatchObject({ cliente: 'Acme Ltda (SP)', cenario: { cenario: 'C' } });
    expect(omie.consultarClienteFiscal).toHaveBeenCalledWith(10);
    expect(banco.obterClientePta).toHaveBeenCalledWith(10);
    omie.consultarClienteFiscal.mockRejectedValueOnce(new OmieErroTransitorio('timeout'));
    const fora = await post('comPermissao', corpo({ cliente: { codigo: 10 } }));
    expect(fora.status).toBe(200);
    expect((await fora.json()) as object).toMatchObject({ bloqueado: true, precos: null, avisos: expect.arrayContaining([expect.objectContaining({ codigo: 'OMIE_INDISPONIVEL' })]) });
  });
});
