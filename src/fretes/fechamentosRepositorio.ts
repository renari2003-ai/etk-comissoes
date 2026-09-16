import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { obterPool } from '../db.js';
import { nomeTabelaFechamentos } from './schema.js';
import type { FechamentoFrete, ModalidadeExecucao, ModoCalculoFechamento } from './tipos.js';

interface LinhaFechamento {
  id: string;
  cotacao_id: string;
  modalidade_execucao: ModalidadeExecucao;
  proposta_id: string | null;
  transportadora_id: string | null;
  veiculo_id: string | null;
  motorista_nome: string | null;
  custo_frete: string;
  percentual_acrescimo: string;
  valor_acrescimo: string;
  valor_frete_cliente: string;
  modo_calculo: ModoCalculoFechamento;
  usuario_fechamento: string;
  observacoes: string | null;
  criado_em: Date;
}

function linhaParaFechamento(l: LinhaFechamento): FechamentoFrete {
  return {
    id: l.id,
    cotacaoId: l.cotacao_id,
    modalidadeExecucao: l.modalidade_execucao,
    propostaId: l.proposta_id,
    transportadoraId: l.transportadora_id,
    veiculoId: l.veiculo_id,
    motoristaNome: l.motorista_nome,
    custoFrete: Number(l.custo_frete),
    percentualAcrescimo: Number(l.percentual_acrescimo),
    valorAcrescimo: Number(l.valor_acrescimo),
    valorFreteCliente: Number(l.valor_frete_cliente),
    modoCalculo: l.modo_calculo,
    usuarioFechamento: l.usuario_fechamento,
    observacoes: l.observacoes,
    criadoEm: l.criado_em.toISOString(),
  };
}

export interface DadosNovoFechamento {
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
}

/**
 * Sempre chamado de dentro da transação de `fretesServico.fecharCotacao` (nunca cria a
 * própria transação) — a constraint `UNIQUE (cotacao_id)` da tabela (ver `schema.ts`)
 * garante, em nível de banco, que uma segunda tentativa concorrente de fechar a mesma
 * cotação falha em vez de criar um segundo fechamento (seção 35/36).
 */
export async function inserirFechamento(cliente: PoolClient, dados: DadosNovoFechamento): Promise<FechamentoFrete> {
  const id = randomUUID();
  const { rows } = await cliente.query<LinhaFechamento>(
    `INSERT INTO ${nomeTabelaFechamentos()}
       (id, cotacao_id, modalidade_execucao, proposta_id, transportadora_id, veiculo_id, motorista_nome,
        custo_frete, percentual_acrescimo, valor_acrescimo, valor_frete_cliente, modo_calculo,
        usuario_fechamento, observacoes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      id,
      dados.cotacaoId,
      dados.modalidadeExecucao,
      dados.propostaId,
      dados.transportadoraId,
      dados.veiculoId,
      dados.motoristaNome,
      dados.custoFrete,
      dados.percentualAcrescimo,
      dados.valorAcrescimo,
      dados.valorFreteCliente,
      dados.modoCalculo,
      dados.usuarioFechamento,
      dados.observacoes,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao registrar fechamento.');
  return linhaParaFechamento(linha);
}

export async function buscarFechamentoPorCotacao(cotacaoId: string): Promise<FechamentoFrete | null> {
  const pool = obterPool();
  const { rows } = await pool.query<LinhaFechamento>(`SELECT * FROM ${nomeTabelaFechamentos()} WHERE cotacao_id = $1`, [cotacaoId]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaFechamento(linha);
}

export interface ResumoFechamentos {
  quantidade: number;
  custoTotal: number;
  valorClienteTotal: number;
  acrescimoTotal: number;
}

/** Agregados usados pelo dashboard (seção 20) — deriva exclusivamente de dados do módulo Fretes, nunca de comissão/margem/Omie. */
export async function resumirFechamentos(): Promise<ResumoFechamentos> {
  const pool = obterPool();
  const { rows } = await pool.query<{ quantidade: string; custo_total: string | null; cliente_total: string | null; acrescimo_total: string | null }>(
    `SELECT COUNT(*)::text AS quantidade,
            COALESCE(SUM(custo_frete), 0)::text AS custo_total,
            COALESCE(SUM(valor_frete_cliente), 0)::text AS cliente_total,
            COALESCE(SUM(valor_acrescimo), 0)::text AS acrescimo_total
       FROM ${nomeTabelaFechamentos()}`,
  );
  const linha = rows[0];
  return {
    quantidade: Number(linha?.quantidade ?? '0'),
    custoTotal: Number(linha?.custo_total ?? '0'),
    valorClienteTotal: Number(linha?.cliente_total ?? '0'),
    acrescimoTotal: Number(linha?.acrescimo_total ?? '0'),
  };
}

/** Fechamentos agrupados por modalidade de execução (seção 19: "Total de fretes com transportadora/veículo próprio/retira") — só dados do próprio módulo. */
export async function resumirFechamentosPorModalidade(): Promise<Record<ModalidadeExecucao, ResumoFechamentos>> {
  const pool = obterPool();
  const { rows } = await pool.query<{
    modalidade_execucao: ModalidadeExecucao;
    quantidade: string;
    custo_total: string | null;
    cliente_total: string | null;
    acrescimo_total: string | null;
  }>(
    `SELECT modalidade_execucao,
            COUNT(*)::text AS quantidade,
            COALESCE(SUM(custo_frete), 0)::text AS custo_total,
            COALESCE(SUM(valor_frete_cliente), 0)::text AS cliente_total,
            COALESCE(SUM(valor_acrescimo), 0)::text AS acrescimo_total
       FROM ${nomeTabelaFechamentos()}
      GROUP BY modalidade_execucao`,
  );
  const vazio = (): ResumoFechamentos => ({ quantidade: 0, custoTotal: 0, valorClienteTotal: 0, acrescimoTotal: 0 });
  const resultado: Record<ModalidadeExecucao, ResumoFechamentos> = {
    TRANSPORTADORA: vazio(),
    VEICULO_PROPRIO: vazio(),
    RETIRA: vazio(),
  };
  for (const linha of rows) {
    resultado[linha.modalidade_execucao] = {
      quantidade: Number(linha.quantidade),
      custoTotal: Number(linha.custo_total ?? '0'),
      valorClienteTotal: Number(linha.cliente_total ?? '0'),
      acrescimoTotal: Number(linha.acrescimo_total ?? '0'),
    };
  }
  return resultado;
}
