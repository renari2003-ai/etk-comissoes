/** E-mails brutos (RFC 822) para os testes do job IMAP — nenhum dado real. */
export interface OpcoesEmailTeste {
  messageId?: string | null;
  assunto: string;
  corpo: string;
  inReplyTo?: string;
  html?: boolean;
  de?: string;
}

export function emailBruto(o: OpcoesEmailTeste): Buffer {
  const linhas = [
    `From: Transportadora Teste <${o.de ?? 'cotacao@transportadora.test'}>`,
    'To: nfe@etk.ind.br',
    `Subject: ${o.assunto}`,
    'Date: Fri, 02 Oct 2026 10:00:00 -0300',
    o.messageId === null ? null : `Message-ID: ${o.messageId ?? '<resposta-1@transportadora.test>'}`,
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : null,
    'MIME-Version: 1.0',
    `Content-Type: ${o.html ? 'text/html' : 'text/plain'}; charset=utf-8`,
    'Content-Transfer-Encoding: 8bit',
    '',
    o.corpo,
  ].filter((l): l is string => l !== null);
  return Buffer.from(linhas.join('\r\n'), 'utf8');
}
