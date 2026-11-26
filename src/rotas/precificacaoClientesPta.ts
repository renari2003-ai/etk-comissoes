import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import { ErroSemPermissao } from '../auth/erros.js';
import type { ClienteOmie } from '../omie/cliente.js';
import { validarBuscaCliente, validarCodigoCliente, validarGravacaoClientePta } from '../precificacao/clientesPta.js';
import { listarClientesComPta, listarHistoricoClientesPta, obterClientePta, obterClientesPta, salvarClientePta } from '../precificacao/clientesPtaRepositorio.js';
import { ErroValidacao } from '../validacao.js';
import { assincrono } from './erroHttp.js';

const LIMITE_HISTORICO_PADRAO = 50;
const LIMITE_HISTORICO_MAXIMO = 500;

function validarLimite(valor: unknown): number {
  if (valor === undefined) return LIMITE_HISTORICO_PADRAO;
  if (typeof valor !== 'string' || !/^\d{1,4}$/.test(valor)) throw new ErroValidacao('O parâmetro "limite" deve ser um número inteiro.');
  const limite = Number(valor);
  if (limite < 1 || limite > LIMITE_HISTORICO_MAXIMO) throw new ErroValidacao(`O parâmetro "limite" deve ficar entre 1 e ${LIMITE_HISTORICO_MAXIMO}.`);
  return limite;
}

function exigirAdministradorClientesPta(req: Request, _res: Response, next: NextFunction): void {
  if (req.usuario?.papel !== 'administrador') {
    next(new ErroSemPermissao('Só administradores podem marcar "cliente com PTA" e ver o histórico.'));
    return;
  }
  next();
}

/**
 * "Cliente com PTA (compra para industrialização)" marcado no app (decisão de 26/11/2026):
 * - leitura e busca de cliente no Omie (SÓ LEITURA, `ListarClientes`): permissão `precificacao`;
 * - marcar/desmarcar e histórico: só administrador.
 * Nada é gravado no Omie.
 */
export function criarRotasClientesPta(omie: Pick<ClienteOmie, 'buscarClientes'>): Router {
  const rotas = Router();

  rotas.get(
    '/api/precificacao/clientes-pta',
    exigirAutenticacao,
    exigirPermissao('precificacao'),
    assincrono(async (_req, res) => {
      res.json(await listarClientesComPta());
    }),
  );

  rotas.get(
    '/api/precificacao/clientes-pta/historico',
    exigirAutenticacao,
    exigirAdministradorClientesPta,
    assincrono(async (req, res) => {
      const codigo = req.query.codigo === undefined ? null : validarCodigoCliente(req.query.codigo);
      res.json(await listarHistoricoClientesPta(codigo, validarLimite(req.query.limite)));
    }),
  );

  rotas.get(
    '/api/precificacao/clientes-pta/:codigo',
    exigirAutenticacao,
    exigirPermissao('precificacao'),
    assincrono(async (req, res) => {
      const codigo = validarCodigoCliente(req.params.codigo);
      res.json({ codigoCliente: codigo, salvo: await obterClientePta(codigo) });
    }),
  );

  rotas.put(
    '/api/precificacao/clientes-pta/:codigo',
    exigirAutenticacao,
    exigirAdministradorClientesPta,
    assincrono(async (req, res) => {
      const { versao, cliente } = validarGravacaoClientePta(req.params.codigo, req.body);
      const usuario = req.usuario!;
      res.json(await salvarClientePta(cliente, versao, { id: usuario.id, nome: usuario.nome }));
    }),
  );

  // Busca no cadastro do Omie (só leitura) — devolve só o necessário para escolher o cliente.
  rotas.get(
    '/api/precificacao/clientes/busca',
    exigirAutenticacao,
    exigirPermissao('precificacao'),
    assincrono(async (req, res) => {
      const filtro = validarBuscaCliente(req.query as Record<string, unknown>);
      const encontrados = await omie.buscarClientes('cnpj' in filtro ? { cnpj: filtro.cnpj } : { razaoSocial: filtro.nome });
      const noApp = await obterClientesPta(encontrados.map((c) => c.codigo));
      res.json(
        encontrados.map((c) => {
          const salvo = noApp.get(c.codigo) ?? null;
          return { codigoCliente: c.codigo, razaoSocial: c.razaoSocial, nomeFantasia: c.nomeFantasia, cnpjCpf: c.cnpjCpf, salvo };
        }),
      );
    }),
  );

  return rotas;
}
