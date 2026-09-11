import type { NextFunction, Request, Response } from 'express';
import { ErroNaoAutenticado, ErroSemPermissao } from '../auth/erros.js';
import { OmieError } from '../omie/erros.js';
import { ErroTipoDocumentoIncompativel } from '../relatorio/montarRelatorio.js';
import { ErroValidacao } from '../validacao.js';

/** Encaminha erros assíncronos de rota para o middleware de tratamento de erros do Express. */
export function assincrono(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/**
 * Middleware final de tratamento de erros. Nunca inclui stack trace, caminhos
 * internos, variáveis de ambiente ou segredos na resposta ao cliente.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tratadorDeErros(erro: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (erro instanceof ErroValidacao) {
    res.status(400).json({ erro: erro.message });
    return;
  }

  if (erro instanceof ErroNaoAutenticado) {
    res.status(401).json({ erro: erro.message });
    return;
  }

  if (erro instanceof ErroSemPermissao) {
    res.status(403).json({ erro: erro.message });
    return;
  }

  if (erro instanceof ErroTipoDocumentoIncompativel) {
    res.status(409).json({
      erro: erro.message,
      esperado: erro.esperado,
      encontrado: erro.encontrado,
    });
    return;
  }

  if (erro instanceof OmieError) {
    res.status(502).json({
      erro: 'A consulta à Omie falhou.',
      motivo: erro.message,
      sugestao: 'Verifique os dados informados e tente novamente em instantes.',
    });
    return;
  }

  console.error('Erro interno não tratado:', erro instanceof Error ? erro.message : erro);
  res.status(500).json({
    erro: 'Ocorreu um erro interno ao processar a solicitação.',
    sugestao: 'Tente novamente. Se o problema persistir, verifique os logs do servidor.',
  });
}
