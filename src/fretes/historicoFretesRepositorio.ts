/**
 * Fase 4A.8 — Histórico de Fretes por Cliente. Só consulta (JOINs) tabelas já existentes do
 * módulo (cotações/propostas/transportadoras/composições comerciais/solicitações) — nenhuma
 * tabela nova, nenhuma escrita. Cada linha do histórico é uma PROPOSTA (junto com sua
 * cotação/transportadora/composição mais recente): cotações sem nenhuma proposta (RASCUNHO,
 * ou modalidade VEICULO_PROPRIO/RETIRA) não aparecem, porque "frete base"/"valor mínimo"/
 * "transportadora" são conceitos por proposta de transportadora — ver relatório da fase.
 */

import { obterPool } from '../db.js';
import {
  garantirEsquemaFretes,
  nomeTabelaComposicoesComerciais,
  nomeTabelaCotacoes,
  nomeTabelaPropostas,
  nomeTabelaSolicitacoes,
  nomeTabelaTransportadoras,
} from './schema.js';
import type { CanalOrigemProposta, Modalidade, ModalidadeExecucao, StatusCotacao, StatusRevisaoProposta, TipoDocumento } from './tipos.js';

export interface LinhaHistoricoFrete {
  cotacaoId: string;
  codigo: string;
  clienteOmieId: number | null;
  clienteNomeSnapshot: string | null;
  pedidoOmieNumero: string | null;
  documentoOmieTipo: TipoDocumento | null;
  vendedorOmieId: number | null;
  origem: string | null;
  destino: string | null;
  modalidade: Modalidade;
  modalidadeExecucao: ModalidadeExecucao;
  cotacaoStatus: StatusCotacao;
  peso: number | null;
  volumes: number | null;
  cotacaoCriadoEm: string;
  propostaId: string;
  transportadoraId: string;
  transportadoraNome: string;
  freteBase: number;
  prazoDias: number | null;
  statusRevisao: StatusRevisaoProposta;
  propostaCriadoEm: string;
  propostaAtualizadoEm: string;
  valorMinimo: number | null;
  composicaoCriadoEm: string | null;
  composicaoUsuarioId: string | null;
}

export interface FiltrosHistoricoFrete {
  clienteOmieId: number;
  /**
   * Único parâmetro de vendedor — a camada de serviço decide o que passar aqui: o
   * `vendedorOmieId` do próprio usuário (quando ele não tem visão ampliada, sempre forçado,
   * nunca a escolha dele), o filtro que um admin/gerência escolheu na tela, ou `undefined`
   * (sem restrição, visão ampliada sem filtro). Nunca dois valores concorrentes.
   */
  vendedorOmieId?: number;
  transportadoraId?: string;
  /** `null` mapeia para "MANUAL" (cotação sem `documento_omie_tipo`, ver `tipos.ts`). */
  documentoOmieTipo?: TipoDocumento | 'MANUAL';
  statusRevisao?: StatusRevisaoProposta;
  dataInicio?: string;
  dataFim?: string;
  pagina: number;
  tamanhoPagina: number;
}

interface LinhaBruta {
  cotacao_id: string;
  codigo: string;
  cliente_omie_id: string | null;
  cliente_nome_snapshot: string | null;
  pedido_omie_numero: string | null;
  documento_omie_tipo: TipoDocumento | null;
  vendedor_omie_id: string | null;
  origem: string | null;
  destino: string | null;
  modalidade: Modalidade;
  modalidade_execucao: ModalidadeExecucao;
  cotacao_status: StatusCotacao;
  peso: string | null;
  volumes: number | null;
  cotacao_criado_em: Date;
  proposta_id: string;
  transportadora_id: string;
  transportadora_nome: string;
  valor_custo: string;
  prazo_dias: number | null;
  status_revisao: StatusRevisaoProposta;
  proposta_criado_em: Date;
  proposta_atualizado_em: Date;
  valor_minimo: string | null;
  composicao_criado_em: Date | null;
  composicao_usuario_id: string | null;
  total_count: string;
}

function numeroOuNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function linhaParaHistorico(l: LinhaBruta): LinhaHistoricoFrete {
  return {
    cotacaoId: l.cotacao_id,
    codigo: l.codigo,
    clienteOmieId: numeroOuNull(l.cliente_omie_id),
    clienteNomeSnapshot: l.cliente_nome_snapshot,
    pedidoOmieNumero: l.pedido_omie_numero,
    documentoOmieTipo: l.documento_omie_tipo,
    vendedorOmieId: numeroOuNull(l.vendedor_omie_id),
    origem: l.origem,
    destino: l.destino,
    modalidade: l.modalidade,
    modalidadeExecucao: l.modalidade_execucao,
    cotacaoStatus: l.cotacao_status,
    peso: numeroOuNull(l.peso),
    volumes: l.volumes,
    cotacaoCriadoEm: l.cotacao_criado_em.toISOString(),
    propostaId: l.proposta_id,
    transportadoraId: l.transportadora_id,
    transportadoraNome: l.transportadora_nome,
    freteBase: Number(l.valor_custo),
    prazoDias: l.prazo_dias,
    statusRevisao: l.status_revisao,
    propostaCriadoEm: l.proposta_criado_em.toISOString(),
    propostaAtualizadoEm: l.proposta_atualizado_em.toISOString(),
    valorMinimo: l.valor_minimo === null ? null : Number(l.valor_minimo),
    composicaoCriadoEm: l.composicao_criado_em === null ? null : l.composicao_criado_em.toISOString(),
    composicaoUsuarioId: l.composicao_usuario_id,
  };
}

/**
 * Monta a cláusula WHERE + params comuns a `listarHistoricoFretes`/`buscarResumoClienteFrete`
 * — mesmos filtros, evita duplicar a lógica de restrição de vendedor entre as duas consultas.
 */
function montarFiltros(filtros: FiltrosHistoricoFrete): { clausula: string; params: unknown[] } {
  const condicoes: string[] = ['c.cliente_omie_id = $1'];
  const params: unknown[] = [filtros.clienteOmieId];

  if (filtros.vendedorOmieId !== undefined) {
    params.push(filtros.vendedorOmieId);
    condicoes.push(`c.vendedor_omie_id = $${params.length}`);
  }
  if (filtros.transportadoraId !== undefined) {
    params.push(filtros.transportadoraId);
    condicoes.push(`p.transportadora_id = $${params.length}`);
  }
  if (filtros.documentoOmieTipo !== undefined) {
    if (filtros.documentoOmieTipo === 'MANUAL') {
      condicoes.push('c.documento_omie_tipo IS NULL');
    } else {
      params.push(filtros.documentoOmieTipo);
      condicoes.push(`c.documento_omie_tipo = $${params.length}`);
    }
  }
  if (filtros.statusRevisao !== undefined) {
    params.push(filtros.statusRevisao);
    condicoes.push(`p.status_revisao = $${params.length}`);
  }
  if (filtros.dataInicio !== undefined) {
    params.push(filtros.dataInicio);
    condicoes.push(`p.criado_em >= $${params.length}`);
  }
  if (filtros.dataFim !== undefined) {
    params.push(filtros.dataFim);
    condicoes.push(`p.criado_em <= $${params.length}`);
  }
  return { clausula: condicoes.join(' AND '), params };
}

function juncoesBase(): string {
  return `
    FROM ${nomeTabelaPropostas()} p
    JOIN ${nomeTabelaCotacoes()} c ON c.id = p.cotacao_id
    JOIN ${nomeTabelaTransportadoras()} t ON t.id = p.transportadora_id
    LEFT JOIN LATERAL (
      SELECT valor_minimo, criado_em, usuario_id
      FROM ${nomeTabelaComposicoesComerciais()} cc
      WHERE cc.proposta_id = p.id
      ORDER BY cc.criado_em DESC
      LIMIT 1
    ) comp ON true
  `;
}

export async function listarHistoricoFretes(filtros: FiltrosHistoricoFrete): Promise<{ linhas: LinhaHistoricoFrete[]; total: number }> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { clausula, params } = montarFiltros(filtros);
  const limite = Math.min(Math.max(filtros.tamanhoPagina, 1), 100);
  const offset = Math.max(filtros.pagina - 1, 0) * limite;
  const paramsComPaginacao = [...params, limite, offset];

  const { rows } = await pool.query<LinhaBruta>(
    `SELECT
       c.id AS cotacao_id, c.codigo, c.cliente_omie_id, c.cliente_nome_snapshot, c.pedido_omie_numero,
       c.documento_omie_tipo, c.vendedor_omie_id, c.origem, c.destino, c.modalidade, c.modalidade_execucao,
       c.status AS cotacao_status, c.peso, c.volumes, c.criado_em AS cotacao_criado_em,
       p.id AS proposta_id, p.transportadora_id, t.nome_razao_social AS transportadora_nome,
       p.valor_custo, p.prazo_dias, p.status_revisao, p.criado_em AS proposta_criado_em, p.atualizado_em AS proposta_atualizado_em,
       comp.valor_minimo, comp.criado_em AS composicao_criado_em, comp.usuario_id AS composicao_usuario_id,
       count(*) OVER() AS total_count
     ${juncoesBase()}
     WHERE ${clausula}
     ORDER BY p.criado_em DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    paramsComPaginacao,
  );
  const total = rows[0] === undefined ? 0 : Number(rows[0].total_count);
  return { linhas: rows.map(linhaParaHistorico), total };
}

export interface LinhaHistoricoDetalhe extends LinhaHistoricoFrete {
  canal: CanalOrigemProposta | null;
  origemDestino: {
    logradouroDestino: string | null;
    numeroDestino: string | null;
    bairroDestino: string | null;
    cidadeDestino: string | null;
    ufDestino: string | null;
  };
}

/**
 * Detalhe de uma linha específica. `vendedorOmieId`, quando informado (usuário sem visão
 * ampliada), garante a mesma regra de acesso da listagem — nunca destrava o detalhe de uma
 * cotação de outro vendedor.
 */
export async function buscarDetalheHistorico(propostaId: string, vendedorOmieId: number | undefined): Promise<LinhaHistoricoDetalhe | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const condicoes = ['p.id = $1'];
  const params: unknown[] = [propostaId];
  if (vendedorOmieId !== undefined) {
    params.push(vendedorOmieId);
    condicoes.push(`c.vendedor_omie_id = $${params.length}`);
  }
  const { rows } = await pool.query<
    LinhaBruta & {
      canal: CanalOrigemProposta | null;
      logradouro_destino: string | null;
      numero_destino: string | null;
      bairro_destino: string | null;
      cidade_destino: string | null;
      uf_destino: string | null;
    }
  >(
    `SELECT
       c.id AS cotacao_id, c.codigo, c.cliente_omie_id, c.cliente_nome_snapshot, c.pedido_omie_numero,
       c.documento_omie_tipo, c.vendedor_omie_id, c.origem, c.destino, c.modalidade, c.modalidade_execucao,
       c.status AS cotacao_status, c.peso, c.volumes, c.criado_em AS cotacao_criado_em,
       c.logradouro_destino, c.numero_destino, c.bairro_destino, c.cidade_destino, c.uf_destino,
       p.id AS proposta_id, p.transportadora_id, t.nome_razao_social AS transportadora_nome,
       p.valor_custo, p.prazo_dias, p.status_revisao, p.criado_em AS proposta_criado_em, p.atualizado_em AS proposta_atualizado_em,
       comp.valor_minimo, comp.criado_em AS composicao_criado_em, comp.usuario_id AS composicao_usuario_id,
       s.canal,
       '0'::text AS total_count
     ${juncoesBase()}
     LEFT JOIN ${nomeTabelaSolicitacoes()} s ON s.id = p.solicitacao_id
     WHERE ${condicoes.join(' AND ')}`,
    params,
  );
  const linha = rows[0];
  if (linha === undefined) return null;
  return {
    ...linhaParaHistorico(linha),
    canal: linha.canal,
    origemDestino: {
      logradouroDestino: linha.logradouro_destino,
      numeroDestino: linha.numero_destino,
      bairroDestino: linha.bairro_destino,
      cidadeDestino: linha.cidade_destino,
      ufDestino: linha.uf_destino,
    },
  };
}

export interface ResumoClienteFrete {
  clienteOmieId: number;
  clienteNomeSnapshot: string | null;
  totalFretes: number;
  totalEscolhidos: number;
  mediaFreteBase: number | null;
  mediaValorMinimo: number | null;
  prazoMedioDias: number | null;
  transportadoraMaisUtilizada: string | null;
  rotasMaisFrequentes: { origem: string | null; destino: string | null; quantidade: number }[];
  ultimaCotacaoEm: string | null;
  ultimoFreteEscolhidoEm: string | null;
}

export async function buscarResumoClienteFrete(
  clienteOmieId: number,
  vendedorOmieId: number | undefined,
): Promise<ResumoClienteFrete | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { clausula, params } = montarFiltros({ clienteOmieId, vendedorOmieId, pagina: 1, tamanhoPagina: 1 });

  const { rows: agregados } = await pool.query<{
    cliente_nome_snapshot: string | null;
    total_fretes: string;
    total_escolhidos: string;
    media_frete_base: string | null;
    media_valor_minimo: string | null;
    prazo_medio: string | null;
  }>(
    `SELECT
       max(c.cliente_nome_snapshot) AS cliente_nome_snapshot,
       count(*) AS total_fretes,
       count(*) FILTER (WHERE p.status_revisao = 'ESCOLHIDA') AS total_escolhidos,
       avg(p.valor_custo) AS media_frete_base,
       avg(comp.valor_minimo) AS media_valor_minimo,
       avg(p.prazo_dias) AS prazo_medio
     ${juncoesBase()}
     WHERE ${clausula}`,
    params,
  );
  const agregado = agregados[0];
  if (agregado === undefined || Number(agregado.total_fretes) === 0) {
    // Nenhum histórico — confirma se o cliente "existe" pra decidir 404 vs "sem dados", mas
    // SEMPRE com a mesma restrição de vendedor da consulta principal (nunca revela nome/
    // existência de um cliente que este usuário não tem permissão de ver).
    const condicoesExiste = ['cliente_omie_id = $1'];
    const paramsExiste: unknown[] = [clienteOmieId];
    if (vendedorOmieId !== undefined) {
      paramsExiste.push(vendedorOmieId);
      condicoesExiste.push(`vendedor_omie_id = $${paramsExiste.length}`);
    }
    const { rows: existe } = await pool.query<{ cliente_nome_snapshot: string | null }>(
      `SELECT cliente_nome_snapshot FROM ${nomeTabelaCotacoes()} WHERE ${condicoesExiste.join(' AND ')} LIMIT 1`,
      paramsExiste,
    );
    if (existe[0] === undefined) return null;
    return {
      clienteOmieId,
      clienteNomeSnapshot: existe[0].cliente_nome_snapshot,
      totalFretes: 0,
      totalEscolhidos: 0,
      mediaFreteBase: null,
      mediaValorMinimo: null,
      prazoMedioDias: null,
      transportadoraMaisUtilizada: null,
      rotasMaisFrequentes: [],
      ultimaCotacaoEm: null,
      ultimoFreteEscolhidoEm: null,
    };
  }

  const { rows: transportadoraTop } = await pool.query<{ nome_razao_social: string }>(
    `SELECT t.nome_razao_social
     ${juncoesBase()}
     WHERE ${clausula}
     GROUP BY t.id, t.nome_razao_social
     ORDER BY count(*) DESC
     LIMIT 1`,
    params,
  );

  const { rows: rotasTop } = await pool.query<{ origem: string | null; destino: string | null; quantidade: string }>(
    `SELECT c.origem, c.destino, count(*) AS quantidade
     ${juncoesBase()}
     WHERE ${clausula}
     GROUP BY c.origem, c.destino
     ORDER BY count(*) DESC
     LIMIT 3`,
    params,
  );

  const { rows: ultimaCotacao } = await pool.query<{ criado_em: Date }>(
    `SELECT p.criado_em ${juncoesBase()} WHERE ${clausula} ORDER BY p.criado_em DESC LIMIT 1`,
    params,
  );
  const { rows: ultimoEscolhido } = await pool.query<{ criado_em: Date }>(
    `SELECT p.criado_em ${juncoesBase()} WHERE ${clausula} AND p.status_revisao = 'ESCOLHIDA' ORDER BY p.criado_em DESC LIMIT 1`,
    params,
  );

  return {
    clienteOmieId,
    clienteNomeSnapshot: agregado.cliente_nome_snapshot,
    totalFretes: Number(agregado.total_fretes),
    totalEscolhidos: Number(agregado.total_escolhidos),
    mediaFreteBase: agregado.media_frete_base === null ? null : Number(agregado.media_frete_base),
    mediaValorMinimo: agregado.media_valor_minimo === null ? null : Number(agregado.media_valor_minimo),
    prazoMedioDias: agregado.prazo_medio === null ? null : Number(agregado.prazo_medio),
    transportadoraMaisUtilizada: transportadoraTop[0]?.nome_razao_social ?? null,
    rotasMaisFrequentes: rotasTop.map((r) => ({ origem: r.origem, destino: r.destino, quantidade: Number(r.quantidade) })),
    ultimaCotacaoEm: ultimaCotacao[0] === undefined ? null : ultimaCotacao[0].criado_em.toISOString(),
    ultimoFreteEscolhidoEm: ultimoEscolhido[0] === undefined ? null : ultimoEscolhido[0].criado_em.toISOString(),
  };
}

export interface ClienteHistoricoResultado {
  clienteOmieId: number;
  clienteNomeSnapshot: string | null;
}

/** Autocomplete de clientes (Fase 4A.8, seção 2) — só considera cotações com `cliente_omie_id` preenchido (cotações 100% manuais, sem vínculo Omie, não têm um "cliente" identificável para agrupar o histórico). */
export async function buscarClientesHistorico(termo: string, vendedorOmieId: number | undefined): Promise<ClienteHistoricoResultado[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const condicoes = ['cliente_omie_id IS NOT NULL', '(cliente_nome_snapshot ILIKE $1 OR cliente_omie_id::text = $2)'];
  const params: unknown[] = [`%${termo}%`, termo];
  if (vendedorOmieId !== undefined) {
    params.push(vendedorOmieId);
    condicoes.push(`vendedor_omie_id = $${params.length}`);
  }
  const { rows } = await pool.query<{ cliente_omie_id: string; cliente_nome_snapshot: string | null }>(
    `SELECT DISTINCT cliente_omie_id, cliente_nome_snapshot
     FROM ${nomeTabelaCotacoes()}
     WHERE ${condicoes.join(' AND ')}
     ORDER BY cliente_nome_snapshot
     LIMIT 20`,
    params,
  );
  return rows.map((r) => ({ clienteOmieId: Number(r.cliente_omie_id), clienteNomeSnapshot: r.cliente_nome_snapshot }));
}
