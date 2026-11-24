import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OmieError } from '../../src/omie/erros.js';
import {
  diagnosticarCusto,
  interpretarValorRelatorio,
  MAX_COMPONENTES_DIAGNOSTICO,
  validarCodigoProduto,
  type ClienteOmieDiagnosticoCusto,
} from '../../src/precificacao/diagnosticoCusto.js';
import { criarRotaPrecificacaoDiagnostico } from '../../src/rotas/precificacaoDiagnostico.js';
import { tratadorDeErros } from '../../src/rotas/erroHttp.js';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { ErroValidacao } from '../../src/validacao.js';

function clienteFalso(sobrescrever: Partial<ClienteOmieDiagnosticoCusto & { chamadas: string[] }> = {}): ClienteOmieDiagnosticoCusto & { chamadas: string[] } {
  const chamadas: string[] = [];
  const estoquePorId: Record<number, Record<string, unknown>> = {
    1: { nCodProd: 1, nCMC: 900, nSaldo: 3 },
    10: { nCodProd: 10, nCMC: 0.192111, nSaldo: 5000 },
    20: { nCodProd: 20, nCMC: 17.06279, nPrecoUnitario: 20 },
    30: { nCodProd: 30, nCMC: 5.238053 },
    40: { nCodProd: 40, nSaldo: 0 },
  };
  return {
    chamadas,
    async consultarEstrutura(cod) {
      chamadas.push(`estrutura:${cod}`);
      return {
        ident: { idProduto: 1, codProduto: cod },
        custoProducao: { vMOD: 0, vGGF: 59.76 },
        itens: [
          { codProdMalha: 'PI10000014', idProdMalha: 10, quantProdMalha: 1 },
          { codProdMalha: 'MP00000008', idProdMalha: 20, quantProdMalha: 0.5 },
          { codProdMalha: 'MO00000013', idProdMalha: 30, quantProdMalha: 1 },
          { codProdMalha: 'MO00000037', idProdMalha: 40, quantProdMalha: 1 },
          { codProdMalha: 'MP00000045', idProdMalha: 50, quantProdMalha: 1 },
        ],
      };
    },
    async consultarDadosProducao(id) {
      chamadas.push(`dadosProducao:${id}`);
      return { nValorMOD: 0, nValorGGF: 59.76 };
    },
    async consultarProduto(id) {
      chamadas.push(`produto:${id}`);
      return { codigo_produto: id, valor_unitario: 99 };
    },
    async obterEstoqueProduto(id) {
      chamadas.push(`estoque:${id}`);
      const registro = estoquePorId[id];
      return { listaEstoque: registro === undefined ? [] : [registro] };
    },
    ...sobrescrever,
  };
}

describe('diagnóstico de custo (rota temporária) — conferência com o relatório da Omie', () => {
  it('aponta de qual campo sai cada valor do relatório do PA00000001', async () => {
    const r = await diagnosticarCusto(clienteFalso(), 'PA00000001', '24/11/2026');
    const porRotulo = Object.fromEntries((r.conferencia ?? []).map((c) => [c.rotulo, c]));

    expect(porRotulo['Valor GGF']!.confere.map((c) => `${c.origem}.${c.campo}`)).toEqual([
      'ConsultarEstrutura.custoProducao.vGGF',
      'ConsultarDadosProducao.nValorGGF',
    ]);
    expect(porRotulo.PI10000014!.confere).toEqual([{ origem: 'ListarPosEstoque', campo: 'nCMC', valor: 0.192111 }]);
    expect(porRotulo.MP00000008!.confere).toEqual([{ origem: 'ListarPosEstoque', campo: 'nCMC', valor: 17.06279 }]);
    expect(porRotulo.MO00000013!.confere).toEqual([{ origem: 'ListarPosEstoque', campo: 'nCMC', valor: 5.238053 }]);
  });

  it('itens sem custo unitário no relatório são sinalizados, com o que a API trouxe', async () => {
    const r = await diagnosticarCusto(clienteFalso(), 'PA00000001', '24/11/2026');
    const mo37 = r.conferencia!.find((c) => c.rotulo === 'MO00000037')!;
    const mp45 = r.conferencia!.find((c) => c.rotulo === 'MP00000045')!;
    expect(mo37.observacao).toContain('a API também não traz campo de custo');
    expect(mp45.observacao).toContain('a API também não traz campo de custo');
    expect(r.componentes.find((c) => c.codProdMalha === 'MP00000045')!.erros).toContain('Componente não aparece na posição de estoque.');
  });

  it('não confunde valores próximos: a tolerância é meia unidade da última casa do relatório', () => {
    const mp08 = interpretarValorRelatorio('17,06279');
    expect(mp08.valor).toBe(17.06279);
    expect(mp08.tolerancia).toBeCloseTo(0.000005, 10);
    expect(interpretarValorRelatorio('59,76').tolerancia).toBeCloseTo(0.005, 10);
  });

  it('falha em ConsultarDadosProducao não derruba o diagnóstico — o erro aparece na resposta', async () => {
    const cliente = clienteFalso({
      async consultarDadosProducao() {
        throw new OmieError('método indisponível');
      },
    });
    const r = await diagnosticarCusto(cliente, 'PA00000001', '24/11/2026');
    expect(r.dadosProducao).toEqual({ erro: 'método indisponível' });
    expect(r.conferencia![0]!.confere.map((c) => c.campo)).toEqual(['vGGF']);
  });

  it('produto sem referência do relatório devolve os dados sem conferência', async () => {
    const r = await diagnosticarCusto(clienteFalso(), 'PA99999999', '24/11/2026');
    expect(r.conferencia).toBeNull();
    expect(r.componentes).toHaveLength(5);
  });

  it('só faz chamadas de consulta (nunca escrita) à Omie', async () => {
    const cliente = clienteFalso();
    await diagnosticarCusto(cliente, 'PA00000001', '24/11/2026');
    expect(cliente.chamadas.every((c) => /^(estrutura|dadosProducao|produto|estoque):/.test(c))).toBe(true);
  });

  it('aceita números enviados como texto pela Omie (ex.: nCMC: "17.06279")', async () => {
    const cliente = clienteFalso({
      async obterEstoqueProduto(id) {
        return { listaEstoque: id === 20 ? [{ nCodProd: 20, nCMC: '17.06279' }] : [] };
      },
    });
    const r = await diagnosticarCusto(cliente, 'PA00000001', '24/11/2026');
    expect(r.conferencia!.find((c) => c.rotulo === 'MP00000008')!.confere).toEqual([
      { origem: 'ListarPosEstoque', campo: 'nCMC', valor: 17.06279 },
    ]);
  });

  it('referência do relatório não cai em propriedades herdadas (__proto__, constructor) e ignora maiúsculas', async () => {
    expect((await diagnosticarCusto(clienteFalso(), '__proto__', '24/11/2026')).conferencia).toBeNull();
    expect((await diagnosticarCusto(clienteFalso(), 'constructor', '24/11/2026')).conferencia).toBeNull();
    expect((await diagnosticarCusto(clienteFalso(), 'pa00000001', '24/11/2026')).conferencia).not.toBeNull();
  });

  it('erro interno (não-Omie) vira mensagem genérica; erro da Omie mostra o faultstring', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cliente = clienteFalso({
      async consultarDadosProducao() {
        throw new Error('connect ECONNREFUSED host-interno:5432');
      },
      async consultarProduto() {
        throw new OmieError('Produto não cadastrado');
      },
    });
    const r = await diagnosticarCusto(cliente, 'PA00000001', '24/11/2026');
    expect(r.dadosProducao).toEqual({ erro: 'Erro interno (detalhe no log do servidor).' });
    expect(JSON.stringify(r)).not.toContain('host-interno');
    expect(r.componentes[0]!.erros).toContain('produto: Produto não cadastrado');
    espiao.mockRestore();
  });

  it('ids inválidos (0, negativo, fração, hexadecimal) não chegam à Omie', async () => {
    const cliente = clienteFalso({
      async consultarEstrutura() {
        return { ident: { idProduto: 0 }, itens: [{ codProdMalha: 'X', idProdMalha: '0x10' }, { codProdMalha: 'Y', idProdMalha: 1.5 }] };
      },
    });
    const r = await diagnosticarCusto(cliente, 'PA99999999', '24/11/2026');
    expect(cliente.chamadas.filter((c) => !c.startsWith('estrutura:'))).toEqual([]);
    expect(r.componentes.every((c) => c.erros.includes('Item sem idProdMalha — custo não consultado.'))).toBe(true);
  });

  it(`limita a ${MAX_COMPONENTES_DIAGNOSTICO} componentes consultados e informa quantos ficaram de fora`, async () => {
    const itens = Array.from({ length: MAX_COMPONENTES_DIAGNOSTICO + 5 }, (_, i) => ({ codProdMalha: `C${i}`, idProdMalha: 1000 + i }));
    const cliente = clienteFalso({
      async consultarEstrutura() {
        return { ident: { idProduto: 1 }, itens };
      },
    });
    const r = await diagnosticarCusto(cliente, 'PA99999999', '24/11/2026');
    expect(r.componentes).toHaveLength(MAX_COMPONENTES_DIAGNOSTICO);
    expect(r.componentesNaoConsultados).toBe(5);
  });

  it('rejeita código de produto malformado', () => {
    expect(() => validarCodigoProduto('PA0001; DROP')).toThrow(ErroValidacao);
    expect(() => validarCodigoProduto('')).toThrow(ErroValidacao);
    expect(() => validarCodigoProduto('x'.repeat(61))).toThrow(ErroValidacao);
    expect(validarCodigoProduto('PA00000001')).toBe('PA00000001');
  });
});

describe('rota de diagnóstico — proteção', () => {
  const app = express();
  let servidor: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(() => {
    app.use(criarRotaPrecificacaoDiagnostico({} as ClienteOmie)); // nunca chamado: barra antes
    app.use(tratadorDeErros);
    servidor = app.listen(0);
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    servidor.close();
  });

  it('sem sessão responde 401 e não consulta a Omie', async () => {
    const resposta = await fetch(`${baseUrl}/api/precificacao/diagnostico/PA00000001`);
    expect(resposta.status).toBe(401);
  });
});

describe('diagnóstico de custo — subníveis (kits) e resumo em linguagem simples', () => {
  /** PA com 1 item direto e 1 kit (tipo 03); o kit tem MP08 (com 10% de perda), MO13 e MP45 (sem custo). */
  function clienteComKit(ggfKit = 0): ClienteOmieDiagnosticoCusto & { chamadas: string[] } {
    const base = clienteFalso();
    return clienteFalso({
      chamadas: base.chamadas,
      async obterEstoqueProduto(id, data) {
        if (id === 70) return { listaEstoque: [{ nCodProd: 70, nCMC: 25 }] };
        return base.obterEstoqueProduto(id, data);
      },
      async consultarEstrutura(cod) {
        base.chamadas.push(`estrutura:${cod}`);
        if (cod === 'KIT1') {
          return {
            ident: { idProduto: 70 },
            custoProducao: { vGGF: ggfKit, vMOD: 0 },
            itens: [
              { codProdMalha: 'MP00000008', idProdMalha: 20, quantProdMalha: 0.5, percPerdaProdMalha: 10, tipoProdMalha: '01' },
              { codProdMalha: 'MO00000013', idProdMalha: 30, quantProdMalha: 1, tipoProdMalha: '09' },
              { codProdMalha: 'MP00000045', idProdMalha: 50, quantProdMalha: 1, tipoProdMalha: '01' },
            ],
          };
        }
        return {
          ident: { idProduto: 1, codProduto: cod },
          custoProducao: { vMOD: 0, vGGF: 0 },
          itens: [
            { codProdMalha: 'PI10000014', idProdMalha: 10, quantProdMalha: 1, tipoProdMalha: '06' },
            { codProdMalha: 'KIT1', idProdMalha: 70, quantProdMalha: 2, tipoProdMalha: '03', descrProdMalha: 'KIT TESTE' },
          ],
        };
      },
      async consultarDadosProducao() {
        return { nValorMOD: 0, nValorGGF: 0 };
      },
    });
  }

  it('abre a estrutura dos kits (tipo 03) e encontra os itens de dentro deles', async () => {
    const r = await diagnosticarCusto(clienteComKit(), 'PA00000001', '24/11/2026');
    expect(r.componentes.map((c) => [c.codProdMalha, c.nivel, c.pai])).toEqual([
      ['PI10000014', 1, 'PA00000001'],
      ['KIT1', 1, 'PA00000001'],
      ['MP00000008', 2, 'KIT1'],
      ['MO00000013', 2, 'KIT1'],
      ['MP00000045', 2, 'KIT1'],
    ]);
    expect(r.conferencia!.find((c) => c.rotulo === 'MP00000008')!.confere[0]!.campo).toBe('nCMC');
  });

  it('não abre item que não tem estrutura (matéria-prima, etiqueta etc.)', async () => {
    const cliente = clienteComKit();
    await diagnosticarCusto(cliente, 'PA00000001', '24/11/2026');
    expect(cliente.chamadas.filter((c) => c.startsWith('estrutura:'))).toEqual(['estrutura:PA00000001', 'estrutura:KIT1']);
  });

  it('GGF dos kits é somado pela quantidade (com perda) e pode bater com o relatório', async () => {
    // 2 kits × 29,88 = 59,76
    const r = await diagnosticarCusto(clienteComKit(29.88), 'PA00000001', '24/11/2026');
    const ggf = r.resumo.linhas[0]!;
    expect(ggf.bate).toBe(true);
    expect(ggf.valorSistema).toBeCloseTo(59.76, 6);
    expect(ggf.origem).toBe('GGF somado das estruturas dos kits/subníveis');
    expect(r.resumo.conclusao[0]).toEqual({ tipo: 'ok', texto: expect.stringContaining('O GGF bate com o relatório (R$ 59,76)') });
  });

  it('tabela: valor do relatório, valor do sistema em português e ✔/✘; sem custo aparece como tal', async () => {
    const r = await diagnosticarCusto(clienteComKit(), 'PA00000001', '24/11/2026');
    const porItem = Object.fromEntries(r.resumo.linhas.map((l) => [l.item, l]));
    expect(porItem.PI10000014).toMatchObject({ valorRelatorio: '0,192111', valorSistema: 0.192111, origem: 'custo médio do estoque', bate: true });
    expect(porItem.MP00000045).toMatchObject({ valorRelatorio: 'sem custo', valorSistema: null, bate: true });
    expect(porItem.KIT1).toMatchObject({ valorRelatorio: '—', bate: null, nivel: 1 });
    expect(porItem.MO00000037).toMatchObject({ valorSistema: null, bate: false, origem: expect.stringContaining('não aparece na estrutura') });
  });

  it('conclusão: GGF zerado, itens batem, itens sem custo, perda e veredito "ainda não dá"', async () => {
    const r = await diagnosticarCusto(clienteComKit(), 'PA00000001', '24/11/2026');
    const textos = r.resumo.conclusao.map((c) => `${c.tipo}: ${c.texto}`);
    expect(textos[0]).toMatch(/^problema: O GGF não bate: o relatório mostra R\$ 59,76, mas o Omie devolve GGF zero/);
    expect(textos).toContainEqual(expect.stringMatching(/^ok: Os custos dos itens conferidos batem com o relatório \(3 de 3\) e usam o custo médio do estoque do Omie\.$/));
    expect(textos).toContainEqual(expect.stringMatching(/^problema: Sem custo: MP00000045\./));
    expect(textos).toContainEqual(expect.stringMatching(/1 item\(ns\) têm % de perda cadastrado: MP00000008 \(10%\)/));
    expect(textos.at(-1)).toMatch(/^problema: Ainda não dá para usar este custo para formar preço\. Falta resolver: o GGF, /);
    expect(r.resumo.podeUsar).toBe(false);
  });

  it('quando tudo bate e nada está sem custo, diz que pode usar', async () => {
    const cliente = clienteFalso({
      async consultarEstrutura() {
        return {
          ident: { idProduto: 1 },
          custoProducao: { vGGF: 59.76 },
          itens: [
            { codProdMalha: 'PI10000014', idProdMalha: 10, quantProdMalha: 1 },
            { codProdMalha: 'MP00000008', idProdMalha: 20, quantProdMalha: 1 },
            { codProdMalha: 'MO00000013', idProdMalha: 30, quantProdMalha: 1 },
          ],
        };
      },
    });
    // Sem MO37/MP45 na estrutura eles contam como "não aparecem" — tira-os da referência só neste teste.
    const { REFERENCIAS_RELATORIO } = await import('../../src/precificacao/diagnosticoCusto.js');
    const original = REFERENCIAS_RELATORIO.PA00000001!;
    REFERENCIAS_RELATORIO.PA00000001 = { ggf: '59,76', componentes: { PI10000014: '0,192111', MP00000008: '17,06279', MO00000013: '5,238053' } };
    try {
      const r = await diagnosticarCusto(cliente, 'PA00000001', '24/11/2026');
      expect(r.resumo.podeUsar).toBe(true);
      expect(r.resumo.conclusao.at(-1)!.texto).toMatch(/^Pode usar/);
      expect(r.resumo.conclusao[0]!.texto).toContain('vem do GGF da estrutura do produto');
    } finally {
      REFERENCIAS_RELATORIO.PA00000001 = original;
    }
  });

  it('produto sem referência do relatório: conclusão informa que não dá para confirmar', async () => {
    const r = await diagnosticarCusto(clienteFalso(), 'PA99999999', '24/11/2026');
    expect(r.resumo.podeUsar).toBe(false);
    expect(r.resumo.linhas.every((l) => l.bate === null)).toBe(true);
    expect(r.resumo.conclusao.at(-1)).toMatchObject({ tipo: 'info', texto: expect.stringContaining('não há valores do relatório do Omie cadastrados para PA99999999') });
  });

  it('id em texto ("70") é aceito; ciclo de estrutura não entra em laço', async () => {
    const cliente = clienteFalso({
      async consultarEstrutura(cod) {
        return { ident: { idProduto: '1' }, itens: [{ codProdMalha: cod === 'A' ? 'B' : 'A', idProdMalha: '70', tipoProdMalha: '03' }] };
      },
    });
    const r = await diagnosticarCusto(cliente, 'A', '24/11/2026');
    expect(r.componentes.map((c) => c.codProdMalha)).toEqual(['B', 'A']);
    expect(r.componentes[0]!.idProdMalha).toBe(70);
  });
});
