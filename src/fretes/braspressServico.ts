/**
 * Fase Braspress 1 — cotação via API oficial integrada ao fluxo de propostas existente.
 * Resposta válida vira (ou reaproveita) uma proposta em `propostas_frete` com
 * `origem_proposta = 'API_BRASPRESS'`; a partir daí segue Logística → Vendedor → escolha,
 * sem regra nova. Não escreve na Omie nem dispara e-mail/WhatsApp.
 */
import { ErroValidacao } from '../validacao.js';
import { registrarAuditoria } from './auditoriaRepositorio.js';
import { definirStatusCotacao } from './cotacoesRepositorio.js';
import { servicoBuscarCotacao } from './fretesServico.js';
import {
  cotarNaBraspress,
  ErroDadosBraspressIncompletos,
  type CotacaoBraspressNormalizada,
  type ItemCubagemBraspress,
  type OpcoesBraspress,
} from './integracoes/braspressCliente.js';
import { criarPropostaApiExterna, listarPropostasPorCotacao } from './propostasRepositorio.js';
import { criarTransportadora, listarTransportadoras } from './transportadorasRepositorio.js';
import type { PropostaFrete } from './tipos.js';

export const ORIGEM_PROPOSTA_API_BRASPRESS = 'API_BRASPRESS';

export interface DadosCotarBraspress {
  /** Só usado se a cotação não tiver CEP de origem cadastrado. */
  cepOrigem: string | null;
  cubagem: ItemCubagemBraspress[] | null;
}

export interface ResultadoCotarBraspress {
  cotacaoExterna: CotacaoBraspressNormalizada;
  proposta: PropostaFrete;
  /** true = já existia uma proposta equivalente; nada foi criado. */
  duplicada: boolean;
}

/** O cadastro Omie do cliente não tem CNPJ utilizável (ausente, CPF ou dígitos inválidos). */
export class ErroCnpjDestinatarioNaoDisponivel extends ErroValidacao {
  readonly codigo = 'CNPJ_DESTINATARIO_NAO_DISPONIVEL';
  constructor() {
    super('CNPJ_DESTINATARIO_NAO_DISPONIVEL: o cliente da cotação não possui um CNPJ válido no cadastro da Omie.');
  }
}

/** Consulta de cliente da Omie — apenas leitura (`ConsultarCliente`, /geral/clientes/). */
export interface ConsultaClienteOmie {
  consultarCliente(codigoCliente: number): Promise<{ cnpjCpf: string | null } | null>;
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base: string): number => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * (pesos[i] as number), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(cnpj.slice(0, 12)) === Number(cnpj[12]) && digito(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

async function obterCnpjDestinatario(cliente: ConsultaClienteOmie, clienteOmieId: number | null): Promise<string> {
  if (clienteOmieId === null) throw new ErroCnpjDestinatarioNaoDisponivel();
  const registro = await cliente.consultarCliente(clienteOmieId);
  const cnpj = (registro?.cnpjCpf ?? '').replace(/\D/g, '');
  if (!cnpjValido(cnpj)) throw new ErroCnpjDestinatarioNaoDisponivel();
  return cnpj;
}

/** Erro 400 que carrega exatamente o que falta — nada é inventado. */
export class ErroDadosCotacaoIncompletos extends ErroValidacao {
  constructor(readonly faltando: string[]) {
    super(`Dados insuficientes para cotar na Braspress. Faltando: ${faltando.join(', ')}.`);
  }
}

async function obterTransportadoraBraspress(): Promise<string> {
  const todas = await listarTransportadoras(false);
  const existente = todas.find((t) => /braspress/i.test(t.nomeRazaoSocial) || /braspress/i.test(t.nomeFantasia ?? ''));
  if (existente !== undefined) return existente.id;
  const criada = await criarTransportadora({
    nomeRazaoSocial: 'BRASPRESS',
    nomeFantasia: 'BRASPRESS',
    cnpj: null,
    email: null,
    telefone: null,
    contato: null,
    observacoes: 'Criada automaticamente pela integração via API Braspress.',
  });
  return criada.id;
}

function idExterno(mensagemOriginal: string | null): string | null {
  if (mensagemOriginal === null) return null;
  try {
    const json = JSON.parse(mensagemOriginal) as { idCotacaoExterna?: unknown };
    return typeof json.idCotacaoExterna === 'string' ? json.idCotacaoExterna : null;
  } catch {
    return null;
  }
}

export async function servicoCotarBraspress(
  cliente: ConsultaClienteOmie,
  cotacaoId: string,
  dados: DadosCotarBraspress,
  usuarioId: string,
  opcoesApi: OpcoesBraspress = {},
): Promise<ResultadoCotarBraspress> {
  const cotacao = await servicoBuscarCotacao(cotacaoId);
  if (cotacao.status === 'FECHADA' || cotacao.status === 'CANCELADA') {
    throw new ErroValidacao(`Não é possível cotar numa cotação com status ${cotacao.status}.`);
  }
  if (cotacao.modalidadeExecucao !== 'TRANSPORTADORA') {
    throw new ErroValidacao(`Cotação Braspress só se aplica à modalidade TRANSPORTADORA (esta cotação é ${cotacao.modalidadeExecucao}).`);
  }

  const cnpjDestinatario = await obterCnpjDestinatario(cliente, cotacao.clienteOmieId);
  const cepOrigem = cotacao.cepOrigem ?? dados.cepOrigem;
  let cotacaoExterna: CotacaoBraspressNormalizada;
  try {
    cotacaoExterna = await cotarNaBraspress(
      {
        cnpjDestinatario,
        cepOrigem,
        cepDestino: cotacao.cepDestino,
        valorMercadoria: cotacao.valorMercadoria,
        peso: cotacao.peso,
        volumes: cotacao.volumes,
        tipoFrete: cotacao.modalidade,
        cubagem: dados.cubagem,
      },
      opcoesApi,
    );
  } catch (erro) {
    if (erro instanceof ErroDadosBraspressIncompletos) throw new ErroDadosCotacaoIncompletos(erro.faltando);
    throw erro;
  }

  const existentes = (await listarPropostasPorCotacao(cotacaoId)).filter((p) => p.origemProposta === ORIGEM_PROPOSTA_API_BRASPRESS);
  const hoje = new Date().toISOString().slice(0, 10);
  const duplicada = existentes.find(
    (p) =>
      idExterno(p.mensagemOriginal) === cotacaoExterna.idCotacaoExterna ||
      (p.valorCusto === cotacaoExterna.valorFrete && p.prazoDias === cotacaoExterna.prazoDias && p.criadoEm.slice(0, 10) === hoje),
  );
  if (duplicada !== undefined) return { cotacaoExterna, proposta: duplicada, duplicada: true };

  const transportadoraId = await obterTransportadoraBraspress();
  const proposta = await criarPropostaApiExterna({
    cotacaoId,
    transportadoraId,
    valorCusto: cotacaoExterna.valorFrete,
    prazoDias: cotacaoExterna.prazoDias,
    validade: cotacaoExterna.validade,
    peso: cotacao.peso,
    volumes: cotacao.volumes,
    origem: cotacao.origem,
    destino: cotacao.destino,
    origemProposta: ORIGEM_PROPOSTA_API_BRASPRESS,
    mensagemOriginal: JSON.stringify(cotacaoExterna),
  });
  if (cotacao.status === 'RASCUNHO' || cotacao.status === 'AGUARDANDO_PROPOSTAS') {
    await definirStatusCotacao(cotacao.id, 'EM_ANALISE');
  }
  await registrarAuditoria({
    usuarioId,
    acao: 'PROPOSTA_API_BRASPRESS_CRIADA',
    entidade: 'proposta_frete',
    entidadeId: proposta.id,
    valorNovo: { idCotacaoExterna: cotacaoExterna.idCotacaoExterna, valorFrete: cotacaoExterna.valorFrete, prazoDias: cotacaoExterna.prazoDias },
  });
  return { cotacaoExterna, proposta, duplicada: false };
}
