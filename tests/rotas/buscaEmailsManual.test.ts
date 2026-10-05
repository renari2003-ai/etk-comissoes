import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';

vi.mock('../../src/auth/sessoes.js', () => ({ validarSessao: vi.fn(async () => 'operador') }));
vi.mock('../../src/auth/usuariosRepositorio.js', () => ({ buscarPorId: vi.fn() }));
vi.mock('../../src/fretes/jobEmailsRespostaServico.js', () => ({ servicoProcessarEmailsResposta: vi.fn() }));
import { buscarPorId } from '../../src/auth/usuariosRepositorio.js';
import { servicoProcessarEmailsResposta } from '../../src/fretes/jobEmailsRespostaServico.js';
import { criarRotaFretes } from '../../src/rotas/fretes.js';
import { tratadorDeErros } from '../../src/rotas/erroHttp.js';
import { NOME_COOKIE_SESSAO } from '../../src/auth/cookies.js';

let servidor: ReturnType<express.Express['listen']>;
let url: string;
beforeAll(() => {
  const app = express();
  app.use(criarRotaFretes({} as ClienteOmie));
  app.use(tratadorDeErros);
  servidor = app.listen(0);
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/fretes/emails-resposta/buscar`;
});
afterAll(() => servidor.close());
beforeEach(() => vi.clearAllMocks());
function usuario(permitido: boolean) {
  vi.mocked(buscarPorId).mockResolvedValue({ papel: 'usuario', permissoes: { fretes: permitido }, vendedorOmieNome: null } as Awaited<ReturnType<typeof buscarPorId>>);
}
const headers = { cookie: `${NOME_COOKIE_SESSAO}=sessao-teste` };
it('bloqueia busca sem sessão antes de acessar o IMAP', async () => {
  expect((await fetch(url, { method: 'POST' })).status).toBe(401);
  expect(servicoProcessarEmailsResposta).not.toHaveBeenCalled();
});
it('bloqueia usuário sem permissão de fretes', async () => {
  usuario(false);
  expect((await fetch(url, { method: 'POST', headers })).status).toBe(403);
  expect(servicoProcessarEmailsResposta).not.toHaveBeenCalled();
});
it.each(['OK', 'PULADO_LOCK', 'ERRO'] as const)('usa a rotina existente e devolve status %s ao operador', async (status) => {
  usuario(true);
  const resumo = { status, encontradas: 2, processadas: 1, revisao: 1, duplicadas: 0, ignoradas: 0, erros: 0, restantes: 0, erro: null, duracaoMs: 10 };
  vi.mocked(servicoProcessarEmailsResposta).mockResolvedValue(resumo);
  const resposta = await fetch(url, { method: 'POST', headers });
  expect(resposta.status).toBe(status === 'ERRO' ? 502 : 200);
  expect(await resposta.json()).toEqual(resumo);
  expect(servicoProcessarEmailsResposta).toHaveBeenCalledTimes(1);
});
