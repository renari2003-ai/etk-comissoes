import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cotarNaBraspress, type EntradaCotacaoBraspress } from '../../src/fretes/integracoes/braspressCliente.js';

// UX do detalhe da cotação: seção de transportadoras renomeada e várias embalagens na cotação Braspress.
describe('tela de detalhe da cotação', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const codigo = readFileSync('public-src/fretes.ts', 'utf8');
  const secaoBraspress = html.slice(html.indexOf('id="fretes-braspress-secao"'), html.indexOf('</section>', html.indexOf('id="fretes-braspress-secao"')));

  it('seção renomeada para "Transportadoras para solicitar cotação" mantendo a lista e o botão existentes', () => {
    expect(html).toContain('Transportadoras para solicitar cotação');
    expect(html).toContain('id="fretes-solicitacoes-checkboxes"');
    expect(html).toContain('id="fretes-botao-solicitar-cotacao"');
  });

  it('entrada única de dimensões substituída por lista de embalagens com "+ Adicionar embalagem" e total de volumes', () => {
    expect(secaoBraspress).not.toContain('id="fretes-braspress-altura"');
    expect(secaoBraspress).not.toContain('id="fretes-braspress-volumes"');
    expect(secaoBraspress).toContain('id="fretes-braspress-embalagens"');
    expect(secaoBraspress).toContain('+ Adicionar embalagem');
    expect(secaoBraspress).toContain('id="fretes-braspress-total-volumes"');
  });

  it('cada linha tem altura, largura, comprimento, quantidade e remover; valida medidas > 0 e quantidade >= 1', () => {
    for (const rotulo of ['Altura (m)', 'Largura (m)', 'Comprimento (m)', 'Quantidade', 'Remover']) expect(codigo).toContain(rotulo);
    expect(codigo).toContain('altura, largura e comprimento devem ser maiores que zero');
    expect(codigo).toContain('quantidade deve ser um número inteiro maior ou igual a 1');
    expect(codigo).toContain('cubagem: embalagens.length > 0 ? embalagens : null');
  });
});

describe('Braspress com várias embalagens', () => {
  it('envia todas as linhas de cubagem no corpo da requisição', async () => {
    const cubagem = [
      { altura: 0.5, largura: 0.4, comprimento: 0.6, volumes: 3 },
      { altura: 1.2, largura: 0.8, comprimento: 1, volumes: 2 },
    ];
    const entrada: EntradaCotacaoBraspress = {
      cnpjDestinatario: '44.555.666/0001-81',
      cepOrigem: '01000-000',
      cepDestino: '80000-000',
      valorMercadoria: 5000,
      peso: 100,
      volumes: 5,
      tipoFrete: 'CIF',
      cubagem,
    };
    let corpoEnviado: unknown = null;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      corpoEnviado = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ id: 1, prazo: 3, totalFrete: 10 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    await cotarNaBraspress(entrada, {
      cnpj: '11222333000181',
      senha: 'senha-de-teste-nao-e-real',
      url: 'https://exemplo.invalido/cotar',
      timeoutMs: 200,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect((corpoEnviado as { cubagem: unknown }).cubagem).toEqual(cubagem);
  });
});
