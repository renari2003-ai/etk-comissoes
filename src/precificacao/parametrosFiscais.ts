/**
 * Tabela fiscal editável da formação de preço — tipos, valores iniciais, validação ESTRITA do que
 * chega pela API e conversão para os parâmetros do cálculo (`calculo.ts`). Sem banco: o
 * repositório fica em `parametrosFiscaisRepositorio.ts`.
 *
 * Unidade: na API e no banco, todo percentual é em PONTOS PERCENTUAIS (9,25 = 9,25%), com no
 * máximo 4 casas decimais. O cálculo usa frações — a conversão é feita só aqui.
 */

import { ErroValidacao } from '../validacao.js';
import type { Aviso } from './avisos.js';
import { UFS, type ParametrosIcmsCompra, type ParametrosVenda, type Uf } from './calculo.js';

export interface ParametrosGerais {
  pisCofins: number;
  irCs: number;
  ganhoIcmsNaBasePisCofins: boolean;
  /** Recolhimento do ICMS destacado na venda a CONTRIBUINTE (o PTA da ETK: 0 hoje). */
  percentualRecolhimentoIcms: number;
  /**
   * Recolhimento do ICMS destacado na venda a NÃO CONTRIBUINTE ou CONSUMIDOR FINAL (uso e consumo),
   * em MG (cenário B) e fora de MG (cenário D). O PTA não se aplica: padrão 100% (fiscal, 25/11/2026).
   * Guardado na tabela `precificacao_parametros_fiscais_extra` (a coluna antiga
   * `recolhimento_icms_mg_nao_contribuinte` deixou de ser usada; nada de ALTER).
   */
  percentualRecolhimentoIcmsConsumidorFinal: number;
  /** Alíquota interna geral de MG na venda (cenário B), quando o NCM não tem exceção. */
  icmsInternoMgVenda: number;
  /** Compra de fornecedor de MG SEM PTA (com PTA, o ICMS da compra é 0%). */
  icmsInternoMgCompra: number;
  /** Entrada em MG vinda de qualquer outra UF. */
  icmsInterestadualCompra: number;
  icmsImportadoVenda: number;
  icmsImportadoCompra: number;
}

export interface IcmsUf {
  uf: Exclude<Uf, 'MG'>;
  /** ICMS interestadual na venda de MG para esta UF (12% ou 7%). */
  icmsInterestadualVenda: number;
  /** Alíquota interna da UF (DIFAL) — `null` = não configurada (tarja vermelha só no cenário D). */
  aliquotaInterna: number | null;
}

export interface ExcecaoNcm {
  /** 8 dígitos, sem pontos. */
  ncm: string;
  aliquota: number;
}

/**
 * Alíquota de IPI por NCM (decisão de 26/11/2026): o cadastro de produto do Omie não tem alíquota de
 * IPI, só o NCM. Vale para o IPI na venda do produto acabado e para o IPI da compra sem nota
 * (indústria normal sem IPI informado). Começa vazia, "a confirmar pelo fiscal".
 */
export interface IpiNcm {
  /** 8 dígitos, sem pontos. */
  ncm: string;
  /** IPI em pontos (12 = 12%); 0 é válido (NCM com IPI zero). */
  aliquota: number;
}

export interface TabelaFiscal {
  gerais: ParametrosGerais;
  ufs: IcmsUf[];
  excecoesNcm: ExcecaoNcm[];
  ipiNcm: IpiNcm[];
}

/** Status da tabela fiscal: enquanto "PROVISORIO", todo cálculo mostra a tarja azul. Só administrador muda. */
export type StatusTabelaFiscal = 'PROVISORIO' | 'VALIDADO';
export const STATUS_TABELA_FISCAL: readonly StatusTabelaFiscal[] = ['PROVISORIO', 'VALIDADO'];

export interface TabelaFiscalComMetadados extends TabelaFiscal {
  status: StatusTabelaFiscal;
  statusAlteradoEm: string | null;
  statusAlteradoPor: string | null;
  /** Controle de concorrência otimista: o PUT tem de mandar a versão que leu. */
  versao: number;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

export const UFS_FORA_DE_MG = UFS.filter((uf): uf is Exclude<Uf, 'MG'> => uf !== 'MG');

/** Venda de MG (Sudeste) para Sul e Sudeste, exceto ES: 12%. Para Norte, Nordeste, Centro-Oeste e ES: 7%. */
const UFS_VENDA_12 = new Set<Uf>(['PR', 'RJ', 'RS', 'SC', 'SP']);

export const PARAMETROS_GERAIS_INICIAIS: ParametrosGerais = {
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
};

/**
 * Alíquotas internas iniciais de cada UF (DIFAL), em pontos — fonte: Buscador NCM, nov/2026, SEM FCP
 * (o FCP depende do produto). Valores "a confirmar pelo fiscal": todos editáveis, e a tabela nasce
 * com o status "Provisório". MG (18%) não entra nesta tabela: a venda interna usa `icmsInternoMgVenda`.
 */
export const ALIQUOTAS_INTERNAS_INICIAIS: Readonly<Record<Exclude<Uf, 'MG'>, number>> = {
  AC: 19, AL: 20.5, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23, MS: 17, MT: 17, PA: 19,
  PB: 20, PE: 20.5, PI: 22.5, PR: 19.5, RJ: 20, RN: 20, RO: 19.5, RR: 20, RS: 17, SC: 17, SE: 19, SP: 18, TO: 20,
};
export const FONTE_ALIQUOTAS_INTERNAS = 'Valor inicial: Buscador NCM, nov/2026 (a confirmar pelo fiscal)';

export const UFS_INICIAIS: IcmsUf[] = UFS_FORA_DE_MG.map((uf) => ({
  uf,
  icmsInterestadualVenda: UFS_VENDA_12.has(uf) ? 12 : 7,
  aliquotaInterna: ALIQUOTAS_INTERNAS_INICIAIS[uf],
}));

export const MAX_EXCECOES_NCM = 1000;

// ─────────────────────────────── validação do PUT ───────────────────────────────

function exigirObjetoComChaves(valor: unknown, chaves: readonly string[], nome: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new ErroValidacao(`${nome} deve ser um objeto.`);
  }
  const objeto = valor as Record<string, unknown>;
  const extras = Object.keys(objeto).filter((k) => !chaves.includes(k));
  if (extras.length > 0) {
    const lista = extras.slice(0, 5).map((k) => (k.length > 40 ? `${k.slice(0, 40)}…` : k));
    throw new ErroValidacao(`${nome}: campo(s) não reconhecido(s): ${lista.join(', ')}${extras.length > 5 ? ` e mais ${extras.length - 5}` : ''}.`);
  }
  const faltando = chaves.filter((k) => !Object.hasOwn(objeto, k));
  if (faltando.length > 0) throw new ErroValidacao(`${nome}: campo(s) obrigatório(s) ausente(s): ${faltando.join(', ')}.`);
  return objeto;
}

/**
 * Percentual em pontos: número finito em [0, máximo) (ou [0, 100] com `ate100`), com no máximo 4 casas.
 * Devolve o valor ARREDONDADO às 4 casas que o banco guarda (NUMERIC(7,4)) — assim um 9.25000000001
 * nunca vira um "9.25 ≠ 9.25000000001" falso no histórico.
 */
function exigirPercentual(valor: unknown, nome: string, ate100 = false): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || (ate100 ? valor > 100 : valor >= 100)) {
    throw new ErroValidacao(`${nome} deve ser um percentual entre 0 e ${ate100 ? '100' : '100 (exclusive)'}.`);
  }
  if (Math.abs(valor * 10_000 - Math.round(valor * 10_000)) > 1e-6) {
    throw new ErroValidacao(`${nome} aceita no máximo 4 casas decimais.`);
  }
  return Math.round(valor * 10_000) / 10_000;
}

function exigirBooleano(valor: unknown, nome: string): boolean {
  if (typeof valor !== 'boolean') throw new ErroValidacao(`${nome} deve ser verdadeiro ou falso.`);
  return valor;
}

const CHAVES_GERAIS = Object.keys(PARAMETROS_GERAIS_INICIAIS) as Array<keyof ParametrosGerais>;

export function validarParametrosGerais(valor: unknown): ParametrosGerais {
  const o = exigirObjetoComChaves(valor, CHAVES_GERAIS, 'Parâmetros gerais');
  return {
    pisCofins: exigirPercentual(o.pisCofins, 'PIS/COFINS'),
    irCs: exigirPercentual(o.irCs, 'IRPJ + CSLL'),
    ganhoIcmsNaBasePisCofins: exigirBooleano(o.ganhoIcmsNaBasePisCofins, 'Ganho do ICMS na base de PIS/COFINS'),
    percentualRecolhimentoIcms: exigirPercentual(o.percentualRecolhimentoIcms, 'Percentual de recolhimento do ICMS', true),
    percentualRecolhimentoIcmsConsumidorFinal: exigirPercentual(
      o.percentualRecolhimentoIcmsConsumidorFinal,
      '% de recolhimento do ICMS na venda a não contribuinte/consumidor final',
      true,
    ),
    icmsInternoMgVenda: exigirPercentual(o.icmsInternoMgVenda, 'ICMS interno de MG na venda'),
    icmsInternoMgCompra: exigirPercentual(o.icmsInternoMgCompra, 'ICMS interno de MG na compra'),
    icmsInterestadualCompra: exigirPercentual(o.icmsInterestadualCompra, 'ICMS interestadual na compra'),
    icmsImportadoVenda: exigirPercentual(o.icmsImportadoVenda, 'ICMS de importado na venda'),
    icmsImportadoCompra: exigirPercentual(o.icmsImportadoCompra, 'ICMS de importado na compra'),
  };
}

/** Exatamente as 26 UFs fora de MG, uma vez cada. */
export function validarUfs(valor: unknown): IcmsUf[] {
  if (!Array.isArray(valor)) throw new ErroValidacao('UFs deve ser uma lista.');
  const vistas = new Set<string>();
  const ufs = valor.map((bruto, i) => {
    const o = exigirObjetoComChaves(bruto, ['uf', 'icmsInterestadualVenda', 'aliquotaInterna'], `UF na posição ${i + 1}`);
    if (typeof o.uf !== 'string' || !(UFS_FORA_DE_MG as readonly string[]).includes(o.uf)) {
      throw new ErroValidacao(`UF na posição ${i + 1} inválida (MG não entra nesta tabela).`);
    }
    if (vistas.has(o.uf)) throw new ErroValidacao(`UF ${o.uf} repetida.`);
    vistas.add(o.uf);
    return {
      uf: o.uf as Exclude<Uf, 'MG'>,
      icmsInterestadualVenda: exigirPercentual(o.icmsInterestadualVenda, `ICMS interestadual de venda (${o.uf})`),
      aliquotaInterna: o.aliquotaInterna === null ? null : exigirPercentual(o.aliquotaInterna, `Alíquota interna (${o.uf})`),
    };
  });
  const faltando = UFS_FORA_DE_MG.filter((uf) => !vistas.has(uf));
  if (faltando.length > 0) throw new ErroValidacao(`Faltam UFs na tabela: ${faltando.join(', ')}.`);
  return ufs;
}

/** Lista de { ncm, aliquota } (exceções de ICMS de MG ou IPI por NCM): NCM de 8 dígitos, sem repetir. */
function validarListaNcm(valor: unknown, nomeLista: string, nomeItem: string, nomeAliquota: string): { ncm: string; aliquota: number }[] {
  if (!Array.isArray(valor)) throw new ErroValidacao(`${nomeLista} deve ser uma lista.`);
  if (valor.length > MAX_EXCECOES_NCM) throw new ErroValidacao(`No máximo ${MAX_EXCECOES_NCM} NCMs em ${nomeLista}.`);
  const vistos = new Set<string>();
  return valor.map((bruto, i) => {
    const o = exigirObjetoComChaves(bruto, ['ncm', 'aliquota'], `${nomeItem} na posição ${i + 1}`);
    if (typeof o.ncm !== 'string' || !/^\d{8}$/.test(o.ncm)) {
      throw new ErroValidacao(`NCM na posição ${i + 1} de ${nomeLista} inválido: use os 8 dígitos, sem pontos.`);
    }
    if (vistos.has(o.ncm)) throw new ErroValidacao(`NCM ${o.ncm} repetido em ${nomeLista}.`);
    vistos.add(o.ncm);
    return { ncm: o.ncm, aliquota: exigirPercentual(o.aliquota, `${nomeAliquota} do NCM ${o.ncm}`) };
  });
}

export function validarExcecoesNcm(valor: unknown): ExcecaoNcm[] {
  return validarListaNcm(valor, 'Exceções por NCM', 'Exceção', 'Alíquota');
}

export function validarIpiNcm(valor: unknown): IpiNcm[] {
  return validarListaNcm(valor, 'IPI por NCM', 'IPI por NCM', 'IPI');
}

export function validarTabelaFiscal(valor: unknown): TabelaFiscal {
  const o = exigirObjetoComChaves(valor, ['gerais', 'ufs', 'excecoesNcm', 'ipiNcm'], 'Tabela fiscal');
  return {
    gerais: validarParametrosGerais(o.gerais),
    ufs: validarUfs(o.ufs),
    excecoesNcm: validarExcecoesNcm(o.excecoesNcm),
    ipiNcm: validarIpiNcm(o.ipiNcm),
  };
}

/** Corpo do PUT do status: `{ status, versao }` (só administrador). */
export function validarAtualizacaoStatus(valor: unknown): { versao: number; status: StatusTabelaFiscal } {
  const o = exigirObjetoComChaves(valor, ['versao', 'status'], 'Status da tabela fiscal');
  if (typeof o.versao !== 'number' || !Number.isSafeInteger(o.versao) || o.versao < 0) {
    throw new ErroValidacao('Versão da tabela fiscal inválida — recarregue a tela.');
  }
  if (typeof o.status !== 'string' || !(STATUS_TABELA_FISCAL as readonly string[]).includes(o.status)) {
    throw new ErroValidacao('Status inválido: use PROVISORIO ou VALIDADO.');
  }
  return { versao: o.versao, status: o.status as StatusTabelaFiscal };
}

/** Corpo do PUT: a tabela inteira mais a `versao` lida (concorrência otimista). */
export function validarAtualizacaoTabelaFiscal(valor: unknown): { versao: number; tabela: TabelaFiscal } {
  const o = exigirObjetoComChaves(valor, ['versao', 'gerais', 'ufs', 'excecoesNcm', 'ipiNcm'], 'Tabela fiscal');
  if (typeof o.versao !== 'number' || !Number.isSafeInteger(o.versao) || o.versao < 0) {
    throw new ErroValidacao('Versão da tabela fiscal inválida — recarregue a tela.');
  }
  return { versao: o.versao, tabela: validarTabelaFiscal({ gerais: o.gerais, ufs: o.ufs, excecoesNcm: o.excecoesNcm, ipiNcm: o.ipiNcm }) };
}

// ─────────────────────────────── conversão para o cálculo ───────────────────────────────

const fracao = (pontos: number): number => pontos / 100;

export interface ParametrosDoCalculo {
  venda: ParametrosVenda;
  compra: ParametrosIcmsCompra;
  pisCofins: number;
  irCs: number;
}

export function paraParametrosDoCalculo(tabela: TabelaFiscal): ParametrosDoCalculo {
  const g = tabela.gerais;
  const icmsInterestadualVendaPorUf: Partial<Record<Uf, number>> = {};
  const aliquotaInternaPorUf: Partial<Record<Uf, number | null>> = {};
  for (const linha of tabela.ufs) {
    icmsInterestadualVendaPorUf[linha.uf] = fracao(linha.icmsInterestadualVenda);
    aliquotaInternaPorUf[linha.uf] = linha.aliquotaInterna === null ? null : fracao(linha.aliquotaInterna);
  }
  return {
    venda: {
      pisCofins: fracao(g.pisCofins),
      icmsInternoMgVenda: fracao(g.icmsInternoMgVenda),
      ganhoIcmsNaBasePisCofins: g.ganhoIcmsNaBasePisCofins,
      percentualRecolhimentoIcms: fracao(g.percentualRecolhimentoIcms),
      percentualRecolhimentoIcmsConsumidorFinal: fracao(g.percentualRecolhimentoIcmsConsumidorFinal),
      icmsInterestadualVendaPorUf,
      icmsImportadoVenda: fracao(g.icmsImportadoVenda),
      aliquotaInternaPorUf,
    },
    compra: {
      icmsInternoMgCompra: fracao(g.icmsInternoMgCompra),
      icmsInterestadualCompra: fracao(g.icmsInterestadualCompra),
      icmsImportadoCompra: fracao(g.icmsImportadoCompra),
    },
    pisCofins: fracao(g.pisCofins),
    irCs: fracao(g.irCs),
  };
}

/** Tarja azul de todo cálculo enquanto a tabela fiscal estiver "Provisório". */
export const AVISO_PARAMETROS_PROVISORIOS: Aviso = {
  nivel: 'AZUL',
  codigo: 'PARAMETROS_FISCAIS_PROVISORIOS',
  item: null,
  mensagem: 'Parâmetros fiscais ainda não validados pelo fiscal.',
};

/** Avisos que vêm da própria tabela fiscal (entram em todo cálculo). */
export function avisosDaTabelaFiscal(tabela: Pick<TabelaFiscalComMetadados, 'status'>): Aviso[] {
  return tabela.status === 'VALIDADO' ? [] : [AVISO_PARAMETROS_PROVISORIOS];
}

/** Exceção de ICMS interno de MG para o NCM (fração), ou `null` se o NCM não tiver exceção (vale a geral). */
export function excecaoIcmsMgDoNcm(tabela: TabelaFiscal, ncm: string | null): number | null {
  if (ncm === null) return null;
  const normalizado = ncm.replace(/\D/g, '');
  const excecao = tabela.excecoesNcm.find((e) => e.ncm === normalizado);
  return excecao === undefined ? null : fracao(excecao.aliquota);
}

/**
 * Alíquota de IPI (fração) do NCM na tabela NCM → IPI, ou `null` se o NCM está vazio ou fora da
 * tabela (compra: sem crédito, tarja amarela; venda: tarja vermelha). Aceita o NCM com pontos.
 */
export function aliquotaIpiDoNcm(tabela: Pick<TabelaFiscal, 'ipiNcm'>, ncm: string | null): number | null {
  if (ncm === null) return null;
  const normalizado = ncm.replace(/\D/g, '');
  if (normalizado.length !== 8) return null;
  const linha = tabela.ipiNcm.find((e) => e.ncm === normalizado);
  return linha === undefined ? null : fracao(linha.aliquota);
}
