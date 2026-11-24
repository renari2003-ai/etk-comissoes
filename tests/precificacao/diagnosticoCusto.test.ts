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

function clienteFalso(sobrescrever: Partial<ClienteOmieDiagnosticoCusto> = {}): ClienteOmieDiagnosticoCusto & { chamadas: string[] } {
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
