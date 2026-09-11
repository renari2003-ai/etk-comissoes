import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { ClienteOmie } from './omie/cliente.js';
import { criarRotaAuth } from './rotas/autenticacaoRotas.js';
import { criarRotasDocumentos } from './rotas/documentos.js';
import { criarRotasRelatorios } from './rotas/relatoriosRotas.js';
import { criarRotaComissionamento } from './rotas/comissionamento.js';
import { criarRotaVendedores } from './rotas/vendedores.js';
import { criarRotaCache } from './rotas/cache.js';
import { criarRotaSaude } from './rotas/saude.js';
import { tratadorDeErros } from './rotas/erroHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const diretorioPublico = path.join(__dirname, '..', 'public');

/**
 * Entrypoint reconhecido pelo deploy "zero-config" de Express do Vercel
 * (regra de 2026-09-11) — precisa estar num destes caminhos exatos
 * (`server.ts`, `index.ts`, `app.ts`, na raiz ou em `src/`) E importar
 * `express` DIRETO neste arquivo (não basta importar de outro módulo que
 * por sua vez importa express — o detector do Vercel faz uma checagem
 * estática só neste arquivo; foi exatamente esse o motivo do erro "No
 * entrypoint found which imports express" na primeira tentativa de deploy,
 * quando essa montagem vivia em `appExpress.ts` e este arquivo só chamava
 * uma função). `app.listen()` abaixo serve tanto o servidor local
 * tradicional quanto o Vercel (que detecta a chamada e expõe a função via
 * um proxy interno — ver https://vercel.com/docs/frameworks/backend/express).
 */
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

// Arquivos estáticos (HTML/JS/CSS) — só têm efeito no servidor local tradicional: no Vercel,
// `express.static()` é ignorado por completo, e o conteúdo de `public/**` é servido direto pela
// CDN deles (ver docs do Express on Vercel) — sem precisar de nenhuma configuração adicional.
app.use(express.static(diretorioPublico));

app.use(tratadorDeErros);

app.listen(config.porta, () => {
  console.log(`Servidor rodando em http://localhost:${config.porta}`);
});
