import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { exigirAutenticacao } from '../auth/middleware.js';
import { ErroSemPermissao } from '../auth/erros.js';
import { conferirLote, conferirProduto, type FonteConferencia } from '../precificacao/conferenciaCadastro.js';
import { lerTabelaFiscal } from '../precificacao/parametrosFiscaisRepositorio.js';
import { ErroValidacao } from '../validacao.js';
import { assincrono } from './erroHttp.js';

const CODIGO_PRODUTO = /^[A-Za-z0-9._-]{1,60}$/;
const PAGINA_MAXIMA = 1000;

function exigirAdministradorConferencia(req: Request, _res: Response, next: NextFunction): void {
  if (req.usuario?.papel !== 'administrador') {
    next(new ErroSemPermissao('Só administradores podem gerar o relatório de conferência do cadastro.'));
    return;
  }
  next();
}

/** `?produto=X` (um produto) OU `?pagina=N` (um lote da varredura de todos) — nunca os dois. */
export function validarConsultaConferencia(query: Record<string, unknown>): { produto: string } | { pagina: number } {
  const desconhecidas = Object.keys(query).filter((k) => k !== 'produto' && k !== 'pagina');
  if (desconhecidas.length > 0) throw new ErroValidacao(`Parâmetro(s) desconhecido(s): ${desconhecidas.join(', ')}.`);
  if (query.produto !== undefined && query.pagina !== undefined) throw new ErroValidacao('Use "produto" ou "pagina", não os dois.');
  if (query.produto !== undefined) {
    if (typeof query.produto !== 'string' || !CODIGO_PRODUTO.test(query.produto.trim())) throw new ErroValidacao('Código do produto inválido.');
    return { produto: query.produto.trim().toUpperCase() };
  }
  const bruto = query.pagina ?? '1';
  if (typeof bruto !== 'string' || !/^\d{1,4}$/.test(bruto) || Number(bruto) < 1 || Number(bruto) > PAGINA_MAXIMA) {
    throw new ErroValidacao(`"pagina" deve ser um número de 1 a ${PAGINA_MAXIMA}.`);
  }
  return { pagina: Number(bruto) };
}

/**
 * Relatório de conferência do cadastro (etapa 4): SOMENTE LEITURA no Omie, só administrador.
 * Spec: `GET /api/precificacao/conferencia-cadastro?produto=` (sem `produto` = todos, em lotes).
 */
export function criarRotasConferenciaCadastro(omie: FonteConferencia): Router {
  const rotas = Router();
  rotas.get(
    '/api/precificacao/conferencia-cadastro',
    exigirAutenticacao,
    exigirAdministradorConferencia,
    assincrono(async (req, res) => {
      const consulta = validarConsultaConferencia(req.query as Record<string, unknown>);
      const tabela = await lerTabelaFiscal();
      if ('produto' in consulta) {
        res.json({ pagina: 1, totalPaginas: 1, produtosConferidos: 1, linhas: await conferirProduto(consulta.produto, omie, tabela) });
        return;
      }
      res.json(await conferirLote(consulta.pagina, omie, tabela));
    }),
  );
  return rotas;
}
