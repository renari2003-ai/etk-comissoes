import type { PedidoCalculado } from '../calculo/tipos.js';

const BOM_UTF8 = '﻿';
const SEPARADOR = ';';

function formatarNumero(valor: number | null): string {
  if (valor === null) return '';
  return valor.toString().replace('.', ',');
}

function campoCsv(valor: string): string {
  if (valor.includes(SEPARADOR) || valor.includes('"') || valor.includes('\n')) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

/**
 * Gera o conteúdo CSV do pedido calculado, com BOM UTF-8 e separador ";"
 * para abrir corretamente no Excel em português (seção 32).
 */
export function gerarCsv(pedido: PedidoCalculado): string {
  const linhaTipoDocumento =
    pedido.tipoDocumento === 'ORCAMENTO'
      ? 'Tipo de documento: ORÇAMENTO (intenção de compra — valores abaixo NÃO são receita concretizada)'
      : pedido.tipoDocumento === 'PEDIDO'
        ? 'Tipo de documento: PEDIDO (compra concreta)'
        : `Tipo de documento: NÃO CLASSIFICADO (${pedido.motivoClassificacaoAmbigua ?? 'etapa não reconhecida'})`;

  const cabecalho = [
    'codigo_produto',
    'codigo',
    'descricao',
    'quantidade',
    'valor_unitario',
    'receita',
    'custo_unitario',
    'custo_total',
    'margem_valor',
    'margem_venda_percentual',
    'markup_custo_percentual',
    'origem_custo',
    'alertas',
  ];

  const linhas = pedido.itens.map((item) =>
    [
      String(item.codigoProduto),
      campoCsv(item.codigo),
      campoCsv(item.descricao),
      formatarNumero(item.quantidade),
      formatarNumero(item.valorUnitario),
      formatarNumero(item.receita),
      formatarNumero(item.custoUnitario),
      formatarNumero(item.custoTotal),
      formatarNumero(item.margemValor),
      formatarNumero(item.margemVendaPercentual),
      formatarNumero(item.markupCustoPercentual),
      campoCsv(item.origemCusto),
      campoCsv(item.alertas.join(', ')),
    ].join(SEPARADOR),
  );

  const linhaTotais = [
    '',
    '',
    'TOTAL',
    '',
    '',
    formatarNumero(pedido.totais.receitaTotal),
    '',
    formatarNumero(pedido.totais.custoTotal),
    formatarNumero(pedido.totais.margemTotal),
    formatarNumero(pedido.totais.margemVendaTotal),
    formatarNumero(pedido.totais.markupCustoTotal),
    '',
    `${pedido.totais.itensSemCusto} item(ns) sem custo`,
  ].join(SEPARADOR);

  return BOM_UTF8 + [linhaTipoDocumento, cabecalho.join(SEPARADOR), ...linhas, linhaTotais].join('\r\n');
}
