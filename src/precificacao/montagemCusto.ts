/**
 * Etapa 4 — junta os dados do Omie (custo médio, última nota, NCM), o custo manual e a tabela
 * fiscal e devolve, para cada FOLHA da estrutura, o custo bruto e o líquido que entram em
 * `calcularCusto`. FUNÇÃO PURA (sem Omie, sem banco). Spec: "Impostos na compra" e decisões de
 * 24 a 26/11/2026.
 *
 * Por folha:
 * 1. Valor: `resolverCustoItem` (manual desta simulação > manual salvo > Omie > sem custo).
 * 2. Créditos (IPI e PIS/COFINS; o ICMS fica no custo):
 *    - custo MANUAL: pelos dados fiscais digitados com ele (`custoDaCompraSemNota`);
 *    - custo do OMIE com nota de entrada na janela: pelas alíquotas de IPI e ICMS destacadas na
 *      nota mais recente, aplicadas ao custo médio;
 *    - custo do OMIE sem nota ("estimado"): pelos dados fiscais guardados no custo manual com valor
 *      vazio; sem esses dados, entra pelo valor BRUTO, sem crédito, com tarja amarela
 *      `ITEM_SEM_DADOS_FISCAIS` (conservador: o preço sai alto, nunca baixo).
 * 3. Indústria normal sem IPI informado usa a tabela NCM → IPI; NCM vazio ou fora da tabela =
 *    sem crédito (tarja amarela `ITEM_SEM_NCM_IPI`, gerada por `calcularCusto`).
 */

import type { Aviso } from './avisos.js';
import { creditosDaCompra, decomporValorNota, type ItemCusto } from './calculo.js';
import type { DadosOmieProduto } from './coletaOmie.js';
import { custoDaCompraSemNota, resolverCustoItem, type CustoManual, type OrigemCusto } from './custoManual.js';
import { aliquotaIpiDoNcm, paraParametrosDoCalculo, type TabelaFiscal } from './parametrosFiscais.js';

/** De onde saíram as alíquotas dos créditos do item. */
export type FonteCreditos = 'NOTA_ENTRADA' | 'DADOS_MANUAIS' | 'SEM_DADOS_FISCAIS' | 'SEM_CUSTO';

export interface ItemCustoMontado extends ItemCusto {
  descricao: string | null;
  ncm: string | null;
  origem: OrigemCusto;
  fonteCreditos: FonteCreditos;
  /** Alíquotas usadas (fração): `aliquotaIpi = null` = sem NCM/IPI (sem crédito). */
  aliquotaIpi: number | null;
  aliquotaIcms: number | null;
  /** Nota usada nos créditos (número e data de entrada). */
  nota: { numeroNfe: string | null; data: string } | null;
  conflito: { valorManual: number; valorOmie: number; escolhido: 'MANUAL' | 'OMIE' } | null;
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
    const r = resolverCustoItem({
      codigo: folha.codigo,
      custoOmie: comp?.custoMedio ?? null,
      manualSalvo: entrada.manuaisSalvos.get(chave) ?? null,
      manualSimulacao: entrada.manuaisSimulacao?.get(chave) ?? null,
      escolhaConflito: entrada.escolhas?.[chave] ?? null,
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
      itens.push({ ...base, custoBrutoUnitario: null, custoLiquidoUnitario: null, fonteCreditos: 'SEM_CUSTO', aliquotaIpi: null, aliquotaIcms: null, nota: null });
      continue;
    }

    const nota = r.origem === 'OMIE' ? (comp?.ultimaNota ?? null) : null;
    if (nota !== null) {
      const aliquotaIpi = nota.aliquotaIpi / 100;
      const aliquotaIcms = nota.aliquotaIcms / 100;
      const compra = creditosDaCompra(decomporValorNota(r.valorUnitario, aliquotaIpi, aliquotaIcms), parametros.pisCofins);
      itens.push({
        ...base,
        custoBrutoUnitario: compra.valorBruto,
        custoLiquidoUnitario: compra.custoLiquido,
        fonteCreditos: 'NOTA_ENTRADA',
        aliquotaIpi,
        aliquotaIcms,
        nota: { numeroNfe: nota.numeroNfe, data: nota.data },
      });
      continue;
    }

    if (r.dadosFiscais !== null) {
      const c = custoDaCompraSemNota(r.valorUnitario, r.dadosFiscais, aliquotaIpiDoNcm(tabela, ncm), parametros.compra, parametros.pisCofins);
      itens.push({ ...base, custoBrutoUnitario: c.custoBrutoUnitario, custoLiquidoUnitario: c.custoLiquidoUnitario, fonteCreditos: 'DADOS_MANUAIS', aliquotaIpi: c.aliquotaIpi, aliquotaIcms: c.aliquotaIcms, nota: null });
      continue;
    }

    // Custo do Omie sem nota e sem dados fiscais: pelo bruto, sem crédito (explícito, nunca adivinhado).
    itens.push({ ...base, custoBrutoUnitario: r.valorUnitario, custoLiquidoUnitario: r.valorUnitario, fonteCreditos: 'SEM_DADOS_FISCAIS', aliquotaIpi: null, aliquotaIcms: null, nota: null });
    if (!semDadosAvisados.has(chave)) {
      semDadosAvisados.add(chave);
      avisos.push({
        nivel: 'AMARELO',
        codigo: 'ITEM_SEM_DADOS_FISCAIS',
        item: folha.codigo,
        mensagem: `Item ${folha.codigo} sem nota de entrada nos últimos meses e sem dados fiscais — entrou pelo valor bruto, sem crédito. Informe UF, tipo de fornecedor e IPI no custo manual do item ${folha.codigo} (o valor pode ficar vazio).`,
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
