import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import { ErroSemPermissao } from '../auth/erros.js';
import { validarAtualizacaoTabelaFiscal } from '../precificacao/parametrosFiscais.js';
import { atualizarTabelaFiscal, lerTabelaFiscal, listarHistorico } from '../precificacao/parametrosFiscaisRepositorio.js';
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

/** Só administrador, com a mensagem certa (o `exigirAdministrador` do repo fala em "gerenciar usuários"). Vem depois de `exigirAutenticacao`. */
function exigirAdministradorTabelaFiscal(req: Request, _res: Response, next: NextFunction): void {
  if (req.usuario?.papel !== 'administrador') {
    next(new ErroSemPermissao('Só administradores podem alterar a tabela fiscal e ver o histórico.'));
    return;
  }
  next();
}

/**
 * Formação de preço — tabela fiscal (etapa 2). Proteção na própria rota, padrão do repositório:
 * - leitura: quem tem a permissão `precificacao` (administrador sempre passa);
 * - gravação e histórico: só administrador.
 * Prefixo `/api/precificacao/...` para nunca confundir com os parâmetros fiscais do módulo de fretes.
 */
export function criarRotasPrecificacao(): Router {
  const rotas = Router();

  rotas.get(
    '/api/precificacao/parametros-fiscais',
    exigirAutenticacao,
    exigirPermissao('precificacao'),
    assincrono(async (_req, res) => {
      res.json(await lerTabelaFiscal());
    }),
  );

  rotas.put(
    '/api/precificacao/parametros-fiscais',
    exigirAutenticacao,
    exigirAdministradorTabelaFiscal,
    assincrono(async (req, res) => {
      const { versao, tabela: nova } = validarAtualizacaoTabelaFiscal(req.body);
      const usuario = req.usuario!;
      const { tabela, alteracoes } = await atualizarTabelaFiscal(nova, versao, { id: usuario.id, nome: usuario.nome });
      res.json({ ...tabela, alteracoes: alteracoes.length });
    }),
  );

  rotas.get(
    '/api/precificacao/parametros-fiscais/historico',
    exigirAutenticacao,
    exigirAdministradorTabelaFiscal,
    assincrono(async (req, res) => {
      res.json(await listarHistorico(validarLimite(req.query.limite)));
    }),
  );

  return rotas;
}
