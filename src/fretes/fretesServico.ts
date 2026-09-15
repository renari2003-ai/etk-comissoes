/**
 * Camada de serviço do módulo de Fretes (seção 17: rotas → serviço → banco, nunca lógica
 * de negócio direto nas rotas). Orquestra os repositórios e aplica as regras que não são
 * puramente de cálculo (essas ficam em `calculo.ts`): transições de status, seleção de
 * proposta, fechamento transacional e auditoria.
 */

import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { registrarAuditoria } from './auditoriaRepositorio.js';
import { calcularFreteFinal, calcularPercentualAcrescimo, calcularValorAcrescimo } from './calculo.js';
import {
  atualizarCotacao,
  buscarCotacaoPorId,
  criarCotacao,
  definirStatusCotacao,
  listarCotacoes,
  type DadosAtualizacaoCotacao,
  type DadosNovaCotacao,
  type FiltrosCotacao,
} from './cotacoesRepositorio.js';
import { buscarFechamentoPorCotacao, inserirFechamento, resumirFechamentos } from './fechamentosRepositorio.js';
import {
  atualizarStatusProposta,
  criarProposta,
  listarPropostasPorCotacao,
  selecionarPropostaTransacional,
  type DadosNovaProposta,
} from './propostasRepositorio.js';
import { garantirEsquemaFretes, nomeTabelaCotacoes } from './schema.js';
import {
  atualizarTransportadora,
  criarTransportadora,
  definirAtivaTransportadora,
  listarTransportadoras,
  type DadosTransportadora,
} from './transportadorasRepositorio.js';
import type { CotacaoFrete, FechamentoFrete, ModoCalculoFechamento, PropostaFrete, Transportadora } from './tipos.js';

// --- Transportadoras -------------------------------------------------------

export async function servicoListarTransportadoras(somenteAtivas: boolean): Promise<Transportadora[]> {
  return listarTransportadoras(somenteAtivas);
}

export async function servicoCriarTransportadora(dados: DadosTransportadora, usuarioId: string): Promise<Transportadora> {
  const transportadora = await criarTransportadora(dados);
  await registrarAuditoria({
    usuarioId,
    acao: 'TRANSPORTADORA_CRIADA',
    entidade: 'transportadora',
    entidadeId: transportadora.id,
    valorNovo: transportadora,
  });
  return transportadora;
}

export async function servicoAtualizarTransportadora(
  id: string,
  dados: Partial<DadosTransportadora>,
  usuarioId: string,
): Promise<Transportadora> {
  const transportadora = await atualizarTransportadora(id, dados);
  await registrarAuditoria({
    usuarioId,
    acao: 'TRANSPORTADORA_EDITADA',
    entidade: 'transportadora',
    entidadeId: transportadora.id,
    valorNovo: transportadora,
  });
  return transportadora;
}

export async function servicoDefinirAtivaTransportadora(id: string, ativo: boolean, usuarioId: string): Promise<Transportadora> {
  const transportadora = await definirAtivaTransportadora(id, ativo);
  await registrarAuditoria({
    usuarioId,
    acao: 'TRANSPORTADORA_EDITADA',
    entidade: 'transportadora',
    entidadeId: transportadora.id,
    valorNovo: { ativo },
  });
  return transportadora;
}

// --- Cotações ----------------------------------------------------------

export async function servicoCriarCotacao(dados: DadosNovaCotacao, usuarioId: string): Promise<CotacaoFrete> {
  const cotacao = await criarCotacao(dados, usuarioId);
  await registrarAuditoria({ usuarioId, acao: 'COTACAO_CRIADA', entidade: 'cotacao_frete', entidadeId: cotacao.id, valorNovo: cotacao });
  return cotacao;
}

export async function servicoListarCotacoes(filtros: FiltrosCotacao): Promise<CotacaoFrete[]> {
  return listarCotacoes(filtros);
}

export async function servicoBuscarCotacao(id: string): Promise<CotacaoFrete> {
  const cotacao = await buscarCotacaoPorId(id);
  if (cotacao === null) throw new ErroValidacao('Cotação não encontrada.');
  return cotacao;
}

export async function servicoAtualizarCotacao(id: string, dados: DadosAtualizacaoCotacao, usuarioId: string): Promise<CotacaoFrete> {
  const cotacao = await atualizarCotacao(id, dados);
  await registrarAuditoria({ usuarioId, acao: 'COTACAO_EDITADA', entidade: 'cotacao_frete', entidadeId: cotacao.id, valorNovo: cotacao });
  return cotacao;
}

export async function servicoCancelarCotacao(id: string, usuarioId: string): Promise<CotacaoFrete> {
  const atual = await servicoBuscarCotacao(id);
  if (atual.status === 'FECHADA') throw new ErroValidacao('Não é possível cancelar uma cotação já fechada.');
  if (atual.status === 'CANCELADA') throw new ErroValidacao('Esta cotação já está cancelada.');
  const cotacao = await definirStatusCotacao(id, 'CANCELADA');
  await registrarAuditoria({ usuarioId, acao: 'COTACAO_CANCELADA', entidade: 'cotacao_frete', entidadeId: id, valorAnterior: atual.status, valorNovo: 'CANCELADA' });
  return cotacao;
}

// --- Propostas -----------------------------------------------------------

/**
 * Cria a proposta e, se a cotação ainda estava em RASCUNHO, avança automaticamente para
 * AGUARDANDO_PROPOSTAS → o status "aguardando" só descreve o fato de já existir alguma
 * proposta — não é uma decisão de negócio, então não é considerado "automatizar o
 * acréscimo" (regra proibida na seção 8, que é só sobre o percentual em si).
 */
export async function servicoCriarProposta(dados: DadosNovaProposta, usuarioId: string): Promise<PropostaFrete> {
  const cotacao = await servicoBuscarCotacao(dados.cotacaoId);
  if (cotacao.status === 'FECHADA' || cotacao.status === 'CANCELADA') {
    throw new ErroValidacao(`Não é possível adicionar proposta a uma cotação com status ${cotacao.status}.`);
  }
  const proposta = await criarProposta(dados);
  if (cotacao.status === 'RASCUNHO' || cotacao.status === 'AGUARDANDO_PROPOSTAS') {
    await definirStatusCotacao(cotacao.id, 'EM_ANALISE');
  }
  await registrarAuditoria({ usuarioId, acao: 'PROPOSTA_CRIADA', entidade: 'proposta_frete', entidadeId: proposta.id, valorNovo: proposta });
  return proposta;
}

export async function servicoListarPropostas(cotacaoId: string): Promise<PropostaFrete[]> {
  await servicoBuscarCotacao(cotacaoId); // 404 explícito se a cotação não existir
  return listarPropostasPorCotacao(cotacaoId);
}

/** Seleciona a proposta (transacional — as demais da mesma cotação deixam de estar selecionadas) e avança a cotação para AGUARDANDO_APROVACAO. */
export async function servicoSelecionarProposta(cotacaoId: string, propostaId: string, usuarioId: string): Promise<PropostaFrete> {
  const cotacao = await servicoBuscarCotacao(cotacaoId);
  if (cotacao.status === 'FECHADA' || cotacao.status === 'CANCELADA') {
    throw new ErroValidacao(`Não é possível selecionar proposta numa cotação com status ${cotacao.status}.`);
  }
  const proposta = await selecionarPropostaTransacional(cotacaoId, propostaId);
  await definirStatusCotacao(cotacaoId, 'AGUARDANDO_APROVACAO');
  await registrarAuditoria({ usuarioId, acao: 'PROPOSTA_SELECIONADA', entidade: 'proposta_frete', entidadeId: proposta.id, valorNovo: proposta });
  return proposta;
}

export async function servicoRejeitarProposta(propostaId: string, usuarioId: string): Promise<PropostaFrete> {
  const proposta = await atualizarStatusProposta(propostaId, 'REJEITADA');
  await registrarAuditoria({ usuarioId, acao: 'PROPOSTA_REJEITADA', entidade: 'proposta_frete', entidadeId: proposta.id, valorNovo: proposta });
  return proposta;
}

// --- Comparação (seção 25 — só informativa, nunca decide sozinha) ---------

export interface LinhaComparacaoProposta {
  proposta: PropostaFrete;
  transportadora: Transportadora;
}

export async function servicoCompararPropostas(cotacaoId: string): Promise<LinhaComparacaoProposta[]> {
  const propostas = await servicoListarPropostas(cotacaoId);
  const transportadoras = await listarTransportadoras(false);
  const porId = new Map(transportadoras.map((t) => [t.id, t]));
  return propostas
    .map((proposta) => {
      const transportadora = porId.get(proposta.transportadoraId);
      return transportadora === undefined ? null : { proposta, transportadora };
    })
    .filter((linha): linha is LinhaComparacaoProposta => linha !== null);
}

// --- Fechamento (seção 7, 12, 35, 36) -------------------------------------

export interface DadosFechamento {
  cotacaoId: string;
  /** Quando informado, o percentual é aplicado sobre o custo (modo PERCENTUAL). */
  percentualAcrescimo?: number;
  /** Quando informado (e `percentualAcrescimo` ausente), o percentual é calculado de forma reversa (modo VALOR_FINAL) — nunca altera o custo original. */
  valorFreteClienteInformado?: number;
  observacoes: string | null;
}

/**
 * Fechamento explícito (seção 12): trava a linha da cotação com `SELECT ... FOR UPDATE`
 * dentro de uma transação (mesmo padrão de `src/omie/limitador.ts`), garantindo que duas
 * tentativas concorrentes de fechar a MESMA cotação nunca resultem em dois fechamentos —
 * a segunda tentativa encontra `status = 'FECHADA'` já commitado pela primeira e falha
 * com erro de validação (seção 35). A constraint `UNIQUE (cotacao_id)` na tabela de
 * fechamentos é a segunda camada de proteção, caso a trava de linha algum dia seja
 * contornada por um caminho de código diferente.
 */
export async function servicoFecharCotacao(dados: DadosFechamento, usuarioId: string): Promise<FechamentoFrete> {
  await garantirEsquemaFretes();
  if (dados.percentualAcrescimo === undefined && dados.valorFreteClienteInformado === undefined) {
    throw new ErroValidacao('Informe o percentual de acréscimo ou o valor final para o cliente.');
  }

  const pool = obterPool();
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const { rows } = await cliente.query<{ status: string }>(
      `SELECT status FROM ${nomeTabelaCotacoes()} WHERE id = $1 FOR UPDATE`,
      [dados.cotacaoId],
    );
    const statusAtual = rows[0]?.status;
    if (statusAtual === undefined) throw new ErroValidacao('Cotação não encontrada.');
    if (statusAtual === 'FECHADA') throw new ErroValidacao('Esta cotação já foi fechada.');
    if (statusAtual === 'CANCELADA') throw new ErroValidacao('Não é possível fechar uma cotação cancelada.');

    const propostas = await listarPropostasPorCotacao(dados.cotacaoId);
    const propostaSelecionada = propostas.find((p) => p.selecionada);
    if (propostaSelecionada === undefined) {
      throw new ErroValidacao('Selecione uma proposta antes de fechar a cotação.');
    }

    const custoFrete = propostaSelecionada.valorCusto;
    let modoCalculo: ModoCalculoFechamento;
    let percentualAcrescimo: number;
    let valorFreteCliente: number;

    if (dados.percentualAcrescimo !== undefined) {
      if (dados.percentualAcrescimo < 0) throw new ErroValidacao('O percentual de acréscimo não pode ser negativo.');
      modoCalculo = 'PERCENTUAL';
      percentualAcrescimo = dados.percentualAcrescimo;
      valorFreteCliente = calcularFreteFinal(custoFrete, percentualAcrescimo);
    } else {
      const valorFinal = dados.valorFreteClienteInformado as number;
      if (valorFinal < custoFrete) throw new ErroValidacao('O valor final para o cliente não pode ser menor que o custo do frete.');
      modoCalculo = 'VALOR_FINAL';
      valorFreteCliente = valorFinal;
      percentualAcrescimo = calcularPercentualAcrescimo(custoFrete, valorFinal) ?? 0;
    }
    const valorAcrescimo = calcularValorAcrescimo(custoFrete, percentualAcrescimo);
    // Modo VALOR_FINAL: o acréscimo em R$ é a diferença real informada (mais exato que
    // reconstruir a partir do percentual arredondado) — evita discrepância de centavos.
    const valorAcrescimoFinal = modoCalculo === 'VALOR_FINAL' ? Math.round((valorFreteCliente - custoFrete) * 100) / 100 : valorAcrescimo;

    const fechamento = await inserirFechamento(cliente, {
      cotacaoId: dados.cotacaoId,
      propostaId: propostaSelecionada.id,
      transportadoraId: propostaSelecionada.transportadoraId,
      custoFrete,
      percentualAcrescimo,
      valorAcrescimo: valorAcrescimoFinal,
      valorFreteCliente,
      modoCalculo,
      usuarioFechamento: usuarioId,
      observacoes: dados.observacoes,
    });

    await cliente.query(`UPDATE ${nomeTabelaCotacoes()} SET status = 'FECHADA', fechado_em = now(), atualizado_em = now() WHERE id = $1`, [
      dados.cotacaoId,
    ]);

    await registrarAuditoria(
      { usuarioId, acao: 'COTACAO_FECHADA', entidade: 'cotacao_frete', entidadeId: dados.cotacaoId, valorNovo: fechamento },
      cliente,
    );

    await cliente.query('COMMIT');
    return fechamento;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

export async function servicoBuscarFechamento(cotacaoId: string): Promise<FechamentoFrete | null> {
  return buscarFechamentoPorCotacao(cotacaoId);
}

// --- Dashboard (seção 20 — só dados do próprio módulo) --------------------

export interface DashboardFretes {
  cotacoesPorStatus: Record<string, number>;
  resumoFechamentos: {
    quantidade: number;
    custoTotal: number;
    valorClienteTotal: number;
    acrescimoTotal: number;
  };
}

export async function servicoDashboard(): Promise<DashboardFretes> {
  const [cotacoes, resumo] = await Promise.all([listarCotacoes({}), resumirFechamentos()]);
  const cotacoesPorStatus: Record<string, number> = {
    RASCUNHO: 0,
    AGUARDANDO_PROPOSTAS: 0,
    EM_ANALISE: 0,
    AGUARDANDO_APROVACAO: 0,
    FECHADA: 0,
    CANCELADA: 0,
  };
  for (const cotacao of cotacoes) cotacoesPorStatus[cotacao.status] = (cotacoesPorStatus[cotacao.status] ?? 0) + 1;
  return { cotacoesPorStatus, resumoFechamentos: resumo };
}
