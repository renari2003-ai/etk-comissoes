/**
 * Template do e-mail de solicitação de cotação — portado do nó "Compor Email Cotacao" do
 * workflow n8n "ETK - Homologação Cotação Frete" (backup em `n8n Backup/Workflows`), mantendo
 * assunto, layout, linhas e campos de resposta. Função pura: recebe o MESMO payload v1 que ia
 * para o n8n (`PayloadSolicitacaoN8n`), que por contrato só tem dado logístico — nenhum campo
 * comercial (margem, custo, markup, valor de venda) chega aqui.
 */
import type { PayloadSolicitacaoN8n } from '../integracoes/n8nCliente.js';

export interface EmailCotacao {
  assunto: string;
  html: string;
  texto: string;
}

/** Assunto fixo — a referência nele é a chave de correlação da resposta (não alterar o formato). */
export function assuntoCotacao(referencia: string): string {
  return `Cotação de Frete ETK | ${referencia}`;
}

/** Campos que a transportadora devolve na resposta (lidos pelo extrator de respostas). */
export const CAMPOS_RESPOSTA = ['VALOR_FRETE', 'PRAZO_DIAS', 'VALIDADE', 'PEDAGIO', 'GRIS', 'AD_VALOREM', 'OBSERVACOES'] as const;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtN = (n: number): string => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtM = (n: number): string => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

function fmtCep(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : v;
}

function fmtCnpj(v: string | null): string | null {
  if (v === null) return null;
  const d = v.replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v;
}

function local(cidade: string | null, cep: string | null): string | null {
  const c = cidade !== null && cidade.trim() !== '' ? cidade : null;
  const z = cep !== null && cep.trim() !== '' ? cep : null;
  if (c === null && z === null) return null;
  return [c, z !== null ? `CEP ${fmtCep(z)}` : null].filter(Boolean).join(' - ');
}

/**
 * Linhas "rótulo: valor" da cotação, já filtradas (sem vazios) — fonte única para o e-mail e
 * para o WhatsApp (`src/fretes/whatsapp/mensagemCotacao.ts`).
 */
export function linhasDadosCotacao(payload: PayloadSolicitacaoN8n): [string, string][] {
  const L = payload.logistica;
  const ref = payload.referencia;

  const pesoT = L.pesoBruto ?? L.peso;
  const pesoL = L.pesoLiquido;
  // Uma linha por tipo de embalagem, medidas exatamente como informadas (metros).
  const embalagens = L.embalagens.map(
    (e) => `Quantidade: ${fmtN(e.quantidade)} | Medidas: ${fmtM(e.comprimento)} x ${fmtM(e.largura)} x ${fmtM(e.altura)} m (C x L x A)`,
  );
  const somaQtd = L.embalagens.length > 0 ? L.embalagens.reduce((soma, e) => soma + e.quantidade, 0) : null;
  const volTotal = L.volumes ?? somaQtd;

  const linhas: [string, string | null][] = [
    ['Referência', ref],
    ['Origem', local(L.origem, L.cepOrigem)],
    ['CNPJ Origem', fmtCnpj(L.cnpjOrigem)],
    ['Destino', local(L.destino, L.cepDestino)],
    ['CNPJ Destino', fmtCnpj(L.cnpjDestino)],
    ['Modalidade', L.modalidade],
    [
      'Peso total',
      pesoT === null ? null : `${fmtN(pesoT)} kg${pesoL !== null && pesoL !== pesoT ? ` (líquido: ${fmtN(pesoL)} kg)` : ''}`,
    ],
    ['Total de volumes', volTotal === null ? null : `${fmtN(volTotal)}${L.especie ? ` (${L.especie})` : ''}`],
    ['Embalagens', embalagens.length > 0 ? embalagens.join('\n') : null],
    ['Observações', L.observacoes],
  ];
  return linhas.filter((r): r is [string, string] => r[1] !== null && r[1].trim() !== '');
}

export function montarEmailCotacao(payload: PayloadSolicitacaoN8n): EmailCotacao {
  const ref = payload.referencia;
  const rows = linhasDadosCotacao(payload);

  const td = 'padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;vertical-align:top;';
  const cell = (label: string, value: string): string => {
    let v = esc(value).replace(/\n/g, '<br>');
    if (label === 'Observações' && /\bTDE\b/i.test(value)) v = `<span style="background:#fff4d6;padding:2px 4px;font-weight:bold;">${v}</span>`;
    return `<tr><td style="${td}color:#555555;width:190px;">${label}</td><td style="${td}color:#111111;font-weight:bold;">${v}</td></tr>`;
  };

  const html =
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f5f7;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;color:#111111;">' +
    '<tr><td style="background:#1f3a5f;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold;">Cotação de Frete ETK</td></tr>' +
    '<tr><td style="padding:24px;font-size:14px;line-height:1.5;">' +
    '<p style="margin:0 0 12px 0;">Olá,</p>' +
    '<p style="margin:0 0 20px 0;">A ETK Indústria e Comércio solicita a gentileza de nos enviar sua cotação de frete para a operação abaixo.</p>' +
    '<p style="margin:0 0 8px 0;font-size:13px;font-weight:bold;letter-spacing:0.5px;color:#1f3a5f;">DADOS DA COTAÇÃO</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-collapse:collapse;margin:0 0 24px 0;">' +
    rows.map((r) => cell(r[0], r[1])).join('') +
    '</table>' +
    '<p style="margin:0 0 8px 0;">Por favor, responda este e-mail informando:</p>' +
    '<div style="background:#f7f7f9;border:1px solid #e5e7eb;padding:12px 16px;margin:0 0 24px 0;font-family:Consolas,Menlo,Courier New,monospace;font-size:14px;line-height:1.7;">' +
    CAMPOS_RESPOSTA.map((c) => `${c}:`).join('<br>') +
    '</div>' +
    '<p style="margin:0 0 20px 0;">Aguardamos seu retorno.</p>' +
    '<p style="margin:0;">Atenciosamente,<br><strong>ETK Indústria e Comércio</strong><br>Setor de Fretes</p>' +
    '</td></tr></table></td></tr></table></body></html>';

  const texto =
    'Olá,\n\nA ETK Indústria e Comércio solicita a gentileza de nos enviar sua cotação de frete para a operação abaixo.\n\nDADOS DA COTAÇÃO\n\n' +
    rows.map((r) => `${r[0]}: ${r[1]}`).join('\n') +
    '\n\nPor favor, responda este e-mail informando:\n\n' +
    CAMPOS_RESPOSTA.map((c) => `${c}:`).join('\n') +
    '\n\nAguardamos seu retorno.\n\nAtenciosamente,\nETK Indústria e Comércio\nSetor de Fretes';

  return { assunto: assuntoCotacao(ref), html, texto };
}
