import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarRotaVendedores } from '../../src/rotas/vendedores.js';
import { tratadorDeErros } from '../../src/rotas/erroHttp.js';
import type { ClienteOmie } from '../../src/omie/cliente.js';

/**
 * Regressão do bug real de 2026-09-11: `app.use(middleware, router)` aplica `middleware` a
 * QUALQUER requisição que chegue até essa camada (o router está montado sem prefixo), mesmo uma
 * que não bata com nenhuma rota do router — derrubando até páginas/rotas totalmente alheias (ex.:
 * `GET /`, os arquivos estáticos) com 401 mesmo sem nenhuma rota protegida envolvida. A correção foi
 * colocar `exigirAutenticacao`/`exigirPermissao` DIRETO em cada `.get()`/`.post()`, nunca via
 * `rotas.use(...)` nem `app.use(middleware, router)`.
 */
describe('proteção de rotas — middleware de autenticação nunca vaza para rotas alheias', () => {
  const app = express();
  let servidor: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(() => {
    const clienteFalso = {} as ClienteOmie; // nunca chamado — a rota protegida deve barrar antes disso
    app.use(criarRotaVendedores(clienteFalso));
    app.get('/rota-publica-alheia', (_req, res) => res.json({ ok: true }));
    app.use(tratadorDeErros);
    servidor = app.listen(0);
    const endereco = servidor.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${endereco.port}`;
  });

  afterAll(() => {
    servidor.close();
  });

  it('barra (401) uma rota que exige autenticação quando não há sessão', async () => {
    const resposta = await fetch(`${baseUrl}/api/vendedores`);
    expect(resposta.status).toBe(401);
  });

  it('NUNCA bloqueia uma rota alheia montada depois de uma rota protegida, mesmo sem sessão', async () => {
    const resposta = await fetch(`${baseUrl}/rota-publica-alheia`);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });
  });
});
