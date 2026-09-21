/**
 * Camada de serviço da Fase 4A.1 (automação de cotações com transportadoras) — isolada de
 * `fretesServico.ts` para deixar claro o limite de responsabilidade (seção 2): esta camada
 * só COLETA + ESTRUTURA + APRESENTA. Nenhuma função aqui escolhe transportadora, define
 * acréscimo, fecha cotação ou escreve na Omie — essas continuam exclusivamente em
 * `fretesServico.ts`, inalteradas.
 */
import { randomBytes } from 'node:crypto';
import type { ClienteOmie } from '../omie/cliente.js';
import { ErroValidacao } from '../validacao.js';
import { registrarAuditoria } from './auditoriaRepositorio.js';
import { emailValido } from './validacao.js';
import { servicoBuscarCotacao } from './fretesServico.js';
import {
  buscarExtracaoPorPropostaId,
  buscarExtracaoPorRespostaId,
  criarExtracao,
} from './extracoesRepositorio.js';
import {
  confirmarPropostaPendente,
  buscarPropostaPorId,
  listarPropostasPorStatus,
  criarPropostaAutomatica,
  type CorrecaoPropostaPendente,
} from './propostasRepositorio.js';
import {
  buscarRespostaPorId,
  criarRespostaIdempotente,
  listarRespostasComErroOuSemProposta,
  marcarStatusProcessamentoResposta,
} from './respostasRepositorio.js';
import {
  buscarSolicitacaoPorCodigoReferencia,
  buscarSolicitacaoPorId,
  buscarSolicitacaoPorWamidOutbound,
  criarSolicitacao,
  listarSolicitacoesPorCotacao,
  marcarSolicitacaoEnviada,
  marcarSolicitacaoErro,
  marcarSolicitacaoRespondida,
  registrarWamidOutbound,
} from './solicitacoesRepositorio.js';
import { buscarTransportadoraPorId } from './transportadorasRepositorio.js';
import { enviarSolicitacaoAoN8n, type PayloadSolicitacaoN8n } from './integracoes/n8nCliente.js';
import type { CanalOrigemProposta, CotacaoFrete, EmailOrigem, ExtracaoProposta, PropostaFrete, RespostaCotacao, SolicitacaoCotacao, Transportadora } from './tipos.js';
import type { PayloadCorrelacionarWhatsapp, PayloadOutboundWhatsapp, PayloadRespostaWebhook } from './webhookCotacoes.js';

// --- Solicitação de cotação (seção 12/25/27) -------------------------------------------

/** Gera o identificador seguro (seção 24) incluído na comunicação enviada à transportadora — nunca um ID incremental exposto puro. */
function gerarCodigoReferencia(codigoCotacao: string): string {
  return `${codigoCotacao}-${randomBytes(4).toString('hex')}`;
}

/**
 * Payload outbound (Fase 4A.2, seção 12/13) — só campos logísticos necessários pra cotar.
 * NUNCA inclui margem/comissão/custo de produto/markup ETK/valor de venda/credenciais —
 * esses conceitos nem existem neste objeto. Fase 4A.4.1 (seção 9): `transportadora.email`/
 * `fonteEmail` são o SNAPSHOT já gravado na solicitação — o n8n nunca decide/consulta Omie.
 */
function montarPayloadN8n(cotacao: CotacaoFrete, solicitacao: SolicitacaoCotacao): PayloadSolicitacaoN8n {
  return {
    versao: 1,
    evento: 'SOLICITACAO_COTACAO',
    solicitacaoId: solicitacao.id,
    referencia: solicitacao.codigoReferencia,
    cotacaoId: cotacao.id,
    transportadora: {
      id: solicitacao.transportadoraId,
      email: solicitacao.emailDestino,
      fonteEmail: solicitacao.emailOrigem,
    },
    canal: solicitacao.canal,
    logistica: {
      origem: cotacao.origem,
      destino: cotacao.destino,
      cepOrigem: cotacao.cepOrigem,
      cepDestino: cotacao.cepDestino,
      pesoBruto: cotacao.pesoBruto,
      pesoLiquido: cotacao.pesoLiquido,
      peso: cotacao.peso,
      volumes: cotacao.volumes,
      especie: cotacao.especieVolumes,
    },
  };
}

/**
 * Resolução do e-mail de destino (Fase 4A.4.1, seção 6) — regra fixa, sempre nesta ordem:
 * MANUAL (só para esta solicitação) > OMIE (cadastro na Omie, via `codigoClienteOmie` já
 * vinculado à transportadora) > BLOQUEIO. Nunca inventa e-mail, nunca usa fallback
 * genérico/silencioso. `ClienteOmie.consultarCliente` já existe (mesmo cache/limitador/
 * tratamento de erro da Fase 3.2) — nenhum método ou endpoint novo na Omie.
 */
async function resolverEmailDestino(
  cliente: ClienteOmie,
  transportadora: Transportadora,
  emailManual: string | null,
): Promise<{ emailDestino: string; emailOrigem: EmailOrigem }> {
  // Seção 5.F: um e-mail manual informado (não vazio) mas malformado é rejeitado
  // explicitamente — nunca cai silenciosamente para a Omie como se nada tivesse sido digitado.
  if (emailManual !== null && emailManual.trim() !== '' && !emailValido(emailManual)) {
    throw new ErroValidacao('O e-mail manual informado não é um endereço válido.');
  }
  if (emailValido(emailManual)) {
    return { emailDestino: emailManual, emailOrigem: 'MANUAL' };
  }
  if (transportadora.codigoClienteOmie !== null) {
    const registro = await cliente.consultarCliente(transportadora.codigoClienteOmie);
    if (registro !== null && emailValido(registro.email)) {
      return { emailDestino: registro.email, emailOrigem: 'OMIE' };
    }
  }
  throw new ErroValidacao(
    `EMAIL_TRANSPORTADORA_NAO_CADASTRADO: nenhum e-mail disponível para "${transportadora.nomeRazaoSocial}" — informe um e-mail manual para esta solicitação ou cadastre o código Omie da transportadora com um e-mail válido.`,
  );
}

/**
 * Tenta o envio outbound de UMA solicitação já criada — nunca lança: qualquer falha
 * (config ausente, timeout, rede, HTTP não-2xx) vira `status = 'ERRO'` registrado na
 * própria solicitação (seção 8/11/27), preservando a cotação íntegra e sem criar proposta
 * nenhuma. Usada tanto no envio inicial quanto no reenvio manual.
 */
async function tentarEnviarAoN8n(cotacao: CotacaoFrete, solicitacao: SolicitacaoCotacao, usuarioId: string | null): Promise<SolicitacaoCotacao> {
  try {
    await enviarSolicitacaoAoN8n(montarPayloadN8n(cotacao, solicitacao));
    const atualizada = await marcarSolicitacaoEnviada(solicitacao.id, null);
    await registrarAuditoria({
      usuarioId,
      acao: 'SOLICITACAO_ENVIADA_N8N',
      entidade: 'solicitacao_cotacao_frete',
      entidadeId: solicitacao.id,
      valorNovo: { status: atualizada.status, tentativas: atualizada.tentativas },
    });
    return atualizada;
  } catch (erro) {
    // Mensagem já sanitizada por `n8nCliente.ts` (nunca inclui o segredo) — seção 31.
    const motivo = erro instanceof Error ? erro.message : 'Falha desconhecida ao enviar ao n8n.';
    const atualizada = await marcarSolicitacaoErro(solicitacao.id, motivo);
    await registrarAuditoria({
      usuarioId,
      acao: 'SOLICITACAO_ERRO_N8N',
      entidade: 'solicitacao_cotacao_frete',
      entidadeId: solicitacao.id,
      valorNovo: { status: atualizada.status, tentativas: atualizada.tentativas, erro: motivo },
    });
    return atualizada;
  }
}

/** Um item por transportadora selecionada (seção 7) — `emailManual` só é relevante para canal EMAIL, vale só para esta solicitação e nunca altera `transportadoras.email` nem a Omie. */
export interface ItemSolicitacaoCotacao {
  transportadoraId: string;
  emailManual?: string | null;
}

export async function servicoSolicitarCotacoes(
  cliente: ClienteOmie,
  cotacaoId: string,
  itens: ItemSolicitacaoCotacao[],
  canal: CanalOrigemProposta,
  usuarioId: string,
): Promise<SolicitacaoCotacao[]> {
  const cotacao = await servicoBuscarCotacao(cotacaoId);
  if (cotacao.status === 'FECHADA' || cotacao.status === 'CANCELADA') {
    throw new ErroValidacao(`Não é possível solicitar cotação numa cotação com status ${cotacao.status}.`);
  }
  if (cotacao.modalidadeExecucao !== 'TRANSPORTADORA') {
    throw new ErroValidacao(`Solicitação de cotação só se aplica à modalidade TRANSPORTADORA (esta cotação é ${cotacao.modalidadeExecucao}).`);
  }
  if (itens.length === 0) throw new ErroValidacao('Selecione ao menos uma transportadora.');

  const resultado: SolicitacaoCotacao[] = [];
  for (const item of itens) {
    const transportadora = await buscarTransportadoraPorId(item.transportadoraId);
    if (transportadora === null) throw new ErroValidacao(`Transportadora não encontrada: ${item.transportadoraId}.`);

    // Seção 6: resolução só se aplica ao canal EMAIL — demais canais nunca exigem e-mail nem
    // tocam a Omie (nenhuma consulta é feita para canal API/MANUAL/WHATSAPP/OUTRO).
    let emailDestino: string | null = null;
    let emailOrigem: EmailOrigem | null = null;
    if (canal === 'EMAIL') {
      const resolvido = await resolverEmailDestino(cliente, transportadora, item.emailManual ?? null);
      emailDestino = resolvido.emailDestino;
      emailOrigem = resolvido.emailOrigem;
    }

    const solicitacao = await criarSolicitacao({
      cotacaoFreteId: cotacao.id,
      transportadoraId: item.transportadoraId,
      canal,
      codigoReferencia: gerarCodigoReferencia(cotacao.codigo),
      criadoPor: usuarioId,
      emailDestino,
      emailOrigem,
    });
    await registrarAuditoria({
      usuarioId,
      acao: 'SOLICITACAO_CRIADA',
      entidade: 'solicitacao_cotacao_frete',
      entidadeId: solicitacao.id,
      valorNovo: solicitacao,
    });
    // Envio outbound síncrono (Fase 4A.2) — uma única tentativa automática (seção 11); falha
    // nunca aborta o laço nem propaga: a solicitação fica registrada com status ERRO.
    const final = await tentarEnviarAoN8n(cotacao, solicitacao, usuarioId);
    resultado.push(final);
  }
  return resultado;
}

export async function servicoListarSolicitacoes(cotacaoId: string): Promise<SolicitacaoCotacao[]> {
  await servicoBuscarCotacao(cotacaoId); // 404 explícito se a cotação não existir
  return listarSolicitacoesPorCotacao(cotacaoId);
}

const LIMITE_REENVIOS = 5;

/**
 * Reenvio manual (seção 29) — reusa a MESMA solicitação (mesmo `codigoReferencia`), nunca
 * cria uma segunda linha. Só permitido quando o envio anterior falhou (`status = 'ERRO'`);
 * limitado a `LIMITE_REENVIOS` tentativas totais para nunca virar um loop, mesmo manual.
 */
export async function servicoReenviarSolicitacao(solicitacaoId: string, usuarioId: string): Promise<SolicitacaoCotacao> {
  const solicitacao = await buscarSolicitacaoPorId(solicitacaoId);
  if (solicitacao === null) throw new ErroValidacao('Solicitação de cotação não encontrada.');
  if (solicitacao.status !== 'ERRO') {
    throw new ErroValidacao(`Só é possível reenviar uma solicitação com status ERRO (atual: ${solicitacao.status}).`);
  }
  if (solicitacao.tentativas >= LIMITE_REENVIOS) {
    throw new ErroValidacao(`Limite de ${LIMITE_REENVIOS} tentativas de envio atingido para esta solicitação.`);
  }
  const cotacao = await servicoBuscarCotacao(solicitacao.cotacaoFreteId);
  return tentarEnviarAoN8n(cotacao, solicitacao, usuarioId);
}

// --- Webhook de entrada (seção 20/23) ---------------------------------------------------

export interface ResultadoProcessamentoWebhook {
  resposta: RespostaCotacao;
  extracao: ExtracaoProposta;
  proposta: PropostaFrete | null;
  duplicado: boolean;
}

/**
 * Ponto único de entrada de uma resposta de transportadora (Fase 4A.1). NUNCA aprova nada
 * automaticamente (seção 7/38): mesmo com `confianca` altíssima, a proposta nasce
 * `PENDENTE_VALIDACAO`. NUNCA infere valor (seção 39/40): sem `valorFrete` extraído, não
 * cria proposta — só a extração/resposta ficam registradas para revisão manual (seção 41).
 */
export async function servicoProcessarRespostaWebhook(payload: PayloadRespostaWebhook): Promise<ResultadoProcessamentoWebhook> {
  const solicitacao = await buscarSolicitacaoPorCodigoReferencia(payload.referencia);
  if (solicitacao === null) throw new ErroValidacao('Referência de solicitação não encontrada.');

  const { resposta, criada } = await criarRespostaIdempotente({
    solicitacaoId: solicitacao.id,
    canal: payload.canal,
    identificadorMensagem: payload.mensagemId,
    conteudoBruto: payload.conteudoBruto,
  });

  if (!criada) {
    // Seção 19: a mesma mensagem já tinha sido processada antes — devolve o resultado já
    // existente (idempotente), nunca cria uma segunda resposta/extração/proposta.
    const extracaoExistente = await buscarExtracaoPorRespostaId(resposta.id);
    const propostaExistente = extracaoExistente?.propostaId ? await buscarPropostaPorId(extracaoExistente.propostaId) : null;
    if (extracaoExistente === null) throw new Error('Resposta idempotente encontrada sem extração associada — estado inconsistente.');
    return { resposta, extracao: extracaoExistente, proposta: propostaExistente, duplicado: true };
  }

  await registrarAuditoria({
    usuarioId: null,
    origem: 'webhook_n8n',
    acao: 'RESPOSTA_RECEBIDA',
    entidade: 'resposta_cotacao_frete',
    entidadeId: resposta.id,
    valorNovo: { solicitacaoId: solicitacao.id, canal: resposta.canal },
  });

  // Seção 40: só `valorFrete` alimenta o custo — os demais componentes ficam disponíveis
  // para o humano conferir, nunca somados automaticamente.
  const temValorUtilizavel = payload.extracao.valorFrete !== null;
  const baixaConfianca = payload.extracao.confianca !== null && payload.extracao.confianca < 0.6;
  const requerRevisao = !temValorUtilizavel || baixaConfianca;

  let proposta: PropostaFrete | null = null;
  if (temValorUtilizavel) {
    proposta = await criarPropostaAutomatica({
      cotacaoId: solicitacao.cotacaoFreteId,
      transportadoraId: solicitacao.transportadoraId,
      solicitacaoId: solicitacao.id,
      valorCusto: payload.extracao.valorFrete as number,
      prazoDias: payload.extracao.prazoDias,
      validade: payload.extracao.validade,
      observacoes: payload.extracao.observacoes,
      canal: payload.canal,
      mensagemOriginal: payload.conteudoBruto,
      confianca: payload.extracao.confianca,
      requerRevisao: baixaConfianca,
    });
    await registrarAuditoria({
      usuarioId: null,
      origem: 'webhook_n8n',
      acao: 'PROPOSTA_EXTRAIDA',
      entidade: 'proposta_frete',
      entidadeId: proposta.id,
      valorNovo: proposta,
    });
  }

  const extracao = await criarExtracao({
    respostaId: resposta.id,
    versaoExtrator: payload.versaoExtrator,
    dadosExtraidos: payload.extracao,
    confianca: payload.extracao.confianca,
    status: !temValorUtilizavel ? 'REQUER_REVISAO' : requerRevisao ? 'REQUER_REVISAO' : 'EXTRAIDA',
    propostaId: proposta?.id ?? null,
  });

  await marcarStatusProcessamentoResposta(resposta.id, 'PROCESSADA', null);
  await marcarSolicitacaoRespondida(solicitacao.id);
  await registrarAuditoria({
    usuarioId: null,
    origem: 'webhook_n8n',
    acao: 'RESPOSTA_PROCESSADA',
    entidade: 'resposta_cotacao_frete',
    entidadeId: resposta.id,
    valorNovo: { extracaoId: extracao.id, propostaId: proposta?.id ?? null, status: extracao.status },
  });

  return { resposta, extracao, proposta, duplicado: false };
}

// --- Validação humana (seção 17/38) -----------------------------------------------------

export interface InboxPropostas {
  pendentesValidacao: PropostaFrete[];
  respostasSemProposta: RespostaCotacao[];
}

/** "PROPOSTAS RECEBIDAS" (seção 36) — nunca inclui propostas manuais (essas nunca passam por `PENDENTE_VALIDACAO`). */
export async function servicoListarInboxPropostas(): Promise<InboxPropostas> {
  const [pendentesValidacao, respostasSemProposta] = await Promise.all([
    listarPropostasPorStatus('PENDENTE_VALIDACAO'),
    listarRespostasComErroOuSemProposta(),
  ]);
  return { pendentesValidacao, respostasSemProposta };
}

/** Dados brutos + extraídos lado a lado (seção 17/37) — a mensagem original nunca é alterada (seção 18). */
export async function servicoBuscarOrigemProposta(propostaId: string): Promise<{ resposta: RespostaCotacao; extracao: ExtracaoProposta; solicitacao: SolicitacaoCotacao } | null> {
  const extracao = await buscarExtracaoPorPropostaId(propostaId);
  if (extracao === null) return null;
  const resposta = await buscarRespostaPorId(extracao.respostaId);
  if (resposta === null) throw new Error('Extração encontrada sem resposta associada — estado inconsistente.');
  const solicitacao = await buscarSolicitacaoPorId(resposta.solicitacaoId);
  if (solicitacao === null) throw new Error('Resposta encontrada sem solicitação associada — estado inconsistente.');
  return { resposta, extracao, solicitacao };
}

/**
 * CONFIRMAR / CORRIGIR E CONFIRMAR (seção 17) — a única forma de uma proposta sair de
 * `PENDENTE_VALIDACAO`. Nunca automática, mesmo que nada tenha sido corrigido (seção 38).
 */
export async function servicoValidarProposta(propostaId: string, correcao: CorrecaoPropostaPendente, usuarioId: string): Promise<PropostaFrete> {
  const anterior = await buscarPropostaPorId(propostaId);
  if (anterior === null) throw new ErroValidacao('Proposta não encontrada.');
  if (anterior.status !== 'PENDENTE_VALIDACAO') {
    throw new ErroValidacao(`Esta proposta não está pendente de validação (status atual: ${anterior.status}).`);
  }
  const houveCorrecao =
    (correcao.valorCusto !== undefined && correcao.valorCusto !== anterior.valorCusto) ||
    (correcao.prazoDias !== undefined && correcao.prazoDias !== anterior.prazoDias) ||
    (correcao.validade !== undefined && correcao.validade !== anterior.validade) ||
    (correcao.observacoes !== undefined && correcao.observacoes !== anterior.observacoes) ||
    (correcao.tipoServico !== undefined && correcao.tipoServico !== anterior.tipoServico);

  const proposta = await confirmarPropostaPendente(propostaId, correcao);
  await registrarAuditoria({
    usuarioId,
    acao: houveCorrecao ? 'PROPOSTA_CORRIGIDA' : 'PROPOSTA_VALIDADA',
    entidade: 'proposta_frete',
    entidadeId: proposta.id,
    valorAnterior: anterior,
    valorNovo: proposta,
  });
  return proposta;
}

// --- Fase WhatsApp — Etapa 3: persistência definitiva WAMID → referência (n8n → ETK) ---
//
// Callback automático pra `/api/fretes/integracoes/cotacoes/resposta` NUNCA é disparado
// daqui (seção 8 da fase) — esta etapa só registra o WAMID outbound e resolve a referência a
// partir do `context.id`; o n8n continua responsável por chamar o webhook de resposta
// separadamente, como já fazia.

export interface ResultadoOutboundWhatsapp {
  solicitacao: SolicitacaoCotacao;
  duplicado: boolean;
}

/** Registra o resultado de um envio WhatsApp outbound (Etapa 3, seção 2) — idempotente por WAMID, nunca duplica um reprocessamento. */
export async function servicoRegistrarOutboundWhatsapp(payload: PayloadOutboundWhatsapp): Promise<ResultadoOutboundWhatsapp> {
  const resultado = await registrarWamidOutbound({
    solicitacaoId: payload.solicitacaoId,
    codigoReferencia: payload.referencia,
    wamidOutbound: payload.wamidOutbound,
    ycloudMessageId: payload.ycloudMessageId,
    telefoneDestino: payload.telefoneDestino,
    statusEnvio: payload.statusEnvio,
    enviadoEm: payload.enviadoEm,
  });
  if (!resultado.duplicado) {
    await registrarAuditoria({
      usuarioId: null,
      origem: 'webhook_n8n',
      acao: 'SOLICITACAO_WHATSAPP_OUTBOUND_REGISTRADA',
      entidade: 'solicitacao_cotacao_frete',
      entidadeId: resultado.solicitacao.id,
      valorNovo: {
        wamidOutbound: payload.wamidOutbound,
        ycloudMessageId: payload.ycloudMessageId,
        telefoneDestino: payload.telefoneDestino,
        statusEnvio: payload.statusEnvio ?? null,
      },
    });
  }
  return resultado;
}

export type ResultadoCorrelacaoWhatsapp =
  | { correlacionado: true; referencia: string; solicitacaoId: string }
  | { correlacionado: false };

/**
 * `resolverReferenciaPorWamidOutbound` (Etapa 3, seção 3) — entrada é o `context.id` do
 * reply recebido; nunca tenta adivinhar a referência quando o WAMID não foi registrado (só
 * devolve `correlacionado: false` explícito).
 */
export async function servicoResolverReferenciaPorWamidOutbound(payload: PayloadCorrelacionarWhatsapp): Promise<ResultadoCorrelacaoWhatsapp> {
  const solicitacao = await buscarSolicitacaoPorWamidOutbound(payload.contextoReplyId);
  await registrarAuditoria({
    usuarioId: null,
    origem: 'webhook_n8n',
    acao: 'CORRELACAO_WHATSAPP_CONSULTADA',
    entidade: 'solicitacao_cotacao_frete',
    entidadeId: solicitacao?.id ?? null,
    valorNovo: { wamidOutbound: payload.contextoReplyId, correlacionado: solicitacao !== null },
  });
  if (solicitacao === null) return { correlacionado: false };
  return { correlacionado: true, referencia: solicitacao.codigoReferencia, solicitacaoId: solicitacao.id };
}
