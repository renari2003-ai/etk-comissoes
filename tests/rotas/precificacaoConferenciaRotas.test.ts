import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Usuario } from '../../src/auth/tipos.js';
import { PARAMETROS_GERAIS_INICIAIS, UFS_INICIAIS } from '../../src/precificacao/parametrosFiscais.js';

function usuario(papel: Usuario['papel'], precificacao: boolean): Usuario {
  return {
    id: `id-${papel}`,
    usuario: papel,
    nome: `Nome ${papel}`,
    papel,
    senhaHash: 'x',
    permissoes: { ...PERMISSOES_VAZIAS, precificacao },
    senhaProvisoria: false,
    mestre: false,
    vendedorOmieId: null,
    vendedorOmieNome: null,
  } as Usuario;
}
const USUARIOS: Record<string, Usuario> = { admin: usuario('administrador', false), comPermissao: usuario('usuario', true) };

vi.mock('../../src/auth/sessoes.js', () => ({ validarSessao: vi.fn(async (token: string) => (token in USUARIOS ? token : null)) }));
vi.mock('../../src/auth/usuariosRepositorio.js', () => ({ buscarPorId: vi.fn(async (id: string) => USUARIOS[id] ?? null) }));
vi.mock('../../src/precificacao/parametrosFiscaisRepositorio.js', () => ({
  lerTabelaFiscal: vi.fn(async () => ({ gerais: PARAMETROS_GERAIS_INICIAIS, ufs: UFS_INICIAIS, excecoesNcm: [], ipiNcm: [] })),
}));

const { criarRotasConferenciaCadastro } = await import('../../src/rotas/precificacaoConferencia.js');
const { tratadorDeErros } = await import('../../src/rotas/erroHttp.js');
const { NOME_COOKIE_SESSAO } = await import('../../src/auth/cookies.js');

const omie = {
  consultarEstrutura: vi.fn(async () => ({ ident: { idProduto: 1 }, itens: [{ codProdMalha: 'MP1', idProdMalha: 10, tipoProdMalha: '01' }] })),
  consultarProduto: vi.fn(async (id: number) => ({ codigo_produto: id, ncm: '' })),
  listarEstruturas: vi.fn(async () => ({ totalPaginas: 0, produtos: [] })),
};

describe('rota do relatório de conferência do cadastro — só administrador, Omie só leitura', () => {
  const app = express();
  let servidor: ReturnType<typeof app.listen>;
  let baseUrl: string;
  beforeAll(() => {
    app.use(criarRotasConferenciaCadastro(omie as never));
    app.use(tratadorDeErros);
    servidor = app.listen(0);
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    servidor.close();
  });
  const como = (token: string | null, caminho: string) =>
    fetch(`${baseUrl}${caminho}`, { headers: token === null ? {} : { Cookie: `${NOME_COOKIE_SESSAO}=${token}` } });

  it('401 sem sessão, 403 para operador (mesmo com a permissão), sem tocar o Omie', async () => {
    expect((await como(null, '/api/precificacao/conferencia-cadastro?produto=PA1')).status).toBe(401);
    expect((await como('comPermissao', '/api/precificacao/conferencia-cadastro?produto=PA1')).status).toBe(403);
    expect(omie.consultarEstrutura).not.toHaveBeenCalled();
  });

  it('administrador: um produto ou um lote; parâmetro inválido dá 400', async () => {
    const r = await como('admin', '/api/precificacao/conferencia-cadastro?produto=PA1');
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { linhas: { codigo: string; problema: string }[] };
    expect(corpo.linhas.map((l) => [l.codigo, l.problema])).toEqual([
      ['PA1', 'SEM_NCM'],
      ['MP1', 'SEM_NCM'],
    ]);
    expect((await como('admin', '/api/precificacao/conferencia-cadastro?pagina=1')).status).toBe(200);
    expect(omie.listarEstruturas).toHaveBeenCalledWith(1, 10);
    expect((await como('admin', '/api/precificacao/conferencia-cadastro?pagina=abc')).status).toBe(400);
  });
});
