import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PARAMETROS_GERAIS_INICIAIS } from '../../src/precificacao/parametrosFiscais.js';

// Banco de verdade, mas SÓ o isolado (PGlite da suíte `npx vitest run -c vitest.isolado.config.ts`):
// fora dela este arquivo é pulado — nunca cria, escreve ou dropa tabela no banco compartilhado
// (que é o da produção). Tabelas descartáveis por teste, também com prefixo "precificacao_".
vi.setConfig({ testTimeout: 30000 });
const NO_BANCO_ISOLADO = process.env.BANCO_ISOLADO_PGLITE === '1';

const VARIAVEIS = [
  'PRECIFICACAO_PARAMETROS_TABELA',
  'PRECIFICACAO_ICMS_UF_TABELA',
  'PRECIFICACAO_ICMS_MG_NCM_TABELA',
  'PRECIFICACAO_HISTORICO_TABELA',
  'PRECIFICACAO_PARAMETROS_EXTRA_TABELA',
  'PRECIFICACAO_IPI_NCM_TABELA',
] as const;
let tabelas: string[] = [];

async function importarRepositorio(): Promise<typeof import('../../src/precificacao/parametrosFiscaisRepositorio.js')> {
  vi.resetModules();
  return import('../../src/precificacao/parametrosFiscaisRepositorio.js');
}

const ADMIN = { id: 'admin-1', nome: 'Admin Teste' };

beforeEach(() => {
  if (!NO_BANCO_ISOLADO) return;
  const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  tabelas = VARIAVEIS.map((variavel, i) => {
    const nome = `precificacao_teste_${i}_${sufixo}`;
    process.env[variavel] = nome;
    return nome;
  });
});

afterEach(async () => {
  if (!NO_BANCO_ISOLADO) return;
  const { obterPool } = await import('../../src/db.js');
  for (const tabela of tabelas) await obterPool().query(`DROP TABLE IF EXISTS ${tabela}`);
  for (const variavel of VARIAVEIS) delete process.env[variavel];
});

describe.skipIf(!NO_BANCO_ISOLADO)('repositório da tabela fiscal (PGlite isolado)', () => {
  it('cria as tabelas e semeia os valores iniciais na primeira leitura; 26 UFs; nenhuma exceção; nasce "Provisório"', async () => {
    const { lerTabelaFiscal } = await importarRepositorio();
    const tabela = await lerTabelaFiscal();
    expect(tabela.gerais).toEqual(PARAMETROS_GERAIS_INICIAIS);
    expect(tabela.gerais.percentualRecolhimentoIcmsConsumidorFinal).toBe(100);
    expect(tabela.ufs).toHaveLength(26);
    expect(tabela.ufs.find((u) => u.uf === 'SP')).toEqual({ uf: 'SP', icmsInterestadualVenda: 12, aliquotaInterna: 18 });
    expect(tabela.ufs.find((u) => u.uf === 'BA')).toEqual({ uf: 'BA', icmsInterestadualVenda: 7, aliquotaInterna: 20.5 });
    expect(tabela.excecoesNcm).toEqual([]);
    // IPI por NCM (26/11/2026) começa vazio: "a confirmar pelo fiscal".
    expect(tabela.ipiNcm).toEqual([]);
    expect(tabela.atualizadoEm).toBeNull();
    expect(tabela.status).toBe('PROVISORIO');
    expect(tabela.statusAlteradoEm).toBeNull();
  });

  it('banco que já existia com as alíquotas internas VAZIAS: preenche só as vazias (nunca a editada), com histórico da fonte, uma única vez', async () => {
    const { obterPool } = await import('../../src/db.js');
    const { lerTabelaFiscal } = await importarRepositorio();
    await lerTabelaFiscal();
    const [, ufs, , historico, extra] = tabelas;
    // Simula o banco da produção antes de 25/11/2026: UFs vazias (menos uma editada) e sem a tabela extra.
    await obterPool().query(`UPDATE ${ufs} SET aliquota_interna = NULL`);
    await obterPool().query(`UPDATE ${ufs} SET aliquota_interna = 21 WHERE uf = 'SP'`);
    await obterPool().query(`DROP TABLE ${extra}`);

    const { lerTabelaFiscal: lerDeNovo, listarHistorico } = await importarRepositorio();
    const tabela = await lerDeNovo();
    expect(tabela.ufs.find((u) => u.uf === 'SP')!.aliquotaInterna).toBe(21);
    expect(tabela.ufs.find((u) => u.uf === 'PI')!.aliquotaInterna).toBe(22.5);
    expect(tabela.status).toBe('PROVISORIO');
    const linhas = await listarHistorico(100);
    expect(linhas).toHaveLength(25);
    expect(linhas.find((h) => h.campo === 'uf.PI.aliquotaInterna')).toMatchObject({
      usuarioId: 'sistema',
      usuarioNome: 'Valor inicial: Buscador NCM, nov/2026 (a confirmar pelo fiscal)',
      valorAnterior: null,
      valorNovo: '22.5',
    });
    expect(linhas.some((h) => h.campo === 'uf.SP.aliquotaInterna')).toBe(false);

    // O administrador esvazia uma UF de propósito: uma nova subida do servidor NÃO preenche de novo.
    await obterPool().query(`UPDATE ${ufs} SET aliquota_interna = NULL WHERE uf = 'PI'`);
    const { lerTabelaFiscal: lerMaisUmaVez } = await importarRepositorio();
    expect((await lerMaisUmaVez()).ufs.find((u) => u.uf === 'PI')!.aliquotaInterna).toBeNull();
    expect(historico).toMatch(/^precificacao_/);
  });

  it('status: só muda com a versão lida, registra no histórico e sobe a versão; mesmo status não grava nada', async () => {
    const { lerTabelaFiscal, atualizarStatusTabelaFiscal, listarHistorico } = await importarRepositorio();
    const atual = await lerTabelaFiscal();
    const mesmo = await atualizarStatusTabelaFiscal('PROVISORIO', atual.versao, ADMIN);
    expect(mesmo.alterou).toBe(false);
    expect(mesmo.tabela.versao).toBe(atual.versao);

    const { tabela, alterou } = await atualizarStatusTabelaFiscal('VALIDADO', atual.versao, ADMIN);
    expect(alterou).toBe(true);
    expect(tabela).toMatchObject({ status: 'VALIDADO', statusAlteradoPor: 'Admin Teste', versao: atual.versao + 1 });
    expect(tabela.statusAlteradoEm).not.toBeNull();
    expect((await listarHistorico(1))[0]).toMatchObject({ campo: 'status', valorAnterior: 'PROVISORIO', valorNovo: 'VALIDADO', usuarioId: 'admin-1' });

    // Tela aberta antes da validação: 409, nada é desfeito.
    await expect(atualizarStatusTabelaFiscal('PROVISORIO', atual.versao, { id: 'admin-2', nome: 'Outro' })).rejects.toThrow(/Recarregue/);
    // E o PUT da tabela com a versão antiga também dá 409 (status e tabela usam a mesma versão).
    const { atualizarTabelaFiscal } = await importarRepositorio();
    await expect(atualizarTabelaFiscal({ ...atual, gerais: { ...atual.gerais, irCs: 24 } }, atual.versao, ADMIN)).rejects.toThrow(/Recarregue/);
    expect((await lerTabelaFiscal()).status).toBe('VALIDADO');
  });

  it('tabela "Validada" que é editada volta sozinha para "Provisório", com histórico (valor novo nunca foi validado)', async () => {
    const { lerTabelaFiscal, atualizarStatusTabelaFiscal, atualizarTabelaFiscal, listarHistorico } = await importarRepositorio();
    const atual = await lerTabelaFiscal();
    const validada = (await atualizarStatusTabelaFiscal('VALIDADO', atual.versao, ADMIN)).tabela;
    const { tabela, alteracoes } = await atualizarTabelaFiscal(
      { ...validada, ufs: validada.ufs.map((u) => (u.uf === 'PI' ? { ...u, aliquotaInterna: 25 } : u)) },
      validada.versao,
      ADMIN,
    );
    expect(tabela.status).toBe('PROVISORIO');
    expect(alteracoes.map((a) => a.campo)).toEqual(['uf.PI.aliquotaInterna', 'status']);
    const historico = await listarHistorico(2);
    expect(historico.map((h) => [h.campo, h.valorAnterior, h.valorNovo]).sort()).toEqual([
      ['status', 'VALIDADO', 'PROVISORIO'],
      ['uf.PI.aliquotaInterna', '22.5', '25'],
    ]);
    // Salvar sem mudar nada não mexe no status.
    const revalidada = (await atualizarStatusTabelaFiscal('VALIDADO', tabela.versao, ADMIN)).tabela;
    const semMudanca = await atualizarTabelaFiscal(revalidada, revalidada.versao, ADMIN);
    expect(semMudanca.tabela.status).toBe('VALIDADO');
  });

  it('recolhimento a consumidor final é gravado na tabela extra, com histórico', async () => {
    const { lerTabelaFiscal, atualizarTabelaFiscal, listarHistorico } = await importarRepositorio();
    const atual = await lerTabelaFiscal();
    const { tabela } = await atualizarTabelaFiscal({ ...atual, gerais: { ...atual.gerais, percentualRecolhimentoIcmsConsumidorFinal: 80 } }, atual.versao, ADMIN);
    expect(tabela.gerais.percentualRecolhimentoIcmsConsumidorFinal).toBe(80);
    const { lerTabelaFiscal: lerDeNovo } = await importarRepositorio();
    expect((await lerDeNovo()).gerais.percentualRecolhimentoIcmsConsumidorFinal).toBe(80);
    expect((await listarHistorico(1))[0]).toMatchObject({ campo: 'gerais.percentualRecolhimentoIcmsConsumidorFinal', valorAnterior: '100', valorNovo: '80' });
  });

  it('grava as alterações, devolve a tabela nova e registra cada campo no histórico (com quem e o valor anterior)', async () => {
    const { lerTabelaFiscal, atualizarTabelaFiscal, listarHistorico } = await importarRepositorio();
    const atual = await lerTabelaFiscal();
    const nova = { gerais: { ...atual.gerais, irCs: 24 }, ufs: atual.ufs.map((u) => (u.uf === 'SP' ? { ...u, aliquotaInterna: 17 } : u)), excecoesNcm: [{ ncm: '85447000', aliquota: 12 }], ipiNcm: [{ ncm: '73181500', aliquota: 6.5 }] };
    const { tabela, alteracoes } = await atualizarTabelaFiscal(nova, atual.versao, ADMIN);
    expect(alteracoes).toHaveLength(4);
    expect(tabela.ipiNcm).toEqual([{ ncm: '73181500', aliquota: 6.5 }]);
    expect(tabela.gerais.irCs).toBe(24);
    expect(tabela.ufs.find((u) => u.uf === 'SP')!.aliquotaInterna).toBe(17);
    expect(tabela.excecoesNcm).toEqual([{ ncm: '85447000', aliquota: 12 }]);
    expect(tabela.atualizadoPor).toBe('Admin Teste');
    expect(tabela.atualizadoEm).not.toBeNull();

    const historico = await listarHistorico(50);
    expect(historico.map((h) => [h.campo, h.valorAnterior, h.valorNovo]).sort()).toEqual([
      ['gerais.irCs', '34', '24'],
      ['ipi.73181500', null, '6.5'],
      ['ncm.85447000', null, '12'],
      ['uf.SP.aliquotaInterna', '18', '17'],
    ]);
    expect(historico.every((h) => h.usuarioId === 'admin-1' && h.usuarioNome === 'Admin Teste')).toBe(true);

    // Persistiu de verdade: uma leitura nova (módulo recarregado) vê os valores.
    const { lerTabelaFiscal: lerDeNovo } = await importarRepositorio();
    expect((await lerDeNovo()).gerais.irCs).toBe(24);
  });

  it('remover uma exceção por NCM apaga a linha e registra no histórico', async () => {
    const { lerTabelaFiscal, atualizarTabelaFiscal, listarHistorico } = await importarRepositorio();
    const atual = await lerTabelaFiscal();
    const primeira = await atualizarTabelaFiscal({ ...atual, excecoesNcm: [{ ncm: '11111111', aliquota: 12 }, { ncm: '22222222', aliquota: 7 }] }, atual.versao, ADMIN);
    const { tabela } = await atualizarTabelaFiscal({ ...atual, excecoesNcm: [{ ncm: '22222222', aliquota: 7 }] }, primeira.tabela.versao, ADMIN);
    expect(tabela.excecoesNcm).toEqual([{ ncm: '22222222', aliquota: 7 }]);
    expect((await listarHistorico(1))[0]).toMatchObject({ campo: 'ncm.11111111', valorAnterior: '12', valorNovo: null });
  });

  it('IPI por NCM: grava, altera e remove (mesma versão e histórico da tabela fiscal); exceção de ICMS fica intacta', async () => {
    const { lerTabelaFiscal, atualizarTabelaFiscal, listarHistorico } = await importarRepositorio();
    const atual = await lerTabelaFiscal();
    const primeira = await atualizarTabelaFiscal(
      { ...atual, excecoesNcm: [{ ncm: '11111111', aliquota: 12 }], ipiNcm: [{ ncm: '11111111', aliquota: 5 }, { ncm: '22222222', aliquota: 0 }] },
      atual.versao,
      ADMIN,
    );
    expect(primeira.tabela.ipiNcm).toEqual([{ ncm: '11111111', aliquota: 5 }, { ncm: '22222222', aliquota: 0 }]);
    expect(primeira.tabela.versao).toBe(atual.versao + 1);
    const { tabela, alteracoes } = await atualizarTabelaFiscal(
      { ...primeira.tabela, ipiNcm: [{ ncm: '11111111', aliquota: 10 }] },
      primeira.tabela.versao,
      ADMIN,
    );
    expect(tabela.ipiNcm).toEqual([{ ncm: '11111111', aliquota: 10 }]);
    expect(tabela.excecoesNcm).toEqual([{ ncm: '11111111', aliquota: 12 }]);
    expect(alteracoes).toEqual([
      { campo: 'ipi.11111111', valorAnterior: '5', valorNovo: '10' },
      { campo: 'ipi.22222222', valorAnterior: '0', valorNovo: null },
    ]);
    expect((await listarHistorico(2)).map((h) => h.campo).sort()).toEqual(['ipi.11111111', 'ipi.22222222']);
  });

  it('sem alteração: não grava nada nem cria histórico', async () => {
    const { lerTabelaFiscal, atualizarTabelaFiscal, listarHistorico } = await importarRepositorio();
    const atual = await lerTabelaFiscal();
    const { alteracoes, tabela } = await atualizarTabelaFiscal({ gerais: atual.gerais, ufs: atual.ufs, excecoesNcm: atual.excecoesNcm, ipiNcm: atual.ipiNcm }, atual.versao, ADMIN);
    expect(alteracoes).toEqual([]);
    expect(tabela.atualizadoEm).toBeNull();
    expect(tabela.versao).toBe(atual.versao);
    expect(await listarHistorico(50)).toEqual([]);
  });

  it('semear de novo nunca sobrescreve o que o administrador editou', async () => {
    const { lerTabelaFiscal, atualizarTabelaFiscal } = await importarRepositorio();
    const atual = await lerTabelaFiscal();
    await atualizarTabelaFiscal({ ...atual, gerais: { ...atual.gerais, pisCofins: 9.5 } }, atual.versao, ADMIN);
    // Módulo novo → garantirEsquemaPrecificacao roda de novo (INSERT ... ON CONFLICT DO NOTHING).
    const { lerTabelaFiscal: lerDeNovo } = await importarRepositorio();
    expect((await lerDeNovo()).gerais.pisCofins).toBe(9.5);
  });

  it('dois admins: quem salva em cima de uma leitura antiga recebe 409 e nada é desfeito em silêncio', async () => {
    const { lerTabelaFiscal, atualizarTabelaFiscal, listarHistorico } = await importarRepositorio();
    const leituraDeA = await lerTabelaFiscal();
    const leituraDeB = await lerTabelaFiscal();
    expect(leituraDeA.versao).toBe(0);

    const salvoPorA = await atualizarTabelaFiscal({ ...leituraDeA, gerais: { ...leituraDeA.gerais, pisCofins: 9.5 } }, leituraDeA.versao, ADMIN);
    expect(salvoPorA.tabela.versao).toBe(1);

    // B ainda tem PIS = 9,25 na tela e muda só o IR/CS: sem a versão, desfaria a alteração de A.
    await expect(
      atualizarTabelaFiscal({ ...leituraDeB, gerais: { ...leituraDeB.gerais, irCs: 24 } }, leituraDeB.versao, { id: 'admin-2', nome: 'Outro Admin' }),
    ).rejects.toThrow(/alterada por Admin Teste.*Recarregue/);

    const final = await lerTabelaFiscal();
    expect(final.gerais.pisCofins).toBe(9.5);
    expect(final.gerais.irCs).toBe(34);
    expect(final.versao).toBe(1);
    expect(await listarHistorico(50)).toHaveLength(1);
  });

  it('nome de tabela fora do prefixo precificacao_ é recusado antes de qualquer SQL', async () => {
    process.env.PRECIFICACAO_PARAMETROS_TABELA = 'usuarios';
    const { lerTabelaFiscal } = await importarRepositorio();
    await expect(lerTabelaFiscal()).rejects.toThrow(/precisa começar com "precificacao_"/);
  });
});

describe('numeroDoBanco', () => {
  it('converte o texto do numeric e recusa vazio, null e lixo (nunca Number("") = 0)', async () => {
    const { numeroDoBanco } = await importarRepositorio();
    expect(numeroDoBanco('9.2500', 'x')).toBe(9.25);
    expect(numeroDoBanco(12, 'x')).toBe(12);
    for (const invalido of ['', ' ', null, undefined, 'abc', '1e3', Number.NaN]) {
      expect(() => numeroDoBanco(invalido, 'x')).toThrow(/inválido no banco/);
    }
  });
});
