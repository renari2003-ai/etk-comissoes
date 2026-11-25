/**
 * DIAGNÓSTICO TEMPORÁRIO (2026-11-24) — REMOVER ANTES DE IR PARA PRODUÇÃO, junto com
 * `rotas/precificacaoDiagnostico.ts`.
 *
 * Objetivo: descobrir de quais campos da API Omie saem o custo unitário de cada componente e o
 * "Valor GGF" do relatório "Imprimir Estrutura → Do custo total do produto e itens da estrutura",
 * comparando com valores conhecidos do PA00000001. A estrutura (`ConsultarEstrutura`) não traz
 * custo por item (confirmado na documentação), então para cada componente são devolvidos os campos
 * numéricos do registro de estoque (`ListarPosEstoque`, onde vive o `nCMC`) e do cadastro
 * (`ConsultarProduto`), e é dito quais deles batem com o valor do relatório.
 *
 * Desde 2026-11-24 (tarde) também abre os SUBNÍVEIS: itens "produto em processo"/"produto acabado"
 * (tipo 03/04) têm estrutura própria na Omie (ex.: os kits do PA00000001), e é nela que estão MP/MO.
 * O resultado traz ainda um `resumo` em linguagem simples (tabela + conclusão), gerado por regras
 * fixas aqui no servidor (`resumirDiagnostico`) — a tela só apresenta.
 *
 * SOMENTE LEITURA: só chamadas de consulta à Omie, sempre pelo `chamar` do `ClienteOmie` (limitador
 * compartilhado com a produção). No banco só grava o que o `ClienteOmie` já grava: o cache existente
 * (`omie_cache`: produto e posição de estoque) e o controle do limitador. Nenhuma tabela nova.
 */

import { CAMPOS_CUSTO_CANDIDATOS } from '../calculo/custo.js';
import type { EstoqueOmie } from '../calculo/tipos.js';
import type { ProdutoOmie } from '../omie/cliente.js';
import { OmieError } from '../omie/erros.js';
import { ErroValidacao } from '../validacao.js';
import { abrirEstrutura, somarFolhas, type NoEstrutura } from './estrutura.js';

export interface ClienteOmieDiagnosticoCusto {
  consultarEstrutura(codProduto: string): Promise<Record<string, unknown>>;
  consultarDadosProducao(idProduto: number): Promise<Record<string, unknown>>;
  consultarProduto(codigoProduto: number): Promise<ProdutoOmie>;
  obterEstoqueProduto(codigoProduto: number, dataReferencia: string): Promise<EstoqueOmie>;
  /** `estoque/resumo` → `ObterEstoqueProduto` (nCMC por local e preço da última compra). Opcional. */
  obterResumoEstoqueProduto?(idProduto: number, dia: string): Promise<Record<string, unknown>>;
}

/** Valor esperado escrito como no relatório (vírgula decimal); `null` = relatório não mostra custo unitário. */
interface ReferenciaRelatorio {
  ggf: string;
  componentes: Record<string, string | null>;
  /**
   * Itens que hoje não têm custo médio, mas que no relatório antigo tinham valor TOTAL da linha (sem
   * unitário). O unitário implícito (total ÷ quantidade) é comparado com todos os campos numéricos
   * do Omie para descobrir de onde o relatório tirou esse custo (investigação de 2026-11-25).
   */
  totaisSemUnitario?: Record<string, { total: string; quantidade: string }>;
}

/** Valores lidos do relatório da Omie pelo usuário (2026-11-24). */
export const REFERENCIAS_RELATORIO: Record<string, ReferenciaRelatorio> = {
  PA00000001: {
    ggf: '59,76',
    componentes: {
      PI10000014: '0,192111',
      MP00000008: '17,06279',
      MO00000013: '5,238053',
      MO00000037: null,
      MP00000045: null,
    },
    totaisSemUnitario: {
      MO00000037: { total: '2,46', quantidade: '1' },
      MO00000067: { total: '1,28', quantidade: '8' },
      MP00000045: { total: '0,6908', quantidade: '0,044' },
      MP00000042: { total: '0,41241', quantidade: '0,059' },
      MO00000038: { total: '0,2353664', quantidade: '0,04597' },
    },
  },
};

/** O relatório chama de "Valor GGF"; a hipótese de 2026-11-25 é que seja o custo total do produto. */
const ROTULO_VALOR_GGF = 'Valor "GGF" do relatório';

const CODIGO_VALIDO = /^[A-Za-z0-9._-]{1,60}$/;

/**
 * Teto de componentes consultados por diagnóstico, somando todos os níveis (cada um custa 1 chamada
 * `ConsultarProduto`, com cache). O PA00000001 tem 69 itens em 4 níveis.
 */
export const MAX_COMPONENTES_DIAGNOSTICO = 150;

/** Profundidade máxima da abertura de subníveis (1 = só os itens diretos do produto). */
export const MAX_NIVEIS_DIAGNOSTICO = 6;

/** Tipos de item da Omie que têm estrutura própria e são abertos: 03 = produto em processo, 04 = produto acabado. */
const TIPOS_COM_ESTRUTURA = new Set(['03', '04']);

function referenciaDoRelatorio(codigo: string): ReferenciaRelatorio | undefined {
  const chave = codigo.toUpperCase();
  return Object.hasOwn(REFERENCIAS_RELATORIO, chave) ? REFERENCIAS_RELATORIO[chave] : undefined;
}

export function validarCodigoProduto(valor: unknown): string {
  if (typeof valor !== 'string' || !CODIGO_VALIDO.test(valor)) {
    throw new ErroValidacao('Código de produto inválido (use só letras, números, ponto, hífen ou sublinhado; até 60 caracteres).');
  }
  return valor;
}

export interface CampoQueConfere {
  origem: string;
  campo: string;
  valor: number;
}

export interface ConferenciaValor {
  rotulo: string;
  esperado: string | null;
  confere: CampoQueConfere[];
  observacao?: string;
}

export interface ComponenteDiagnostico {
  /** 1 = item direto do produto; 2 = item de um kit/subestrutura; … */
  nivel: number;
  /** Código do produto/subestrutura de onde o item veio. */
  pai: string;
  tipo: string | null;
  codProdMalha: string | null;
  idProdMalha: number | null;
  descricao: string | null;
  quantidade: unknown;
  unidade: unknown;
  percPerda: unknown;
  camposNumericosEstoque: Record<string, number> | null;
  camposNumericosProduto: Record<string, number> | null;
  /**
   * Só para itens SEM custo médio: todos os números do cadastro, inclusive os de objetos aninhados
   * (caminho "a.b[0].c"), e os dados de produção do próprio item — é entre eles que se procura de
   * onde o relatório tirou o custo.
   */
  camposNumericosProdutoCompletos?: Record<string, number> | null;
  camposNumericosDadosProducaoItem?: Record<string, number> | null;
  /** `ObterEstoqueProduto` do item (todos os locais): nCMC por local, nPrecoUltComp etc. */
  camposNumericosResumoEstoqueItem?: Record<string, number> | null;
  erros: string[];
}

/** Um campo do Omie candidato a ser a fonte do custo de um item sem custo médio. */
export interface CampoCandidato extends CampoQueConfere {
  /** Diferença para o unitário implícito, em % (positiva = campo maior). */
  diferencaPercentual: number;
}

/** Busca da origem do custo de um item que no relatório tinha valor, mas hoje não tem custo médio. */
export interface BuscaOrigemCusto {
  codigo: string;
  totalRelatorio: string;
  quantidadeRelatorio: string;
  /** total ÷ quantidade (e, se o item tem perda, também total ÷ (quantidade × (1 + perda))). */
  unitariosImplicitos: number[];
  encontradoNaEstrutura: boolean;
  /** Campos que batem com algum unitário implícito (tolerância: arredondamento do relatório ou 0,5%). */
  confere: CampoCandidato[];
  /** Os 3 campos positivos mais próximos (para quando nada bate exatamente). */
  maisProximos: CampoCandidato[];
}

/** GGF por unidade de cada estrutura aberta (o produto e seus subníveis). */
export interface SubestruturaDiagnostico {
  codigo: string;
  nivel: number;
  /** Quantas unidades desta estrutura entram em 1 unidade do produto (já com o % de perda). */
  quantidadeNoProduto: number;
  custoProducao: Record<string, number> | null;
  dadosProducao: Record<string, number> | null;
  /**
   * A estrutura (itens) foi lida? Falha só nos dados de produção NÃO impede abrir o kit — só a
   * falha da própria estrutura faz o kit entrar com o custo médio dele.
   */
  estruturaLida: boolean;
  erro?: string;
}

export interface ResultadoDiagnosticoCusto {
  aviso: string;
  codigo: string;
  dataReferenciaEstoque: string;
  estrutura: Record<string, unknown>;
  dadosProducao: Record<string, unknown> | { erro: string };
  produtoAcabado: { camposNumericosEstoque: Record<string, number> | null; erros: string[] };
  componentes: ComponenteDiagnostico[];
  /** Preenchido quando a estrutura tem mais itens que `MAX_COMPONENTES_DIAGNOSTICO`. */
  componentesNaoConsultados: number;
  subestruturas: SubestruturaDiagnostico[];
  /** Teste da hipótese de 2026-11-25: o "Valor GGF" do relatório é o custo total do produto. */
  custoTotal: CustoTotalDiagnostico;
  conferencia: ConferenciaValor[] | null;
  /** Investigação de 2026-11-25: de onde o relatório tirou o custo dos itens sem custo médio. */
  origemCustoSemCustoMedio: BuscaOrigemCusto[];
  resumo: ResumoDiagnostico;
}

/**
 * Custo total do produto pela regra de 2026-11-25 (`precificacao/estrutura.ts`): abre todos os kits
 * até as folhas e soma quantidade × (1 + perda) × custo de cada folha; kit sem estrutura entra com
 * o próprio custo. Nunca soma o kit e os itens de dentro dele ao mesmo tempo.
 */
export interface CustoTotalDiagnostico {
  /** Com o custo médio ATUAL do estoque (nCMC) de cada folha. `null` se a soma falhou (ver `erro`). */
  comCustoMedioAtual: number | null;
  /** Igual, mas com o valor do relatório nas folhas que têm valor de referência. `null` sem referência. */
  comValoresDoRelatorio: number | null;
  /** Quantas folhas usaram o valor do relatório no lugar do custo médio atual. */
  folhasComValorDoRelatorio: number;
  folhas: number;
  /** Folhas sem custo (entraram com zero). */
  itensSemCusto: string[];
  /** Kits sem estrutura (ou cuja estrutura não foi lida) que entraram com o próprio custo médio. */
  kitsComCustoProprio: string[];
  /** Motivos pelos quais a soma pode estar incompleta. */
  ressalvas: string[];
  erro?: string;
}

function paraNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Id da Omie: inteiro positivo (nunca 0, negativo, fração ou "0x10"). */
function paraId(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
  if (typeof valor === 'string' && /^\d{1,15}$/.test(valor.trim())) {
    const n = Number(valor.trim());
    return n > 0 ? n : null;
  }
  return null;
}

function textoOuNull(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null;
}

/** Só os campos numéricos de primeiro nível (número ou texto numérico) — é entre eles que se procura o custo. */
export function camposNumericos(registro: Record<string, unknown> | undefined | null): Record<string, number> | null {
  if (registro === undefined || registro === null) return null;
  const saida: Record<string, number> = {};
  for (const [chave, valor] of Object.entries(registro)) {
    const n = paraNumero(valor);
    if (n !== null) saida[chave] = n;
  }
  return saida;
}

/**
 * Todos os números de um registro, inclusive dentro de objetos e listas aninhados, com o caminho
 * ("dadosIbpt.aliqFederal", "imagens[0].x"). Limites de profundidade e de itens por lista, para a
 * resposta não crescer sem controle.
 */
export function camposNumericosAninhados(registro: unknown, prefixo = '', profundidade = 0): Record<string, number> {
  const saida: Record<string, number> = {};
  if (registro === null || typeof registro !== 'object' || profundidade > 4) return saida;
  const entradas: [string, unknown][] = Array.isArray(registro)
    ? registro.slice(0, 20).map((v, i): [string, unknown] => [`[${i}]`, v])
    : Object.entries(registro as Record<string, unknown>).map(([k, v]): [string, unknown] => [prefixo === '' ? k : `.${k}`, v]);
  for (const [sufixo, valor] of entradas) {
    const caminho = `${prefixo}${sufixo}`;
    const n = paraNumero(valor);
    if (n !== null) saida[caminho] = n;
    else if (valor !== null && typeof valor === 'object') Object.assign(saida, camposNumericosAninhados(valor, caminho, profundidade + 1));
  }
  return saida;
}

/** "17,06279" → { valor: 17.06279, tolerancia: 0,000005 } (meia unidade da última casa mostrada no relatório). */
export function interpretarValorRelatorio(texto: string): { valor: number; tolerancia: number } {
  const normalizado = texto.trim().replace(/\./g, '').replace(',', '.');
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) throw new Error(`Valor de referência inválido: ${texto}`);
  const casas = normalizado.includes('.') ? normalizado.split('.')[1]!.length : 0;
  return { valor, tolerancia: 0.5 * 10 ** -casas + 1e-12 };
}

function camposQueConferem(esperado: string, fontes: { origem: string; campos: Record<string, number> | null }[]): CampoQueConfere[] {
  const { valor, tolerancia } = interpretarValorRelatorio(esperado);
  const saida: CampoQueConfere[] = [];
  for (const fonte of fontes) {
    for (const [campo, v] of Object.entries(fonte.campos ?? {})) {
      if (Math.abs(v - valor) <= tolerancia) saida.push({ origem: fonte.origem, campo, valor: v });
    }
  }
  return saida;
}

/** Só repassa a mensagem de erros da Omie (faultstring); qualquer outro erro (banco, programação) vira genérico e vai para o log. */
function mensagemDeErro(erro: unknown, contexto: string): string {
  if (erro instanceof OmieError) return erro.message;
  console.error(`[diagnostico-custo] erro interno em ${contexto}:`, erro instanceof Error ? erro.message : erro);
  return 'Erro interno (detalhe no log do servidor).';
}

export async function diagnosticarCusto(
  cliente: ClienteOmieDiagnosticoCusto,
  codigo: string,
  dataReferenciaEstoque: string,
): Promise<ResultadoDiagnosticoCusto> {
  const estrutura = await cliente.consultarEstrutura(codigo);
  const ident = (estrutura.ident ?? {}) as Record<string, unknown>;
  const idProduto = paraId(ident.idProduto);

  let dadosProducao: Record<string, unknown> | { erro: string };
  if (idProduto === null) {
    dadosProducao = { erro: 'ConsultarEstrutura não devolveu ident.idProduto — ConsultarDadosProducao não foi chamado.' };
  } else {
    try {
      dadosProducao = await cliente.consultarDadosProducao(idProduto);
    } catch (erro) {
      dadosProducao = { erro: mensagemDeErro(erro, 'ConsultarDadosProducao') };
    }
  }

  const produtoAcabado: ResultadoDiagnosticoCusto['produtoAcabado'] = { camposNumericosEstoque: null, erros: [] };
  if (idProduto !== null) {
    try {
      const estoque = await cliente.obterEstoqueProduto(idProduto, dataReferenciaEstoque);
      produtoAcabado.camposNumericosEstoque = camposNumericos(estoque.listaEstoque?.[0] as Record<string, unknown> | undefined);
      if (produtoAcabado.camposNumericosEstoque === null) produtoAcabado.erros.push('Produto acabado não aparece na posição de estoque.');
    } catch (erro) {
      produtoAcabado.erros.push(`estoque: ${mensagemDeErro(erro, 'estoque do produto acabado')}`);
    }
  }

  const subestruturas: SubestruturaDiagnostico[] = [
    {
      codigo,
      nivel: 0,
      quantidadeNoProduto: 1,
      estruturaLida: true,
      custoProducao: camposNumericos(estrutura.custoProducao as Record<string, unknown> | undefined),
      dadosProducao: 'erro' in dadosProducao ? null : camposNumericos(dadosProducao),
    },
  ];
  const componentes: ComponenteDiagnostico[] = [];
  let componentesNaoConsultados = 0;
  const jaAbertos = new Set<string>([codigo.toUpperCase()]);

  // Fila em largura: (itens da estrutura, nível, de quem são, quantas unidades do pai entram no produto).
  const fila: { itens: Record<string, unknown>[]; nivel: number; pai: string; qtdPai: number }[] = [
    { itens: Array.isArray(estrutura.itens) ? (estrutura.itens as Record<string, unknown>[]) : [], nivel: 1, pai: codigo, qtdPai: 1 },
  ];
  while (fila.length > 0) {
    const { itens, nivel, pai, qtdPai } = fila.shift()!;
    for (const item of itens) {
      if (componentes.length >= MAX_COMPONENTES_DIAGNOSTICO) {
        componentesNaoConsultados++;
        continue;
      }
      const idProdMalha = paraId(item.idProdMalha);
      const componente: ComponenteDiagnostico = {
        nivel,
        pai,
        tipo: textoOuNull(item.tipoProdMalha),
        codProdMalha: textoOuNull(item.codProdMalha),
        idProdMalha,
        descricao: textoOuNull(item.descrProdMalha),
        quantidade: item.quantProdMalha,
        unidade: item.unidProdMalha,
        percPerda: item.percPerdaProdMalha,
        camposNumericosEstoque: null,
        camposNumericosProduto: null,
        erros: [],
      };
      componentes.push(componente);
      if (idProdMalha === null) {
        componente.erros.push('Item sem idProdMalha — custo não consultado.');
        continue;
      }
      try {
        const estoque = await cliente.obterEstoqueProduto(idProdMalha, dataReferenciaEstoque);
        componente.camposNumericosEstoque = camposNumericos(estoque.listaEstoque?.[0] as Record<string, unknown> | undefined);
        if (componente.camposNumericosEstoque === null) componente.erros.push('Componente não aparece na posição de estoque.');
      } catch (erro) {
        componente.erros.push(`estoque: ${mensagemDeErro(erro, 'estoque do componente')}`);
      }
      const semCustoMedio = custoDoSistema(componente) === null;
      try {
        const produto = await cliente.consultarProduto(idProdMalha);
        componente.camposNumericosProduto = camposNumericos(produto as unknown as Record<string, unknown>);
        if (semCustoMedio) componente.camposNumericosProdutoCompletos = camposNumericosAninhados(produto);
      } catch (erro) {
        componente.erros.push(`produto: ${mensagemDeErro(erro, 'ConsultarProduto')}`);
      }
      // Item sem custo médio que o relatório antigo mostrava com valor: olha também os dados de produção dele.
      const codItem = componente.codProdMalha?.toUpperCase();
      if (semCustoMedio && codItem !== undefined && Object.hasOwn(totaisSemUnitario(codigo), codItem)) {
        try {
          componente.camposNumericosDadosProducaoItem = camposNumericos(await cliente.consultarDadosProducao(idProdMalha));
        } catch (erro) {
          componente.camposNumericosDadosProducaoItem = null;
          componente.erros.push(`dados de produção do item: ${mensagemDeErro(erro, 'ConsultarDadosProducao (item)')}`);
        }
        if (cliente.obterResumoEstoqueProduto !== undefined) {
          try {
            componente.camposNumericosResumoEstoqueItem = camposNumericosAninhados(await cliente.obterResumoEstoqueProduto(idProdMalha, dataReferenciaEstoque));
          } catch (erro) {
            componente.camposNumericosResumoEstoqueItem = null;
            componente.erros.push(`resumo do estoque do item: ${mensagemDeErro(erro, 'ObterEstoqueProduto (item)')}`);
          }
        }
      }

      // Subnível: só itens que têm estrutura própria, dentro do limite de níveis, e nunca o mesmo código duas vezes (evita ciclo).
      const cod = componente.codProdMalha;
      if (cod === null || componente.tipo === null || !TIPOS_COM_ESTRUTURA.has(componente.tipo)) continue;
      if (nivel >= MAX_NIVEIS_DIAGNOSTICO || jaAbertos.has(cod.toUpperCase())) continue;
      jaAbertos.add(cod.toUpperCase());
      const qtdNoProduto = qtdPai * quantidadeComPerda(componente);
      const sub: SubestruturaDiagnostico = { codigo: cod, nivel, quantidadeNoProduto: qtdNoProduto, custoProducao: null, dadosProducao: null, estruturaLida: false };
      subestruturas.push(sub);
      try {
        const estruturaSub = await cliente.consultarEstrutura(cod);
        sub.estruturaLida = true;
        sub.custoProducao = camposNumericos(estruturaSub.custoProducao as Record<string, unknown> | undefined);
        if (!((sub.custoProducao?.vGGF ?? 0) > 0)) {
          try {
            sub.dadosProducao = camposNumericos(await cliente.consultarDadosProducao(idProdMalha));
          } catch (erro) {
            sub.erro = `dados de produção: ${mensagemDeErro(erro, 'ConsultarDadosProducao (subnível)')}`;
          }
        }
        const itensSub = Array.isArray(estruturaSub.itens) ? (estruturaSub.itens as Record<string, unknown>[]) : [];
        fila.push({ itens: itensSub, nivel: nivel + 1, pai: cod, qtdPai: qtdNoProduto });
      } catch (erro) {
        sub.erro = `estrutura: ${mensagemDeErro(erro, 'ConsultarEstrutura (subnível)')}`;
      }
    }
  }

  const custoTotal = calcularCustoTotalDiagnostico(codigo, componentes, subestruturas, componentesNaoConsultados);
  const conferencia = conferir(codigo, subestruturas, componentes, custoTotal);
  const origemCustoSemCustoMedio = buscarOrigemCustoSemCustoMedio(codigo, componentes);
  return {
    aviso: 'Rota TEMPORÁRIA de diagnóstico (somente leitura) — remover antes de produção.',
    codigo,
    dataReferenciaEstoque,
    estrutura,
    dadosProducao,
    produtoAcabado,
    componentes,
    componentesNaoConsultados,
    subestruturas,
    custoTotal,
    conferencia,
    origemCustoSemCustoMedio,
    resumo: resumirDiagnostico(codigo, componentes, componentesNaoConsultados, conferencia, custoTotal, origemCustoSemCustoMedio),
  };
}

function totaisSemUnitario(codigo: string): Record<string, { total: string; quantidade: string }> {
  return referenciaDoRelatorio(codigo)?.totaisSemUnitario ?? {};
}

/** Tolerância relativa mínima ao procurar o campo de origem (o relatório arredonda o total). */
const TOLERANCIA_RELATIVA_ORIGEM = 0.005;

/** Códigos e ids (nCodProd, codigo_produto, idProduto, nIdProduto, codigo_local_estoque…) nunca são custo. */
const CAMPO_IDENTIFICADOR = /^(n?cod|codigo|n?id[A-Z_]|id$)|_id$|Id$/i;

/**
 * Para cada item com valor total no relatório antigo e sem custo médio hoje: calcula o unitário
 * implícito e procura, entre todos os números que o Omie devolve para o item (posição de estoque,
 * cadastro completo e dados de produção), os que batem e os mais próximos.
 */
export function buscarOrigemCustoSemCustoMedio(codigo: string, componentes: ComponenteDiagnostico[]): BuscaOrigemCusto[] {
  const saida: BuscaOrigemCusto[] = [];
  for (const [cod, ref] of Object.entries(totaisSemUnitario(codigo))) {
    const total = interpretarValorRelatorio(ref.total);
    const qtd = interpretarValorRelatorio(ref.quantidade).valor;
    const componente = componentes.find((c) => c.codProdMalha?.toUpperCase() === cod.toUpperCase());
    const busca: BuscaOrigemCusto = {
      codigo: cod,
      totalRelatorio: ref.total,
      quantidadeRelatorio: ref.quantidade,
      unitariosImplicitos: [],
      encontradoNaEstrutura: componente !== undefined,
      confere: [],
      maisProximos: [],
    };
    saida.push(busca);
    if (!(qtd > 0) || !(total.valor > 0)) continue;
    busca.unitariosImplicitos.push(total.valor / qtd);
    const perda = componente === undefined ? 0 : (paraNumero(componente.percPerda) ?? 0);
    if (perda > 0) busca.unitariosImplicitos.push(total.valor / (qtd * (1 + perda / 100)));
    if (componente === undefined) continue;

    const fontes: { origem: string; campos: Record<string, number> | null | undefined }[] = [
      { origem: 'ListarPosEstoque', campos: componente.camposNumericosEstoque },
      { origem: 'ConsultarProduto', campos: componente.camposNumericosProdutoCompletos ?? componente.camposNumericosProduto },
      { origem: 'ConsultarDadosProducao (do item)', campos: componente.camposNumericosDadosProducaoItem },
      { origem: 'ObterEstoqueProduto', campos: componente.camposNumericosResumoEstoqueItem },
    ];
    const candidatos: CampoCandidato[] = [];
    for (const fonte of fontes) {
      for (const [campo, valor] of Object.entries(fonte.campos ?? {})) {
        if (!(valor > 0) || CAMPO_IDENTIFICADOR.test(campo.split(/[.[\]]/).filter(Boolean).at(-1) ?? '')) continue;
        // Diferença para o unitário implícito mais próximo.
        let melhor = Infinity;
        for (const u of busca.unitariosImplicitos) {
          const d = ((valor - u) / u) * 100;
          if (Math.abs(d) < Math.abs(melhor)) melhor = d;
        }
        candidatos.push({ origem: fonte.origem, campo, valor, diferencaPercentual: melhor });
      }
    }
    // Tolerância: o arredondamento do total no relatório ou 0,5%, o que for maior.
    const toleranciaPercentual = Math.max(TOLERANCIA_RELATIVA_ORIGEM * 100, (total.tolerancia / total.valor) * 100);
    candidatos.sort((a, b) => Math.abs(a.diferencaPercentual) - Math.abs(b.diferencaPercentual));
    busca.confere = candidatos.filter((c) => Math.abs(c.diferencaPercentual) <= toleranciaPercentual);
    busca.maisProximos = candidatos.slice(0, 3);
  }
  return saida;
}

/** Quantidade do item com o % de perda da estrutura: quantidade × (1 + perda/100). Valor ilegível conta como 1 / 0%. */
function quantidadeComPerda(c: Pick<ComponenteDiagnostico, 'quantidade' | 'percPerda'>): number {
  const q = paraNumero(c.quantidade);
  const p = paraNumero(c.percPerda);
  return (q !== null && q >= 0 ? q : 1) * (1 + (p !== null && p > 0 ? p / 100 : 0));
}

/** GGF por unidade de uma estrutura: `custoProducao.vGGF` ou, se zerado, `ConsultarDadosProducao.nValorGGF`. */
function ggfUnitario(s: SubestruturaDiagnostico): { valor: number; fonte: 'estrutura' | 'dadosProducao' } | null {
  const v = s.custoProducao?.vGGF ?? 0;
  if (v > 0) return { valor: v, fonte: 'estrutura' };
  const n = s.dadosProducao?.nValorGGF ?? 0;
  if (n > 0) return { valor: n, fonte: 'dadosProducao' };
  return null;
}

/** Candidatos a "Valor GGF", do mais simples (só o produto) ao acumulado com os subníveis. */
function candidatosGgf(subestruturas: SubestruturaDiagnostico[]): { origem: string; campo: string; valor: number }[] {
  const raiz = subestruturas[0]!;
  const saida: { origem: string; campo: string; valor: number }[] = [
    { origem: 'ConsultarEstrutura.custoProducao', campo: 'vGGF', valor: raiz.custoProducao?.vGGF ?? 0 },
    { origem: 'ConsultarDadosProducao', campo: 'nValorGGF', valor: raiz.dadosProducao?.nValorGGF ?? 0 },
  ];
  if (subestruturas.length > 1) {
    let total = 0;
    for (const s of subestruturas) total += (ggfUnitario(s)?.valor ?? 0) * s.quantidadeNoProduto;
    saida.push({ origem: 'Subestruturas', campo: 'GGF somado de todos os níveis', valor: total });
  }
  return saida;
}

/** Monta a árvore a partir da lista plana (`pai` de cada item) e soma as folhas pela regra da precificação. */
export function calcularCustoTotalDiagnostico(
  codigo: string,
  componentes: ComponenteDiagnostico[],
  subestruturas: SubestruturaDiagnostico[],
  componentesNaoConsultados: number,
): CustoTotalDiagnostico {
  const referencia = referenciaDoRelatorio(codigo);
  const filhosPorPai = new Map<string, ComponenteDiagnostico[]>();
  for (const c of componentes) {
    const chave = c.pai.toUpperCase();
    filhosPorPai.set(chave, [...(filhosPorPai.get(chave) ?? []), c]);
  }
  const abertas = new Map(subestruturas.slice(1).map((s) => [s.codigo.toUpperCase(), s]));
  const kitsComCustoProprio = new Set<string>();
  const ressalvas: string[] = [];
  if (componentesNaoConsultados > 0) ressalvas.push(`${componentesNaoConsultados} item(ns) da estrutura ficaram de fora do diagnóstico.`);

  const ehKit = (c: ComponenteDiagnostico): boolean => c.tipo !== null && TIPOS_COM_ESTRUTURA.has(c.tipo);
  const valorDoRelatorio = (cod: string): number | null => {
    if (referencia === undefined || !Object.hasOwn(referencia.componentes, cod)) return null;
    const ref = referencia.componentes[cod];
    return typeof ref === 'string' ? interpretarValorRelatorio(ref).valor : null;
  };
  const montar = (c: ComponenteDiagnostico, ancestrais: ReadonlySet<string>, usarRelatorio: boolean): NoEstrutura => {
    const cod = c.codProdMalha ?? '(sem código)';
    const chave = cod.toUpperCase();
    // Nunca adivinhar: quantidade ausente/ilegível ou perda ilegível derrubam a soma com o motivo.
    // Perda AUSENTE (o Omie não manda o campo) é 0%.
    const q = paraNumero(c.quantidade);
    if (q === null || q < 0) throw new ErroValidacao(`Quantidade do item ${cod} ausente ou ilegível na estrutura do Omie (${String(c.quantidade)}).`);
    const p = c.percPerda === undefined || c.percPerda === null ? 0 : paraNumero(c.percPerda);
    if (p === null || p < 0) throw new ErroValidacao(`% de perda do item ${cod} ilegível na estrutura do Omie (${String(c.percPerda)}).`);
    if (ancestrais.has(chave)) {
      throw new ErroValidacao(`Estrutura em ciclo: o item ${cod} aparece dentro dele mesmo. Corrija a estrutura no Omie.`);
    }
    const doRelatorio = usarRelatorio ? valorDoRelatorio(cod) : null;
    const no: NoEstrutura = {
      codigo: cod,
      descricao: c.descricao,
      quantidade: q,
      perda: p / 100,
      custoUnitario: doRelatorio ?? custoDoSistema(c)?.valor ?? null,
    };
    if (!ehKit(c)) return no;
    const sub = abertas.get(chave);
    const filhos = filhosPorPai.get(chave) ?? [];
    if (sub === undefined || !sub.estruturaLida || filhos.length === 0) {
      // Kit sem estrutura (ou não lida): entra com o custo médio do PRÓPRIO kit, como folha.
      kitsComCustoProprio.add(cod);
      if (c.codProdMalha === null) ressalvas.push('Um kit da estrutura veio sem código; entrou com o custo médio do próprio kit.');
      else if (sub !== undefined && !sub.estruturaLida) ressalvas.push(`A estrutura do kit ${cod} não pôde ser lida (${sub.erro ?? 'erro desconhecido'}); entrou com o custo médio do próprio kit.`);
      else if (sub === undefined) ressalvas.push(`O kit ${cod} não foi aberto (limite de níveis); entrou com o custo médio do próprio kit.`);
      return no;
    }
    const proximos = new Set(ancestrais).add(chave);
    return { ...no, filhos: filhos.map((f) => montar(f, proximos, usarRelatorio)) };
  };

  const raiz = new Set([codigo.toUpperCase()]);
  const diretos = filhosPorPai.get(codigo.toUpperCase()) ?? [];
  try {
    const atual = somarFolhas(abrirEstrutura(diretos.map((c) => montar(c, raiz, false)), { codigoRaiz: codigo }));
    let comValoresDoRelatorio: number | null = null;
    let folhasComValorDoRelatorio = 0;
    if (referencia !== undefined) {
      const folhasRel = abrirEstrutura(diretos.map((c) => montar(c, raiz, true)), { codigoRaiz: codigo });
      comValoresDoRelatorio = somarFolhas(folhasRel).total;
      folhasComValorDoRelatorio = folhasRel.filter((f) => valorDoRelatorio(f.codigo) !== null).length;
    }
    return {
      comCustoMedioAtual: atual.total,
      comValoresDoRelatorio,
      folhasComValorDoRelatorio,
      folhas: atual.folhas.length,
      itensSemCusto: atual.semCusto,
      kitsComCustoProprio: [...kitsComCustoProprio],
      ressalvas: [...new Set(ressalvas)],
    };
  } catch (erro) {
    return {
      comCustoMedioAtual: null,
      comValoresDoRelatorio: null,
      folhasComValorDoRelatorio: 0,
      folhas: 0,
      itensSemCusto: [],
      kitsComCustoProprio: [...kitsComCustoProprio],
      ressalvas: [...new Set(ressalvas)],
      erro: erro instanceof ErroValidacao ? erro.message : 'Erro interno ao somar a estrutura.',
    };
  }
}

function conferir(
  codigo: string,
  subestruturas: SubestruturaDiagnostico[],
  componentes: ComponenteDiagnostico[],
  custoTotal: CustoTotalDiagnostico,
): ConferenciaValor[] | null {
  const referencia = referenciaDoRelatorio(codigo);
  if (referencia === undefined) return null;

  const raiz = subestruturas[0]!;
  const { valor: ggfRelatorio, tolerancia } = interpretarValorRelatorio(referencia.ggf);
  const somas = [
    { origem: 'Custo total', campo: 'folhas × custo médio atual', valor: custoTotal.comCustoMedioAtual },
    { origem: 'Custo total', campo: 'folhas × valores do relatório', valor: custoTotal.folhasComValorDoRelatorio > 0 ? custoTotal.comValoresDoRelatorio : null },
  ];
  const ggfQueConfere: CampoQueConfere[] = [
    ...camposQueConferem(referencia.ggf, [
      { origem: 'ConsultarEstrutura.custoProducao', campos: raiz.custoProducao },
      { origem: 'ConsultarDadosProducao', campos: raiz.dadosProducao },
    ]),
    ...candidatosGgf(subestruturas)
      .slice(2)
      .filter((c) => Math.abs(c.valor - ggfRelatorio) <= tolerancia),
    ...somas.flatMap((c) => (c.valor !== null && Math.abs(c.valor - ggfRelatorio) <= tolerancia ? [{ origem: c.origem, campo: c.campo, valor: c.valor }] : [])),
  ];
  const conferencia: ConferenciaValor[] = [{ rotulo: ROTULO_VALOR_GGF, esperado: referencia.ggf, confere: ggfQueConfere }];

  for (const [cod, esperado] of Object.entries(referencia.componentes)) {
    const componente = componentes.find((c) => c.codProdMalha === cod);
    if (componente === undefined) {
      conferencia.push({ rotulo: cod, esperado, confere: [], observacao: 'Componente não encontrado na estrutura devolvida pela API.' });
      continue;
    }
    if (esperado === null) {
      const custos = [
        ...Object.entries(componente.camposNumericosEstoque ?? {}).map(([c, v]) => [`ListarPosEstoque.${c}`, v] as const),
        ...Object.entries(componente.camposNumericosProduto ?? {}).map(([c, v]) => [`ConsultarProduto.${c}`, v] as const),
      ].filter(([campo]) => /cmc|cust|preco/i.test(campo));
      conferencia.push({
        rotulo: cod,
        esperado: null,
        confere: [],
        observacao:
          custos.length === 0
            ? 'Relatório sem custo unitário; a API também não traz campo de custo (estoque nem cadastro).'
            : `Relatório sem custo unitário; na API: ${custos.map(([c, v]) => `${c}=${v}`).join(', ')}.`,
      });
      continue;
    }
    conferencia.push({
      rotulo: cod,
      esperado,
      confere: camposQueConferem(esperado, [
        { origem: 'ListarPosEstoque', campos: componente.camposNumericosEstoque },
        { origem: 'ConsultarProduto', campos: componente.camposNumericosProduto },
      ]),
    });
  }
  return conferencia;
}

// ─────────────────────────── resumo em linguagem simples ───────────────────────────

/** Uma linha da tabela "Item | Valor no relatório | Valor que o sistema encontrou | De onde veio | Bate?". */
export interface LinhaResumo {
  item: string;
  descricao: string | null;
  /** 0 = GGF; 1 = item direto do produto; 2+ = item de um kit/subnível. */
  nivel: number;
  /** Código do kit/subestrutura onde o item está (`null` no GGF). */
  pai: string | null;
  /** Como está no relatório do Omie; "sem custo" = relatório não mostra custo; "—" = não informado. */
  valorRelatorio: string;
  /** `null` = sem custo. */
  valorSistema: number | null;
  /** Em português: "custo médio do estoque", "GGF da estrutura do produto"… */
  origem: string;
  /** `null` = não há valor do relatório para comparar. */
  bate: boolean | null;
}

export interface ItemConclusao {
  tipo: 'ok' | 'problema' | 'info';
  texto: string;
}

export interface ResumoDiagnostico {
  linhas: LinhaResumo[];
  conclusao: ItemConclusao[];
  /** `true` só quando tudo bate e nenhum item está sem custo. */
  podeUsar: boolean;
}

const NOME_CAMPO_ESTOQUE: Record<string, string> = {
  nCMC: 'custo médio do estoque',
  nCustoMedio: 'custo médio do estoque',
  nPrecoUnitario: 'preço unitário da posição de estoque',
  nCustoUnitario: 'custo unitário da posição de estoque',
};

const NOME_ORIGEM_GGF: Record<string, string> = {
  'ConsultarEstrutura.custoProducao.vGGF': 'GGF da estrutura do produto',
  'ConsultarDadosProducao.nValorGGF': 'GGF dos dados de produção do produto',
  'Subestruturas.GGF somado de todos os níveis': 'GGF somado das estruturas dos kits/subníveis',
};

function nomeOrigem(c: CampoQueConfere): string {
  const chave = `${c.origem}.${c.campo}`;
  if (NOME_ORIGEM_GGF[chave] !== undefined) return NOME_ORIGEM_GGF[chave]!;
  if (c.origem === 'ListarPosEstoque') return NOME_CAMPO_ESTOQUE[c.campo] ?? `posição de estoque (campo ${c.campo})`;
  if (c.origem === 'ConsultarProduto') return `cadastro do produto (campo ${c.campo})`;
  return `${c.origem} (campo ${c.campo})`;
}

/** O custo que o sistema usa hoje para um item: o mesmo critério do `resolverCusto` (1º candidato positivo do estoque). */
function custoDoSistema(c: ComponenteDiagnostico): { valor: number; origem: string } | null {
  for (const campo of CAMPOS_CUSTO_CANDIDATOS) {
    const v = c.camposNumericosEstoque?.[campo];
    if (v !== undefined && v > 0) return { valor: v, origem: NOME_CAMPO_ESTOQUE[campo] ?? `posição de estoque (campo ${campo})` };
  }
  return null;
}

function numeroBr(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function listaBr(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * Regras fixas que transformam o diagnóstico em tabela + conclusão sem termos técnicos.
 * Não decide preço nenhum: só diz o que bate, o que falta e se o custo já é confiável.
 *
 * Decisões de 2026-11-25 refletidas aqui:
 * - O custo de cada item é o custo médio ATUAL do estoque; diferença para o relatório (que é
 *   antigo) é informativa, não pendência.
 * - Não há GGF separado: o "Valor GGF" do relatório é comparado com o CUSTO TOTAL do produto
 *   (folhas × custo), na hipótese de que seja isso.
 * - Item sem custo vai para o custo manual (etapa 3).
 */
export function resumirDiagnostico(
  codigo: string,
  componentes: ComponenteDiagnostico[],
  componentesNaoConsultados: number,
  conferencia: ConferenciaValor[] | null,
  custoTotal: CustoTotalDiagnostico,
  origemCustoSemCustoMedio: BuscaOrigemCusto[] = [],
): ResumoDiagnostico {
  const referencia = referenciaDoRelatorio(codigo);
  const linhas: LinhaResumo[] = [];
  const conclusao: ItemConclusao[] = [];
  const pendencias: string[] = [];

  // ── custo total (hipótese: é o "Valor GGF" do relatório) ──
  const confTotal = conferencia?.find((c) => c.rotulo === ROTULO_VALOR_GGF);
  const totalBate = confTotal !== undefined && confTotal.confere.some((c) => c.origem === 'Custo total');
  linhas.push({
    item: 'Custo total do produto (o relatório chama de "Valor GGF")',
    descricao: 'soma de quantidade × (1 + perda) × custo médio atual de cada item, abrindo todos os kits',
    nivel: 0,
    pai: null,
    valorRelatorio: referencia?.ggf ?? '—',
    valorSistema: custoTotal.comCustoMedioAtual,
    origem: 'soma dos itens com o custo médio atual do estoque',
    bate: referencia === undefined || custoTotal.comCustoMedioAtual === null ? null : totalBate,
  });
  if (custoTotal.comCustoMedioAtual === null) {
    conclusao.push({ tipo: 'problema', texto: `Não foi possível somar o custo total: ${custoTotal.erro ?? 'erro desconhecido'}.` });
    pendencias.push('a soma do custo total');
  } else {
    const atual = custoTotal.comCustoMedioAtual;
    if (referencia === undefined) {
      conclusao.push({ tipo: 'info', texto: `Custo total do produto com o custo médio atual: R$ ${numeroBr(atual)} (${custoTotal.folhas} itens, abrindo todos os kits).` });
    } else {
      const { valor: ref } = interpretarValorRelatorio(referencia.ggf);
      const rel = custoTotal.comValoresDoRelatorio;
      const partes = [
        `Custo total com o custo médio atual: R$ ${numeroBr(atual)} (diferença de R$ ${numeroBr(atual - ref)} para os R$ ${referencia.ggf} do relatório)`,
      ];
      if (rel !== null && custoTotal.folhasComValorDoRelatorio > 0) {
        partes.push(
          `trocando ${custoTotal.folhasComValorDoRelatorio === 1 ? 'o item que tem' : `os ${custoTotal.folhasComValorDoRelatorio} itens que têm`} valor anotado do relatório por esse valor: R$ ${numeroBr(rel)} (diferença de R$ ${numeroBr(rel - ref)})`,
        );
      }
      conclusao.push({
        tipo: totalBate ? 'ok' : 'info',
        texto: `${totalBate ? 'Confirmado: o "Valor GGF" do relatório é o custo total do produto. ' : 'Teste da hipótese "Valor GGF = custo total do produto": '}${partes.join('; ')}.`,
      });
    }
    if (custoTotal.kitsComCustoProprio.length > 0) {
      conclusao.push({ tipo: 'info', texto: `Kits sem estrutura que entraram com o custo médio do próprio kit: ${listaBr(custoTotal.kitsComCustoProprio)}.` });
    }
    for (const r of custoTotal.ressalvas) conclusao.push({ tipo: 'problema', texto: r });
    if (custoTotal.ressalvas.length > 0) pendencias.push('as ressalvas da soma');
  }
  conclusao.push({ tipo: 'info', texto: 'Não há GGF separado: o custo de fabricação fica dentro das "despesas fixas %" informadas na tela.' });

  // ── itens ──
  const semCusto: string[] = [];
  const diferentes: string[] = [];
  let conferidos = 0;
  let batem = 0;
  for (const c of componentes) {
    const cod = c.codProdMalha ?? '(sem código)';
    const sistema = custoDoSistema(c);
    if (sistema === null && !semCusto.includes(cod)) semCusto.push(cod);
    const ref = referencia !== undefined && c.codProdMalha !== null && Object.hasOwn(referencia.componentes, c.codProdMalha) ? referencia.componentes[c.codProdMalha] : undefined;
    let bate: boolean | null = null;
    const kitAberto = c.tipo !== null && TIPOS_COM_ESTRUTURA.has(c.tipo) && componentes.some((x) => x.pai.toUpperCase() === cod.toUpperCase());
    let origem = kitAberto
      ? `kit aberto: o custo vem dos itens de dentro${sistema === null ? '' : ` (custo médio do kit, ${numeroBr(sistema.valor)}, não entra)`}`
      : (sistema?.origem ?? (c.camposNumericosEstoque === null ? 'não encontrado no estoque do Omie → custo manual' : 'custo zero no estoque do Omie → custo manual'));
    if (ref === null) {
      bate = sistema === null;
    } else if (typeof ref === 'string') {
      conferidos++;
      const { valor, tolerancia } = interpretarValorRelatorio(ref);
      bate = sistema !== null && Math.abs(sistema.valor - valor) <= tolerancia;
      if (bate) {
        batem++;
      } else {
        const outro = conferencia?.find((x) => x.rotulo === c.codProdMalha)?.confere[0];
        if (outro !== undefined) origem += ` (o relatório bate com: ${nomeOrigem(outro)})`;
        diferentes.push(`${cod} (relatório ${ref}; hoje ${sistema === null ? 'sem custo' : numeroBr(sistema.valor)})`);
      }
    }
    linhas.push({
      item: cod,
      descricao: c.descricao,
      nivel: c.nivel,
      pai: c.pai,
      valorRelatorio: ref === undefined ? '—' : ref === null ? 'sem custo' : ref,
      valorSistema: sistema?.valor ?? null,
      origem,
      bate,
    });
  }
  // Itens que o relatório mostra mas que não vieram da API (nem nos subníveis).
  const naoEncontrados: string[] = [];
  for (const [cod, ref] of Object.entries(referencia?.componentes ?? {})) {
    if (componentes.some((c) => c.codProdMalha === cod)) continue;
    naoEncontrados.push(cod);
    linhas.push({ item: cod, descricao: null, nivel: 1, pai: null, valorRelatorio: ref ?? 'sem custo', valorSistema: null, origem: 'não aparece na estrutura do Omie (nem nos kits)', bate: false });
  }

  if (referencia !== undefined) {
    if (conferidos === 0) {
      conclusao.push({ tipo: 'info', texto: 'Nenhum item com custo do relatório foi encontrado na estrutura para conferir.' });
    } else if (batem === conferidos) {
      conclusao.push({ tipo: 'ok', texto: `Os custos dos itens conferidos batem com o relatório (${batem} de ${conferidos}): a base é o custo médio do estoque.` });
    } else {
      conclusao.push({
        tipo: 'info',
        texto: `${batem} de ${conferidos} itens conferidos batem com o relatório. Mudaram desde o relatório (o sistema usa o custo médio ATUAL, que é o correto): ${listaBr(diferentes)}.`,
      });
    }
  }
  if (naoEncontrados.length > 0) {
    conclusao.push({ tipo: 'problema', texto: `O relatório mostra ${listaBr(naoEncontrados)}, mas ${naoEncontrados.length === 1 ? 'esse item não aparece' : 'esses itens não aparecem'} na estrutura que o Omie devolve (nem dentro dos kits).` });
    pendencias.push('os itens que não aparecem na estrutura');
  }

  // ── sem custo → custo manual ──
  // Só as FOLHAS da soma precisam de custo: um kit aberto não entra com o próprio custo. Se a soma
  // falhou, cai na lista de todos os itens (conservador).
  if (custoTotal.comCustoMedioAtual !== null) semCusto.splice(0, semCusto.length, ...custoTotal.itensSemCusto);
  const totalDeItens = custoTotal.comCustoMedioAtual !== null ? custoTotal.folhas : componentes.length;
  if (semCusto.length === 0) {
    conclusao.push({ tipo: 'ok', texto: `Todos os ${totalDeItens} itens que entram no custo têm custo.` });
  } else {
    conclusao.push({
      tipo: 'problema',
      texto: `Sem custo no Omie: ${listaBr(semCusto)}. Eles entram como zero até alguém informar o custo manual (tela "Custos manuais").`,
    });
    pendencias.push(semCusto.length === 1 ? 'o custo manual do item sem custo' : `o custo manual dos ${semCusto.length} itens sem custo`);
  }
  if (componentesNaoConsultados > 0) pendencias.push('os itens que ficaram de fora do diagnóstico');

  // ── de onde o relatório tirou o custo dos itens sem custo médio (só informa) ──
  const descreverCampo = (c: CampoCandidato): string =>
    `${c.origem}.${c.campo} = ${numeroBr(c.valor)} (${c.diferencaPercentual >= 0 ? '+' : ''}${c.diferencaPercentual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)`;
  for (const b of origemCustoSemCustoMedio) {
    const unit = b.unitariosImplicitos[0];
    const cabeca = `${b.codigo}: o relatório antigo tinha R$ ${b.totalRelatorio} para a quantidade ${b.quantidadeRelatorio} (≈ R$ ${unit === undefined ? '?' : numeroBr(unit)} por unidade)`;
    let texto: string;
    if (!b.encontradoNaEstrutura) texto = `${cabeca}; o item não está na estrutura que o Omie devolve hoje.`;
    else if (b.confere.length > 0) texto = `${cabeca}; bate com ${b.confere.map(descreverCampo).join(', ')}.`;
    else if (b.maisProximos.length > 0) texto = `${cabeca}; nenhum campo do Omie bate. Mais próximos: ${b.maisProximos.map(descreverCampo).join(', ')}.`;
    else texto = `${cabeca}; o Omie não devolve nenhum número positivo para este item.`;
    conclusao.push({ tipo: 'info', texto: `Origem do custo — ${texto}` });
  }
  const encontrados = origemCustoSemCustoMedio.filter((b) => b.encontradoNaEstrutura);
  if (encontrados.length > 0) {
    const comuns = encontrados
      .map((b) => new Set(b.confere.map((c) => `${c.origem}.${c.campo}`)))
      .reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
    conclusao.push(
      comuns.size > 0
        ? { tipo: 'info', texto: `Origem do custo — ${encontrados.length === 1 ? 'o item bate' : `os ${encontrados.length} itens batem`} com o mesmo campo: ${listaBr([...comuns])}. Candidato a 2ª fonte de custo (depois do custo médio), a confirmar.` }
        : { tipo: 'info', texto: 'Origem do custo — nenhum campo do Omie bate com todos os itens ao mesmo tempo.' },
    );
  }

  // ── perda ──
  const comPerda = componentes.filter((c) => (paraNumero(c.percPerda) ?? 0) > 0);
  conclusao.push(
    comPerda.length === 0
      ? { tipo: 'info', texto: 'Nenhum item tem % de perda cadastrado na estrutura (todos 0%), então a perda não muda nenhuma quantidade.' }
      : {
          tipo: 'info',
          texto: `${comPerda.length} item(ns) têm % de perda cadastrado: ${listaBr(comPerda.map((c) => `${c.codProdMalha ?? '?'} (${(paraNumero(c.percPerda) ?? 0).toLocaleString('pt-BR')}%)`))}. A soma já usa quantidade × (1 + perda).`,
        },
  );

  // ── veredito ──
  const podeUsar = referencia !== undefined && pendencias.length === 0;
  if (podeUsar) {
    conclusao.push({ tipo: 'ok', texto: 'Pode usar: o custo foi somado item a item, com o custo médio atual, e nenhum item está sem custo.' });
  } else if (referencia === undefined) {
    conclusao.push({
      tipo: 'info',
      texto: `Não há valores do relatório do Omie cadastrados para ${codigo} para conferir.${semCusto.length > 0 ? ' E há itens sem custo, que precisam de custo manual.' : ''}`,
    });
  } else {
    conclusao.push({ tipo: 'problema', texto: `Ainda não dá para usar este custo para formar preço. Falta: ${listaBr(pendencias)}.` });
  }

  return { linhas, conclusao, podeUsar };
}