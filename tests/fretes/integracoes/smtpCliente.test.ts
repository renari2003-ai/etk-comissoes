import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FabricaTransporteSmtp } from '../../../src/fretes/integracoes/smtpCliente.js';

// Cliente SMTP com transporte simulado — nenhuma conexão real com servidor de e-mail.

const SENHA = 'SenhaSmtp#Teste2026';
const USUARIO = 'cotacao@etk.ind.br';

async function importarSmtp(env: Record<string, string>): Promise<typeof import('../../../src/fretes/integracoes/smtpCliente.js')> {
  for (const nome of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) process.env[nome] = env[nome] ?? '';
  vi.resetModules();
  return import('../../../src/fretes/integracoes/smtpCliente.js');
}

const CONFIG_OK = { SMTP_HOST: 'smtp.exemplo.test', SMTP_PORT: '587', SMTP_USER: USUARIO, SMTP_PASS: SENHA, SMTP_FROM: 'ETK Fretes <cotacao@etk.ind.br>' };
const MENSAGEM = { para: 'transportadora@exemplo.com.br', assunto: 'Cotação de Frete ETK | FRE-2026-000001-abcd1234', html: '<p>oi</p>', texto: 'oi' };

function fabricaFalsa(resultado: () => Promise<{ messageId?: string; rejected?: unknown[] }>) {
  const opcoes: unknown[] = [];
  const enviados: Record<string, unknown>[] = [];
  const fechar = vi.fn();
  const fabrica: FabricaTransporteSmtp = (o) => {
    opcoes.push(o);
    return {
      sendMail: async (m) => {
        enviados.push(m as Record<string, unknown>);
        return resultado();
      },
      close: fechar,
    };
  };
  return { fabrica, opcoes, enviados, fechar };
}

function erroSmtp(campos: Record<string, unknown>): Error {
  return Object.assign(new Error(String(campos.message ?? 'falha')), campos);
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  for (const nome of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) delete process.env[nome];
  vi.restoreAllMocks();
});

describe('smtpCliente — envio SMTP direto', () => {
  it('sem configuração: recusa de forma controlada (fail closed), sem tentar conectar', async () => {
    const { enviarEmailSmtp, ErroSmtpNaoConfigurado } = await importarSmtp({});
    const f = fabricaFalsa(async () => ({ messageId: '<x@y>' }));
    await expect(enviarEmailSmtp(MENSAGEM, f.fabrica)).rejects.toBeInstanceOf(ErroSmtpNaoConfigurado);
    expect(f.opcoes).toHaveLength(0);
  });

  it('SMTP aceita: devolve o Message-ID; usa remetente/destinatário/assunto/HTML/texto; STARTTLS + timeouts na 587', async () => {
    const { enviarEmailSmtp } = await importarSmtp(CONFIG_OK);
    const f = fabricaFalsa(async () => ({ messageId: '<abc@etk.ind.br>', rejected: [] }));
    const r = await enviarEmailSmtp(MENSAGEM, f.fabrica);
    expect(r).toEqual({ messageId: '<abc@etk.ind.br>' });
    expect(f.enviados[0]).toMatchObject({ from: CONFIG_OK.SMTP_FROM, to: MENSAGEM.para, subject: MENSAGEM.assunto, html: '<p>oi</p>', text: 'oi' });
    expect(f.opcoes[0]).toMatchObject({ host: 'smtp.exemplo.test', port: 587, secure: false, requireTLS: true, connectionTimeout: 15000, socketTimeout: 15000 });
    expect(f.fechar).toHaveBeenCalledTimes(1);
  });

  it('porta 465 usa TLS implícito (SSL)', async () => {
    const { enviarEmailSmtp } = await importarSmtp({ ...CONFIG_OK, SMTP_PORT: '465' });
    const f = fabricaFalsa(async () => ({ messageId: '<a@b>' }));
    await enviarEmailSmtp(MENSAGEM, f.fabrica);
    expect(f.opcoes[0]).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it('e-mail de destino inválido é bloqueado antes de conectar', async () => {
    const { enviarEmailSmtp, ErroEnvioSmtpFalhou } = await importarSmtp(CONFIG_OK);
    const f = fabricaFalsa(async () => ({ messageId: '<a@b>' }));
    const erro = await enviarEmailSmtp({ ...MENSAGEM, para: 'sem-arroba' }, f.fabrica).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroEnvioSmtpFalhou);
    expect((erro as InstanceType<typeof ErroEnvioSmtpFalhou>).tipo).toBe('DESTINATARIO_RECUSADO');
    expect(f.opcoes).toHaveLength(0);
  });

  it('servidor rejeita o destinatário (EENVELOPE ou lista "rejected") → DESTINATARIO_RECUSADO', async () => {
    const { enviarEmailSmtp } = await importarSmtp(CONFIG_OK);
    const porErro = fabricaFalsa(async () => {
      throw erroSmtp({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, response: '550 5.1.1 <transportadora@exemplo.com.br>: Recipient address rejected' });
    });
    await expect(enviarEmailSmtp(MENSAGEM, porErro.fabrica)).rejects.toMatchObject({
      tipo: 'DESTINATARIO_RECUSADO',
      message: expect.stringMatching(/^SMTP_DESTINATARIO_RECUSADO: .*Recipient address rejected/),
    });
    const porLista = fabricaFalsa(async () => ({ messageId: '<a@b>', rejected: [MENSAGEM.para] }));
    await expect(enviarEmailSmtp(MENSAGEM, porLista.fabrica)).rejects.toMatchObject({ tipo: 'DESTINATARIO_RECUSADO' });
  });

  it('erro de autenticação: tipo AUTENTICACAO e nenhuma credencial na mensagem', async () => {
    const { enviarEmailSmtp } = await importarSmtp(CONFIG_OK);
    const f = fabricaFalsa(async () => {
      throw erroSmtp({
        code: 'EAUTH',
        responseCode: 535,
        command: 'AUTH PLAIN',
        response: `535 5.7.8 Authentication failed for ${USUARIO} password=${SENHA} AUTH PLAIN AGNvdGFjYW9AZXRrLmluZC5icgBTZW5oYQ==`,
      });
    });
    const erro = (await enviarEmailSmtp(MENSAGEM, f.fabrica).catch((e: unknown) => e)) as Error & { tipo: string };
    expect(erro.tipo).toBe('AUTENTICACAO');
    expect(erro.message).toMatch(/^SMTP_AUTENTICACAO: /);
    for (const segredo of [SENHA, USUARIO, 'AGNvdGFjYW9AZXRrLmluZC5icgBTZW5oYQ==']) expect(erro.message).not.toContain(segredo);
    expect(f.fechar).toHaveBeenCalledTimes(1);
  });

  it('erro de conexão e timeout são classificados separadamente', async () => {
    const { enviarEmailSmtp } = await importarSmtp(CONFIG_OK);
    const conexao = fabricaFalsa(async () => {
      throw erroSmtp({ code: 'ECONNECTION', message: 'connect ECONNREFUSED 10.0.0.1:587' });
    });
    await expect(enviarEmailSmtp(MENSAGEM, conexao.fabrica)).rejects.toMatchObject({ tipo: 'CONEXAO', message: expect.stringMatching(/^SMTP_CONEXAO: /) });
    const timeout = fabricaFalsa(async () => {
      throw erroSmtp({ code: 'ETIMEDOUT', message: 'Greeting never received' });
    });
    await expect(enviarEmailSmtp(MENSAGEM, timeout.fabrica)).rejects.toMatchObject({ tipo: 'TIMEOUT', message: expect.stringMatching(/^SMTP_TIMEOUT: /) });
  });

  it('nada é logado com a senha', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { enviarEmailSmtp } = await importarSmtp(CONFIG_OK);
    const f = fabricaFalsa(async () => {
      throw erroSmtp({ code: 'EAUTH', response: `535 bad ${SENHA}` });
    });
    await enviarEmailSmtp(MENSAGEM, f.fabrica).catch(() => undefined);
    const tudo = [...log.mock.calls, ...vi.mocked(console.error).mock.calls].flat().map(String).join(' ');
    expect(tudo).not.toContain(SENHA);
  });
});
