import { describe, expect, it } from 'vitest';
import { interpretarClienteFiscal, type ClienteFiscalOmie } from '../../src/omie/cliente.js';
import { determinarCenario } from '../../src/precificacao/calculo.js';
import { clienteParaVenda } from '../../src/precificacao/clienteVenda.js';
import { paraParametrosDoCalculo, PARAMETROS_GERAIS_INICIAIS, UFS_INICIAIS } from '../../src/precificacao/parametrosFiscais.js';

const fiscal = (sobrescrever: Partial<ClienteFiscalOmie> = {}): ClienteFiscalOmie => ({
  codigo: 5,
  razaoSocial: 'Cliente Ltda',
  cnpjCpf: '12345678000199',
  uf: 'MG',
  contribuinte: true,
  inscricaoEstadual: '0012345670012',
  ...sobrescrever,
});

describe('cliente da venda (Omie + PTA do app + finalidade)', () => {
  it('lê o cadastro fiscal do Omie sem inventar: "S"/"N" → sim/não; vazio → não informado', () => {
    expect(interpretarClienteFiscal({ codigo_cliente_omie: 5, razao_social: ' Cliente ', estado: 'mg', contribuinte: 'S', inscricao_estadual: 'ISENTO', cnpj_cpf: '12.345.678/0001-99' }, 5)).toEqual({
      codigo: 5,
      razaoSocial: 'Cliente',
      cnpjCpf: '12345678000199',
      uf: 'MG',
      contribuinte: true,
      inscricaoEstadual: 'ISENTO',
    });
    expect(interpretarClienteFiscal({ contribuinte: 'N' }, 9)).toMatchObject({ codigo: 9, contribuinte: false, uf: null, cnpjCpf: null, inscricaoEstadual: null });
    expect(interpretarClienteFiscal({ contribuinte: '' }, 9).contribuinte).toBeNull();
  });

  it('monta o ClienteVenda e o cenário A só com PTA (do app) + industrialização', () => {
    const p = paraParametrosDoCalculo({ gerais: { ...PARAMETROS_GERAIS_INICIAIS }, ufs: UFS_INICIAIS.map((u) => ({ ...u })), excecoesNcm: [], ipiNcm: [] }).venda;
    const produto = { icmsInternoMgExcecaoNcm: null, conteudoImportado: false };
    const a = clienteParaVenda(5, fiscal(), true, 'INDUSTRIALIZACAO');
    expect(a.cliente).toEqual({ uf: 'MG', contribuinte: true, usoConsumo: false, clienteComPta: true, vendaParaIndustrializacao: true });
    expect(determinarCenario(a.cliente!, produto, p).cenario).toBe('A');
    expect(determinarCenario(clienteParaVenda(5, fiscal(), true, 'REVENDA').cliente!, produto, p).cenario).toBe('B');
    expect(clienteParaVenda(5, fiscal(), false, 'USO_CONSUMO').cliente).toMatchObject({ usoConsumo: true, vendaParaIndustrializacao: false });
  });

  it('cliente não encontrado, sem UF, do exterior ou sem "contribuinte": tarja vermelha CLIENTE_INCONSISTENTE', () => {
    for (const [f, trecho] of [
      [null, 'não encontrado'],
      [fiscal({ uf: null }), 'sem UF'],
      [fiscal({ uf: 'EX' }), 'exterior'],
      [fiscal({ contribuinte: null }), '"contribuinte"'],
    ] as const) {
      const r = clienteParaVenda(5, f, false, 'REVENDA');
      expect(r.cliente).toBeNull();
      expect(r.avisos).toEqual([expect.objectContaining({ nivel: 'VERMELHO', codigo: 'CLIENTE_INCONSISTENTE', item: '5', mensagem: expect.stringContaining(trecho) })]);
    }
  });
});
