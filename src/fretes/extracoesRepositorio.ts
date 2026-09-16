import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { garantirEsquemaFretes, nomeTabelaExtracoes } from './schema.js';
import type { DadosExtracaoProposta, ExtracaoProposta, StatusExtracaoProposta } from './tipos.js';

interface LinhaExtracao {
  id: string;
  resposta_id: string;
  versao_extrator: string;
  dados_extraidos: DadosExtracaoProposta;
  confianca: string | null;
  status: StatusExtracaoProposta;
  proposta_id: string | null;
  criado_em: Date;
}

function linhaParaExtracao(l: LinhaExtracao): ExtracaoProposta {
  return {
    id: l.id,
    respostaId: l.resposta_id,
    versaoExtrator: l.versao_extrator,
    dadosExtraidos: l.dados_extraidos,
    confianca: l.confianca === null ? null : Number(l.confianca),
    status: l.status,
    propostaId: l.proposta_id,
    criadoEm: l.criado_em.toISOString(),
  };
}

export interface DadosNovaExtracao {
  respostaId: string;
  versaoExtrator: string;
  dadosExtraidos: DadosExtracaoProposta;
  confianca: number | null;
  status: StatusExtracaoProposta;
  /** Preenchido só quando a extração teve `valorFrete` utilizável e a proposta pendente já foi criada (seção 15/40). */
  propostaId: string | null;
}

export async function criarExtracao(dados: DadosNovaExtracao): Promise<ExtracaoProposta> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const { rows } = await pool.query<LinhaExtracao>(
    `INSERT INTO ${nomeTabelaExtracoes()} (id, resposta_id, versao_extrator, dados_extraidos, confianca, status, proposta_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, dados.respostaId, dados.versaoExtrator, JSON.stringify(dados.dadosExtraidos), dados.confianca, dados.status, dados.propostaId],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao criar extração de proposta.');
  return linhaParaExtracao(linha);
}

export async function buscarExtracaoPorRespostaId(respostaId: string): Promise<ExtracaoProposta | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaExtracao>(`SELECT * FROM ${nomeTabelaExtracoes()} WHERE resposta_id = $1`, [respostaId]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaExtracao(linha);
}

export async function buscarExtracaoPorPropostaId(propostaId: string): Promise<ExtracaoProposta | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaExtracao>(`SELECT * FROM ${nomeTabelaExtracoes()} WHERE proposta_id = $1`, [propostaId]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaExtracao(linha);
}
