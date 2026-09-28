import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Papel, type UsuarioPublico } from '../../src/auth/tipos.js';
import type { LinhaComissionamento, ResultadoComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { preencherFiltroVendedor } from '../../public-src/relatorios.js';

/**
 * Relatório de Comissionamento — papel "vendedor" só vê o próprio vendedor (regra de 2026-09-28).
 * A sessão é substituída por cabeçalhos de teste (papel + vínculo Omie do "usuário autenticado") e
 * o cálculo por um resultado fixo com pedidos de DOIS vendedores (42 = Alice, 77 = Bruno). O PDF é
 * a impressão desta mesma resposta (`window.print()`), então restringir a resposta restringe o PDF.
 */

vi.mock('../../src/auth/middleware.js', () => ({
  exigirAutenticacao: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const vinculo = req.headers['x-vendedor-omie-teste'];
    const usuario: UsuarioPublico = {
      id: 'u1',
      usuario: 'teste',
      nome: 'Teste',
      papel: req.headers['x-papel-teste'] as Papel,
      permissoes: { ...PERMISSOES_VAZIAS, relatorioComissionamento: true },
      senhaProvisoria: false,
      mestre: false,
      vendedorOmieId: typeof vinculo === 'string' ? Number(vinculo) : null,
    };
    req.usuario = usuario;
    next();
  },
  exigirPermissao: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

function linha(numeroPedido: string, codigoVendedor: number | null, nomeVendedor: string | null): LinhaComissionamento {
  return {
    codigoPedido: Number(numeroPedido),
    numeroPedido,
    etapa: '60',
    codigoCliente: 1,
    nomeCliente: 'Cliente',
    codigoVendedor,
    nomeVendedor,
    valorBruto: 100,
    receitaTotal: 100,
    custoTotal: 0,
    margemTotal: 0,
    margemVendaPercentual: null,
    markupCustoPercentual: null,
    itensSemCusto: 0,
    valorFrete: 0,
    valorSeguro: 0,
    outrasDespesasFrete: 0,
    valorIPI: 0,
    valorIcmsSt: 0,
    impostosEmbutidos: { icms: 0, pis: 0, cofins: 0, ibs: 0, cbs: 0 },
    itens: [],
    despesasIPI: 0,
    despesasIcmsSt: 0,
    despesasFreteSeguroOutras: 0,
    despesasTotal: 0,
    resultadoAposDespesas: 100,
    margemComissionamentoPercentual: 100,
    comissaoNormalPercentual: 3,
    adicionalVendedorPercentual: 0,
    comissaoFinalPercentual: 3,
    comissaoTotal: 3,
    parcelas: [],
    comissaoLiberada: 0,
    comissaoPendente: 3,
    semTitulosLocalizados: true,
    valorFaturado: 0,
    saldoAFaturar: 0,
  };
}

const RESULTADO: ResultadoComissionamento = {
  linhas: [linha('1', 42, 'Alice Silva'), linha('2', 77, 'Bruno Souza')],
  resumo: {
    quantidadePedidos: 2,
    valorVendaTotal: 200,
    comissaoTotalCalculada: 6,
    comissaoLiberada: 0,
    comissaoPendente: 6,
    quantidadeParcelasTotal: 0,
    quantidadeParcelasBaixadas: 0,
    quantidadeParcelasPendentes: 0,
  },
  documentosAmbiguosExcluidos: 0,
  pedidosSemVendedorExcluidos: 1,
  numerosPedidosSemVendedor: ['999'],
};

const gerarRelatorioMock = vi.fn(async (_cliente: unknown, filtros: { codigoVendedor?: number }) => ({
  ...structuredClone(RESULTADO),
  // Simula a Omie ignorando o filtro (pior caso) — a rota ainda assim não pode vazar o outro vendedor.
  linhas: structuredClone(RESULTADO.linhas),
  _filtros: filtros,
}));
vi.mock('../../src/comissionamento/relatorioComissionamento.js', () => ({
  gerarRelatorioComissionamento: (cliente: unknown, filtros: { codigoVendedor?: number }) => gerarRelatorioMock(cliente, filtros),
}));

const VENDEDORES_OMIE = [
  { codigo: 42, nome: 'Alice Silva', inativo: false },
  { codigo: 77, nome: 'Bruno Souza', inativo: false },
  { codigo: 88, nome: 'Carla Inativa', inativo: true },
];

let servidor: ReturnType<express.Express['listen']>;
let baseUrl: string;

beforeAll(async () => {
  const { criarRotaComissionamento } = await import('../../src/rotas/comissionamento.js');
  const { criarRotaVendedores } = await import('../../src/rotas/vendedores.js');
  const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
  const clienteFalso = { listarVendedores: async () => VENDEDORES_OMIE } as unknown as ClienteOmie;
  const app = express();
  app.use(criarRotaComissionamento(clienteFalso));
  app.use(criarRotaVendedores(clienteFalso));
  app.use(tratadorDeErros);
  servidor = app.listen(0);
  baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor.close();
});

beforeEach(() => {
  gerarRelatorioMock.mockClear();
});

async function chamar(caminho: string, papel: Papel, vendedorOmieId?: number): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'x-papel-teste': papel };
  if (vendedorOmieId !== undefined) headers['x-vendedor-omie-teste'] = String(vendedorOmieId);
  const resposta = await fetch(`${baseUrl}${caminho}`, { headers });
  return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe('lista de vendedores do filtro', () => {
  it('vendedor recebe somente o próprio vendedor (nunca a lista dos outros)', async () => {
    const { status, corpo } = await chamar('/api/vendedores', 'vendedor', 42);
    expect(status).toBe(200);
    expect(corpo.restritoAoProprioVendedor).toBe(true);
    expect(corpo.vendedores).toEqual([{ codigo: 42, nome: 'Alice Silva', inativo: false }]);
  });

  it('vendedor sem vínculo recebe lista vazia (nunca "todos")', async () => {
    const { corpo } = await chamar('/api/vendedores', 'vendedor');
    expect(corpo.vendedores).toEqual([]);
    expect(corpo.restritoAoProprioVendedor).toBe(true);
  });

  it('administrador continua recebendo a lista completa', async () => {
    const { corpo } = await chamar('/api/vendedores', 'administrador');
    expect(corpo.restritoAoProprioVendedor).toBe(false);
    expect(corpo.vendedores).toEqual(VENDEDORES_OMIE);
  });
});

describe('relatório de comissionamento (tela e PDF) — vendedor forçado no backend', () => {
  it('vendedor: ignora o vendedor da query e força o próprio vendedorOmieId', async () => {
    const { status, corpo } = await chamar('/api/relatorios/comissionamento?vendedor=77', 'vendedor', 42);
    expect(status).toBe(200);
    expect(gerarRelatorioMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ codigoVendedor: 42 }));
    const linhas = corpo.linhas as Array<{ codigoVendedor: number; nomeVendedor: string }>;
    expect(linhas.map((l) => l.nomeVendedor)).toEqual(['Alice Silva']);
    expect(linhas.every((l) => l.codigoVendedor === 42)).toBe(true);
    expect(corpo.numerosPedidosSemVendedor).toEqual([]);
  });

  it('vendedor: query malformada/ausente também é ignorada (sem "todos os vendedores")', async () => {
    for (const query of ['', '?vendedor=', '?vendedor=abc']) {
      const { status, corpo } = await chamar(`/api/relatorios/comissionamento${query}`, 'vendedor', 42);
      expect(status, query).toBe(200);
      expect((corpo.linhas as Array<{ codigoVendedor: number }>).every((l) => l.codigoVendedor === 42), query).toBe(true);
    }
    for (const chamada of gerarRelatorioMock.mock.calls) expect(chamada[1].codigoVendedor).toBe(42);
  });

  it('vendedor sem vendedorOmieId vinculado é bloqueado com mensagem clara (403)', async () => {
    const { status, corpo } = await chamar('/api/relatorios/comissionamento?vendedor=77', 'vendedor');
    expect(status).toBe(403);
    expect(String(corpo.erro)).toMatch(/vinculado a um vendedor da Omie/);
    expect(gerarRelatorioMock).not.toHaveBeenCalled();
  });

  it('administrador continua escolhendo qualquer vendedor (ou todos)', async () => {
    await chamar('/api/relatorios/comissionamento?vendedor=77', 'administrador');
    expect(gerarRelatorioMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ codigoVendedor: 77 }));
    const todos = await chamar('/api/relatorios/comissionamento', 'administrador');
    expect(gerarRelatorioMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ codigoVendedor: undefined }));
    expect((todos.corpo.linhas as unknown[]).length).toBe(2);
    expect(todos.corpo.numerosPedidosSemVendedor).toEqual(['999']);
  });
});

describe('filtro de vendedor na tela', () => {
  interface OpcaoFalsa {
    value: string;
    textContent: string;
  }
  function selectFalso(): { campo: HTMLSelectElement; opcoes: OpcaoFalsa[] } {
    const opcoes: OpcaoFalsa[] = [{ value: '', textContent: 'Todos os vendedores' }];
    const campo = {
      disabled: false,
      set textContent(_valor: string) {
        opcoes.length = 0;
      },
      appendChild(opcao: OpcaoFalsa) {
        opcoes.push(opcao);
        return opcao;
      },
    };
    return { campo: campo as unknown as HTMLSelectElement, opcoes };
  }

  beforeAll(() => {
    vi.stubGlobal('document', { createElement: () => ({ value: '', textContent: '' }) });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('vendedor: só o próprio nome, sem "Todos", campo travado', () => {
    const { campo, opcoes } = selectFalso();
    preencherFiltroVendedor(campo, [{ codigo: 42, nome: 'Alice Silva', inativo: false }], true);
    expect(opcoes).toEqual([{ value: '42', textContent: 'Alice Silva' }]);
    expect(campo.disabled).toBe(true);
  });

  it('administrador: mantém "Todos" + vendedores ativos, campo liberado', () => {
    const { campo, opcoes } = selectFalso();
    preencherFiltroVendedor(campo, VENDEDORES_OMIE, false);
    expect(opcoes.map((o) => o.textContent)).toEqual(['Todos os vendedores', 'Alice Silva', 'Bruno Souza']);
    expect(campo.disabled).toBe(false);
  });
});
