import { criarApp } from './appExpress.js';
import { config } from './config.js';

criarApp().listen(config.porta, () => {
  console.log(`Servidor rodando em http://localhost:${config.porta}`);
});
