/**
 * Formação de preço de venda — FUNÇÕES PURAS (sem banco, sem Omie, sem relógio).
 * Especificação: `docs/precificacao.md` (seções "Impostos na compra", "Regras de cálculo" e
 * "Exemplo numérico de validação").
 *
 * Convenções:
 * - Todo percentual entra e sai como FRAÇÃO (12% = 0.12). A conversão para exibição é da tela.
 * - Nenhum arredondamento intermediário: os valores saem crus e só a apresentação arredonda
 *   (`calculo/arredondamento.ts`), como no resto do app.
 * - Entrada inválida (tipo errado, negativa, não finita, percentual fora da faixa, divisor ≤ 0)
 *   lança `ErroValidacao` — nunca "melhor esforço", nunca um valor inventado. Em particular,
 *   booleanos têm de ser `boolean` de verdade: a string "false" vinda de um formulário é recusada,
 *   nunca lida como verdadeira.
 */

import { arredondarDinheiro } from '../calculo/arredondamento.js';
import { ErroValidacao } from '../validacao.js';
import { ErroPrecificacao, type Aviso } from './avisos.js';

// ─────────────────────────────── validação ───────────────────────────────

function exigirFinitoNaoNegativo(valor: unknown, nome: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
    throw new ErroValidacao(`${nome} deve ser um número maior ou igual a zero.`);
  }
  return valor;
}

/** Percentual como fração em [0, 1). */
function exigirFracao(valor: unknown, nome: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor >= 1) {
    throw new ErroValidacao(`${nome} deve ser um percentual entre 0% e 100% (exclusive).`);
  }
  return valor;
}

/** Percentual como fração em [0, 1] — para "quanto do ICMS é recolhido", que pode chegar a 100%. */
function exigirFracaoAte100(valor: unknown, nome: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > 1) {
    throw new ErroValidacao(`${nome} deve ser um percentual entre 0% e 100%.`);
  }
  return valor;
}

function exigirBooleano(valor: unknown, nome: string): boolean {
  if (typeof valor !== 'boolean') throw new ErroValidacao(`${nome} deve ser verdadeiro ou falso.`);
  return valor;
}

/** Busca numa tabela por UF só em chaves próprias (nunca em algo herdado do protótipo). */
function porUf(tabela: Partial<Record<Uf, number | null>>, uf: Uf): number | null | undefined {
  return Object.hasOwn(tabela, uf) ? tabela[uf] : undefined;
}

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;
export type Uf = (typeof UFS)[number];

export function validarUf(valor: unknown, nome = 'UF'): Uf {
  if (typeof valor !== 'string' || !(UFS as readonly string[]).includes(valor)) {
    throw new ErroValidacao(`${nome} inválida.`);
  }
  return valor as Uf;
}

/** Abaixo disso o divisor é ruído de ponto flutuante (soma que deveria dar 100%) — nunca um preço real. */
const DIVISOR_MINIMO = 1e-9;

// ─────────────────────────── impostos na compra ───────────────────────────

export type TipoFornecedor = 'INDUSTRIA_NORMAL' | 'SIMPLES_NACIONAL' | 'COMERCIO';
const TIPOS_FORNECEDOR: readonly TipoFornecedor[] = ['INDUSTRIA_NORMAL', 'SIMPLES_NACIONAL', 'COMERCIO'];

export interface ParametrosIcmsCompra {
  /** Compra de fornecedor de MG SEM PTA (padrão 18%). */
  icmsInternoMgCompra: number;
  /** Compra de fora de MG, de qualquer UF (12%) — os 7% só existem na VENDA de MG para N/NE/CO/ES. */
  icmsInterestadualCompra: number;
  /** Mercadoria importada comprada de fora de MG (4%). */
  icmsImportadoCompra: number;
}

export interface OrigemCompra {
  ufFornecedor: Uf;
  /**
   * "Fornecedor de MG com PTA?" (fiscal, 25/11/2026): o ICMS da compra só é 0% (diferimento) quando
   * o fornecedor é de MG E tem PTA. Fora disso, o ICMS é destacado e é custo. O nome do campo
   * (`diferimentoPta`) ficou o mesmo da API e do banco.
   */
  diferimentoPta: boolean;
  /** Só faz sentido fora de MG: mercadoria importada (ICMS 4%). */
  mercadoriaImportada: boolean;
}

/**
 * Alíquota de ICMS da compra. O ICMS da compra é SEMPRE custo (nunca crédito); a alíquota só serve
 * para tirá-lo da base do crédito de PIS/COFINS.
 */
export function aliquotaIcmsCompra(origem: OrigemCompra, parametros: ParametrosIcmsCompra): number {
  const uf = validarUf(origem.ufFornecedor, 'UF do fornecedor');
  const diferimentoPta = exigirBooleano(origem.diferimentoPta, 'Fornecedor de MG com PTA');
  const mercadoriaImportada = exigirBooleano(origem.mercadoriaImportada, 'Mercadoria importada');
  if (uf === 'MG') {
    if (mercadoriaImportada) {
      throw new ErroValidacao('"Mercadoria importada" só se aplica a compras de fora de MG.');
    }
    return diferimentoPta ? 0 : exigirFracao(parametros.icmsInternoMgCompra, 'ICMS interno de MG na compra');
  }
  if (diferimentoPta) {
    throw new ErroValidacao('"Fornecedor de MG com PTA" só se aplica a fornecedor de MG.');
  }
  if (mercadoriaImportada) {
    return exigirFracao(parametros.icmsImportadoCompra, 'ICMS de mercadoria importada na compra');
  }
  return exigirFracao(parametros.icmsInterestadualCompra, 'ICMS interestadual na compra');
}

/**
 * Alíquota de IPI da compra SEM nota de entrada (com nota, vale o IPI destacado na nota).
 * Decisão de 2026-11-24:
 * - Simples Nacional: sempre 0 (campo travado na tela); IPI informado diferente de 0 é recusado.
 * - Comércio/distribuidor: começa em 0, editável ("só se a nota destacar IPI — ex.: distribuidor de
 *   importado equiparado a indústria").
 * - Indústria normal: IPI informado, senão a alíquota do NCM no cadastro do componente; sem
 *   cadastro → `null` (item sem crédito, entra pelo valor bruto e marca o preço como incompleto).
 */
export function aliquotaIpiCompraSemNota(entrada: {
  tipoFornecedor: TipoFornecedor;
  ipiCadastro: number | null;
  ipiInformado?: number | null;
}): number | null {
  if (!TIPOS_FORNECEDOR.includes(entrada.tipoFornecedor)) throw new ErroValidacao('Tipo de fornecedor inválido.');
  const informado =
    entrada.ipiInformado === undefined || entrada.ipiInformado === null ? null : exigirFracao(entrada.ipiInformado, 'IPI informado');
  if (entrada.tipoFornecedor === 'SIMPLES_NACIONAL') {
    if (informado !== null && informado !== 0) {
      throw new ErroValidacao('Fornecedor do Simples Nacional não dá crédito de IPI: o IPI da compra é sempre 0.');
    }
    return 0;
  }
  if (informado !== null) return informado;
  if (entrada.tipoFornecedor === 'COMERCIO') return 0;
  if (entrada.ipiCadastro === null) return null;
  return exigirFracao(entrada.ipiCadastro, 'IPI do cadastro do componente');
}

export interface ValoresCompra {
  /** Valor dos produtos (sem IPI). */
  vProd: number;
  valorIpi: number;
  valorIcms: number;
}

/** Valor digitado como na nota (com impostos) → vProd, IPI e ICMS: vProd = V ÷ (1 + IPI); ICMS = vProd × alíquota. */
export function decomporValorNota(valorNota: number, aliquotaIpi: number, aliquotaIcms: number): ValoresCompra {
  exigirFinitoNaoNegativo(valorNota, 'Valor da nota');
  exigirFracao(aliquotaIpi, 'IPI da compra');
  exigirFracao(aliquotaIcms, 'ICMS da compra');
  const vProd = valorNota / (1 + aliquotaIpi);
  return { vProd, valorIpi: valorNota - vProd, valorIcms: vProd * aliquotaIcms };
}

export interface CreditosCompra extends ValoresCompra {
  /** Valor total pago (com IPI). */
  valorBruto: number;
  creditoIpi: number;
  creditoPisCofins: number;
  /** valorBruto − créditos. O ICMS fica no custo. */
  custoLiquido: number;
}

/**
 * Créditos da compra (nota de entrada, custo manual ou item estimado — mesma regra):
 * IPI recuperável; PIS/COFINS = alíquota × (vProd − ICMS); ICMS nunca é crédito.
 */
export function creditosDaCompra(valores: ValoresCompra, aliquotaPisCofins: number): CreditosCompra {
  const vProd = exigirFinitoNaoNegativo(valores.vProd, 'Valor dos produtos');
  const valorIpi = exigirFinitoNaoNegativo(valores.valorIpi, 'IPI da compra');
  const valorIcms = exigirFinitoNaoNegativo(valores.valorIcms, 'ICMS da compra');
  exigirFracao(aliquotaPisCofins, 'PIS/COFINS');
  if (valorIcms > vProd) throw new ErroValidacao('O ICMS da compra não pode ser maior que o valor dos produtos.');
  const creditoPisCofins = aliquotaPisCofins * (vProd - valorIcms);
  const valorBruto = vProd + valorIpi;
  return {
    vProd,
    valorIpi,
    valorIcms,
    valorBruto,
    creditoIpi: valorIpi,
    creditoPisCofins,
    custoLiquido: valorBruto - valorIpi - creditoPisCofins,
  };
}

// ─────────────────────────────── custo ───────────────────────────────

export interface ItemCusto {
  codigo: string;
  quantidade: number;
  /** Custo unitário bruto (com impostos) — `null` = sem custo. */
  custoBrutoUnitario: number | null;
  /**
   * Custo unitário líquido (sem os créditos). `null` com bruto preenchido = sem crédito possível
   * (componente sem NCM/IPI no cadastro): o item entra pelo valor BRUTO, sem crédito nenhum, e o
   * preço fica incompleto (decisão de 2026-11-24 — conservador: o preço sai alto, nunca baixo).
   */
  custoLiquidoUnitario: number | null;
}

export interface ResultadoCusto {
  custoBruto: number;
  creditos: number;
  custoLiquido: number;
  /** Itens sem custo: entraram com ZERO. */
  itensSemCusto: string[];
  /** Itens com custo mas sem NCM/IPI: entraram pelo valor bruto, sem crédito. */
  itensSemCredito: string[];
  /**
   * Custo de fabricação somado (sem crédito). Hoje é sempre 0: o "% de custo de fabricação" está
   * DESLIGADO (decisão de 2026-11-25 — o custo de fabricação fica dentro das "despesas fixas %").
   */
  custoFabricacao: number;
  completo: boolean;
  /** Avisos AMARELOS (preço incompleto), um por item. */
  avisos: Aviso[];
}

export interface OpcoesCusto {
  /**
   * Estrutura pronta para o futuro "% de custo de fabricação" da tabela fiscal — DESLIGADO por
   * padrão (0). Fração sobre o custo BRUTO dos materiais, somada ao bruto e ao líquido (não tem
   * crédito). A base exata deve ser confirmada com o usuário quando o parâmetro for ligado.
   */
  percentualCustoFabricacao?: number;
}

/**
 * Custo bruto = Σ quantidade × custo unitário; custo líquido = Σ quantidade × custo líquido.
 * Os itens são as FOLHAS da estrutura (`abrirEstrutura`): o kit nunca entra junto com os itens de
 * dentro dele. Não há GGF separado (decisão de 2026-11-25). Item sem custo entra com ZERO; item sem
 * NCM/IPI entra pelo bruto, sem crédito. Nos dois casos o preço sai mesmo assim, com aviso amarelo.
 */
export function calcularCusto(itens: ItemCusto[], opcoes: OpcoesCusto = {}): ResultadoCusto {
  let custoBruto = 0;
  let custoLiquido = 0;
  const itensSemCusto: string[] = [];
  const itensSemCredito: string[] = [];
  const avisos: Aviso[] = [];
  for (const item of itens) {
    const quantidade = exigirFinitoNaoNegativo(item.quantidade, `Quantidade do item ${item.codigo}`);
    // Custo 0 também é "sem custo" (decisão de 25/11/2026): nunca entra como custo válido em silêncio.
    if (item.custoBrutoUnitario === null || item.custoBrutoUnitario === 0) {
      // O mesmo código em vários ramos da estrutura: um aviso só ("X itens sem custo" sem contar a mais).
      if (itensSemCusto.includes(item.codigo)) continue;
      itensSemCusto.push(item.codigo);
      avisos.push({
        nivel: 'AMARELO',
        codigo: 'ITEM_SEM_CUSTO',
        item: item.codigo,
        mensagem: `Item ${item.codigo} sem custo — entrou como zero. Digite o custo manual.`,
      });
      continue;
    }
    const bruto = exigirFinitoNaoNegativo(item.custoBrutoUnitario, `Custo do item ${item.codigo}`);
    let liquido: number;
    if (item.custoLiquidoUnitario === null) {
      liquido = bruto;
      if (!itensSemCredito.includes(item.codigo)) {
        itensSemCredito.push(item.codigo);
        avisos.push({
          nivel: 'AMARELO',
          codigo: 'ITEM_SEM_NCM_IPI',
          item: item.codigo,
          mensagem: `Item ${item.codigo} sem NCM ou alíquota de IPI no cadastro — entrou pelo valor bruto, sem crédito. Corrija o cadastro do item ${item.codigo} no Omie.`,
        });
      }
    } else {
      liquido = exigirFinitoNaoNegativo(item.custoLiquidoUnitario, `Custo líquido do item ${item.codigo}`);
      if (liquido > bruto) throw new ErroValidacao(`Custo líquido do item ${item.codigo} maior que o custo bruto.`);
    }
    custoBruto += quantidade * bruto;
    custoLiquido += quantidade * liquido;
  }
  const percentual = exigirFracao(opcoes.percentualCustoFabricacao ?? 0, '% de custo de fabricação');
  const custoFabricacao = percentual * custoBruto;
  custoBruto += custoFabricacao;
  custoLiquido += custoFabricacao;
  return {
    custoBruto,
    creditos: custoBruto - custoLiquido,
    custoLiquido,
    itensSemCusto,
    itensSemCredito,
    custoFabricacao,
    completo: avisos.length === 0,
    avisos,
  };
}

// ─────────────────────────────── cenário de venda ───────────────────────────────

export type Cenario = 'A' | 'B' | 'C' | 'D';
const CENARIOS: readonly Cenario[] = ['A', 'B', 'C', 'D'];

export interface ClienteVenda {
  uf: Uf;
  contribuinte: boolean;
  /** Venda para uso e consumo (mesmo de contribuinte) = consumidor final — gera DIFAL fora de MG. */
  usoConsumo: boolean;
  /**
   * "Cliente com PTA (compra para industrialização)": industrializador de MG com PTA, autorizado a
   * comprar com diferimento. Só vale para cliente de MG contribuinte.
   */
  clienteComPta: boolean;
  /** Esta venda é para industrialização? Cenário A (sem ICMS) só com venda para industrialização E cliente com PTA. */
  vendaParaIndustrializacao: boolean;
}

export interface ParametrosVenda {
  pisCofins: number;
  /** Ligado: o ganho do ICMS (parte destacada e não recolhida) entra na base do PIS/COFINS. */
  ganhoIcmsNaBasePisCofins: boolean;
  /** Fração do ICMS destacado que é recolhida na venda a CONTRIBUINTE (PTA da ETK: 0 hoje; transição da Reforma). */
  percentualRecolhimentoIcms: number;
  /**
   * Fração recolhida na venda a NÃO CONTRIBUINTE ou CONSUMIDOR FINAL (uso e consumo), em MG
   * (cenário B) e fora de MG (cenário D). O PTA não se aplica: padrão 100% (fiscal, 25/11/2026).
   */
  percentualRecolhimentoIcmsConsumidorFinal: number;
  /** Alíquota interna geral de MG na venda (cenário B), padrão 18% — vale quando o NCM não tem exceção. */
  icmsInternoMgVenda: number;
  /** ICMS interestadual de venda por UF de destino (12% ou 7%). */
  icmsInterestadualVendaPorUf: Partial<Record<Uf, number>>;
  /** ICMS de venda para conteúdo importado (4%). */
  icmsImportadoVenda: number;
  /** Alíquota interna de cada UF (DIFAL) — `null`/ausente = não configurada (erro só no cenário D). */
  aliquotaInternaPorUf: Partial<Record<Uf, number | null>>;
}

export interface ProdutoVenda {
  /** Exceção por NCM da alíquota interna de MG (cenário B) — `null` = sem exceção, vale a geral. */
  icmsInternoMgExcecaoNcm: number | null;
  /** Origem do produto com conteúdo importado → ICMS 4% na venda interestadual. */
  conteudoImportado: boolean;
}

export interface ResultadoCenario {
  cenario: Cenario;
  motivo: string;
  icmsDestacado: number;
  icmsRecolhido: number;
  pisCofinsEfetivo: number;
  difal: number;
  /** Avisos AZUIS do cenário (regra pendente de confirmação do fiscal). */
  avisos: Aviso[];
}

export const AVISO_DIFAL_BASE_SIMPLES: Aviso = {
  nivel: 'AZUL',
  codigo: 'DIFAL_BASE_SIMPLES',
  item: null,
  mensagem: 'DIFAL calculado na base simples — validar com o fiscal.',
};

function pct(fracao: number): string {
  return `${(fracao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/**
 * PIS/COFINS efetivo sobre o preço. A base exclui o ICMS destacado (Tema 69). Com a chave ligada, o
 * ganho do ICMS (parte destacada e NÃO recolhida) volta para a base: base = P × (1 − ICMS × recolhimento).
 * Com recolhimento 0, a chave ligada dá o PIS/COFINS cheio.
 */
function pisCofinsEfetivo(pisCofins: number, icmsDestacado: number, recolhimento: number, ganhoNaBase: boolean): number {
  return ganhoNaBase ? pisCofins * (1 - icmsDestacado * recolhimento) : pisCofins * (1 - icmsDestacado);
}

/** Escolhe o cenário A/B/C/D e os percentuais sobre o preço (tabela do passo 3 da spec). */
export function determinarCenario(cliente: ClienteVenda, produto: ProdutoVenda, parametros: ParametrosVenda): ResultadoCenario {
  const uf = validarUf(cliente.uf, 'UF do cliente');
  const contribuinte = exigirBooleano(cliente.contribuinte, 'Cliente contribuinte');
  const usoConsumo = exigirBooleano(cliente.usoConsumo, 'Venda para uso e consumo');
  const autorizado = exigirBooleano(cliente.clienteComPta, 'Cliente com PTA (compra para industrialização)');
  const industrializacao = exigirBooleano(cliente.vendaParaIndustrializacao, 'Venda para industrialização');
  const conteudoImportado = exigirBooleano(produto.conteudoImportado, 'Produto com conteúdo importado');
  const ganhoNaBase = exigirBooleano(parametros.ganhoIcmsNaBasePisCofins, 'Ganho do ICMS na base de PIS/COFINS');
  const pisCofins = exigirFracao(parametros.pisCofins, 'PIS/COFINS');
  const recolhimento = exigirFracaoAte100(parametros.percentualRecolhimentoIcms, 'Percentual de recolhimento do ICMS');
  // Não contribuinte ou uso e consumo = consumidor final: o PTA não se aplica, o ICMS é recolhido.
  const consumidorFinal = !contribuinte || usoConsumo;
  const recolhimentoConsumidorFinal = exigirFracaoAte100(
    parametros.percentualRecolhimentoIcmsConsumidorFinal,
    '% de recolhimento do ICMS na venda a não contribuinte/consumidor final',
  );
  const recolhimentoDaVenda = consumidorFinal ? recolhimentoConsumidorFinal : recolhimento;

  if (autorizado && uf !== 'MG') {
    throw new ErroPrecificacao(
      'CLIENTE_INCONSISTENTE',
      uf,
      `Cliente de ${uf} marcado como "cliente com PTA (compra para industrialização)", que só se aplica a cliente de MG. Corrija o cadastro do cliente.`,
    );
  }
  if (autorizado && !contribuinte) {
    throw new ErroPrecificacao(
      'CLIENTE_INCONSISTENTE',
      uf,
      'Cliente marcado como "cliente com PTA (compra para industrialização)" sem ser contribuinte (o PTA é de industrializador). Corrija o cadastro do cliente.',
    );
  }
  if (industrializacao && usoConsumo) {
    throw new ErroPrecificacao('CLIENTE_INCONSISTENTE', uf, 'A venda não pode ser ao mesmo tempo "para industrialização" e "para uso e consumo". Escolha uma.');
  }
  if (industrializacao && !contribuinte) {
    throw new ErroPrecificacao('CLIENTE_INCONSISTENTE', uf, 'Venda "para industrialização" exige cliente contribuinte. Corrija a venda ou o cadastro do cliente.');
  }

  if (uf === 'MG') {
    if (autorizado && industrializacao) {
      return {
        cenario: 'A',
        motivo: 'Cliente MG com PTA, venda para industrialização → nota sem ICMS',
        icmsDestacado: 0,
        icmsRecolhido: 0,
        pisCofinsEfetivo: pisCofins,
        difal: 0,
        avisos: [],
      };
    }
    const icms =
      produto.icmsInternoMgExcecaoNcm === null
        ? exigirFracao(parametros.icmsInternoMgVenda, 'ICMS interno geral de MG na venda')
        : exigirFracao(produto.icmsInternoMgExcecaoNcm, 'ICMS interno de MG do NCM (exceção)');
    const quem = !contribuinte
      ? 'não contribuinte'
      : usoConsumo
        ? 'uso e consumo'
        : autorizado
          ? 'com PTA, venda que não é para industrialização'
          : 'contribuinte sem PTA';
    const recolhe = consumidorFinal ? ` (consumidor final: ${pct(recolhimentoDaVenda)} recolhido)` : '';
    return {
      cenario: 'B',
      motivo: `Cliente MG ${quem} → ICMS ${pct(icms)}${recolhe}`,
      icmsDestacado: icms,
      icmsRecolhido: icms * recolhimentoDaVenda,
      pisCofinsEfetivo: pisCofinsEfetivo(pisCofins, icms, recolhimentoDaVenda, ganhoNaBase),
      difal: 0,
      avisos: [],
    };
  }

  let icms: number;
  if (conteudoImportado) {
    icms = exigirFracao(parametros.icmsImportadoVenda, 'ICMS de venda de importado');
  } else {
    const aliquota = porUf(parametros.icmsInterestadualVendaPorUf, uf);
    if (aliquota === undefined || aliquota === null) {
      throw new ErroPrecificacao(
        'ICMS_INTERESTADUAL_UF_NAO_CONFIGURADO',
        uf,
        `ICMS interestadual de venda para ${uf} não configurado. Peça ao administrador para preencher a UF ${uf} na tabela fiscal.`,
      );
    }
    icms = exigirFracao(aliquota, `ICMS interestadual de venda (${uf})`);
  }
  const origemIcms = conteudoImportado ? `ICMS ${pct(icms)} (importado)` : `ICMS ${pct(icms)}`;

  if (contribuinte && !usoConsumo) {
    return {
      cenario: 'C',
      motivo: `Cliente ${uf} contribuinte → ${origemIcms}`,
      icmsDestacado: icms,
      icmsRecolhido: icms * recolhimento,
      pisCofinsEfetivo: pisCofinsEfetivo(pisCofins, icms, recolhimento, ganhoNaBase),
      difal: 0,
      avisos: [],
    };
  }

  const interna = porUf(parametros.aliquotaInternaPorUf, uf);
  if (interna === undefined || interna === null) {
    throw new ErroPrecificacao(
      'ALIQUOTA_INTERNA_UF_NAO_CONFIGURADA',
      uf,
      `Alíquota interna de ${uf} (DIFAL) não configurada. Peça ao administrador para preencher a UF ${uf} na tabela fiscal.`,
    );
  }
  // DIFAL negativo não existe: alíquota interna menor que a interestadual dá DIFAL zero.
  const difal = Math.max(0, exigirFracao(interna, `Alíquota interna (${uf})`) - icms);
  const quem = contribuinte ? 'contribuinte, uso e consumo' : 'não contribuinte';
  return {
    cenario: 'D',
    motivo: `Cliente ${uf} ${quem} → ${origemIcms} (consumidor final: ${pct(recolhimentoDaVenda)} recolhido) + DIFAL ${pct(difal)}`,
    icmsDestacado: icms,
    icmsRecolhido: icms * recolhimentoDaVenda,
    pisCofinsEfetivo: pisCofinsEfetivo(pisCofins, icms, recolhimentoDaVenda, ganhoNaBase),
    difal,
    avisos: [AVISO_DIFAL_BASE_SIMPLES],
  };
}

/** Confere um cenário recebido de fora (cache, banco, JSON) antes de usá-lo numa conta. */
function validarCenario(cenario: ResultadoCenario): void {
  if (!CENARIOS.includes(cenario.cenario)) throw new ErroValidacao('Cenário de venda inválido.');
  const destacado = exigirFracao(cenario.icmsDestacado, 'ICMS destacado');
  const recolhido = exigirFracao(cenario.icmsRecolhido, 'ICMS recolhido');
  exigirFracao(cenario.pisCofinsEfetivo, 'PIS/COFINS efetivo');
  exigirFracao(cenario.difal, 'DIFAL');
  if (recolhido > destacado) throw new ErroValidacao('ICMS recolhido não pode ser maior que o ICMS destacado.');
}

// ─────────────────────────────── preço ───────────────────────────────

export interface Comercial {
  comissao: number;
  despesas: number;
  /** Margem ANTES do IR/CS (use `margemAntesDoIrCs` para converter uma margem líquida). */
  margem: number;
}

/** Margem informada como líquida → antes do IR/CS: m ÷ (1 − IR/CS) (10% líquido ≈ 15,2% com IR/CS de 34%). */
export function margemAntesDoIrCs(margemLiquida: number, irCs: number): number {
  const antes = exigirFracao(margemLiquida, 'Margem líquida') / (1 - exigirFracao(irCs, 'IR/CS'));
  if (antes >= 1) {
    throw new ErroValidacao(`Margem líquida de ${pct(margemLiquida)} equivale a ${pct(antes)} antes do IR/CS — acima de 100%, não há preço possível.`);
  }
  return antes;
}

/** Entrada comum de `calcularLucro`, `calcularPrecos` e `calcularReverso` (objeto, para nunca trocar números de posição). */
export interface EntradaPreco {
  custoLiquido: number;
  cenario: ResultadoCenario;
  comercial: Comercial;
  irCs: number;
  aliquotaIpiVenda: number;
}

export interface Lucro {
  preco: number;
  icmsDestacado: number;
  /** Parte do ICMS destacado que não é recolhida e fica no lucro. */
  icmsNoLucro: number;
  icmsRecolhido: number;
  pisCofins: number;
  difal: number;
  comissao: number;
  despesas: number;
  lucroAntesIrCs: number;
  irCs: number;
  lucroDepoisIrCs: number;
  /** lucro ÷ preço (`null` se o preço for zero). */
  margemAntesIrCs: number | null;
  margemDepoisIrCs: number | null;
}

function validarEntrada(entrada: EntradaPreco): void {
  exigirFinitoNaoNegativo(entrada.custoLiquido, 'Custo líquido');
  validarCenario(entrada.cenario);
  exigirFracao(entrada.comercial.comissao, 'Comissão');
  exigirFracao(entrada.comercial.despesas, 'Despesas');
  exigirFracao(entrada.comercial.margem, 'Margem');
  exigirFracao(entrada.irCs, 'IR/CS');
  exigirFracao(entrada.aliquotaIpiVenda, 'IPI da venda');
}

function lucroSemValidar(preco: number, e: EntradaPreco): Lucro {
  const { custoLiquido, cenario, comercial } = e;
  const icmsDestacado = preco * cenario.icmsDestacado;
  const icmsRecolhido = preco * cenario.icmsRecolhido;
  const pisCofins = preco * cenario.pisCofinsEfetivo;
  const difal = preco * cenario.difal;
  const comissao = preco * comercial.comissao;
  const despesas = preco * comercial.despesas;
  const lucroAntesIrCs = preco - custoLiquido - pisCofins - difal - comissao - despesas - icmsRecolhido;
  // Prejuízo não gera IR/CS (decisão aprovada em 2026-11-24): lucro depois = lucro antes.
  const valorIrCs = lucroAntesIrCs > 0 ? lucroAntesIrCs * e.irCs : 0;
  const lucroDepoisIrCs = lucroAntesIrCs - valorIrCs;
  return {
    preco,
    icmsDestacado,
    icmsNoLucro: icmsDestacado - icmsRecolhido,
    icmsRecolhido,
    pisCofins,
    difal,
    comissao,
    despesas,
    lucroAntesIrCs,
    irCs: valorIrCs,
    lucroDepoisIrCs,
    margemAntesIrCs: preco === 0 ? null : lucroAntesIrCs / preco,
    margemDepoisIrCs: preco === 0 ? null : lucroDepoisIrCs / preco,
  };
}

/**
 * Passo 7: lucro para qualquer preço P (sem IPI).
 * Antes do IR/CS = P − C_liq − PIS/COFINS − DIFAL − comissão − despesas − ICMS recolhido
 * (o ICMS destacado e não recolhido fica todo no lucro). Depois = antes × (1 − IR/CS).
 */
export function calcularLucro(preco: number, entrada: EntradaPreco): Lucro {
  exigirFinitoNaoNegativo(preco, 'Preço');
  validarEntrada(entrada);
  return lucroSemValidar(preco, entrada);
}

export interface PrecoFormado {
  divisor: number;
  /** Preço sem IPI. */
  preco: number;
  ipi: number;
  precoComIpi: number;
  lucro: Lucro;
}

function divisores(e: EntradaPreco): { cheio: number; piso: number } {
  const comum = e.cenario.pisCofinsEfetivo + e.cenario.difal + e.comercial.comissao + e.comercial.despesas + e.comercial.margem;
  return { cheio: 1 - (e.cenario.icmsDestacado + comum), piso: 1 - (e.cenario.icmsRecolhido + comum) };
}

function formarPreco(divisor: number, e: EntradaPreco): PrecoFormado {
  const preco = e.custoLiquido / divisor;
  const ipi = preco * e.aliquotaIpiVenda;
  return { divisor, preco, ipi, precoComIpi: preco + ipi, lucro: lucroSemValidar(preco, e) };
}

export interface ResultadoPrecos {
  /** `null` quando só o cheio é impossível (divisor ≤ 0) — o piso ainda existe. */
  cheio: PrecoFormado | null;
  piso: PrecoFormado;
  avisos: Aviso[];
}

const MENSAGEM_SEM_PRECO =
  'A soma de impostos, comissão, despesas e margem chega a 100% ou mais — não há preço possível. Reduza a margem, a comissão ou as despesas.';

/**
 * Passos 4 a 6.
 * Cheio: C_liq ÷ [1 − (ICMS destacado + PIS/COFINS ef. + DIFAL + comissão + despesas + margem)] — o ICMS
 * entra no divisor como se fosse pago e vira margem extra.
 * Piso:  C_liq ÷ [1 − (ICMS recolhido + PIS/COFINS ef. + DIFAL + comissão + despesas + margem)] — só o ICMS
 * efetivamente recolhido é custo (0% hoje, então igual à fórmula da spec).
 * IPI da venda: preço × alíquota do NCM, somado por fora.
 */
export function calcularPrecos(entrada: EntradaPreco): ResultadoPrecos {
  validarEntrada(entrada);
  const d = divisores(entrada);
  if (!(d.piso > DIVISOR_MINIMO)) throw new ErroPrecificacao('SEM_PRECO_POSSIVEL', null, MENSAGEM_SEM_PRECO);
  const cheio = d.cheio > DIVISOR_MINIMO ? formarPreco(d.cheio, entrada) : null;
  const avisos: Aviso[] =
    cheio === null
      ? [
          {
            nivel: 'AZUL',
            codigo: 'PRECO_CHEIO_INDISPONIVEL',
            item: null,
            mensagem: 'Preço cheio indisponível: com o ICMS destacado no divisor, a soma passa de 100%. Vale só o preço piso.',
          },
        ]
      : [];
  return { cheio, piso: formarPreco(d.piso, entrada), avisos };
}

export interface ResultadoReverso {
  lucro: Lucro;
  ipi: number;
  precoComIpi: number;
  /** Preço piso para comparação (`null` se não existir preço que entregue a margem pedida). */
  precoPiso: number | null;
  /** Comparação em centavos, como o operador vê na tela; sem piso possível, todo preço fica abaixo. */
  abaixoDoPiso: boolean;
  /** Tarja do bloco do modo reverso (vermelha quando o alvo fica abaixo do piso). */
  avisos: Aviso[];
}

function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Modo reverso: preço-alvo (sem IPI) → lucro e margens reais; avisa se ficar abaixo do piso. */
export function calcularReverso(precoAlvo: number, entrada: EntradaPreco): ResultadoReverso {
  exigirFinitoNaoNegativo(precoAlvo, 'Preço-alvo');
  validarEntrada(entrada);
  const { piso } = divisores(entrada);
  const precoPiso = piso > DIVISOR_MINIMO ? entrada.custoLiquido / piso : null;
  const ipi = precoAlvo * entrada.aliquotaIpiVenda;
  const abaixoDoPiso = precoPiso === null || arredondarDinheiro(precoAlvo) < arredondarDinheiro(precoPiso);
  const avisos: Aviso[] = abaixoDoPiso
    ? [
        {
          nivel: 'VERMELHO',
          codigo: 'ALVO_ABAIXO_DO_PISO',
          item: null,
          mensagem:
            precoPiso === null
              ? `Preço-alvo ${reais(precoAlvo)}: não existe preço que entregue a margem pedida.`
              : `Preço-alvo ${reais(precoAlvo)} abaixo do preço piso de ${reais(arredondarDinheiro(precoPiso))}.`,
        },
      ]
    : [];
  return { lucro: lucroSemValidar(precoAlvo, entrada), ipi, precoComIpi: precoAlvo + ipi, precoPiso, abaixoDoPiso, avisos };
}
