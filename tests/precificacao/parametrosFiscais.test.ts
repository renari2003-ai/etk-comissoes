import { describe, expect, it } from 'vitest';
import { arredondarDinheiro } from '../../src/calculo/arredondamento.js';
import { aliquotaIcmsCompra, calcularPrecos, determinarCenario } from '../../src/precificacao/calculo.js';
import {
  MAX_EXCECOES_NCM,
  PARAMETROS_GERAIS_INICIAIS,
  UFS_FORA_DE_MG,
  UFS_INICIAIS,
  excecaoIcmsMgDoNcm,
  paraParametrosDoCalculo,
  validarAtualizacaoTabelaFiscal,
  validarTabelaFiscal,
  type TabelaFiscal,
} from '../../src/precificacao/parametrosFiscais.js';
import { diferencas } from '../../src/precificacao/parametrosFiscaisRepositorio.js';
import { ErroValidacao } from '../../src/validacao.js';

const INICIAL: TabelaFiscal = { gerais: { ...PARAMETROS_GERAIS_INICIAIS }, ufs: UFS_INICIAIS.map((u) => ({ ...u })), excecoesNcm: [] };
const copia = (): TabelaFiscal => structuredClone(INICIAL);

describe('valores iniciais da tabela fiscal', () => {
  it('gerais: PIS/COFINS 9,25; IR/CS 34; chave desligada; recolhimentos 0; MG 18 (venda e compra); compra interestadual 12; importado 4', () => {
    expect(PARAMETROS_GERAIS_INICIAIS).toEqual({
      pisCofins: 9.25,
      irCs: 34,
      ganhoIcmsNaBasePisCofins: false,
      percentualRecolhimentoIcms: 0,
      percentualRecolhimentoIcmsMgNaoContribuinte: 0,
      icmsInternoMgVenda: 18,
      icmsInternoMgCompra: 18,
      icmsInterestadualCompra: 12,
      icmsImportadoVenda: 4,
      icmsImportadoCompra: 4,
    });
  });

  it('venda de MG: 12% para Sul e Sudeste (exceto ES), 7% para N/NE/CO e ES; alíquotas internas vazias', () => {
    expect(UFS_INICIAIS).toHaveLength(26);
    expect(UFS_INICIAIS.some((u) => (u.uf as string) === 'MG')).toBe(false);
    const doze = UFS_INICIAIS.filter((u) => u.icmsInterestadualVenda === 12).map((u) => u.uf).sort();
    expect(doze).toEqual(['PR', 'RJ', 'RS', 'SC', 'SP']);
    expect(UFS_INICIAIS.filter((u) => u.icmsInterestadualVenda === 7)).toHaveLength(21);
    expect(UFS_INICIAIS.find((u) => u.uf === 'ES')!.icmsInterestadualVenda).toBe(7);
    expect(UFS_INICIAIS.every((u) => u.aliquotaInterna === null)).toBe(true);
  });
});

describe('validação estrita do PUT', () => {
  it('aceita a tabela inicial e devolve exatamente os mesmos valores', () => {
    expect(validarTabelaFiscal(copia())).toEqual(INICIAL);
  });

  it('recusa campos desconhecidos e campos ausentes, em todos os níveis', () => {
    expect(() => validarTabelaFiscal({ ...copia(), extra: 1 })).toThrow(/não reconhecido.*extra/);
    const { excecoesNcm: _ignorado, ...semNcm } = copia();
    expect(() => validarTabelaFiscal(semNcm)).toThrow(/ausente.*excecoesNcm/);
    expect(() => validarTabelaFiscal({ ...copia(), gerais: { ...INICIAL.gerais, irpj: 15 } })).toThrow(/não reconhecido.*irpj/);
    const t = copia();
    (t.ufs[0] as unknown as Record<string, unknown>).observacao = 'x';
    expect(() => validarTabelaFiscal(t)).toThrow(/não reconhecido.*observacao/);
  });

  it('percentuais: tipo número, faixa e no máximo 4 casas', () => {
    const com = (campo: string, valor: unknown) => ({ ...copia(), gerais: { ...INICIAL.gerais, [campo]: valor } });
    expect(() => validarTabelaFiscal(com('pisCofins', '9.25'))).toThrow(ErroValidacao);
    expect(() => validarTabelaFiscal(com('pisCofins', -1))).toThrow(ErroValidacao);
    expect(() => validarTabelaFiscal(com('irCs', 100))).toThrow(ErroValidacao);
    expect(() => validarTabelaFiscal(com('pisCofins', 9.12345))).toThrow(/4 casas/);
    expect(validarTabelaFiscal(com('pisCofins', 9.1234)).gerais.pisCofins).toBe(9.1234);
    expect(() => validarTabelaFiscal(com('icmsInternoMgVenda', Number.NaN))).toThrow(ErroValidacao);
  });

  it('recolhimentos aceitam 100% (fim da transição); os demais não', () => {
    const com = (campo: string, valor: unknown) => ({ ...copia(), gerais: { ...INICIAL.gerais, [campo]: valor } });
    expect(validarTabelaFiscal(com('percentualRecolhimentoIcms', 100)).gerais.percentualRecolhimentoIcms).toBe(100);
    expect(validarTabelaFiscal(com('percentualRecolhimentoIcmsMgNaoContribuinte', 100)).gerais.percentualRecolhimentoIcmsMgNaoContribuinte).toBe(100);
    expect(() => validarTabelaFiscal(com('percentualRecolhimentoIcms', 100.5))).toThrow(ErroValidacao);
    expect(() => validarTabelaFiscal(com('icmsImportadoVenda', 100))).toThrow(ErroValidacao);
  });

  it('arredonda às 4 casas que o banco guarda (nunca histórico falso por 9,25000000001)', () => {
    const t = { ...copia(), gerais: { ...INICIAL.gerais, pisCofins: 9.25000000001 } };
    expect(validarTabelaFiscal(t).gerais.pisCofins).toBe(9.25);
  });

  it('PUT exige a versão lida (inteiro ≥ 0) junto da tabela inteira', () => {
    expect(validarAtualizacaoTabelaFiscal({ versao: 3, ...copia() })).toEqual({ versao: 3, tabela: INICIAL });
    expect(() => validarAtualizacaoTabelaFiscal(copia())).toThrow(/ausente.*versao/);
    for (const versao of [-1, 1.5, '3', null]) {
      expect(() => validarAtualizacaoTabelaFiscal({ versao, ...copia() })).toThrow(/Versão da tabela fiscal inválida/);
    }
  });

  it('chave __proto__ vinda de JSON é recusada como campo extra; a mensagem não repete uma lista enorme', () => {
    expect(() => validarTabelaFiscal(JSON.parse('{"__proto__":{"x":1},"gerais":{},"ufs":[],"excecoesNcm":[]}'))).toThrow(/não reconhecido.*__proto__/);
    const muitasChaves = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`campo${i}`, 1]));
    expect(() => validarTabelaFiscal({ ...copia(), ...muitasChaves })).toThrow(/e mais 45\.$/);
  });

  it('booleano de verdade: a string "false" é recusada', () => {
    expect(() => validarTabelaFiscal({ ...copia(), gerais: { ...INICIAL.gerais, ganhoIcmsNaBasePisCofins: 'false' } })).toThrow(/verdadeiro ou falso/);
  });

  it('UFs: exatamente as 26 fora de MG, sem repetir, sem MG; alíquota interna pode ser vazia (null)', () => {
    expect(() => validarTabelaFiscal({ ...copia(), ufs: INICIAL.ufs.slice(1) })).toThrow(/Faltam UFs.*AC/);
    expect(() => validarTabelaFiscal({ ...copia(), ufs: [...INICIAL.ufs, INICIAL.ufs[0]] })).toThrow(/repetida/);
    const comMg = copia();
    (comMg.ufs[0] as { uf: string }).uf = 'MG';
    expect(() => validarTabelaFiscal(comMg)).toThrow(/MG não entra/);
    const preenchida = copia();
    preenchida.ufs.find((u) => u.uf === 'SP')!.aliquotaInterna = 18;
    expect(validarTabelaFiscal(preenchida).ufs.find((u) => u.uf === 'SP')!.aliquotaInterna).toBe(18);
  });

  it('exceções por NCM: 8 dígitos sem pontos, sem repetir, até o máximo', () => {
    const com = (excecoesNcm: unknown) => ({ ...copia(), excecoesNcm });
    expect(validarTabelaFiscal(com([{ ncm: '85447000', aliquota: 12 }])).excecoesNcm).toEqual([{ ncm: '85447000', aliquota: 12 }]);
    expect(() => validarTabelaFiscal(com([{ ncm: '8544.70.00', aliquota: 12 }]))).toThrow(/8 dígitos/);
    expect(() => validarTabelaFiscal(com([{ ncm: 85447000, aliquota: 12 }]))).toThrow(/8 dígitos/);
    expect(() => validarTabelaFiscal(com([{ ncm: '85447000', aliquota: 12 }, { ncm: '85447000', aliquota: 7 }]))).toThrow(/repetido/);
    const muitas = Array.from({ length: MAX_EXCECOES_NCM + 1 }, (_, i) => ({ ncm: String(10_000_000 + i), aliquota: 12 }));
    expect(() => validarTabelaFiscal(com(muitas))).toThrow(/No máximo/);
  });
});

describe('conversão para o cálculo', () => {
  it('a tabela inicial reproduz o exemplo da spec (C, SP: preço cheio 165,42)', () => {
    const p = paraParametrosDoCalculo(INICIAL);
    const cenario = determinarCenario({ uf: 'SP', contribuinte: true, usoConsumo: false, autorizadoDiferimentoMg: false }, { icmsInternoMgExcecaoNcm: null, conteudoImportado: false }, p.venda);
    const { cheio } = calcularPrecos({ custoLiquido: 90.75, cenario, comercial: { comissao: 0.03, despesas: 0.1, margem: 0.12 }, irCs: p.irCs, aliquotaIpiVenda: 0 });
    expect(arredondarDinheiro(cheio!.preco)).toBe(165.42);
  });

  it('cenário B usa a alíquota geral de MG (18%), ou a exceção do NCM quando existir', () => {
    const t = copia();
    t.excecoesNcm = [{ ncm: '85447000', aliquota: 12 }];
    const p = paraParametrosDoCalculo(t);
    const clienteMg = { uf: 'MG' as const, contribuinte: true, usoConsumo: false, autorizadoDiferimentoMg: false };
    expect(determinarCenario(clienteMg, { icmsInternoMgExcecaoNcm: excecaoIcmsMgDoNcm(t, '99999999'), conteudoImportado: false }, p.venda).icmsDestacado).toBe(0.18);
    expect(determinarCenario(clienteMg, { icmsInternoMgExcecaoNcm: excecaoIcmsMgDoNcm(t, '8544.70.00'), conteudoImportado: false }, p.venda).icmsDestacado).toBe(0.12);
    expect(excecaoIcmsMgDoNcm(t, null)).toBeNull();
  });

  it('UF sem alíquota interna: tarja vermelha só no cenário D; venda para a mesma UF contribuinte funciona', () => {
    const p = paraParametrosDoCalculo(INICIAL);
    const produto = { icmsInternoMgExcecaoNcm: null, conteudoImportado: false };
    expect(determinarCenario({ uf: 'BA', contribuinte: true, usoConsumo: false, autorizadoDiferimentoMg: false }, produto, p.venda).icmsDestacado).toBe(0.07);
    expect(() => determinarCenario({ uf: 'BA', contribuinte: false, usoConsumo: false, autorizadoDiferimentoMg: false }, produto, p.venda)).toThrow(
      /preencher a UF BA/,
    );
  });

  it('compra: 12% de qualquer UF e 18% em MG sem PTA, vindos da tabela', () => {
    const { compra } = paraParametrosDoCalculo(INICIAL);
    expect(aliquotaIcmsCompra({ ufFornecedor: 'GO', diferimentoPta: false, mercadoriaImportada: false }, compra)).toBe(0.12);
    expect(aliquotaIcmsCompra({ ufFornecedor: 'MG', diferimentoPta: false, mercadoriaImportada: false }, compra)).toBe(0.18);
  });

  it('todas as UFs fora de MG chegam ao cálculo', () => {
    const { venda } = paraParametrosDoCalculo(INICIAL);
    expect(Object.keys(venda.icmsInterestadualVendaPorUf).sort()).toEqual([...UFS_FORA_DE_MG].sort());
  });
});

describe('diferenças para o histórico', () => {
  it('lista só o que mudou, campo a campo, incluindo NCM incluído, alterado e removido', () => {
    const atual = copia();
    atual.excecoesNcm = [{ ncm: '11111111', aliquota: 12 }, { ncm: '22222222', aliquota: 7 }];
    const nova = structuredClone(atual);
    nova.gerais.irCs = 24;
    nova.ufs.find((u) => u.uf === 'SP')!.aliquotaInterna = 18;
    nova.excecoesNcm = [{ ncm: '11111111', aliquota: 4 }, { ncm: '33333333', aliquota: 12 }];
    expect(diferencas(atual, nova)).toEqual([
      { campo: 'gerais.irCs', valorAnterior: '34', valorNovo: '24' },
      { campo: 'uf.SP.aliquotaInterna', valorAnterior: null, valorNovo: '18' },
      { campo: 'ncm.11111111', valorAnterior: '12', valorNovo: '4' },
      { campo: 'ncm.33333333', valorAnterior: null, valorNovo: '12' },
      { campo: 'ncm.22222222', valorAnterior: '7', valorNovo: null },
    ]);
    expect(diferencas(atual, structuredClone(atual))).toEqual([]);
  });
});
