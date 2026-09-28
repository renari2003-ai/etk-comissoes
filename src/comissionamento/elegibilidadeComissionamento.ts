import type { PedidoOmie } from '../calculo/tipos.js';
import type { EtapaFaturamento } from '../omie/classificacaoDocumento.js';
import type { TituloContaReceber } from '../omie/cliente.js';

/**
 * Elegibilidade de um REGISTRO de pedido para a base do Comissionamento (regra de 2026-09-28).
 *
 * Só entram registros em etapa de lista FECHADA — nunca "código >= 50", texto parcial ou ordem
 * presumida do Kanban (nesta conta, 70/80 são aprovações apesar do código maior). Configuração
 * real verificada contra `ListarEtapasFaturamento` em 2026-09-28: 20 = "Pedido de Venda",
 * 50 = "PV Liberado Financeiro", 60 = "Faturado".
 */
export const ETAPAS_ELEGIVEIS_COMISSIONAMENTO: ReadonlyMap<string, string> = new Map([
  ['50', 'PV Liberado Financeiro'],
  ['60', 'Faturado'],
]);

export const MOTIVO_EXCECAO_CANCELADO_COM_TITULO_ATIVO = 'Registro cancelado com título financeiro ativo/recebido';
export const MOTIVO_EXCECAO_CANCELADO_SEM_VENDEDOR = 'Registro cancelado sem vendedor — títulos financeiros não puderam ser verificados.';

/** Configuração de etapas da conta Omie divergente da esperada — o relatório não é gerado. */
export class ErroConfiguracaoEtapasComissionamento extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroConfiguracaoEtapasComissionamento';
  }
}

export interface TituloExcecaoRevisaoManual {
  numeroParcela: string | null;
  numeroNotaFiscal: string | null;
  statusTitulo: string;
  valor: number;
  dataVencimento: string;
}

/** Registro fora do cálculo automático que precisa de conferência humana — nunca excluído em silêncio. */
export interface ExcecaoRevisaoManual {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  codigoVendedor: number | null;
  nomeVendedor: string | null;
  valor: number;
  titulos: TituloExcecaoRevisaoManual[];
  motivo: string;
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Confirma, antes de gerar o relatório, que cada etapa elegível continua configurada na conta
 * com o rótulo esperado (comparação do rótulo inteiro, só ignorando acento/caixa/espaços nas
 * pontas). Etapa ausente, inativa ou renomeada: falha explícita para revisão administrativa.
 */
export function validarConfiguracaoEtapasComissionamento(etapas: readonly EtapaFaturamento[]): void {
  for (const [codigo, rotuloEsperado] of ETAPAS_ELEGIVEIS_COMISSIONAMENTO) {
    const etapa = etapas.find((e) => e.codigo === codigo);
    const rotuloAtual = etapa ? (etapa.descricao || etapa.descricaoPadrao || '').trim() : null;
    if (etapa === undefined || etapa.inativa || rotuloAtual === null || normalizar(rotuloAtual) !== normalizar(rotuloEsperado)) {
      const situacao =
        etapa === undefined ? 'não existe na configuração' : etapa.inativa ? `está inativa ("${rotuloAtual}")` : `está configurada como "${rotuloAtual}"`;
      throw new ErroConfiguracaoEtapasComissionamento(
        `Relatório de comissionamento bloqueado: a etapa ${codigo} da Omie deveria ser "${rotuloEsperado}", mas ${situacao}. ` +
          'A configuração de etapas de Venda de Produto precisa de revisão administrativa antes de gerar o relatório.',
      );
    }
  }
}

export type DecisaoRegistro =
  | { decisao: 'ELEGIVEL' }
  | { decisao: 'ETAPA_NAO_ELEGIVEL' }
  | { decisao: 'CANCELADO_EXCLUIDO' }
  | { decisao: 'EXCECAO'; titulosAtivos: TituloContaReceber[]; motivo: string };

/**
 * Decide um REGISTRO individual (original ou fatura parcial) — nunca o número consolidado do
 * pedido. `titulosDoRegistro` = títulos com `nCodPedido` igual ao `codigo_pedido` do registro, ou
 * `null` quando não puderam ser consultados (registro sem vendedor). Cancelado sem título ou só
 * com títulos CANCELADO: sai da base. Cancelado com algum título não cancelado, ou cancelado com
 * títulos não verificáveis: sai do cálculo automático e vira exceção para revisão manual —
 * nunca tratado como "sem título".
 */
export function avaliarRegistroComissionamento(pedido: PedidoOmie, titulosDoRegistro: readonly TituloContaReceber[] | null): DecisaoRegistro {
  if (!ETAPAS_ELEGIVEIS_COMISSIONAMENTO.has(pedido.cabecalho.etapa)) return { decisao: 'ETAPA_NAO_ELEGIVEL' };
  if (pedido.infoCadastro?.cancelado !== 'S') return { decisao: 'ELEGIVEL' };
  if (titulosDoRegistro === null) return { decisao: 'EXCECAO', titulosAtivos: [], motivo: MOTIVO_EXCECAO_CANCELADO_SEM_VENDEDOR };
  const titulosAtivos = titulosDoRegistro.filter((t) => t.statusTitulo !== 'CANCELADO');
  return titulosAtivos.length === 0 ? { decisao: 'CANCELADO_EXCLUIDO' } : { decisao: 'EXCECAO', titulosAtivos, motivo: MOTIVO_EXCECAO_CANCELADO_COM_TITULO_ATIVO };
}
