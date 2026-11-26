/**
 * Notas de entrada (recebimento de NF-e) do Omie — `produtos/recebimentonfe` → `ListarRecebimentos`
 * com `cExibirDetalhes = "S"` (traz os itens). SOMENTE LEITURA. Funções puras de interpretação.
 *
 * Campos conferidos na documentação pública do Omie em 26/11/2026:
 * - `infoCadastro.cRecebido = "S"` = recebimento concluído; `infoCadastro.cCancelada = "S"` = cancelado.
 * - `cabec`: `nIdReceb`, `nIdFornecedor`, `cNumeroNFe`, `dEmissaoNFe` (dd/mm/aaaa), `cModeloNFe`.
 * - `infoAdicionais.dRegistro` (dd/mm/aaaa) = data de entrada.
 * - itens: `itensRecebimento[].itensCabec` (`nIdProduto`, `nQtdeNFe`, `nPrecoUnit`, `vTotalItem`),
 *   `itensICMS` (`nAliq`, `nValor`), `itensICMSSN` (`nAliqSN`, `nValorSN`), `itensIPI`
 *   (`nAliqIPI`, `nValIPI`), `itensICMSST` (`nValorST`).
 * A nota NÃO traz a UF do fornecedor (vem do cadastro dele: `nIdFornecedor` → ConsultarCliente).
 *
 * Regra (decisão de 26/11/2026): fica a nota MAIS RECENTE de cada produto dentro da janela
 * consultada (6 meses). Se o item dessa nota mais recente tem alíquota ilegível, o produto fica SEM
 * nota ("estimado") — nunca vira imposto 0 em silêncio nem volta para uma nota mais antiga.
 */

/** Item de nota de entrada, já reduzido ao que a precificação usa (é o que vai para o cache). */
export interface ItemNotaEntrada {
  idProduto: number;
  idRecebimento: number;
  idFornecedor: number | null;
  numeroNfe: string | null;
  /** aaaa-mm-dd: data de entrada (`dRegistro`), ou a de emissão quando não houver. */
  data: string;
  quantidade: number;
  /** Valor unitário dos produtos, sem IPI (`nPrecoUnit`). */
  precoUnitario: number;
  /** Alíquotas destacadas, em PONTOS (12 = 12%). ICMS do Simples (`nAliqSN`) conta como ICMS. */
  aliquotaIcms: number;
  aliquotaIpi: number;
  /** Há ICMS-ST no item? (só informativo: a ST não entra na regra de créditos da spec). */
  temIcmsSt: boolean;
  /** Alíquotas legíveis? `false` = o item conta como nota mais recente, mas tira o produto do mapa (fica "estimado"). */
  legivel: boolean;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && /^-?\d+(\.\d+)?$/.test(valor.trim())) return Number(valor.trim());
  return null;
}

function inteiroPositivo(valor: unknown): number | null {
  const n = numero(valor);
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

/** dd/mm/aaaa → aaaa-mm-dd (comparável como texto); `null` se ilegível. */
export function dataOmieParaIso(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (m === null) return null;
  const [, dia, mes, ano] = m;
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  if (d.getUTCFullYear() !== Number(ano) || d.getUTCMonth() !== Number(mes) - 1 || d.getUTCDate() !== Number(dia)) return null;
  return `${ano}-${mes}-${dia}`;
}

/** aaaa-mm-dd → dd/mm/aaaa (formato dos filtros do Omie). */
export function dataIsoParaOmie(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) throw new Error(`Data inválida: ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Alíquota em pontos de 0 a 100 (exclusive); ausente = 0 só quando o bloco do imposto não existe. */
function aliquota(bloco: Record<string, unknown> | null, campo: string): number | null {
  if (bloco === null) return 0;
  const bruto = bloco[campo];
  if (bruto === undefined || bruto === null || bruto === '') return 0;
  const n = numero(bruto);
  return n !== null && n >= 0 && n < 100 ? n : null;
}

/**
 * Itens das notas CONCLUÍDAS e não canceladas de uma página de `ListarRecebimentos`. Só modelo 55
 * (NF-e) quando o modelo vem informado — CT-e (57/67) não é compra de material.
 */
export function itensDosRecebimentos(recebimentos: unknown): ItemNotaEntrada[] {
  if (!Array.isArray(recebimentos)) return [];
  const saida: ItemNotaEntrada[] = [];
  for (const bruto of recebimentos) {
    const r = objeto(bruto);
    if (r === null) continue;
    const cabec = objeto(r.cabec);
    const info = objeto(r.infoCadastro);
    if (cabec === null || info === null) continue;
    if (info.cRecebido !== 'S' || info.cCancelada === 'S') continue;
    const modelo = typeof cabec.cModeloNFe === 'string' ? cabec.cModeloNFe.trim() : '';
    if (modelo !== '' && modelo !== '55') continue;
    const idRecebimento = inteiroPositivo(cabec.nIdReceb);
    if (idRecebimento === null) continue;
    const adicionais = objeto(r.infoAdicionais);
    const data = dataOmieParaIso(adicionais?.dRegistro) ?? dataOmieParaIso(cabec.dEmissaoNFe);
    if (data === null) continue;
    const itens = Array.isArray(r.itensRecebimento) ? r.itensRecebimento : [];
    for (const itemBruto of itens) {
      const item = objeto(itemBruto);
      const ic = objeto(item?.itensCabec);
      if (item === null || ic === null) continue;
      const idProduto = inteiroPositivo(ic.nIdProduto);
      const quantidade = numero(ic.nQtdeNFe);
      const precoUnitario = numero(ic.nPrecoUnit);
      if (idProduto === null || quantidade === null || quantidade <= 0 || precoUnitario === null || precoUnitario <= 0) continue;
      const icms = objeto(item.itensICMS);
      const icmsSn = objeto(item.itensICMSSN);
      const ipi = objeto(item.itensIPI);
      const aliqIcms = aliquota(icms, 'nAliq');
      const aliqIcmsSn = aliquota(icmsSn, 'nAliqSN');
      const aliqIpi = aliquota(ipi, 'nAliqIPI');
      // Alíquota ilegível: o item fica marcado (se for a nota mais recente, o produto entra como estimado), nunca como 0.
      const legivel = aliqIcms !== null && aliqIcmsSn !== null && aliqIpi !== null;
      const st = objeto(item.itensICMSST);
      saida.push({
        idProduto,
        idRecebimento,
        idFornecedor: inteiroPositivo(cabec.nIdFornecedor),
        numeroNfe: typeof cabec.cNumeroNFe === 'string' && cabec.cNumeroNFe.trim() !== '' ? cabec.cNumeroNFe.trim() : null,
        data,
        quantidade,
        precoUnitario,
        aliquotaIcms: !legivel ? 0 : aliqIcms! > 0 ? aliqIcms! : aliqIcmsSn!,
        aliquotaIpi: !legivel ? 0 : aliqIpi!,
        temIcmsSt: (numero(st?.nValorST) ?? 0) > 0,
        legivel,
      });
    }
  }
  return saida;
}

/**
 * A nota mais recente de cada produto (empate de data: o maior id de recebimento). Se ela está
 * ilegível, o produto sai do mapa (fica "estimado") — nunca usa uma nota mais antiga no lugar.
 */
export function ultimaNotaPorProduto(itens: readonly ItemNotaEntrada[]): Map<number, ItemNotaEntrada> {
  const mapa = new Map<number, ItemNotaEntrada>();
  for (const item of itens) {
    const atual = mapa.get(item.idProduto);
    if (atual === undefined || item.data > atual.data || (item.data === atual.data && item.idRecebimento > atual.idRecebimento)) {
      mapa.set(item.idProduto, item);
    }
  }
  for (const [id, item] of mapa) if (item.legivel === false) mapa.delete(id);
  return mapa;
}

/** Janela de busca: de (hoje − meses) até hoje, em aaaa-mm-dd (fuso de São Paulo). */
export function janelaDeMeses(hojeIso: string, meses: number): { de: string; ate: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hojeIso);
  if (m === null) throw new Error(`Data inválida: ${hojeIso}`);
  const ano = Number(m[1]);
  const mes = Number(m[2]) - 1 - meses;
  const dia = Number(m[3]);
  // Dia que não existe no mês de destino (ex.: 31/08 − 6 meses) recua para o último dia dele.
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const inicio = new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDia)));
  return { de: inicio.toISOString().slice(0, 10), ate: hojeIso };
}
