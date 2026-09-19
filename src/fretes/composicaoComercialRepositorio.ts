import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { garantirEsquemaFretes, nomeTabelaAprovacoesValorMinimo, nomeTabelaComposicoesComerciais } from './schema.js';
import type { AprovacaoValorMinimoFrete, ComposicaoComercialFrete, StatusAprovacaoValorMinimo } from './tipos.js';

// --- Composições comerciais (snapshot da escolha) --------------------------

interface LinhaComposicao {
  id: string;
  cotacao_id: string;
  proposta_id: string;
  frete_base: string;
  valor_minimo: string;
  acrescimo_percentual: string;
  valor_final_cliente: string;
  pis_percentual_utilizado: string;
  cofins_percentual_utilizado: string;
  icms_percentual_utilizado: string;
  aprovacao_id: string | null;
  usuario_id: string;
  criado_em: Date;
}

function linhaParaComposicao(l: LinhaComposicao): ComposicaoComercialFrete {
  return {
    id: l.id,
    cotacaoId: l.cotacao_id,
    propostaId: l.proposta_id,
    freteBase: Number(l.frete_base),
    valorMinimo: Number(l.valor_minimo),
    acrescimoPercentual: Number(l.acrescimo_percentual),
    valorFinalCliente: Number(l.valor_final_cliente),
    pisPercentualUtilizado: Number(l.pis_percentual_utilizado),
    cofinsPercentualUtilizado: Number(l.cofins_percentual_utilizado),
    icmsPercentualUtilizado: Number(l.icms_percentual_utilizado),
    aprovacaoId: l.aprovacao_id,
    usuarioId: l.usuario_id,
    criadoEm: l.criado_em.toISOString(),
  };
}

export interface DadosNovaComposicao {
  cotacaoId: string;
  propostaId: string;
  freteBase: number;
  valorMinimo: number;
  acrescimoPercentual: number;
  valorFinalCliente: number;
  pisPercentualUtilizado: number;
  cofinsPercentualUtilizado: number;
  icmsPercentualUtilizado: number;
  aprovacaoId: string | null;
  usuarioId: string;
}

export async function criarComposicaoComercial(dados: DadosNovaComposicao): Promise<ComposicaoComercialFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaComposicao>(
    `INSERT INTO ${nomeTabelaComposicoesComerciais()}
       (id, cotacao_id, proposta_id, frete_base, valor_minimo, acrescimo_percentual, valor_final_cliente,
        pis_percentual_utilizado, cofins_percentual_utilizado, icms_percentual_utilizado, aprovacao_id, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      randomUUID(),
      dados.cotacaoId,
      dados.propostaId,
      dados.freteBase,
      dados.valorMinimo,
      dados.acrescimoPercentual,
      dados.valorFinalCliente,
      dados.pisPercentualUtilizado,
      dados.cofinsPercentualUtilizado,
      dados.icmsPercentualUtilizado,
      dados.aprovacaoId,
      dados.usuarioId,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao registrar composição comercial.');
  return linhaParaComposicao(linha);
}

export async function buscarComposicaoPorProposta(propostaId: string): Promise<ComposicaoComercialFrete | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaComposicao>(
    `SELECT * FROM ${nomeTabelaComposicoesComerciais()} WHERE proposta_id = $1 ORDER BY criado_em DESC LIMIT 1`,
    [propostaId],
  );
  const linha = rows[0];
  return linha === undefined ? null : linhaParaComposicao(linha);
}

// --- Aprovações de valor abaixo do mínimo -----------------------------------

interface LinhaAprovacao {
  id: string;
  cotacao_id: string;
  proposta_id: string;
  vendedor_usuario_id: string;
  valor_minimo: string;
  valor_proposto: string;
  diferenca: string;
  acrescimo_percentual: string;
  motivo: string;
  status: StatusAprovacaoValorMinimo;
  aprovador_usuario_id: string | null;
  decidido_em: Date | null;
  criado_em: Date;
}

function linhaParaAprovacao(l: LinhaAprovacao): AprovacaoValorMinimoFrete {
  return {
    id: l.id,
    cotacaoId: l.cotacao_id,
    propostaId: l.proposta_id,
    vendedorUsuarioId: l.vendedor_usuario_id,
    valorMinimo: Number(l.valor_minimo),
    valorProposto: Number(l.valor_proposto),
    diferenca: Number(l.diferenca),
    acrescimoPercentual: Number(l.acrescimo_percentual),
    motivo: l.motivo,
    status: l.status,
    aprovadorUsuarioId: l.aprovador_usuario_id,
    decididoEm: l.decidido_em === null ? null : l.decidido_em.toISOString(),
    criadoEm: l.criado_em.toISOString(),
  };
}

export interface DadosNovaAprovacao {
  cotacaoId: string;
  propostaId: string;
  vendedorUsuarioId: string;
  valorMinimo: number;
  valorProposto: number;
  diferenca: number;
  acrescimoPercentual: number;
  motivo: string;
}

export async function criarAprovacaoValorMinimo(dados: DadosNovaAprovacao): Promise<AprovacaoValorMinimoFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaAprovacao>(
    `INSERT INTO ${nomeTabelaAprovacoesValorMinimo()}
       (id, cotacao_id, proposta_id, vendedor_usuario_id, valor_minimo, valor_proposto, diferenca, acrescimo_percentual, motivo, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDENTE')
     RETURNING *`,
    [randomUUID(), dados.cotacaoId, dados.propostaId, dados.vendedorUsuarioId, dados.valorMinimo, dados.valorProposto, dados.diferenca, dados.acrescimoPercentual, dados.motivo],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao registrar solicitação de aprovação.');
  return linhaParaAprovacao(linha);
}

export async function buscarAprovacaoPorId(id: string): Promise<AprovacaoValorMinimoFrete | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaAprovacao>(`SELECT * FROM ${nomeTabelaAprovacoesValorMinimo()} WHERE id = $1`, [id]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaAprovacao(linha);
}

export async function listarAprovacoesValorMinimo(status?: StatusAprovacaoValorMinimo): Promise<AprovacaoValorMinimoFrete[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } =
    status === undefined
      ? await pool.query<LinhaAprovacao>(`SELECT * FROM ${nomeTabelaAprovacoesValorMinimo()} ORDER BY criado_em DESC`)
      : await pool.query<LinhaAprovacao>(`SELECT * FROM ${nomeTabelaAprovacoesValorMinimo()} WHERE status = $1 ORDER BY criado_em DESC`, [status]);
  return rows.map(linhaParaAprovacao);
}

/** Transição PENDENTE → APROVADA/REJEITADA — falha explícita se a aprovação já foi decidida (nunca sobrescreve uma decisão anterior). */
export async function decidirAprovacaoValorMinimo(
  id: string,
  decisao: 'APROVADA' | 'REJEITADA',
  aprovadorUsuarioId: string,
): Promise<AprovacaoValorMinimoFrete> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaAprovacao>(
    `UPDATE ${nomeTabelaAprovacoesValorMinimo()}
        SET status = $1, aprovador_usuario_id = $2, decidido_em = now()
      WHERE id = $3 AND status = 'PENDENTE'
      RETURNING *`,
    [decisao, aprovadorUsuarioId, id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Solicitação de aprovação não encontrada (ou já decidida anteriormente).');
  return linhaParaAprovacao(linha);
}
