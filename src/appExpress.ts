import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClienteOmie } from './omie/cliente.js';
import { criarRotaAuth } from './rotas/auth.js';
import { criarRotasDocumentos } from './rotas/documentos.js';
import { criarRotasRelatorios } from './rotas/relatorios.js';
import { criarRotaComissionamento } from './rotas/comissionamento.js';
import { criarRotaVendedores } from './rotas/vendedores.js';
import { criarRotaCache } from './rotas/cache.js';
import { criarRotaSaude } from './rotas/saude.js';
import { tratadorDeErros } from './rotas/erroHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const diretorioPublico = path.join(__dirname, '..', 'public');

/**
 * Monta o app Express completo, sem chamar `.listen()` — usado tanto pelo
 * servidor local tradicional (`server.ts`, via `npm start`) quanto pela
 * função serverless do Vercel (`api/index.ts`, regra de 2026-09-11), que
 * precisa só do handler de requisição, nunca de um processo ficando de pé.
 */
export function criarApp(): express.Express {
  const app = express();
  const cliente = new ClienteOmie();

  // Nunca logar corpo de requisições (pode conter dados de pedidos) nem headers sensíveis.
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Cada rota já leva `exigirAutenticacao`/`exigirPermissao` diretamente nela (dentro do respectivo
  // arquivo em `rotas/`), nunca aqui via `app.use(middleware, router)` — essas rotas usam caminhos
  // absolutos (sem um prefixo comum por grupo), e um middleware "global" nesse nível rodaria pra
  // QUALQUER requisição que chegasse até este `app.use`, incluindo `GET /` e os arquivos estáticos,
  // mesmo sem nenhuma rota do router bater (bug real encontrado e corrigido em 2026-09-11: o site
  // inteiro, HTML/CSS/JS incluídos, respondia 401 sem sessão).
  app.use(criarRotaAuth());
  app.use(criarRotaSaude());
  app.use(criarRotaCache(cliente));
  app.use(criarRotaVendedores(cliente));
  app.use(criarRotasDocumentos(cliente, 'PEDIDO'));
  app.use(criarRotasDocumentos(cliente, 'ORCAMENTO'));
  app.use(criarRotasRelatorios(cliente, 'PEDIDO'));
  app.use(criarRotasRelatorios(cliente, 'ORCAMENTO'));
  app.use(criarRotaComissionamento(cliente));

  // Arquivos estáticos (HTML/JS/CSS) continuam públicos — o frontend decide o que mostrar chamando
  // /api/auth/eu; nenhum dado sensível é servido por aqui, só a casca da aplicação. No Vercel, a
  // pasta `public/` já é servida direto pela CDN deles (convenção de projeto) — isso aqui só entra
  // em jogo no servidor local tradicional.
  app.use(express.static(diretorioPublico));

  app.use(tratadorDeErros);

  return app;
}
