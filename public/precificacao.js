/**
 * Simulação de precificação (markup editável) — cálculo puro, sem DOM.
 *
 * Camada adicional de simulação, exclusiva da categoria ORÇAMENTO (intenção
 * de compra — nunca aplicada a Pedido, que já representa uma venda
 * concretizada). Nunca envia nada à Omie: é puramente local ao navegador.
 *
 * Cadeia de cálculo obrigatória, sem arredondamento intermediário:
 *   custo_unitario × markup_editavel = preco_venda
 *   preco_venda × quantidade        = preco_total (= subtotal do item)
 *   soma dos subtotais               = valor_total_orcamento
 *
 * Decisões explícitas (onde a especificação previa ambiguidade):
 * - Markup zero é um valor válido (preco_venda = 0), não um erro — a regra
 *   comercial adotada aqui é permitir markup >= 0.
 * - O "preço de venda" usado para calcular o markup editável INICIAL de cada
 *   item é o `valorUnitario` já existente no item (preço unitário original
 *   do orçamento na Omie) — não um novo campo. Enquanto o usuário não edita
 *   nada, o markup editável reflete exatamente o markup implícito no preço
 *   original.
 */
/**
 * Markup editável inicial = preco_venda_original / custo_unitario.
 * Nunca divide por zero: custo zero (ou não finito) resulta em `null`,
 * nunca `Infinity`/`NaN` (seção 14).
 */
export function calcularMarkupInicial(precoVendaOriginal, custoUnitario) {
    if (!Number.isFinite(custoUnitario) || !Number.isFinite(precoVendaOriginal) || custoUnitario === 0) {
        return null;
    }
    return precoVendaOriginal / custoUnitario;
}
/**
 * Interpreta o texto digitado pelo usuário num campo de valor decimal
 * (markup editável, custo unitário manual). Aceita vírgula ou ponto como
 * separador decimal (seção 16) e também um separador sem dígito antes dele
 * (ex.: ",61" ou ".61" para 0,61) — forma comum de digitar centavos sem o
 * "0" na frente, que antes era rejeitada como inválida. Retorna o motivo
 * específico de invalidade em vez de lançar exceção, para a interface poder
 * explicar o problema sem quebrar o fluxo.
 */
export function interpretarMarkupDigitado(textoDigitado) {
    const texto = textoDigitado.trim();
    if (texto === '')
        return 'nao_numerico';
    const normalizado = texto.replace(',', '.');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalizado))
        return 'nao_numerico';
    const numero = Number(normalizado);
    if (!Number.isFinite(numero))
        return 'nao_numerico';
    if (numero < 0)
        return 'negativo';
    return numero;
}
/**
 * Calcula preço de venda, preço total e subtotal a partir do markup
 * editável — sem nenhum arredondamento intermediário (seção 19). Quando
 * `markupEditavel` é `null` (sem valor calculável/informado), os três
 * resultados também são `null`: o sistema nunca inventa um preço.
 */
export function calcularPrecificacaoItem(item, markupEditavel) {
    if (markupEditavel === null) {
        return { markupEditavel: null, precoVenda: null, precoTotal: null, subtotal: null };
    }
    const precoVenda = item.custoUnitario * markupEditavel;
    const precoTotal = item.quantidade * precoVenda;
    return { markupEditavel, precoVenda, precoTotal, subtotal: precoTotal };
}
/** Soma dos subtotais de todos os itens = valor total do orçamento (seção 10). Itens sem subtotal calculável contribuem 0. */
export function calcularValorTotalOrcamento(subtotais) {
    return subtotais.reduce((soma, subtotal) => soma + (subtotal ?? 0), 0);
}
