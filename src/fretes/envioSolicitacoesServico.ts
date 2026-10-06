/**
 * Envio único de solicitações de cotação (detalhe da cotação): o operador escolhe até
 * `LIMITE_TRANSPORTADORAS_POR_ENVIO` transportadoras e um canal para cada uma; este
 * orquestrador só DESPACHA para os serviços que já existem — nenhuma implementação nova de
 * e-mail, WhatsApp ou Braspress:
 *   - API (só Braspress)  → `servicoCotarBraspress`
 *   - EMAIL / WHATSAPP    → `servicoSolicitarCotacoes` (EMAIL por SMTP direto, WHATSAPP pela YCloud direto; e-mail resolvido MANUAL > CADASTRO > OMIE > bloqueio)
 * Cadastro e canal são sempre revalidados aqui (nunca confia no navegador). Uma
 * transportadora com problema não impede as demais: cada uma recebe seu resultado.
 */
import type { ClienteOmie } from '../omie/cliente.js';
import { config } from '../config.js';
import { ErroValidacao } from '../validacao.js';
import { registrarAuditoria } from './auditoriaRepositorio.js';
import { servicoCotarBraspress } from './braspressServico.js';
import { CANAIS_ENVIO, canaisDisponiveis, ehTransportadoraBraspress, integracaoBraspressConfigurada, MENSAGEM_API_NAO_CONFIGURADA, type CanalEnvio } from './canaisTransportadora.js';
import { servicoBuscarCotacao, servicoCriarTransportadora } from './fretesServico.js';
import { ErroBraspressFalhou, ErroBraspressNaoConfigurada, type ItemCubagemBraspress } from './integracoes/braspressCliente.js';
import { servicoSolicitarCotacoes } from './integracaoCotacoesServico.js';
import { listarSolicitacoesPorCotacao } from './solicitacoesRepositorio.js';
import {
  buscarTransportadoraPorCnpj,
  buscarTransportadoraPorId,
  buscarTransportadorasAtivasPorTermo,
  type DadosTransportadora,
} from './transportadorasRepositorio.js';
import { emailValido } from './validacao.js';
import { problemaLimiteWhatsapp } from './whatsapp/mensagemCotacao.js';
import { montarPayloadN8n, problemaObservacaoViaN8n } from './integracaoCotacoesServico.js';
import { montarDestinoEnviado } from './destinoEnviado.js';
import type { CotacaoFrete, SolicitacaoCotacao, Transportadora } from './tipos.js';

// Regras de canal ficam em `canaisTransportadora.ts` (também usadas na edição do cadastro); reexportadas aqui por compatibilidade.
export { CANAIS_ENVIO, canaisDisponiveis, type CanalEnvio };
export const LIMITE_TRANSPORTADORAS_POR_ENVIO = 7;
const LIMITE_RESULTADOS_BUSCA = 15;

const ROTULOS_CANAL_ENVIO: Record<CanalEnvio, string> = { EMAIL: 'E-mail', WHATSAPP: 'WhatsApp', API: 'API' };

export const MENSAGEM_SEM_CANAL_ENVIO = 'Selecione o canal de envio para todas as transportadoras.';

/** Um canal só → ele; vários → `canalPrincipal` se for um deles; senão `null` (operador escolhe). */
export function canalSugerido(t: Transportadora, disponiveis: CanalEnvio[]): CanalEnvio | null {
  if (disponiveis.length === 1) return disponiveis[0] as CanalEnvio;
  const principal = t.canalPrincipal;
  if (principal !== null && (disponiveis as string[]).includes(principal)) return principal as CanalEnvio;
  return null;
}

/**
 * Registros com o mesmo CNPJ normalizado viram um único resultado (nada é apagado). Escolha
 * canônica determinística: com código Omie primeiro, depois o cadastro mais antigo, depois
 * o menor id. Registros sem CNPJ válido nunca são agrupados (nome não é critério seguro).
 */
export function escolherCanonicasPorCnpj(lista: Transportadora[]): Transportadora[] {
  const melhor = (a: Transportadora, b: Transportadora): Transportadora => {
    if ((a.codigoClienteOmie !== null) !== (b.codigoClienteOmie !== null)) return a.codigoClienteOmie !== null ? a : b;
    if (a.criadoEm !== b.criadoEm) return a.criadoEm < b.criadoEm ? a : b;
    return a.id < b.id ? a : b;
  };
  const porCnpj = new Map<string, Transportadora>();
  for (const t of lista) {
    const cnpj = (t.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue;
    const atual = porCnpj.get(cnpj);
    porCnpj.set(cnpj, atual === undefined ? t : melhor(atual, t));
  }
  return lista.filter((t) => {
    const cnpj = (t.cnpj ?? '').replace(/\D/g, '');
    return cnpj.length !== 14 || porCnpj.get(cnpj) === t;
  });
}

export interface TransportadoraBusca {
  id: string;
  nomeRazaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  canaisDisponiveis: CanalEnvio[];
  canalSugerido: CanalEnvio | null;
  /** Canal principal do cadastro, só quando é um canal de envio (SITE nunca conta) — marcado com "*" na tela. */
  canalPrincipal: CanalEnvio | null;
  /** Portal/site é só informação operacional — nunca vira API. */
  urlPortal: string | null;
  /** Número cadastrado como WhatsApp (envio ainda indisponível nesta fase). */
  whatsappCadastrado: boolean;
  /** Integração API operacional (nesta fase: só Braspress). */
  apiIntegrada: boolean;
  /** Braspress cadastrada, mas credenciais da API ausentes no servidor — API indisponível (aditivo, só informativo). */
  apiNaoConfigurada: boolean;
}

export function paraTransportadoraBusca(t: Transportadora): TransportadoraBusca {
  const disponiveis = canaisDisponiveis(t);
  return {
    id: t.id,
    nomeRazaoSocial: t.nomeRazaoSocial,
    nomeFantasia: t.nomeFantasia,
    cnpj: t.cnpj,
    canaisDisponiveis: disponiveis,
    canalSugerido: canalSugerido(t, disponiveis),
    canalPrincipal: (CANAIS_ENVIO as readonly string[]).includes(t.canalPrincipal ?? '') ? (t.canalPrincipal as CanalEnvio) : null,
    urlPortal: t.urlPortal,
    whatsappCadastrado: t.whatsappCotacao !== null,
    apiIntegrada: disponiveis.includes('API'),
    apiNaoConfigurada: ehTransportadoraBraspress(t) && !integracaoBraspressConfigurada(),
  };
}

export async function servicoBuscarTransportadorasParaSolicitacao(termo: string): Promise<TransportadoraBusca[]> {
  const encontradas = escolherCanonicasPorCnpj(await buscarTransportadorasAtivasPorTermo(termo, 50));
  return encontradas.slice(0, LIMITE_RESULTADOS_BUSCA).map(paraTransportadoraBusca);
}

/**
 * "Confirmar cadastro" (transportadora localizada na Omie e conferida pelo operador): só aqui
 * grava no cadastro ETK. CNPJ válido é obrigatório e é a chave de duplicidade — se já existir
 * uma transportadora com o mesmo CNPJ normalizado, NÃO cria outra nem altera a existente: devolve
 * o registro existente para a cotação usar.
 */
export async function servicoConfirmarCadastroTransportadora(
  dados: DadosTransportadora,
  usuarioId: string,
): Promise<{ transportadora: TransportadoraBusca; existente: boolean; ativa: boolean }> {
  const cnpj = (dados.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new ErroValidacao('Informe o CNPJ da transportadora (14 dígitos) para confirmar o cadastro.');
  const existente = await buscarTransportadoraPorCnpj(cnpj);
  if (existente !== null) {
    return { transportadora: paraTransportadoraBusca(existente), existente: true, ativa: existente.ativo };
  }
  const criada = await servicoCriarTransportadora(dados, usuarioId);
  return { transportadora: paraTransportadoraBusca(criada), existente: false, ativa: criada.ativo };
}

export interface ItemEnvioSolicitacao {
  transportadoraId: string;
  /** `null` = operador não escolheu canal — bloqueia o envio inteiro (nada é enviado). */
  canal: CanalEnvio | null;
  /** Só para EMAIL: override manual válido apenas nesta solicitação (mesma regra do fluxo existente). */
  emailManual: string | null;
  /** "Observações para a transportadora" só desta transportadora (já validada na borda HTTP); `null` quando vazia. */
  observacoesTransportadora?: string | null;
  /**
   * Só para API: o operador confirmou o aviso de que a API (Braspress) NÃO transmite a observação.
   * Sem essa confirmação, uma observação preenchida para API bloqueia o envio dessa transportadora.
   */
  cienteObservacaoNaoEnviadaApi?: boolean;
}

/** API não tem campo para a observação — o envio nunca a descarta sem o operador ter sido avisado e confirmado. */
export const MENSAGEM_OBSERVACAO_API_SEM_CONFIRMACAO =
  'Erro: a API da Braspress não transmite "Observações para a transportadora". Confirme o aviso (a observação não será enviada) ou escolha E-mail/WhatsApp.';
export const MENSAGEM_OBSERVACAO_API_NAO_ENVIADA = 'A observação para a transportadora NÃO foi enviada: a API da Braspress não tem esse campo.';

export type StatusEnvioTransportadora = 'ENVIADO' | 'FALHOU' | 'NAO_ENVIADO';

export interface ResultadoEnvioTransportadora {
  transportadoraId: string;
  transportadora: string;
  canal: CanalEnvio;
  status: StatusEnvioTransportadora;
  mensagem: string;
  solicitacaoId: string | null;
  propostaId: string | null;
}

/** Serviços existentes usados pelo orquestrador — injetáveis só para teste. */
export interface DependenciasEnvio {
  buscarCotacao: typeof servicoBuscarCotacao;
  buscarTransportadora: typeof buscarTransportadoraPorId;
  listarSolicitacoes: typeof listarSolicitacoesPorCotacao;
  solicitar: typeof servicoSolicitarCotacoes;
  cotarBraspress: typeof servicoCotarBraspress;
  registrarAuditoria: typeof registrarAuditoria;
}

const DEPENDENCIAS_PADRAO: DependenciasEnvio = {
  buscarCotacao: servicoBuscarCotacao,
  buscarTransportadora: buscarTransportadoraPorId,
  listarSolicitacoes: listarSolicitacoesPorCotacao,
  solicitar: servicoSolicitarCotacoes,
  cotarBraspress: servicoCotarBraspress,
  registrarAuditoria,
};

function nomeExibicao(t: Transportadora): string {
  return t.nomeFantasia ?? t.nomeRazaoSocial;
}

function formatarMoeda(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

/**
 * Mensagens mostradas ao operador, por canal — curtas e acionáveis. Detalhe técnico (motivo
 * do n8n/Braspress, código de erro) vai só para a auditoria, nunca para a tela.
 */
export const MENSAGENS_ENVIO = {
  EMAIL_INVALIDO: 'Erro: e-mail inválido ou não cadastrado.',
  EMAIL_FALHOU: 'Erro ao enviar e-mail.',
  EMAIL_ENVIADO: 'Enviado por e-mail.',
  WHATSAPP_INVALIDO: 'Erro: WhatsApp inválido ou não cadastrado.',
  WHATSAPP_FALHOU: 'Erro ao enviar WhatsApp.',
  WHATSAPP_ENVIADO: 'Enviado por WhatsApp.',
  API_NAO_CADASTRADA: 'Erro: API não cadastrada para esta transportadora.',
  API_FALHOU: 'Erro na API da transportadora.',
} as const;

/** Canal sem cadastro utilizável NESTE registro de transportadora (nunca de outro com o mesmo nome). */
const MENSAGEM_CADASTRO_INVALIDO: Record<CanalEnvio, string> = {
  EMAIL: MENSAGENS_ENVIO.EMAIL_INVALIDO,
  WHATSAPP: MENSAGENS_ENVIO.WHATSAPP_INVALIDO,
  API: MENSAGENS_ENVIO.API_NAO_CADASTRADA,
};

const MENSAGEM_FALHA_ENVIO: Record<CanalEnvio, string> = {
  EMAIL: MENSAGENS_ENVIO.EMAIL_FALHOU,
  WHATSAPP: MENSAGENS_ENVIO.WHATSAPP_FALHOU,
  API: MENSAGENS_ENVIO.API_FALHOU,
};

/** Erros de cadastro vindos do fluxo n8n (resolução de e-mail/WhatsApp) — viram o "inválido ou não cadastrado" do canal. */
function ehErroCadastroCanal(erro: ErroValidacao): boolean {
  return /EMAIL_TRANSPORTADORA_NAO_CADASTRADO|WHATSAPP_TRANSPORTADORA_NAO_CADASTRADO|e-mail manual informado não é um endereço válido/.test(
    erro.message,
  );
}

export async function servicoEnviarSolicitacoes(
  cliente: ClienteOmie,
  cotacaoId: string,
  itens: ItemEnvioSolicitacao[],
  cubagem: ItemCubagemBraspress[] | null,
  usuarioId: string,
  deps: DependenciasEnvio = DEPENDENCIAS_PADRAO,
): Promise<ResultadoEnvioTransportadora[]> {
  if (itens.length === 0) throw new ErroValidacao('Selecione ao menos uma transportadora.');
  if (itens.length > LIMITE_TRANSPORTADORAS_POR_ENVIO) {
    throw new ErroValidacao(`Selecione no máximo ${LIMITE_TRANSPORTADORAS_POR_ENVIO} transportadoras por cotação.`);
  }
  if (new Set(itens.map((i) => i.transportadoraId)).size !== itens.length) {
    throw new ErroValidacao('A mesma transportadora foi selecionada mais de uma vez.');
  }
  const cotacao = await deps.buscarCotacao(cotacaoId);
  if (cotacao.status === 'FECHADA' || cotacao.status === 'CANCELADA') {
    throw new ErroValidacao(`Não é possível solicitar cotação numa cotação com status ${cotacao.status}.`);
  }
  if (cotacao.modalidadeExecucao !== 'TRANSPORTADORA') {
    throw new ErroValidacao(`Solicitação de cotação só se aplica à modalidade TRANSPORTADORA (esta cotação é ${cotacao.modalidadeExecucao}).`);
  }
  // Canal obrigatório: qualquer transportadora sem canal válido bloqueia TODO o envio, antes
  // de qualquer despacho (a tela já bloqueia; aqui é a revalidação no servidor).
  const semCanal = itens.filter((i) => i.canal === null || !CANAIS_ENVIO.includes(i.canal));
  if (semCanal.length > 0) {
    const nomes: string[] = [];
    for (const i of semCanal) {
      const t = await deps.buscarTransportadora(i.transportadoraId);
      nomes.push(t === null ? i.transportadoraId : nomeExibicao(t));
    }
    throw new ErroValidacao(`${MENSAGEM_SEM_CANAL_ENVIO} Sem canal: ${nomes.join(', ')}.`);
  }
  const itensComCanal = itens as (ItemEnvioSolicitacao & { canal: CanalEnvio })[];
  const solicitacoesExistentes = await deps.listarSolicitacoes(cotacaoId);

  const resultados: ResultadoEnvioTransportadora[] = [];
  for (const item of itensComCanal) {
    // Cada transportadora é processada e auditada isoladamente — nada aqui propaga exceção
    // para o laço, então a falha de uma nunca impede o envio das demais.
    const { resultado, detalheTecnico } = await processarItemEnvio(cliente, cotacao, item, cubagem, usuarioId, solicitacoesExistentes, deps);
    resultados.push(resultado);
    await auditarResultadoEnvio(deps, cotacaoId, usuarioId, resultado, detalheTecnico);
  }
  return resultados;
}

interface ResultadoItemEnvio {
  resultado: ResultadoEnvioTransportadora;
  /** Só para a auditoria (nunca devolvido à tela) — mensagens já sanitizadas pelos clientes n8n/Braspress. */
  detalheTecnico: string | null;
}

/**
 * Um item do lote: sempre usa o REGISTRO selecionado (`transportadoraId`) — e-mail,
 * `whatsappCotacao` e integração API vêm só dele, nunca de outro cadastro com o mesmo nome.
 */
async function processarItemEnvio(
  cliente: ClienteOmie,
  cotacao: CotacaoFrete,
  item: ItemEnvioSolicitacao & { canal: CanalEnvio },
  cubagem: ItemCubagemBraspress[] | null,
  usuarioId: string,
  solicitacoesExistentes: SolicitacaoCotacao[],
  deps: DependenciasEnvio,
): Promise<ResultadoItemEnvio> {
  const cotacaoId = cotacao.id;
  const observacoes = item.observacoesTransportadora !== undefined && item.observacoesTransportadora !== null && item.observacoesTransportadora.trim() !== ''
    ? item.observacoesTransportadora
    : null;
  const base = { transportadoraId: item.transportadoraId, canal: item.canal, solicitacaoId: null, propostaId: null };
  const falha = (transportadora: string, mensagem: string, detalheTecnico: string | null = null, extra: Partial<ResultadoEnvioTransportadora> = {}): ResultadoItemEnvio => ({
    resultado: { ...base, transportadora, status: 'FALHOU', mensagem, ...extra },
    detalheTecnico,
  });

  const transportadora = await deps.buscarTransportadora(item.transportadoraId);
  if (transportadora === null) return falha('—', 'Erro: transportadora não encontrada.');
  const nome = nomeExibicao(transportadora);
  if (!transportadora.ativo) return falha(nome, 'Erro: transportadora inativa.');

  // Validação de cadastro por canal, no servidor e antes de qualquer tentativa de envio.
  const emailManual = item.canal === 'EMAIL' && item.emailManual !== null && item.emailManual.trim() !== '' ? item.emailManual.trim() : null;
  if (emailManual !== null && !emailValido(emailManual)) {
    return falha(nome, MENSAGENS_ENVIO.EMAIL_INVALIDO, 'E-mail manual informado é malformado.');
  }
  if (item.canal === 'API' && ehTransportadoraBraspress(transportadora) && !integracaoBraspressConfigurada()) {
    return falha(nome, `Erro: ${MENSAGEM_API_NAO_CONFIGURADA}`, 'Credenciais da API Braspress ausentes no servidor; nada foi enviado.');
  }
  if (!canaisDisponiveis(transportadora).includes(item.canal)) {
    const detalhe =
      item.canal === 'API' && transportadora.urlPortal !== null
        ? 'Sem integração API; o portal/site cadastrado não é tratado como API.'
        : `${ROTULOS_CANAL_ENVIO[item.canal]} sem cadastro válido neste registro de transportadora.`;
    return falha(nome, MENSAGEM_CADASTRO_INVALIDO[item.canal], detalhe);
  }
  // Contingência n8n não transmite a observação: recusa explícita antes de criar a solicitação.
  const problemaN8n = problemaObservacaoViaN8n(item.canal, observacoes);
  if (problemaN8n !== null) return falha(nome, `Erro: ${problemaN8n}`, 'Observação para a transportadora não suportada no modo n8n; nada foi criado nem enviado.');
  // API sem campo de observação: só segue com o aviso confirmado pelo operador (nunca descarta em silêncio).
  if (item.canal === 'API' && observacoes !== null && item.cienteObservacaoNaoEnviadaApi !== true) {
    return falha(nome, MENSAGEM_OBSERVACAO_API_SEM_CONFIRMACAO, 'Observação preenchida para canal API sem confirmação do aviso.');
  }

  try {
    // WhatsApp direto (YCloud): a mensagem que SERIA enviada (observações da cotação + observação
    // desta transportadora + rótulos + dados da carga) precisa caber no limite do modo em uso —
    // template: parâmetro {{6}} ≤ 1000; texto: corpo ≤ 4096. Acima disso, recusa ANTES de criar a
    // solicitação (um "Reenviar" usaria o mesmo texto e falharia de novo). Nunca corta.
    if (item.canal === 'WHATSAPP' && config.fretesWhatsapp === 'ycloud') {
      const problema = problemaLimiteWhatsapp(
        payloadProvisorioWhatsapp(cotacao, transportadora, cubagem, observacoes),
        config.ycloudTemplateNome !== '' ? 'TEMPLATE' : 'TEXTO',
      );
      if (problema !== null) return falha(nome, `Erro: ${problema}`, 'Mensagem de WhatsApp excederia o limite; nada foi criado nem enviado.');
    }
    if (item.canal === 'API') {
      const r = await deps.cotarBraspress(cliente, cotacaoId, { cepOrigem: null, cubagem }, usuarioId);
      const prazo = r.cotacaoExterna.prazoDias === null ? '—' : `${r.cotacaoExterna.prazoDias} dia(s)`;
      return {
        resultado: {
          ...base,
          transportadora: nome,
          status: 'ENVIADO',
          propostaId: r.proposta.id,
          mensagem:
            `Cotado via API — ${formatarMoeda(r.cotacaoExterna.valorFrete)}, prazo ${prazo}${r.duplicada ? ' (proposta já registrada)' : ''}.` +
            (observacoes !== null ? ` ${MENSAGEM_OBSERVACAO_API_NAO_ENVIADA}` : ''),
        },
        detalheTecnico: observacoes !== null ? 'Observação para a transportadora não transmitida (API sem esse campo); operador confirmou o aviso.' : null,
      };
    }

    // Idempotência: nunca cria uma segunda solicitação para a mesma transportadora/canal
    // nesta cotação — com ERRO, o caminho é o "Reenviar" existente (mesma referência).
    const anterior = solicitacoesExistentes.find(
      (s) => s.transportadoraId === transportadora.id && s.canal === item.canal && s.status !== 'CANCELADA',
    );
    if (anterior !== undefined) {
      return {
        resultado: {
          ...base,
          transportadora: nome,
          status: 'NAO_ENVIADO',
          solicitacaoId: anterior.id,
          mensagem:
            anterior.status === 'ERRO'
              ? 'Já existe solicitação com erro para esta transportadora — use "Reenviar" na lista de solicitações.'
              : `Já solicitada nesta cotação (${anterior.status}).`,
        },
        detalheTecnico: null,
      };
    }

    // Mesmas linhas de embalagem da tela (formato `cubagem`), gravadas na solicitação para o
    // "Reenviar" reutilizar. Medidas exatamente como informadas; `volumes` da linha = quantidade.
    const embalagens =
      cubagem !== null && cubagem.length > 0
        ? cubagem.map((c) => ({ altura: c.altura, largura: c.largura, comprimento: c.comprimento, quantidade: c.volumes }))
        : null;
    const [solicitacao] = await deps.solicitar(
      cliente,
      cotacaoId,
      [{ transportadoraId: transportadora.id, emailManual, embalagens, observacoesTransportadora: observacoes }],
      item.canal,
      usuarioId,
    );
    if (solicitacao === undefined || solicitacao.status === 'ERRO') {
      // Destinatário recusado (SMTP) / número recusado (YCloud) = cadastro para o operador corrigir.
      const erro = solicitacao?.erroUltimaTentativa ?? '';
      const destinatarioRecusado =
        (item.canal === 'EMAIL' && erro.startsWith('SMTP_DESTINATARIO_RECUSADO')) || (item.canal === 'WHATSAPP' && erro.startsWith('YCLOUD_DESTINO_INVALIDO'));
      const mensagem = destinatarioRecusado ? MENSAGEM_CADASTRO_INVALIDO[item.canal] : MENSAGEM_FALHA_ENVIO[item.canal];
      return falha(nome, mensagem, solicitacao?.erroUltimaTentativa ?? 'Envio não confirmado.', {
        solicitacaoId: solicitacao?.id ?? null,
      });
    }
    // "Enviado" = aceito pelo fluxo n8n; confirmação real de entrega nunca é presumida aqui.
    return {
      resultado: {
        ...base,
        transportadora: nome,
        status: 'ENVIADO',
        solicitacaoId: solicitacao.id,
        mensagem: item.canal === 'EMAIL' ? MENSAGENS_ENVIO.EMAIL_ENVIADO : MENSAGENS_ENVIO.WHATSAPP_ENVIADO,
      },
      detalheTecnico: null,
    };
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    if (erro instanceof ErroValidacao && item.canal !== 'API' && ehErroCadastroCanal(erro)) {
      return falha(nome, MENSAGEM_CADASTRO_INVALIDO[item.canal], detalhe);
    }
    if (erro instanceof ErroBraspressNaoConfigurada || erro instanceof ErroBraspressFalhou) {
      return falha(nome, MENSAGENS_ENVIO.API_FALHOU, detalhe);
    }
    // Dados da cotação que o operador precisa corrigir (ex.: dimensões faltando) — mensagem acionável.
    if (erro instanceof ErroValidacao) return falha(nome, `Erro: ${erro.message}`, detalhe);
    console.error('Erro interno no envio de solicitação:', detalhe);
    return falha(nome, MENSAGEM_FALHA_ENVIO[item.canal], detalhe);
  }
}

/**
 * Payload equivalente ao que será montado no envio, só para medir a mensagem antes de criar a
 * solicitação. Referência e CNPJs com o MAIOR tamanho possível (pior caso) — o real nunca é maior.
 */
function payloadProvisorioWhatsapp(
  cotacao: CotacaoFrete,
  transportadora: Transportadora,
  cubagem: ItemCubagemBraspress[] | null,
  observacoesTransportadora: string | null,
) {
  const solicitacaoProvisoria = {
    id: 'provisoria',
    cotacaoFreteId: cotacao.id,
    transportadoraId: transportadora.id,
    canal: 'WHATSAPP',
    codigoReferencia: `${cotacao.codigo}-00000000`,
    emailDestino: null,
    emailOrigem: null,
    embalagens: (cubagem ?? []).map((c) => ({ altura: c.altura, largura: c.largura, comprimento: c.comprimento, quantidade: c.volumes })),
    observacoesTransportadora,
    destinoEnviado: montarDestinoEnviado(cotacao),
  } as unknown as SolicitacaoCotacao;
  return montarPayloadN8n(cotacao, solicitacaoProvisoria, { cnpjOrigem: '00000000000000', cnpjDestino: '00000000000000' }, transportadora.whatsappCotacao);
}

/**
 * Um registro de auditoria por transportadora/canal do lote (data/hora = `criado_em`). Falha
 * ao auditar é logada e nunca derruba o envio das demais transportadoras.
 */
async function auditarResultadoEnvio(
  deps: DependenciasEnvio,
  cotacaoId: string,
  usuarioId: string,
  resultado: ResultadoEnvioTransportadora,
  detalheTecnico: string | null,
): Promise<void> {
  try {
    await deps.registrarAuditoria({
      usuarioId,
      acao: 'ENVIO_SOLICITACAO_RESULTADO',
      entidade: 'cotacao_frete',
      entidadeId: cotacaoId,
      valorNovo: {
        transportadoraId: resultado.transportadoraId,
        transportadora: resultado.transportadora,
        canal: resultado.canal,
        status: resultado.status,
        mensagem: resultado.mensagem,
        detalheTecnico,
        solicitacaoId: resultado.solicitacaoId,
        propostaId: resultado.propostaId,
      },
    });
  } catch (erro) {
    console.error('Falha ao registrar auditoria do envio de solicitação:', erro instanceof Error ? erro.message : erro);
  }
}
