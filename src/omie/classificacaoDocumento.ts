/**
 * Classificação Pedido vs Orçamento — regra de negócio crítica.
 *
 * A Omie modela Orçamento e Pedido de Venda como o MESMO tipo de documento
 * (`pedido_venda_produto`), diferenciados apenas pelo campo `cabecalho.etapa`.
 * Os códigos de etapa — e principalmente os RÓTULOS exibidos para cada um —
 * são configuráveis por conta, em Configurações de Venda de Produtos > Kanban
 * de Vendas. Não existe um código de etapa fixo e universal que signifique
 * "isto é um orçamento" em todas as contas Omie.
 *
 * Por isso a classificação nunca usa um código de etapa "chumbado" no código
 * (ex.: `etapa === '00'`, que é o padrão sugerido pela documentação genérica
 * da Omie, mas não uma regra confiável). Em vez disso, consulta a
 * configuração real da conta via `ListarEtapasFaturamento`
 * (`/produtos/etapafat/`, operação "Venda de Produto" — `cCodOperacao` "11")
 * e verifica se a descrição configurada para aquela etapa contém a palavra
 * "orçamento".
 *
 * Verificado em 2026-09-04 contra a conta configurada no `.env` deste
 * projeto: a etapa "00" (marcada como inativa) E a etapa "10" (ativa, em uso
 * corrente) estão AMBAS rotuladas "Orçamento" nesta conta — confirmando que
 * o código de etapa sozinho não seria uma regra confiável, e que a leitura
 * de `ListarEtapasFaturamento` é obrigatória.
 */

export const CODIGO_OPERACAO_VENDA_PRODUTO = '11';

export interface EtapaFaturamento {
  codigo: string;
  descricaoPadrao: string;
  descricao: string;
  inativa: boolean;
}

export type TipoDocumento = 'PEDIDO' | 'ORCAMENTO';

export type ResultadoClassificacao =
  | { tipo: TipoDocumento; ambiguo: false; motivo?: undefined; rotulo: string }
  | { tipo: null; ambiguo: true; motivo: string; rotulo?: undefined };

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Classifica uma etapa como PEDIDO ou ORCAMENTO usando a configuração real
 * do Kanban de vendas da conta (nunca um código de etapa adivinhado). Se a
 * etapa do documento não existir na configuração retornada pela Omie, a
 * classificação fica AMBÍGUA — o chamador deve tratar isso como "não
 * classificar", nunca como um dos dois tipos por padrão.
 */
export function classificarEtapa(
  etapa: string,
  etapasVendaProduto: readonly EtapaFaturamento[],
): ResultadoClassificacao {
  const encontrada = etapasVendaProduto.find((e) => e.codigo === etapa);
  if (encontrada === undefined) {
    return {
      tipo: null,
      ambiguo: true,
      motivo: `A etapa "${etapa}" não foi encontrada na configuração de etapas de Venda de Produto desta conta Omie (ListarEtapasFaturamento) — classificação indeterminada.`,
    };
  }

  const descricao = normalizar(encontrada.descricao || encontrada.descricaoPadrao);
  const tipo: TipoDocumento = descricao.includes('orcamento') ? 'ORCAMENTO' : 'PEDIDO';
  const rotulo = (encontrada.descricao || encontrada.descricaoPadrao || '').trim();
  return { tipo, ambiguo: false, rotulo };
}
