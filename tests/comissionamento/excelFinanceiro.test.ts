import { describe, expect, it } from 'vitest';
import { gerarExcelFinanceiro } from '../../src/comissionamento/excelFinanceiro.js';
import { gerarRelatorioFinanceiro } from '../../src/comissionamento/relatorioFinanceiro.js';
import { baixaFinanceiro, clienteFinanceiro } from './financeiroFixture.js';

// Leitura dos arquivos locais do ZIP (método stored) para conferir o contrato Open XML.
function arquivosDoZip(zip: Buffer): Map<string, string> {
  const arquivos = new Map<string, string>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const tamanho = zip.readUInt32LE(offset + 18);
    const nomeLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const nome = zip.subarray(offset + 30, offset + 30 + nomeLen).toString();
    const inicio = offset + 30 + nomeLen + extraLen;
    arquivos.set(nome, zip.subarray(inicio, inicio + tamanho).toString());
    offset = inicio + tamanho;
  }
  expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
  return arquivos;
}

describe('Excel Financeiro / Comissão', () => {
  const periodo = { dataDe: '01/09/2026', dataAte: '30/09/2026' };
  it('gera pacote XLSX com NF textual, data/valores numéricos e totais iguais à tela', async () => {
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([baixaFinanceiro()]), periodo);
    const arquivos = arquivosDoZip(gerarExcelFinanceiro(resultado, periodo, true));
    expect(arquivos.size).toBe(6);
    expect(arquivos.get('[Content_Types].xml')).toContain('spreadsheetml.sheet.main+xml');
    const planilha = arquivos.get('xl/worksheets/sheet1.xml')!;
    expect(planilha).toContain('<c r="D5" t="inlineStr"><is><t xml:space="preserve">00025739</t>');
    expect(planilha).toMatch(/<c r="F5" s="2"><v>\d+<\/v>/);
    expect(planilha).toContain('<c r="G5" s="1"><v>500</v>');
    expect(planilha).toContain('<c r="J6" s="1"><v>15</v>');
  });
  it('não exporta margem restrita e trata texto parecido com fórmula como texto literal', async () => {
    const resultado = await gerarRelatorioFinanceiro(clienteFinanceiro([baixaFinanceiro()]), periodo);
    resultado.linhas[0]!.nomeCliente = '=HYPERLINK("https://example.com") & <cliente>';
    const planilha = arquivosDoZip(gerarExcelFinanceiro(resultado, periodo, false)).get('xl/worksheets/sheet1.xml')!;
    expect(planilha).not.toContain('Venda após despesas (%)');
    expect(planilha).not.toContain('Margem de comissionamento');
    expect(planilha).not.toContain('<f>');
    // Administrador: mesma coluna, com o rótulo novo.
    const planilhaAdmin = arquivosDoZip(gerarExcelFinanceiro(resultado, periodo, true)).get('xl/worksheets/sheet1.xml')!;
    expect(planilhaAdmin).toContain('<t xml:space="preserve">Venda após despesas (%)</t>');
    expect(planilhaAdmin).not.toContain('Margem de comissionamento');
    expect(planilha).toContain('=HYPERLINK(&quot;https://example.com&quot;) &amp; &lt;cliente&gt;');
  });
});
