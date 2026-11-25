import { describe, expect, it } from 'vitest';
import { arredondarDinheiro } from '../../src/calculo/arredondamento.js';
import { aliquotaIcmsCompra, calcularPrecos, determinarCenario } from '../../src/precificacao/calculo.js';
import {
  ALIQUOTAS_INTERNAS_INICIAIS,
  AVISO_PARAMETROS_PROVISORIOS,
  MAX_EXCECOES_NCM,
  PARAMETROS_GERAIS_INICIAIS,
  UFS_FORA_DE_MG,
  UFS_INICIAIS,
  avisosDaTabelaFiscal,
  excecaoIcmsMgDoNcm,
  paraParametrosDoCalculo,
  validarAtualizacaoStatus,
  validarAtualizacaoTabelaFiscal,
  validarTabelaFiscal,
  type TabelaFiscal,
} from '../../src/precificacao/parametrosFiscais.js';
import { diferencas } from '../../src/precificacao/parametrosFiscaisRepositorio.js';
import { ErroValidacao } from '../../src/validacao.js';

const INICIAL: TabelaFiscal = { gerais: { ...PARAMETROS_GERAIS_INICIAIS }, ufs: UFS_INICIAIS.map((u) => ({ ...u })), excecoesNcm: [] };
const copia = (): TabelaFiscal => structuredClone(INICIAL);

describe('valores iniciais da tabela fiscal', () => {
  it('gerais: PIS/COFINS 9,25; IR/CS 34; chave desligada; recolhimento a contribuinte 0 e a consumidor final 100; MG 18; compra interestadual 12; importado 4', () => {
    expect(PARAMETROS_GERAIS_INICIAIS).toEqual({
      pisCofins: 9.25,
      irCs: 34,
      ganhoIcmsNaBasePisCofins: false,
      percentualRecolhimentoIcms: 0,
      percentualRecolhimentoIcmsConsumidorFinal: 100,
      icmsInternoMgVenda: 18,
      icmsInternoMgCompra: 18,
      icmsInterestadualCompra: 12,
      icmsImportadoVenda: 4,
      icmsImportadoCompra: 4,
    });
  });

  it('venda de MG: 12% para Sul e Sudeste (exceto ES), 7% para N/NE/CO e ES; alíquotas internas do Buscador NCM (nov/2026)', () => {
    expect(UFS_INICIAIS).toHaveLength(26);
    expect(UFS_INICIAIS.some((u) => (u.uf as string) === 'MG')).toBe(false);
    const doze = UFS_INICIAIS.filter((u) => u.icmsInterestadualVenda === 12).map((u) => u.uf).sort();
    expect(doze).toEqual(['PR', 'RJ', 'RS', 'SC', 'SP']);
    expect(UFS_INICIAIS.filter((u) => u.icmsInterestadualVenda === 7)).toHaveLength(21);
    expect(UFS_INICIAIS.find((u) => u.uf === 'ES')!.icmsInterestadualVenda).toBe(7);
    // Valores iniciais informados pelo usuário (Buscador NCM, nov/2026, sem FCP) — "a confirmar pelo fiscal".
    expect(Object.fromEntries(UFS_INICIAIS.map((u) => [u.uf, u.aliquotaInterna]))).toEqual({
      AC: 19, AL: 20.5, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23, MS: 17, MT: 17, PA: 19,
      PB: 20, PE: 20.5, PI: 22.5, PR: 19.5, RJ: 20, RN: 20, RO: 19.5, RR: 20, RS: 17, SC: 17, SE: 19, SP: 18, TO: 20,
    });
    expect(Object.keys(ALIQUOTAS_INTERNAS_INICIAIS)).not.toContain('MG');
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
    expect(validarTabelaFiscal(com('percentualRecolhimentoIcmsConsumidorFinal', 0)).gerais.percentualRecolhimentoIcmsConsumidorFinal).toBe(0);
    expect(() => validarTabelaFiscal(com('percentualRecolhimentoIcmsConsumidorFinal', 101))).toThrow(ErroValidacao);
    // O campo antigo saiu da API.
    expect(() => validarTabelaFiscal(com('percentualRecolhimentoIcmsMgNaoContribuinte', 0))).toThrow(/não reconhecido/);
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
    const cenario = determinarCenario({ uf: 'SP', contribuinte: true, usoConsumo: false, clienteComPta: false, vendaParaIndustrializacao: false }, { icmsInternoMgExcecaoNcm: null, conteudoImportado: false }, p.venda);
    const { cheio } = calcularPrecos({ custoLiquido: 90.75, cenario, comercial: { comissao: 0.03, despesas: 0.1, margem: 0.12 }, irCs: p.irCs, aliquotaIpiVenda: 0 });
    expect(arredondarDinheiro(cheio!.preco)).toBe(165.42);
  });

  it('cenário B usa a alíquota geral de MG (18%), ou a exceção do NCM quando existir', () => {
    const t = copia();
    t.excecoesNcm = [{ ncm: '85447000', aliquota: 12 }];
    const p = paraParametrosDoCalculo(t);
    const clienteMg = { uf: 'MG' as const, contribuinte: true, usoConsumo: false, clienteComPta: false, vendaParaIndustrializacao: false };
    expect(determinarCenario(clienteMg, { icmsInternoMgExcecaoNcm: excecaoIcmsMgDoNcm(t, '99999999'), conteudoImportado: false }, p.venda).icmsDestacado).toBe(0.18);
    expect(determinarCenario(clienteMg, { icmsInternoMgExcecaoNcm: excecaoIcmsMgDoNcm(t, '8544.70.00'), conteudoImportado: false }, p.venda).icmsDestacado).toBe(0.12);
    expect(excecaoIcmsMgDoNcm(t, null)).toBeNull();
  });

  it('UF sem alíquota interna: tarja vermelha só no cenário D; venda para a mesma UF contribuinte funciona', () => {
    const t = copia();
    t.ufs.find((u) => u.uf === 'BA')!.aliquotaInterna = null;
    const p = paraParametrosDoCalculo(t);
    const produto = { icmsInternoMgExcecaoNcm: null, conteudoImportado: false };
    expect(determinarCenario({ uf: 'BA', contribuinte: true, usoConsumo: false, clienteComPta: false, vendaParaIndustrializacao: false }, produto, p.venda).icmsDestacado).toBe(0.07);
    expect(() => determinarCenario({ uf: 'BA', contribuinte: false, usoConsumo: false, clienteComPta: false, vendaParaIndustrializacao: false }, produto, p.venda)).toThrow(
      /preencher a UF BA/,
    );
  });

  it('respostas do fiscal com a tabela inicial: não contribuinte de BA recolhe 100% do ICMS 7% e paga DIFAL 13,5%', () => {
    const p = paraParametrosDoCalculo(INICIAL);
    const c = determinarCenario({ uf: 'BA', contribuinte: false, usoConsumo: false, clienteComPta: false, vendaParaIndustrializacao: false }, { icmsInternoMgExcecaoNcm: null, conteudoImportado: false }, p.venda);
    expect(c.cenario).toBe('D');
    expect(c.icmsRecolhido).toBe(0.07);
    expect(c.difal).toBeCloseTo(0.135, 12);
    const mg = determinarCenario({ uf: 'MG', contribuinte: false, usoConsumo: false, clienteComPta: false, vendaParaIndustrializacao: false }, { icmsInternoMgExcecaoNcm: null, conteudoImportado: false }, p.venda);
    expect(mg).toMatchObject({ cenario: 'B', icmsDestacado: 0.18, icmsRecolhido: 0.18 });
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

describe('status "Provisório / Validado pelo fiscal"', () => {
  it('enquanto "Provisório", todo cálculo leva a tarja azul; "Validado" tira a tarja', () => {
    expect(avisosDaTabelaFiscal({ status: 'PROVISORIO' })).toEqual([AVISO_PARAMETROS_PROVISORIOS]);
    expect(AVISO_PARAMETROS_PROVISORIOS).toMatchObject({ nivel: 'AZUL', codigo: 'PARAMETROS_FISCAIS_PROVISORIOS', mensagem: 'Parâmetros fiscais ainda não validados pelo fiscal.' });
    expect(avisosDaTabelaFiscal({ status: 'VALIDADO' })).toEqual([]);
  });

  it('PUT do status: só PROVISORIO ou VALIDADO, com a versão lida, sem campos extras', () => {
    expect(validarAtualizacaoStatus({ versao: 2, status: 'VALIDADO' })).toEqual({ versao: 2, status: 'VALIDADO' });
    expect(() => validarAtualizacaoStatus({ versao: 2, status: 'validado' })).toThrow(/Status inválido/);
    expect(() => validarAtualizacaoStatus({ status: 'VALIDADO' })).toThrow(/ausente.*versao/);
    expect(() => validarAtualizacaoStatus({ versao: 2, status: 'VALIDADO', usuario: 'x' })).toThrow(/não reconhecido/);
  });
});

describe('diferenças para o histórico', () => {
  it('lista só o que mudou, campo a campo, incluindo NCM incluído, alterado e removido', () => {
    const atual = copia();
    atual.excecoesNcm = [{ ncm: '11111111', aliquota: 12 }, { ncm: '22222222', aliquota: 7 }];
    const nova = structuredClone(atual);
    nova.gerais.irCs = 24;
    nova.gerais.percentualRecolhimentoIcmsConsumidorFinal = 50;
    nova.ufs.find((u) => u.uf === 'SP')!.aliquotaInterna = 17;
    nova.excecoesNcm = [{ ncm: '11111111', aliquota: 4 }, { ncm: '33333333', aliquota: 12 }];
    expect(diferencas(atual, nova)).toEqual([
      { campo: 'gerais.irCs', valorAnterior: '34', valorNovo: '24' },
      { campo: 'gerais.percentualRecolhimentoIcmsConsumidorFinal', valorAnterior: '100', valorNovo: '50' },
      { campo: 'uf.SP.aliquotaInterna', valorAnterior: '18', valorNovo: '17' },
      { campo: 'ncm.11111111', valorAnterior: '12', valorNovo: '4' },
      { campo: 'ncm.33333333', valorAnterior: null, valorNovo: '12' },
      { campo: 'ncm.22222222', valorAnterior: '7', valorNovo: null },
    ]);
    expect(diferencas(atual, structuredClone(atual))).toEqual([]);
  });
});
