import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Papel } from '../../src/auth/tipos.js';
import { criarRotaComissionamento } from '../../src/rotas/comissionamento.js';
import { tratadorDeErros } from '../../src/rotas/erroHttp.js';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { baixaFinanceiro, clienteFinanceiro } from '../comissionamento/financeiroFixture.js';

// Só o armazenamento de sessão/usuários é substituído. Middlewares e regras de acesso são reais.
vi.mock('../../src/auth/sessoes.js', () => ({ validarSessao: async (token: string) => ['administrador', 'usuario', 'vendedor', 'bloqueado', 'somente-comissionamento', 'somente-financeiro', 'legado'].includes(token) ? token : null }));
vi.mock('../../src/auth/usuariosRepositorio.js', () => ({ buscarPorId: async (id: string) => ({
  id, usuario: id, nome: id, papel: ['bloqueado', 'somente-comissionamento', 'somente-financeiro', 'legado'].includes(id) ? 'usuario' : id as Papel,
  senhaHash: 'hash-teste', permissoes: { ...PERMISSOES_VAZIAS, relatorioComissionamento: !['bloqueado', 'somente-financeiro'].includes(id), relatorioFinanceiroComissao: !['bloqueado', 'somente-comissionamento', 'legado'].includes(id) },
  senhaProvisoria: false, mestre: false, vendedorOmieId: null,
  vendedorOmieNome: id === 'vendedor' ? 'João' : null,
}) }));

describe('rotas Financeiro / Comissão — JSON e Excel', () => {
  let servidor: ReturnType<express.Express['listen']>;
  let base: string;
  const query = '?data_de=01/09/2026&data_ate=30/09/2026';
  beforeAll(() => {
    const app = express();
    app.use(criarRotaComissionamento(clienteFinanceiro([baixaFinanceiro()]) as unknown as ClienteOmie));
    app.get('/publica', (_req, res) => res.json({ ok: true }));
    app.use(tratadorDeErros);
    servidor = app.listen(0);
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => servidor.close());
  const consultar = (papel: string, excel = false, filtros = query) => fetch(`${base}/api/relatorios/financeiro-comissao${excel ? '/excel' : ''}${filtros}`, { headers: { cookie: `sessao_etk=${papel}` } });

  it('exige autenticação e permissão em ambos os formatos sem bloquear rotas públicas', async () => {
    for (const excel of [false, true]) {
      expect((await consultar('invalido', excel)).status).toBe(401);
      expect((await consultar('bloqueado', excel)).status).toBe(403);
    }
    expect((await fetch(`${base}/publica`)).status).toBe(200);
  });
  it('separa a autorização financeira do comissionamento, inclusive no Excel', async () => {
    for (const excel of [false, true]) {
      expect((await consultar('somente-comissionamento', excel)).status).toBe(403);
      expect((await consultar('legado', excel)).status).toBe(403);
      expect((await consultar('somente-financeiro', excel)).status).toBe(200);
    }
    const resposta = await fetch(`${base}/api/relatorios/comissionamento${query}`, { headers: { cookie: 'sessao_etk=somente-financeiro' } });
    expect(resposta.status).toBe(403);
  });
  it('entrega composição com margem somente ao administrador', async () => {
    const admin = await (await consultar('administrador')).json();
    const usuario = await (await consultar('usuario')).json();
    expect(admin.margemVisivel).toBe(true);
    expect(admin.linhas[0].detalhe.margemComissionamentoPercentual).toBeDefined();
    expect(usuario.margemVisivel).toBe(false);
    expect(usuario.linhas[0].detalhe.margemComissionamentoPercentual).toBeUndefined();
    expect(usuario.linhas[0].detalhe.despesasTotal).toBeUndefined();
    // Composição por tabela (Preço da Tabela, custo de referência, multiplicador) também só para administrador.
    expect(admin.linhas[0].detalhe.composicaoItens[0]).toMatchObject({ tabelaCodigo: '003', precoTabela: 190, custoReferencia: 100 });
    expect(usuario.linhas[0].detalhe.composicaoItens).toBeUndefined();
    expect(JSON.stringify(usuario)).not.toMatch(/precoTabela|custoReferencia|multiplicador|acrescimo/);
    expect(usuario.linhas[0].comissaoAPagar).toBe(admin.linhas[0].comissaoAPagar);
  });
  it('ignora vendedor solicitado pelo vendedor autenticado e recalcula resumo', async () => {
    const dados = await (await consultar('vendedor', false, `${query}&vendedor=200`)).json();
    expect(dados.linhas).toHaveLength(1);
    expect(dados.linhas[0].codigoVendedor).toBe(100);
    expect(dados.resumo.comissaoAPagar).toBe(15);
  });
  it('aplica busca também aos totais', async () => {
    const dados = await (await consultar('usuario', false, `${query}&busca=nao-existe`)).json();
    expect(dados.linhas).toEqual([]);
    expect(dados.resumo.comissaoAPagar).toBe(0);
  });
  it('retorna XLSX real com cabeçalhos de download e sem margem para usuário', async () => {
    const resposta = await consultar('usuario', true);
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(resposta.headers.get('content-disposition')).toContain('financeiro-comissao.xlsx');
    const dados = Buffer.from(await resposta.arrayBuffer());
    expect(dados.subarray(0, 2).toString()).toBe('PK');
    expect(dados.toString()).toContain('00025739');
    expect(dados.toString()).not.toContain('Venda após despesas (%)');
    expect(dados.toString()).not.toContain('Margem de comissionamento');
  });
  it('recusa período incompleto ou invertido também no Excel', async () => {
    expect((await consultar('usuario', false, '')).status).toBe(400);
    expect((await consultar('usuario', true, '?data_de=30/09/2026&data_ate=01/09/2026')).status).toBe(400);
  });
});
