import { randomUUID } from 'node:crypto';
import { obterPool } from '../db.js';
import { ErroValidacao } from '../validacao.js';
import { garantirEsquemaFretes, nomeTabelaVeiculos } from './schema.js';
import type { Veiculo } from './tipos.js';

interface LinhaVeiculo {
  id: string;
  descricao: string;
  placa: string | null;
  tipo: string | null;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  capacidade_kg: string | null;
  capacidade_m3: string | null;
  ativo: boolean;
  observacoes: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

function numeroOuNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function linhaParaVeiculo(l: LinhaVeiculo): Veiculo {
  return {
    id: l.id,
    descricao: l.descricao,
    placa: l.placa,
    tipo: l.tipo,
    marca: l.marca,
    modelo: l.modelo,
    ano: l.ano,
    capacidadeKg: numeroOuNull(l.capacidade_kg),
    capacidadeM3: numeroOuNull(l.capacidade_m3),
    ativo: l.ativo,
    observacoes: l.observacoes,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

export interface DadosVeiculo {
  descricao: string;
  placa: string | null;
  tipo: string | null;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  capacidadeKg: number | null;
  capacidadeM3: number | null;
  observacoes: string | null;
}

export async function listarVeiculos(somenteAtivos: boolean): Promise<Veiculo[]> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const tabela = nomeTabelaVeiculos();
  const { rows } = somenteAtivos
    ? await pool.query<LinhaVeiculo>(`SELECT * FROM ${tabela} WHERE ativo = true ORDER BY descricao`)
    : await pool.query<LinhaVeiculo>(`SELECT * FROM ${tabela} ORDER BY descricao`);
  return rows.map(linhaParaVeiculo);
}

export async function buscarVeiculoPorId(id: string): Promise<Veiculo | null> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaVeiculo>(`SELECT * FROM ${nomeTabelaVeiculos()} WHERE id = $1`, [id]);
  const linha = rows[0];
  return linha === undefined ? null : linhaParaVeiculo(linha);
}

export async function criarVeiculo(dados: DadosVeiculo): Promise<Veiculo> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const id = randomUUID();
  const { rows } = await pool.query<LinhaVeiculo>(
    `INSERT INTO ${nomeTabelaVeiculos()}
       (id, descricao, placa, tipo, marca, modelo, ano, capacidade_kg, capacidade_m3, ativo, observacoes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
     RETURNING *`,
    [id, dados.descricao, dados.placa, dados.tipo, dados.marca, dados.modelo, dados.ano, dados.capacidadeKg, dados.capacidadeM3, dados.observacoes],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('Falha ao criar veículo.');
  return linhaParaVeiculo(linha);
}

export async function atualizarVeiculo(id: string, dados: Partial<DadosVeiculo>): Promise<Veiculo> {
  await garantirEsquemaFretes();
  const atual = await buscarVeiculoPorId(id);
  if (atual === null) throw new ErroValidacao('Veículo não encontrado.');

  const descricao = dados.descricao ?? atual.descricao;
  const placa = dados.placa !== undefined ? dados.placa : atual.placa;
  const tipo = dados.tipo !== undefined ? dados.tipo : atual.tipo;
  const marca = dados.marca !== undefined ? dados.marca : atual.marca;
  const modelo = dados.modelo !== undefined ? dados.modelo : atual.modelo;
  const ano = dados.ano !== undefined ? dados.ano : atual.ano;
  const capacidadeKg = dados.capacidadeKg !== undefined ? dados.capacidadeKg : atual.capacidadeKg;
  const capacidadeM3 = dados.capacidadeM3 !== undefined ? dados.capacidadeM3 : atual.capacidadeM3;
  const observacoes = dados.observacoes !== undefined ? dados.observacoes : atual.observacoes;

  const pool = obterPool();
  const { rows } = await pool.query<LinhaVeiculo>(
    `UPDATE ${nomeTabelaVeiculos()}
        SET descricao = $1, placa = $2, tipo = $3, marca = $4, modelo = $5, ano = $6,
            capacidade_kg = $7, capacidade_m3 = $8, observacoes = $9, atualizado_em = now()
      WHERE id = $10
      RETURNING *`,
    [descricao, placa, tipo, marca, modelo, ano, capacidadeKg, capacidadeM3, observacoes, id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Veículo não encontrado.');
  return linhaParaVeiculo(linha);
}

export async function definirAtivoVeiculo(id: string, ativo: boolean): Promise<Veiculo> {
  await garantirEsquemaFretes();
  const pool = obterPool();
  const { rows } = await pool.query<LinhaVeiculo>(
    `UPDATE ${nomeTabelaVeiculos()} SET ativo = $1, atualizado_em = now() WHERE id = $2 RETURNING *`,
    [ativo, id],
  );
  const linha = rows[0];
  if (linha === undefined) throw new ErroValidacao('Veículo não encontrado.');
  return linhaParaVeiculo(linha);
}
