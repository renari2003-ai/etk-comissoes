import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { garantirEsquemaFretes, nomeSequenciaCodigoCotacao, nomeTabelaCotacoes } from './schema.js';
import type { CotacaoFrete, Modalidade, ModalidadeExecucao, OrigemEndereco, StatusCotacao } from './tipos.js';

interface LinhaCotacao {
  id: string;
  codigo: string;
  // BIGINT — o driver `pg` sempre devolve como string (evita perda de precisão), nunca `number`
  // direto. Achado real ao escrever os testes da Fase 3.2 (o valor nunca tinha sido comparado
  // numericamente num teste de integração antes — cotações manuais sempre usam `null` aqui).
  cliente_omie_id: string | null;
  pedido_omie_id: string | null;
  pedido_omie_numero: string | null;
  vendedor_omie_id: string | null;
  cliente_nome_snapshot: string | null;
  origem: string | null;
  cep_origem: string | null;
  destino: string | null;
  cep_destino: string | null;
  origem_destino: OrigemEndereco | null;
  logradouro_destino: string | null;
  numero_destino: string | null;
  complemento_destino: string | null;
  bairro_destino: string | null;
  cidade_destino: string | null;
  uf_destino: string | null;
  codigo_municipio_destino: string | null;
  peso: string | null;
  peso_bruto: string | null;
  peso_liquido: string | null;
  volumes: number | null;
  especie_volumes: string | null;
  cif_fob_omie: string | null;
  transportadora_omie_codigo: string | null;
  valor_mercadoria: string | null;
  modalidade: Modalidade;
  modalidade_execucao: ModalidadeExecucao;
  veiculo_id: string | null;
  motorista_nome: string | null;
  custo_manual: string | null;
  status: StatusCotacao;
  observacoes: string | null;
  criado_por: string;
  criado_em: Date;
  atualizado_em: Date;
  fechado_em: Date | null;
}

function numeroOuNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function linhaParaCotacao(l: LinhaCotacao): CotacaoFrete {
  return {
    id: l.id,
    codigo: l.codigo,
    clienteOmieId: numeroOuNull(l.cliente_omie_id),
    pedidoOmieId: numeroOuNull(l.pedido_omie_id),
    pedidoOmieNumero: l.pedido_omie_numero,
    vendedorOmieId: numeroOuNull(l.vendedor_omie_id),
    clienteNomeSnapshot: l.cliente_nome_snapshot,
    origem: l.origem,
    cepOrigem: l.cep_origem,
    destino: l.destino,
    cepDestino: l.cep_destino,
    origemDestino: l.origem_destino,
    logradouroDestino: l.logradouro_destino,
    numeroDestino: l.numero_destino,
    complementoDestino: l.complemento_destino,
    bairroDestino: l.bairro_destino,
    cidadeDestino: l.cidade_destino,
    ufDestino: l.uf_destino,
    codigoMunicipioDestino: l.codigo_municipio_destino,
    peso: numeroOuNull(l.peso),
    pesoBruto: numeroOuNull(l.peso_bruto),
    pesoLiquido: numeroOuNull(l.peso_liquido),
    volumes: l.volumes,
    especieVolumes: l.especie_volumes,
    cifFobOmie: l.cif_fob_omie,
    transportadoraOmieCodigo: numeroOuNull(l.transportadora_omie_codigo),
    valorMercadoria: numeroOuNull(l.valor_mercadoria),
    modalidade: l.modalidade,
    modalidadeExecucao: l.modalidade_execucao,
    veiculoId: l.veiculo_id,
    motoristaNome: l.motorista_nome,
    custoManual: numeroOuNull(l.custo_manual),
    status: l.status,
    observacoes: l.observacoes,
    criadoPor: l.criado_por,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
    fechadoEm: l.fechado_em === null ? null : l.fechado_em.toISOString(),
  };
}

export interface DadosNovaCotacao {
  clienteOmieId: number | null;
  pedidoOmieId: number | null;
  /** Fase 3.2 — só preenchido em cotações importadas da Omie (`null` no fluxo manual da Fase 1). */
  pedidoOmieNumero?: string | null;
  vendedorOmieId: number | null;
  clienteNomeSnapshot?: string | null;
  origem: string | null;
  cepOrigem: string | null;
  destino: string | null;
  cepDestino: string | null;
  origemDestino?: OrigemEndereco | null;
  logradouroDestino?: string | null;
  numeroDestino?: string | null;
  complementoDestino?: string | null;
  bairroDestino?: string | null;
  cidadeDestino?: string | null;
  ufDestino?: string | null;
  codigoMunicipioDestino?: string | null;
  peso: number | null;
  pesoBruto?: number | null;
  pesoLiquido?: number | null;
  volumes: number | null;
  especieVolumes?: string | null;
  cifFobOmie?: string | null;
  transportadoraOmieCodigo?: number | null;
  valorMercadoria: number | null;
  modalidade: Modalidade;
  modalidadeExecucao: ModalidadeExecucao;
  veiculoId: string | null;
  motoristaNome: string | null;
  custoManual: number | null;
  observacoes: string | null;
}

export interface DadosAtualizacaoCotacao {
  origem?: string | null;
  cepOrigem?: string | null;
  destino?: string | null;
  cepDestino?: string | null;
  origemDestino?: OrigemEndereco | null;
  logradouroDestino?: string | null;
  numeroDestino?: string | null;
  complementoDestino?: string | null;
  bairroDestino?: string | null;
  cidadeDestino?: string | null;
  ufDestino?: string | null;
  codigoMunicipioDestino?: string | null;
  peso?: number | null;
  pesoBruto?: number | null;
  pesoLiquido?: number | null;
  volumes?: number | null;
  especieVolumes?: string | null;
  valorMercadoria?: number | null;
  modalidade?: Modalidade;
  modalidadeExecucao?: ModalidadeExecucao;
  veiculoId?: string | null;
  motoristaNome?: string | null;
  custoManual?: number | null;
  observacoes?: string | null;
}

/** "FRE-{ano da criação}-{sequência global com 6 dígitos}" (seção 5) — gerado atomicamente via SEQUENCE do Postgres, nunca colide mesmo sob concorrência. */
async function gerarCodigoCotacao(): Promise<string> {
  const pool = obterPool();
  const { rows } = await pool.query<{ proximo: string }>(`SELECT nextval('${nomeSequenciaCodigoCotacao()}')::text AS proximo`);
  const proximo = rows[0]?.proximo ?? '0';
  const ano = new Date().getFullYear();
  return `FRE-${ano}-${proximo.padStart(6, '0')}`;
}

export async function criarCotacao(dados: DadosNovaCotacao, criadoPor: string): Promise<CotacaoFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const codigo = await gerarCodigoCotacao();
  const { rows } = await pool.query<LinhaCotacao>(
    `INSERT INTO ${nomeTabelaCotacoes()}
       (id, codigo, cliente_omie_id, pedido_omie_id, pedido_omie_numero, vendedor_omie_id, cliente_nome_snapshot,
        origem, cep_origem, destino, cep_destino,
        origem_destino, logradouro_destino, numero_destino, complemento_destino, bairro_destino, cidade_destino,
        uf_destino, codigo_municipio_destino,
        peso, peso_bruto, peso_liquido, volumes, especie_volumes, cif_fob_omie, transportadora_omie_codigo,
        valor_mercadoria, modalidade, modalidade_execucao, veiculo_id, motorista_nome, custo_manual,
        status, observacoes, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
             $24, $25, $26, $27, $28, $29, $30, $31, $32, 'RASCUNHO', $33, $34)
     RETURNING *`,
    [
      id,
      codigo,
      dados.clienteOmieId,
      dados.pedidoOmieId,
      dados.pedidoOmieNumero ?? null,
      dados.vendedorOmieId,
      dados.clienteNomeSnapshot ?? null,
      dados.origem,
      dados.cepOrigem,
      dados.destino,
      dados.cepDestino,
      dados.origemDestino ?? null,
      dados.logradouroDestino ?? null,
      dados.numeroDestino ?? null,
      dados.complementoDestino ?? null,
      dados.bairroDestino ?? null,
      dados.cidadeDestino ?? null,
      dados.ufDestino ?? null,
      dados.codigoMunicipioDestino ?? null,
      dados.peso,
      dados.pesoBruto ?? null,
      dados.pesoLiquido ?? null,
      dados.volumes,
      dados.especieVolumes ?? null,
      dados.cifFobOmie ?? null,
      dados.transportadoraOmieCodigo ?? null,
      dados.valorMercadoria,
      dados.modalidade,
      dados.modalidadeExecucao,
      dados.veiculoId,
      dados.motoristaNome,
      dados.custoManual,
      dados.observacoes,
      criadoPor,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao criar cotação.');
  return linhaParaCotacao(linha);
}

/** Fase 3.2, seção 25 — usada só para AVISAR o usuário que o pedido já tem cotação; nunca bloqueia nem sobrescreve. */
export async function buscarCotacoesPorPedidoOmieId(pedidoOmieId: number): Promise<CotacaoFrete[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaCotacao>(
    `SELECT * FROM ${nomeTabelaCotacoes()} WHERE pedido_omie_id = $1 ORDER BY criado_em DESC`,
    [pedidoOmieId],
  );
  return rows.map(linhaParaCotacao);
}

export interface FiltrosCotacao {
  status?: StatusCotacao;
  modalidade?: Modalidade;
  modalidadeExecucao?: ModalidadeExecucao;
  codigo?: string;
}

export async function listarCotacoes(filtros: FiltrosCotacao): Promise<CotacaoFrete[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const condicoes: string[] = [];
  const valores: unknown[] = [];
  if (filtros.status !== undefined) {
    valores.push(filtros.status);
    condicoes.push(`status = $${valores.length}`);
  }
  if (filtros.modalidade !== undefined) {
    valores.push(filtros.modalidade);
    condicoes.push(`modalidade = $${valores.length}`);
  }
  if (filtros.modalidadeExecucao !== undefined) {
    valores.push(filtros.modalidadeExecucao);
    condicoes.push(`modalidade_execucao = $${valores.length}`);
  }
  if (filtros.codigo !== undefined) {
    valores.push(`%${filtros.codigo}%`);
    condicoes.push(`codigo ILIKE $${valores.length}`);
  }
  const whereSql = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
  const { rows } = await pool.query<LinhaCotacao>(
    `SELECT * FROM ${nomeTabelaCotacoes()} ${whereSql} ORDER BY criado_em DESC`,
    valores,
  );
  return rows.map(linhaParaCotacao);
}

export async function buscarCotacaoPorId(id: string): Promise<CotacaoFrete | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaCotacao>(`SELECT * FROM ${nomeTabelaCotacoes()} WHERE id = $1`, [id]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaCotacao(linha);
}

/** Só permite editar dados da cotação enquanto ela não estiver FECHADA/CANCELADA — nunca reescreve uma decisão já tomada. */
export async function atualizarCotacao(id: string, dados: DadosAtualizacaoCotacao): Promise<CotacaoFrete> {
  await garantirEsquemaFretes();
  const atual = await buscarCotacaoPorId(id);
  if (atual === null) throw new ErroValidacao('Cotação não encontrada.');
  if (atual.status === 'FECHADA' || atual.status === 'CANCELADA') {
    throw new ErroValidacao(`Não é possível editar uma cotação com status ${atual.status}.`);
  }

  const pool = obterPool();
  const { rows } = await pool.query<LinhaCotacao>(
    `UPDATE ${nomeTabelaCotacoes()}
        SET origem = $1, cep_origem = $2, destino = $3, cep_destino = $4, peso = $5, volumes = $6,
            valor_mercadoria = $7, modalidade = $8, modalidade_execucao = $9, veiculo_id = $10,
            motorista_nome = $11, custo_manual = $12, observacoes = $13,
            origem_destino = $14, logradouro_destino = $15, numero_destino = $16, complemento_destino = $17,
            bairro_destino = $18, cidade_destino = $19, uf_destino = $20, codigo_municipio_destino = $21,
            peso_bruto = $22, peso_liquido = $23, especie_volumes = $24,
            atualizado_em = now()
      WHERE id = $25
      RETURNING *`,
    [
      dados.origem !== undefined ? dados.origem : atual.origem,
      dados.cepOrigem !== undefined ? dados.cepOrigem : atual.cepOrigem,
      dados.destino !== undefined ? dados.destino : atual.destino,
      dados.cepDestino !== undefined ? dados.cepDestino : atual.cepDestino,
      dados.peso !== undefined ? dados.peso : atual.peso,
      dados.volumes !== undefined ? dados.volumes : atual.volumes,
      dados.valorMercadoria !== undefined ? dados.valorMercadoria : atual.valorMercadoria,
      dados.modalidade ?? atual.modalidade,
      dados.modalidadeExecucao ?? atual.modalidadeExecucao,
      dados.veiculoId !== undefined ? dados.veiculoId : atual.veiculoId,
      dados.motoristaNome !== undefined ? dados.motoristaNome : atual.motoristaNome,
      dados.custoManual !== undefined ? dados.custoManual : atual.custoManual,
      dados.observacoes !== undefined ? dados.observacoes : atual.observacoes,
      dados.origemDestino !== undefined ? dados.origemDestino : atual.origemDestino,
      dados.logradouroDestino !== undefined ? dados.logradouroDestino : atual.logradouroDestino,
      dados.numeroDestino !== undefined ? dados.numeroDestino : atual.numeroDestino,
      dados.complementoDestino !== undefined ? dados.complementoDestino : atual.complementoDestino,
      dados.bairroDestino !== undefined ? dados.bairroDestino : atual.bairroDestino,
      dados.cidadeDestino !== undefined ? dados.cidadeDestino : atual.cidadeDestino,
      dados.ufDestino !== undefined ? dados.ufDestino : atual.ufDestino,
      dados.codigoMunicipioDestino !== undefined ? dados.codigoMunicipioDestino : atual.codigoMunicipioDestino,
      dados.pesoBruto !== undefined ? dados.pesoBruto : atual.pesoBruto,
      dados.pesoLiquido !== undefined ? dados.pesoLiquido : atual.pesoLiquido,
      dados.especieVolumes !== undefined ? dados.especieVolumes : atual.especieVolumes,
      id,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Cotação não encontrada.');
  return linhaParaCotacao(linha);
}

/** Atualiza só o status — usado internamente pelo serviço (transições controladas, nunca livre). */
export async function definirStatusCotacao(id: string, status: StatusCotacao): Promise<CotacaoFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaCotacao>(
    `UPDATE ${nomeTabelaCotacoes()} SET status = $1, atualizado_em = now() WHERE id = $2 RETURNING *`,
    [status, id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Cotação não encontrada.');
  return linhaParaCotacao(linha);
}
