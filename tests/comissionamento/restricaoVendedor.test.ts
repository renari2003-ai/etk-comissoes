import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Papel, type UsuarioPublico } from '../../src/auth/tipos.js';
import type { LinhaComissionamento, ResultadoComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { preencherFiltroVendedor } from '../../public-src/relatorios.js';

/**
 * Relatório de Comissionamento — papel "vendedor" só vê o próprio vendedor, vinculado pelo NOME
 * Omie (regra de 2026-09-28). A sessão é substituída por cabeçalhos de teste (papel + nome
 * vinculado do "usuário autenticado"); a resolução nome → códigos é a real
 * (`resolverVinculoVendedor`), contra uma lista de vendedores falsa:
 *   42 "Alice Silva", 43 "  alice SILVA " (mesmo nome, outro código), 44 "Alice Silveira"
 *   (parecido — NÃO pode casar), 77 "Bruno Souza".
 * O PDF é a impressão desta mesma resposta (`window.print()`), então restringir a resposta
 * restringe o PDF.
 */

vi.mock('../../src/auth/middleware.js', () => ({
  exigirAutenticacao: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const nome = req.headers['x-vendedor-nome-teste'];
    const usuario: UsuarioPublico = {
      id: 'u1',
      usuario: 'teste',
      nome: 'Teste',
      papel: req.headers['x-papel-teste'] as Papel,
      permissoes: { ...PERMISSOES_VAZIAS, relatorioComissionamento: true },
      senhaProvisoria: false,
      mestre: false,
      // Código legado presente de propósito: para o papel "vendedor" ele NÃO pode valer mais.
      vendedorOmieId: 77,
      vendedorOmieNome: typeof nome === 'string' ? decodeURIComponent(nome) : null,
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

const TODAS_AS_LINHAS = [
  linha('1', 42, 'Alice Silva'),
  linha('2', 43, 'alice SILVA'),
  linha('3', 44, 'Alice Silveira'),
  linha('4', 77, 'Bruno Souza'),
];

function resumoDe(linhas: LinhaComissionamento[]): ResultadoComissionamento['resumo'] {
  return {
    quantidadePedidos: linhas.length,
    valorVendaTotal: linhas.length * 100,
    comissaoTotalCalculada: linhas.length * 3,
    comissaoLiberada: 0,
    comissaoPendente: linhas.length * 3,
    quantidadeParcelasTotal: 0,
    quantidadeParcelasBaixadas: 0,
    quantidadeParcelasPendentes: 0,
  };
}

const gerarRelatorioMock = vi.fn(async (_cliente: unknown, filtros: { codigoVendedor?: number }): Promise<ResultadoComissionamento> => {
  const linhas =
    filtros.codigoVendedor === undefined
      ? structuredClone(TODAS_AS_LINHAS)
      : // Filtra como a Omie faria, mas "vaza" um pedido do Bruno (pior caso) — a rota não pode repassá-lo.
        structuredClone(TODAS_AS_LINHAS.filter((l) => l.codigoVendedor === filtros.codigoVendedor || l.codigoVendedor === 77));
  return {
    linhas,
    resumo: resumoDe(linhas),
    documentosAmbiguosExcluidos: 0,
    pedidosSemVendedorExcluidos: 1,
    numerosPedidosSemVendedor: ['999'],
  };
});
vi.mock('../../src/comissionamento/relatorioComissionamento.js', () => ({
  gerarRelatorioComissionamento: (cliente: unknown, filtros: { codigoVendedor?: number }) => gerarRelatorioMock(cliente, filtros),
}));

const VENDEDORES_OMIE = [
  { codigo: 42, nome: 'Alice Silva', inativo: false },
  { codigo: 43, nome: '  alice SILVA ', inativo: true },
  { codigo: 44, nome: 'Alice Silveira', inativo: false },
  { codigo: 77, nome: 'Bruno Souza', inativo: false },
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

async function chamar(caminho: string, papel: Papel, vendedorOmieNome?: string): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'x-papel-teste': papel };
  if (vendedorOmieNome !== undefined) headers['x-vendedor-nome-teste'] = encodeURIComponent(vendedorOmieNome);
  const resposta = await fetch(`${baseUrl}${caminho}`, { headers });
  return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe('lista de vendedores do filtro — vínculo por nome', () => {
  it('vendedor Alice recebe só "Alice Silva" (mesmo nome em outro código incluso; nome parecido e outros vendedores fora)', async () => {
    const { status, corpo } = await chamar('/api/vendedores', 'vendedor', 'Alice Silva');
    expect(status).toBe(200);
    expect(corpo.restritoAoProprioVendedor).toBe(true);
    expect((corpo.vendedores as Array<{ codigo: number }>).map((v) => v.codigo)).toEqual([42, 43]);
  });

  it('vendedor sem nome vinculado recebe lista vazia (o código legado não vale para vendedor)', async () => {
    const { corpo } = await chamar('/api/vendedores', 'vendedor');
    expect(corpo.vendedores).toEqual([]);
  });

  it('administrador continua recebendo a lista completa', async () => {
    const { corpo } = await chamar('/api/vendedores', 'administrador');
    expect(corpo.restritoAoProprioVendedor).toBe(false);
    expect(corpo.vendedores).toEqual(VENDEDORES_OMIE);
  });
});

describe('relatório de comissionamento (tela e PDF) — vendedor forçado pelo nome no backend', () => {
  it('vendedor Alice: ignora ?vendedor=77, consulta só os códigos de "Alice Silva" e nunca devolve outro vendedor', async () => {
    const { status, corpo } = await chamar('/api/relatorios/comissionamento?vendedor=77', 'vendedor', 'Alice Silva');
    expect(status).toBe(200);
    expect(gerarRelatorioMock.mock.calls.map((c) => c[1].codigoVendedor)).toEqual([42, 43]);
    const linhas = corpo.linhas as Array<{ codigoVendedor: number; nomeVendedor: string }>;
    expect(linhas.map((l) => l.codigoVendedor).sort()).toEqual([42, 43]);
    expect(linhas.some((l) => l.nomeVendedor === 'Alice Silveira' || l.nomeVendedor === 'Bruno Souza')).toBe(false);
    expect(corpo.numerosPedidosSemVendedor).toEqual([]);
  });

  it('comparação só por trim/maiúsculas: nome vinculado com espaços/caixa diferentes funciona; nome parecido não', async () => {
    const igual = await chamar('/api/relatorios/comissionamento', 'vendedor', '  ALICE silva ');
    expect((igual.corpo.linhas as Array<{ codigoVendedor: number }>).map((l) => l.codigoVendedor).sort()).toEqual([42, 43]);

    gerarRelatorioMock.mockClear();
    const parecido = await chamar('/api/relatorios/comissionamento', 'vendedor', 'Alice');
    expect(parecido.status).toBe(200);
    expect(parecido.corpo.linhas).toEqual([]);
    expect(gerarRelatorioMock).not.toHaveBeenCalled();
  });

  it('vendedor sem vendedorOmieNome é bloqueado com a mensagem pedida (403), mesmo tendo código legado', async () => {
    const { status, corpo } = await chamar('/api/relatorios/comissionamento?vendedor=77', 'vendedor');
    expect(status).toBe(403);
    expect(corpo.erro).toBe('Seu usuário ainda não está vinculado a um vendedor da Omie. Peça ao administrador para fazer o vínculo.');
    expect(gerarRelatorioMock).not.toHaveBeenCalled();
  });

  it('administrador continua escolhendo qualquer vendedor (ou todos)', async () => {
    await chamar('/api/relatorios/comissionamento?vendedor=77', 'administrador');
    expect(gerarRelatorioMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ codigoVendedor: 77 }));
    const todos = await chamar('/api/relatorios/comissionamento', 'administrador');
    expect(gerarRelatorioMock).toHaveBeenLastCalledWith(expect.anything(), expect.not.objectContaining({ codigoVendedor: expect.anything() }));
    expect((todos.corpo.linhas as unknown[]).length).toBe(4);
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

  it('vendedor: só o próprio nome (uma vez, mesmo com dois códigos), sem "Todos", campo travado', () => {
    const { campo, opcoes } = selectFalso();
    preencherFiltroVendedor(campo, [VENDEDORES_OMIE[0]!, VENDEDORES_OMIE[1]!], true);
    expect(opcoes.map((o) => o.textContent)).toEqual(['Alice Silva']);
    expect(campo.disabled).toBe(true);
  });

  it('administrador: mantém "Todos" + vendedores ativos, campo liberado', () => {
    const { campo, opcoes } = selectFalso();
    preencherFiltroVendedor(campo, VENDEDORES_OMIE, false);
    expect(opcoes.map((o) => o.textContent)).toEqual(['Todos os vendedores', 'Alice Silva', 'Alice Silveira', 'Bruno Souza']);
    expect(campo.disabled).toBe(false);
  });
});
