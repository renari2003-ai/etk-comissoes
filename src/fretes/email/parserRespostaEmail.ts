/**
 * Extração determinística da resposta de uma transportadora ao e-mail de cotação (Fase 2 da
 * migração n8n → backend). Função pura — sem rede, sem banco.
 *
 * Regras (nunca inventar dado):
 * - Lê só as linhas `CAMPO: valor` pedidas no e-mail (`CAMPOS_RESPOSTA`), no texto ESCRITO pela
 *   transportadora — a citação do e-mail original (que traz os mesmos rótulos vazios) é
 *   removida antes.
 * - Valor monetário só é aceito em formatos sem ambiguidade; qualquer dúvida → `null` e motivo
 *   de revisão (nunca "o mais provável").
 * - Nenhum imposto/encargo é aplicado aqui: o valor extraído é o frete base informado.
 */
import type { DadosExtracaoProposta } from '../tipos.js';

/** Referência gerada em `gerarCodigoReferencia`: `FRE-AAAA-NNNNNN-xxxxxxxx`. */
const REGEX_REFERENCIA = /\bFRE-\d{4}-\d{6}-[0-9a-f]{8}\b/gi;

export function extrairReferencias(texto: string): string[] {
  const achadas = texto.match(REGEX_REFERENCIA) ?? [];
  return [...new Set(achadas.map((r) => `FRE${r.slice(3).toLowerCase()}`))];
}

export type ResultadoValor = { tipo: 'OK'; valor: number } | { tipo: 'AMBIGUO'; bruto: string } | { tipo: 'AUSENTE' };

/**
 * Formatos aceitos (com ou sem "R$"):
 *   1500 · 1500,00 · 1500.00 · 1.500,00 · 1,500.00 · 1.500.000,00 · 1,500,000.00
 * Ambíguos (revisão manual): 1.500 · 1,500 · 1.500.000 · 1500.000 · misturas inválidas.
 */
export function interpretarValorMonetario(bruto: string | null | undefined): ResultadoValor {
  if (bruto === null || bruto === undefined) return { tipo: 'AUSENTE' };
  const texto = bruto.replace(/R\$/gi, '').replace(/\s+/g, '').trim();
  if (texto === '') return { tipo: 'AUSENTE' };
  const casos: [RegExp, (s: string) => string][] = [
    [/^\d+$/, (s) => s],
    [/^\d+,\d{1,2}$/, (s) => s.replace(',', '.')],
    [/^\d+\.\d{1,2}$/, (s) => s],
    [/^\d{1,3}(\.\d{3})+,\d{1,2}$/, (s) => s.replace(/\./g, '').replace(',', '.')],
    [/^\d{1,3}(,\d{3})+\.\d{1,2}$/, (s) => s.replace(/,/g, '')],
  ];
  for (const [regex, normalizar] of casos) {
    if (regex.test(texto)) {
      const valor = Number(normalizar(texto));
      if (Number.isFinite(valor) && valor >= 0) return { tipo: 'OK', valor };
    }
  }
  return { tipo: 'AMBIGUO', bruto: bruto.trim().slice(0, 60) };
}

/** DD/MM/AAAA ou AAAA-MM-DD (data real) → AAAA-MM-DD; qualquer outra coisa → `null`. */
export function interpretarValidade(bruto: string | null | undefined): string | null {
  if (bruto === null || bruto === undefined) return null;
  const texto = bruto.trim();
  let y: number;
  let m: number;
  let d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (r) {
    y = Number(r[1]);
    m = Number(r[2]);
    d = Number(r[3]);
  } else {
    r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
    if (!r) return null;
    d = Number(r[1]);
    m = Number(r[2]);
    y = Number(r[3]);
  }
  const data = new Date(Date.UTC(y, m - 1, d));
  if (data.getUTCFullYear() !== y || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return null;
  return `${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Remove a parte citada (mensagem original) de uma resposta: linhas iniciadas por ">" e tudo a
 * partir dos marcadores usuais de cliente de e-mail ("Em ... escreveu:", "On ... wrote:",
 * "-----Mensagem original-----", bloco "De:/From:" de Outlook).
 */
export function removerCitacao(texto: string): string {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  const marcadores = [
    /^\s*Em .{3,200}escreveu:\s*$/i,
    /^\s*On .{3,200}wrote:\s*$/i,
    /^\s*-{2,}\s*(Mensagem original|Original Message|Mensagem encaminhada|Forwarded message)\s*-{2,}\s*$/i,
    /^\s*(De|From):\s.+$/i,
    /^\s*_{10,}\s*$/,
  ];
  const resultado: string[] = [];
  for (const linha of linhas) {
    if (marcadores.some((m) => m.test(linha))) break;
    if (/^\s*>/.test(linha)) continue;
    resultado.push(linha);
  }
  return resultado.join('\n');
}

const ROTULOS = ['VALOR_FRETE', 'PRAZO_DIAS', 'VALIDADE', 'PEDAGIO', 'GRIS', 'AD_VALOREM', 'OBSERVACOES'] as const;
type Rotulo = (typeof ROTULOS)[number];

/** Lê `CAMPO: valor` por linha; OBSERVACOES pode continuar nas linhas seguintes até o próximo rótulo. */
function lerCampos(texto: string): Map<Rotulo, string[]> {
  const campos = new Map<Rotulo, string[]>();
  let atual: Rotulo | null = null;
  const regexRotulo = new RegExp(`^\\s*\\*?\\s*(${ROTULOS.join('|')})\\s*\\*?\\s*[:=]\\s*(.*)$`, 'i');
  for (const linha of texto.split('\n')) {
    const r = regexRotulo.exec(linha);
    if (r) {
      atual = (r[1] as string).toUpperCase() as Rotulo;
      const lista = campos.get(atual) ?? [];
      lista.push((r[2] ?? '').trim());
      campos.set(atual, lista);
      continue;
    }
    if (atual === 'OBSERVACOES' && linha.trim() !== '') {
      const lista = campos.get('OBSERVACOES') as string[];
      lista[lista.length - 1] = `${lista[lista.length - 1]}\n${linha.trim()}`.trim();
    } else if (linha.trim() === '') {
      atual = null;
    }
  }
  return campos;
}

/** Um rótulo repetido com valores diferentes é ambiguidade — nunca escolhe um deles. */
function valorUnico(campos: Map<Rotulo, string[]>, rotulo: Rotulo): { valor: string | null; conflito: boolean } {
  const preenchidos = [...new Set((campos.get(rotulo) ?? []).map((v) => v.trim()).filter((v) => v !== ''))];
  if (preenchidos.length > 1) return { valor: null, conflito: true };
  return { valor: preenchidos[0] ?? null, conflito: false };
}

export interface ResultadoExtracaoEmail {
  extracao: DadosExtracaoProposta;
  /** Motivos (curtos, sem dado sensível) que exigem revisão manual. Vazio = extração limpa. */
  problemas: string[];
}

export function extrairRespostaEmail(texto: string): ResultadoExtracaoEmail {
  const campos = lerCampos(removerCitacao(texto));
  const problemas: string[] = [];

  const brutoValor = valorUnico(campos, 'VALOR_FRETE');
  let valorFrete: number | null = null;
  if (brutoValor.conflito) problemas.push('VALOR_FRETE informado mais de uma vez com valores diferentes');
  else {
    const r = interpretarValorMonetario(brutoValor.valor);
    if (r.tipo === 'OK') valorFrete = r.valor;
    else if (r.tipo === 'AMBIGUO') problemas.push(`VALOR_FRETE ambíguo ou em formato inesperado ("${r.bruto}")`);
    else problemas.push('VALOR_FRETE ausente');
  }

  const monetarioOpcional = (rotulo: Rotulo): number | null => {
    const bruto = valorUnico(campos, rotulo);
    if (bruto.conflito) {
      problemas.push(`${rotulo} informado mais de uma vez com valores diferentes`);
      return null;
    }
    const r = interpretarValorMonetario(bruto.valor);
    if (r.tipo === 'AMBIGUO') problemas.push(`${rotulo} ambíguo ("${r.bruto}")`);
    return r.tipo === 'OK' ? r.valor : null;
  };

  const brutoPrazo = valorUnico(campos, 'PRAZO_DIAS');
  let prazoDias: number | null = null;
  if (brutoPrazo.valor !== null) {
    const r = /^(\d{1,3})(\s*(dias?|d\.?\s*[uú]teis|dias?\s*[uú]teis))?$/i.exec(brutoPrazo.valor);
    if (r) prazoDias = Number(r[1]);
    else problemas.push('PRAZO_DIAS em formato inesperado');
  }

  const brutoValidade = valorUnico(campos, 'VALIDADE');
  const validade = interpretarValidade(brutoValidade.valor);
  if (brutoValidade.valor !== null && validade === null) problemas.push('VALIDADE em formato inesperado (use DD/MM/AAAA ou AAAA-MM-DD)');

  const observacoes = valorUnico(campos, 'OBSERVACOES').valor;

  return {
    extracao: {
      valorFrete,
      prazoDias,
      validade,
      pedagio: monetarioOpcional('PEDAGIO'),
      gris: monetarioOpcional('GRIS'),
      adValorem: monetarioOpcional('AD_VALOREM'),
      taxas: null,
      observacoes: observacoes === null ? null : observacoes.slice(0, 4000),
      numeroProposta: null,
      confianca: null,
    },
    problemas,
  };
}
