import { describe, expect, it } from 'vitest';
import { OmieError, OmieErroTransitorio } from '../../src/omie/erros.js';
import { conferirLote, conferirProduto, PRODUTOS_POR_LOTE, type FonteConferencia } from '../../src/precificacao/conferenciaCadastro.js';
import { PARAMETROS_GERAIS_INICIAIS, UFS_INICIAIS, type TabelaFiscal } from '../../src/precificacao/parametrosFiscais.js';
import { validarConsultaConferencia } from '../../src/rotas/precificacaoConferencia.js';

const TABELA: TabelaFiscal = {
  gerais: { ...PARAMETROS_GERAIS_INICIAIS },
  ufs: UFS_INICIAIS.map((u) => ({ ...u })),
  excecoesNcm: [],
  ipiNcm: [{ ncm: '85447000', aliquota: 5 }, { ncm: '73181500', aliquota: 0 }],
};

const ESTRUTURAS: Record<string, Record<string, unknown>> = {
  PA1: {
    ident: { idProduto: 1, codProduto: 'PA1', descrProduto: 'Produto 1' },
    itens: [
      { codProdMalha: 'MP1', idProdMalha: 10, descrProdMalha: 'Parafuso', tipoProdMalha: '01' },
      { codProdMalha: 'KIT1', idProdMalha: 20, tipoProdMalha: '03' },
      { codProdMalha: 'MP3', idProdMalha: 40, descrProdMalha: 'Sem NCM', tipoProdMalha: '01' },
    ],
  },
  KIT1: { ident: { idProduto: 20 }, itens: [{ codProdMalha: 'MP2', idProdMalha: 30, descrProdMalha: 'Cabo', tipoProdMalha: '01' }, { codProdMalha: 'MP3', idProdMalha: 40, tipoProdMalha: '01' }] },
};
const NCM: Record<number, string> = { 1: '8544.70.00', 10: '73181500', 20: '99999999', 30: '11111111', 40: '' };

function fonte(sobrescrever: Partial<FonteConferencia> = {}): FonteConferencia {
  return {
    async consultarEstrutura(cod) {
      const e = ESTRUTURAS[cod];
      if (e === undefined) throw new OmieError('Não existem registros para a página [1]!');
      return e;
    },
    async consultarProduto(id) {
      return { codigo_produto: id, ncm: NCM[id] } as never;
    },
    async listarEstruturas(pagina, porPagina) {
      expect(porPagina).toBe(PRODUTOS_POR_LOTE);
      return { totalPaginas: 2, produtos: pagina === 1 ? [ESTRUTURAS.PA1!] : [] };
    },
    ...sobrescrever,
  };
}

describe('relatório de conferência do cadastro (só leitura)', () => {
  it('lista as folhas sem NCM e com NCM fora da tabela NCM → IPI, abrindo o kit (o kit em si não entra)', async () => {
    const linhas = await conferirProduto('PA1', fonte(), TABELA);
    expect(linhas.map((l) => [l.codigo, l.problema, l.ncm])).toEqual([
      ['MP2', 'NCM_SEM_IPI_NA_TABELA', '11111111'],
      ['MP3', 'SEM_NCM', null],
    ]);
    // MP3 aparece em dois ramos: uma linha só. MP1 (NCM com IPI 0 na tabela) está certo.
  });

  it('produto acabado também é conferido (NCM fora da tabela)', async () => {
    const linhas = await conferirProduto('PA1', fonte(), { ...TABELA, ipiNcm: [{ ncm: '73181500', aliquota: 0 }] });
    expect(linhas[0]).toMatchObject({ codigo: 'PA1', ehProdutoAcabado: true, problema: 'NCM_SEM_IPI_NA_TABELA', ncm: '85447000' });
  });

  it('sem estrutura e Omie fora viram linhas próprias (nunca "sem problema")', async () => {
    expect(await conferirProduto('XX', fonte(), TABELA)).toEqual([expect.objectContaining({ codigo: 'XX', problema: 'SEM_ESTRUTURA' })]);
    const fora = await conferirProduto('PA1', fonte({ consultarProduto: async () => { throw new OmieErroTransitorio('timeout'); } }), TABELA);
    expect(fora).toEqual([expect.objectContaining({ problema: 'OMIE_INDISPONIVEL' })]);
  });

  it('lote: confere os produtos da página e devolve o total de páginas para a tela continuar', async () => {
    const r = await conferirLote(1, fonte(), TABELA);
    expect(r).toMatchObject({ pagina: 1, totalPaginas: 2, produtosConferidos: 1 });
    expect(r.linhas.map((l) => l.codigo)).toEqual(['MP2', 'MP3']);
  });

  it('lote: produto sem itens vira SEM_ESTRUTURA (nunca "nenhum problema")', async () => {
    const r = await conferirLote(1, fonte({ listarEstruturas: async () => ({ totalPaginas: 1, produtos: [{ ident: { codProduto: 'PA9' } }] }) }), TABELA);
    expect(r.linhas).toEqual([expect.objectContaining({ codigo: 'PA9', problema: 'SEM_ESTRUTURA' })]);
  });

  it('item sem id, acima do teto de 150 ou kit em ciclo: NAO_CONFERIDO; id em texto numérico é aceito', async () => {
    const itens = [
      { codProdMalha: 'SEMID', tipoProdMalha: '01' },
      { codProdMalha: 'TXT', idProdMalha: '10', tipoProdMalha: '01' },
      { codProdMalha: 'PA1', idProdMalha: 1, tipoProdMalha: '04' },
      ...Array.from({ length: 151 }, (_, i) => ({ codProdMalha: `X${i}`, idProdMalha: 1000 + i, tipoProdMalha: '01' })),
    ];
    const linhas = await conferirProduto('PA1', fonte({
      consultarEstrutura: async () => ({ ident: { idProduto: 1 }, itens }),
      consultarProduto: async (id) => ({ codigo_produto: id, ncm: '85447000' }) as never,
    }), TABELA);
    expect(linhas.map((l) => [l.codigo, l.problema])).toEqual([
      ['SEMID', 'NAO_CONFERIDO'],
      ['PA1', 'NAO_CONFERIDO'],
      ['X149', 'NAO_CONFERIDO'],
      ['X150', 'NAO_CONFERIDO'],
    ]);
    expect(linhas[1]!.detalhe).toContain('ciclo');
  });

  it('componente "não cadastrado" no meio da estrutura: OMIE_INDISPONIVEL, nunca "produto sem estrutura"', async () => {
    const linhas = await conferirProduto('PA1', fonte({ consultarProduto: async () => { throw new OmieError('Produto não cadastrado'); } }), TABELA);
    expect(linhas).toEqual([expect.objectContaining({ codigo: 'PA1', problema: 'OMIE_INDISPONIVEL' })]);
  });

  it('consulta da rota: produto OU página, validados', () => {
    expect(validarConsultaConferencia({ produto: ' pa1 ' })).toEqual({ produto: 'PA1' });
    expect(validarConsultaConferencia({})).toEqual({ pagina: 1 });
    expect(validarConsultaConferencia({ pagina: '3' })).toEqual({ pagina: 3 });
    expect(() => validarConsultaConferencia({ produto: 'PA1', pagina: '1' })).toThrow(/não os dois/);
    expect(() => validarConsultaConferencia({ pagina: '0' })).toThrow(/pagina/);
    expect(() => validarConsultaConferencia({ produto: 'a b' })).toThrow(/inválido/);
    expect(() => validarConsultaConferencia({ x: '1' })).toThrow(/desconhecido/);
  });
});
