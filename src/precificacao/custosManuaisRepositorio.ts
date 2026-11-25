/**
 * Leitura e gravação dos custos manuais (etapa 3), com histórico campo a campo (data, usuário,
 * valor anterior e valor novo) de toda inclusão, alteração e remoção. Só toca as tabelas
 * `precificacao_custos_manuais*` do banco do app — NUNCA grava nada no Omie.
 *
 * Concorrência otimista: toda gravação manda a `versao` lida (`null` = item novo). Se outro
 * usuário salvou ou removeu nesse meio-tempo, responde 409 em vez de desfazer a alteração dele.
 * A remoção é LÓGICA (`removido = true`) e a versão continua subindo: uma nova inclusão do mesmo
 * código nunca volta para a versão 1, então uma tela aberta antes da remoção recebe 409.
 */

import type { PoolClient } from 'pg';
import { obterPool } from '../db.js';
import { ErroConflito } from '../validacao.js';
import type { Uf } from './calculo.js';
import type { CustoManual } from './custoManual.js';
import { numeroDoBanco } from './parametrosFiscaisRepositorio.js';
import { garantirEsquemaPrecificacao, nomeTabelaCustosManuais, nomeTabelaCustosManuaisHistorico } from './schema.js';

export interface CustoManualSalvo extends CustoManual {
  versao: number;
  atualizadoEm: string;
  atualizadoPor: string;
}

interface LinhaCusto {
  codigo: string;
  valor_nota: string | null;
  uf_fornecedor: string;
  diferimento_pta: boolean;
  mercadoria_importada: boolean;
  tipo_fornecedor: string;
  ipi_percentual: string | null;
  versao: number;
  removido: boolean;
  atualizado_em: Date;
  atualizado_por_nome: string;
}

function linhaParaCusto(l: LinhaCusto): CustoManualSalvo {
  return {
    codigo: l.codigo,
    valorNota: l.valor_nota === null ? null : numeroDoBanco(l.valor_nota, 'valor_nota'),
    ufFornecedor: l.uf_fornecedor.trim() as Uf,
    diferimentoPta: l.diferimento_pta,
    mercadoriaImportada: l.mercadoria_importada,
    tipoFornecedor: l.tipo_fornecedor as CustoManual['tipoFornecedor'],
    ipiPercentual: l.ipi_percentual === null ? null : numeroDoBanco(l.ipi_percentual, 'ipi_percentual'),
    versao: numeroDoBanco(l.versao, 'versao'),
    atualizadoEm: l.atualizado_em.toISOString(),
    atualizadoPor: l.atualizado_por_nome,
  };
}

/** Campo da API → coluna (ordem fixa: INSERT, UPDATE e histórico). */
const CAMPOS: ReadonlyArray<[Exclude<keyof CustoManual, 'codigo'>, string]> = [
  ['valorNota', 'valor_nota'],
  ['ufFornecedor', 'uf_fornecedor'],
  ['diferimentoPta', 'diferimento_pta'],
  ['mercadoriaImportada', 'mercadoria_importada'],
  ['tipoFornecedor', 'tipo_fornecedor'],
  ['ipiPercentual', 'ipi_percentual'],
];

export interface AlteracaoCusto {
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
}

/** Linha do histórico que marca a remoção (o resto das linhas da remoção traz os valores que havia). */
export const CAMPO_REGISTRO = 'registro';

const texto = (v: string | number | boolean | null): string | null => (v === null ? null : String(v));

/** Diferenças campo a campo (`atual = null`: inclusão; `novo = null`: remoção). */
export function diferencasCusto(atual: CustoManual | null, novo: CustoManual | null): AlteracaoCusto[] {
  const saida: AlteracaoCusto[] = [];
  for (const [campo] of CAMPOS) {
    const antes = atual === null ? null : atual[campo];
    const depois = novo === null ? null : novo[campo];
    if (atual !== null && novo !== null && antes === depois) continue;
    if (atual === null && depois === null) continue;
    if (novo === null && antes === null) continue;
    saida.push({ campo, valorAnterior: texto(antes), valorNovo: texto(depois) });
  }
  return saida;
}

/** Linha travada (FOR UPDATE), ativa ou removida — ou `null` se o código nunca foi salvo. */
async function lerComTrava(cliente: Pick<PoolClient, 'query'>, codigo: string): Promise<{ custo: CustoManualSalvo; removido: boolean } | null> {
  const { rows } = await cliente.query<LinhaCusto>(`SELECT * FROM ${nomeTabelaCustosManuais()} WHERE codigo = $1 FOR UPDATE`, [codigo]);
  const linha = rows[0];
  return linha === undefined ? null : { custo: linhaParaCusto(linha), removido: linha.removido };
}

async function registrarHistorico(cliente: Pick<PoolClient, 'query'>, codigo: string, alteracoes: AlteracaoCusto[], usuario: { id: string; nome: string }): Promise<void> {
  if (alteracoes.length === 0) return;
  await cliente.query(
    `INSERT INTO ${nomeTabelaCustosManuaisHistorico()} (usuario_id, usuario_nome, codigo, campo, valor_anterior, valor_novo)
     SELECT $1, $2, $3, * FROM UNNEST($4::text[], $5::text[], $6::text[])`,
    [usuario.id, usuario.nome, codigo, alteracoes.map((a) => a.campo), alteracoes.map((a) => a.valorAnterior), alteracoes.map((a) => a.valorNovo)],
  );
}

function quando(custo: CustoManualSalvo): string {
  return new Date(custo.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function conflitoAlterado(custo: CustoManualSalvo): ErroConflito {
  return new ErroConflito(`O custo manual de ${custo.codigo} foi alterado por ${custo.atualizadoPor} em ${quando(custo)} depois que você abriu a tela. Recarregue e refaça a sua alteração.`);
}

function conflitoRemovido(custo: CustoManualSalvo): ErroConflito {
  return new ErroConflito(`O custo manual de ${custo.codigo} foi removido por ${custo.atualizadoPor} em ${quando(custo)} depois que você abriu a tela. Recarregue a tela.`);
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

export async function listarCustosManuais(): Promise<CustoManualSalvo[]> {
  await garantirEsquemaPrecificacao();
  const { rows } = await obterPool().query<LinhaCusto>(`SELECT * FROM ${nomeTabelaCustosManuais()} WHERE NOT removido ORDER BY codigo`);
  return rows.map(linhaParaCusto);
}

/** Custos manuais salvos (ativos) dos códigos pedidos — códigos comparados em maiúsculas, como são gravados. */
export async function obterCustosManuais(codigos: readonly string[]): Promise<Map<string, CustoManualSalvo>> {
  await garantirEsquemaPrecificacao();
  const normalizados = [...new Set(codigos.map((c) => c.trim().toUpperCase()))];
  if (normalizados.length === 0) return new Map();
  const { rows } = await obterPool().query<LinhaCusto>(`SELECT * FROM ${nomeTabelaCustosManuais()} WHERE codigo = ANY($1::text[]) AND NOT removido`, [normalizados]);
  return new Map(rows.map((l) => [l.codigo, linhaParaCusto(l)]));
}

/** Inclui ou altera. Sem alteração, não grava nada (nem histórico). */
export async function salvarCustoManual(
  custo: CustoManual,
  versaoLida: number | null,
  usuario: { id: string; nome: string },
): Promise<{ custo: CustoManualSalvo; alteracoes: number }> {
  return emTransacao(async (cliente) => {
    const linha = await lerComTrava(cliente, custo.codigo);
    const ativo = linha !== null && !linha.removido ? linha.custo : null;
    if (versaoLida === null) {
      if (ativo !== null) throw new ErroConflito(`Já existe custo manual salvo para ${custo.codigo}. Use "Alterar" na tabela (ou recarregue a tela).`);
    } else if (linha === null) {
      throw new ErroConflito(`Não há custo manual salvo para ${custo.codigo}. Recarregue a tela.`);
    } else if (linha.removido) {
      throw conflitoRemovido(linha.custo);
    } else if (linha.custo.versao !== versaoLida) {
      throw conflitoAlterado(linha.custo);
    }

    const alteracoes = diferencasCusto(ativo, custo);
    if (ativo !== null && alteracoes.length === 0) return { custo: ativo, alteracoes: 0 };
    const valores = CAMPOS.map(([campo]) => custo[campo]);
    const n = CAMPOS.length;
    if (linha === null) {
      const { rowCount } = await cliente.query(
        `INSERT INTO ${nomeTabelaCustosManuais()} (codigo, ${CAMPOS.map(([, c]) => c).join(', ')}, atualizado_por_id, atualizado_por_nome)
         VALUES ($1, ${CAMPOS.map((_, i) => `$${i + 2}`).join(', ')}, $${n + 2}, $${n + 3})
         ON CONFLICT (codigo) DO NOTHING`,
        [custo.codigo, ...valores, usuario.id, usuario.nome],
      );
      // Outro usuário incluiu o mesmo código ao mesmo tempo: nunca sobrescreve em silêncio.
      if (rowCount === 0) throw new ErroConflito(`O custo manual de ${custo.codigo} acabou de ser incluído por outro usuário. Recarregue a tela.`);
    } else {
      // Alteração, ou nova inclusão de um código removido: a versão continua subindo.
      await cliente.query(
        `UPDATE ${nomeTabelaCustosManuais()} SET ${CAMPOS.map(([, c], i) => `${c} = $${i + 2}`).join(', ')},
           removido = false, versao = versao + 1, atualizado_em = now(), atualizado_por_id = $${n + 2}, atualizado_por_nome = $${n + 3}
         WHERE codigo = $1`,
        [custo.codigo, ...valores, usuario.id, usuario.nome],
      );
    }
    await registrarHistorico(cliente, custo.codigo, alteracoes, usuario);
    const salvo = await lerComTrava(cliente, custo.codigo);
    if (salvo === null) throw new Error(`Custo manual de ${custo.codigo} não encontrado logo após gravar.`);
    return { custo: salvo.custo, alteracoes: alteracoes.length };
  });
}

/** Remove (volta a valer o Omie), registrando no histórico o que havia. */
export async function removerCustoManual(codigo: string, versaoLida: number, usuario: { id: string; nome: string }): Promise<void> {
  await emTransacao(async (cliente) => {
    const linha = await lerComTrava(cliente, codigo);
    if (linha === null) throw new ErroConflito(`Não há custo manual salvo para ${codigo}. Recarregue a tela.`);
    if (linha.removido) throw conflitoRemovido(linha.custo);
    if (linha.custo.versao !== versaoLida) throw conflitoAlterado(linha.custo);
    await cliente.query(
      `UPDATE ${nomeTabelaCustosManuais()} SET removido = true, versao = versao + 1, atualizado_em = now(), atualizado_por_id = $2, atualizado_por_nome = $3 WHERE codigo = $1`,
      [codigo, usuario.id, usuario.nome],
    );
    await registrarHistorico(cliente, codigo, [{ campo: CAMPO_REGISTRO, valorAnterior: 'salvo', valorNovo: 'removido' }, ...diferencasCusto(linha.custo, null)], usuario);
  });
}

export interface RegistroHistoricoCusto extends AlteracaoCusto {
  alteradoEm: string;
  usuarioNome: string;
  codigo: string;
}

export async function listarHistoricoCustosManuais(codigo: string | null, limite: number): Promise<RegistroHistoricoCusto[]> {
  await garantirEsquemaPrecificacao();
  const { rows } = await obterPool().query<{ alterado_em: Date; usuario_nome: string; codigo: string; campo: string; valor_anterior: string | null; valor_novo: string | null }>(
    `SELECT alterado_em, usuario_nome, codigo, campo, valor_anterior, valor_novo FROM ${nomeTabelaCustosManuaisHistorico()}
     ${codigo === null ? '' : 'WHERE codigo = $2'} ORDER BY alterado_em DESC, id DESC LIMIT $1`,
    codigo === null ? [limite] : [limite, codigo],
  );
  return rows.map((r) => ({
    alteradoEm: r.alterado_em.toISOString(),
    usuarioNome: r.usuario_nome,
    codigo: r.codigo,
    campo: r.campo,
    valorAnterior: r.valor_anterior,
    valorNovo: r.valor_novo,
  }));
}
