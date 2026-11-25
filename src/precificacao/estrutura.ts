/**
 * Abertura da estrutura do produto até as FOLHAS — FUNÇÃO PURA (sem Omie, sem banco).
 * Decisão de 2026-11-25 (igual ao relatório "Imprimir Estrutura" do Omie):
 *
 * - Todo kit/subestrutura que TEM estrutura é aberto, em qualquer nível, e o custo sai só das
 *   folhas: Σ quantidade acumulada × custo médio de cada folha.
 * - Quantidade acumulada = produto de quantidade × (1 + perda) de cada nível do caminho.
 * - NUNCA se soma o custo do kit e o dos itens de dentro dele ao mesmo tempo: kit aberto não
 *   entra com o próprio custo.
 * - Kit SEM estrutura (lista de filhos vazia ou ausente) é tratado como folha: entra com o custo
 *   médio do próprio kit.
 * - Estrutura em ciclo (um item que contém a si mesmo no caminho) ou funda demais é erro
 *   explícito — nunca um custo "aproximado".
 *
 * Convenção do cálculo: perda como FRAÇÃO (5% = 0.05). A conversão do "% de perda" do Omie (em
 * pontos) é de quem monta a árvore.
 */

import { ErroValidacao } from '../validacao.js';

export interface NoEstrutura {
  codigo: string;
  descricao?: string | null;
  /** Quantidade por unidade do pai (já na unidade de consumo). */
  quantidade: number;
  /** Perda como fração (0.05 = 5%). */
  perda: number;
  /** Custo unitário (custo médio do estoque) — `null` = sem custo. Só é usado se o item for folha. */
  custoUnitario: number | null;
  /** Itens de dentro, quando o item tem estrutura própria. Vazio ou ausente = folha. */
  filhos?: NoEstrutura[] | null;
}

export interface FolhaEstrutura {
  codigo: string;
  descricao: string | null;
  /** Quantas unidades desta folha entram em 1 unidade do produto, já com a perda de todos os níveis. */
  quantidadeNoProduto: number;
  custoUnitario: number | null;
  /** Códigos dos kits do caminho, do nível 1 até o pai direto (vazio = item direto do produto). */
  caminho: string[];
  /** É um kit (tipo com estrutura) sem estrutura cadastrada, entrando com o próprio custo? */
  kitSemEstrutura: boolean;
}

/** Profundidade máxima aceita (o PA00000001 tem 4 níveis). */
export const MAX_NIVEIS_ESTRUTURA = 10;

function exigirNaoNegativo(valor: unknown, nome: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
    throw new ErroValidacao(`${nome} deve ser um número maior ou igual a zero.`);
  }
  return valor;
}

/**
 * Lista as folhas da estrutura, cada uma com a quantidade acumulada no produto. Um mesmo código em
 * ramos diferentes aparece uma vez por ramo (são usos diferentes, não duplicidade).
 *
 * Opções:
 * - `codigoRaiz`: código do produto — um item que contém o próprio produto também é ciclo (erro).
 * - `ehKit(no)`: diz se um nó sem filhos é um kit sem estrutura (só para marcar `kitSemEstrutura`;
 *   não muda a conta — sem filhos, o item entra com o próprio custo de qualquer forma).
 */
export function abrirEstrutura(
  itens: readonly NoEstrutura[],
  opcoes: { codigoRaiz?: string; ehKit?: (no: NoEstrutura) => boolean } = {},
): FolhaEstrutura[] {
  const ehKit = opcoes.ehKit ?? (() => false);
  const raiz = opcoes.codigoRaiz?.trim().toUpperCase() ?? null;
  const folhas: FolhaEstrutura[] = [];
  const visitar = (no: NoEstrutura, qtdPai: number, caminho: string[]): void => {
    const codigo = typeof no.codigo === 'string' ? no.codigo.trim() : '';
    if (codigo === '') throw new ErroValidacao('Item da estrutura sem código.');
    const quantidade = exigirNaoNegativo(no.quantidade, `Quantidade do item ${codigo}`);
    const perda = exigirNaoNegativo(no.perda, `Perda do item ${codigo}`);
    if (perda >= 1) throw new ErroValidacao(`Perda do item ${codigo} deve ser menor que 100%.`);
    const codigoNormalizado = codigo.toUpperCase();
    if (caminho.some((c) => c.toUpperCase() === codigoNormalizado)) {
      throw new ErroValidacao(`Estrutura em ciclo: o item ${codigo} aparece dentro dele mesmo (${[...caminho, codigo].join(' → ')}).`);
    }
    if (raiz !== null && codigoNormalizado === raiz) {
      throw new ErroValidacao(`Estrutura em ciclo: o produto ${codigo} aparece dentro da própria estrutura (${[...caminho, codigo].join(' → ')}).`);
    }
    const qtdNoProduto = qtdPai * quantidade * (1 + perda);
    const filhos = no.filhos ?? [];
    if (filhos.length > 0) {
      if (caminho.length + 1 >= MAX_NIVEIS_ESTRUTURA) {
        throw new ErroValidacao(`Estrutura com mais de ${MAX_NIVEIS_ESTRUTURA} níveis (em ${[...caminho, codigo].join(' → ')}).`);
      }
      // Kit aberto: o custo sai só dos itens de dentro — o custo do próprio kit é ignorado.
      for (const filho of filhos) visitar(filho, qtdNoProduto, [...caminho, codigo]);
      return;
    }
    if (no.custoUnitario !== null) exigirNaoNegativo(no.custoUnitario, `Custo do item ${codigo}`);
    folhas.push({
      codigo,
      descricao: no.descricao ?? null,
      quantidadeNoProduto: qtdNoProduto,
      custoUnitario: no.custoUnitario,
      caminho,
      kitSemEstrutura: ehKit(no),
    });
  };
  for (const item of itens) visitar(item, 1, []);
  return folhas;
}

export interface TotalEstrutura {
  /** Σ quantidade no produto × custo unitário das folhas com custo. */
  total: number;
  /** Folhas sem custo (entram com zero), sem repetir código. */
  semCusto: string[];
  folhas: FolhaEstrutura[];
}

/** Custo total das folhas. Folha sem custo entra com zero e é listada em `semCusto`. */
export function somarFolhas(folhas: readonly FolhaEstrutura[]): TotalEstrutura {
  let total = 0;
  const semCusto: string[] = [];
  for (const f of folhas) {
    if (f.custoUnitario === null) {
      if (!semCusto.includes(f.codigo)) semCusto.push(f.codigo);
      continue;
    }
    total += f.quantidadeNoProduto * f.custoUnitario;
  }
  return { total, semCusto, folhas: [...folhas] };
}
