import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cotarNaBraspress, type EntradaCotacaoBraspress } from '../../src/fretes/integracoes/braspressCliente.js';

// UX do detalhe da cotação: busca + seleção de transportadoras, dados da carga, várias
// embalagens e um único botão de envio (Braspress entra no mesmo fluxo).
describe('tela de detalhe da cotação', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const codigo = readFileSync('public-src/fretes.ts', 'utf8');
  const inicioSecao = html.indexOf('id="fretes-detalhe-solicitacoes-secao"');
  const secao = html.slice(inicioSecao, html.indexOf('id="fretes-detalhe-form-secao"'));

  it('busca no lugar da lista de todas as transportadoras; ordem: busca → selecionadas → carga → embalagens → envio', () => {
    expect(secao).toContain('Transportadoras para solicitar cotação');
    expect(secao).toContain('Buscar por nome, razão social, nome fantasia ou CNPJ...');
    expect(html).not.toContain('id="fretes-solicitacoes-checkboxes"');
    expect(codigo).not.toContain('renderizarCheckboxesSolicitacao');
    const ordem = ['fretes-busca-transportadora"', 'Transportadoras selecionadas', 'Dados da carga', 'Embalagens', 'fretes-botao-enviar-solicitacoes'].map((m) =>
      secao.indexOf(m),
    );
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(codigo).toContain('/api/fretes/transportadoras/buscar?q=');
  });

  it('seleção: sem duplicidade, no máximo 7, remover; canal único automático, vários exigem escolha', () => {
    expect(codigo).toContain('const LIMITE_TRANSPORTADORAS_SELECIONADAS = 7;');
    expect(codigo).toContain("if (selecionadas.some((s) => s.id === t.id)) return 'Já selecionada';");
    expect(codigo).toContain('if (selecionadas.length >= LIMITE_TRANSPORTADORAS_SELECIONADAS)');
    expect(codigo).toContain('selecionadas = selecionadas.filter((s) => s.id !== id);');
    expect(codigo).toContain('canal: t.canalSugerido');
    expect(codigo).toContain('Escolha o canal...');
    expect(codigo).toContain('${nome}: escolha o canal de envio.');
  });

  it('um único botão de envio; "Cotar Braspress" separado removido; conferência por transportadora/canal', () => {
    expect(html).not.toContain('Cotar Braspress');
    expect(html).not.toContain('fretes-braspress-secao');
    expect(html).not.toContain('id="fretes-botao-solicitar-cotacao"');
    expect(codigo).not.toContain('/cotar-braspress');
    expect(codigo).toContain('/enviar-solicitacoes');
    expect(codigo).toContain('✓ Dados da carga completos');
    expect(codigo).toContain('${nome}: informe as dimensões da carga.');
    expect(codigo).toContain('Enviar solicitação para ${quantidade} transportadoras');
  });

  it('lista de embalagens com "+ Adicionar embalagem" e TOTAL DE VOLUMES', () => {
    expect(secao).not.toContain('id="fretes-braspress-altura"');
    expect(secao).toContain('id="fretes-embalagens"');
    expect(secao).toContain('+ Adicionar embalagem');
    expect(secao).toContain('TOTAL DE VOLUMES');
    expect(secao).toContain('id="fretes-embalagens-total-volumes"');
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
