/**
 * Job de respostas por e-mail (Fase 2 da migração n8n → backend): lê a caixa por IMAP, filtra o
 * que é do fluxo de fretes, correlaciona pela referência `FRE-...` e entrega ao MESMO serviço que
 * o webhook do n8n usava (`servicoProcessarRespostaWebhook`) — nenhuma regra de proposta nova:
 * proposta nasce `PENDENTE_VALIDACAO`, sem `valorFrete` não há proposta, idempotência por
 * `mensagemId`.
 *
 * Por mensagem:
 *   não é do fluxo de fretes             → ignorada (nada gravado)
 *   chave já registrada (≠ ERRO)         → duplicada, ignorada com segurança
 *   sem referência / referência ambígua / sem solicitação → REVISAO_MANUAL (texto guardado)
 *   correlacionada                        → resposta registrada; PROCESSADO se a extração foi
 *                                           limpa, senão REVISAO_MANUAL com o motivo
 *   falha técnica                         → ERRO e o lote para (cursor não avança); após
 *                                           `LIMITE_TENTATIVAS` vira REVISAO_MANUAL
 */
import { registrarAuditoria } from './auditoriaRepositorio.js';
import {
  buscarEmailPorChave,
  executarComLockJobEmails,
  lerCursorImap,
  registrarEmailResposta,
  salvarCursorImap,
  type DadosRegistroEmail,
} from './emailsRespostaRepositorio.js';
import { extrairReferencias, extrairRespostaEmail, removerCitacao } from './email/parserRespostaEmail.js';
import { lerMensagemEmail, type MensagemLida } from './email/lerMensagemEmail.js';
import { criarFonteImap, type FonteEmails } from './integracoes/imapCliente.js';
import { sanitizarTextoErro } from './integracoes/sanitizacao.js';
import { servicoProcessarRespostaWebhook } from './integracaoCotacoesServico.js';
import { buscarSolicitacaoPorCodigoReferencia, buscarSolicitacoesEmailPorMessageId } from './solicitacoesRepositorio.js';
import { config } from '../config.js';

export const LIMITE_POR_EXECUCAO = 30;
export const LIMITE_TENTATIVAS = 5;
const ORCAMENTO_MS = 40_000;
const LIMITE_CONTEUDO = 20_000;

export interface ResumoJobEmails {
  status: 'OK' | 'PULADO_LOCK' | 'ERRO';
  encontradas: number;
  processadas: number;
  revisao: number;
  duplicadas: number;
  ignoradas: number;
  erros: number;
  restantes: number;
  erro: string | null;
  duracaoMs: number;
}

export interface DependenciasJobEmails {
  fonte: FonteEmails;
  lerMensagem: typeof lerMensagemEmail;
  executarComLock: typeof executarComLockJobEmails;
  lerCursor: typeof lerCursorImap;
  salvarCursor: typeof salvarCursorImap;
  buscarEmail: typeof buscarEmailPorChave;
  registrarEmail: typeof registrarEmailResposta;
  buscarSolicitacaoPorReferencia: typeof buscarSolicitacaoPorCodigoReferencia;
  buscarSolicitacoesPorMessageId: typeof buscarSolicitacoesEmailPorMessageId;
  processarResposta: typeof servicoProcessarRespostaWebhook;
  registrarAuditoria: typeof registrarAuditoria;
  agora: () => number;
}

function dependenciasPadrao(): DependenciasJobEmails {
  return {
    fonte: criarFonteImap(),
    lerMensagem: lerMensagemEmail,
    executarComLock: executarComLockJobEmails,
    lerCursor: lerCursorImap,
    salvarCursor: salvarCursorImap,
    buscarEmail: buscarEmailPorChave,
    registrarEmail: registrarEmailResposta,
    buscarSolicitacaoPorReferencia: buscarSolicitacaoPorCodigoReferencia,
    buscarSolicitacoesPorMessageId: buscarSolicitacoesEmailPorMessageId,
    processarResposta: servicoProcessarRespostaWebhook,
    registrarAuditoria,
    agora: Date.now,
  };
}

const ASSUNTO_FLUXO = /Cota[cç][aã]o de Frete ETK/i;

function erroSanitizado(erro: unknown): string {
  const bruto = erro instanceof Error ? erro.message : String(erro);
  const limpo = sanitizarTextoErro(bruto, [config.imapPass, config.smtpPass, config.fretesJobSecret]);
  return limpo.length > 500 ? `${limpo.slice(0, 500)}…` : limpo;
}

type Desfecho = 'PROCESSADA' | 'REVISAO' | 'DUPLICADA' | 'IGNORADA';

/** Decide e registra o destino de UMA mensagem. Lança só em falha técnica. */
async function processarMensagem(deps: DependenciasJobEmails, mailbox: string, uidvalidity: number, uid: number, msg: MensagemLida): Promise<Desfecho> {
  const refsAssunto = extrairReferencias(msg.assunto);
  const porCabecalho = msg.idsRelacionados.length > 0 ? await deps.buscarSolicitacoesPorMessageId(msg.idsRelacionados) : [];
  const doFluxo = refsAssunto.length > 0 || ASSUNTO_FLUXO.test(msg.assunto) || porCabecalho.length > 0;
  if (!doFluxo) return 'IGNORADA';

  const existente = await deps.buscarEmail(msg.chave);
  if (existente !== null && existente.status !== 'ERRO') return 'DUPLICADA';

  const base: Omit<DadosRegistroEmail, 'status' | 'motivo' | 'referencia' | 'solicitacaoId' | 'respostaId'> = {
    chaveMensagem: msg.chave,
    messageId: msg.messageId,
    mailbox,
    uid,
    uidvalidity,
    recebidoEm: msg.data,
    remetente: msg.remetente,
    assunto: msg.assunto.slice(0, 500),
    conteudo: msg.texto.slice(0, LIMITE_CONTEUDO),
  };
  const revisao = async (motivo: string, extra: Partial<DadosRegistroEmail> = {}): Promise<Desfecho> => {
    const registro = await deps.registrarEmail({ ...base, referencia: null, solicitacaoId: null, respostaId: null, ...extra, status: 'REVISAO_MANUAL', motivo });
    await deps.registrarAuditoria({
      usuarioId: null,
      origem: 'job_imap',
      acao: 'EMAIL_RESPOSTA_REVISAO_MANUAL',
      entidade: 'email_resposta_frete',
      entidadeId: registro.id,
      valorNovo: { motivo, referencia: registro.referencia, solicitacaoId: registro.solicitacaoId, respostaId: registro.respostaId },
    });
    return 'REVISAO';
  };

  if (existente !== null && existente.tentativas >= LIMITE_TENTATIVAS) {
    return revisao(`Falha técnica em ${existente.tentativas} tentativas de processamento; última: ${existente.motivo ?? '—'}`);
  }

  // Correlação SÓ por referência exata: assunto, cabeçalhos de resposta (Message-ID do envio
  // SMTP) e, na falta dos dois, o corpo — desde que haja uma única referência. Nunca por
  // remetente, nome ou texto aproximado.
  const candidatas = new Set<string>([...refsAssunto, ...porCabecalho.map((s) => s.codigoReferencia.toLowerCase().replace(/^fre/, 'FRE'))]);
  if (candidatas.size === 0) for (const r of extrairReferencias(msg.texto)) candidatas.add(r);
  if (candidatas.size === 0) return revisao('Referência FRE-... não encontrada no assunto, nos cabeçalhos nem no corpo');
  if (candidatas.size > 1) return revisao(`Mais de uma referência encontrada (${[...candidatas].join(', ')}) — correlação ambígua`);

  const referencia = [...candidatas][0] as string;
  const solicitacao = await deps.buscarSolicitacaoPorReferencia(referencia);
  if (solicitacao === null) return revisao(`Referência ${referencia} não corresponde a nenhuma solicitação`, { referencia });

  const { extracao, problemas } = extrairRespostaEmail(msg.texto);
  const resultado = await deps.processarResposta({
    referencia: solicitacao.codigoReferencia,
    canal: 'EMAIL',
    mensagemId: msg.chave,
    conteudoBruto: removerCitacao(msg.texto).slice(0, LIMITE_CONTEUDO) || msg.texto.slice(0, LIMITE_CONTEUDO),
    versaoExtrator: 'email-imap-v1',
    extracao,
  });
  const vinculo = { referencia: solicitacao.codigoReferencia, solicitacaoId: solicitacao.id, respostaId: resultado.resposta.id };
  if (problemas.length > 0) return revisao(problemas.join('; '), vinculo);
  await deps.registrarEmail({ ...base, ...vinculo, status: 'PROCESSADO', motivo: resultado.duplicado ? 'Resposta já registrada anteriormente (mesmo Message-ID)' : null });
  return 'PROCESSADA';
}

export async function servicoProcessarEmailsResposta(deps: DependenciasJobEmails = dependenciasPadrao()): Promise<ResumoJobEmails> {
  const inicio = deps.agora();
  const resumo: ResumoJobEmails = { status: 'OK', encontradas: 0, processadas: 0, revisao: 0, duplicadas: 0, ignoradas: 0, erros: 0, restantes: 0, erro: null, duracaoMs: 0 };

  const execucao = await deps.executarComLock(async () => {
    await deps.registrarAuditoria({ usuarioId: null, origem: 'job_imap', acao: 'JOB_EMAILS_INICIADO', entidade: 'job_emails_resposta', entidadeId: null, valorNovo: {} });
    try {
      const mailbox = config.imapMailbox;
      const cursor = await deps.lerCursor(mailbox);
      const lote = await deps.fonte.buscarNovas(cursor, LIMITE_POR_EXECUCAO);
      resumo.encontradas = lote.mensagens.length;
      resumo.restantes = lote.restantes;
      let ultimoUid = cursor !== null && cursor.uidvalidity === lote.uidvalidity ? cursor.ultimoUid : 0;

      for (const [indice, { uid, fonte }] of lote.mensagens.entries()) {
        if (deps.agora() - inicio > ORCAMENTO_MS) {
          resumo.restantes += lote.mensagens.length - indice; // ficam para a próxima execução
          break;
        }
        let msg: MensagemLida | null = null;
        try {
          msg = await deps.lerMensagem(fonte);
          const desfecho = await processarMensagem(deps, lote.mailbox, lote.uidvalidity, uid, msg);
          if (desfecho === 'PROCESSADA') resumo.processadas += 1;
          else if (desfecho === 'REVISAO') resumo.revisao += 1;
          else if (desfecho === 'DUPLICADA') resumo.duplicadas += 1;
          else resumo.ignoradas += 1;
        } catch (erro) {
          // Falha técnica: registra (se der) e PARA o lote sem avançar o cursor além desta
          // mensagem — a próxima execução tenta de novo; idempotência evita duplicar.
          resumo.erros += 1;
          const motivo = erroSanitizado(erro);
          if (msg !== null) {
            const lida = msg;
            await deps
              .registrarEmail({
                chaveMensagem: lida.chave,
                messageId: lida.messageId,
                mailbox: lote.mailbox,
                uid,
                uidvalidity: lote.uidvalidity,
                recebidoEm: lida.data,
                remetente: lida.remetente,
                assunto: lida.assunto.slice(0, 500),
                referencia: null,
                solicitacaoId: null,
                respostaId: null,
                status: 'ERRO',
                motivo,
                conteudo: lida.texto.slice(0, LIMITE_CONTEUDO),
              })
              .catch(() => undefined);
          }
          await deps
            .registrarAuditoria({ usuarioId: null, origem: 'job_imap', acao: 'EMAIL_RESPOSTA_ERRO', entidade: 'email_resposta_frete', entidadeId: null, valorNovo: { uid, erro: motivo } })
            .catch(() => undefined);
          resumo.status = 'ERRO';
          resumo.erro = motivo;
          break;
        }
        ultimoUid = Math.max(ultimoUid, uid);
        await deps.salvarCursor(lote.mailbox, { uidvalidity: lote.uidvalidity, ultimoUid });
      }
      // Sem cursor anterior e nada novo: grava a posição atual para as próximas execuções.
      if (lote.mensagens.length === 0 && (cursor === null || cursor.uidvalidity !== lote.uidvalidity)) {
        await deps.salvarCursor(lote.mailbox, { uidvalidity: lote.uidvalidity, ultimoUid });
      }
    } catch (erro) {
      resumo.status = 'ERRO';
      resumo.erro = erroSanitizado(erro);
      await deps
        .registrarAuditoria({ usuarioId: null, origem: 'job_imap', acao: 'JOB_EMAILS_FALHOU', entidade: 'job_emails_resposta', entidadeId: null, valorNovo: { erro: resumo.erro } })
        .catch(() => undefined);
    }
    resumo.duracaoMs = deps.agora() - inicio;
    await deps.registrarAuditoria({
      usuarioId: null,
      origem: 'job_imap',
      acao: 'JOB_EMAILS_CONCLUIDO',
      entidade: 'job_emails_resposta',
      entidadeId: null,
      valorNovo: { ...resumo },
    });
  });

  if (!execucao.executou) resumo.status = 'PULADO_LOCK';
  resumo.duracaoMs = deps.agora() - inicio;
  return resumo;
}
