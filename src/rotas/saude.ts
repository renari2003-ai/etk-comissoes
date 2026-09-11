import { Router } from 'express';
import { credenciaisCarregadas } from '../config.js';
import { exigirAutenticacao } from '../auth/middleware.js';

export function criarRotaSaude(): Router {
  const rotas = Router();

  // Nunca retorna a chave/segredo em si, apenas se foram carregados (seção 21/35).
  rotas.get('/api/saude', exigirAutenticacao, (_req, res) => {
    res.json({ credenciaisCarregadas: credenciaisCarregadas() });
  });

  return rotas;
}
