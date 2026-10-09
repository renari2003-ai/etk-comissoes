import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { validarEventoYCloud, verificarAssinaturaYCloud } from '../../src/fretes/webhookYCloud.js';
import { servicoProcessarEventoYCloud, type DependenciasWebhookYCloud } from '../../src/fretes/webhookYCloudServico.js';
import { capturarCorpoBruto, obterCorpoBruto } from '../../src/rotas/corpoBruto.js';
import type { PayloadRespostaWebhook } from '../../src/fretes/webhookCotacoes.js';
import type { SolicitacaoCotacao } from '../../src/fretes/tipos.js';
import type { DadosWhatsappRecebida, WhatsappRecebida } from '../../src/fretes/whatsappRecebidasRepositorio.js';
import type { IncomingMessage } from 'node:http';

// Webhook direto da YCloud: assinatura, contrato e processamento — dependências em memória.

const SEGREDO = 'whsec_segredo_de_teste';
const REF = 'FRE-2026-000123-abcd1234';
const SOLICITACAO = { id: 'sol-1', codigoReferencia: REF, canal: 'WHATSAPP', wamidOutbound: 'wamid.ENVIO1', telefoneDestino: '+5511987654321' } as SolicitacaoCotacao;

function assinar(corpo: string, t: number, segredo = SEGREDO): string {
  return `t=${t},s=${createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex')}`;
}

function eventoTexto(texto: string, extra: { wamid?: string; contextoId?: string | null } = {}) {
  return {
    id: 'evt_1',
    type: 'whatsapp.inbound_message.received',
    apiVersion: 'v2',
    whatsappInboundMessage: {
      id: 'yc-in-1',
      wamid: extra.wamid ?? 'wamid.RESPOSTA1',
      from: '5511987654321',
      to: '5511900000000',
      sendTime: '2026-10-02T12:00:00.000Z',
      type: 'text',
      text: { body: texto },
      ...(extra.contextoId === null ? {} : { context: { from: '5511900000000', id: extra.contextoId ?? 'wamid.ENVIO1' } }),
    },
  };
}

function ambiente() {
  const recebidas = new Map<string, WhatsappRecebida>();
  const respostas = new Set<string>();
  const auditoria: { acao: string; valorNovo?: unknown }[] = [];
  const deps: DependenciasWebhookYCloud = {
    buscarRecebida: vi.fn(async (c: string) => recebidas.get(c) ?? null),
    registrarRecebida: vi.fn(async (d: DadosWhatsappRecebida) => {
      if (recebidas.has(d.chaveMensagem)) return null;
      const r = { ...d, id: `rec-${recebidas.size + 1}`, criadoEm: '' } as WhatsappRecebida;
      recebidas.set(d.chaveMensagem, r);
      return r;
    }),
    buscarPorWamid: vi.fn(async (w: string) => (w === 'wamid.ENVIO1' ? SOLICITACAO : null)),
    buscarPorReferencia: vi.fn(async (r: string) => (r === REF ? SOLICITACAO : null)),
    buscarPorYcloudId: vi.fn(async (id: string) => (id === 'yc-out-1' ? { ...SOLICITACAO, wamidOutbound: null } : null)),
    registrarWamid: vi.fn(async () => ({ solicitacao: SOLICITACAO, duplicado: false })),
    marcarEntregue: vi.fn(async () => SOLICITACAO),
    marcarFalhaEntrega: vi.fn(async () => SOLICITACAO),
    processarResposta: vi.fn(async (p: PayloadRespostaWebhook) => {
      const duplicado = respostas.has(p.mensagemId);
      respostas.add(p.mensagemId);
      return { resposta: { id: `resp-${p.mensagemId}` }, extracao: {}, proposta: null, duplicado } as never;
    }),
    registrarAuditoria: vi.fn(async (d: { acao: string; valorNovo?: unknown }) => {
      auditoria.push(d);
    }) as unknown as DependenciasWebhookYCloud['registrarAuditoria'],
  };
  return { deps, recebidas, auditoria };
}

const processar = (corpo: unknown, deps: DependenciasWebhookYCloud) => servicoProcessarEventoYCloud(validarEventoYCloud(corpo), deps);

describe('núcleo WhatsApp usado pela Meta', () => {
  it('processa reply Meta uma vez e mantém origem do extrator sem ID YCloud', async () => {
    const { deps, recebidas } = ambiente();
    const evento = validarEventoYCloud(eventoTexto('VALOR_FRETE: 100\nPRAZO_DIAS: 3'));
    await servicoProcessarEventoYCloud(evento, deps, 'meta');
    await servicoProcessarEventoYCloud(evento, deps, 'meta');
    expect(deps.processarResposta).toHaveBeenCalledTimes(1);
    expect(deps.processarResposta).toHaveBeenCalledWith(expect.objectContaining({ canal: 'WHATSAPP', versaoExtrator: 'whatsapp-meta-v1', mensagemId: 'wamid.RESPOSTA1' }));
    expect([...recebidas.values()][0]?.ycloudId).toBeNull();
  });
});

describe('assinatura YCloud-Signature', () => {
  const corpo = JSON.stringify(eventoTexto('oi'));
  const agora = 1_790_000_000;

  it('válida com o segredo e o corpo exatos', () => {
    expect(verificarAssinaturaYCloud(assinar(corpo, agora), Buffer.from(corpo), SEGREDO, agora)).toBe(true);
  });

  it('recusa: segredo errado, corpo alterado, timestamp antigo (replay), cabeçalho ausente, segredo vazio no servidor', () => {
    expect(verificarAssinaturaYCloud(assinar(corpo, agora, 'outro'), Buffer.from(corpo), SEGREDO, agora)).toBe(false);
    expect(verificarAssinaturaYCloud(assinar(corpo, agora), Buffer.from(`${corpo} `), SEGREDO, agora)).toBe(false);
    expect(verificarAssinaturaYCloud(assinar(corpo, agora - 600), Buffer.from(corpo), SEGREDO, agora)).toBe(false);
    expect(verificarAssinaturaYCloud(undefined, Buffer.from(corpo), SEGREDO, agora)).toBe(false);
    expect(verificarAssinaturaYCloud(assinar(corpo, agora, ''), Buffer.from(corpo), '', agora)).toBe(false);
    expect(verificarAssinaturaYCloud(assinar(corpo, agora), null, SEGREDO, agora)).toBe(false);
  });

  it('corpo bruto só é guardado para as rotas da YCloud', () => {
    const req = { url: '/api/fretes/integracoes/ycloud/webhook' } as IncomingMessage;
    const outra = { url: '/api/fretes/cotacoes' } as IncomingMessage;
    capturarCorpoBruto(req, null, Buffer.from('abc'));
    capturarCorpoBruto(outra, null, Buffer.from('abc'));
    expect(obterCorpoBruto(req)?.toString()).toBe('abc');
    expect(obterCorpoBruto(outra)).toBeNull();
  });
});

describe('contrato do evento', () => {
  it('payload malformado é recusado (400), nunca interpretado pela metade', () => {
    expect(() => validarEventoYCloud({ type: 'whatsapp.inbound_message.received' })).toThrow(/"id"/);
    expect(() => validarEventoYCloud({ id: 'e', type: 'whatsapp.inbound_message.received', whatsappInboundMessage: { id: 'x', type: 'text', text: { body: 5 } } })).toThrow(/text.body/);
    expect(() => validarEventoYCloud({ id: 'e', type: 'whatsapp.message.updated', whatsappMessage: { id: 'x' } })).toThrow(/status/);
  });
  it('outros tipos de evento são aceitos e ignorados', async () => {
    const { deps } = ambiente();
    expect(await processar({ id: 'e', type: 'whatsapp.template.reviewed' }, deps)).toEqual({ evento: 'IGNORADO', desfecho: 'IGNORADO' });
  });
});

describe('mensagem recebida', () => {
  it('reply: correlaciona pelo context.id e entrega o valor REAL ao serviço de resposta (canal WHATSAPP, chave = wamid)', async () => {
    const { deps, recebidas } = ambiente();
    const r = await processar(eventoTexto('VALOR_FRETE: 1.850,00\nPRAZO_DIAS: 3\nVALIDADE: 2026-10-20'), deps);
    expect(r).toEqual({ evento: 'MENSAGEM_RECEBIDA', desfecho: 'PROCESSADA', motivo: null });
    expect(deps.buscarPorWamid).toHaveBeenCalledWith('wamid.ENVIO1');
    expect(deps.processarResposta).toHaveBeenCalledWith(
      expect.objectContaining({ referencia: REF, canal: 'WHATSAPP', mensagemId: 'wamid.RESPOSTA1', extracao: expect.objectContaining({ valorFrete: 1850, prazoDias: 3, validade: '2026-10-20' }) }),
    );
    expect(recebidas.get('wamid.RESPOSTA1')).toMatchObject({ status: 'PROCESSADO', solicitacaoId: 'sol-1', contextoId: 'wamid.ENVIO1' });
  });

  it('mesma mensagem reentregue pela YCloud é ignorada (idempotência por wamid)', async () => {
    const { deps } = ambiente();
    await processar(eventoTexto('VALOR_FRETE: 1850'), deps);
    const r = await processar(eventoTexto('VALOR_FRETE: 1850'), deps);
    expect(r.desfecho).toBe('DUPLICADA');
    expect(deps.processarResposta).toHaveBeenCalledTimes(1);
  });

  it('sem reply e sem referência → revisão manual, sem resposta/proposta', async () => {
    const { deps, recebidas } = ambiente();
    const r = await processar(eventoTexto('Bom dia, sai por 1500', { contextoId: null }), deps);
    expect(r.desfecho).toBe('REVISAO');
    expect(deps.processarResposta).not.toHaveBeenCalled();
    expect(recebidas.get('wamid.RESPOSTA1')).toMatchObject({ status: 'REVISAO_MANUAL', texto: 'Bom dia, sai por 1500' });
  });

  it('sem reply mas com UMA referência FRE no texto → correlaciona pela referência (apoio)', async () => {
    const { deps } = ambiente();
    const r = await processar(eventoTexto(`${REF}\nVALOR_FRETE: 1500.00`, { contextoId: null }), deps);
    expect(r.desfecho).toBe('PROCESSADA');
    expect(vi.mocked(deps.processarResposta).mock.calls[0]?.[0].extracao.valorFrete).toBe(1500);
  });

  it('reply a uma cotação citando OUTRA referência → revisão (nunca escolhe)', async () => {
    const { deps } = ambiente();
    const r = await processar(eventoTexto('FRE-2026-000999-ffffffff VALOR_FRETE: 10'), deps);
    expect(r).toMatchObject({ desfecho: 'REVISAO', motivo: expect.stringMatching(/ambígua/) });
    expect(deps.processarResposta).not.toHaveBeenCalled();
  });

  it('valor ambíguo ou ausente → resposta registrada sem valor e revisão manual', async () => {
    const { deps } = ambiente();
    const r = await processar(eventoTexto('VALOR_FRETE: 1.500'), deps);
    expect(r.desfecho).toBe('REVISAO');
    expect(vi.mocked(deps.processarResposta).mock.calls[0]?.[0].extracao.valorFrete).toBeNull();
  });
});

describe('status da mensagem enviada', () => {
  const status = (s: string, extra: Record<string, unknown> = {}) => ({ id: 'evt_s', type: 'whatsapp.message.updated', whatsappMessage: { id: 'yc-out-1', wamid: 'wamid.NOVO', status: s, ...extra } });

  it('completa o wamid que faltava e marca ENTREGUE só com delivered/read', async () => {
    const { deps } = ambiente();
    expect(await processar(status('delivered'), deps)).toEqual({ evento: 'STATUS', desfecho: 'ATUALIZADO' });
    expect(deps.registrarWamid).toHaveBeenCalledWith(expect.objectContaining({ solicitacaoId: 'sol-1', wamidOutbound: 'wamid.NOVO', ycloudMessageId: 'yc-out-1' }));
    expect(deps.marcarEntregue).toHaveBeenCalledWith('sol-1');
    vi.mocked(deps.marcarEntregue).mockClear();
    await processar(status('sent'), deps);
    expect(deps.marcarEntregue).not.toHaveBeenCalled();
  });

  it('failed → ERRO com motivo sanitizado', async () => {
    const { deps } = ambiente();
    await processar(status('failed', { errorCode: 131026, errorMessage: 'Message undeliverable' }), deps);
    expect(deps.marcarFalhaEntrega).toHaveBeenCalledWith('sol-1', expect.stringMatching(/^YCLOUD_FALHA_ENTREGA: .*131026 Message undeliverable/));
  });

  it('status de mensagem que não é nossa → sem efeito', async () => {
    const { deps } = ambiente();
    const r = await processar({ id: 'e', type: 'whatsapp.message.updated', whatsappMessage: { id: 'outra', status: 'delivered' } }, deps);
    expect(r).toEqual({ evento: 'STATUS', desfecho: 'SEM_SOLICITACAO' });
  });
});
