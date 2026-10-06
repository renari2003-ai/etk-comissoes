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
  itens: [{ codigoProduto: 1, codigo: 'PA00000001', descricao: 'Produto', quantidade: 9, receita: 900, valorMercadoria: 900, valorDesconto: 0, codigoTabelaPreco: 2 }],
  baseComissao: 900,
  composicaoItens: [
    {
      codigoProduto: 1,
      codigo: 'PA00000001',
      descricao: 'Produto',
      quantidade: 9,
      tabelaId: 2404412334,
      tabelaCodigo: '003',
      tabelaNome: 'TABELA DE VENDA - 07/26',
      origemTabela: 'UNICA_TABELA_DO_PRODUTO',
      referencia: 'PRECO_ATUAL_TABELA_ATIVA',
      precoConsultadoEm: '2026-10-06T14:55:00.000Z',
      apuradoEm: '2026-10-06T15:00:00.000Z',
      itemAlteradoEm: '27/08/2026 10:36:07',
      tabelaAlteradaEm: '27/08/2026 10:55:09',
      regra: 'MULTIPLICADOR',
      valorMercadoria: 900,
      valorDesconto: 0,
      baseComissao: 900,
      precoUnitarioVendido: 100,
      precoTabela: 77.7777,
      multiplicadorTabela: 1.9,
      custoReferencia: 40.9356,
      multiplicadorRealizado: 2.442857,
      acrescimoPercentual: 144.2857,
      comissaoNormalPercentual: 3,
      adicionalVendedorPercentual: 0,
      comissaoFinalPercentual: 3,
      comissaoValor: 27,
    },
  ],
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
  origem: 'PERIODO',
  datasFaturamento: ['01/09/2026'],
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
  numerosPedidosAnterioresNaoLocalizados: [],
  excecoesRevisaoManual: [],
  excecoesApuracao: [
    {
      codigoPedido: 2,
      numeroPedido: '300',
      codigoVendedor: 42,
      nomeVendedor: 'Maria',
      nomeCliente: 'Cliente Alfa',
      valorProdutos: 500,
      problemas: [{ codigoProduto: 7, codigo: 'PA7', descricao: 'Produto 7', tabela: '003 — TABELA DE VENDA - 07/26', motivo: 'PRECO_TABELA_AUSENTE', detalhe: 'O produto está sem Preço da Tabela (ausente ou zero) na tabela 003 — TABELA DE VENDA - 07/26.' }],
    },
    {
      codigoPedido: 3,
      numeroPedido: '301',
      codigoVendedor: 99,
      nomeVendedor: 'Outro',
      nomeCliente: 'Cliente Beta',
      valorProdutos: 800,
      problemas: [{ codigoProduto: 8, codigo: 'PA8', descricao: 'Produto 8', tabela: null, motivo: 'TABELA_NAO_IDENTIFICADA', detalhe: 'O produto não consta em nenhuma tabela de preços ativa e o item não indica uma tabela válida.' }],
    },
  ],
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
      // Composição interna da comissão por tabela (Preço da Tabela, custo de referência, multiplicador) nunca sai.
      expect(linha).not.toHaveProperty('composicaoItens');
      expect(texto).not.toMatch(/precoTabela|custoReferencia|multiplicador|acrescimo|referencia|ConsultadoEm|apuradoEm|PRECO_ATUAL|77[.,]7777|40[.,]9356/i);
      expect(linha!.baseComissao).toBe(900);
      // Exceções de apuração: produto, tabela e motivo (sem preço); vendedor só vê as próprias.
      const excecoes = corpo.excecoesApuracao as Array<{ numeroPedido: string }>;
      expect(excecoes.map((e) => e.numeroPedido)).toEqual(papel === 'vendedor' ? ['300'] : ['300', '301']);

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

describe('tela e PDF (impressão da mesma tabela) — coluna "Venda após despesas (%)" (antiga "Margem")', () => {
  it('administrador vê a coluna com o rótulo novo, na mesma posição', () => {
    expect(titulosTabelaComissionamento(true)[4]).toBe('Venda após despesas (%)');
    expect(titulosTabelaComissionamento(true)).not.toContain('Margem');
    expect(titulosTabelaComissionamento(true)).toHaveLength(11);
  });

  it('demais papéis: coluna removida, sem coluna vazia (demais na mesma ordem)', () => {
    const titulos = titulosTabelaComissionamento(false);
    expect(titulos).not.toContain('Venda após despesas (%)');
    expect(titulos).toEqual(titulosTabelaComissionamento(true).filter((t) => t !== 'Venda após despesas (%)'));
  });

  it('detalhe expandido e Financeiro usam os rótulos novos, só nos trechos de administrador', () => {
    const codigo = readFileSync('public-src/relatorios.ts', 'utf8');
    expect(codigo).toContain("par('Percentual da venda após despesas — informativo', formatarPercentual(linha.margemComissionamentoPercentual");
    expect(codigo).not.toContain('Margem de comissionamento (informativa)');
    expect(codigo).toContain('...(dados.margemVisivel ? [ROTULO_COLUNA_VENDA_APOS_DESPESAS] : [])');
  });

  it('detalhe expandido e colSpan seguem o mesmo flag vindo do servidor', () => {
    const codigo = readFileSync('public-src/relatorios.ts', 'utf8');
    expect(codigo).toMatch(/if \(margemVisivel && linha\.vendedorComissaoFixaPercentual === undefined\)/);
    expect(codigo).toMatch(/if \(margemVisivel && linha\.composicaoItens !== undefined && linha\.composicaoItens\.length > 0\)/);
    expect(codigo).toMatch(/if \(margemVisivel\) tr\.appendChild\(celula\(formatarPercentual\(linha\.margemComissionamentoPercentual/);
    expect(codigo).toMatch(/td\.colSpan = totalColunas/);
    expect(codigo).toMatch(/renderizarTabelaComissionamento\(dados\.linhas, dados\.margemVisivel === true\)/);
    // PDF = window.print() da tabela renderizada — sem geração paralela que pudesse vazar a margem.
    expect(codigo).toMatch(/botaoBaixarPdf\.addEventListener\('click', \(\) => window\.print\(\)\)/);
  });
});
