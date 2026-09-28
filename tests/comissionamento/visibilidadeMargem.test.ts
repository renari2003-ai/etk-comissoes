import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Papel, type UsuarioPublico } from '../../src/auth/tipos.js';
import type { LinhaComissionamento, ResultadoComissionamento } from '../../src/comissionamento/relatorioComissionamento.js';
import { CAMPOS_MARGEM_RESTRITOS } from '../../src/comissionamento/visibilidadeMargem.js';
import { titulosTabelaComissionamento } from '../../public-src/relatorios.js';

/**
 * Margem do relatório de Comissionamento só para administrador (regra de 2026-09-28). A sessão é
 * substituída por um cabeçalho de teste (o papel vem sempre do "usuário autenticado", nunca de
 * parâmetro da query) e o cálculo por um resultado fixo — o cálculo em si não muda e já tem os
 * próprios testes em `relatorioComissionamento.test.ts`.
 */

vi.mock('../../src/auth/middleware.js', () => ({
  exigirAutenticacao: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const papel = req.headers['x-papel-teste'] as Papel;
    const usuario: UsuarioPublico = {
      id: 'u1',
      usuario: 'teste',
      nome: 'Teste',
      papel,
      permissoes: { ...PERMISSOES_VAZIAS, relatorioComissionamento: true },
      senhaProvisoria: false,
      mestre: false,
      vendedorOmieId: null,
      vendedorOmieNome: papel === 'vendedor' ? 'Maria' : null,
    };
    req.usuario = usuario;
    next();
  },
  exigirPermissao: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const LINHA: LinhaComissionamento = {
  codigoPedido: 1,
  numeroPedido: '154',
  etapa: '60',
  codigoCliente: 10,
  nomeCliente: 'Cliente Alfa',
  codigoVendedor: 42,
  nomeVendedor: 'Maria',
  valorBruto: 1000,
  receitaTotal: 900,
  custoTotal: 400,
  margemTotal: 500,
  margemVendaPercentual: 55.56,
  markupCustoPercentual: 125,
  itensSemCusto: 0,
  valorFrete: 20,
  valorSeguro: 0,
  outrasDespesasFrete: 0,
  valorIPI: 50,
  valorIcmsSt: 30,
  impostosEmbutidos: { icms: 1, pis: 1, cofins: 1, ibs: 0, cbs: 0 },
  itens: [{ codigoProduto: 1, receita: 900 }],
  despesasIPI: 50,
  despesasIcmsSt: 30,
  despesasFreteSeguroOutras: 20,
  despesasTotal: 100,
  resultadoAposDespesas: 900,
  margemComissionamentoPercentual: 90,
  comissaoNormalPercentual: 3,
  adicionalVendedorPercentual: 0,
  comissaoFinalPercentual: 3,
  comissaoTotal: 27,
  parcelas: [
    {
      numeroParcela: '1',
      valorBrutoParcela: 1000,
      valorBaseParcela: 900,
      comissaoParcela: 27,
      statusTitulo: 'RECEBIDO',
      baixado: true,
      situacao: 'ELEGIVEL',
    },
  ] as LinhaComissionamento['parcelas'],
  comissaoLiberada: 27,
  comissaoPendente: 0,
  semTitulosLocalizados: false,
  valorFaturado: 1000,
  saldoAFaturar: 0,
};

const RESULTADO: ResultadoComissionamento = {
  linhas: [LINHA],
  resumo: {
    quantidadePedidos: 1,
    valorVendaTotal: 1000,
    comissaoTotalCalculada: 27,
    comissaoLiberada: 27,
    comissaoPendente: 0,
    quantidadeParcelasTotal: 1,
    quantidadeParcelasBaixadas: 1,
    quantidadeParcelasPendentes: 0,
  },
  documentosAmbiguosExcluidos: 0,
  pedidosSemVendedorExcluidos: 0,
  numerosPedidosSemVendedor: [],
};

const gerarRelatorioMock = vi.fn(async () => structuredClone(RESULTADO));
vi.mock('../../src/comissionamento/relatorioComissionamento.js', () => ({
  gerarRelatorioComissionamento: (...args: unknown[]) => gerarRelatorioMock(...(args as [])),
}));

let servidor: ReturnType<express.Express['listen']>;
let baseUrl: string;

beforeAll(async () => {
  const { criarRotaComissionamento } = await import('../../src/rotas/comissionamento.js');
  const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
  const app = express();
  app.use(criarRotaComissionamento({ listarVendedores: async () => [{ codigo: 42, nome: 'Maria', inativo: false }] } as never));
  app.use(tratadorDeErros);
  servidor = app.listen(0);
  baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor.close();
});

async function consultar(papel: Papel, query = ''): Promise<{ status: number; corpo: Record<string, unknown>; texto: string }> {
  const resposta = await fetch(`${baseUrl}/api/relatorios/comissionamento${query}`, { headers: { 'x-papel-teste': papel } });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: JSON.parse(texto) as Record<string, unknown>, texto };
}

describe('API do relatório de comissionamento — margem só para administrador', () => {
  it('administrador recebe a margem (e despesas/custo) normalmente', async () => {
    const { status, corpo } = await consultar('administrador');
    expect(status).toBe(200);
    expect(corpo.margemVisivel).toBe(true);
    const [linha] = corpo.linhas as LinhaComissionamento[];
    expect(linha).toEqual(LINHA);
  });

  for (const papel of ['usuario', 'vendedor', 'convidado'] as const) {
    it(`papel "${papel}" nunca recebe margem nem campos que permitam recompô-la`, async () => {
      const { status, corpo, texto } = await consultar(papel);
      expect(status).toBe(200);
      expect(corpo.margemVisivel).toBe(false);
      const [linha] = corpo.linhas as Array<Record<string, unknown>>;
      for (const campo of CAMPOS_MARGEM_RESTRITOS) expect(linha, campo).not.toHaveProperty(campo);
      expect(texto.replace('"margemVisivel":false', '')).not.toMatch(/margem/i);

      // Comissão, parcelas, valores e resumo preservados, idênticos ao do administrador.
      expect(linha!.comissaoTotal).toBe(27);
      expect(linha!.comissaoFinalPercentual).toBe(3);
      expect(linha!.comissaoLiberada).toBe(27);
      expect(linha!.comissaoPendente).toBe(0);
      expect(linha!.valorBruto).toBe(1000);
      expect(linha!.receitaTotal).toBe(900);
      expect(linha!.parcelas).toEqual(LINHA.parcelas);
      expect(corpo.resumo).toEqual(RESULTADO.resumo);
    });
  }

  it('parâmetro do navegador não libera a margem para quem não é administrador', async () => {
    const { corpo, texto } = await consultar('vendedor', '?papel=administrador&margemVisivel=true&admin=1');
    expect(corpo.margemVisivel).toBe(false);
    expect(texto.replace('"margemVisivel":false', '')).not.toMatch(/margem/i);
  });

  it('filtros (período, vendedor, busca) continuam repassados/aplicados igual para qualquer papel', async () => {
    gerarRelatorioMock.mockClear();
    const semResultado = await consultar('usuario', '?data_de=01/09/2026&data_ate=30/09/2026&vendedor=42&busca=inexistente');
    expect(semResultado.status).toBe(200);
    expect(semResultado.corpo.linhas).toEqual([]);
    expect(gerarRelatorioMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ codigoVendedor: 42 }));
    const comResultado = await consultar('usuario', '?busca=alfa');
    expect((comResultado.corpo.linhas as unknown[]).length).toBe(1);
  });
});

describe('tela e PDF (impressão da mesma tabela) — coluna Margem', () => {
  it('administrador vê a coluna Margem', () => {
    expect(titulosTabelaComissionamento(true)).toContain('Margem');
    expect(titulosTabelaComissionamento(true)).toHaveLength(10);
  });

  it('demais papéis: coluna Margem removida, sem coluna vazia (9 colunas, demais na mesma ordem)', () => {
    const titulos = titulosTabelaComissionamento(false);
    expect(titulos).not.toContain('Margem');
    expect(titulos).toEqual(titulosTabelaComissionamento(true).filter((t) => t !== 'Margem'));
  });

  it('detalhe expandido e colSpan seguem o mesmo flag vindo do servidor', () => {
    const codigo = readFileSync('public-src/relatorios.ts', 'utf8');
    expect(codigo).toMatch(/if \(margemVisivel && linha\.vendedorComissaoFixaPercentual === undefined\)/);
    expect(codigo).toMatch(/if \(margemVisivel\) tr\.appendChild\(celula\(formatarPercentual\(linha\.margemComissionamentoPercentual/);
    expect(codigo).toMatch(/td\.colSpan = totalColunas/);
    expect(codigo).toMatch(/renderizarTabelaComissionamento\(dados\.linhas, dados\.margemVisivel === true\)/);
    // PDF = window.print() da tabela renderizada — sem geração paralela que pudesse vazar a margem.
    expect(codigo).toMatch(/botaoBaixarPdf\.addEventListener\('click', \(\) => window\.print\(\)\)/);
  });
});
