/**
 * Etapa 4 — junta os dados do Omie (custo médio, NCM), o custo manual e a tabela fiscal e devolve,
 * para cada FOLHA da estrutura, o custo bruto e o líquido que entram em `calcularCusto`.
 * FUNÇÃO PURA (sem Omie, sem banco). Spec: "Impostos na compra" e decisões de 24 a 26/11/2026.
 *
 * Por folha:
 * 1. Valor: `resolverCustoItem` (manual desta simulação > manual salvo > Omie > sem custo).
 * 2. Créditos:
 *    - custo do OMIE (`nCMC`): JÁ VEM LÍQUIDO dos impostos recuperáveis (aba "Custo de Estoque" do
 *      recebimento de NF-e — decisão de 26/11/2026). Entra como está, SEM crédito nenhum;
 *    - custo MANUAL (valor da nota, com impostos): tira IPI e PIS/COFINS pelos dados fiscais
 *      digitados com ele (`custoDaCompraSemNota`); o ICMS fica no custo. Indústria normal sem IPI
 *      informado usa a tabela NCM → IPI; NCM vazio ou fora da tabela = sem crédito (tarja amarela
 *      `ITEM_SEM_NCM_IPI`, gerada por `calcularCusto`);
 *    - custo manual sem UF/tipo de fornecedor (INALCANÇÁVEL hoje: `resolverCustoItem` sempre devolve
 *      os dados fiscais do manual, e a gravação exige UF e tipo; fica como defesa): pelo valor
 *      BRUTO, sem crédito, com tarja amarela `ITEM_SEM_DADOS_FISCAIS` (o preço sai alto, nunca baixo).
 */

import type { Aviso } from './avisos.js';
import type { ItemCusto } from './calculo.js';
import type { DadosOmieProduto } from './coletaOmie.js';
import { custoDaCompraSemNota, resolverCustoItem, type CustoManual, type OrigemCusto } from './custoManual.js';
import { aliquotaIpiDoNcm, paraParametrosDoCalculo, type TabelaFiscal } from './parametrosFiscais.js';

/**
 * Como saiu o custo líquido do item:
 * - `OMIE_LIQUIDO`: custo médio do Omie, já sem os impostos recuperáveis (sem crédito aplicado);
 * - `DADOS_MANUAIS`: custo manual com os créditos pelos dados fiscais digitados;
 * - `SEM_DADOS_FISCAIS`: custo manual sem UF/tipo de fornecedor (bruto, sem crédito);
 * - `SEM_CUSTO`: sem custo.
 */
export type FonteCreditos = 'OMIE_LIQUIDO' | 'DADOS_MANUAIS' | 'SEM_DADOS_FISCAIS' | 'SEM_CUSTO';

export interface ItemCustoMontado extends ItemCusto {
  descricao: string | null;
  ncm: string | null;
  origem: OrigemCusto;
  fonteCreditos: FonteCreditos;
  /** Alíquotas usadas nos créditos do custo manual (fração); `null` = sem crédito calculado. */
  aliquotaIpi: number | null;
  aliquotaIcms: number | null;
  conflito: { valorManual: number; valorManualLiquido: number; valorOmie: number; escolhido: 'MANUAL' | 'OMIE' } | null;
}

export interface EntradaMontagem {
  dados: DadosOmieProduto;
  tabela: TabelaFiscal;
  manuaisSalvos: ReadonlyMap<string, CustoManual>;
  manuaisSimulacao?: ReadonlyMap<string, CustoManual>;
  escolhas?: Readonly<Record<string, 'MANUAL' | 'OMIE'>>;
}

export interface ResultadoMontagem {
  itens: ItemCustoMontado[];
  /** Alíquota de IPI na venda do produto acabado (fração); `null` = sem NCM ou fora da tabela (tarja vermelha). */
  aliquotaIpiVenda: number | null;
  avisos: Aviso[];
}

export function montarCusto(entrada: EntradaMontagem): ResultadoMontagem {
  const { dados, tabela } = entrada;
  const parametros = paraParametrosDoCalculo(tabela);
  const avisos: Aviso[] = [];
  const semDadosAvisados = new Set<string>();
  const itens: ItemCustoMontado[] = [];

  for (const folha of dados.folhas) {
    const chave = folha.codigo.toUpperCase();
    const comp = dados.componentes[chave] ?? null;
    const salvo = entrada.manuaisSalvos.get(chave) ?? null;
    // O nCMC é líquido: o conflito compara com o manual JÁ SEM os créditos (sem IPI conhecido, sem crédito).
    const liquidoManualSalvo =
      salvo === null || salvo.valorNota === null
        ? null
        : (() => {
            const c = custoDaCompraSemNota(salvo.valorNota, salvo, aliquotaIpiDoNcm(tabela, comp?.ncm ?? null), parametros.compra, parametros.pisCofins);
            return c.custoLiquidoUnitario ?? c.custoBrutoUnitario;
          })();
    const r = resolverCustoItem({
      codigo: folha.codigo,
      custoOmie: comp?.custoMedio ?? null,
      manualSalvo: salvo,
      manualSimulacao: entrada.manuaisSimulacao?.get(chave) ?? null,
      escolhaConflito: entrada.escolhas?.[chave] ?? null,
      liquidoManualSalvo,
    });
    // O mesmo código em vários ramos: os avisos do item uma vez só.
    for (const a of r.avisos) if (!avisos.some((x) => x.codigo === a.codigo && x.item === a.item)) avisos.push(a);
    const ncm = comp?.ncm ?? null;
    const base = {
      codigo: folha.codigo,
      quantidade: folha.quantidadeNoProduto,
      descricao: folha.descricao ?? comp?.descricao ?? null,
      ncm,
      origem: r.origem,
      conflito: r.conflito,
    };

    if (r.valorUnitario === null) {
      itens.push({ ...base, custoBrutoUnitario: null, custoLiquidoUnitario: null, fonteCreditos: 'SEM_CUSTO', aliquotaIpi: null, aliquotaIcms: null });
      continue;
    }

    if (r.origem === 'OMIE') {
      // nCMC já líquido dos impostos recuperáveis: entra como está, sem crédito nenhum.
      itens.push({ ...base, custoBrutoUnitario: r.valorUnitario, custoLiquidoUnitario: r.valorUnitario, fonteCreditos: 'OMIE_LIQUIDO', aliquotaIpi: null, aliquotaIcms: null });
      continue;
    }

    if (r.dadosFiscais !== null) {
      const c = custoDaCompraSemNota(r.valorUnitario, r.dadosFiscais, aliquotaIpiDoNcm(tabela, ncm), parametros.compra, parametros.pisCofins);
      itens.push({ ...base, custoBrutoUnitario: c.custoBrutoUnitario, custoLiquidoUnitario: c.custoLiquidoUnitario, fonteCreditos: 'DADOS_MANUAIS', aliquotaIpi: c.aliquotaIpi, aliquotaIcms: c.aliquotaIcms });
      continue;
    }

    // Custo manual sem UF/tipo de fornecedor: pelo bruto, sem crédito (explícito, nunca adivinhado).
    itens.push({ ...base, custoBrutoUnitario: r.valorUnitario, custoLiquidoUnitario: r.valorUnitario, fonteCreditos: 'SEM_DADOS_FISCAIS', aliquotaIpi: null, aliquotaIcms: null });
    if (!semDadosAvisados.has(chave)) {
      semDadosAvisados.add(chave);
      avisos.push({
        nivel: 'AMARELO',
        codigo: 'ITEM_SEM_DADOS_FISCAIS',
        item: folha.codigo,
        mensagem: `Custo manual do item ${folha.codigo} sem UF ou tipo de fornecedor — entrou pelo valor da nota, sem crédito. Informe UF e tipo de fornecedor no custo manual do item ${folha.codigo}.`,
      });
    }
  }

  const ncmProduto = dados.produto?.ncm ?? null;
  const aliquotaIpiVenda = aliquotaIpiDoNcm(tabela, ncmProduto);
  if (aliquotaIpiVenda === null) {
    avisos.push({
      nivel: 'VERMELHO',
      codigo: 'IPI_VENDA_NCM_NAO_CONFIGURADO',
      item: ncmProduto ?? dados.codigo,
      mensagem:
        ncmProduto === null
          ? `O produto ${dados.codigo} não tem NCM no cadastro do Omie — sem ele não há IPI na venda. Corrija o NCM no Omie.`
          : `O NCM ${ncmProduto} do produto ${dados.codigo} não está na tabela NCM → IPI. Peça ao administrador para preencher o NCM ${ncmProduto} na tabela fiscal.`,
    });
  }
  return { itens, aliquotaIpiVenda, avisos };
}
