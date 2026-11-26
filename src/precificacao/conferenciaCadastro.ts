/**
 * Relatório de conferência do cadastro (etapa 4) — SOMENTE LEITURA. Para um produto, ou para uma
 * página (lote) das estruturas do Omie, lista o produto acabado e os componentes (folhas, abrindo
 * os kits) que estão SEM NCM no cadastro do Omie (corrigir no Omie) ou com NCM FORA da tabela
 * NCM → IPI (o administrador preenche na tabela fiscal). Decisão de 26/11/2026: o cadastro do Omie
 * não tem alíquota de IPI, só o NCM.
 *
 * Erro do Omie num produto do lote não derruba o lote: a linha sai com o problema "OMIE_INDISPONIVEL".
 */

import type { ClienteOmie } from '../omie/cliente.js';
import { indicaRegistroInexistente } from '../omie/erros.js';
import { ncmDoCadastro } from './coletaOmie.js';
import { MAX_NIVEIS_ESTRUTURA } from './estrutura.js';
import { aliquotaIpiDoNcm, type TabelaFiscal } from './parametrosFiscais.js';

export type FonteConferencia = Pick<ClienteOmie, 'consultarEstrutura' | 'consultarProduto' | 'listarEstruturas'>;

/** `NAO_CONFERIDO`: o item não pôde ser conferido (sem código/id, acima do teto, ciclo ou nível demais) — nunca some em silêncio. */
export type ProblemaCadastro = 'SEM_NCM' | 'NCM_SEM_IPI_NA_TABELA' | 'SEM_ESTRUTURA' | 'OMIE_INDISPONIVEL' | 'NAO_CONFERIDO';

export interface LinhaConferencia {
  produto: string;
  /** Código do componente (ou do próprio produto, na linha do produto acabado). */
  codigo: string;
  descricao: string | null;
  ehProdutoAcabado: boolean;
  ncm: string | null;
  problema: ProblemaCadastro;
  detalhe: string;
}

/** Produtos por lote na varredura de todos (cada componente custa uma consulta ao Omie, com cache). */
export const PRODUTOS_POR_LOTE = 10;
/** Teto de componentes por produto no relatório (o mesmo do cálculo). */
const MAX_COMPONENTES = 150;
const TIPOS_COM_ESTRUTURA = new Set(['03', '04']);

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
/** Id do Omie: número ou texto numérico (o mesmo critério da coleta do cálculo). */
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v.trim()) ? Number(v.trim()) : null;
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
};

const inexistente = indicaRegistroInexistente;

function linhaNcm(produto: string, codigo: string, descricao: string | null, ehProdutoAcabado: boolean, ncm: string | null, tabela: TabelaFiscal): LinhaConferencia | null {
  if (ncm === null) {
    return { produto, codigo, descricao, ehProdutoAcabado, ncm, problema: 'SEM_NCM', detalhe: 'Sem NCM (8 dígitos) no cadastro do Omie — corrija no Omie.' };
  }
  if (aliquotaIpiDoNcm(tabela, ncm) === null) {
    return { produto, codigo, descricao, ehProdutoAcabado, ncm, problema: 'NCM_SEM_IPI_NA_TABELA', detalhe: `NCM ${ncm} fora da tabela NCM → IPI — o administrador preenche na tabela fiscal.` };
  }
  return null;
}

/** Confere um produto a partir da estrutura já lida (`ident` + `itens`). */
async function conferirEstrutura(estrutura: Record<string, unknown>, codigoProduto: string, fonte: FonteConferencia, tabela: TabelaFiscal): Promise<LinhaConferencia[]> {
  const linhas: LinhaConferencia[] = [];
  const ident = (estrutura.ident ?? {}) as Record<string, unknown>;
  const idProduto = id(ident.idProduto);
  if (idProduto !== null) {
    const cadastro = await fonte.consultarProduto(idProduto);
    const l = linhaNcm(codigoProduto, codigoProduto, texto(ident.descrProduto), true, ncmDoCadastro(cadastro), tabela);
    if (l !== null) linhas.push(l);
  }
  const vistos = new Set<string>();
  let consultados = 0;
  const naoConferido = (codigo: string, descricao: string | null, detalhe: string): void => {
    linhas.push({ produto: codigoProduto, codigo, descricao, ehProdutoAcabado: false, ncm: null, problema: 'NAO_CONFERIDO', detalhe });
  };
  const visitar = async (itens: Record<string, unknown>[], caminho: string[]): Promise<void> => {
    for (const item of itens) {
      const cod = texto(item.codProdMalha);
      const idItem = id(item.idProdMalha);
      const descricao = texto(item.descrProdMalha);
      if (cod === null || idItem === null) {
        naoConferido(cod ?? `id ${String(item.idProdMalha)}`, descricao, 'Item da estrutura sem código ou id no Omie — confira a estrutura no Omie.');
        continue;
      }
      if (consultados >= MAX_COMPONENTES) {
        naoConferido(cod, descricao, `Acima do teto de ${MAX_COMPONENTES} componentes por produto — não conferido.`);
        continue;
      }
      const tipo = texto(item.tipoProdMalha);
      if (tipo !== null && TIPOS_COM_ESTRUTURA.has(tipo)) {
        if (caminho.includes(cod.toUpperCase()) || caminho.length >= MAX_NIVEIS_ESTRUTURA) {
          naoConferido(cod, descricao, caminho.includes(cod.toUpperCase()) ? 'Estrutura em ciclo (o kit aparece dentro dele mesmo) — corrija no Omie.' : `Estrutura com mais de ${MAX_NIVEIS_ESTRUTURA} níveis — não conferido.`);
          continue;
        }
        let sub: Record<string, unknown> | null = null;
        try {
          sub = await fonte.consultarEstrutura(cod);
        } catch (erro) {
          if (!inexistente(erro)) throw erro;
        }
        const filhos = sub !== null && Array.isArray(sub.itens) ? (sub.itens as Record<string, unknown>[]) : [];
        if (filhos.length > 0) {
          await visitar(filhos, [...caminho, cod.toUpperCase()]);
          continue;
        }
      }
      if (vistos.has(cod.toUpperCase())) continue;
      vistos.add(cod.toUpperCase());
      consultados++;
      const l = linhaNcm(codigoProduto, cod, texto(item.descrProdMalha), false, ncmDoCadastro(await fonte.consultarProduto(idItem)), tabela);
      if (l !== null) linhas.push(l);
    }
  };
  await visitar(Array.isArray(estrutura.itens) ? (estrutura.itens as Record<string, unknown>[]) : [], [codigoProduto.toUpperCase()]);
  return linhas;
}

function linhaErro(produto: string, problema: 'SEM_ESTRUTURA' | 'OMIE_INDISPONIVEL'): LinhaConferencia {
  return {
    produto,
    codigo: produto,
    descricao: null,
    ehProdutoAcabado: true,
    ncm: null,
    problema,
    detalhe: problema === 'SEM_ESTRUTURA' ? 'Produto sem estrutura no Omie.' : 'Não foi possível consultar o Omie para este produto. Tente de novo em alguns minutos.',
  };
}

/** Um produto pelo código. */
export async function conferirProduto(codigo: string, fonte: FonteConferencia, tabela: TabelaFiscal): Promise<LinhaConferencia[]> {
  let estrutura: Record<string, unknown>;
  try {
    estrutura = await fonte.consultarEstrutura(codigo);
  } catch (erro) {
    return [linhaErro(codigo, inexistente(erro) ? 'SEM_ESTRUTURA' : 'OMIE_INDISPONIVEL')];
  }
  if (!Array.isArray(estrutura.itens) || estrutura.itens.length === 0) return [linhaErro(codigo, 'SEM_ESTRUTURA')];
  // Falha ao ler um componente (inclusive "não cadastrado") nunca vira "produto sem estrutura".
  try {
    return await conferirEstrutura(estrutura, codigo, fonte, tabela);
  } catch {
    return [linhaErro(codigo, 'OMIE_INDISPONIVEL')];
  }
}

/** Um lote (página) das estruturas do Omie: a tela chama página por página até `totalPaginas`. */
export async function conferirLote(pagina: number, fonte: FonteConferencia, tabela: TabelaFiscal): Promise<{ pagina: number; totalPaginas: number; produtosConferidos: number; linhas: LinhaConferencia[] }> {
  const { totalPaginas, produtos } = await fonte.listarEstruturas(pagina, PRODUTOS_POR_LOTE);
  const linhas: LinhaConferencia[] = [];
  for (const p of produtos) {
    const ident = (p.ident ?? {}) as Record<string, unknown>;
    const codigo = texto(ident.codProduto) ?? `id ${String(ident.idProduto)}`;
    // Produto do lote sem itens: "sem estrutura", nunca "nenhum problema".
    if (!Array.isArray(p.itens) || p.itens.length === 0) {
      linhas.push(linhaErro(codigo, 'SEM_ESTRUTURA'));
      continue;
    }
    try {
      linhas.push(...(await conferirEstrutura(p, codigo, fonte, tabela)));
    } catch {
      linhas.push(linhaErro(codigo, 'OMIE_INDISPONIVEL'));
    }
  }
  return { pagina, totalPaginas, produtosConferidos: produtos.length, linhas };
}
