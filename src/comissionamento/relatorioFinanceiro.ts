import type { PedidoOmie } from '../calculo/tipos.js';
import { arredondarDinheiro } from '../calculo/arredondamento.js';
import type { BaixaRecebimento } from '../omie/recebimentos.js';
import type { TituloContaReceber } from '../omie/cliente.js';
import { montarLinhasDePedidos } from '../relatorio/relatorioVendas.js';
import { ErroValidacao, validarData } from '../validacao.js';
import { avaliarRegistroComissionamento, validarConfiguracaoEtapasComissionamento } from './elegibilidadeComissionamento.js';
import { calcularLinhaComissionamento, type ClienteOmieParaComissionamento, type LinhaComissionamento } from './relatorioComissionamento.js';

export interface ClienteOmieParaFinanceiro extends ClienteOmieParaComissionamento {
  listarBaixasReceber(dataDe: string, dataAte: string): Promise<BaixaRecebimento[]>;
}

export interface LinhaFinanceiro {
  codigoBaixa: number;
  codigoLancamentoOmie: number;
  codigoPedido: number;
  numeroPedido: string;
  nomeCliente: string | null;
  codigoVendedor: number;
  nomeVendedor: string | null;
  numeroNotaFiscal: string | null;
  numeroParcela: string | null;
  dataRecebimento: string;
  valorRecebido: number;
  baseRecebida: number;
  comissaoAPagar: number;
  comissaoPercentual: number;
  detalhe: LinhaComissionamento;
}

export function resumirFinanceiro(linhas: readonly LinhaFinanceiro[]) {
  return {
    quantidadePedidos: new Set(linhas.map(l => l.numeroPedido)).size,
    quantidadeRecebimentos: linhas.length,
    valorRecebido: arredondarDinheiro(linhas.reduce((s, l) => s + l.valorRecebido, 0)),
    comissaoAPagar: arredondarDinheiro(linhas.reduce((s, l) => s + l.comissaoAPagar, 0)),
  };
}

export interface ResultadoFinanceiro {
  linhas: LinhaFinanceiro[];
  resumo: ReturnType<typeof resumirFinanceiro>;
  avisos: string[];
}

export function validarPeriodoFinanceiro(dataDe?: string, dataAte?: string): { dataDe: string; dataAte: string } {
  const inicio = validarData(dataDe, 'data_de');
  const fim = validarData(dataAte, 'data_ate');
  if (!inicio || !fim) throw new ErroValidacao('Informe data inicial e data final para consultar os recebimentos.');
  if (chaveData(inicio) > chaveData(fim)) throw new ErroValidacao('A data inicial deve ser anterior ou igual à data final.');
  return { dataDe: inicio, dataAte: fim };
}

const chaveData = (data: string) => data.split('/').reverse().join('');

/** Parte das baixas, sem janela de idade da venda. Cálculo e composição do pedido são compartilhados
 * com Comissionamento; o rateio considera TODOS os títulos, antes de selecionar cada recebimento.
 */
export async function gerarRelatorioFinanceiro(
  cliente: ClienteOmieParaFinanceiro,
  filtros: { dataDe?: string; dataAte?: string; codigosVendedor?: number[]; busca?: string },
): Promise<ResultadoFinanceiro> {
  const periodo = validarPeriodoFinanceiro(filtros.dataDe, filtros.dataAte);
  const etapas = await cliente.listarEtapasVendaProduto();
  validarConfiguracaoEtapasComissionamento(etapas);
  const vendedores = await cliente.listarVendedores();
  const codigos = filtros.codigosVendedor ?? vendedores.map(v => v.codigo);
  if (codigos.length === 0) return { linhas: [], resumo: resumirFinanceiro([]), avisos: [] };
  const baixas = await cliente.listarBaixasReceber(periodo.dataDe, periodo.dataAte);
  const noPeriodo = baixas.filter(b => {
    validarData(b.dataRecebimento, 'data_recebimento');
    return chaveData(b.dataRecebimento) >= chaveData(periodo.dataDe) && chaveData(b.dataRecebimento) <= chaveData(periodo.dataAte);
  });
  const titulos = new Map<number, TituloContaReceber>();
  // Sequencial: a Omie não aceita sobreposição do mesmo método.
  for (const codigo of new Set(codigos)) {
    for (const titulo of await cliente.listarContasReceberPorVendedor(codigo)) {
      if (titulo.statusTitulo !== 'CANCELADO' && titulo.codigoVendedor !== null && codigos.includes(titulo.codigoVendedor)) {
        titulos.set(titulo.codigoLancamentoOmie, titulo);
      }
    }
  }
  const porPedido = new Map<string, TituloContaReceber[]>();
  for (const titulo of titulos.values()) {
    if (!titulo.numeroPedido) continue;
    const grupo = porPedido.get(titulo.numeroPedido) ?? [];
    grupo.push(titulo);
    porPedido.set(titulo.numeroPedido, grupo);
  }
  const candidatos = new Set(noPeriodo.map(b => titulos.get(b.codigoLancamentoOmie)?.numeroPedido).filter((n): n is string => !!n));
  const linhas: LinhaFinanceiro[] = [];
  const avisos: string[] = [];
  for (const numeroPedido of candidatos) {
    const titulosPedido = porPedido.get(numeroPedido)!;
    let registros: PedidoOmie[];
    try {
      registros = [await cliente.consultarPedido({ numeroPedido })];
      for (const codigoPedido of new Set(titulosPedido.map(t => t.codigoPedido).filter((c): c is number => c !== null))) {
        if (!registros.some(r => r.cabecalho.codigo_pedido === codigoPedido)) registros.push(await cliente.consultarPedido({ codigoPedido }));
      }
    } catch {
      avisos.push(`Pedido nº ${numeroPedido} não pôde ser consultado; seus recebimentos ficaram fora da apuração.`);
      continue;
    }
    const elegiveis = new Set<number>();
    const relatorio = await montarLinhasDePedidos(cliente, registros, { tipoDocumento: 'PEDIDO' }, { etapas, vendedores }, undefined,
      async (pedido, codigoVendedor) => {
        const decisao = avaliarRegistroComissionamento(pedido, titulosPedido.filter(t => t.codigoPedido === pedido.cabecalho.codigo_pedido));
        const elegivel = decisao.decisao === 'ELEGIVEL' && codigoVendedor !== null && codigos.includes(codigoVendedor);
        if (elegivel) elegiveis.add(pedido.cabecalho.codigo_pedido);
        if (decisao.decisao === 'EXCECAO') avisos.push(`Pedido nº ${numeroPedido}, registro ${pedido.cabecalho.codigo_pedido}: ${decisao.motivo} Fora da apuração automática.`);
        return elegivel;
      });
    for (const linha of relatorio.linhas) {
      if (linha.numeroPedido !== numeroPedido || linha.codigoVendedor === null || !codigos.includes(linha.codigoVendedor)) continue;
      const titulosElegiveis = titulosPedido.filter(t => t.codigoVendedor === linha.codigoVendedor && t.codigoPedido !== null && elegiveis.has(t.codigoPedido));
      const detalhe = await calcularLinhaComissionamento(cliente, linha, titulosElegiveis);
      const vistos = new Set<number>();
      for (const baixa of noPeriodo) {
        if (vistos.has(baixa.codigoBaixa)) continue;
        vistos.add(baixa.codigoBaixa);
        const parcela = detalhe.parcelas.find(p => p.codigoLancamentoOmie === baixa.codigoLancamentoOmie);
        if (!parcela || parcela.valorBrutoParcela <= 0) continue;
        // Juros/multa não são venda de produtos. Desconto não recebido não libera comissão.
        const principalRecebido = Math.min(parcela.valorBrutoParcela, Math.max(0, baixa.valorRecebido - baixa.juros - baixa.multa));
        if (principalRecebido === 0) continue;
        const fracaoRecebida = principalRecebido / parcela.valorBrutoParcela;
        const comissaoAPagar = arredondarDinheiro(parcela.comissaoParcela * fracaoRecebida);
        const parcelaRecebida = { ...parcela, valorBrutoParcela: baixa.valorRecebido,
          valorBaseParcela: arredondarDinheiro(parcela.valorBaseParcela * fracaoRecebida), comissaoParcela: comissaoAPagar,
          baixado: true, statusTitulo: 'RECEBIDO', situacao: 'ELEGIVEL' as const };
        linhas.push({
          codigoBaixa: baixa.codigoBaixa, codigoLancamentoOmie: baixa.codigoLancamentoOmie,
          codigoPedido: linha.codigoPedido, numeroPedido, nomeCliente: linha.nomeCliente,
          codigoVendedor: linha.codigoVendedor, nomeVendedor: linha.nomeVendedor,
          numeroNotaFiscal: parcela.numeroNotaFiscal ?? null, numeroParcela: parcela.numeroParcela,
          dataRecebimento: baixa.dataRecebimento, valorRecebido: arredondarDinheiro(baixa.valorRecebido),
          baseRecebida: parcelaRecebida.valorBaseParcela, comissaoAPagar,
          comissaoPercentual: linha.receitaTotal === 0 ? 0 : arredondarDinheiro(100 * detalhe.comissaoTotal / linha.receitaTotal),
          detalhe: { ...detalhe, parcelas: [parcelaRecebida], comissaoLiberada: comissaoAPagar, comissaoPendente: 0 },
        });
      }
    }
  }
  const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const busca = filtros.busca ? normalizar(filtros.busca) : '';
  const filtradas = linhas.filter(l => !busca || [l.numeroPedido, l.nomeCliente, l.nomeVendedor, l.numeroNotaFiscal].some(s => s && normalizar(s).includes(busca)));
  filtradas.sort((a, b) => chaveData(a.dataRecebimento).localeCompare(chaveData(b.dataRecebimento)) || a.numeroPedido.localeCompare(b.numeroPedido, 'pt-BR', { numeric: true }) || a.codigoBaixa - b.codigoBaixa);
  return { linhas: filtradas, resumo: resumirFinanceiro(filtradas), avisos: [...new Set(avisos)] };
}
