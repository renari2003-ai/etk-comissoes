/**
 * Localização de transportadora na Omie para o cadastro (Ajuste Transportadoras). SOMENTE
 * LEITURA: só usa `ListarClientes`. CNPJ é o critério definitivo e tem prioridade sobre nome;
 * busca por nome nunca escolhe sozinha — devolve a lista para o usuário confirmar pelo CNPJ.
 * O `codigoClienteOmie` retornado é o vínculo técnico interno (a interface não o exibe).
 */
import { ErroValidacao } from '../validacao.js';
import { buscarTransportadoraPorCnpj } from './transportadorasRepositorio.js';

export interface ClienteBuscaOmieResultado {
  codigo: number;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpjCpf: string | null;
  email: string | null;
  telefone: string | null;
  contato: string | null;
}

export interface BuscadorClientesOmie {
  buscarClientes(filtro: { cnpj?: string; razaoSocial?: string; nomeFantasia?: string }): Promise<ClienteBuscaOmieResultado[]>;
}

export type CriterioBuscaOmie = 'CNPJ' | 'RAZAO_SOCIAL' | 'NOME_FANTASIA';

export interface ResultadoBuscaTransportadoraOmie {
  criterio: CriterioBuscaOmie | null;
  resultados: Array<
    ClienteBuscaOmieResultado & {
      /** Já existe no ETK com o mesmo CNPJ — o cadastro seria bloqueado como duplicidade. */
      jaCadastrada: { id: string; nomeRazaoSocial: string } | null;
    }
  >;
}

const TERMO_MINIMO = 3;

export async function servicoBuscarTransportadoraOmie(
  cliente: BuscadorClientesOmie,
  filtro: { cnpj: string | null; razaoSocial: string | null; nomeFantasia: string | null },
): Promise<ResultadoBuscaTransportadoraOmie> {
  const razao = (filtro.razaoSocial ?? '').trim();
  const fantasia = (filtro.nomeFantasia ?? '').trim();

  let criterio: CriterioBuscaOmie | null = null;
  let encontrados: ClienteBuscaOmieResultado[] = [];

  if (filtro.cnpj !== null) {
    criterio = 'CNPJ';
    encontrados = await cliente.buscarClientes({ cnpj: filtro.cnpj });
  } else {
    if (razao.length < TERMO_MINIMO && fantasia.length < TERMO_MINIMO) {
      throw new ErroValidacao(`Informe o CNPJ ou ao menos ${TERMO_MINIMO} letras da razão social ou do nome fantasia para buscar na Omie.`);
    }
    if (razao.length >= TERMO_MINIMO) {
      criterio = 'RAZAO_SOCIAL';
      encontrados = await cliente.buscarClientes({ razaoSocial: razao });
    }
    if (encontrados.length === 0 && fantasia.length >= TERMO_MINIMO) {
      criterio = 'NOME_FANTASIA';
      encontrados = await cliente.buscarClientes({ nomeFantasia: fantasia });
    }
  }

  const resultados = [];
  for (const c of encontrados) {
    const existente = c.cnpjCpf !== null ? await buscarTransportadoraPorCnpj(c.cnpjCpf) : null;
    resultados.push({ ...c, jaCadastrada: existente === null ? null : { id: existente.id, nomeRazaoSocial: existente.nomeRazaoSocial } });
  }
  return { criterio, resultados };
}
