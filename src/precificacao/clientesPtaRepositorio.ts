/**
 * "Cliente com PTA (compra para industrialização)" marcado no app (decisão de 26/11/2026), com
 * histórico (data, usuário, campo, valor anterior e novo) e concorrência otimista pela `versao`
 * (409 se outro administrador salvou antes). Só toca as tabelas `precificacao_clientes_pta*` —
 * NUNCA grava nada no Omie. Desmarcar é gravar `comPta = false` (a linha fica, com a versão).
 */

import type { PoolClient } from 'pg';
import { obterPool } from '../db.js';
import { ErroConflito } from '../validacao.js';
import type { ClientePta } from './clientesPta.js';
import { numeroDoBanco } from './parametrosFiscaisRepositorio.js';
import { garantirEsquemaPrecificacao, nomeTabelaClientesPta, nomeTabelaClientesPtaHistorico } from './schema.js';

export interface ClientePtaSalvo extends ClientePta {
  versao: number;
  atualizadoEm: string;
  atualizadoPor: string;
}

interface LinhaClientePta {
  codigo_cliente: string | number;
  com_pta: boolean;
  nome_cliente: string;
  cnpj_cpf: string | null;
  versao: number;
  atualizado_em: Date;
  atualizado_por_nome: string;
}

function linhaParaCliente(l: LinhaClientePta): ClientePtaSalvo {
  return {
    codigoCliente: numeroDoBanco(l.codigo_cliente, 'codigo_cliente'),
    comPta: l.com_pta,
    nomeCliente: l.nome_cliente,
    cnpjCpf: l.cnpj_cpf,
    versao: numeroDoBanco(l.versao, 'versao'),
    atualizadoEm: l.atualizado_em.toISOString(),
    atualizadoPor: l.atualizado_por_nome,
  };
}

export interface AlteracaoClientePta {
  campo: 'comPta' | 'nomeCliente' | 'cnpjCpf';
  valorAnterior: string | null;
  valorNovo: string | null;
}

const texto = (v: string | boolean | null): string | null => (v === null ? null : String(v));

/** Diferenças campo a campo (`atual = null`: primeira gravação do cliente). */
export function diferencasClientePta(atual: ClientePta | null, novo: ClientePta): AlteracaoClientePta[] {
  const saida: AlteracaoClientePta[] = [];
  for (const campo of ['comPta', 'nomeCliente', 'cnpjCpf'] as const) {
    const antes = atual === null ? null : atual[campo];
    if (atual !== null && antes === novo[campo]) continue;
    if (atual === null && novo[campo] === null) continue;
    saida.push({ campo, valorAnterior: texto(antes), valorNovo: texto(novo[campo]) });
  }
  return saida;
}

async function emTransacao<T>(fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  await garantirEsquemaPrecificacao();
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

async function lerComTrava(cliente: Pick<PoolClient, 'query'>, codigo: number): Promise<ClientePtaSalvo | null> {
  const { rows } = await cliente.query<LinhaClientePta>(`SELECT * FROM ${nomeTabelaClientesPta()} WHERE codigo_cliente = $1 FOR UPDATE`, [codigo]);
  return rows[0] === undefined ? null : linhaParaCliente(rows[0]);
}

/** Clientes marcados COM PTA (a lista da tela). */
export async function listarClientesComPta(): Promise<ClientePtaSalvo[]> {
  await garantirEsquemaPrecificacao();
  const { rows } = await obterPool().query<LinhaClientePta>(`SELECT * FROM ${nomeTabelaClientesPta()} WHERE com_pta ORDER BY nome_cliente, codigo_cliente`);
  return rows.map(linhaParaCliente);
}

/** Situação de um cliente no app (`null` = nunca marcado: sem PTA). Usado pelo cálculo e pela tela. */
export async function obterClientePta(codigo: number): Promise<ClientePtaSalvo | null> {
  await garantirEsquemaPrecificacao();
  const { rows } = await obterPool().query<LinhaClientePta>(`SELECT * FROM ${nomeTabelaClientesPta()} WHERE codigo_cliente = $1`, [codigo]);
  return rows[0] === undefined ? null : linhaParaCliente(rows[0]);
}

/** Situação no app de vários clientes de uma vez (a busca mostra quais já estão marcados). */
export async function obterClientesPta(codigos: readonly number[]): Promise<Map<number, ClientePtaSalvo>> {
  await garantirEsquemaPrecificacao();
  if (codigos.length === 0) return new Map();
  const { rows } = await obterPool().query<LinhaClientePta>(`SELECT * FROM ${nomeTabelaClientesPta()} WHERE codigo_cliente = ANY($1::bigint[])`, [[...new Set(codigos)]]);
  return new Map(rows.map((l) => {
    const c = linhaParaCliente(l);
    return [c.codigoCliente, c];
  }));
}

/** Marca ou desmarca. Sem alteração, não grava nada (nem histórico). */
export async function salvarClientePta(
  novo: ClientePta,
  versaoLida: number | null,
  usuario: { id: string; nome: string },
): Promise<{ cliente: ClientePtaSalvo; alteracoes: number }> {
  return emTransacao(async (cliente) => {
    const atual = await lerComTrava(cliente, novo.codigoCliente);
    if (versaoLida === null && atual !== null) {
      throw new ErroConflito(`O cliente ${atual.nomeCliente} já foi marcado no app por ${atual.atualizadoPor}. Recarregue a tela.`);
    }
    if (versaoLida !== null && atual === null) throw new ErroConflito('Este cliente não está gravado no app. Recarregue a tela.');
    if (atual !== null && atual.versao !== versaoLida) {
      const quando = new Date(atual.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      throw new ErroConflito(`O cliente ${atual.nomeCliente} foi alterado por ${atual.atualizadoPor} em ${quando} depois que você abriu a tela. Recarregue e refaça a sua alteração.`);
    }
    const alteracoes = diferencasClientePta(atual, novo);
    if (atual !== null && alteracoes.length === 0) return { cliente: atual, alteracoes: 0 };
    if (atual === null) {
      const { rowCount } = await cliente.query(
        `INSERT INTO ${nomeTabelaClientesPta()} (codigo_cliente, com_pta, nome_cliente, cnpj_cpf, atualizado_por_id, atualizado_por_nome)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (codigo_cliente) DO NOTHING`,
        [novo.codigoCliente, novo.comPta, novo.nomeCliente, novo.cnpjCpf, usuario.id, usuario.nome],
      );
      if (rowCount === 0) throw new ErroConflito('Este cliente acabou de ser marcado por outro usuário. Recarregue a tela.');
    } else {
      await cliente.query(
        `UPDATE ${nomeTabelaClientesPta()} SET com_pta = $2, nome_cliente = $3, cnpj_cpf = $4, versao = versao + 1,
           atualizado_em = now(), atualizado_por_id = $5, atualizado_por_nome = $6 WHERE codigo_cliente = $1`,
        [novo.codigoCliente, novo.comPta, novo.nomeCliente, novo.cnpjCpf, usuario.id, usuario.nome],
      );
    }
    await cliente.query(
      `INSERT INTO ${nomeTabelaClientesPtaHistorico()} (usuario_id, usuario_nome, codigo_cliente, campo, valor_anterior, valor_novo)
       SELECT $1, $2, $3, * FROM UNNEST($4::text[], $5::text[], $6::text[])`,
      [usuario.id, usuario.nome, novo.codigoCliente, alteracoes.map((a) => a.campo), alteracoes.map((a) => a.valorAnterior), alteracoes.map((a) => a.valorNovo)],
    );
    const salvo = await lerComTrava(cliente, novo.codigoCliente);
    if (salvo === null) throw new Error('Cliente com PTA não encontrado logo após gravar.');
    return { cliente: salvo, alteracoes: alteracoes.length };
  });
}

export interface RegistroHistoricoClientePta {
  alteradoEm: string;
  usuarioNome: string;
  codigoCliente: number;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
}

export async function listarHistoricoClientesPta(codigo: number | null, limite: number): Promise<RegistroHistoricoClientePta[]> {
  await garantirEsquemaPrecificacao();
  const { rows } = await obterPool().query<{ alterado_em: Date; usuario_nome: string; codigo_cliente: string | number; campo: string; valor_anterior: string | null; valor_novo: string | null }>(
    `SELECT alterado_em, usuario_nome, codigo_cliente, campo, valor_anterior, valor_novo FROM ${nomeTabelaClientesPtaHistorico()}
     ${codigo === null ? '' : 'WHERE codigo_cliente = $2'} ORDER BY alterado_em DESC, id DESC LIMIT $1`,
    codigo === null ? [limite] : [limite, codigo],
  );
  return rows.map((r) => ({
    alteradoEm: r.alterado_em.toISOString(),
    usuarioNome: r.usuario_nome,
    codigoCliente: numeroDoBanco(r.codigo_cliente, 'codigo_cliente'),
    campo: r.campo,
    valorAnterior: r.valor_anterior,
    valorNovo: r.valor_novo,
  }));
}
