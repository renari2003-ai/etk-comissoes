/**
 * Normalizador Omie → Fretes (Fase 3.2, seção 39) — único ponto do sistema que sabe ler os
 * campos logísticos/endereço da resposta bruta da Omie confirmados nas investigações
 * 3.1.1/3.1.2/3.1.3 (2026-09-16). Não altera `calculo/tipos.ts` (compartilhado com
 * Relatórios/Comissão/Margem): os campos extras existem na resposta real mas não estão
 * tipados em `PedidoOmie`, então são lidos aqui via interfaces locais + cast, sem qualquer
 * efeito sobre os demais consumidores desse tipo.
 */

import type { ClienteOmie } from '../omie/cliente.js';
import type { PedidoOmie } from '../calculo/tipos.js';
import { ErroValidacao } from '../validacao.js';
import { resolverDestinoFrete, type CandidatoEndereco } from './resolucaoDestino.js';
import type { EnderecoDestino } from './tipos.js';

/**
 * Campos confirmados na resposta bruta de `ConsultarPedido` (investigação 3.1.1) dentro do
 * bloco `frete`, mas ausentes de `FretePedidoOmie` (`calculo/tipos.ts`), que só tipa os
 * campos financeiros já usados por Comissão/Margem (`valor_frete`/`valor_seguro`/
 * `outras_despesas` — nunca lidos/alterados aqui).
 */
interface FretePedidoOmieBruto {
  codigo_transportadora?: number;
  especie_volumes?: string;
  modalidade?: string;
  peso_bruto?: number;
  peso_liquido?: number;
  quantidade_volumes?: number;
}

/** Bloco `informacoes_adicionais.outros_detalhes` — endereço específico do pedido (investigação 3.1.3). Sem campo de complemento (ausente em todas as respostas observadas). */
interface OutrosDetalhesPedidoOmie {
  cCEPOd?: string;
  cEnderecoOd?: string;
  cNumeroOd?: string;
  cBairroOd?: string;
  cCidadeOd?: string;
  cEstadoOd?: string;
}

interface InformacoesAdicionaisBruto {
  codVend?: number;
  outros_detalhes?: OutrosDetalhesPedidoOmie;
}

export interface DadosLogisticosOmie {
  pesoBruto: number | null;
  pesoLiquido: number | null;
  quantidadeVolumes: number | null;
  especieVolumes: string | null;
  /** CIF/FOB da Omie — contexto informativo (seção 22), nunca usado para decidir `modalidadeExecucao`. */
  cifFobOmie: string | null;
  /** Código da transportadora vinculada ao pedido na Omie — só referência/contexto (seção 23), nunca associado automaticamente a uma `transportadora` interna. */
  transportadoraOmieCodigo: number | null;
}

function textoOuNull(valor: string | undefined): string | null {
  const texto = (valor ?? '').trim();
  return texto === '' ? null : texto;
}

export function extrairDadosLogisticos(pedido: PedidoOmie): DadosLogisticosOmie {
  const frete = (pedido.frete ?? {}) as FretePedidoOmieBruto;
  return {
    pesoBruto: frete.peso_bruto ?? null,
    pesoLiquido: frete.peso_liquido ?? null,
    quantidadeVolumes: frete.quantidade_volumes ?? null,
    especieVolumes: textoOuNull(frete.especie_volumes),
    cifFobOmie: textoOuNull(frete.modalidade),
    transportadoraOmieCodigo: frete.codigo_transportadora ?? null,
  };
}

/** Endereço específico do pedido (`outros_detalhes`) — maior prioridade na resolução do destino (seção 10). */
export function extrairEnderecoPedido(pedido: PedidoOmie): CandidatoEndereco | null {
  const informacoes = pedido.informacoes_adicionais as InformacoesAdicionaisBruto | undefined;
  const od = informacoes?.outros_detalhes;
  if (od === undefined) return null;
  return {
    cep: textoOuNull(od.cCEPOd),
    logradouro: textoOuNull(od.cEnderecoOd),
    numero: textoOuNull(od.cNumeroOd),
    complemento: null,
    bairro: textoOuNull(od.cBairroOd),
    cidade: textoOuNull(od.cCidadeOd),
    uf: textoOuNull(od.cEstadoOd),
    codigoMunicipio: null,
  };
}

export function extrairCodigoVendedor(pedido: PedidoOmie): number | null {
  const informacoes = pedido.informacoes_adicionais as InformacoesAdicionaisBruto | undefined;
  return typeof informacoes?.codVend === 'number' ? informacoes.codVend : null;
}

export interface ItemPreparacao {
  codigo: string;
  descricao: string;
  quantidade: number;
}

export interface PreparacaoCotacaoOmie {
  pedidoOmieId: number;
  pedidoOmieNumero: string;
  clienteOmieId: number | null;
  clienteNome: string | null;
  vendedorOmieId: number | null;
  destino: EnderecoDestino | null;
  logistica: DadosLogisticosOmie;
  itens: ItemPreparacao[];
  valorTotalPedido: number;
}

/**
 * Consulta a Omie (`ConsultarPedido` + `ConsultarCliente`, quando o pedido tiver cliente) e
 * monta o objeto de PREPARAÇÃO — nunca persiste nada (seção 38: preparar ≠ confirmar).
 * Reaproveita 100% a infraestrutura existente (`ClienteOmie`: mesmo cliente HTTP, cache,
 * limitador, tratamento de erro) — nenhuma chamada Omie nova é criada fora dela.
 */
export async function prepararCotacaoDeOmie(cliente: ClienteOmie, numeroPedido: string): Promise<PreparacaoCotacaoOmie> {
  const numero = numeroPedido.trim();
  if (numero === '') throw new ErroValidacao('Informe o número do pedido Omie.');

  const pedido = await cliente.consultarPedido({ numeroPedido: numero });

  const codigoCliente = pedido.cabecalho.codigo_cliente || null;
  const registroCliente = codigoCliente !== null ? await cliente.consultarCliente(codigoCliente) : null;

  const enderecoEntrega = registroCliente?.enderecoEntrega;
  const clienteEntrega: CandidatoEndereco | null =
    enderecoEntrega === null || enderecoEntrega === undefined ? null : { ...enderecoEntrega, complemento: null, codigoMunicipio: null };
  const enderecoCadastral = registroCliente?.enderecoCadastral;
  const clienteCadastral: CandidatoEndereco | null = enderecoCadastral === undefined ? null : { ...enderecoCadastral };

  const destino = resolverDestinoFrete({
    pedido: extrairEnderecoPedido(pedido),
    clienteEntrega,
    clienteCadastral,
  });

  const itens: ItemPreparacao[] = (pedido.det ?? []).map((item) => ({
    codigo: item.produto.codigo,
    descricao: item.produto.descricao,
    quantidade: item.produto.quantidade,
  }));

  return {
    pedidoOmieId: pedido.cabecalho.codigo_pedido,
    pedidoOmieNumero: pedido.cabecalho.numero_pedido,
    clienteOmieId: codigoCliente,
    clienteNome: registroCliente !== null ? textoOuNull(registroCliente.razaoSocial) ?? textoOuNull(registroCliente.nomeFantasia) : null,
    vendedorOmieId: extrairCodigoVendedor(pedido),
    destino,
    logistica: extrairDadosLogisticos(pedido),
    itens,
    valorTotalPedido: pedido.total_pedido?.valor_total_pedido ?? 0,
  };
}

/** Resumo de texto livre compatível com o campo `destino` já existente desde a Fase 1 (exibição simples). */
export function formatarDestinoTexto(destino: EnderecoDestino): string | null {
  const partes = [
    destino.logradouro,
    destino.numero !== null ? `nº ${destino.numero}` : null,
    destino.bairro,
    destino.cidade !== null && destino.uf !== null ? `${destino.cidade}/${destino.uf}` : destino.cidade ?? destino.uf,
  ].filter((parte): parte is string => parte !== null && parte.trim() !== '');
  return partes.length > 0 ? partes.join(', ') : null;
}
