import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { garantirEsquemaFretes, nomeTabelaTransportadoras } from './schema.js';
import type { CanalPrincipalTransportadora, Transportadora } from './tipos.js';

interface LinhaTransportadora {
  id: string;
  nome_razao_social: string;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  contato: string | null;
  ativo: boolean;
  observacoes: string | null;
  /** BIGINT — `pg` sempre devolve como string, nunca number (mesmo motivo de `pedido_omie_id` etc.). */
  codigo_cliente_omie: string | null;
  canal_principal: CanalPrincipalTransportadora | null;
  url_portal: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

function linhaParaTransportadora(l: LinhaTransportadora): Transportadora {
  return {
    id: l.id,
    nomeRazaoSocial: l.nome_razao_social,
    nomeFantasia: l.nome_fantasia,
    cnpj: l.cnpj,
    email: l.email,
    telefone: l.telefone,
    contato: l.contato,
    ativo: l.ativo,
    observacoes: l.observacoes,
    codigoClienteOmie: l.codigo_cliente_omie === null ? null : Number(l.codigo_cliente_omie),
    canalPrincipal: l.canal_principal,
    urlPortal: l.url_portal,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

export interface DadosTransportadora {
  nomeRazaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  contato: string | null;
  observacoes: string | null;
  /** Fase 4A.4.1 — opcional; `undefined` em chamadas que não mexem nesse campo (ver `atualizarTransportadora`). */
  codigoClienteOmie?: number | null;
  /** Arquitetura de canais — Fase 1; opcional, `undefined` em chamadas que não mexem nesse campo. */
  canalPrincipal?: CanalPrincipalTransportadora | null;
  /** Arquitetura de canais — Fase 1; opcional, `undefined` em chamadas que não mexem nesse campo. */
  urlPortal?: string | null;
}

export async function listarTransportadoras(somenteAtivas: boolean): Promise<Transportadora[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const tabela = nomeTabelaTransportadoras();
  const { rows } = somenteAtivas
    ? await pool.query<LinhaTransportadora>(`SELECT * FROM ${tabela} WHERE ativo = true ORDER BY nome_razao_social`)
    : await pool.query<LinhaTransportadora>(`SELECT * FROM ${tabela} ORDER BY nome_razao_social`);
  return rows.map(linhaParaTransportadora);
}

export async function buscarTransportadoraPorId(id: string): Promise<Transportadora | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaTransportadora>(`SELECT * FROM ${nomeTabelaTransportadoras()} WHERE id = $1`, [id]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaTransportadora(linha);
}

/** CNPJ é a chave de duplicidade — compara só dígitos, inclusive com cadastros antigos gravados com máscara. */
export async function buscarTransportadoraPorCnpj(cnpj: string): Promise<Transportadora | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const digitos = cnpj.replace(/\D/g, '');
  if (digitos === '') return null;
  const { rows } = await pool.query<LinhaTransportadora>(
    `SELECT * FROM ${nomeTabelaTransportadoras()} WHERE regexp_replace(COALESCE(cnpj, ''), '\\D', '', 'g') = $1 LIMIT 1`,
    [digitos],
  );
  const linha = rows[0];
  return linha === undefined ? null : linhaParaTransportadora(linha);
}

export async function criarTransportadora(dados: DadosTransportadora): Promise<Transportadora> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const { rows } = await pool.query<LinhaTransportadora>(
    `INSERT INTO ${nomeTabelaTransportadoras()}
       (id, nome_razao_social, nome_fantasia, cnpj, email, telefone, contato, ativo, observacoes, codigo_cliente_omie, canal_principal, url_portal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11)
     RETURNING *`,
    [
      id,
      dados.nomeRazaoSocial,
      dados.nomeFantasia,
      dados.cnpj,
      dados.email,
      dados.telefone,
      dados.contato,
      dados.observacoes,
      dados.codigoClienteOmie ?? null,
      dados.canalPrincipal ?? null,
      dados.urlPortal ?? null,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao criar transportadora.');
  return linhaParaTransportadora(linha);
}

export async function atualizarTransportadora(id: string, dados: Partial<DadosTransportadora>): Promise<Transportadora> {
  await garantirEsquemaFretes();
  const atual = await buscarTransportadoraPorId(id);
  if (atual === null) throw new ErroValidacao('Transportadora não encontrada.');

  const nomeRazaoSocial = dados.nomeRazaoSocial ?? atual.nomeRazaoSocial;
  const nomeFantasia = dados.nomeFantasia !== undefined ? dados.nomeFantasia : atual.nomeFantasia;
  const cnpj = dados.cnpj !== undefined ? dados.cnpj : atual.cnpj;
  const email = dados.email !== undefined ? dados.email : atual.email;
  const telefone = dados.telefone !== undefined ? dados.telefone : atual.telefone;
  const contato = dados.contato !== undefined ? dados.contato : atual.contato;
  const observacoes = dados.observacoes !== undefined ? dados.observacoes : atual.observacoes;
  const codigoClienteOmie = dados.codigoClienteOmie !== undefined ? dados.codigoClienteOmie : atual.codigoClienteOmie;
  const canalPrincipal = dados.canalPrincipal !== undefined ? dados.canalPrincipal : atual.canalPrincipal;
  const urlPortal = dados.urlPortal !== undefined ? dados.urlPortal : atual.urlPortal;

  const pool = obterPool();
  const { rows } = await pool.query<LinhaTransportadora>(
    `UPDATE ${nomeTabelaTransportadoras()}
        SET nome_razao_social = $1, nome_fantasia = $2, cnpj = $3, email = $4, telefone = $5, contato = $6,
            observacoes = $7, codigo_cliente_omie = $8, canal_principal = $9, url_portal = $10, atualizado_em = now()
      WHERE id = $11
      RETURNING *`,
    [nomeRazaoSocial, nomeFantasia, cnpj, email, telefone, contato, observacoes, codigoClienteOmie, canalPrincipal, urlPortal, id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Transportadora não encontrada.');
  return linhaParaTransportadora(linha);
}

export async function definirAtivaTransportadora(id: string, ativo: boolean): Promise<Transportadora> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaTransportadora>(
    `UPDATE ${nomeTabelaTransportadoras()} SET ativo = $1, atualizado_em = now() WHERE id = $2 RETURNING *`,
    [ativo, id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Transportadora não encontrada.');
  return linhaParaTransportadora(linha);
}
