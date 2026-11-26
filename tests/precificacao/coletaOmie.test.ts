import { describe, expect, it } from 'vitest';
import { OmieError, OmieErroTransitorio } from '../../src/omie/erros.js';
import type { ItemNotaEntrada } from '../../src/omie/notasEntrada.js';
import {
  coletarDadosOmie,
  conteudoImportadoDoCadastro,
  MAX_COMPONENTES_PRECIFICACAO,
  ncmDoCadastro,
  type FonteOmiePrecificacao,
} from '../../src/precificacao/coletaOmie.js';
import { somarFolhas } from '../../src/precificacao/estrutura.js';

const HOJE = '2026-11-26';

function nota(idProduto: number, sobrescrever: Partial<ItemNotaEntrada> = {}): ItemNotaEntrada {
  return { idProduto, idRecebimento: 1, idFornecedor: 77, numeroNfe: '1', data: '2026-10-01', quantidade: 1, precoUnitario: 10, aliquotaIcms: 18, aliquotaIpi: 5, temIcmsSt: false, ...sobrescrever };
}

/** Produto PA1 (id 1): MP1 (id 10, 2 un, 5% perda), KIT1 (id 20, tipo 03, 1 un) → MP2 (id 30, 0,5 un) e MP3 (id 40, 1 un). */
function fonteFalsa(sobrescrever: Partial<FonteOmiePrecificacao> = {}): FonteOmiePrecificacao & { chamadas: string[] } {
  const chamadas: string[] = [];
  const estruturas: Record<string, Record<string, unknown>> = {
    PA1: {
      ident: { idProduto: 1, codProduto: 'PA1', descrProduto: 'Produto 1' },
      itens: [
        { codProdMalha: 'MP1', idProdMalha: 10, quantProdMalha: 2, percPerdaProdMalha: 5, tipoProdMalha: '01' },
        { codProdMalha: 'KIT1', idProdMalha: 20, quantProdMalha: 1, tipoProdMalha: '03' },
      ],
    },
    KIT1: {
      ident: { idProduto: 20 },
      itens: [
        { codProdMalha: 'MP2', idProdMalha: 30, quantProdMalha: 0.5, tipoProdMalha: '01' },
        { codProdMalha: 'MP3', idProdMalha: 40, quantProdMalha: 1, tipoProdMalha: '01' },
      ],
    },
  };
  const cmc: Record<number, number> = { 10: 4, 20: 999, 30: 10, 40: 0 };
  const cadastro: Record<number, Record<string, unknown>> = {
    1: { codigo_produto: 1, ncm: '8544.70.00', recomendacoes_fiscais: { origem_mercadoria: '0' } },
    10: { codigo_produto: 10, ncm: '73181500' },
    30: { codigo_produto: 30, ncm: '' },
    40: { codigo_produto: 40, ncm: '39269090' },
  };
  return {
    chamadas,
    async consultarEstrutura(cod) {
      chamadas.push(`estrutura:${cod}`);
      const e = estruturas[cod];
      if (e === undefined) throw new OmieError('Não existem registros para a página [1]!');
      return e;
    },
    async consultarProduto(id) {
      chamadas.push(`produto:${id}`);
      return (cadastro[id] ?? { codigo_produto: id }) as never;
    },
    async obterEstoqueProduto(id) {
      chamadas.push(`estoque:${id}`);
      return { listaEstoque: id in cmc ? [{ nCodProd: id, nCMC: cmc[id] }] : [] };
    },
    async listarItensNotasEntrada(de, ate) {
      chamadas.push(`notas:${de}:${ate}`);
      return [nota(10, { data: '2026-09-01', aliquotaIpi: 10 }), nota(10, { data: '2026-11-01', aliquotaIpi: 0 })];
    },
    ...sobrescrever,
  };
}

describe('coleta do Omie para o custo (etapa 4) — só leitura', () => {
  it('abre o kit até as folhas, com custo médio, NCM, última nota e perda; o kit não entra com o próprio custo', async () => {
    const fonte = fonteFalsa();
    const dados = await coletarDadosOmie('PA1', fonte, HOJE);
    expect(dados.produto).toEqual({ idProduto: 1, descricao: 'Produto 1', ncm: '85447000', conteudoImportado: false });
    expect(dados.janelaNotas).toEqual({ de: '2026-05-26', ate: HOJE });
    expect(dados.folhas.map((f) => [f.codigo, f.quantidadeNoProduto, f.custoUnitario])).toEqual([
      ['MP1', 2 * 1.05, 4],
      ['MP2', 0.5, 10],
      ['MP3', 1, null], // custo médio 0 = sem custo
    ]);
    expect(somarFolhas(dados.folhas).total).toBeCloseTo(2.1 * 4 + 0.5 * 10, 10);
    expect(dados.componentes.MP1).toMatchObject({ ncm: '73181500', custoMedio: 4, ultimaNota: { data: '2026-11-01', aliquotaIpi: 0 } });
    expect(dados.componentes.MP2).toMatchObject({ ncm: null, ultimaNota: null });
    expect(dados.componentes.KIT1).toBeUndefined();
    expect(fonte.chamadas).not.toContain('estoque:20');
    // Só consultas: nenhuma chamada fora das 4 de leitura.
    expect(fonte.chamadas.every((c) => /^(estrutura|produto|estoque|notas):/.test(c))).toBe(true);
  });

  it('CUSTO_ESTIMADO (azul) lista as folhas com custo e sem nota na janela; sem custo não é "estimado"', async () => {
    const dados = await coletarDadosOmie('PA1', fonteFalsa(), HOJE);
    expect(dados.avisos).toEqual([
      expect.objectContaining({ nivel: 'AZUL', codigo: 'CUSTO_ESTIMADO', mensagem: expect.stringContaining('desde 26/05/2026): MP2.') }),
    ]);
  });

  it('PRODUTO_SEM_ESTRUTURA (vermelho): Omie diz que não existe, ou estrutura sem itens', async () => {
    const naoExiste = await coletarDadosOmie('XX', fonteFalsa(), HOJE);
    expect(naoExiste.avisos).toEqual([expect.objectContaining({ nivel: 'VERMELHO', codigo: 'PRODUTO_SEM_ESTRUTURA', item: 'XX' })]);
    const vazia = await coletarDadosOmie('PA1', fonteFalsa({ consultarEstrutura: async () => ({ ident: {}, itens: [] }) }), HOJE);
    expect(vazia.avisos.map((a) => a.codigo)).toEqual(['PRODUTO_SEM_ESTRUTURA']);
  });

  it('OMIE_INDISPONIVEL (vermelho): erro temporário em qualquer consulta para tudo — nunca vira "sem custo" ou "sem nota"', async () => {
    const erro = async () => {
      throw new OmieErroTransitorio('Falha de rede');
    };
    for (const sobrescrever of [
      { consultarEstrutura: erro },
      { listarItensNotasEntrada: erro },
      { obterEstoqueProduto: erro },
      { consultarProduto: erro },
    ] as Partial<FonteOmiePrecificacao>[]) {
      const dados = await coletarDadosOmie('PA1', fonteFalsa(sobrescrever), HOJE);
      expect(dados.avisos.map((a) => [a.nivel, a.codigo])).toEqual([['VERMELHO', 'OMIE_INDISPONIVEL']]);
    }
    // Erro temporário na estrutura de um kit também bloqueia (não trata o kit como folha).
    const fonte = fonteFalsa();
    const original = fonte.consultarEstrutura;
    fonte.consultarEstrutura = async (cod) => {
      if (cod === 'KIT1') throw new OmieErroTransitorio('timeout');
      return original(cod);
    };
    const dados = await coletarDadosOmie('PA1', fonte, HOJE);
    expect(dados.avisos.map((a) => a.codigo)).toEqual(['OMIE_INDISPONIVEL']);
    expect(dados.avisos[0]!.mensagem).toContain('KIT1');
  });

  it('kit sem estrutura no Omie entra como folha, com o próprio custo médio', async () => {
    const fonte = fonteFalsa();
    const original = fonte.consultarEstrutura;
    fonte.consultarEstrutura = async (cod) => {
      if (cod === 'KIT1') throw new OmieError('Não existem registros para a página [1]!');
      return original(cod);
    };
    const dados = await coletarDadosOmie('PA1', fonte, HOJE);
    expect(dados.folhas.find((f) => f.codigo === 'KIT1')).toMatchObject({ custoUnitario: 999, kitSemEstrutura: true });
  });

  it('acima do teto de componentes: COMPONENTES_NAO_CONSULTADOS (amarelo) e os de fora entram sem custo', async () => {
    const itens = Array.from({ length: MAX_COMPONENTES_PRECIFICACAO + 2 }, (_, i) => ({ codProdMalha: `MP${i}`, idProdMalha: 1000 + i, quantProdMalha: 1, tipoProdMalha: '01' }));
    const dados = await coletarDadosOmie('GRANDE', fonteFalsa({ consultarEstrutura: async () => ({ ident: { idProduto: 1 }, itens }) }), HOJE);
    const aviso = dados.avisos.find((a) => a.codigo === 'COMPONENTES_NAO_CONSULTADOS');
    expect(aviso).toMatchObject({ nivel: 'AMARELO' });
    expect(aviso!.mensagem).toContain(`MP${MAX_COMPONENTES_PRECIFICACAO}, MP${MAX_COMPONENTES_PRECIFICACAO + 1}`);
    expect(dados.folhas).toHaveLength(MAX_COMPONENTES_PRECIFICACAO + 2);
    expect(dados.folhas.at(-1)!.custoUnitario).toBeNull();
  });

  it('cadastro: NCM só com 8 dígitos; origem 1, 2, 3 e 8 = conteúdo importado; vazia = não informada', () => {
    expect(ncmDoCadastro({ ncm: '8544.70.00' })).toBe('85447000');
    expect(ncmDoCadastro({ ncm: '8544' })).toBeNull();
    expect(ncmDoCadastro({})).toBeNull();
    expect(['0', '1', '2', '3', '4', '5', '6', '7', '8'].map((o) => conteudoImportadoDoCadastro({ recomendacoes_fiscais: { origem_mercadoria: o } }))).toEqual([
      false, true, true, true, false, false, false, false, true,
    ]);
    expect(conteudoImportadoDoCadastro({})).toBeNull();
  });
});
