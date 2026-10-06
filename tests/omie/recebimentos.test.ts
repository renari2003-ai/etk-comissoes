import { describe, expect, it } from 'vitest';
import { normalizarBaixas, type MovimentoFinanceiroOmie } from '../../src/omie/recebimentos.js';

const movimento: MovimentoFinanceiroOmie = { detalhes: { nCodBaixa: 1, nCodTitulo: 10, cNatureza: 'R', cStatus: 'PAGTOPARCIAL', dDtPagamento: '10/09/2026', nValorMovCC: 200 } };

describe('normalizarBaixas — contrato BXCR Omie', () => {
  it('usa o valor de cada baixa e deduplica pelo código de baixa', () => {
    expect(normalizarBaixas([movimento, movimento])).toEqual([{ codigoBaixa: 1, codigoLancamentoOmie: 10, dataRecebimento: '10/09/2026', valorRecebido: 200, juros: 0, multa: 0, codigoVendedor: null }]);
  });
  it('nunca substitui valor ausente pelo acumulado do título e rejeita identificadores ausentes', () => {
    expect(() => normalizarBaixas([{ detalhes: { ...movimento.detalhes, nValorMovCC: undefined } }])).toThrow('sem valor recebido');
    expect(() => normalizarBaixas([{ detalhes: { ...movimento.detalhes, nCodBaixa: undefined } }])).toThrow('sem código');
  });
  it('ignora baixa exclusiva de desconto sem confundir com o recebimento do mesmo título', () => {
    const desconto = { detalhes: { ...movimento.detalhes, nCodBaixa: 2, nValorMovCC: undefined, nDesconto: 375.03 }, resumo: { nValPago: 0 } };
    expect(normalizarBaixas([movimento, desconto])).toHaveLength(1);
    expect(normalizarBaixas([movimento, desconto])[0].valorRecebido).toBe(200);
  });
  it('continua bloqueando valor ausente quando há pagamento ou movimento bancário', () => {
    const detalhes = { ...movimento.detalhes, nValorMovCC: undefined, nDesconto: 10 };
    for (const invalido of [
      { detalhes, resumo: { nValPago: 200 } },
      { detalhes },
      { detalhes: { ...detalhes, nCodMovCC: 42 }, resumo: { nValPago: 0 } },
      { detalhes: { ...detalhes, nDesconto: 0 }, resumo: { nValPago: 0 } },
    ]) expect(() => normalizarBaixas([invalido])).toThrow('sem valor recebido');
  });
  it('não considera contas a pagar nem movimentos cancelados', () => {
    expect(normalizarBaixas([{ detalhes: { ...movimento.detalhes, cNatureza: 'P' } }, { detalhes: { ...movimento.detalhes, cStatus: 'CANCELADO' } }])).toEqual([]);
  });
  it('bloqueia estornos e baixas conflitantes para revisão', () => {
    expect(() => normalizarBaixas([{ detalhes: { ...movimento.detalhes, nValorMovCC: -200 } }])).toThrow('estorno');
    expect(() => normalizarBaixas([movimento, { detalhes: { ...movimento.detalhes, nValorMovCC: 300 } }])).toThrow('conflitantes');
  });
  it('guarda cCodVendedor do movimento; ausente ou inválido vira null (nunca inventado)', () => {
    expect(normalizarBaixas([{ detalhes: { ...movimento.detalhes, cCodVendedor: 2386248166 } }])[0]?.codigoVendedor).toBe(2386248166);
    for (const invalido of [undefined, 0, -1, 1.5]) {
      expect(normalizarBaixas([{ detalhes: { ...movimento.detalhes, cCodVendedor: invalido } }])[0]?.codigoVendedor).toBeNull();
    }
  });
});
