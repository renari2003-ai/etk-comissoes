import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { tratadorDeErros } from '../../src/rotas/erroHttp.js';
import { OmieError, OmieErroLimiteExcedido, OmieErroTransitorio } from '../../src/omie/erros.js';
import { ErroNaoAutenticado, ErroSemPermissao } from '../../src/auth/erros.js';

function resFalso(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('tratadorDeErros', () => {
  it('classifica OmieError como 502 (comportamento já existente)', () => {
    const res = resFalso();
    tratadorDeErros(new OmieError('faultstring da Omie'), {} as never, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('classifica OmieErroTransitorio (falha de rede/timeout) como 502, nunca 500 (BUG corrigido em 2026-09-10)', () => {
    // Antes da correção, OmieErroTransitorio não estendia OmieError, então caía no tratador
    // genérico (500 "erro interno") mesmo sendo claramente uma falha de comunicação com a Omie —
    // reproduzido contra a API real quando o Limitador esgotava as 3 tentativas de retry.
    const res = resFalso();
    tratadorDeErros(new OmieErroTransitorio('Falha de rede ao chamar ListarContasReceber'), {} as never, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('classifica OmieErroLimiteExcedido (rate limit / consumo redundante) como 502, nunca 500', () => {
    const res = resFalso();
    tratadorDeErros(new OmieErroLimiteExcedido('Limite de requisições excedido'), {} as never, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('classifica ErroNaoAutenticado como 401', () => {
    const res = resFalso();
    tratadorDeErros(new ErroNaoAutenticado(), {} as never, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('classifica ErroSemPermissao como 403', () => {
    const res = resFalso();
    tratadorDeErros(new ErroSemPermissao(), {} as never, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('ainda cai no tratador genérico (500) para erros que não são da Omie', () => {
    const res = resFalso();
    tratadorDeErros(new Error('erro de programação qualquer'), {} as never, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
