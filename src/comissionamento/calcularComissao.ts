/**
 * Regras de cálculo de comissão — exclusivas de PEDIDO (compra concreta).
 * Nunca aplicadas a ORÇAMENTO (intenção de compra) — ver `classificacaoDocumento.ts`.
 *
 * REGRA CRÍTICA (confirmada explicitamente com o usuário em 2026-09-05): o
 * CUSTO DO PRODUTO NUNCA é abatido para determinar a margem de
 * comissionamento nem a base da comissão. A margem usada aqui é
 * `margemComissionamentoPercentual` = (valor da venda − despesas) ÷ valor
 * da venda, calculada em `calcularMargemComissionamento.ts` — uma métrica
 * DIFERENTE da margem de custo/venda já existente no sistema
 * (`margemVendaTotal`), que continua disponível apenas para análise
 * comercial. A base sobre a qual o percentual final é aplicado é o valor
 * total dos PRODUTOS (`receitaTotal`) — nunca o valor bruto da nota, nunca
 * o custo (decisão de negócio de 2026-09-08).
 */

/**
 * Comissão normal, determinada pela Margem de Comissionamento (regra de
 * negócio confirmada em 2026-09-08 — NUNCA arredondar a margem antes deste
 * cálculo):
 *
 *   margem < 70%        -> 1,00% (piso)
 *   70% <= margem < 90%  -> progressiva: 1,00% + ((margem - 70) × 0,10)
 *   margem >= 90%        -> 3,00% (teto)
 *
 * A progressão soma 0,10 ponto percentual de comissão para cada 1 ponto
 * percentual de margem acima de 70% (ex.: margem 82,50% -> comissão 2,25%).
 * Valores fora de [0, 100] (margem negativa ou acima de 100%) usam o mesmo
 * piso/teto — nunca extrapolam a fórmula linear além dos limites de negócio.
 */
export function determinarComissaoNormal(margemComissionamentoPercentual: number): number {
  if (margemComissionamentoPercentual < 70) return 1;
  if (margemComissionamentoPercentual >= 90) return 3;
  return 1 + (margemComissionamentoPercentual - 70) * 0.1;
}

/**
 * Vendedores que recebem +1,00 ponto percentual de adicional sobre a
 * comissão normal (regra de negócio confirmada em 2026-09-08). O adicional
 * NUNCA influencia a margem de comissionamento nem a comissão normal — é
 * somado por último, depois que a comissão normal já foi determinada pela
 * margem.
 *
 * A Omie não expõe um campo de "vendedor com adicional" no cadastro —
 * comparação por nome normalizado (sem acento, minúsculo, por trecho). Se um
 * `codigo_vendedor` estável for confirmado no futuro para estes vendedores,
 * preferir migrar esta lista para comparação por código (mais robusta a
 * mudança de nome/grafia do que o texto).
 */
export const VENDEDORES_COM_ADICIONAL: readonly string[] = ['sandro', 'horacio', 'roberto rocha'];

function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function ehVendedorComAdicional(nomeVendedor: string | null): boolean {
  if (nomeVendedor === null) return false;
  const normalizado = normalizarTexto(nomeVendedor);
  return VENDEDORES_COM_ADICIONAL.some((nomeConfigurado) => normalizado.includes(nomeConfigurado));
}

/**
 * Vendedores com comissão FIXA, independente de qualquer outra regra
 * (margem, família do produto, adicional) — confirmado com o usuário em
 * 2026-09-10. Prioridade máxima: se o vendedor está aqui, a comissão do
 * pedido inteiro é este percentual, ponto final.
 */
export const VENDEDORES_COMISSAO_FIXA: ReadonlyArray<{ nome: string; percentual: number }> = [
  { nome: 'renato pinto', percentual: 4 },
];

/** Retorna o percentual fixo do vendedor, ou `null` se ele não tem regra de comissão fixa (segue a regra normal). */
export function comissaoFixaDoVendedor(nomeVendedor: string | null): number | null {
  if (nomeVendedor === null) return null;
  const normalizado = normalizarTexto(nomeVendedor);
  const encontrado = VENDEDORES_COMISSAO_FIXA.find((v) => normalizado.includes(v.nome));
  return encontrado?.percentual ?? null;
}

/**
 * Famílias de produto com comissão FIXA (regra de negócio de 2026-09-10):
 * quando um pedido tem item(ns) dessa família, esses itens são segregados do
 * cálculo por margem — a comissão sobre eles é este percentual fixo, e o
 * restante do pedido (produtos de outras famílias) segue a regra normal de
 * margem (ver `relatorioComissionamento.ts`). NUNCA recebe o adicional de
 * vendedor especial — é um valor fixo, não uma "comissão normal" que soma.
 */
export const FAMILIAS_COMISSAO_FIXA: ReadonlyArray<{ nome: string; percentual: number }> = [
  { nome: 'cto promocional', percentual: 1 },
];

/** Retorna o percentual fixo da família, ou `null` se ela não tem regra de comissão fixa. */
export function comissaoFixaDaFamilia(descricaoFamilia: string | null | undefined): number | null {
  if (descricaoFamilia === null || descricaoFamilia === undefined) return null;
  const normalizado = normalizarTexto(descricaoFamilia);
  const encontrado = FAMILIAS_COMISSAO_FIXA.find((f) => normalizado.includes(f.nome));
  return encontrado?.percentual ?? null;
}

export interface ResultadoComissaoVendedor {
  /** Determinada exclusivamente pela margem de comissionamento (seção 1/2). */
  comissaoNormalPercentual: number;
  /** +1,00 quando o vendedor está em `VENDEDORES_COM_ADICIONAL`, senão 0. */
  adicionalVendedorPercentual: number;
  /** comissaoNormalPercentual + adicionalVendedorPercentual — nunca limitada de novo em 3% (seção 8). */
  comissaoFinalPercentual: number;
}

/**
 * Fluxo completo (seção 7 do requisito): margem -> comissão normal ->
 * identifica vendedor especial -> soma o adicional -> comissão final. Nunca
 * usa o adicional para influenciar a comissão normal (seção 3).
 */
export function calcularComissaoVendedor(
  margemComissionamentoPercentual: number,
  nomeVendedor: string | null,
): ResultadoComissaoVendedor {
  const comissaoNormalPercentual = determinarComissaoNormal(margemComissionamentoPercentual);
  const adicionalVendedorPercentual = ehVendedorComAdicional(nomeVendedor) ? 1 : 0;
  return {
    comissaoNormalPercentual,
    adicionalVendedorPercentual,
    comissaoFinalPercentual: comissaoNormalPercentual + adicionalVendedorPercentual,
  };
}

/** valor_comissao = base_comissao × percentual_comissao (seção 6). Sem arredondamento intermediário. */
export function calcularComissaoTotal(baseComissao: number, percentualComissao: number): number {
  return baseComissao * (percentualComissao / 100);
}

export type SituacaoComissaoParcela = 'AGUARDANDO_TITULO' | 'PENDENTE_DE_BAIXA' | 'ELEGIVEL';

export interface ParcelaFinanceira {
  numeroParcela: string | null;
  valorBruto: number;
  /** null = nenhum título localizado na Omie para esta parcela (seção 40: nunca inventar). */
  statusTitulo: string | null;
  /** Número da nota fiscal do título de origem — identifica de qual fatura (parcial ou não) esta parcela veio (regra de 2026-09-10, ver `numeroFaturaParcial` em `ParcelaComissao`). */
  numeroNotaFiscal?: string | null;
}

export interface ParcelaComissao {
  numeroParcela: string | null;
  valorBrutoParcela: number;
  /** Fração da base de comissão do pedido atribuída a esta parcela, proporcional ao seu peso no valor bruto total das parcelas (seção 14/16). */
  valorBaseParcela: number;
  comissaoParcela: number;
  statusTitulo: string | null;
  /** true somente quando `statusTitulo === 'RECEBIDO'` — nunca assumido a partir de outro status (seção 17/18). */
  baixado: boolean;
  situacao: SituacaoComissaoParcela;
  /** Número da nota fiscal do título de origem, repassado de `ParcelaFinanceira` — `null`/ausente quando não localizado. */
  numeroNotaFiscal?: string | null;
  /**
   * Rótulo de identificação da fatura parcial (ex.: "154/1", "154/2"), igual
   * ao usado no Kanban da Omie — presente somente quando o pedido tem MAIS
   * de uma nota fiscal distinta entre suas parcelas (faturamento parcial,
   * regra de 2026-09-10, ver `rotularFaturamentoParcial` em
   * `relatorioComissionamento.ts`). `null`/ausente para pedidos faturados
   * numa única nota.
   */
  numeroFaturaParcial?: string | null;
}

/**
 * Distribui a comissão total entre as parcelas financeiras do pedido,
 * proporcionalmente ao valor bruto real de cada uma (seção 14/16) — nunca
 * dividindo igualmente quando os valores das parcelas diferem.
 *
 * "BAIXADO — COMISSÃO ELEGÍVEL" (não "COMISSÃO PAGA"): a Omie confirma a
 * baixa do título financeiro, mas não confirma que a comissão em si já foi
 * repassada ao vendedor — essa é uma etapa de folha de pagamento fora do
 * escopo consultável na Omie (seção 18).
 */
export function distribuirComissaoPorParcelas(
  baseComissaoTotal: number,
  percentualComissao: number,
  parcelas: readonly ParcelaFinanceira[],
): ParcelaComissao[] {
  const valorBrutoTotalParcelas = parcelas.reduce((soma, p) => soma + p.valorBruto, 0);

  return parcelas.map((parcela) => {
    const fracao = valorBrutoTotalParcelas === 0 ? 0 : parcela.valorBruto / valorBrutoTotalParcelas;
    const valorBaseParcela = fracao * baseComissaoTotal;
    const comissaoParcela = calcularComissaoTotal(valorBaseParcela, percentualComissao);
    const baixado = parcela.statusTitulo === 'RECEBIDO';

    let situacao: SituacaoComissaoParcela;
    if (parcela.statusTitulo === null) {
      situacao = 'AGUARDANDO_TITULO';
    } else if (baixado) {
      situacao = 'ELEGIVEL';
    } else {
      situacao = 'PENDENTE_DE_BAIXA';
    }

    return {
      numeroParcela: parcela.numeroParcela,
      valorBrutoParcela: parcela.valorBruto,
      valorBaseParcela,
      comissaoParcela,
      statusTitulo: parcela.statusTitulo,
      baixado,
      situacao,
      numeroNotaFiscal: parcela.numeroNotaFiscal ?? null,
    };
  });
}
