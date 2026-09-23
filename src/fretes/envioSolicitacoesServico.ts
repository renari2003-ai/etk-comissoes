/**
 * Envio único de solicitações de cotação (detalhe da cotação): o operador escolhe até
 * `LIMITE_TRANSPORTADORAS_POR_ENVIO` transportadoras e um canal para cada uma; este
 * orquestrador só DESPACHA para os serviços que já existem — nenhuma implementação nova de
 * e-mail, WhatsApp ou Braspress:
 *   - API (só Braspress)  → `servicoCotarBraspress`
 *   - EMAIL / WHATSAPP    → `servicoSolicitarCotacoes` (n8n; e-mail resolvido MANUAL > CADASTRO > OMIE > bloqueio)
 * Cadastro e canal são sempre revalidados aqui (nunca confia no navegador). Uma
 * transportadora com problema não impede as demais: cada uma recebe seu resultado.
 */
import type { ClienteOmie } from '../omie/cliente.js';
import { ErroValidacao } from '../validacao.js';
import { ehTransportadoraBraspress, servicoCotarBraspress } from './braspressServico.js';
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
import type { Transportadora } from './tipos.js';

export type CanalEnvio = 'EMAIL' | 'WHATSAPP' | 'API';

export const CANAIS_ENVIO: readonly CanalEnvio[] = ['EMAIL', 'WHATSAPP', 'API'];
export const LIMITE_TRANSPORTADORAS_POR_ENVIO = 7;
const LIMITE_RESULTADOS_BUSCA = 15;

const ROTULOS_CANAL_ENVIO: Record<CanalEnvio, string> = { EMAIL: 'E-mail', WHATSAPP: 'WhatsApp', API: 'API' };

/**
 * Canais realmente utilizáveis para a transportadora:
 * - EMAIL: e-mail para cotação válido no cadastro ETK, ou código Omie vinculado (o envio
 *   resolve MANUAL > CADASTRO > OMIE > bloqueio — Omie sem e-mail falha explicitamente).
 * - WHATSAPP: indisponível nesta fase, mesmo com `whatsappCotacao` cadastrado — o payload do
 *   n8n ainda não leva o número. Nunca inferido de `telefone` nem de `canalPrincipal`.
 * - API: só a Braspress (única integração existente). `urlPortal` nunca conta como API.
 */
export function canaisDisponiveis(t: Transportadora): CanalEnvio[] {
  const canais: CanalEnvio[] = [];
  if (emailValido(t.email) || t.codigoClienteOmie !== null) canais.push('EMAIL');
  if (ehTransportadoraBraspress(t)) canais.push('API');
  return canais;
}

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
  /** Portal/site é só informação operacional — nunca vira API. */
  urlPortal: string | null;
  /** Número cadastrado como WhatsApp (envio ainda indisponível nesta fase). */
  whatsappCadastrado: boolean;
  /** Integração API operacional (nesta fase: só Braspress). */
  apiIntegrada: boolean;
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
    urlPortal: t.urlPortal,
    whatsappCadastrado: t.whatsappCotacao !== null,
    apiIntegrada: disponiveis.includes('API'),
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
  canal: CanalEnvio;
  /** Só para EMAIL: override manual válido apenas nesta solicitação (mesma regra do fluxo existente). */
  emailManual: string | null;
}

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
}

const DEPENDENCIAS_PADRAO: DependenciasEnvio = {
  buscarCotacao: servicoBuscarCotacao,
  buscarTransportadora: buscarTransportadoraPorId,
  listarSolicitacoes: listarSolicitacoesPorCotacao,
  solicitar: servicoSolicitarCotacoes,
  cotarBraspress: servicoCotarBraspress,
};

function nomeExibicao(t: Transportadora): string {
  return t.nomeFantasia ?? t.nomeRazaoSocial;
}

function formatarMoeda(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
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
  const solicitacoesExistentes = await deps.listarSolicitacoes(cotacaoId);

  const resultados: ResultadoEnvioTransportadora[] = [];
  for (const item of itens) {
    const base = { transportadoraId: item.transportadoraId, canal: item.canal, solicitacaoId: null, propostaId: null };
    const transportadora = await deps.buscarTransportadora(item.transportadoraId);
    if (transportadora === null) {
      resultados.push({ ...base, transportadora: '—', status: 'FALHOU', mensagem: 'Transportadora não encontrada.' });
      continue;
    }
    const nome = nomeExibicao(transportadora);
    if (!transportadora.ativo) {
      resultados.push({ ...base, transportadora: nome, status: 'FALHOU', mensagem: 'Transportadora inativa.' });
      continue;
    }
    if (!canaisDisponiveis(transportadora).includes(item.canal)) {
      resultados.push({
        ...base,
        transportadora: nome,
        status: 'FALHOU',
        mensagem: `${ROTULOS_CANAL_ENVIO[item.canal]} não disponível para esta transportadora.`,
      });
      continue;
    }

    try {
      if (item.canal === 'API') {
        const r = await deps.cotarBraspress(cliente, cotacaoId, { cepOrigem: null, cubagem }, usuarioId);
        const prazo = r.cotacaoExterna.prazoDias === null ? '—' : `${r.cotacaoExterna.prazoDias} dia(s)`;
        resultados.push({
          ...base,
          transportadora: nome,
          status: 'ENVIADO',
          propostaId: r.proposta.id,
          mensagem: `Cotado via API — ${formatarMoeda(r.cotacaoExterna.valorFrete)}, prazo ${prazo}${r.duplicada ? ' (proposta já registrada)' : ''}.`,
        });
        continue;
      }

      // Idempotência: nunca cria uma segunda solicitação para a mesma transportadora/canal
      // nesta cotação — com ERRO, o caminho é o "Reenviar" existente (mesma referência).
      const anterior = solicitacoesExistentes.find(
        (s) => s.transportadoraId === transportadora.id && s.canal === item.canal && s.status !== 'CANCELADA',
      );
      if (anterior !== undefined) {
        resultados.push({
          ...base,
          transportadora: nome,
          status: 'NAO_ENVIADO',
          solicitacaoId: anterior.id,
          mensagem:
            anterior.status === 'ERRO'
              ? 'Já existe solicitação com erro para esta transportadora — use "Reenviar" na lista de solicitações.'
              : `Já solicitada nesta cotação (${anterior.status}).`,
        });
        continue;
      }

      const [solicitacao] = await deps.solicitar(
        cliente,
        cotacaoId,
        [{ transportadoraId: transportadora.id, emailManual: item.canal === 'EMAIL' ? item.emailManual : null }],
        item.canal,
        usuarioId,
      );
      if (solicitacao === undefined || solicitacao.status === 'ERRO') {
        resultados.push({
          ...base,
          transportadora: nome,
          status: 'FALHOU',
          solicitacaoId: solicitacao?.id ?? null,
          mensagem: 'Falha ao enviar ao serviço de automação — a solicitação ficou registrada com erro; use "Reenviar".',
        });
        continue;
      }
      const destino = solicitacao.emailDestino !== null ? ` para ${solicitacao.emailDestino}` : '';
      resultados.push({
        ...base,
        transportadora: nome,
        status: 'ENVIADO',
        solicitacaoId: solicitacao.id,
        mensagem: `Enviado via ${ROTULOS_CANAL_ENVIO[item.canal]}${destino}.`,
      });
    } catch (erro) {
      let mensagem: string;
      if (erro instanceof ErroBraspressNaoConfigurada) {
        mensagem = 'Integração Braspress não configurada no servidor.';
      } else if (erro instanceof ErroValidacao || erro instanceof ErroBraspressFalhou) {
        mensagem = erro.message;
      } else {
        console.error('Erro interno no envio de solicitação:', erro instanceof Error ? erro.message : erro);
        mensagem = 'Erro interno ao processar esta transportadora — nenhuma confirmação de envio.';
      }
      resultados.push({ ...base, transportadora: nome, status: 'FALHOU', mensagem });
    }
  }
  return resultados;
}
