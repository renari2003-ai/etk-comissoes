import { describe, expect, it } from 'vitest';
import { assuntoCotacao, montarEmailCotacao } from '../../../src/fretes/email/templateCotacao.js';
import type { PayloadSolicitacaoN8n } from '../../../src/fretes/integracoes/n8nCliente.js';

// Template do e-mail de cotação (portado do n8n) — função pura, sem rede nem banco.

function payload(logistica: Partial<PayloadSolicitacaoN8n['logistica']> = {}): PayloadSolicitacaoN8n {
  return {
    versao: 1,
    evento: 'SOLICITACAO_COTACAO',
    solicitacaoId: 'sol-1',
    referencia: 'FRE-2026-000123-abcd1234',
    cotacaoId: 'cot-1',
    transportadora: { id: 'tr-1', email: 'cotacao@transportadora.com.br', fonteEmail: 'CADASTRO', whatsapp: null },
    canal: 'EMAIL',
    logistica: {
      origem: 'São Paulo/SP',
      destino: 'Curitiba/PR',
      cepOrigem: '01000000',
      cepDestino: '80000-000',
      pesoBruto: 120.5,
      pesoLiquido: 110,
      peso: 120.5,
      volumes: 8,
      especie: 'CAIXA',
      cnpjOrigem: '11222333000181',
      cnpjDestino: '44555666000181',
      modalidade: 'CIF',
      observacoes: 'Cobrar TDE no destino.\nEntrega agendada.',
      embalagens: [
        { altura: 0.27, largura: 0.36, comprimento: 0.77, quantidade: 6 },
        { altura: 1.2, largura: 0.8, comprimento: 1, quantidade: 2 },
      ],
      ...logistica,
    },
  };
}

describe('template do e-mail de cotação', () => {
  it('assunto mantém o formato de correlação com a referência', () => {
    expect(montarEmailCotacao(payload()).assunto).toBe('Cotação de Frete ETK | FRE-2026-000123-abcd1234');
    expect(assuntoCotacao('X')).toBe('Cotação de Frete ETK | X');
  });

  it('contém referência, origem/destino com CEP, CNPJs formatados, modalidade, peso e total de volumes', () => {
    const { texto, html } = montarEmailCotacao(payload());
    expect(texto).toContain('Referência: FRE-2026-000123-abcd1234');
    expect(texto).toContain('Origem: São Paulo/SP - CEP 01000-000');
    expect(texto).toContain('CNPJ Origem: 11.222.333/0001-81');
    expect(texto).toContain('Destino: Curitiba/PR - CEP 80000-000');
    expect(texto).toContain('CNPJ Destino: 44.555.666/0001-81');
    expect(texto).toContain('Modalidade: CIF');
    expect(texto).toContain('Peso total: 120,5 kg (líquido: 110 kg)');
    expect(texto).toContain('Total de volumes: 8 (CAIXA)');
    expect(html).toContain('DADOS DA COTAÇÃO');
    for (const campo of ['VALOR_FRETE:', 'PRAZO_DIAS:', 'VALIDADE:', 'PEDAGIO:', 'GRIS:', 'AD_VALOREM:', 'OBSERVACOES:']) {
      expect(texto).toContain(campo);
      expect(html).toContain(campo);
    }
  });

  it('uma linha por tipo de embalagem, medidas como informadas (m), no texto e no HTML', () => {
    const { texto, html } = montarEmailCotacao(payload());
    expect(texto).toContain('Embalagens: Quantidade: 6 | Medidas: 0,77 x 0,36 x 0,27 m (C x L x A)\nQuantidade: 2 | Medidas: 1,00 x 0,80 x 1,20 m (C x L x A)');
    expect(html).toContain('Quantidade: 6 | Medidas: 0,77 x 0,36 x 0,27 m (C x L x A)<br>Quantidade: 2 | Medidas: 1,00 x 0,80 x 1,20 m (C x L x A)');
  });

  it('sem embalagens nem total na cotação: linha de embalagens omitida; total = soma quando só há embalagens', () => {
    expect(montarEmailCotacao(payload({ embalagens: [] })).texto).not.toContain('Embalagens:');
    expect(montarEmailCotacao(payload({ volumes: null })).texto).toContain('Total de volumes: 8 (CAIXA)');
  });

  it('observações multilinha preservadas e TDE destacado; HTML escapado', () => {
    const { texto, html } = montarEmailCotacao(payload({ observacoes: 'Cobrar TDE <urgente> & "frágil"\nEntrega agendada.' }));
    expect(texto).toContain('Observações: Cobrar TDE <urgente> & "frágil"\nEntrega agendada.');
    expect(html).toContain('background:#fff4d6');
    expect(html).toContain('Cobrar TDE &lt;urgente&gt; &amp; &quot;frágil&quot;<br>Entrega agendada.');
    expect(html).not.toContain('<urgente>');
  });

  it('nenhum dado comercial interno no e-mail', () => {
    const { texto, html } = montarEmailCotacao(payload());
    const tudo = `${texto} ${html}`.toLowerCase();
    for (const proibido of ['margem', 'markup', 'comiss', 'custo', 'valor de venda', 'valor da mercadoria']) expect(tudo).not.toContain(proibido);
  });
});
