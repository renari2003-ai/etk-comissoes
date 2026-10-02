import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DependenciasJobEmails } from '../../src/fretes/jobEmailsRespostaServico.js';
import type { CursorImap, DadosRegistroEmail, EmailResposta } from '../../src/fretes/emailsRespostaRepositorio.js';
import type { PayloadRespostaWebhook } from '../../src/fretes/webhookCotacoes.js';
import type { SolicitacaoCotacao } from '../../src/fretes/tipos.js';
import { lerMensagemEmail } from '../../src/fretes/email/lerMensagemEmail.js';
import { emailBruto } from './email/emailsFixtures.js';

// Job IMAP de respostas com todas as dependências em memória — nenhum banco, nenhum servidor.

const SENHA_IMAP = 'SenhaImap#Teste2026';
process.env.IMAP_PASS = SENHA_IMAP;
process.env.IMAP_MAILBOX = 'INBOX';
const { servicoProcessarEmailsResposta, LIMITE_TENTATIVAS } = await import('../../src/fretes/jobEmailsRespostaServico.js');

const REF = 'FRE-2026-000123-abcd1234';
const SOLICITACAO = { id: 'sol-1', codigoReferencia: REF, canal: 'EMAIL', identificadorExterno: '<envio-1@etk.ind.br>' } as SolicitacaoCotacao;

function ambiente(mensagens: Buffer[]) {
  const emails = new Map<string, EmailResposta>();
  let cursor: CursorImap | null = null;
  const auditoria: { acao: string; valorNovo?: unknown }[] = [];
  const respostasProcessadas = new Set<string>();
  let falharProcessamento: Error | null = null;
  let travado = false;

  const deps: DependenciasJobEmails = {
    fonte: {
      buscarNovas: vi.fn(async (c: CursorImap | null) => {
        const todas = mensagens.map((fonte, i) => ({ uid: i + 1, fonte }));
        const novas = todas.filter((m) => c === null || m.uid > c.ultimoUid);
        return { mailbox: 'INBOX', uidvalidity: 77, mensagens: novas, restantes: 0 };
      }),
    },
    lerMensagem: lerMensagemEmail,
    executarComLock: (async (fn: () => Promise<unknown>) => (travado ? { executou: false } : { executou: true, resultado: await fn() })) as DependenciasJobEmails['executarComLock'],
    lerCursor: vi.fn(async () => cursor),
    salvarCursor: vi.fn(async (_m: string, c: CursorImap) => {
      cursor = c;
    }),
    buscarEmail: vi.fn(async (chave: string) => emails.get(chave) ?? null),
    registrarEmail: vi.fn(async (d: DadosRegistroEmail) => {
      const anterior = emails.get(d.chaveMensagem);
      const registro = { ...d, id: `email-${emails.size + 1}`, tentativas: (anterior?.tentativas ?? 0) + 1 } as unknown as EmailResposta;
      emails.set(d.chaveMensagem, registro);
      return registro;
    }),
    buscarSolicitacaoPorReferencia: vi.fn(async (ref: string) => (ref === REF ? SOLICITACAO : null)),
    buscarSolicitacoesPorMessageId: vi.fn(async (ids: string[]) => (ids.includes('<envio-1@etk.ind.br>') ? [SOLICITACAO] : [])),
    processarResposta: vi.fn(async (p: PayloadRespostaWebhook) => {
      if (falharProcessamento !== null) throw falharProcessamento;
      const duplicado = respostasProcessadas.has(p.mensagemId);
      respostasProcessadas.add(p.mensagemId);
      return { resposta: { id: `resp-${p.mensagemId}` }, extracao: {}, proposta: p.extracao.valorFrete === null ? null : { id: 'prop-1' }, duplicado } as never;
    }),
    registrarAuditoria: vi.fn(async (d: { acao: string; valorNovo?: unknown }) => {
      auditoria.push(d);
    }) as unknown as DependenciasJobEmails['registrarAuditoria'],
    agora: Date.now,
  };
  return {
    deps,
    emails,
    auditoria,
    cursor: () => cursor,
    falhar: (e: Error | null) => {
      falharProcessamento = e;
    },
    travar: () => {
      travado = true;
    },
  };
}

const respostaValida = (extra: Partial<Parameters<typeof emailBruto>[0]> = {}) =>
  emailBruto({ assunto: `RE: Cotacao de Frete ETK | ${REF}`, corpo: 'VALOR_FRETE: 1.500,00\nPRAZO_DIAS: 4\nVALIDADE: 15/10/2026', ...extra });

beforeEach(() => vi.restoreAllMocks());

describe('job IMAP de respostas por e-mail', () => {
  it('correlaciona pela referência FRE e entrega o valor REAL (frete base, sem imposto) ao serviço de resposta existente', async () => {
    const amb = ambiente([respostaValida()]);
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r).toMatchObject({ status: 'OK', encontradas: 1, processadas: 1, revisao: 0, duplicadas: 0 });
    expect(amb.deps.processarResposta).toHaveBeenCalledWith(
      expect.objectContaining({
        referencia: REF,
        canal: 'EMAIL',
        mensagemId: '<resposta-1@transportadora.test>',
        versaoExtrator: 'email-imap-v1',
        extracao: expect.objectContaining({ valorFrete: 1500, prazoDias: 4, validade: '2026-10-15', confianca: null }),
      }),
    );
    expect([...amb.emails.values()][0]).toMatchObject({ status: 'PROCESSADO', referencia: REF, solicitacaoId: 'sol-1' });
    expect(amb.cursor()).toEqual({ uidvalidity: 77, ultimoUid: 1 });
    expect(amb.auditoria.map((a) => a.acao)).toEqual(['JOB_EMAILS_INICIADO', 'JOB_EMAILS_CONCLUIDO']);
  });

  it('Message-ID evita duplicidade: a mesma mensagem relida (cursor perdido) não é processada de novo', async () => {
    const amb = ambiente([respostaValida()]);
    await servicoProcessarEmailsResposta(amb.deps);
    await amb.deps.salvarCursor('INBOX', { uidvalidity: 77, ultimoUid: 0 }); // simula releitura da caixa
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r).toMatchObject({ processadas: 0, duplicadas: 1 });
    expect(amb.deps.processarResposta).toHaveBeenCalledTimes(1);
  });

  it('sem Message-ID: chave determinística também evita duplicidade', async () => {
    const amb = ambiente([respostaValida({ messageId: null }), respostaValida({ messageId: null })]);
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r).toMatchObject({ processadas: 1, duplicadas: 1 });
    expect(vi.mocked(amb.deps.processarResposta).mock.calls[0]?.[0].mensagemId).toMatch(/^sem-message-id:/);
  });

  it('resposta sem valor → revisão manual (resposta registrada, sem proposta inventada)', async () => {
    const amb = ambiente([respostaValida({ corpo: 'Segue proposta em anexo.' })]);
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r).toMatchObject({ processadas: 0, revisao: 1 });
    expect(vi.mocked(amb.deps.processarResposta).mock.calls[0]?.[0].extracao.valorFrete).toBeNull();
    expect([...amb.emails.values()][0]).toMatchObject({ status: 'REVISAO_MANUAL', motivo: 'VALOR_FRETE ausente', respostaId: expect.any(String) });
    expect(amb.auditoria.map((a) => a.acao)).toContain('EMAIL_RESPOSTA_REVISAO_MANUAL');
  });

  it('valor ambíguo → revisão manual, valorFrete null', async () => {
    const amb = ambiente([respostaValida({ corpo: 'VALOR_FRETE: 1.500' })]);
    await servicoProcessarEmailsResposta(amb.deps);
    expect(vi.mocked(amb.deps.processarResposta).mock.calls[0]?.[0].extracao.valorFrete).toBeNull();
    expect([...amb.emails.values()][0]?.status).toBe('REVISAO_MANUAL');
  });

  it('sem referência (assunto do fluxo, sem FRE) → revisão manual guardando o texto; nada é processado', async () => {
    const amb = ambiente([emailBruto({ assunto: 'RE: Cotacao de Frete ETK', corpo: 'VALOR_FRETE: 900,00' })]);
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r).toMatchObject({ revisao: 1 });
    expect(amb.deps.processarResposta).not.toHaveBeenCalled();
    expect([...amb.emails.values()][0]).toMatchObject({ status: 'REVISAO_MANUAL', conteudo: expect.stringContaining('VALOR_FRETE: 900,00') });
  });

  it('referência inexistente → revisão (nunca associa por aproximação)', async () => {
    const amb = ambiente([emailBruto({ assunto: 'RE: FRE-2026-000999-ffffffff', corpo: 'VALOR_FRETE: 900,00' })]);
    await servicoProcessarEmailsResposta(amb.deps);
    expect(amb.deps.processarResposta).not.toHaveBeenCalled();
    expect([...amb.emails.values()][0]?.motivo).toMatch(/não corresponde/);
  });

  it('assunto sem referência, mas In-Reply-To = Message-ID do envio SMTP → correlaciona', async () => {
    const amb = ambiente([emailBruto({ assunto: 'Resposta', inReplyTo: '<envio-1@etk.ind.br>', corpo: 'VALOR_FRETE: 1500.00' })]);
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r.processadas).toBe(1);
    expect(vi.mocked(amb.deps.processarResposta).mock.calls[0]?.[0]).toMatchObject({ referencia: REF, extracao: expect.objectContaining({ valorFrete: 1500 }) });
  });

  it('e-mail fora do fluxo de fretes é ignorado sem gravar nada', async () => {
    const amb = ambiente([emailBruto({ assunto: 'Newsletter', corpo: 'promoção' })]);
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r).toMatchObject({ ignoradas: 1, processadas: 0 });
    expect(amb.emails.size).toBe(0);
    expect(amb.cursor()?.ultimoUid).toBe(1);
  });

  it('falha técnica: ERRO sanitizado, lote para e cursor não avança; após o limite vai para revisão', async () => {
    const amb = ambiente([respostaValida()]);
    amb.falhar(new Error(`timeout no banco password=${SENHA_IMAP}`));
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r).toMatchObject({ status: 'ERRO', erros: 1 });
    expect(r.erro).not.toContain(SENHA_IMAP);
    expect(amb.cursor()).toBeNull();
    for (let i = 1; i < LIMITE_TENTATIVAS; i += 1) await servicoProcessarEmailsResposta(amb.deps);
    const final = await servicoProcessarEmailsResposta(amb.deps);
    expect(final).toMatchObject({ revisao: 1 });
    expect([...amb.emails.values()][0]?.status).toBe('REVISAO_MANUAL');
    expect(amb.cursor()?.ultimoUid).toBe(1);
  });

  it('execução concorrente → PULADO_LOCK sem ler a caixa', async () => {
    const amb = ambiente([respostaValida()]);
    amb.travar();
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r.status).toBe('PULADO_LOCK');
    expect(amb.deps.fonte.buscarNovas).not.toHaveBeenCalled();
  });

  it('erro do IMAP (ex.: autenticação) é sanitizado no resumo, na auditoria e nos logs', async () => {
    const log = vi.spyOn(console, 'log');
    const erro = vi.spyOn(console, 'error');
    const amb = ambiente([]);
    amb.deps.fonte.buscarNovas = vi.fn(async () => {
      throw new Error(`IMAP_AUTENTICACAO: falhou para pass=${SENHA_IMAP}`);
    });
    const r = await servicoProcessarEmailsResposta(amb.deps);
    expect(r.status).toBe('ERRO');
    const tudo = JSON.stringify([r, amb.auditoria, log.mock.calls, erro.mock.calls]);
    expect(tudo).not.toContain(SENHA_IMAP);
    expect(amb.auditoria.map((a) => a.acao)).toContain('JOB_EMAILS_FALHOU');
  });
});
