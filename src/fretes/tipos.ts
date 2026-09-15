/** Tipos compartilhados do módulo de Fretes (Fase 1 — cotação → proposta → fechamento). */

export type StatusCotacao =
  | 'RASCUNHO'
  | 'AGUARDANDO_PROPOSTAS'
  | 'EM_ANALISE'
  | 'AGUARDANDO_APROVACAO'
  | 'FECHADA'
  | 'CANCELADA';

export type StatusProposta = 'RECEBIDA' | 'EM_ANALISE' | 'SELECIONADA' | 'REJEITADA';

/** Estrutura pensada para admitir outras modalidades no futuro sem reescrever o módulo (seção 6). */
export type Modalidade = 'CIF' | 'FOB';

export type ModoCalculoFechamento = 'PERCENTUAL' | 'VALOR_FINAL';

export interface Transportadora {
  id: string;
  nomeRazaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  contato: string | null;
  ativo: boolean;
  observacoes: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * `clienteOmieId`/`pedidoOmieId`/`vendedorOmieId` são apenas REFERÊNCIAS ao código do
 * cadastro na Omie (seção 22/30 do requisito) — o módulo nunca guarda uma cópia local
 * desses cadastros nem altera o pedido de origem na Omie.
 */
export interface CotacaoFrete {
  id: string;
  codigo: string;
  clienteOmieId: number | null;
  pedidoOmieId: number | null;
  vendedorOmieId: number | null;
  origem: string | null;
  cepOrigem: string | null;
  destino: string | null;
  cepDestino: string | null;
  peso: number | null;
  volumes: number | null;
  valorMercadoria: number | null;
  modalidade: Modalidade;
  status: StatusCotacao;
  observacoes: string | null;
  criadoPor: string;
  criadoEm: string;
  atualizadoEm: string;
  fechadoEm: string | null;
}

/**
 * `valorCusto` é sempre o valor cobrado pela TRANSPORTADORA — nunca o valor repassado
 * ao cliente (esse só existe em `FechamentoFrete.valorFreteCliente`, seção 7).
 * `origemProposta`/`mensagemOriginal`/`anexoUrl`/`confianca`/`requerRevisao` existem
 * desde já para não exigir uma migração de schema quando uma fase futura acrescentar
 * ingestão automática (e-mail/WhatsApp/IA) — nesta fase toda proposta é
 * `origemProposta: 'MANUAL'`, `confianca: null`, `requerRevisao: false`.
 */
export interface PropostaFrete {
  id: string;
  cotacaoId: string;
  transportadoraId: string;
  valorCusto: number;
  prazoDias: number | null;
  validade: string | null;
  peso: number | null;
  volumes: number | null;
  origem: string | null;
  destino: string | null;
  tipoServico: string | null;
  observacoes: string | null;
  origemProposta: string;
  mensagemOriginal: string | null;
  anexoUrl: string | null;
  status: StatusProposta;
  confianca: number | null;
  requerRevisao: boolean;
  selecionada: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

/** Representa a decisão final — uma cotação tem no máximo um fechamento (constraint UNIQUE, seção 35/36). */
export interface FechamentoFrete {
  id: string;
  cotacaoId: string;
  propostaId: string;
  transportadoraId: string;
  custoFrete: number;
  percentualAcrescimo: number;
  valorAcrescimo: number;
  valorFreteCliente: number;
  modoCalculo: ModoCalculoFechamento;
  usuarioFechamento: string;
  observacoes: string | null;
  criadoEm: string;
}

export type AcaoAuditoriaFrete =
  | 'COTACAO_CRIADA'
  | 'COTACAO_EDITADA'
  | 'COTACAO_CANCELADA'
  | 'PROPOSTA_CRIADA'
  | 'PROPOSTA_EDITADA'
  | 'PROPOSTA_SELECIONADA'
  | 'PROPOSTA_REJEITADA'
  | 'COTACAO_FECHADA'
  | 'TRANSPORTADORA_CRIADA'
  | 'TRANSPORTADORA_EDITADA';

export interface RegistroAuditoriaFrete {
  id: string;
  usuarioId: string;
  acao: AcaoAuditoriaFrete;
  entidade: string;
  entidadeId: string | null;
  valorAnterior: unknown;
  valorNovo: unknown;
  criadoEm: string;
  origem: string;
}
