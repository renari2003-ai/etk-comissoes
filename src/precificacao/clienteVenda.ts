/**
 * Etapa 4 — cliente da venda: UF e contribuinte vêm do cadastro do Omie (só leitura), "cliente com
 * PTA" vem do app (decisão de 26/11/2026) e a finalidade da venda (industrialização, revenda ou uso e
 * consumo) é escolhida na tela. FUNÇÃO PURA.
 *
 * Nada é adivinhado: cliente não encontrado, sem UF, do exterior ou sem "contribuinte" no cadastro
 * dá tarja VERMELHA `CLIENTE_INCONSISTENTE` (corrigir o cadastro no Omie). As combinações
 * incoerentes de PTA/finalidade continuam sendo conferidas por `determinarCenario`.
 */

import type { ClienteFiscalOmie } from '../omie/cliente.js';
import type { Aviso } from './avisos.js';
import { UFS, type ClienteVenda, type Uf } from './calculo.js';

export type FinalidadeVenda = 'INDUSTRIALIZACAO' | 'REVENDA' | 'USO_CONSUMO';
export const FINALIDADES_VENDA: readonly FinalidadeVenda[] = ['INDUSTRIALIZACAO', 'REVENDA', 'USO_CONSUMO'];

function inconsistente(item: string, mensagem: string): Aviso {
  return { nivel: 'VERMELHO', codigo: 'CLIENTE_INCONSISTENTE', item, mensagem };
}

export function clienteParaVenda(
  codigoCliente: number,
  fiscal: ClienteFiscalOmie | null,
  clienteComPta: boolean,
  finalidade: FinalidadeVenda,
): { cliente: ClienteVenda | null; avisos: Aviso[] } {
  const item = String(codigoCliente);
  if (fiscal === null) return { cliente: null, avisos: [inconsistente(item, `Cliente ${codigoCliente} não encontrado no Omie.`)] };
  const nome = fiscal.razaoSocial === '' ? `Cliente ${codigoCliente}` : fiscal.razaoSocial;
  if (fiscal.uf === null || !(UFS as readonly string[]).includes(fiscal.uf)) {
    const motivo = fiscal.uf === 'EX' ? 'é do exterior (exportação não é tratada nesta tela)' : 'está sem UF no cadastro do Omie';
    return { cliente: null, avisos: [inconsistente(item, `${nome} ${motivo}. Corrija o cadastro do cliente no Omie.`)] };
  }
  if (fiscal.contribuinte === null) {
    return { cliente: null, avisos: [inconsistente(item, `${nome} está sem o campo "contribuinte" (S/N) no cadastro do Omie. Corrija o cadastro do cliente no Omie.`)] };
  }
  return {
    cliente: {
      uf: fiscal.uf as Uf,
      contribuinte: fiscal.contribuinte,
      usoConsumo: finalidade === 'USO_CONSUMO',
      clienteComPta,
      vendaParaIndustrializacao: finalidade === 'INDUSTRIALIZACAO',
    },
    avisos: [],
  };
}
