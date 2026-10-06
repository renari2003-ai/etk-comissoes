import type { ResultadoFinanceiro } from './relatorioFinanceiro.js';

/** XLSX (Open XML + ZIP sem compressão), sem dependências adicionais. Texto é inlineStr,
 * nunca fórmula: nomes vindos da Omie não podem executar fórmulas ao abrir o Excel.
 */
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
type Celula = string | number | { valor: number; estilo: number };
const dataExcel = (d: string) => {
  const [dia, mes, ano] = d.split('/').map(Number);
  return (Date.UTC(ano!, mes! - 1, dia!) - Date.UTC(1899, 11, 30)) / 86400000;
};
const moeda = (valor: number): Celula => ({ valor, estilo: 1 });

function crc32(dados: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of dados) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(arquivos: Record<string, string>): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const nome = Buffer.from(caminho);
    const dados = Buffer.from(conteudo);
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // 01/01/1980
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    locais.push(local, nome, dados);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(offset, 42); centrais.push(central, nome);
    offset += local.length + nome.length + dados.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(Object.keys(arquivos).length, 8); fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(diretorio.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

export function gerarExcelFinanceiro(resultado: ResultadoFinanceiro, periodo: { dataDe: string; dataAte: string }, margemVisivel: boolean): Buffer {
  const cabecalho = ['Pedido', 'Cliente', 'Vendedor', 'Nota fiscal', 'Parcela', 'Data de recebimento', 'Valor recebido', 'Base de comissão recebida', 'Comissão %', 'Comissão a pagar', ...(margemVisivel ? ['Venda após despesas (%)'] : [])];
  const linhas: Celula[][] = [
    ['Financeiro / Comissão'], ['Período de recebimento', periodo.dataDe, periodo.dataAte],
    ['Comissão devida por recebimento; não comprova pagamento ao funcionário.'], cabecalho,
    ...resultado.linhas.map(l => [l.numeroPedido, l.nomeCliente ?? 'Não localizado', l.nomeVendedor ?? 'Não identificado',
      l.numeroNotaFiscal ?? 'Não informado', l.numeroParcela ?? '', { valor: dataExcel(l.dataRecebimento), estilo: 2 },
      moeda(l.valorRecebido), moeda(l.baseRecebida), l.comissaoPercentual, moeda(l.comissaoAPagar),
      ...(margemVisivel ? [l.detalhe.margemComissionamentoPercentual ?? ''] : [])]),
    ['TOTAL', '', '', '', '', '', moeda(resultado.resumo.valorRecebido), '', '', moeda(resultado.resumo.comissaoAPagar)],
    ...resultado.avisos.map(a => ['Aviso', a]),
  ];
  const coluna = (n: number): string => n < 26 ? String.fromCharCode(65 + n) : coluna(Math.floor(n / 26) - 1) + coluna(n % 26);
  const rows = linhas.map((linha, i) => `<row r="${i + 1}">${linha.map((c, j) => {
    const ref = `${coluna(j)}${i + 1}`;
    return typeof c === 'string' ? `<c r="${ref}" t="inlineStr"${i === 3 ? ' s="3"' : ''}><is><t xml:space="preserve">${xml(c)}</t></is></c>`
      : `<c r="${ref}"${typeof c === 'object' ? ` s="${c.estilo}"` : ''}><v>${typeof c === 'object' ? c.valor : c}</v></c>`;
  }).join('')}</row>`).join('');
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Financeiro Comissão" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="3" width="28" customWidth="1"/><col min="4" max="11" width="22" customWidth="1"/></cols><sheetData>${rows}</sheetData><autoFilter ref="A4:${coluna(cabecalho.length - 1)}${4 + resultado.linhas.length}"/></worksheet>`,
  });
}
