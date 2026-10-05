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
  /**
   * Fase 4A.2 — chamada outbound ETK → n8n (`src/fretes/integracoes/n8nCliente.ts`). URL e
   * segredo SEMPRE vêm daqui, nunca de entrada do usuário/frontend (seção 37 — nunca SSRF via
   * URL escolhida pelo cliente). Se `n8nWebhookUrl`/`n8nWebhookSecret` estiverem vazios, o
   * envio é recusado de forma controlada (fail closed) — nunca enviado sem autenticação.
   */
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL ?? '',
  n8nWebhookSecret: process.env.N8N_WEBHOOK_SECRET ?? '',
  n8nTimeoutMs: numeroDoAmbiente('N8N_TIMEOUT_MS', 8000),
  /**
   * CNPJ da ETK (remetente) incluído no payload outbound ao n8n (`logistica.cnpjOrigem`). Dado
   * cadastral, não credencial — separado de propósito de `BRASPRESS_CNPJ` (usuário de login da
   * API Braspress, que nunca sai do servidor). Vazio/inválido → campo vai `null`.
   */
  fretesCnpjOrigem: process.env.FRETES_CNPJ_ORIGEM ?? '',
  /**
   * Fase Braspress 1 — API oficial de cotação (`src/fretes/integracoes/braspressCliente.ts`).
   * Basic Auth: usuário = CNPJ do contrato (também usado como CNPJ remetente), senha = senha da
   * API. Nunca hardcodados nem logados; vazios → integração recusada de forma controlada. A URL
   * é sempre do servidor (nunca do frontend).
   */
  braspressCnpj: process.env.BRASPRESS_CNPJ ?? '',
  braspressPassword: process.env.BRASPRESS_PASSWORD ?? '',
  braspressUrl: process.env.BRASPRESS_URL ?? 'https://api.braspress.com/v1/cotacao/calcular/json',
  braspressTimeoutMs: numeroDoAmbiente('BRASPRESS_TIMEOUT_MS', 15000),
  /**
   * Fase 1 da migração n8n → backend: envio SMTP direto das solicitações de cotação
   * (`src/fretes/integracoes/smtpCliente.ts`). Credenciais só do ambiente, nunca logadas;
   * vazias → envio recusado de forma controlada (fail closed). Porta 465 = TLS implícito;
   * demais portas exigem STARTTLS.
   */
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: numeroDoAmbiente('SMTP_PORT', 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? '',
  smtpTimeoutMs: numeroDoAmbiente('SMTP_TIMEOUT_MS', 15000),
  /**
   * Caminho do canal EMAIL: `smtp` (padrão) envia direto; `n8n` volta ao webhook do n8n
   * (rollback/homologação). Qualquer outro valor cai no padrão `smtp`.
   */
  fretesEmailOutbound: (process.env.FRETES_EMAIL_OUTBOUND ?? '').trim().toLowerCase() === 'n8n' ? ('n8n' as const) : ('smtp' as const),
  /**
   * Fase 2 da migração n8n → backend: leitura IMAP direta das respostas
   * (`src/fretes/integracoes/imapCliente.ts`). Sempre SSL/TLS (porta padrão 993). Caixa aberta
   * em modo somente leitura — nunca apaga e-mail nem altera lido/não lido. Vazios → job
   * recusado de forma controlada.
   */
  imapHost: process.env.IMAP_HOST ?? '',
  imapPort: numeroDoAmbiente('IMAP_PORT', 993),
  imapUser: process.env.IMAP_USER ?? '',
  imapPass: process.env.IMAP_PASS ?? '',
  imapMailbox: (process.env.IMAP_MAILBOX ?? '').trim() || 'INBOX',
  imapTimeoutMs: numeroDoAmbiente('IMAP_TIMEOUT_MS', 20000),
  /**
   * Segredo próprio do endpoint interno de jobs (`/api/fretes/jobs/processar-emails`), enviado
   * como `Authorization: Bearer <segredo>`. Vazio → endpoint recusa tudo (fail closed). Para
   * Vercel Cron, usar o mesmo valor em `CRON_SECRET`.
   */
  fretesJobSecret: process.env.FRETES_JOB_SECRET ?? '',
  /**
   * Fase 3 da migração n8n → backend: WhatsApp direto pela YCloud
   * (`src/fretes/integracoes/ycloudCliente.ts`). API key e segredo do webhook só do ambiente,
   * nunca logados. `YCLOUD_WHATSAPP_FROM` = número remetente (E.164, ex.: +5511...).
   * Vazios → envio recusado / webhook recusa tudo (fail closed).
   */
  ycloudApiKey: process.env.YCLOUD_API_KEY ?? '',
  ycloudWhatsappFrom: process.env.YCLOUD_WHATSAPP_FROM ?? '',
  ycloudWebhookSecret: process.env.YCLOUD_WEBHOOK_SECRET ?? '',
  ycloudApiUrl: (process.env.YCLOUD_API_URL ?? '').trim() || 'https://api.ycloud.com/v2',
  ycloudTimeoutMs: numeroDoAmbiente('YCLOUD_TIMEOUT_MS', 15000),
  /**
   * Template aprovado na Meta para iniciar conversa fora da janela de 24h. Vazio → envia texto
   * livre (só entregue se a transportadora tiver falado com o número nas últimas 24h).
   */
  ycloudTemplateNome: (process.env.YCLOUD_TEMPLATE_NOME ?? '').trim(),
  ycloudTemplateIdioma: (process.env.YCLOUD_TEMPLATE_IDIOMA ?? '').trim() || 'pt_BR',
  /** Caminho do canal WHATSAPP: `ycloud` (padrão, direto) ou `n8n` (rollback). */
  fretesWhatsapp: (process.env.FRETES_WHATSAPP ?? '').trim().toLowerCase() === 'n8n' ? ('n8n' as const) : ('ycloud' as const),
};

/** true se ambas as credenciais foram carregadas (nunca expor os valores em si). */
export function credenciaisCarregadas(): boolean {
  return config.omieAppKey.trim() !== '' && config.omieAppSecret.trim() !== '';
}
