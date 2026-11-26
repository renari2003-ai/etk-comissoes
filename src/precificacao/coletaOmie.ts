/**
 * Etapa 4 — leitura do Omie para o custo de UM produto (SOMENTE LEITURA): estrutura aberta até as
 * folhas, custo médio atual (`nCMC`) de cada folha e NCM do cadastro (do produto e das folhas).
 * O `nCMC` já vem líquido dos impostos recuperáveis (decisão de 26/11/2026): as notas de entrada
 * NÃO são lidas para o custo.
 *
 * Nunca calcula preço: devolve os dados e os avisos do Omie para o cálculo (`calculo.ts`,
 * `custoManual.ts`). Falha do Omie nunca vira "custo zero" nem "sem nota" em silêncio — vira a
 * tarja vermelha `OMIE_INDISPONIVEL` e o preço não sai.
 *
 * Avisos daqui:
 * - VERMELHO `PRODUTO_SEM_ESTRUTURA`: o produto não tem estrutura no Omie.
 * - VERMELHO `OMIE_INDISPONIVEL`: erro ou demora do Omie em qualquer consulta necessária.
 * - AMARELO `COMPONENTES_NAO_CONSULTADOS`: estrutura acima do teto de componentes.
 */

import type { EstoqueOmie } from '../calculo/tipos.js';
import type { ClienteOmie, ProdutoOmie } from '../omie/cliente.js';
import { indicaRegistroInexistente } from '../omie/erros.js';
import { ErroValidacao } from '../validacao.js';
import type { Aviso } from './avisos.js';
import { abrirEstrutura, MAX_NIVEIS_ESTRUTURA, type FolhaEstrutura, type NoEstrutura } from './estrutura.js';

export type FonteOmiePrecificacao = Pick<ClienteOmie, 'consultarEstrutura' | 'consultarProduto' | 'obterEstoqueProduto'>;

/**
 * Teto de componentes consultados (todos os níveis). A spec previa 60, mas o PA00000001 já tem 69
 * itens em 4 níveis: 150, como no diagnóstico (cada componente custa 2 chamadas com cache).
 */
export const MAX_COMPONENTES_PRECIFICACAO = 150;

/** Tipos de item do Omie com estrutura própria (abertos): 03 = produto em processo, 04 = produto acabado. */
const TIPOS_COM_ESTRUTURA = new Set(['03', '04']);

/** Origem da mercadoria com conteúdo importado para a alíquota de 4% (Res. Senado 13/2012): 1, 2, 3 e 8. */
const ORIGENS_IMPORTADAS = new Set(['1', '2', '3', '8']);

export interface ComponenteOmie {
  codigo: string;
  idProduto: number | null;
  descricao: string | null;
  /** NCM do cadastro (8 dígitos) — `null` se vazio. */
  ncm: string | null;
  /**
   * Custo médio ATUAL do estoque (`nCMC`), já líquido dos impostos recuperáveis;
   * `null` = sem custo (0 também é sem custo).
   */
  custoMedio: number | null;
}

export interface DadosOmieProduto {
  codigo: string;
  produto: {
    idProduto: number | null;
    descricao: string | null;
    ncm: string | null;
    /** Pela origem da mercadoria do cadastro; `null` = origem não informada. */
    conteudoImportado: boolean | null;
  } | null;
  /** Árvore com o custo médio em cada nó (só as folhas contam). */
  arvore: NoEstrutura[];
  folhas: FolhaEstrutura[];
  /** Dados de cada folha, por código (maiúsculas). */
  componentes: Record<string, ComponenteOmie>;
  avisos: Aviso[];
}

function textoOuNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function numeroOuNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}
function idOuNull(v: unknown): number | null {
  const n = numeroOuNull(v);
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** NCM do cadastro só com dígitos; 8 dígitos ou `null` (NCM incompleto não serve para a tabela). */
export function ncmDoCadastro(produto: Pick<ProdutoOmie, 'ncm'>): string | null {
  const digitos = (produto.ncm ?? '').replace(/\D/g, '');
  return digitos.length === 8 ? digitos : null;
}

export function conteudoImportadoDoCadastro(produto: Pick<ProdutoOmie, 'recomendacoes_fiscais'>): boolean | null {
  const origem = textoOuNull(produto.recomendacoes_fiscais?.origem_mercadoria);
  return origem === null ? null : ORIGENS_IMPORTADAS.has(origem);
}

function custoMedioDoEstoque(estoque: EstoqueOmie): number | null {
  const registro = estoque.listaEstoque?.[0] as Record<string, unknown> | undefined;
  const n = numeroOuNull(registro?.nCMC);
  return n !== null && n > 0 ? n : null;
}

/** O Omie responde com falha (não lista vazia) quando o produto não tem estrutura cadastrada. */
const ehEstruturaInexistente = indicaRegistroInexistente;

class OmieIndisponivel extends Error {}

const AVISO_OMIE_INDISPONIVEL = (detalhe: string): Aviso => ({
  nivel: 'VERMELHO',
  codigo: 'OMIE_INDISPONIVEL',
  item: null,
  mensagem: `Não foi possível consultar o Omie (${detalhe}). Tente de novo em alguns minutos.`,
});

/**
 * Lê do Omie tudo o que o custo do produto precisa. `hojeIso` (aaaa-mm-dd) é a data do estoque.
 * Aviso vermelho na lista = o resto dos dados não deve ser usado para preço.
 */
export async function coletarDadosOmie(codigo: string, fonte: FonteOmiePrecificacao, hojeIso: string): Promise<DadosOmieProduto> {
  const dados: DadosOmieProduto = { codigo, produto: null, arvore: [], folhas: [], componentes: {}, avisos: [] };

  const chamar = async <T>(oQue: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (erro) {
      dados.avisos.push(AVISO_OMIE_INDISPONIVEL(oQue));
      throw new OmieIndisponivel(oQue);
    }
  };

  try {
    let estrutura: Record<string, unknown>;
    try {
      estrutura = await fonte.consultarEstrutura(codigo);
    } catch (erro) {
      if (ehEstruturaInexistente(erro)) {
        dados.avisos.push(semEstrutura(codigo));
        return dados;
      }
      dados.avisos.push(AVISO_OMIE_INDISPONIVEL(`estrutura de ${codigo}`));
      return dados;
    }
    const itensRaiz = Array.isArray(estrutura.itens) ? (estrutura.itens as Record<string, unknown>[]) : [];
    if (itensRaiz.length === 0) {
      dados.avisos.push(semEstrutura(codigo));
      return dados;
    }

    const ident = (estrutura.ident ?? {}) as Record<string, unknown>;
    const idRaiz = idOuNull(ident.idProduto);
    if (idRaiz !== null) {
      const produto = await chamar(`cadastro de ${codigo}`, () => fonte.consultarProduto(idRaiz));
      dados.produto = { idProduto: idRaiz, descricao: textoOuNull(ident.descrProduto) ?? textoOuNull(produto.descricao), ncm: ncmDoCadastro(produto), conteudoImportado: conteudoImportadoDoCadastro(produto) };
    } else {
      dados.produto = { idProduto: null, descricao: textoOuNull(ident.descrProduto), ncm: null, conteudoImportado: null };
    }

    let consultados = 0;
    const naoConsultados: string[] = [];
    const kits = new Set<NoEstrutura>();
    const montar = async (itens: Record<string, unknown>[], caminho: string[]): Promise<NoEstrutura[]> => {
      const nos: NoEstrutura[] = [];
      for (const item of itens) {
        const cod = textoOuNull(item.codProdMalha) ?? `id ${String(item.idProdMalha)}`;
        const quantidade = numeroOuNull(item.quantProdMalha);
        const perdaPontos = numeroOuNull(item.percPerdaProdMalha) ?? 0;
        const no: NoEstrutura = {
          codigo: cod,
          descricao: textoOuNull(item.descrProdMalha),
          quantidade: quantidade ?? Number.NaN,
          perda: perdaPontos > 0 ? perdaPontos / 100 : 0,
          custoUnitario: null,
        };
        nos.push(no);
        if (consultados >= MAX_COMPONENTES_PRECIFICACAO) {
          naoConsultados.push(cod);
          continue;
        }
        consultados++;
        const id = idOuNull(item.idProdMalha);
        const tipo = textoOuNull(item.tipoProdMalha);
        const ehKit = tipo !== null && TIPOS_COM_ESTRUTURA.has(tipo);
        if (ehKit) kits.add(no);
        // Kit: abre a estrutura dele. Ciclo (o kit dentro dele mesmo ou do produto) ou estrutura funda
        // demais é erro EXPLÍCITO, como em `abrirEstrutura` — nunca vira folha com o próprio custo.
        if (ehKit) {
          if (caminho.includes(cod.toUpperCase())) {
            throw new ErroValidacao(`Estrutura em ciclo: o item ${cod} aparece dentro dele mesmo (${[...caminho, cod.toUpperCase()].join(' → ')}).`);
          }
          if (caminho.length >= MAX_NIVEIS_ESTRUTURA) {
            throw new ErroValidacao(`Estrutura com mais de ${MAX_NIVEIS_ESTRUTURA} níveis (em ${[...caminho, cod.toUpperCase()].join(' → ')}).`);
          }
          let sub: Record<string, unknown> | null = null;
          try {
            sub = await fonte.consultarEstrutura(cod);
          } catch (erro) {
            if (!ehEstruturaInexistente(erro)) {
              dados.avisos.push(AVISO_OMIE_INDISPONIVEL(`estrutura do kit ${cod}`));
              throw new OmieIndisponivel(cod);
            }
          }
          const itensSub = sub !== null && Array.isArray(sub.itens) ? (sub.itens as Record<string, unknown>[]) : [];
          if (itensSub.length > 0) {
            no.filhos = await montar(itensSub, [...caminho, cod.toUpperCase()]);
            continue;
          }
        }
        // Folha (ou kit sem estrutura): custo médio e NCM.
        const componente: ComponenteOmie = { codigo: cod, idProduto: id, descricao: no.descricao ?? null, ncm: null, custoMedio: null };
        if (id !== null) {
          const estoque = await chamar(`estoque de ${cod}`, () => fonte.obterEstoqueProduto(id, hojeIso));
          componente.custoMedio = custoMedioDoEstoque(estoque);
          const cadastro = await chamar(`cadastro de ${cod}`, () => fonte.consultarProduto(id));
          componente.ncm = ncmDoCadastro(cadastro);
        }
        no.custoUnitario = componente.custoMedio;
        dados.componentes[cod.toUpperCase()] = componente;
      }
      return nos;
    };

    // O caminho começa no próprio produto: um kit que contém o produto é ciclo logo de cara.
    dados.arvore = await montar(itensRaiz, [codigo.toUpperCase()]);
    dados.folhas = abrirEstrutura(dados.arvore, { codigoRaiz: codigo, ehKit: (no) => kits.has(no) });

    if (naoConsultados.length > 0) {
      dados.avisos.push({
        nivel: 'AMARELO',
        codigo: 'COMPONENTES_NAO_CONSULTADOS',
        item: null,
        mensagem: `A estrutura tem mais de ${MAX_COMPONENTES_PRECIFICACAO} componentes: ${naoConsultados.length} ficaram de fora da consulta e entraram sem custo (${naoConsultados.slice(0, 20).join(', ')}${naoConsultados.length > 20 ? '…' : ''}).`,
      });
    }
    return dados;
  } catch (erro) {
    if (erro instanceof OmieIndisponivel) return dados;
    throw erro;
  }
}

function semEstrutura(codigo: string): Aviso {
  return {
    nivel: 'VERMELHO',
    codigo: 'PRODUTO_SEM_ESTRUTURA',
    item: codigo,
    mensagem: `O produto ${codigo} não tem estrutura no Omie. Cadastre a estrutura no Omie para calcular o custo.`,
  };
}
