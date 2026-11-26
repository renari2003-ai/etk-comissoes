import { describe, expect, it } from 'vitest';
import { OmieError, OmieErroTransitorio } from '../../src/omie/erros.js';
import {
  coletarDadosOmie,
  conteudoImportadoDoCadastro,
  MAX_COMPONENTES_PRECIFICACAO,
  ncmDoCadastro,
  type FonteOmiePrecificacao,
} from '../../src/precificacao/coletaOmie.js';
import { somarFolhas } from '../../src/precificacao/estrutura.js';

const HOJE = '2026-11-26';

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
    ...sobrescrever,
  };
}

describe('coleta do Omie para o custo (etapa 4) — só leitura', () => {
  it('abre o kit até as folhas, com custo médio, NCM e perda; o kit não entra com o próprio custo', async () => {
    const fonte = fonteFalsa();
    const dados = await coletarDadosOmie('PA1', fonte, HOJE);
    expect(dados.produto).toEqual({ idProduto: 1, descricao: 'Produto 1', ncm: '85447000', conteudoImportado: false });
    expect(dados.folhas.map((f) => [f.codigo, f.quantidadeNoProduto, f.custoUnitario])).toEqual([
      ['MP1', 2 * 1.05, 4],
      ['MP2', 0.5, 10],
      ['MP3', 1, null], // custo médio 0 = sem custo
    ]);
    expect(somarFolhas(dados.folhas).total).toBeCloseTo(2.1 * 4 + 0.5 * 10, 10);
    expect(dados.componentes.MP1).toEqual({ codigo: 'MP1', idProduto: 10, descricao: null, ncm: '73181500', custoMedio: 4 });
    expect(dados.componentes.MP2).toMatchObject({ ncm: null, custoMedio: 10 });
    expect(dados.componentes.KIT1).toBeUndefined();
    expect(fonte.chamadas).not.toContain('estoque:20');
    // Só consultas: nenhuma chamada fora das 3 de leitura — as notas de entrada não são lidas (o nCMC já vem líquido).
    expect(fonte.chamadas.every((c) => /^(estrutura|produto|estoque):/.test(c))).toBe(true);
    expect(dados.avisos).toEqual([]);
  });

  it('PRODUTO_SEM_ESTRUTURA (vermelho): Omie diz que não existe, ou estrutura sem itens', async () => {
    const naoExiste = await coletarDadosOmie('XX', fonteFalsa(), HOJE);
    expect(naoExiste.avisos).toEqual([expect.objectContaining({ nivel: 'VERMELHO', codigo: 'PRODUTO_SEM_ESTRUTURA', item: 'XX' })]);
    const vazia = await coletarDadosOmie('PA1', fonteFalsa({ consultarEstrutura: async () => ({ ident: {}, itens: [] }) }), HOJE);
    expect(vazia.avisos.map((a) => a.codigo)).toEqual(['PRODUTO_SEM_ESTRUTURA']);
  });

  it('OMIE_INDISPONIVEL (vermelho): erro temporário em qualquer consulta para tudo — nunca vira "sem custo"', async () => {
    const erro = async () => {
      throw new OmieErroTransitorio('Falha de rede');
    };
    for (const sobrescrever of [
      { consultarEstrutura: erro },
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

  it('kit em ciclo (contém o próprio produto) ou estrutura funda demais: erro explícito, nunca folha com o próprio custo', async () => {
    const ciclo = fonteFalsa({ consultarEstrutura: async () => ({ ident: { idProduto: 1 }, itens: [{ codProdMalha: 'PA1', idProdMalha: 1, quantProdMalha: 1, tipoProdMalha: '04' }] }) });
    await expect(coletarDadosOmie('PA1', ciclo, HOJE)).rejects.toThrow(/ciclo/);
    let n = 0;
    const funda = fonteFalsa({ consultarEstrutura: async () => ({ ident: { idProduto: 1 }, itens: [{ codProdMalha: `K${n++}`, idProdMalha: 50 + n, quantProdMalha: 1, tipoProdMalha: '03' }] }) });
    await expect(coletarDadosOmie('PA1', funda, HOJE)).rejects.toThrow(/mais de 10 níveis/);
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
