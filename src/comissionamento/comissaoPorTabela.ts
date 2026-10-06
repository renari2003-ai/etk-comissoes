import { determinarComissaoNormal, ehVendedorComAdicional } from './calcularComissao.js';
import type { ItemTabelaPreco, TabelaPreco } from '../omie/tabelasPreco.js';
import type { ItemLinhaRelatorio } from '../relatorio/relatorioVendas.js';

/**
 * Comissão normal por ITEM, a partir da tabela de preços da Omie (regra de negócio confirmada em
 * 2026-10-06 — substitui a margem global do pedido como origem do percentual):
 *
 *   custo de referência     = Preço da Tabela ÷ multiplicador da tabela
 *   multiplicador realizado = preço unitário vendido (após desconto) ÷ custo de referência
 *   acréscimo %             = (multiplicador realizado − 1) × 100
 *   comissão normal %       = determinarComissaoNormal(acréscimo %)  — mesma progressão de sempre
 *   comissão do item        = (valor de mercadoria − desconto) × (comissão normal % + adicional) ÷ 100
 *
 * Tabela 001 = comissão fixa de 1% (mais o adicional do vendedor, como a antiga família CTO
 * Promocional). Os multiplicadores 1,75/1,90 são fatores, não percentuais. Nenhum percentual é
 * arredondado antes do cálculo. Custo de estoque/contábil nunca entra aqui.
 *
 * Tabelas identificadas pelo CÓDIGO COMERCIAL (`cCodigo`), nunca pelo nome — os nomes reais
 * ("CTO PROMOCIONAL.", "LINHA PREMIUM", "TABELA DE VENDA - 07/26") mudam com o tempo. Só tabelas
 * ATIVAS são usadas, e só as três abaixo têm regra; qualquer outra exige configuração explícita.
 *
 * REFERÊNCIA DE PREÇO (decisão confirmada em 2026-10-06, substitui o bloqueio por data): nesta fase
 * as tabelas estão fixas e o PREÇO ATUAL da tabela ativa é a referência de apuração, inclusive de
 * pedidos anteriores. A API não tem histórico de preços — essa referência NUNCA é apresentada como
 * preço histórico comprovado (ver `referencia` e `precoConsultadoEm` na composição). Mudança de
 * preço, desativação, substituição ou criação de tabela precisa ser comunicada antes de novas
 * apurações (ver "Arquitetura/Comissão por Tabela de Preços.md").
 */
export type RegraTabelaPreco = { tipo: 'FIXA'; percentual: number } | { tipo: 'MULTIPLICADOR'; multiplicador: number };

export const REGRAS_TABELA_PRECO: Readonly<Record<string, RegraTabelaPreco>> = {
  '001': { tipo: 'FIXA', percentual: 1 },
  '002': { tipo: 'MULTIPLICADOR', multiplicador: 1.75 },
  '003': { tipo: 'MULTIPLICADOR', multiplicador: 1.9 },
};

/**
 * Como a tabela do item foi identificada (regra de 2026-10-06):
 *   - `ID_INTERNO`: `codigo_tabela_preco` do item = `nCodTabPreco` de uma tabela, e o produto está nela.
 *   - `CODIGO_COMERCIAL`: `codigo_tabela_preco` = código comercial (ex.: 3 → "003"), e o produto está nela.
 *   - `UNICA_TABELA_DO_PRODUTO`: sem correspondência válida, a única tabela ativa que contém o produto.
 */
export type OrigemTabelaItem = 'ID_INTERNO' | 'CODIGO_COMERCIAL' | 'UNICA_TABELA_DO_PRODUTO';

export type MotivoExcecaoApuracao =
  | 'TABELA_NAO_IDENTIFICADA'
  | 'TABELA_AMBIGUA'
  | 'TABELA_INATIVA'
  | 'PRODUTO_FORA_DA_TABELA_INFORMADA'
  | 'TABELA_SEM_REGRA'
  | 'PRECO_TABELA_AUSENTE'
  | 'ITEM_INVALIDO';

/** Problema que retira o PEDIDO INTEIRO da apuração automática. Nunca traz preço nem custo (é exibido a todos os papéis). */
export interface ProblemaItemApuracao {
  codigoProduto: number;
  codigo: string;
  descricao: string;
  /** "003 — TABELA DE VENDA - 07/26", ou `null` quando nenhuma tabela pôde ser identificada. */
  tabela: string | null;
  motivo: MotivoExcecaoApuracao;
  detalhe: string;
}

/** Composição interna por item — EXCLUSIVA de administrador (ver `visibilidadeMargem.ts`). */
export interface ComposicaoItemComissao {
  codigoProduto: number;
  codigo: string;
  descricao: string;
  quantidade: number;
  /** `nCodTabPreco` da tabela efetivamente usada. */
  tabelaId: number;
  tabelaCodigo: string;
  tabelaNome: string;
  origemTabela: OrigemTabelaItem;
  /**
   * Origem do percentual: `PRECO_ATUAL_TABELA_ATIVA` = Preço da Tabela ATUAL da tabela ativa,
   * consultado em `precoConsultadoEm` — referência acordada, NÃO preço histórico comprovado.
   * `COMISSAO_FIXA_DA_TABELA` = tabela 001, que não usa preço.
   */
  referencia: 'PRECO_ATUAL_TABELA_ATIVA' | 'COMISSAO_FIXA_DA_TABELA';
  /** Momento (ISO) em que a tabela foi lida da Omie (pode vir do cache de até 10 min); `null` se desconhecido. */
  precoConsultadoEm: string | null;
  /** Momento (ISO) desta apuração. */
  apuradoEm: string;
  /** Últimas alterações informadas pela Omie (dd/mm/aaaa hh:mm:ss) — só informativas, nunca bloqueiam. */
  itemAlteradoEm: string | null;
  tabelaAlteradaEm: string | null;
  regra: 'FIXA' | 'MULTIPLICADOR';
  valorMercadoria: number;
  valorDesconto: number;
  /** Valor de mercadoria após desconto — base da comissão do item. */
  baseComissao: number;
  precoUnitarioVendido: number;
  /** Só na regra MULTIPLICADOR; `null` na tabela de comissão fixa. */
  precoTabela: number | null;
  multiplicadorTabela: number | null;
  custoReferencia: number | null;
  multiplicadorRealizado: number | null;
  acrescimoPercentual: number | null;
  comissaoNormalPercentual: number;
  adicionalVendedorPercentual: number;
  comissaoFinalPercentual: number;
  comissaoValor: number;
}

export type ResultadoApuracaoPorTabela =
  | { ok: true; itens: ComposicaoItemComissao[]; baseComissao: number; comissaoNormalValor: number; comissaoTotal: number }
  | { ok: false; problemas: ProblemaItemApuracao[] };

function rotuloTabela(tabela: TabelaPreco): string {
  return tabela.nome ? `${tabela.codigoComercial} — ${tabela.nome}` : tabela.codigoComercial;
}

function itensDoProduto(tabela: TabelaPreco, codigoProduto: number): ItemTabelaPreco[] {
  return tabela.itens.filter((i) => i.codigoProduto === codigoProduto);
}

type Resolucao = { tabela: TabelaPreco; origem: OrigemTabelaItem } | { motivo: MotivoExcecaoApuracao; tabela: TabelaPreco | null; detalhe: string };

/**
 * Ordem fixa (decisão de 2026-10-06): 1) `codigo_tabela_preco` = ID interno → usa essa tabela, e o
 * produto PRECISA estar nela (senão exceção); 2) = código comercial de uma tabela ativa que contém o
 * produto → usa essa; 3) sem correspondência válida → a ÚNICA tabela ativa com o produto; zero ou
 * várias → exceção. Nunca escolhe entre várias tabelas.
 *
 * Por que um código comercial que coincide mas NÃO contém o produto cai no passo 3 em vez de virar
 * exceção: confirmado contra a API real em 2026-10-06 (533 itens), `codigo_tabela_preco` vem 1 ou 2
 * em itens de produtos das TRÊS tabelas — esses valores não identificam tabela nenhuma; já o ID
 * interno, quando vem, sempre coincidiu com a tabela do produto.
 */
export function resolverTabelaDoItem(item: ItemLinhaRelatorio, tabelas: readonly TabelaPreco[]): Resolucao {
  const informado = item.codigoTabelaPreco;
  if (informado !== null && Number.isSafeInteger(informado) && informado > 0) {
    const porId = tabelas.find((t) => t.idInterno === informado);
    if (porId !== undefined) {
      if (!porId.ativa) {
        return { motivo: 'TABELA_INATIVA', tabela: porId, detalhe: `O item indica a tabela ${rotuloTabela(porId)}, que está inativa na Omie.` };
      }
      if (itensDoProduto(porId, item.codigoProduto).length === 0) {
        return {
          motivo: 'PRODUTO_FORA_DA_TABELA_INFORMADA',
          tabela: porId,
          detalhe: `O item indica a tabela ${rotuloTabela(porId)}, mas o produto não consta nela hoje.`,
        };
      }
      return { tabela: porId, origem: 'ID_INTERNO' };
    }
    const porCodigo = tabelas.filter(
      (t) => t.ativa && /^\d+$/.test(t.codigoComercial) && Number(t.codigoComercial) === informado && itensDoProduto(t, item.codigoProduto).length > 0,
    );
    if (porCodigo.length === 1 && porCodigo[0] !== undefined) return { tabela: porCodigo[0], origem: 'CODIGO_COMERCIAL' };
  }

  const candidatas = tabelas.filter((t) => t.ativa && itensDoProduto(t, item.codigoProduto).length > 0);
  if (candidatas.length === 1 && candidatas[0] !== undefined) return { tabela: candidatas[0], origem: 'UNICA_TABELA_DO_PRODUTO' };
  if (candidatas.length === 0) {
    return { motivo: 'TABELA_NAO_IDENTIFICADA', tabela: null, detalhe: 'O produto não consta em nenhuma tabela de preços ativa e o item não indica uma tabela válida.' };
  }
  return {
    motivo: 'TABELA_AMBIGUA',
    tabela: null,
    detalhe: `O produto consta em mais de uma tabela ativa (${candidatas.map(rotuloTabela).join(', ')}) e o item não indica qual foi aplicada.`,
  };
}

/**
 * Remove só o ruído de ponto flutuante (9 casas no percentual de acréscimo), NÃO é arredondamento de
 * negócio: sem isso, o preço cheio da tabela 003 (multiplicador 1,90) dava acréscimo 89,99999999999999%
 * e caía para 2,9999999% em vez de 3%. 1e-9 ponto percentual de acréscimo vale 1e-10 p.p. de
 * comissão — irrelevante em qualquer valor monetário (ex.: 2,421% continua 2,421%).
 */
function semRuidoBinario(percentual: number): number {
  return Math.round(percentual * 1e9) / 1e9;
}

function dataHora(data: string | null, hora: string | null): string | null {
  return data === null ? null : hora === null ? data : `${data} ${hora}`;
}

/**
 * Apura a comissão de cada item do pedido. Qualquer problema em qualquer item retira o PEDIDO
 * INTEIRO da apuração automática (decisão de 2026-10-06) — todos os problemas são listados, nunca
 * só o primeiro, e nunca vira comissão zero nem volta para a regra antiga da margem.
 *
 * Itens zerados (quantidade e valores 0 — o registro original de um faturamento parcial, cujos
 * itens já foram movidos para as faturas filhas) não vendem nada e são ignorados.
 */
export function apurarComissaoPorTabela(
  itens: readonly ItemLinhaRelatorio[],
  tabelas: readonly TabelaPreco[],
  nomeVendedor: string | null,
  apuradoEm: string = new Date().toISOString(),
): ResultadoApuracaoPorTabela {
  const adicionalVendedorPercentual = ehVendedorComAdicional(nomeVendedor) ? 1 : 0;
  const problemas: ProblemaItemApuracao[] = [];
  const composicao: ComposicaoItemComissao[] = [];

  for (const item of itens) {
    if (item.quantidade === 0 && item.valorMercadoria === 0 && item.valorDesconto === 0) continue;
    const identificacao = { codigoProduto: item.codigoProduto, codigo: item.codigo, descricao: item.descricao };
    const problema = (motivo: MotivoExcecaoApuracao, tabela: TabelaPreco | null, detalhe: string) =>
      problemas.push({ ...identificacao, tabela: tabela === null ? null : rotuloTabela(tabela), motivo, detalhe });

    const baseComissao = item.valorMercadoria - item.valorDesconto;
    if (
      !Number.isFinite(item.quantidade) || item.quantidade <= 0 ||
      !Number.isFinite(item.valorMercadoria) || item.valorMercadoria < 0 ||
      !Number.isFinite(item.valorDesconto) || item.valorDesconto < 0 || baseComissao < 0
    ) {
      problema('ITEM_INVALIDO', null, 'Quantidade, valor de mercadoria ou desconto do item inválidos na Omie.');
      continue;
    }

    const resolucao = resolverTabelaDoItem(item, tabelas);
    if ('motivo' in resolucao) {
      problema(resolucao.motivo, resolucao.tabela, resolucao.detalhe);
      continue;
    }
    const { tabela, origem } = resolucao;
    const regra = REGRAS_TABELA_PRECO[tabela.codigoComercial];
    if (regra === undefined) {
      problema('TABELA_SEM_REGRA', tabela, `A tabela ${rotuloTabela(tabela)} não tem regra de comissão definida (só 001, 002 e 003).`);
      continue;
    }

    const precoUnitarioVendido = baseComissao / item.quantidade;
    const comum = {
      ...identificacao,
      quantidade: item.quantidade,
      tabelaId: tabela.idInterno,
      tabelaCodigo: tabela.codigoComercial,
      tabelaNome: tabela.nome,
      origemTabela: origem,
      precoConsultadoEm: tabela.consultadoEm ?? null,
      apuradoEm,
      tabelaAlteradaEm: dataHora(tabela.dataAlteracao, tabela.horaAlteracao),
      regra: regra.tipo,
      valorMercadoria: item.valorMercadoria,
      valorDesconto: item.valorDesconto,
      baseComissao,
      precoUnitarioVendido,
      adicionalVendedorPercentual,
    };

    if (regra.tipo === 'FIXA') {
      const comissaoFinalPercentual = regra.percentual + adicionalVendedorPercentual;
      composicao.push({
        ...comum,
        referencia: 'COMISSAO_FIXA_DA_TABELA',
        itemAlteradoEm: null,
        precoTabela: null,
        multiplicadorTabela: null,
        custoReferencia: null,
        multiplicadorRealizado: null,
        acrescimoPercentual: null,
        comissaoNormalPercentual: regra.percentual,
        comissaoFinalPercentual,
        comissaoValor: baseComissao * (comissaoFinalPercentual / 100),
      });
      continue;
    }

    const linhasTabela = itensDoProduto(tabela, item.codigoProduto);
    const itemTabela = linhasTabela[0];
    if (linhasTabela.length !== 1 || itemTabela === undefined) {
      problema('TABELA_AMBIGUA', tabela, `O produto aparece ${linhasTabela.length} vezes na tabela ${rotuloTabela(tabela)}.`);
      continue;
    }
    if (itemTabela.precoTabela === null || !(itemTabela.precoTabela > 0)) {
      problema('PRECO_TABELA_AUSENTE', tabela, `O produto está sem Preço da Tabela (ausente ou zero) na tabela ${rotuloTabela(tabela)}.`);
      continue;
    }
    const custoReferencia = itemTabela.precoTabela / regra.multiplicador;
    // (vendido ÷ Preço da Tabela) × multiplicador = vendido ÷ custo de referência, com menos
    // operações; preço cheio dá exatamente 1 × multiplicador.
    const multiplicadorRealizado = (precoUnitarioVendido / itemTabela.precoTabela) * regra.multiplicador;
    const acrescimoPercentual = semRuidoBinario(multiplicadorRealizado * 100 - 100);
    const comissaoNormalPercentual = determinarComissaoNormal(acrescimoPercentual);
    const comissaoFinalPercentual = comissaoNormalPercentual + adicionalVendedorPercentual;
    composicao.push({
      ...comum,
      referencia: 'PRECO_ATUAL_TABELA_ATIVA',
      itemAlteradoEm: dataHora(itemTabela.dataAlteracao, itemTabela.horaAlteracao),
      precoTabela: itemTabela.precoTabela,
      multiplicadorTabela: regra.multiplicador,
      custoReferencia,
      multiplicadorRealizado,
      acrescimoPercentual,
      comissaoNormalPercentual,
      comissaoFinalPercentual,
      comissaoValor: baseComissao * (comissaoFinalPercentual / 100),
    });
  }

  if (problemas.length > 0) return { ok: false, problemas };
  return {
    ok: true,
    itens: composicao,
    baseComissao: composicao.reduce((s, i) => s + i.baseComissao, 0),
    comissaoNormalValor: composicao.reduce((s, i) => s + i.baseComissao * (i.comissaoNormalPercentual / 100), 0),
    comissaoTotal: composicao.reduce((s, i) => s + i.comissaoValor, 0),
  };
}

/** Lançado pelo cálculo compartilhado quando o pedido não pode ser apurado automaticamente. */
export class ErroApuracaoComissao extends Error {
  constructor(readonly problemas: ProblemaItemApuracao[]) {
    super('Pedido fora da apuração automática de comissão.');
    this.name = 'ErroApuracaoComissao';
  }
}

/** Pedido retirado da apuração automática — nunca somado com comissão zero. Sem preço/custo (visível a todos os papéis). */
export interface ExcecaoApuracaoComissao {
  codigoPedido: number;
  numeroPedido: string;
  codigoVendedor: number | null;
  nomeVendedor: string | null;
  nomeCliente: string | null;
  valorProdutos: number;
  problemas: ProblemaItemApuracao[];
}

export function descreverExcecaoApuracao(excecao: ExcecaoApuracaoComissao): string {
  const itens = excecao.problemas.map((p) => `${p.codigo || p.codigoProduto} (tabela ${p.tabela ?? 'não identificada'}): ${p.detalhe}`);
  return `Pedido nº ${excecao.numeroPedido} fora da apuração automática de comissão — ${itens.join(' | ')}`;
}
