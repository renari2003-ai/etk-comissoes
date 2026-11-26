import { describe, expect, it } from 'vitest';
import { dataIsoParaOmie, dataOmieParaIso, itensDosRecebimentos, janelaDeMeses, ultimaNotaPorProduto } from '../../src/omie/notasEntrada.js';

function recebimento(sobrescrever: Record<string, unknown> = {}, itens: unknown[] = [itemNota()]) {
  return {
    cabec: { nIdReceb: 500, nIdFornecedor: 77, cNumeroNFe: '1234', dEmissaoNFe: '10/11/2026', cModeloNFe: '55' },
    infoAdicionais: { dRegistro: '12/11/2026' },
    infoCadastro: { cRecebido: 'S', cCancelada: 'N' },
    itensRecebimento: itens,
    ...sobrescrever,
  };
}
function itemNota(sobrescrever: Record<string, unknown> = {}) {
  return {
    itensCabec: { nIdProduto: 20, nQtdeNFe: 10, nPrecoUnit: 12.86, vTotalItem: 128.6 },
    itensICMS: { nAliq: 18, nValor: 23.15 },
    itensIPI: { nAliqIPI: 5, nValIPI: 6.43 },
    ...sobrescrever,
  };
}

describe('notas de entrada do Omie (ListarRecebimentos) — interpretação', () => {
  it('lê o item com as alíquotas destacadas e a data de entrada', () => {
    expect(itensDosRecebimentos([recebimento()])).toEqual([
      { idProduto: 20, idRecebimento: 500, idFornecedor: 77, numeroNfe: '1234', data: '2026-11-12', quantidade: 10, precoUnitario: 12.86, aliquotaIcms: 18, aliquotaIpi: 5, temIcmsSt: false, legivel: true },
    ]);
  });

  it('ignora nota não concluída, cancelada, CT-e e registro sem cabeçalho', () => {
    expect(itensDosRecebimentos([recebimento({ infoCadastro: { cRecebido: 'N' } })])).toEqual([]);
    expect(itensDosRecebimentos([recebimento({ infoCadastro: { cRecebido: 'S', cCancelada: 'S' } })])).toEqual([]);
    expect(itensDosRecebimentos([recebimento({ cabec: { nIdReceb: 1, dEmissaoNFe: '10/11/2026', cModeloNFe: '57' } })])).toEqual([]);
    expect(itensDosRecebimentos([{ infoCadastro: { cRecebido: 'S' } }, null, 'x'])).toEqual([]);
    expect(itensDosRecebimentos(undefined)).toEqual([]);
  });

  it('sem bloco de IPI/ICMS = 0; alíquota ilegível marca o item (nunca vira 0 em silêncio); Simples usa nAliqSN', () => {
    const [semIpi] = itensDosRecebimentos([recebimento({}, [itemNota({ itensIPI: undefined })])]);
    expect(semIpi!.aliquotaIpi).toBe(0);
    const [ilegivel] = itensDosRecebimentos([recebimento({}, [itemNota({ itensIPI: { nAliqIPI: 'x' } })])]);
    expect(ilegivel).toMatchObject({ legivel: false });
    expect(ultimaNotaPorProduto([ilegivel!]).size).toBe(0);
    const [simples] = itensDosRecebimentos([recebimento({}, [itemNota({ itensICMS: undefined, itensICMSSN: { nAliqSN: 1.25 } })])]);
    expect(simples!.aliquotaIcms).toBe(1.25);
    const [comSt] = itensDosRecebimentos([recebimento({}, [itemNota({ itensICMSST: { nValorST: 3 } })])]);
    expect(comSt!.temIcmsSt).toBe(true);
    expect(itensDosRecebimentos([recebimento({}, [itemNota({ itensCabec: { nIdProduto: 20, nQtdeNFe: 0, nPrecoUnit: 1 } })])])).toEqual([]);
  });

  it('sem data de entrada usa a de emissão; data impossível tira a nota', () => {
    expect(itensDosRecebimentos([recebimento({ infoAdicionais: {} })])[0]!.data).toBe('2026-11-10');
    expect(itensDosRecebimentos([recebimento({ infoAdicionais: {}, cabec: { nIdReceb: 500, dEmissaoNFe: '31/02/2026' } })])).toEqual([]);
  });

  it('fica a nota mais recente de cada produto (empate: maior id de recebimento)', () => {
    const itens = [
      ...itensDosRecebimentos([recebimento()]),
      ...itensDosRecebimentos([recebimento({ cabec: { nIdReceb: 400, dEmissaoNFe: '01/10/2026' }, infoAdicionais: { dRegistro: '02/10/2026' } }, [itemNota({ itensIPI: { nAliqIPI: 10 } })])]),
      ...itensDosRecebimentos([recebimento({ cabec: { nIdReceb: 600, dEmissaoNFe: '12/11/2026' } }, [itemNota({ itensIPI: { nAliqIPI: 0 } })])]),
    ];
    const mapa = ultimaNotaPorProduto(itens);
    expect(mapa.get(20)).toMatchObject({ idRecebimento: 600, aliquotaIpi: 0 });
  });

  it('nota mais recente ilegível: o produto fica sem nota ("estimado"), nunca volta para a nota mais antiga', () => {
    const antiga = itensDosRecebimentos([recebimento({ cabec: { nIdReceb: 400, dEmissaoNFe: '01/10/2026' }, infoAdicionais: { dRegistro: '02/10/2026' } })]);
    const nova = itensDosRecebimentos([recebimento({}, [itemNota({ itensIPI: { nAliqIPI: 'x' } })])]);
    expect(ultimaNotaPorProduto([...antiga, ...nova]).has(20)).toBe(false);
    // Ilegível mais ANTIGA não atrapalha a nota nova legível.
    const velhaIlegivel = itensDosRecebimentos([recebimento({ cabec: { nIdReceb: 400, dEmissaoNFe: '01/10/2026' }, infoAdicionais: { dRegistro: '02/10/2026' } }, [itemNota({ itensIPI: { nAliqIPI: 'x' } })])]);
    expect(ultimaNotaPorProduto([...velhaIlegivel, ...itensDosRecebimentos([recebimento()])]).get(20)).toMatchObject({ idRecebimento: 500, legivel: true });
  });

  it('datas: conversão nos dois sentidos e janela de 6 meses (fim de mês recua para o último dia)', () => {
    expect(dataOmieParaIso('05/01/2026')).toBe('2026-01-05');
    expect(dataOmieParaIso('2026-01-05')).toBeNull();
    expect(dataIsoParaOmie('2026-01-05')).toBe('05/01/2026');
    expect(janelaDeMeses('2026-11-26', 6)).toEqual({ de: '2026-05-26', ate: '2026-11-26' });
    expect(janelaDeMeses('2026-08-31', 6)).toEqual({ de: '2026-02-28', ate: '2026-08-31' });
    expect(janelaDeMeses('2026-03-15', 6)).toEqual({ de: '2025-09-15', ate: '2026-03-15' });
  });
});
