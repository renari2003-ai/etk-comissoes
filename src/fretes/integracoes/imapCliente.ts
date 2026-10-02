/**
 * Leitura IMAP direta das respostas por e-mail (Fase 2 da migração n8n → backend). Único ponto
 * do módulo de Fretes que fala IMAP.
 *
 * - Sempre SSL/TLS; credenciais só de `config` (ambiente do servidor), nunca logadas.
 * - Caixa aberta com EXAMINE (somente leitura) e conteúdo lido com BODY.PEEK: nunca apaga,
 *   move nem marca como lido — o operador continua usando a caixa normalmente.
 * - NÃO depende de "não lido": a posição é um cursor por UID (`UIDVALIDITY` + último UID
 *   processado). Sem cursor válido, olha os últimos `DIAS_JANELA_INICIAL` dias; a
 *   idempotência por Message-ID garante que reler não duplica nada.
 */
import { ImapFlow } from 'imapflow';
import { config } from '../../config.js';
import type { CursorImap } from '../emailsRespostaRepositorio.js';
import { sanitizarTextoErro } from './sanitizacao.js';

export const DIAS_JANELA_INICIAL = 7;

export interface MensagemImap {
  uid: number;
  /** E-mail bruto (RFC 822) — decodificado depois por `lerMensagemEmail`. */
  fonte: Buffer;
}

export interface LoteImap {
  mailbox: string;
  uidvalidity: number;
  /** Em ordem crescente de UID, no máximo `limite` itens. */
  mensagens: MensagemImap[];
  /** Quantas mensagens novas existiam além do lote (ficam para a próxima execução). */
  restantes: number;
}

/** Fonte de e-mails — injetável em teste (nenhuma conexão real). */
export interface FonteEmails {
  buscarNovas(cursor: CursorImap | null, limite: number): Promise<LoteImap>;
}

export class ErroImapNaoConfigurado extends Error {
  constructor() {
    super('IMAP_NAO_CONFIGURADO: configure IMAP_HOST, IMAP_USER e IMAP_PASS no servidor.');
    this.name = 'ErroImapNaoConfigurado';
  }
}

export class ErroImapFalhou extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ErroImapFalhou';
  }
}

function motivoImap(erro: unknown): string {
  const e = (erro ?? {}) as { authenticationFailed?: unknown; code?: unknown; message?: unknown; responseText?: unknown };
  const codigo = typeof e.code === 'string' ? e.code : '';
  const tipo =
    e.authenticationFailed === true
      ? 'IMAP_AUTENTICACAO: o servidor IMAP recusou o usuário/senha configurados'
      : /TIMEOUT|ETIMEDOUT/i.test(codigo)
        ? 'IMAP_TIMEOUT: tempo limite excedido na comunicação com o servidor IMAP'
        : /ECONN|ENOTFOUND|EHOST|NoConnection|ETLS|ESOCKET/i.test(codigo)
          ? 'IMAP_CONEXAO: não foi possível conectar ao servidor IMAP'
          : 'IMAP_FALHA: o servidor IMAP não atendeu a leitura';
  const bruto = typeof e.responseText === 'string' && e.responseText !== '' ? e.responseText : typeof e.message === 'string' ? e.message : '';
  let detalhe = sanitizarTextoErro(bruto.replace(/\s+/g, ' ').trim(), [config.imapPass, config.imapUser]);
  if (detalhe.length > 300) detalhe = `${detalhe.slice(0, 300)}…`;
  return `${tipo}.${detalhe === '' ? '' : ` Servidor: ${detalhe}`}`;
}

export function criarFonteImap(): FonteEmails {
  return {
    async buscarNovas(cursor, limite) {
      const host = config.imapHost.trim();
      const usuario = config.imapUser.trim();
      if (host === '' || usuario === '' || config.imapPass === '') throw new ErroImapNaoConfigurado();
      const mailbox = config.imapMailbox;
      const cliente = new ImapFlow({
        host,
        port: config.imapPort,
        secure: true,
        auth: { user: usuario, pass: config.imapPass },
        logger: false,
        disableAutoIdle: true,
        connectionTimeout: config.imapTimeoutMs,
        greetingTimeout: config.imapTimeoutMs,
        socketTimeout: config.imapTimeoutMs * 3,
      });
      // Erros assíncronos do socket nunca derrubam o processo; o comando em curso já falha.
      cliente.on('error', () => undefined);
      try {
        await cliente.connect();
        const caixa = await cliente.mailboxOpen(mailbox, { readOnly: true });
        const uidvalidity = Number(caixa.uidValidity);

        const cursorValido = cursor !== null && cursor.uidvalidity === uidvalidity;
        const busca = cursorValido
          ? await cliente.search({ uid: `${cursor.ultimoUid + 1}:*` }, { uid: true })
          : await cliente.search({ since: new Date(Date.now() - DIAS_JANELA_INICIAL * 86_400_000) }, { uid: true });
        // "N:*" no IMAP sempre inclui a última mensagem mesmo com UID < N — filtra de novo.
        const minimo = cursorValido ? cursor.ultimoUid : 0;
        const uids = (Array.isArray(busca) ? busca : []).filter((u) => u > minimo).sort((a, b) => a - b);
        const escolhidos = uids.slice(0, limite);

        const mensagens: MensagemImap[] = [];
        if (escolhidos.length > 0) {
          for await (const msg of cliente.fetch(escolhidos.join(','), { uid: true, source: true }, { uid: true })) {
            if (msg.source !== undefined) mensagens.push({ uid: msg.uid, fonte: msg.source });
          }
        }
        mensagens.sort((a, b) => a.uid - b.uid);
        return { mailbox, uidvalidity, mensagens, restantes: uids.length - escolhidos.length };
      } catch (erro) {
        if (erro instanceof ErroImapNaoConfigurado) throw erro;
        throw new ErroImapFalhou(motivoImap(erro));
      } finally {
        await cliente.logout().catch(() => cliente.close());
      }
    },
  };
}
