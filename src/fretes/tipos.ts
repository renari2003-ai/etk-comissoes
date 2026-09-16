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

/**
 * QUEM EXECUTA o frete (Fase 2) — conceito DIFERENTE de `Modalidade` (CIF/FOB) acima, que
 * é a responsabilidade fiscal/comercial pelo transporte e continua existindo sem nenhuma
 * alteração. `ModalidadeExecucao` responde "como a entrega acontece": por transportadora
 * terceirizada (fluxo da Fase 1, inalterado), por veículo próprio da ETK, ou retirada pelo
 * próprio cliente. Default `TRANSPORTADORA` em cotações antigas — preserva o comportamento
 * da Fase 1 sem exigir migração de dados.
 */
export type ModalidadeExecucao = 'TRANSPORTADORA' | 'VEICULO_PROPRIO' | 'RETIRA';

export type ModoCalculoFechamento = 'PERCENTUAL' | 'VALOR_FINAL';

/**
 * De onde veio o destino usado numa cotação importada da Omie (Fase 3.2, seção 12) — nunca
 * strings soltas espalhadas pelo código. Ordem de prioridade quando resolvido
 * automaticamente: PEDIDO > CLIENTE_ENTREGA > CLIENTE_CADASTRAL (ver `resolucaoDestino.ts`).
 * `MANUAL` é usado tanto para cotações sem nenhuma origem Omie (fluxo já existente da Fase
 * 1) quanto quando o usuário substitui explicitamente o destino resolvido automaticamente.
 */
export type OrigemEndereco = 'PEDIDO' | 'CLIENTE_ENTREGA' | 'CLIENTE_CADASTRAL' | 'MANUAL';

/**
 * Snapshot do destino efetivamente utilizado numa cotação — independente do cadastro atual
 * na Omie (seção 14): se o cliente for alterado na Omie amanhã, esta cotação continua
 * registrando o endereço usado no momento em que foi criada. `complemento`/`codigoMunicipio`
 * são sempre opcionais — nenhuma das fontes Omie confirmadas (investigação 3.1.3) garante
 * complemento, e `codigoMunicipio` só existe no endereço cadastral do cliente.
 */
export interface EnderecoDestino {
  origem: OrigemEndereco;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigoMunicipio: string | null;
}

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
 * Cadastro simples de veículo próprio da ETK (Fase 2, seção 4) — nenhum campo é
 * obrigatório além de `descricao`, para não travar o cadastro por falta de dado
 * secundário (placa/capacidade podem ser completados depois).
 */
export interface Veiculo {
  id: string;
  descricao: string;
  placa: string | null;
  tipo: string | null;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  capacidadeKg: number | null;
  capacidadeM3: number | null;
  ativo: boolean;
  observacoes: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * `clienteOmieId`/`pedidoOmieId`/`vendedorOmieId` são apenas REFERÊNCIAS ao código do
 * cadastro na Omie (seção 22/30 do requisito) — o módulo nunca guarda uma cópia local
 * desses cadastros nem altera o pedido de origem na Omie.
 *
 * `veiculoId`/`motoristaNome`/`custoManual` só fazem sentido quando
 * `modalidadeExecucao === 'VEICULO_PROPRIO'` — permanecem `null` nas demais modalidades
 * (nunca exigidos na validação de TRANSPORTADORA/RETIRA, seção 9). `motoristaNome` é um
 * campo de texto simples (seção 5): o projeto não tem cadastro de funcionários/RH hoje,
 * então não foi criado um cadastro paralelo — só o vínculo com `usuarios` (login) já
 * existente, que não é o mesmo conceito (nem todo motorista tem login no sistema).
 */
/**
 * Campos `*Destino`, `pesoBruto`/`pesoLiquido`/`especieVolumes`/`cifFobOmie`/
 * `transportadoraOmieCodigo`/`pedidoOmieNumero`/`clienteNomeSnapshot` são exclusivos do
 * fluxo de importação da Omie (Fase 3.2) — sempre `null` em cotações criadas manualmente
 * (fluxo da Fase 1, inalterado). `destino`/`cepDestino` (texto livre, já existentes desde a
 * Fase 1) continuam sendo preenchidos também nas cotações importadas, como um resumo
 * compatível com a exibição já existente — os campos `*Destino` estruturados são a fonte
 * detalhada/auditável. `cifFobOmie` é só CONTEXTO da Omie — nunca substitui automaticamente
 * `modalidadeExecucao` (são conceitos diferentes, ver comentário de `ModalidadeExecucao`).
 * `transportadoraOmieCodigo` é só referência/contexto — nunca associado automaticamente a um
 * registro de `transportadoras` (evita matching frágil por nome, seção 23).
 */
export interface CotacaoFrete {
  id: string;
  codigo: string;
  clienteOmieId: number | null;
  pedidoOmieId: number | null;
  /** Número de exibição do pedido (`numero_pedido`), distinto do id estável `pedidoOmieId` (`codigo_pedido`) — só preenchido em cotações importadas da Omie. */
  pedidoOmieNumero: string | null;
  vendedorOmieId: number | null;
  /** Snapshot do nome do cliente no momento da importação — nunca recarregado do cadastro atual da Omie. */
  clienteNomeSnapshot: string | null;
  origem: string | null;
  cepOrigem: string | null;
  destino: string | null;
  cepDestino: string | null;
  origemDestino: OrigemEndereco | null;
  logradouroDestino: string | null;
  numeroDestino: string | null;
  complementoDestino: string | null;
  bairroDestino: string | null;
  cidadeDestino: string | null;
  ufDestino: string | null;
  codigoMunicipioDestino: string | null;
  peso: number | null;
  /** Peso bruto/líquido confirmados em `frete.peso_bruto`/`frete.peso_liquido` de `ConsultarPedido` (investigação 3.1.1) — preservados exatamente como a Omie devolveu, nunca recalculados. */
  pesoBruto: number | null;
  pesoLiquido: number | null;
  volumes: number | null;
  especieVolumes: string | null;
  /** CIF/FOB da Omie (`frete.modalidade`) — contexto informativo, nunca confundir com `modalidade` (CIF/FOB comercial deste módulo) nem com `modalidadeExecucao`. */
  cifFobOmie: string | null;
  transportadoraOmieCodigo: number | null;
  valorMercadoria: number | null;
  modalidade: Modalidade;
  modalidadeExecucao: ModalidadeExecucao;
  veiculoId: string | null;
  motoristaNome: string | null;
  /** Custo manual (seção 6) — só usado para VEICULO_PROPRIO; nunca calculado automaticamente (sem km/combustível/manutenção/depreciação). Ignorado na modalidade RETIRA (custo sempre R$ 0,00). */
  custoManual: number | null;
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

/**
 * Representa a decisão final — uma cotação tem no máximo um fechamento (constraint
 * UNIQUE, seção 35/36). `propostaId`/`transportadoraId` só são preenchidos quando
 * `modalidadeExecucao === 'TRANSPORTADORA'`; `veiculoId`/`motoristaNome` só quando
 * `VEICULO_PROPRIO`. Nunca os dois grupos preenchidos ao mesmo tempo.
 */
export interface FechamentoFrete {
  id: string;
  cotacaoId: string;
  modalidadeExecucao: ModalidadeExecucao;
  propostaId: string | null;
  transportadoraId: string | null;
  veiculoId: string | null;
  motoristaNome: string | null;
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
  | 'TRANSPORTADORA_EDITADA'
  | 'VEICULO_CRIADO'
  | 'VEICULO_EDITADO'
  | 'VEICULO_ATIVADO'
  | 'VEICULO_DESATIVADO'
  | 'MODALIDADE_ALTERADA'
  | 'COTACAO_CRIADA_DE_OMIE'
  | 'DESTINO_IMPORTADO_OMIE'
  | 'DESTINO_ALTERADO_MANUALMENTE';

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
