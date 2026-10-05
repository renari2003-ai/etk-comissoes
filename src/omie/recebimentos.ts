/** Contrato de leitura: https://app.omie.com.br/api/v1/financas/mf/ (BXCR).
 * Cada registro é uma baixa; resumo.nValPago é acumulado do título e NÃO é usado.
 */
export interface BaixaRecebimento {
  codigoBaixa: number;
  codigoLancamentoOmie: number;
  dataRecebimento: string;
  valorRecebido: number;
  juros: number;
  multa: number;
}

export interface MovimentoFinanceiroOmie {
  detalhes?: {
    nCodBaixa?: number;
    nCodTitulo?: number;
    cNatureza?: string;
    cStatus?: string;
    dDtPagamento?: string;
    nValorMovCC?: number;
    nJuros?: number;
    nMulta?: number;
    nDesconto?: number;
    nCodMovCC?: number;
  };
  resumo?: { nValPago?: number };
}

/** Falha explícita se uma baixa não puder ser identificada/valorada com segurança. */
export function normalizarBaixas(movimentos: MovimentoFinanceiroOmie[]): BaixaRecebimento[] {
  const baixas = new Map<number, BaixaRecebimento>();
  for (const movimento of movimentos) {
    const d = movimento.detalhes;
    if (!d || d.cNatureza !== 'R' || d.cStatus === 'CANCELADO') continue;
    if (!Number.isSafeInteger(d.nCodBaixa) || (d.nCodBaixa ?? 0) <= 0 ||
        !Number.isSafeInteger(d.nCodTitulo) || (d.nCodTitulo ?? 0) <= 0 ||
        !d.dDtPagamento) {
      throw new Error('A Omie retornou uma baixa sem código de identificação ou data de recebimento. Não é possível apurar a comissão com segurança.');
    }
    // Baixa somente de desconto: sem movimento bancário e total pago explicitamente
    // zero. Não é dinheiro recebido e não libera comissão. Nunca usar o resumo
    // acumulado como valor de uma baixa nem considerar qualquer valor ausente zero.
    if (d.nValorMovCC === undefined && !d.nCodMovCC &&
        movimento.resumo?.nValPago === 0 && Number.isFinite(d.nDesconto) &&
        d.nDesconto! > 0 && (d.nJuros ?? 0) === 0 && (d.nMulta ?? 0) === 0) continue;
    if (!Number.isFinite(d.nValorMovCC) ||
        !Number.isFinite(d.nJuros ?? 0) || !Number.isFinite(d.nMulta ?? 0)) {
      throw new Error(`A Omie retornou a baixa ${d.nCodBaixa} do título ${d.nCodTitulo} sem valor recebido válido. Não é possível apurar a comissão com segurança.`);
    }
    // Estorno exige conciliação com a baixa original; nunca pagar ignorando a reversão.
    if (d.nValorMovCC! < 0) throw new Error('Há estorno financeiro no período. Revise a conciliação das baixas antes de apurar a comissão.');
    if (d.nValorMovCC! === 0) continue;
    const baixa: BaixaRecebimento = {
      codigoBaixa: d.nCodBaixa!, codigoLancamentoOmie: d.nCodTitulo!,
      dataRecebimento: d.dDtPagamento, valorRecebido: d.nValorMovCC!,
      juros: d.nJuros ?? 0, multa: d.nMulta ?? 0,
    };
    const anterior = baixas.get(baixa.codigoBaixa);
    if (anterior && JSON.stringify(anterior) !== JSON.stringify(baixa)) {
      throw new Error('A Omie retornou valores conflitantes para a mesma baixa financeira.');
    }
    baixas.set(baixa.codigoBaixa, baixa);
  }
  return [...baixas.values()];
}
