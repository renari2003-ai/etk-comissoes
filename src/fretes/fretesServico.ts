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
import { buscarFechamentoPorCotacao, inserirFechamento, resumirFechamentos, resumirFechamentosPorModalidade, type ResumoFechamentos } from './fechamentosRepositorio.js';
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
import {
  atualizarVeiculo,
  buscarVeiculoPorId,
  criarVeiculo,
  definirAtivoVeiculo,
  listarVeiculos,
  type DadosVeiculo,
} from './veiculosRepositorio.js';
import type { CotacaoFrete, FechamentoFrete, ModalidadeExecucao, ModoCalculoFechamento, PropostaFrete, Transportadora, Veiculo } from './tipos.js';

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

// --- Veículos próprios (Fase 2) --------------------------------------------

export async function servicoListarVeiculos(somenteAtivos: boolean): Promise<Veiculo[]> {
  return listarVeiculos(somenteAtivos);
}

export async function servicoCriarVeiculo(dados: DadosVeiculo, usuarioId: string): Promise<Veiculo> {
  const veiculo = await criarVeiculo(dados);
  await registrarAuditoria({ usuarioId, acao: 'VEICULO_CRIADO', entidade: 'veiculo_frete', entidadeId: veiculo.id, valorNovo: veiculo });
  return veiculo;
}

export async function servicoAtualizarVeiculo(id: string, dados: Partial<DadosVeiculo>, usuarioId: string): Promise<Veiculo> {
  const veiculo = await atualizarVeiculo(id, dados);
  await registrarAuditoria({ usuarioId, acao: 'VEICULO_EDITADO', entidade: 'veiculo_frete', entidadeId: veiculo.id, valorNovo: veiculo });
  return veiculo;
}

export async function servicoDefinirAtivoVeiculo(id: string, ativo: boolean, usuarioId: string): Promise<Veiculo> {
  const veiculo = await definirAtivoVeiculo(id, ativo);
  await registrarAuditoria({
    usuarioId,
    acao: ativo ? 'VEICULO_ATIVADO' : 'VEICULO_DESATIVADO',
    entidade: 'veiculo_frete',
    entidadeId: veiculo.id,
    valorNovo: { ativo },
  });
  return veiculo;
}

/**
 * Garante que um `veiculoId` informado numa cotação referencia um veículo que existe E
 * está ativo (seção 18: "Somente veículos ativos devem aparecer para seleção em novas
 * entregas" — validado também no backend, nunca só escondido no frontend).
 */
async function validarVeiculoAtivo(veiculoId: string): Promise<void> {
  const veiculo = await buscarVeiculoPorId(veiculoId);
  if (veiculo === null) throw new ErroValidacao('Veículo não encontrado.');
  if (!veiculo.ativo) throw new ErroValidacao('Este veículo está inativo e não pode ser selecionado.');
}

// --- Cotações ----------------------------------------------------------

/**
 * Valida a combinação `modalidadeExecucao` × campos específicos (seção 9): nunca exige
 * transportadora/proposta para VEICULO_PROPRIO/RETIRA, e exige um veículo ATIVO quando a
 * modalidade é VEICULO_PROPRIO e um `veiculoId` foi informado na criação/edição da cotação
 * (o veículo também pode ser definido depois, antes do fechamento — ver `servicoFecharCotacao`).
 */
async function validarCamposPorModalidadeExecucao(
  modalidadeExecucao: ModalidadeExecucao,
  veiculoId: string | null | undefined,
): Promise<void> {
  if (modalidadeExecucao === 'VEICULO_PROPRIO' && veiculoId !== null && veiculoId !== undefined) {
    await validarVeiculoAtivo(veiculoId);
  }
}

export async function servicoCriarCotacao(dados: DadosNovaCotacao, usuarioId: string): Promise<CotacaoFrete> {
  await validarCamposPorModalidadeExecucao(dados.modalidadeExecucao, dados.veiculoId);
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
  const anterior = await servicoBuscarCotacao(id);
  const modalidadeExecucaoFinal = dados.modalidadeExecucao ?? anterior.modalidadeExecucao;
  const veiculoIdFinal = dados.veiculoId !== undefined ? dados.veiculoId : anterior.veiculoId;
  await validarCamposPorModalidadeExecucao(modalidadeExecucaoFinal, veiculoIdFinal);

  const cotacao = await atualizarCotacao(id, dados);
  await registrarAuditoria({ usuarioId, acao: 'COTACAO_EDITADA', entidade: 'cotacao_frete', entidadeId: cotacao.id, valorNovo: cotacao });
  if (dados.modalidadeExecucao !== undefined && dados.modalidadeExecucao !== anterior.modalidadeExecucao) {
    await registrarAuditoria({
      usuarioId,
      acao: 'MODALIDADE_ALTERADA',
      entidade: 'cotacao_frete',
      entidadeId: cotacao.id,
      valorAnterior: anterior.modalidadeExecucao,
      valorNovo: cotacao.modalidadeExecucao,
    });
  }
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
  if (cotacao.modalidadeExecucao !== 'TRANSPORTADORA') {
    throw new ErroValidacao(
      `Propostas de transportadora só se aplicam à modalidade TRANSPORTADORA (esta cotação é ${cotacao.modalidadeExecucao}).`,
    );
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
  if (cotacao.modalidadeExecucao !== 'TRANSPORTADORA') {
    throw new ErroValidacao(`Seleção de proposta só se aplica à modalidade TRANSPORTADORA (esta cotação é ${cotacao.modalidadeExecucao}).`);
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
  /** Quando informado, o percentual é aplicado sobre o custo (modo PERCENTUAL). Ignorado (sempre 0) na modalidade RETIRA — seção 12. */
  percentualAcrescimo?: number;
  /** Quando informado (e `percentualAcrescimo` ausente), o percentual é calculado de forma reversa (modo VALOR_FINAL) — nunca altera o custo original. Ignorado na modalidade RETIRA. */
  valorFreteClienteInformado?: number;
  /** Só usado quando `modalidadeExecucao === 'VEICULO_PROPRIO'` e a cotação ainda não tem `custoManual` definido — permite informar o custo interno no próprio ato do fechamento. */
  custoManual?: number;
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
 *
 * Fase 2 (seções 3/7/9/12): o custo/proposta/transportadora/veículo usados dependem da
 * `modalidade_execucao` da cotação — TRANSPORTADORA exige proposta selecionada (igual à
 * Fase 1); VEICULO_PROPRIO exige um veículo vinculado e usa `custo_manual` (0 se nunca
 * informado); RETIRA nunca tem custo nem acréscimo, sempre R$ 0,00, ignorando qualquer
 * percentual/valor final enviado pelo cliente da API (nunca deixa transformar uma
 * retirada em cobrança por engano).
 */
export async function servicoFecharCotacao(dados: DadosFechamento, usuarioId: string): Promise<FechamentoFrete> {
  await garantirEsquemaFretes();

  const pool = obterPool();
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const { rows } = await cliente.query<{
      status: string;
      modalidade_execucao: ModalidadeExecucao;
      veiculo_id: string | null;
      motorista_nome: string | null;
      custo_manual: string | null;
    }>(`SELECT status, modalidade_execucao, veiculo_id, motorista_nome, custo_manual FROM ${nomeTabelaCotacoes()} WHERE id = $1 FOR UPDATE`, [
      dados.cotacaoId,
    ]);
    const cotacaoTravada = rows[0];
    if (cotacaoTravada === undefined) throw new ErroValidacao('Cotação não encontrada.');
    if (cotacaoTravada.status === 'FECHADA') throw new ErroValidacao('Esta cotação já foi fechada.');
    if (cotacaoTravada.status === 'CANCELADA') throw new ErroValidacao('Não é possível fechar uma cotação cancelada.');

    const modalidadeExecucao = cotacaoTravada.modalidade_execucao;
    let custoFrete: number;
    let propostaId: string | null = null;
    let transportadoraId: string | null = null;
    let veiculoId: string | null = null;
    let motoristaNome: string | null = null;

    if (modalidadeExecucao === 'TRANSPORTADORA') {
      const propostas = await listarPropostasPorCotacao(dados.cotacaoId);
      const propostaSelecionada = propostas.find((p) => p.selecionada);
      if (propostaSelecionada === undefined) throw new ErroValidacao('Selecione uma proposta antes de fechar a cotação.');
      custoFrete = propostaSelecionada.valorCusto;
      propostaId = propostaSelecionada.id;
      transportadoraId = propostaSelecionada.transportadoraId;
    } else if (modalidadeExecucao === 'VEICULO_PROPRIO') {
      if (cotacaoTravada.veiculo_id === null) throw new ErroValidacao('Vincule um veículo à cotação antes de fechar (edite a cotação).');
      // Revalida ATIVO no momento do fechamento, não só no momento em que foi vinculado à
      // cotação — cobre a janela em que o veículo é desativado depois de já vinculado
      // (achado da auditoria da Fase 2: antes só validava na criação/edição da cotação).
      await validarVeiculoAtivo(cotacaoTravada.veiculo_id);
      veiculoId = cotacaoTravada.veiculo_id;
      motoristaNome = cotacaoTravada.motorista_nome;
      const custoInformadoAgora = dados.custoManual;
      if (custoInformadoAgora !== undefined && custoInformadoAgora < 0) {
        throw new ErroValidacao('O custo interno não pode ser negativo.');
      }
      custoFrete = custoInformadoAgora ?? (cotacaoTravada.custo_manual === null ? 0 : Number(cotacaoTravada.custo_manual));
    } else {
      // RETIRA (seção 7/12): nunca tem transportadora, veículo, proposta ou custo — sempre R$ 0,00.
      custoFrete = 0;
    }

    let modoCalculo: ModoCalculoFechamento;
    let percentualAcrescimo: number;
    let valorFreteCliente: number;
    let valorAcrescimo: number;

    if (modalidadeExecucao === 'RETIRA') {
      // Ignora qualquer percentual/valor final enviado — retira nunca gera acréscimo (seção 12).
      modoCalculo = 'PERCENTUAL';
      percentualAcrescimo = 0;
      valorAcrescimo = 0;
      valorFreteCliente = 0;
    } else if (dados.percentualAcrescimo !== undefined) {
      if (dados.percentualAcrescimo < 0) throw new ErroValidacao('O percentual de acréscimo não pode ser negativo.');
      modoCalculo = 'PERCENTUAL';
      percentualAcrescimo = dados.percentualAcrescimo;
      valorFreteCliente = calcularFreteFinal(custoFrete, percentualAcrescimo);
      valorAcrescimo = calcularValorAcrescimo(custoFrete, percentualAcrescimo);
    } else if (dados.valorFreteClienteInformado !== undefined) {
      const valorFinal = dados.valorFreteClienteInformado;
      if (valorFinal < custoFrete) throw new ErroValidacao('O valor final para o cliente não pode ser menor que o custo do frete.');
      modoCalculo = 'VALOR_FINAL';
      valorFreteCliente = valorFinal;
      percentualAcrescimo = calcularPercentualAcrescimo(custoFrete, valorFinal) ?? 0;
      // O acréscimo em R$ é a diferença real informada (mais exato que reconstruir a partir
      // do percentual arredondado) — evita discrepância de centavos.
      valorAcrescimo = Math.round((valorFreteCliente - custoFrete) * 100) / 100;
    } else {
      throw new ErroValidacao('Informe o percentual de acréscimo ou o valor final para o cliente.');
    }

    const fechamento = await inserirFechamento(cliente, {
      cotacaoId: dados.cotacaoId,
      modalidadeExecucao,
      propostaId,
      transportadoraId,
      veiculoId,
      motoristaNome,
      custoFrete,
      percentualAcrescimo,
      valorAcrescimo,
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
  /** Seção 19: "Cotações por modalidade" — conta cotações (qualquer status), não só as fechadas. */
  cotacoesPorModalidadeExecucao: Record<ModalidadeExecucao, number>;
  resumoFechamentos: ResumoFechamentos;
  /** Seção 19: "Total de fretes com transportadora/veículo próprio/retira" — só sobre cotações já FECHADAS. */
  resumoFechamentosPorModalidadeExecucao: Record<ModalidadeExecucao, ResumoFechamentos>;
}

export async function servicoDashboard(): Promise<DashboardFretes> {
  const [cotacoes, resumo, resumoPorModalidade] = await Promise.all([
    listarCotacoes({}),
    resumirFechamentos(),
    resumirFechamentosPorModalidade(),
  ]);
  const cotacoesPorStatus: Record<string, number> = {
    RASCUNHO: 0,
    AGUARDANDO_PROPOSTAS: 0,
    EM_ANALISE: 0,
    AGUARDANDO_APROVACAO: 0,
    FECHADA: 0,
    CANCELADA: 0,
  };
  const cotacoesPorModalidadeExecucao: Record<ModalidadeExecucao, number> = {
    TRANSPORTADORA: 0,
    VEICULO_PROPRIO: 0,
    RETIRA: 0,
  };
  for (const cotacao of cotacoes) {
    cotacoesPorStatus[cotacao.status] = (cotacoesPorStatus[cotacao.status] ?? 0) + 1;
    cotacoesPorModalidadeExecucao[cotacao.modalidadeExecucao] += 1;
  }
  return { cotacoesPorStatus, cotacoesPorModalidadeExecucao, resumoFechamentos: resumo, resumoFechamentosPorModalidadeExecucao: resumoPorModalidade };
}
