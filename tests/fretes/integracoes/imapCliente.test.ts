import { afterEach, describe, expect, it, vi } from 'vitest';

// Cliente IMAP com `imapflow` simulado — nenhuma conexão real.

const SENHA = 'SenhaImap#Teste2026';
const chamadas: { metodo: string; args: unknown[] }[] = [];
let uidsNaCaixa: number[] = [];
let falhaConexao: Error | null = null;

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(readonly opcoes: unknown) {
      chamadas.push({ metodo: 'constructor', args: [opcoes] });
    }
    on() {}
    async connect() {
      if (falhaConexao !== null) throw falhaConexao;
    }
    async mailboxOpen(...args: unknown[]) {
      chamadas.push({ metodo: 'mailboxOpen', args });
      return { uidValidity: 77n };
    }
    async search(...args: unknown[]) {
      chamadas.push({ metodo: 'search', args });
      return uidsNaCaixa;
    }
    async *fetch(range: string, ...resto: unknown[]) {
      chamadas.push({ metodo: 'fetch', args: [range, ...resto] });
      for (const uid of range.split(',').map(Number)) yield { uid, source: Buffer.from(`mensagem ${uid}`) };
    }
    async messageFlagsAdd(...args: unknown[]) {
      chamadas.push({ metodo: 'messageFlagsAdd', args });
    }
    async logout() {
      chamadas.push({ metodo: 'logout', args: [] });
    }
    close() {}
  },
}));

async function fonte(env: Record<string, string> = {}) {
  Object.assign(process.env, { IMAP_HOST: 'imap.exemplo.test', IMAP_PORT: '993', IMAP_USER: 'nfe@etk.ind.br', IMAP_PASS: SENHA, IMAP_MAILBOX: 'INBOX', ...env });
  vi.resetModules();
  const mod = await import('../../../src/fretes/integracoes/imapCliente.js');
  return { mod, fonte: mod.criarFonteImap() };
}

afterEach(() => {
  chamadas.length = 0;
  uidsNaCaixa = [];
  falhaConexao = null;
  for (const n of ['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_PASS', 'IMAP_MAILBOX']) delete process.env[n];
});

describe('cliente IMAP', () => {
  it('SSL/TLS, caixa somente leitura, sem marcar como lido; busca por UID (não por "não lido")', async () => {
    uidsNaCaixa = [10, 11, 12];
    const { fonte: f } = await fonte();
    const lote = await f.buscarNovas({ uidvalidity: 77, ultimoUid: 10 }, 30);

    expect(chamadas.find((c) => c.metodo === 'constructor')?.args[0]).toMatchObject({ host: 'imap.exemplo.test', port: 993, secure: true, logger: false });
    expect(chamadas.find((c) => c.metodo === 'mailboxOpen')?.args).toEqual(['INBOX', { readOnly: true }]);
    const busca = chamadas.find((c) => c.metodo === 'search')?.args[0] as Record<string, unknown>;
    expect(busca).toEqual({ uid: '11:*' });
    expect(busca).not.toHaveProperty('seen');
    expect(chamadas.some((c) => c.metodo === 'messageFlagsAdd')).toBe(false);
    // "N:*" pode devolver a última já vista — filtrada; e-mail já lido entra normalmente.
    expect(lote).toMatchObject({ mailbox: 'INBOX', uidvalidity: 77, restantes: 0 });
    expect(lote.mensagens.map((m) => m.uid)).toEqual([11, 12]);
    expect(chamadas.some((c) => c.metodo === 'logout')).toBe(true);
  });

  it('sem cursor (ou UIDVALIDITY diferente) olha a janela inicial por data; lote limitado', async () => {
    uidsNaCaixa = [5, 3, 4];
    const { fonte: f } = await fonte();
    const lote = await f.buscarNovas({ uidvalidity: 1, ultimoUid: 999 }, 2);
    expect(chamadas.find((c) => c.metodo === 'search')?.args[0]).toHaveProperty('since');
    expect(lote.mensagens.map((m) => m.uid)).toEqual([3, 4]);
    expect(lote.restantes).toBe(1);
  });

  it('sem configuração → erro controlado sem conectar', async () => {
    const { mod, fonte: f } = await fonte({ IMAP_PASS: '' });
    await expect(f.buscarNovas(null, 10)).rejects.toBeInstanceOf(mod.ErroImapNaoConfigurado);
    expect(chamadas.some((c) => c.metodo === 'constructor')).toBe(false);
  });

  it('falha de autenticação → IMAP_AUTENTICACAO sem a senha', async () => {
    falhaConexao = Object.assign(new Error(`Authentication failed for nfe@etk.ind.br pass ${SENHA}`), { authenticationFailed: true });
    const { fonte: f } = await fonte();
    const erro = (await f.buscarNovas(null, 10).catch((e: unknown) => e)) as Error;
    expect(erro.message).toMatch(/^IMAP_AUTENTICACAO: /);
    expect(erro.message).not.toContain(SENHA);
    expect(erro.message).not.toContain('nfe@etk.ind.br');
  });
});
