import { describe, expect, it } from 'vitest';
import { calcularProduto, clienteSimulado, validarEntradaCalculo, type DadosDoCalculo, type EntradaCalculo } from '../../src/precificacao/calculoProduto.js';
import type { ComponenteOmie, DadosOmieProduto } from '../../src/precificacao/coletaOmie.js';
import type { CustoManual } from '../../src/precificacao/custoManual.js';
import { PARAMETROS_GERAIS_INICIAIS, UFS_INICIAIS, type TabelaFiscalComMetadados } from '../../src/precificacao/parametrosFiscais.js';

function tabela(sobrescrever: Partial<TabelaFiscalComMetadados> = {}): TabelaFiscalComMetadados {
  return {
    gerais: { ...PARAMETROS_GERAIS_INICIAIS },
    ufs: UFS_INICIAIS.map((u) => ({ ...u })),
    excecoesNcm: [],
    ipiNcm: [{ ncm: '85447000', aliquota: 5 }],
    status: 'PROVISORIO',
    statusAlteradoEm: null,
    statusAlteradoPor: null,
    versao: 1,
    atualizadoEm: null,
    atualizadoPor: null,
    ...sobrescrever,
  };
}

function dados(componentes: Record<string, Partial<ComponenteOmie>>, sobrescrever: Partial<DadosOmieProduto> = {}): DadosOmieProduto {
  const comps: Record<string, ComponenteOmie> = {};
  for (const [codigo, c] of Object.entries(componentes)) comps[codigo] = { codigo, idProduto: 1, descricao: null, ncm: null, custoMedio: null, ...c };
  return {
    codigo: 'PA1',
    produto: { idProduto: 1, descricao: 'Produto 1', ncm: '85447000', conteudoImportado: false },
    arvore: [],
    folhas: Object.keys(comps).map((codigo) => ({ codigo, descricao: null, quantidadeNoProduto: 1, custoUnitario: comps[codigo]!.custoMedio, caminho: [], kitSemEstrutura: false })),
    componentes: comps,
    avisos: [],
    ...sobrescrever,
  };
}

function entrada(sobrescrever: Partial<EntradaCalculo> = {}): EntradaCalculo {
  return {
    produto: 'PA1',
    quantidade: 1,
    cliente: { uf: 'SP', contribuinte: true, comPta: false },
    finalidade: 'REVENDA',
    despesas: 10,
    comissao: 3,
    margem: 12,
    margemLiquida: false,
    precoAlvo: null,
    custosSimulacao: [],
    escolhas: {},
    ...sobrescrever,
  };
}

/** Monta a chamada como a rota faz, com cliente da simulação rápida. */
function calcular(e: EntradaCalculo, d: DadosOmieProduto, extra: Partial<DadosDoCalculo> = {}) {
  const s = 'codigo' in e.cliente ? null : clienteSimulado(e.cliente, e.finalidade);
  return calcularProduto({
    entrada: e,
    dados: d,
    tabela: tabela(),
    manuaisSalvos: new Map(),
    cliente: s?.cliente ?? null,
    descricaoCliente: s?.descricao ?? 'Cliente',
    avisosCliente: [],
    ...extra,
  });
}

const manual = (codigo: string, sobrescrever: Partial<CustoManual> = {}): CustoManual => ({
  codigo,
  valorNota: 112,
  ufFornecedor: 'MG',
  diferimentoPta: true,
  mercadoriaImportada: false,
  tipoFornecedor: 'INDUSTRIA_NORMAL',
  ipiPercentual: 12,
  ...sobrescrever,
});

const codigos = (r: { avisos: { codigo: string }[] }) => r.avisos.map((a) => a.codigo);

describe('cálculo completo do produto (etapa 5)', () => {
  it('exemplo numérico da spec, cenário C: custo do Omie 90,75 (já líquido) → piso 135,73 e cheio 165,42, IPI por fora', () => {
    const r = calcular(entrada(), dados({ MP1: { custoMedio: 90.75 } }));
    expect(r.custo).toMatchObject({ custoBruto: 90.75, custoLiquido: 90.75, creditos: 0 });
    expect(r.cenario).toMatchObject({ cenario: 'C', icmsDestacado: 0.12 });
    expect(r.precos!.piso.preco).toBeCloseTo(135.73, 2);
    expect(r.precos!.cheio!.preco).toBeCloseTo(165.42, 2);
    expect(r.precos!.piso.lucro.lucroAntesIrCs).toBeCloseTo(16.29, 2);
    expect(r.precos!.piso.lucro.lucroDepoisIrCs).toBeCloseTo(10.75, 2);
    expect(r.precos!.piso.divisor).toBeCloseTo(0.6686, 4);
    expect(r.precos!.cheio!.divisor).toBeCloseTo(0.5486, 4);
    expect(r.precos!.cheio!.lucro.lucroAntesIrCs).toBeCloseTo(39.7, 2);
    expect(r.precos!.cheio!.lucro.lucroDepoisIrCs).toBeCloseTo(26.2, 2);
    expect(r.precos!.cheio!.lucro.icmsNoLucro).toBeCloseTo(19.85, 2);
    expect(r.precos!.piso.precoComIpi).toBeCloseTo(r.precos!.piso.preco * 1.05, 10);
    expect(r).toMatchObject({ bloqueado: false, incompleto: false, aliquotaIpiVenda: 0.05, cliente: 'Simulação: SP contribuinte' });
  });

  it('exemplo da spec, cenário A (MG com PTA + industrialização): custo manual de R$ 112 (MG com PTA) → líquido 90,75 → 138,02', () => {
    const r = calcular(
      entrada({ cliente: { uf: 'MG', contribuinte: true, comPta: true }, finalidade: 'INDUSTRIALIZACAO' }),
      dados({ MP1: { custoMedio: null } }),
      { manuaisSalvos: new Map([['MP1', manual('MP1')]]) },
    );
    expect(r.custo!.custoLiquido).toBeCloseTo(90.75, 10);
    expect(r.cenario!.cenario).toBe('A');
    expect(r.precos!.piso.preco).toBeCloseTo(138.02, 2);
    expect(r.precos!.piso.divisor).toBeCloseTo(0.6575, 4);
    expect(r.precos!.piso.lucro.lucroAntesIrCs).toBeCloseTo(16.56, 2);
    expect(r.precos!.piso.lucro.lucroDepoisIrCs).toBeCloseTo(10.93, 2);
  });

  it('avisos de cada parte chegam ao resultado: DIFAL_BASE_SIMPLES (cenário D), PRECO_CHEIO_INDISPONIVEL, CUSTO_MANUAL_DIFERENTE_OMIE', () => {
    const d = calcular(entrada({ cliente: { uf: 'BA', contribuinte: false, comPta: false } }), dados({ MP1: { custoMedio: 10 } }));
    expect(d.cenario!.cenario).toBe('D');
    expect(codigos(d)).toContain('DIFAL_BASE_SIMPLES');
    const semCheio = calcular(entrada({ despesas: 50, margem: 30, comissao: 4 }), dados({ MP1: { custoMedio: 10 } }));
    expect(semCheio.precos!.cheio).toBeNull();
    expect(codigos(semCheio)).toContain('PRECO_CHEIO_INDISPONIVEL');
    expect(semCheio.bloqueado).toBe(false);
    const conflito = calcular(entrada(), dados({ MP1: { custoMedio: 50 } }), { manuaisSalvos: new Map([['MP1', manual('MP1')]]) });
    expect(codigos(conflito)).toContain('CUSTO_MANUAL_DIFERENTE_OMIE');
  });

  it('amarelos não bloqueiam: COMPONENTES_NAO_CONSULTADOS (da coleta) e ITEM_SEM_NCM_IPI (custo manual sem IPI e sem NCM) → preço sai INCOMPLETO', () => {
    const r = calcular(
      entrada({ custosSimulacao: [manual('MP2', { ipiPercentual: null })] }),
      dados({ MP1: { custoMedio: 10 }, MP2: { custoMedio: null } }, { avisos: [{ nivel: 'AMARELO', codigo: 'COMPONENTES_NAO_CONSULTADOS', item: null, mensagem: 'x' }] }),
    );
    expect(codigos(r)).toEqual(expect.arrayContaining(['COMPONENTES_NAO_CONSULTADOS', 'ITEM_SEM_NCM_IPI']));
    expect(r).toMatchObject({ bloqueado: false, incompleto: true });
    expect(r.precos).not.toBeNull();
  });

  it('ORIGEM_NAO_INFORMADA (azul): origem vazia no cadastro = nacional, com tarja', () => {
    const r = calcular(entrada(), dados({ MP1: { custoMedio: 10 } }, { produto: { idProduto: 1, descricao: null, ncm: '85447000', conteudoImportado: null } }));
    expect(r.avisos).toContainEqual(expect.objectContaining({ nivel: 'AZUL', codigo: 'ORIGEM_NAO_INFORMADA', item: 'PA1' }));
    expect(r.cenario!.icmsDestacado).toBe(0.12);
  });

  it('margem líquida que passa de 100% antes do IR/CS: tarja vermelha SEM_PRECO_POSSIVEL, sem preço', () => {
    const r = calcular(entrada({ margem: 70, margemLiquida: true }), dados({ MP1: { custoMedio: 10 } }));
    expect(r).toMatchObject({ bloqueado: true, precos: null });
    expect(r.avisos[0]).toMatchObject({ nivel: 'VERMELHO', codigo: 'SEM_PRECO_POSSIVEL' });
  });

  it('qualquer vermelho antes do cenário impede o preço, mesmo vindo cliente junto', () => {
    const s = clienteSimulado({ uf: 'SP', contribuinte: true, comPta: false }, 'REVENDA');
    const r = calcular(entrada(), dados({ MP1: { custoMedio: 10 } }), { cliente: s.cliente, avisosCliente: [{ nivel: 'VERMELHO', codigo: 'CLIENTE_INCONSISTENTE', item: '1', mensagem: 'x' }] });
    expect(r).toMatchObject({ bloqueado: true, precos: null, cenario: null });
  });

  it('item obrigatório: TODO resultado leva os avisos da tabela fiscal (Provisório) — com preço, bloqueado ou sem estrutura', () => {
    const comPreco = calcular(entrada(), dados({ MP1: { custoMedio: 10 } }));
    const semEstrutura = calcular(entrada(), dados({}, { avisos: [{ nivel: 'VERMELHO', codigo: 'PRODUTO_SEM_ESTRUTURA', item: 'PA1', mensagem: 'x' }] }));
    const semCliente = calcular(entrada(), dados({ MP1: { custoMedio: 10 } }), { cliente: null, avisosCliente: [{ nivel: 'VERMELHO', codigo: 'CLIENTE_INCONSISTENTE', item: '10', mensagem: 'x' }] });
    for (const r of [comPreco, semEstrutura, semCliente]) expect(codigos(r)).toContain('PARAMETROS_FISCAIS_PROVISORIOS');
    // Validada: a tarja sai.
    expect(codigos(calcular(entrada(), dados({ MP1: { custoMedio: 10 } }), { tabela: tabela({ status: 'VALIDADO' }) }))).not.toContain('PARAMETROS_FISCAIS_PROVISORIOS');
  });

  it('vermelho do Omie (sem estrutura / Omie fora): bloqueado, sem custo nem preço', () => {
    const r = calcular(entrada(), dados({}, { avisos: [{ nivel: 'VERMELHO', codigo: 'OMIE_INDISPONIVEL', item: null, mensagem: 'x' }] }));
    expect(r).toMatchObject({ bloqueado: true, custo: null, precos: null });
    expect(r.avisos[0]!.codigo).toBe('OMIE_INDISPONIVEL');
  });

  it('cliente inconsistente: custo calculado, preço bloqueado', () => {
    const r = calcular(entrada(), dados({ MP1: { custoMedio: 10 } }), { cliente: null, avisosCliente: [{ nivel: 'VERMELHO', codigo: 'CLIENTE_INCONSISTENTE', item: '10', mensagem: 'x' }] });
    expect(r.custo!.custoLiquido).toBe(10);
    expect(r).toMatchObject({ bloqueado: true, precos: null, cenario: null });
  });

  it('NCM do produto fora da tabela NCM → IPI: vermelho, sem preço', () => {
    const r = calcular(entrada(), dados({ MP1: { custoMedio: 10 } }, { produto: { idProduto: 1, descricao: null, ncm: '11111111', conteudoImportado: false } }));
    expect(r).toMatchObject({ bloqueado: true, precos: null });
    expect(codigos(r)).toContain('IPI_VENDA_NCM_NAO_CONFIGURADO');
  });

  it('erro de regra vira tarja vermelha (nunca preço): UF sem alíquota interna (D), soma ≥ 100% e combinação inconsistente', () => {
    const semInterna = tabela({ ufs: UFS_INICIAIS.map((u) => (u.uf === 'BA' ? { ...u, aliquotaInterna: null } : { ...u })) });
    const d = calcular(entrada({ cliente: { uf: 'BA', contribuinte: false, comPta: false } }), dados({ MP1: { custoMedio: 10 } }), { tabela: semInterna });
    expect(d).toMatchObject({ bloqueado: true, precos: null });
    expect(codigos(d)).toContain('ALIQUOTA_INTERNA_UF_NAO_CONFIGURADA');
    const semPreco = calcular(entrada({ despesas: 50, margem: 50 }), dados({ MP1: { custoMedio: 10 } }));
    expect(codigos(semPreco)).toContain('SEM_PRECO_POSSIVEL');
    expect(semPreco.bloqueado).toBe(true);
    const inconsistente = calcular(entrada({ cliente: { uf: 'SP', contribuinte: true, comPta: true } }), dados({ MP1: { custoMedio: 10 } }));
    expect(codigos(inconsistente)).toContain('CLIENTE_INCONSISTENTE');
  });

  it('margem líquida é convertida para antes do IR/CS (10% ÷ 0,66)', () => {
    const r = calcular(entrada({ margem: 10, margemLiquida: true }), dados({ MP1: { custoMedio: 10 } }));
    expect(r.margemAntesIrCs).toBeCloseTo(0.1 / 0.66, 10);
  });

  it('item sem custo: preço sai, incompleto; tarja do mesmo item uma vez só (escolha "manual" sem manual + calcularCusto)', () => {
    const r = calcular(entrada({ escolhas: { MP1: 'MANUAL' } }), dados({ MP1: { custoMedio: 5 }, MP2: { custoMedio: 10 } }));
    expect(r).toMatchObject({ bloqueado: false, incompleto: true });
    expect(r.avisos.filter((a) => a.codigo === 'ITEM_SEM_CUSTO' && a.item === 'MP1')).toHaveLength(1);
    expect(r.custo!.custoLiquido).toBe(10);
  });

  it('custo "só nesta simulação" passa na frente do Omie e tira os créditos', () => {
    const r = calcular(entrada({ custosSimulacao: [manual('MP1')] }), dados({ MP1: { custoMedio: 50 } }));
    expect(r.itens[0]).toMatchObject({ origem: 'MANUAL_SIMULACAO', fonteCreditos: 'DADOS_MANUAIS' });
    expect(r.custo!.custoLiquido).toBeCloseTo(90.75, 10);
  });

  it('modo reverso: alvo abaixo do piso tem tarja vermelha no bloco do reverso, sem bloquear o preço principal', () => {
    const r = calcular(entrada({ precoAlvo: 130 }), dados({ MP1: { custoMedio: 90.75 } }));
    expect(r.reverso).toMatchObject({ abaixoDoPiso: true });
    expect(r.reverso!.avisos.map((a) => a.codigo)).toEqual(['ALVO_ABAIXO_DO_PISO']);
    expect(r.bloqueado).toBe(false);
    expect(codigos(r)).not.toContain('ALVO_ABAIXO_DO_PISO');
  });

  it('avisos ordenados: vermelho, amarelo, azul', () => {
    const r = calcular(entrada(), dados({ MP1: { custoMedio: null } }, { produto: { idProduto: 1, descricao: null, ncm: null, conteudoImportado: false } }));
    const niveis = r.avisos.map((a) => a.nivel);
    expect(niveis).toEqual([...niveis].sort((a, b) => ['VERMELHO', 'AMARELO', 'AZUL'].indexOf(a) - ['VERMELHO', 'AMARELO', 'AZUL'].indexOf(b)));
    expect(niveis[0]).toBe('VERMELHO');
  });
});

describe('validação estrita da entrada do cálculo (POST)', () => {
  const corpo = (s: Record<string, unknown> = {}) => ({ ...entrada(), ...s });

  it('aceita a entrada completa; código do produto em maiúsculas; cliente do Omie por código', () => {
    expect(validarEntradaCalculo(corpo({ produto: ' pa1 ' })).produto).toBe('PA1');
    expect(validarEntradaCalculo(corpo({ cliente: { codigo: 10 } })).cliente).toEqual({ codigo: 10 });
    expect(validarEntradaCalculo(corpo({ custosSimulacao: [manual('mp1')] })).custosSimulacao[0]!.codigo).toBe('MP1');
    expect(validarEntradaCalculo(corpo({ escolhas: { mp1: 'OMIE' } })).escolhas).toEqual({ MP1: 'OMIE' });
  });

  it('recusa campo desconhecido ou faltando, tipos errados e valores fora da faixa', () => {
    const ruins: Record<string, unknown>[] = [
      { extra: 1 },
      { produto: 'a b' },
      { quantidade: 0 },
      { quantidade: '1' },
      { finalidade: 'X' },
      { despesas: 100 },
      { comissao: -1 },
      { comissao: 0.5 },
      { comissao: 5 },
      { margem: '12' },
      { margemLiquida: 'S' },
      { precoAlvo: 0 },
      { cliente: { codigo: 0 } },
      { cliente: { codigo: 1, uf: 'SP' } },
      { cliente: { uf: 'EX', contribuinte: true, comPta: false } },
      { cliente: { uf: 'SP', contribuinte: 'S', comPta: false } },
      { custosSimulacao: [manual('MP1'), manual('mp1')] },
      { custosSimulacao: [{ ...manual('MP1'), valorNota: null }] },
      { escolhas: { MP1: 'X' } },
      { escolhas: [] },
    ];
    for (const s of ruins) expect(() => validarEntradaCalculo(corpo(s)), JSON.stringify(s)).toThrow();
    const { escolhas: _, ...semEscolhas } = corpo();
    expect(() => validarEntradaCalculo(semEscolhas)).toThrow(/faltam/);
  });
});
