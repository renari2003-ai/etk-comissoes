import { existsSync } from 'node:fs';

// Carrega o arquivo .env (se existir) usando o suporte nativo do Node (>=20.6).
// Nunca lançar nem logar o conteúdo do arquivo.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function numeroDoAmbiente(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  const numero = Number(bruto);
  return Number.isFinite(numero) && numero >= 0 ? numero : padrao;
}

export const config = {
  omieAppKey: process.env.OMIE_APP_KEY ?? '',
  omieAppSecret: process.env.OMIE_APP_SECRET ?? '',
  porta: numeroDoAmbiente('PORTA', 3000),
  intervaloMinimoMs: numeroDoAmbiente('OMIE_INTERVALO_MIN_MS', 300),
  /** Usados só para criar o primeiro administrador quando a tabela `usuarios` ainda está vazia (ver `src/auth/usuarios.ts`). Nunca lidos depois disso. */
  adminUsuario: process.env.ADMIN_USUARIO ?? '',
  adminSenha: process.env.ADMIN_SENHA ?? '',
  /** Connection string do Postgres (Supabase) — ver `src/auth/db.ts`. */
  databaseUrl: process.env.DATABASE_URL ?? '',
  /**
   * Fase 4A.1 — segredo compartilhado do webhook máquina-a-máquina que recebe respostas de
   * cotação (n8n → ETK). Nunca usa sessão/cookie de usuário (ver `rotas/fretes.ts`). Se
   * vazio, o webhook rejeita TODAS as chamadas (fail closed) — nunca aceita um segredo vazio
   * como "sem proteção".
   */
  fretesWebhookSecret: process.env.FRETES_WEBHOOK_SECRET ?? '',
};

/** true se ambas as credenciais foram carregadas (nunca expor os valores em si). */
export function credenciaisCarregadas(): boolean {
  return config.omieAppKey.trim() !== '' && config.omieAppSecret.trim() !== '';
}
