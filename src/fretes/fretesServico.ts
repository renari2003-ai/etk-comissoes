/**
 * Camada de serviço do módulo de Fretes (seção 17: rotas → serviço → banco, nunca lógica
 * de negócio direto nas rotas). Orquestra os repositórios e aplica as regras que não são
 * puramente de cálculo (essas ficam em `calculo.ts`): transições de status, seleção de
 * proposta, fechamento transacional e auditoria.
 */

import type { ClienteOmie } from '../omie/cliente.js';
import type { TipoDocumento } from '../omie/classificacaoDocumento.js';
import type { UsuarioPublico } from '../auth/tipos.js';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { registrarAuditoria } from './auditoriaRepositorio.js';
import { calcularFreteFinal, calcularPercentualAcrescimo, calcularValorAcrescimo } from './calculo.js';
import {
  atualizarCotacao,
  buscarCotacaoPorId,
  buscarCotacoesRelacionadasAoPedidoOmie,
  criarCotacao,
  definirStatusCotacao,
  listarCotacoes,
  type DadosAtualizacaoCotacao,
  type DadosNovaCotacao,
  type FiltrosCotacao,
} from './cotacoesRepositorio.js';
import { formatarDestinoTexto, prepararCotacaoDeOmie, type PreparacaoCotacaoOmie } from './omieFretes.js';
import type { DestinoManualInformado } from './validacao.js';
import { buscarFechamentoPorCotacao, inserirFechamento, resumirFechamentos, resumirFechamentosPorModalidade, type ResumoFechamentos } from './fechamentosRepositorio.js';
import {
  atualizarStatusProposta,
  atualizarStatusRevisaoProposta,
  criarProposta,
  listarPropostasPorCotacao,
  listarPropostasPorStatusRevisao,
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
import type { CotacaoFrete, EnderecoDestino, FechamentoFrete, Modalidade, ModalidadeExecucao, ModoCalculoFechamento, PropostaFrete, Transportadora, Veiculo } from './tipos.js';

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

// --- Importação de pedido Omie (Fase 3.2) --------------------------------

export interface PreparacaoCotacaoComAviso extends PreparacaoCotacaoOmie {
  /** Seção 25 — só aviso informativo, nunca bloqueia nem sobrescreve. */
  cotacoesExistentes: CotacaoFrete[];
}

/**
 * PREPARAR (seção 38): consulta a Omie e monta a preview da cotação — nunca persiste nada.
 * A Omie permanece somente leitura; nenhuma escrita acontece aqui nem em `prepararCotacaoDeOmie`.
 */
export async function servicoPrepararCotacaoDeOmie(
  cliente: ClienteOmie,
  numeroDocumento: string,
  tipoDocumento: TipoDocumento,
): Promise<PreparacaoCotacaoComAviso> {
  const preparacao = await prepararCotacaoDeOmie(cliente, numeroDocumento, tipoDocumento);
  // Detecção de duplicidade (Fase 3.6, inalterada) — chave por identificador Omie, a mesma
  // para Pedido e Orçamento (é o mesmo documento na Omie). O aviso continua só informativo.
  const cotacoesExistentes = await buscarCotacoesRelacionadasAoPedidoOmie(preparacao.pedidoOmieId, preparacao.pedidoOmieNumero);
  return { ...preparacao, cotacoesExistentes };
}

export interface DadosComplementaresCotacaoOmie {
  modalidade: Modalidade;
  modalidadeExecucao: ModalidadeExecucao;
  veiculoId: string | null;
  motoristaNome: string | null;
  custoManual: number | null;
  valorMercadoria: number | null;
  observacoes: string | null;
}

/**
 * CONFIRMAR (seção 38): re-resolve a Omie (fresh, via cache/limitador já existentes — nunca
 * confia num destino "resolvido" enviado pelo cliente HTTP, só no `destinoOverride`
 * explícito) e só então persiste. Isso mantém o backend como única fonte de verdade da
 * regra de prioridade (seção 39/40), mesmo que o frontend mostre uma preview antes.
 */
export async function servicoCriarCotacaoDeOmie(
  cliente: ClienteOmie,
  numeroDocumento: string,
  tipoDocumento: TipoDocumento,
  destinoOverride: DestinoManualInformado | null,
  dadosComplementares: DadosComplementaresCotacaoOmie,
  usuarioId: string,
): Promise<CotacaoFrete> {
  const preparacao = await prepararCotacaoDeOmie(cliente, numeroDocumento, tipoDocumento);

  let destinoFinal: EnderecoDestino;
  if (destinoOverride !== null) {
    destinoFinal = { origem: 'MANUAL', codigoMunicipio: null, ...destinoOverride };
  } else if (preparacao.destino !== null) {
    destinoFinal = preparacao.destino;
  } else {
    throw new ErroValidacao(
      'Não foi possível determinar um destino automaticamente a partir da Omie. Informe o destino manualmente ("destinoOverride") antes de confirmar.',
    );
  }

  const dados: DadosNovaCotacao = {
    clienteOmieId: preparacao.clienteOmieId,
    pedidoOmieId: preparacao.pedidoOmieId,
    pedidoOmieNumero: preparacao.pedidoOmieNumero,
    documentoOmieTipo: preparacao.documentoOmieTipo,
    vendedorOmieId: preparacao.vendedorOmieId,
    clienteNomeSnapshot: preparacao.clienteNome,
    origem: null,
    cepOrigem: null,
    destino: formatarDestinoTexto(destinoFinal),
    cepDestino: destinoFinal.cep,
    origemDestino: destinoFinal.origem,
    logradouroDestino: destinoFinal.logradouro,
    numeroDestino: destinoFinal.numero,
    complementoDestino: destinoFinal.complemento,
    bairroDestino: destinoFinal.bairro,
    cidadeDestino: destinoFinal.cidade,
    ufDestino: destinoFinal.uf,
    codigoMunicipioDestino: destinoFinal.codigoMunicipio,
    peso: preparacao.logistica.pesoBruto,
    pesoBruto: preparacao.logistica.pesoBruto,
    pesoLiquido: preparacao.logistica.pesoLiquido,
    volumes: preparacao.logistica.quantidadeVolumes,
    especieVolumes: preparacao.logistica.especieVolumes,
    cifFobOmie: preparacao.logistica.cifFobOmie,
    transportadoraOmieCodigo: preparacao.logistica.transportadoraOmieCodigo,
    valorMercadoria: dadosComplementares.valorMercadoria ?? (preparacao.valorTotalPedido || null),
    modalidade: dadosComplementares.modalidade,
    modalidadeExecucao: dadosComplementares.modalidadeExecucao,
    veiculoId: dadosComplementares.veiculoId,
    motoristaNome: dadosComplementares.motoristaNome,
    custoManual: dadosComplementares.custoManual,
    observacoes: dadosComplementares.observacoes,
  };

  await validarCamposPorModalidadeExecucao(dados.modalidadeExecucao, dados.veiculoId);
  const cotacao = await criarCotacao(dados, usuarioId);
  await registrarAuditoria({
    usuarioId,
    acao: 'COTACAO_CRIADA_DE_OMIE',
    entidade: 'cotacao_frete',
    entidadeId: cotacao.id,
    valorNovo: cotacao,
  });
  await registrarAuditoria({
    usuarioId,
    acao: destinoFinal.origem === 'MANUAL' ? 'DESTINO_ALTERADO_MANUALMENTE' : 'DESTINO_IMPORTADO_OMIE',
    entidade: 'cotacao_frete',
    entidadeId: cotacao.id,
    valorNovo: { origemDestino: destinoFinal.origem },
  });
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
  // Fase 4A.1, seção 7/38: uma proposta recebida automaticamente NUNCA pode ser selecionada
  // antes de um humano validar os dados extraídos — nem com alta confiança da IA. Busca
  // direta (não via `servicoListarPropostas`) porque só precisamos checar esta proposta.
  const propostaAtual = await listarPropostasPorCotacao(cotacaoId);
  const alvo = propostaAtual.find((p) => p.id === propostaId);
  if (alvo?.status === 'PENDENTE_VALIDACAO') {
    throw new ErroValidacao('Esta proposta ainda não foi validada. Revise os dados extraídos antes de selecioná-la.');
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

// --- Fase 4A.6 — Central da Logística + Central do Vendedor ---------------
//
// Regras (relatório da fase): Logística faz a triagem (libera/descarta) e SÓ propostas
// liberadas ficam visíveis ao vendedor; o vendedor vê/age só nas próprias cotações
// (`cotacao.vendedorOmieId === usuario.vendedorOmieId`), salvo visão ampliada (administrador
// ou permissão `fretesGerencia`) ou aprovação EXPLÍCITA em substituição (`fretesSubstituicao`,
// sempre com motivo). Nunca há seleção/aprovação automática — toda transição exige uma ação
// humana com a permissão certa. Deliberadamente NÃO reescreve `servicoSelecionarProposta`
// (Fase 1, inalterada, ainda usada por quem tem só `fretes`): `servicoEscolherFreteVencedor`
// abaixo é a nova porta de entrada da Central do Vendedor — valida logística/dono/substituição
// e SÓ DEPOIS delega a `servicoSelecionarProposta` a mesma transição já existente.

export interface LinhaCentralFrete {
  cotacao: CotacaoFrete;
  proposta: PropostaFrete;
  transportadora: Transportadora;
}

async function montarLinhasCentral(propostas: PropostaFrete[]): Promise<LinhaCentralFrete[]> {
  const [cotacoes, transportadoras] = await Promise.all([listarCotacoes({}), listarTransportadoras(false)]);
  const cotacoesPorId = new Map(cotacoes.map((c) => [c.id, c]));
  const transportadorasPorId = new Map(transportadoras.map((t) => [t.id, t]));
  return propostas
    .map((proposta) => {
      const cotacao = cotacoesPorId.get(proposta.cotacaoId);
      const transportadora = transportadorasPorId.get(proposta.transportadoraId);
      if (cotacao === undefined || transportadora === undefined) return null;
      return { cotacao, proposta, transportadora };
    })
    .filter((linha): linha is LinhaCentralFrete => linha !== null);
}

/** Central da Logística (seção "Mostrar"): propostas ainda na triagem + já triadas recentemente, para contexto. Nunca escolhe a vencedora sozinha. */
export async function servicoListarCentralLogistica(): Promise<LinhaCentralFrete[]> {
  const propostas = await listarPropostasPorStatusRevisao(['AGUARDANDO_LOGISTICA', 'LIBERADA', 'DESCARTADA']);
  return montarLinhasCentral(propostas);
}

/** true quando `usuario` é o vendedor "dono" da cotação (mesmo `vendedorOmieId`) — nunca true se a cotação não tiver vendedor definido. */
function ehVendedorResponsavel(usuario: UsuarioPublico, cotacao: CotacaoFrete): boolean {
  return cotacao.vendedorOmieId !== null && usuario.vendedorOmieId !== null && usuario.vendedorOmieId === cotacao.vendedorOmieId;
}

/** Administrador ou permissão `fretesGerencia` — visão ampliada (seção 5 do relatório: "Gerente/Admin pode ter visão ampliada"). */
function temVisaoAmpliadaFrete(usuario: UsuarioPublico): boolean {
  return usuario.papel === 'administrador' || usuario.permissoes.fretesGerencia;
}

/** Central do Vendedor (seção "Mostrar somente propostas liberadas para aquele vendedor"): só LIBERADA/EM_NEGOCIACAO/ESCOLHIDA, filtradas pelo vendedor dono — exceto visão ampliada. */
export async function servicoListarCentralVendedor(usuario: UsuarioPublico): Promise<LinhaCentralFrete[]> {
  const propostas = await listarPropostasPorStatusRevisao(['LIBERADA', 'EM_NEGOCIACAO', 'ESCOLHIDA']);
  const linhas = await montarLinhasCentral(propostas);
  if (temVisaoAmpliadaFrete(usuario)) return linhas;
  return linhas.filter((linha) => ehVendedorResponsavel(usuario, linha.cotacao));
}

function exigirPermissaoLogistica(usuario: UsuarioPublico): void {
  if (usuario.papel !== 'administrador' && !usuario.permissoes.fretesLogistica) {
    throw new ErroValidacao('Você não tem permissão para triar propostas na Central da Logística (permissão "fretesLogistica" necessária).');
  }
}

/** Logística libera a proposta — só a partir daí ela aparece na Central do Vendedor (seção "Permitir: liberar proposta ao vendedor"). Nunca escolhe a vencedora. */
export async function servicoLiberarPropostaLogistica(propostaId: string, usuario: UsuarioPublico): Promise<PropostaFrete> {
  exigirPermissaoLogistica(usuario);
  const proposta = await atualizarStatusRevisaoProposta(propostaId, 'LIBERADA');
  await registrarAuditoria({ usuarioId: usuario.id, acao: 'PROPOSTA_LIBERADA_LOGISTICA', entidade: 'proposta_frete', entidadeId: proposta.id, valorNovo: proposta });
  return proposta;
}

/** Logística descarta na triagem (diferente de `servicoRejeitarProposta`, que é a rejeição comercial já existente — ver comentário de `StatusRevisaoProposta`). */
export async function servicoDescartarPropostaLogistica(propostaId: string, usuario: UsuarioPublico): Promise<PropostaFrete> {
  exigirPermissaoLogistica(usuario);
  const proposta = await atualizarStatusRevisaoProposta(propostaId, 'DESCARTADA');
  await registrarAuditoria({ usuarioId: usuario.id, acao: 'PROPOSTA_DESCARTADA_LOGISTICA', entidade: 'proposta_frete', entidadeId: proposta.id, valorNovo: proposta });
  return proposta;
}

/**
 * Verifica se `usuario` pode agir comercialmente (negociar/escolher) sobre `cotacao` — dono
 * (`fretesComercial` + mesmo vendedor), visão ampliada (admin/`fretesGerencia`), ou
 * substituição explícita (`fretesSubstituicao`). Nunca deixa passar silenciosamente: quem não
 * se encaixa em nenhum dos três recebe um erro explicando o motivo (seção "Segurança": vendedor
 * não pode ver/agir em fretes de outros vendedores).
 */
function exigirAcessoComercial(usuario: UsuarioPublico, cotacao: CotacaoFrete): { substituicao: boolean } {
  if (usuario.papel !== 'administrador' && !usuario.permissoes.fretesComercial) {
    throw new ErroValidacao('Você não tem permissão para negociar/escolher fretes (permissão "fretesComercial" necessária).');
  }
  if (ehVendedorResponsavel(usuario, cotacao) || temVisaoAmpliadaFrete(usuario)) {
    return { substituicao: false };
  }
  if (usuario.permissoes.fretesSubstituicao) {
    return { substituicao: true };
  }
  throw new ErroValidacao('Este frete pertence a outro vendedor — você não tem permissão para agir em substituição (permissão "fretesSubstituicao" necessária).');
}

/** Vendedor marca a proposta liberada como "em negociação" com o cliente (seção "Permitir: marcar em negociação"). */
export async function servicoMarcarPropostaEmNegociacao(cotacaoId: string, propostaId: string, usuario: UsuarioPublico): Promise<PropostaFrete> {
  const cotacao = await servicoBuscarCotacao(cotacaoId);
  exigirAcessoComercial(usuario, cotacao);
  const propostas = await listarPropostasPorCotacao(cotacaoId);
  const alvo = propostas.find((p) => p.id === propostaId);
  if (alvo === undefined) throw new ErroValidacao('Proposta não encontrada nesta cotação.');
  if (alvo.statusRevisao !== 'LIBERADA') {
    throw new ErroValidacao('Só é possível negociar uma proposta já liberada pela Logística.');
  }
  const proposta = await atualizarStatusRevisaoProposta(propostaId, 'EM_NEGOCIACAO');
  await registrarAuditoria({ usuarioId: usuario.id, acao: 'PROPOSTA_EM_NEGOCIACAO', entidade: 'proposta_frete', entidadeId: proposta.id, valorNovo: proposta });
  return proposta;
}

export interface SubstituicaoEscolhaFrete {
  /** Obrigatório sempre que quem escolhe não é o vendedor dono da cotação (seção "Substituição": "registrar... motivo"). */
  motivo: string;
}

/**
 * Vendedor (ou substituto autorizado) escolhe o frete vencedor — a nova porta de entrada da
 * Central do Vendedor (seção "Permitir: escolher frete vencedor"). Exige que a proposta já
 * tenha sido liberada pela Logística (`LIBERADA`/`EM_NEGOCIACAO`); delega a transição em si a
 * `servicoSelecionarProposta` (Fase 1, inalterada) e só then marca `statusRevisao='ESCOLHIDA'`.
 * Em substituição, registra uma auditoria ADICIONAL (nunca substitui a de
 * `servicoSelecionarProposta`) com vendedor responsável/usuário que aprovou/permissão usada/
 * motivo/data — histórico nunca apagado (seção "Auditoria").
 */
export async function servicoEscolherFreteVencedor(
  cotacaoId: string,
  propostaId: string,
  usuario: UsuarioPublico,
  substituicaoInformada?: SubstituicaoEscolhaFrete,
): Promise<PropostaFrete> {
  const cotacao = await servicoBuscarCotacao(cotacaoId);
  const { substituicao } = exigirAcessoComercial(usuario, cotacao);

  const motivo = substituicaoInformada?.motivo?.trim() ?? '';
  if (substituicao && motivo === '') {
    throw new ErroValidacao('Aprovação em substituição exige um motivo.');
  }

  const propostasAtuais = await listarPropostasPorCotacao(cotacaoId);
  const alvo = propostasAtuais.find((p) => p.id === propostaId);
  if (alvo === undefined) throw new ErroValidacao('Proposta não encontrada nesta cotação.');
  if (alvo.statusRevisao !== 'LIBERADA' && alvo.statusRevisao !== 'EM_NEGOCIACAO') {
    throw new ErroValidacao('Esta proposta ainda não foi liberada pela Logística — não pode ser escolhida.');
  }

  const proposta = await servicoSelecionarProposta(cotacaoId, propostaId, usuario.id);
  const propostaFinal = await atualizarStatusRevisaoProposta(proposta.id, 'ESCOLHIDA');

  if (substituicao) {
    await registrarAuditoria({
      usuarioId: usuario.id,
      acao: 'PROPOSTA_SELECIONADA',
      entidade: 'proposta_frete',
      entidadeId: propostaFinal.id,
      valorNovo: {
        substituicao: true,
        vendedorResponsavelOmieId: cotacao.vendedorOmieId,
        usuarioResponsavelId: usuario.id,
        papel: usuario.papel,
        permissaoUsada: 'fretesSubstituicao',
        motivo,
      },
    });
  }
  return propostaFinal;
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
