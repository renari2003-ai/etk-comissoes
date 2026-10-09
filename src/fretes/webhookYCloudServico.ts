/**
 * Processamento dos eventos do webhook direto da YCloud (Fase 3 da migração n8n → backend).
 * Reaproveita o núcleo existente — nenhuma regra de proposta nova:
 *   - resposta → `servicoProcessarRespostaWebhook` (proposta nasce `PENDENTE_VALIDACAO`; sem
 *     `valorFrete` não há proposta; idempotente por `mensagemId`);
 *   - correlação por `context.id` → `buscarSolicitacaoPorWamidOutbound` (nunca adivinha).
 *
 * Mensagem recebida:
 *   chave já gravada                        → duplicada (nada é refeito)
 *   reply com context.id de um envio nosso   → solicitação dessa mensagem
 *   sem context.id mas UMA referência FRE    → solicitação da referência (apoio)
 *   context e referência divergentes / nada / mais de uma referência → REVISAO_MANUAL
 *   correlacionada → resposta registrada; PROCESSADO se a extração foi limpa, senão REVISAO_MANUAL
 *
 * Status (`whatsapp.message.updated`): completa o WAMID se faltava; `delivered`/`read` → ENTREGUE
 * (confirmação real); `failed` → ERRO com motivo sanitizado (operador usa "Reenviar").
 */
import { config } from '../config.js';
import { registrarAuditoria } from './auditoriaRepositorio.js';
import { extrairReferencias, extrairRespostaEmail } from './email/parserRespostaEmail.js';
import { sanitizarTextoErro } from './integracoes/sanitizacao.js';
import { servicoProcessarRespostaWebhook } from './integracaoCotacoesServico.js';
import {
  buscarSolicitacaoPorCodigoReferencia,
  buscarSolicitacaoPorWamidOutbound,
  buscarSolicitacaoPorYcloudMessageId,
  marcarSolicitacaoEntregue,
  marcarSolicitacaoFalhaEntrega,
  registrarWamidOutbound,
} from './solicitacoesRepositorio.js';
import type { SolicitacaoCotacao } from './tipos.js';
import type { EventoYCloud, MensagemRecebidaYCloud, StatusMensagemYCloud } from './webhookYCloud.js';
import { buscarWhatsappRecebidaPorChave, registrarWhatsappRecebida, type DadosWhatsappRecebida } from './whatsappRecebidasRepositorio.js';

export interface DependenciasWebhookYCloud {
  buscarRecebida: typeof buscarWhatsappRecebidaPorChave;
  registrarRecebida: typeof registrarWhatsappRecebida;
  buscarPorWamid: typeof buscarSolicitacaoPorWamidOutbound;
  buscarPorReferencia: typeof buscarSolicitacaoPorCodigoReferencia;
  buscarPorYcloudId: typeof buscarSolicitacaoPorYcloudMessageId;
  registrarWamid: typeof registrarWamidOutbound;
  marcarEntregue: typeof marcarSolicitacaoEntregue;
  marcarFalhaEntrega: typeof marcarSolicitacaoFalhaEntrega;
  processarResposta: typeof servicoProcessarRespostaWebhook;
  registrarAuditoria: typeof registrarAuditoria;
}

const DEPENDENCIAS_PADRAO: DependenciasWebhookYCloud = {
  buscarRecebida: buscarWhatsappRecebidaPorChave,
  registrarRecebida: registrarWhatsappRecebida,
  buscarPorWamid: buscarSolicitacaoPorWamidOutbound,
  buscarPorReferencia: buscarSolicitacaoPorCodigoReferencia,
  buscarPorYcloudId: buscarSolicitacaoPorYcloudMessageId,
  registrarWamid: registrarWamidOutbound,
  marcarEntregue: marcarSolicitacaoEntregue,
  marcarFalhaEntrega: marcarSolicitacaoFalhaEntrega,
  processarResposta: servicoProcessarRespostaWebhook,
  registrarAuditoria,
};

export type ResultadoWebhookYCloud =
  | { evento: 'MENSAGEM_RECEBIDA'; desfecho: 'PROCESSADA' | 'REVISAO' | 'DUPLICADA'; motivo: string | null }
  | { evento: 'STATUS'; desfecho: 'ATUALIZADO' | 'SEM_SOLICITACAO' | 'SEM_MUDANCA' }
  | { evento: 'IGNORADO'; desfecho: 'IGNORADO' };

async function processarMensagemRecebida(deps: DependenciasWebhookYCloud, m: MensagemRecebidaYCloud, provedor: 'ycloud' | 'meta'): Promise<ResultadoWebhookYCloud> {
  const chave = m.wamid ?? `ycloud:${m.ycloudId}`;
  if ((await deps.buscarRecebida(chave)) !== null) return { evento: 'MENSAGEM_RECEBIDA', desfecho: 'DUPLICADA', motivo: null };

  const base: Omit<DadosWhatsappRecebida, 'status' | 'motivo' | 'referencia' | 'solicitacaoId' | 'respostaId'> = {
    chaveMensagem: chave,
    ycloudId: provedor === 'meta' ? null : m.ycloudId,
    telefoneOrigem: m.de,
    contextoId: m.contextoId,
    tipo: m.tipo,
    texto: m.texto === null ? null : m.texto.slice(0, 4096),
    enviadaEm: m.enviadaEm,
  };
  const gravar = async (dados: DadosWhatsappRecebida): Promise<ResultadoWebhookYCloud> => {
    const registro = await deps.registrarRecebida(dados);
    if (registro === null) return { evento: 'MENSAGEM_RECEBIDA', desfecho: 'DUPLICADA', motivo: null }; // reentrega concorrente
    await deps.registrarAuditoria({
      usuarioId: null,
      origem: `webhook_${provedor}`,
      acao: dados.status === 'PROCESSADO' ? 'WHATSAPP_RECEBIDO' : 'WHATSAPP_REVISAO_MANUAL',
      entidade: 'whatsapp_recebida_frete',
      entidadeId: registro.id,
      valorNovo: { wamid: m.wamid, contextoId: m.contextoId, referencia: dados.referencia, solicitacaoId: dados.solicitacaoId, respostaId: dados.respostaId, motivo: dados.motivo },
    });
    return { evento: 'MENSAGEM_RECEBIDA', desfecho: dados.status === 'PROCESSADO' ? 'PROCESSADA' : 'REVISAO', motivo: dados.motivo };
  };
  const revisao = (motivo: string, extra: Partial<DadosWhatsappRecebida> = {}) =>
    gravar({ ...base, referencia: null, solicitacaoId: null, respostaId: null, ...extra, status: 'REVISAO_MANUAL', motivo });

  // Correlação: context.id (reply a uma mensagem nossa) é a chave; referência FRE no texto só
  // apoia (ou substitui quando não há reply). Divergência ou ausência → revisão. Nunca fuzzy.
  const porContexto = m.contextoId !== null ? await deps.buscarPorWamid(m.contextoId) : null;
  const referencias = m.texto === null ? [] : extrairReferencias(m.texto);
  let solicitacao: SolicitacaoCotacao | null = porContexto;
  if (porContexto !== null && referencias.length > 0 && !referencias.includes(porContexto.codigoReferencia)) {
    return revisao(`Reply à cotação ${porContexto.codigoReferencia}, mas o texto cita ${referencias.join(', ')} — correlação ambígua`);
  }
  if (solicitacao === null) {
    if (referencias.length > 1) return revisao(`Mais de uma referência no texto (${referencias.join(', ')}) — correlação ambígua`);
    if (referencias.length === 1) {
      solicitacao = await deps.buscarPorReferencia(referencias[0] as string);
      if (solicitacao === null) return revisao(`Referência ${referencias[0]} não corresponde a nenhuma solicitação`, { referencia: referencias[0] ?? null });
    }
  }
  if (solicitacao === null) {
    return revisao(m.contextoId !== null ? 'Reply a uma mensagem que não é de solicitação de cotação' : 'Mensagem sem reply (context.id) e sem referência FRE');
  }
  if (provedor === 'meta' && solicitacao.telefoneDestino !== null && m.de !== null && solicitacao.telefoneDestino.replace(/\D/g, '') !== m.de.replace(/\D/g, '')) {
    return revisao('Remetente diferente do destinatário da solicitação — conferir correlação manualmente');
  }

  const { extracao, problemas } =
    m.texto === null ? { extracao: extrairRespostaEmail('').extracao, problemas: [`Mensagem do tipo "${m.tipo}" sem texto`] } : extrairRespostaEmail(m.texto);
  const resultado = await deps.processarResposta({
    referencia: solicitacao.codigoReferencia,
    canal: 'WHATSAPP',
    mensagemId: chave,
    conteudoBruto: m.texto ?? `[mensagem do tipo ${m.tipo} sem texto]`,
    versaoExtrator: `whatsapp-${provedor}-v1`,
    extracao,
  });
  const vinculo = { referencia: solicitacao.codigoReferencia, solicitacaoId: solicitacao.id, respostaId: resultado.resposta.id };
  if (problemas.length > 0) return revisao(problemas.join('; '), vinculo);
  return gravar({ ...base, ...vinculo, status: 'PROCESSADO', motivo: resultado.duplicado ? 'Resposta já registrada anteriormente (mesmo WAMID)' : null });
}

async function processarStatus(deps: DependenciasWebhookYCloud, s: StatusMensagemYCloud, provedor: 'ycloud' | 'meta'): Promise<ResultadoWebhookYCloud> {
  let solicitacao = provedor === 'meta' ? null : await deps.buscarPorYcloudId(s.ycloudId);
  if (solicitacao === null && s.wamid !== null) solicitacao = await deps.buscarPorWamid(s.wamid);
  if (solicitacao === null) return { evento: 'STATUS', desfecho: 'SEM_SOLICITACAO' };

  let mudou = false;
  if (s.wamid !== null && solicitacao.wamidOutbound !== s.wamid) {
    const r = await deps.registrarWamid({ solicitacaoId: solicitacao.id, wamidOutbound: s.wamid, ycloudMessageId: provedor === 'meta' ? null : s.ycloudId, telefoneDestino: solicitacao.telefoneDestino });
    solicitacao = r.solicitacao;
    mudou = !r.duplicado;
  }
  const status = s.status.toLowerCase();
  if (status === 'delivered' || status === 'read') {
    mudou = (await deps.marcarEntregue(solicitacao.id)) !== null || mudou;
  } else if (status === 'failed') {
    const detalhe = sanitizarTextoErro([s.erroCodigo, s.erroMensagem].filter(Boolean).join(' '), [config.ycloudApiKey, config.metaAccessToken, config.metaAppSecret]).slice(0, 300);
    const motivo = `${provedor.toUpperCase()}_FALHA_ENTREGA: ${provedor === 'meta' ? 'a Meta' : 'a YCloud'} informou que a mensagem não foi entregue.${detalhe === '' ? '' : ` Detalhe: ${detalhe}`}`;
    mudou = (await deps.marcarFalhaEntrega(solicitacao.id, motivo)) !== null || mudou;
  }
  if (!mudou) return { evento: 'STATUS', desfecho: 'SEM_MUDANCA' };
  await deps.registrarAuditoria({
    usuarioId: null,
    origem: `webhook_${provedor}`,
    acao: 'WHATSAPP_STATUS_ATUALIZADO',
    entidade: 'solicitacao_cotacao_frete',
    entidadeId: solicitacao.id,
    valorNovo: provedor === 'meta' ? { statusMeta: status, wamid: s.wamid, erroCodigo: s.erroCodigo } : { statusYCloud: status, wamid: s.wamid, ycloudMessageId: s.ycloudId, erroCodigo: s.erroCodigo },
  });
  return { evento: 'STATUS', desfecho: 'ATUALIZADO' };
}

export async function servicoProcessarEventoYCloud(evento: EventoYCloud, deps: DependenciasWebhookYCloud = DEPENDENCIAS_PADRAO, provedor: 'ycloud' | 'meta' = 'ycloud'): Promise<ResultadoWebhookYCloud> {
  if (evento.tipo === 'MENSAGEM_RECEBIDA') return processarMensagemRecebida(deps, evento.mensagem, provedor);
  if (evento.tipo === 'STATUS') return processarStatus(deps, evento.mensagem, provedor);
  return { evento: 'IGNORADO', desfecho: 'IGNORADO' };
}
