/**
 * Regras de cálculo de comissão — exclusivas de PEDIDO (compra concreta).
 * Nunca aplicadas a ORÇAMENTO (intenção de compra) — ver `classificacaoDocumento.ts`.
 *
 * ORIGEM DO PERCENTUAL (regra de 2026-10-06, substitui a margem global do pedido): a comissão
 * normal é determinada POR ITEM, a partir do percentual de acréscimo sobre o custo de referência
 * derivado do Preço da Tabela da Omie — ver `comissaoPorTabela.ts`. A margem de comissionamento
 * (`calcularMargemComissionamento.ts`) continua calculada só como informação para administradores;
 * nunca mais define a faixa. O custo do produto (estoque/contábil) nunca entra no cálculo.
 */

/**
 * Progressão da comissão normal (regra de negócio confirmada em 2026-09-08 — NUNCA arredondar a
 * entrada antes deste cálculo). Desde 2026-10-06 a entrada é o PERCENTUAL DE ACRÉSCIMO do item,
 * (multiplicador realizado − 1) × 100, e não mais a margem do pedido:
 *
 *   acréscimo < 70%        -> 1,00% (piso)          — multiplicador até 1,70
 *   70% <= acréscimo < 90%  -> 1,00% + ((acréscimo - 70) × 0,10)
 *   acréscimo >= 90%        -> 3,00% (teto)          — multiplicador 1,90 ou mais
 *
 * Ex.: multiplicador 1,8421 -> acréscimo 84,21% -> comissão 2,421%. Valores fora da faixa usam o
 * mesmo piso/teto — nunca extrapolam a fórmula linear.
 */
export function determinarComissaoNormal(percentualAcrescimo: number): number {
  if (percentualAcrescimo < 70) return 1;
  if (percentualAcrescimo >= 90) return 3;
  return 1 + (percentualAcrescimo - 70) * 0.1;
}

/**
 * Vendedores que recebem +1,00 ponto percentual de adicional sobre a
 * comissão normal (regra de negócio confirmada em 2026-09-08). O adicional
 * NUNCA influencia a comissão normal — é somado por último, item a item,
 * depois que a comissão normal do item já foi determinada (inclusive sobre a
 * comissão fixa da tabela 001, como já era com a família CTO Promocional).
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
 * (tabela de preços, adicional) — confirmado com o usuário em 2026-09-10.
 * Prioridade máxima: se o vendedor está aqui, a comissão do pedido inteiro é
 * este percentual sobre o valor dos produtos, ponto final — nem consulta as
 * tabelas de preço.
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

export interface ResultadoComissaoVendedor {
  /** Determinada exclusivamente pelo percentual de entrada (acréscimo do item) — seção 1/2. */
  comissaoNormalPercentual: number;
  /** +1,00 quando o vendedor está em `VENDEDORES_COM_ADICIONAL`, senão 0. */
  adicionalVendedorPercentual: number;
  /** comissaoNormalPercentual + adicionalVendedorPercentual — nunca limitada de novo em 3% (seção 8). */
  comissaoFinalPercentual: number;
}

/**
 * Fluxo (seção 7 do requisito): percentual de acréscimo -> comissão normal ->
 * identifica vendedor especial -> soma o adicional -> comissão final. Nunca
 * usa o adicional para influenciar a comissão normal (seção 3).
 */
export function calcularComissaoVendedor(
  percentualAcrescimo: number,
  nomeVendedor: string | null,
): ResultadoComissaoVendedor {
  const comissaoNormalPercentual = determinarComissaoNormal(percentualAcrescimo);
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
  codigoLancamentoOmie?: number;
  numeroParcela: string | null;
  valorBruto: number;
  /** null = nenhum título localizado na Omie para esta parcela (seção 40: nunca inventar). */
  statusTitulo: string | null;
  /** Número da nota fiscal do título de origem — identifica de qual fatura (parcial ou não) esta parcela veio (regra de 2026-09-10, ver `numeroFaturaParcial` em `ParcelaComissao`). */
  numeroNotaFiscal?: string | null;
  /** Vencimento do título (dd/mm/aaaa) — só repassado; nunca entra no cálculo. */
  dataVencimento?: string | null;
  /** Emissão da fatura do título (dd/mm/aaaa) — só repassado; nunca entra no cálculo. */
  dataEmissao?: string | null;
}

export interface ParcelaComissao {
  codigoLancamentoOmie?: number;
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
  /** Vencimento do título (dd/mm/aaaa), repassado de `ParcelaFinanceira` — critério de "parcela no período" (regra de 2026-09-28). */
  dataVencimento?: string | null;
  /** Emissão da fatura do título (dd/mm/aaaa), repassada de `ParcelaFinanceira` — data de faturamento da parcela. */
  dataEmissao?: string | null;
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
      ...(parcela.codigoLancamentoOmie !== undefined ? { codigoLancamentoOmie: parcela.codigoLancamentoOmie } : {}),
      numeroParcela: parcela.numeroParcela,
      valorBrutoParcela: parcela.valorBruto,
      valorBaseParcela,
      comissaoParcela,
      statusTitulo: parcela.statusTitulo,
      baixado,
      situacao,
      numeroNotaFiscal: parcela.numeroNotaFiscal ?? null,
      dataVencimento: parcela.dataVencimento ?? null,
      dataEmissao: parcela.dataEmissao ?? null,
    };
  });
}
