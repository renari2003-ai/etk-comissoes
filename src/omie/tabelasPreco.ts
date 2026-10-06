/**
 * Contrato de leitura: https://app.omie.com.br/api/v1/produtos/tabelaprecos/ (`ListarTabelasPreco`
 * e `ListarTabelaItens`) — SOMENTE consulta. Estrutura confirmada contra a API real em 2026-10-06:
 *   - `nCodTabPreco`: identificador interno (ex.: 2404412334); `cCodigo`: código comercial exibido na
 *     tela ("001", "002", "003"); `cNome`: nome (ex.: "TABELA DE VENDA - 07/26"); `cAtiva`: "S"/"N".
 *   - Item: `nCodProd` (= `codigo_produto` do pedido), `cCodigoProduto` (código PA),
 *     `nValorTabela` = coluna "Preço da Tabela" da tela (nunca `nValorOriginal` = "Preço Original").
 *   - `itemInfo.dAltItem`/`hAltItem`: data/hora da última alteração do ITEM na tabela.
 *   - `info.dAlt`/`hAlt` (cabeçalho): data/hora da última alteração da TABELA (ex.: 003 em
 *     27/08/2026 10:55:09).
 *   Nenhuma das duas informa O QUE mudou — não distinguem alteração de preço de outra alteração
 *   cadastral — e não há histórico de preços na API. Desde a decisão de 2026-10-06 essas datas são
 *   só informativas: a apuração usa o preço ATUAL da tabela ativa (ver `comissaoPorTabela.ts`).
 */

export interface ItemTabelaPreco {
  codigoProduto: number;
  codigoProdutoTexto: string;
  /** "Preço da Tabela" (`nValorTabela`); `null` quando ausente/não numérico — nunca substituído por outro preço. */
  precoTabela: number | null;
  /** dd/mm/aaaa da última alteração do item na tabela; `null` quando a Omie não informou. */
  dataAlteracao: string | null;
  /** hh:mm:ss correspondente; `null` quando ausente. */
  horaAlteracao: string | null;
}

export interface TabelaPreco {
  idInterno: number;
  codigoComercial: string;
  nome: string;
  ativa: boolean;
  /** dd/mm/aaaa da última alteração da tabela (`info.dAlt`); `null` quando a Omie não informou. */
  dataAlteracao: string | null;
  /** hh:mm:ss correspondente (`info.hAlt`); `null` quando ausente. */
  horaAlteracao: string | null;
  /** Momento (ISO) em que esta leitura foi feita na Omie — gravado junto no cache; ausente em dados antigos. */
  consultadoEm?: string | null;
  /** Itens só são consultados para tabelas ativas — tabela inativa vem com lista vazia. */
  itens: ItemTabelaPreco[];
}

export interface TabelaPrecoOmie {
  nCodTabPreco?: number;
  cCodigo?: string;
  cNome?: string;
  cAtiva?: string;
  info?: { dAlt?: string; hAlt?: string };
}

export interface ItemTabelaPrecoOmie {
  nCodProd?: number;
  cCodigoProduto?: string;
  nValorTabela?: number;
  itemInfo?: { dAltItem?: string; hAltItem?: string };
}

const DATA = /^\d{2}\/\d{2}\/\d{4}$/;
const HORA = /^\d{2}:\d{2}(:\d{2})?$/;

function textoOuNulo(valor: string | undefined, formato: RegExp): string | null {
  const texto = (valor ?? '').trim();
  return formato.test(texto) ? texto : null;
}

/** Falha explícita quando o cabeçalho da tabela não permite identificá-la com segurança. */
export function normalizarTabela(registro: TabelaPrecoOmie): Omit<TabelaPreco, 'itens'> {
  const id = registro.nCodTabPreco;
  const codigo = (registro.cCodigo ?? '').trim();
  if (!Number.isSafeInteger(id) || (id ?? 0) <= 0 || codigo === '' || (registro.cAtiva !== 'S' && registro.cAtiva !== 'N')) {
    throw new Error('A Omie retornou uma tabela de preços sem identificação válida. Não é possível apurar a comissão com segurança.');
  }
  return {
    idInterno: id!,
    codigoComercial: codigo,
    nome: (registro.cNome ?? '').trim(),
    ativa: registro.cAtiva === 'S',
    dataAlteracao: textoOuNulo(registro.info?.dAlt, DATA),
    horaAlteracao: textoOuNulo(registro.info?.hAlt, HORA),
  };
}

/** Item sem produto identificável é erro; preço ausente/inválido vira `null` e a apuração decide (exceção do pedido). */
export function normalizarItemTabela(registro: ItemTabelaPrecoOmie): ItemTabelaPreco {
  if (!Number.isSafeInteger(registro.nCodProd) || (registro.nCodProd ?? 0) <= 0) {
    throw new Error('A Omie retornou um item de tabela de preços sem código de produto. Não é possível apurar a comissão com segurança.');
  }
  return {
    codigoProduto: registro.nCodProd!,
    codigoProdutoTexto: (registro.cCodigoProduto ?? '').trim(),
    precoTabela: typeof registro.nValorTabela === 'number' && Number.isFinite(registro.nValorTabela) ? registro.nValorTabela : null,
    dataAlteracao: textoOuNulo(registro.itemInfo?.dAltItem, DATA),
    horaAlteracao: textoOuNulo(registro.itemInfo?.hAltItem, HORA),
  };
}
