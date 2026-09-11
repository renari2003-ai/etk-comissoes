import { describe, expect, it } from 'vitest';
import {
  calcularComissaoTotal,
  calcularComissaoVendedor,
  comissaoFixaDaFamilia,
  comissaoFixaDoVendedor,
  determinarComissaoNormal,
  distribuirComissaoPorParcelas,
  ehVendedorComAdicional,
} from '../../src/comissionamento/calcularComissao.js';

describe('determinarComissaoNormal — piso abaixo de 70% (regra de 2026-09-08)', () => {
  it('margem 50% -> 1%', () => {
    expect(determinarComissaoNormal(50)).toBe(1);
  });
  it('margem 69,99% -> 1%', () => {
    expect(determinarComissaoNormal(69.99)).toBe(1);
  });
  it('margem 0% -> 1%', () => {
    expect(determinarComissaoNormal(0)).toBe(1);
  });
});

describe('determinarComissaoNormal — progressão entre 70% e 90%', () => {
  it.each([
    [70, 1],
    [71, 1.1],
    [72, 1.2],
    [73, 1.3],
    [74, 1.4],
    [75, 1.5],
    [76, 1.6],
    [77, 1.7],
    [78, 1.8],
    [79, 1.9],
    [80, 2],
    [81, 2.1],
    [82, 2.2],
    [83, 2.3],
    [84, 2.4],
    [85, 2.5],
    [86, 2.6],
    [87, 2.7],
    [88, 2.8],
    [89, 2.9],
  ])('margem %s%% -> comissão %s%%', (margem, comissaoEsperada) => {
    expect(determinarComissaoNormal(margem)).toBeCloseTo(comissaoEsperada, 10);
  });

  it('margem decimal 82,50% -> comissão 2,25% (exemplo do requisito, seção 2)', () => {
    expect(determinarComissaoNormal(82.5)).toBeCloseTo(2.25, 10);
  });

  it('nunca arredonda a margem antes do cálculo: 82,53% -> 2,253%', () => {
    expect(determinarComissaoNormal(82.53)).toBeCloseTo(2.253, 10);
  });
});

describe('determinarComissaoNormal — teto de 90% ou mais', () => {
  it('margem 90% -> 3%', () => {
    expect(determinarComissaoNormal(90)).toBe(3);
  });
  it('margem 95% -> 3%', () => {
    expect(determinarComissaoNormal(95)).toBe(3);
  });
  it('margem acima de 100% (ex.: divergência de dados) -> nunca extrapola o teto de 3%', () => {
    expect(determinarComissaoNormal(150)).toBe(3);
  });
});

describe('determinarComissaoNormal — valores fora do intervalo de negócio', () => {
  it('margem negativa usa o mesmo piso de 1% (nunca uma comissão negativa)', () => {
    expect(determinarComissaoNormal(-20)).toBe(1);
  });
});

describe('ehVendedorComAdicional — identificação dos vendedores especiais (seção 9)', () => {
  it('reconhece Sandro (mesmo com sobrenome, ex.: "Sandro Cedro")', () => {
    expect(ehVendedorComAdicional('Sandro Cedro')).toBe(true);
  });
  it('reconhece Horacio, com ou sem acento', () => {
    expect(ehVendedorComAdicional('Horacio')).toBe(true);
    expect(ehVendedorComAdicional('Horácio Souza')).toBe(true);
  });
  it('reconhece Roberto Rocha', () => {
    expect(ehVendedorComAdicional('Roberto Rocha')).toBe(true);
  });
  it('não reconhece um vendedor comum (ex.: "João")', () => {
    expect(ehVendedorComAdicional('João')).toBe(false);
  });
  it('não reconhece "Roberto" sozinho, sem o sobrenome "Rocha" (evita falso positivo)', () => {
    expect(ehVendedorComAdicional('Roberto Alves')).toBe(false);
  });
  it('pedido sem vendedor identificado (null) nunca recebe o adicional', () => {
    expect(ehVendedorComAdicional(null)).toBe(false);
  });
});

describe('comissaoFixaDoVendedor — vendedor com comissão fixa (regra de 2026-09-10)', () => {
  it('Renato Pinto -> 4%', () => {
    expect(comissaoFixaDoVendedor('Renato Pinto')).toBe(4);
  });
  it('reconhece com caixa diferente e nome completo variado', () => {
    expect(comissaoFixaDoVendedor('RENATO PINTO')).toBe(4);
    expect(comissaoFixaDoVendedor('Renato Pinto da Silva')).toBe(4);
  });
  it('vendedor comum não tem comissão fixa (null — segue a regra normal)', () => {
    expect(comissaoFixaDoVendedor('João')).toBeNull();
  });
  it('vendedor especial de margem (ex.: Sandro) não tem comissão fixa — são regras independentes', () => {
    expect(comissaoFixaDoVendedor('Sandro Cedro')).toBeNull();
  });
  it('pedido sem vendedor identificado (null) nunca tem comissão fixa', () => {
    expect(comissaoFixaDoVendedor(null)).toBeNull();
  });
});

describe('comissaoFixaDaFamilia — família de produto com comissão fixa (regra de 2026-09-10)', () => {
  it('CTO Promocional -> 1%', () => {
    expect(comissaoFixaDaFamilia('CTO Promocional')).toBe(1);
  });
  it('reconhece sem diferenciar caixa/acento', () => {
    expect(comissaoFixaDaFamilia('cto promocional')).toBe(1);
  });
  it('família comum não tem comissão fixa (null — segue a regra normal)', () => {
    expect(comissaoFixaDaFamilia('Produto Acabado')).toBeNull();
    expect(comissaoFixaDaFamilia('Linha Premium')).toBeNull();
  });
  it('família ausente (undefined/null) não tem comissão fixa', () => {
    expect(comissaoFixaDaFamilia(undefined)).toBeNull();
    expect(comissaoFixaDaFamilia(null)).toBeNull();
  });
});

describe('calcularComissaoVendedor — vendedores normais (seção 5, testes 1-7 do requisito)', () => {
  it.each([
    [50, 1],
    [70, 1],
    [75, 1.5],
    [80, 2],
    [85, 2.5],
    [90, 3],
    [95, 3],
  ])('vendedor normal, margem %s%% -> comissão final %s%%', (margem, esperado) => {
    const resultado = calcularComissaoVendedor(margem, 'João');
    expect(resultado.comissaoFinalPercentual).toBeCloseTo(esperado, 10);
    expect(resultado.adicionalVendedorPercentual).toBe(0);
    expect(resultado.comissaoFinalPercentual).toBe(resultado.comissaoNormalPercentual);
  });
});

describe('calcularComissaoVendedor — vendedores especiais, adicional de +1% (seção 3/4, testes 8-14)', () => {
  it.each([
    ['Sandro', 50, 2],
    ['Sandro', 70, 2],
    ['Sandro', 80, 3],
    ['Sandro', 85, 3.5],
    ['Sandro', 90, 4],
    ['Horacio', 80, 3],
    ['Roberto Rocha', 85, 3.5],
  ])('%s, margem %s%% -> comissão final %s%%', (nomeVendedor, margem, esperado) => {
    const resultado = calcularComissaoVendedor(margem, nomeVendedor);
    expect(resultado.adicionalVendedorPercentual).toBe(1);
    expect(resultado.comissaoFinalPercentual).toBeCloseTo(esperado, 10);
  });

  it('o adicional nunca é limitado de volta a 3% — teto final dos vendedores especiais é 4% (seção 8)', () => {
    const resultado = calcularComissaoVendedor(90, 'Sandro');
    expect(resultado.comissaoNormalPercentual).toBe(3);
    expect(resultado.adicionalVendedorPercentual).toBe(1);
    expect(resultado.comissaoFinalPercentual).toBe(4);
  });

  it('o adicional é somado DEPOIS da comissão normal — nunca influencia a margem nem a faixa (seção 3)', () => {
    const comMargemBaixa = calcularComissaoVendedor(50, 'Sandro');
    // Mesmo Sandro tendo adicional, a comissão normal continua determinada só pela margem (piso 1%).
    expect(comMargemBaixa.comissaoNormalPercentual).toBe(1);
    expect(comMargemBaixa.comissaoFinalPercentual).toBe(2);
  });
});

describe('calcularComissaoVendedor — exemplo com margem decimal (teste 15 do requisito)', () => {
  it('margem 82,50%, vendedor normal -> comissão final 2,25%', () => {
    expect(calcularComissaoVendedor(82.5, 'João').comissaoFinalPercentual).toBeCloseTo(2.25, 10);
  });
  it('margem 82,50%, Sandro -> comissão final 3,25%', () => {
    expect(calcularComissaoVendedor(82.5, 'Sandro').comissaoFinalPercentual).toBeCloseTo(3.25, 10);
  });
});

describe('calcularComissaoVendedor — vendedor não cadastrado / pedido sem vendedor (testes 17-18)', () => {
  it('nome de vendedor desconhecido nunca recebe o adicional por engano', () => {
    expect(calcularComissaoVendedor(85, 'Vendedor Desconhecido XYZ').adicionalVendedorPercentual).toBe(0);
  });
  it('vendedor null (pedido sem vendedor) calcula a comissão normal normalmente, sem adicional', () => {
    const resultado = calcularComissaoVendedor(85, null);
    expect(resultado.adicionalVendedorPercentual).toBe(0);
    expect(resultado.comissaoFinalPercentual).toBe(2.5);
  });
});

describe('calcularComissaoTotal — valor monetário final da comissão (teste 16, seção 6)', () => {
  it('base R$ 24.095,00 e comissão final 3,25% -> R$ 783,09 (aprox.)', () => {
    expect(calcularComissaoTotal(24095, 3.25)).toBeCloseTo(783.0875, 4);
  });
  it('nunca usa o custo do produto como base — só recebe a base já resolvida pelo chamador', () => {
    // A função em si é agnóstica à origem da base: quem decide "valor dos produtos" é o chamador (relatorioComissionamento.ts).
    expect(calcularComissaoTotal(10000, 2)).toBe(200);
  });
});

describe('distribuirComissaoPorParcelas — pedido parcelado (teste — seção 33)', () => {
  it('quantidade de parcelas = quantidade de pagamentos de comissão previstos', () => {
    const parcelas = distribuirComissaoPorParcelas(9000, 2, [
      { numeroParcela: '001/003', valorBruto: 3000, statusTitulo: 'A VENCER' },
      { numeroParcela: '002/003', valorBruto: 3000, statusTitulo: 'A VENCER' },
      { numeroParcela: '003/003', valorBruto: 3000, statusTitulo: 'A VENCER' },
    ]);

    expect(parcelas).toHaveLength(3);
    // Exemplo do requisito (seção 15): 3 parcelas iguais de R$ 3.000, comissão 2% -> R$ 60,00 cada
    for (const parcela of parcelas) {
      expect(parcela.comissaoParcela).toBeCloseTo(60, 10);
    }
    const comissaoTotal = parcelas.reduce((soma, p) => soma + p.comissaoParcela, 0);
    expect(comissaoTotal).toBeCloseTo(180, 10);
  });
});

describe('distribuirComissaoPorParcelas — parcelas com valores diferentes (teste — seção 34)', () => {
  it('a comissão acompanha proporcionalmente o valor real de cada parcela, nunca dividida igualmente', () => {
    // Exemplo do requisito (seção 16): valor líquido 10.000, comissão 2%, parcelas 2.000/3.000/5.000
    const parcelas = distribuirComissaoPorParcelas(10000, 2, [
      { numeroParcela: '001/003', valorBruto: 2000, statusTitulo: 'A VENCER' },
      { numeroParcela: '002/003', valorBruto: 3000, statusTitulo: 'A VENCER' },
      { numeroParcela: '003/003', valorBruto: 5000, statusTitulo: 'A VENCER' },
    ]);

    expect(parcelas[0]?.comissaoParcela).toBeCloseTo(40, 10);
    expect(parcelas[1]?.comissaoParcela).toBeCloseTo(60, 10);
    expect(parcelas[2]?.comissaoParcela).toBeCloseTo(100, 10);

    const comissaoTotal = parcelas.reduce((soma, p) => soma + p.comissaoParcela, 0);
    expect(comissaoTotal).toBeCloseTo(200, 10);
  });

  it('não aceita simplesmente comissao_total / numero_de_parcelas quando os valores diferem', () => {
    const parcelas = distribuirComissaoPorParcelas(10000, 2, [
      { numeroParcela: '001/002', valorBruto: 1000, statusTitulo: 'A VENCER' },
      { numeroParcela: '002/002', valorBruto: 9000, statusTitulo: 'A VENCER' },
    ]);
    const divisaoIgualIncorreta = 200 / 2; // 100 cada — NÃO deve ser o resultado
    expect(parcelas[0]?.comissaoParcela).not.toBeCloseTo(divisaoIgualIncorreta, 5);
    expect(parcelas[0]?.comissaoParcela).toBeCloseTo(20, 10); // 1000/10000 * 200
    expect(parcelas[1]?.comissaoParcela).toBeCloseTo(180, 10); // 9000/10000 * 200
  });
});

describe('distribuirComissaoPorParcelas — baixa financeira (teste — seção 35)', () => {
  it('identifica corretamente parcela baixada e parcela pendente, sem apresentar pendente como recebida', () => {
    const parcelas = distribuirComissaoPorParcelas(6000, 2, [
      { numeroParcela: '001/002', valorBruto: 3000, statusTitulo: 'RECEBIDO' },
      { numeroParcela: '002/002', valorBruto: 3000, statusTitulo: 'A VENCER' },
    ]);

    expect(parcelas[0]?.baixado).toBe(true);
    expect(parcelas[0]?.situacao).toBe('ELEGIVEL');
    expect(parcelas[1]?.baixado).toBe(false);
    expect(parcelas[1]?.situacao).toBe('PENDENTE_DE_BAIXA');

    const comissaoLiberada = parcelas.filter((p) => p.baixado).reduce((s, p) => s + p.comissaoParcela, 0);
    const comissaoPendente = parcelas.filter((p) => !p.baixado).reduce((s, p) => s + p.comissaoParcela, 0);
    expect(comissaoLiberada).toBeCloseTo(60, 10);
    expect(comissaoPendente).toBeCloseTo(60, 10);
  });

  it('título não localizado fica como AGUARDANDO_TITULO — nunca tratado como pago nem como pendente confirmado', () => {
    const parcelas = distribuirComissaoPorParcelas(3000, 1, [{ numeroParcela: null, valorBruto: 3000, statusTitulo: null }]);
    expect(parcelas[0]?.baixado).toBe(false);
    expect(parcelas[0]?.situacao).toBe('AGUARDANDO_TITULO');
  });

  it('título cancelado nunca é apresentado como comissão elegível', () => {
    const parcelas = distribuirComissaoPorParcelas(3000, 1, [{ numeroParcela: '001/001', valorBruto: 3000, statusTitulo: 'CANCELADO' }]);
    expect(parcelas[0]?.baixado).toBe(false);
    expect(parcelas[0]?.situacao).toBe('PENDENTE_DE_BAIXA');
  });
});
