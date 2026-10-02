import { describe, expect, it } from 'vitest';
import { lerMensagemEmail } from '../../../src/fretes/email/lerMensagemEmail.js';
import { emailBruto } from './emailsFixtures.js';

describe('leitura do e-mail bruto', () => {
  it('Message-ID vira a chave; In-Reply-To entra nos ids relacionados', async () => {
    const m = await lerMensagemEmail(
      emailBruto({ messageId: '<abc@transportadora.test>', inReplyTo: '<envio@etk.ind.br>', assunto: 'Re: Cotacao de Frete ETK | FRE-2026-000001-abcd1234', corpo: 'VALOR_FRETE: 10' }),
    );
    expect(m).toMatchObject({
      messageId: '<abc@transportadora.test>',
      chave: '<abc@transportadora.test>',
      idsRelacionados: ['<envio@etk.ind.br>'],
      remetente: 'cotacao@transportadora.test',
      assunto: 'Re: Cotacao de Frete ETK | FRE-2026-000001-abcd1234',
    });
    expect(m.texto).toContain('VALOR_FRETE: 10');
  });

  it('sem Message-ID: chave determinística (mesmo e-mail → mesma chave; outro conteúdo → outra chave)', async () => {
    const a = await lerMensagemEmail(emailBruto({ messageId: null, assunto: 'Re: FRE-2026-000001-abcd1234', corpo: 'VALOR_FRETE: 10' }));
    const b = await lerMensagemEmail(emailBruto({ messageId: null, assunto: 'Re: FRE-2026-000001-abcd1234', corpo: 'VALOR_FRETE: 10' }));
    const c = await lerMensagemEmail(emailBruto({ messageId: null, assunto: 'Re: FRE-2026-000001-abcd1234', corpo: 'VALOR_FRETE: 11' }));
    expect(a.messageId).toBeNull();
    expect(a.chave).toMatch(/^sem-message-id:[0-9a-f]{64}$/);
    expect(b.chave).toBe(a.chave);
    expect(c.chave).not.toBe(a.chave);
  });

  it('resposta só em HTML vira texto legível pelo parser', async () => {
    const m = await lerMensagemEmail(emailBruto({ html: true, assunto: 'Re: FRE-2026-000001-abcd1234', corpo: '<div>VALOR_FRETE: 1.500,00</div><div>PRAZO_DIAS: 3</div>' }));
    expect(m.texto).toMatch(/VALOR_FRETE: 1\.500,00\s+PRAZO_DIAS: 3/);
  });
});
