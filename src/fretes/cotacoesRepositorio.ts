import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { garantirEsquemaFretes, nomeSequenciaCodigoCotacao, nomeTabelaCotacoes } from './schema.js';
import type { CotacaoFrete, Modalidade, StatusCotacao } from './tipos.js';

interface LinhaCotacao {
  id: string;
  codigo: string;
  cliente_omie_id: number | null;
  pedido_omie_id: number | null;
  vendedor_omie_id: number | null;
  origem: string | null;
  cep_origem: string | null;
  destino: string | null;
  cep_destino: string | null;
  peso: string | null;
  volumes: number | null;
  valor_mercadoria: string | null;
  modalidade: Modalidade;
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
    clienteOmieId: l.cliente_omie_id,
    pedidoOmieId: l.pedido_omie_id,
    vendedorOmieId: l.vendedor_omie_id,
    origem: l.origem,
    cepOrigem: l.cep_origem,
    destino: l.destino,
    cepDestino: l.cep_destino,
    peso: numeroOuNull(l.peso),
    volumes: l.volumes,
    valorMercadoria: numeroOuNull(l.valor_mercadoria),
    modalidade: l.modalidade,
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
  vendedorOmieId: number | null;
  origem: string | null;
  cepOrigem: string | null;
  destino: string | null;
  cepDestino: string | null;
  peso: number | null;
  volumes: number | null;
  valorMercadoria: number | null;
  modalidade: Modalidade;
  observacoes: string | null;
}

export interface DadosAtualizacaoCotacao {
  origem?: string | null;
  cepOrigem?: string | null;
  destino?: string | null;
  cepDestino?: string | null;
  peso?: number | null;
  volumes?: number | null;
  valorMercadoria?: number | null;
  modalidade?: Modalidade;
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
       (id, codigo, cliente_omie_id, pedido_omie_id, vendedor_omie_id, origem, cep_origem, destino, cep_destino,
        peso, volumes, valor_mercadoria, modalidade, status, observacoes, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'RASCUNHO', $14, $15)
     RETURNING *`,
    [
      id,
      codigo,
      dados.clienteOmieId,
      dados.pedidoOmieId,
      dados.vendedorOmieId,
      dados.origem,
      dados.cepOrigem,
      dados.destino,
      dados.cepDestino,
      dados.peso,
      dados.volumes,
      dados.valorMercadoria,
      dados.modalidade,
      dados.observacoes,
      criadoPor,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao criar cotação.');
  return linhaParaCotacao(linha);
}

export interface FiltrosCotacao {
  status?: StatusCotacao;
  modalidade?: Modalidade;
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
            valor_mercadoria = $7, modalidade = $8, observacoes = $9, atualizado_em = now()
      WHERE id = $10
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
      dados.observacoes !== undefined ? dados.observacoes : atual.observacoes,
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
