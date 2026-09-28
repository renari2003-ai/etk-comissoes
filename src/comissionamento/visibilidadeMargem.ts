import type { UsuarioPublico } from '../auth/tipos.js';
import type { LinhaComissionamento } from './relatorioComissionamento.js';

/**
 * Visibilidade da margem no relatório de Comissionamento (regra de 2026-09-28): só o papel
 * "administrador" recebe a margem. Para qualquer outro papel (usuario/vendedor/convidado), o
 * servidor remove do payload a margem de comissionamento e todo campo que permitiria recompô-la
 * por conta própria (despesas, resultado após despesas e a métrica de custo/margem de venda) — a
 * decisão é sempre do backend, a partir do usuário autenticado, nunca de parâmetro do navegador.
 *
 * O cálculo em si (`gerarRelatorioComissionamento`) continua idêntico e usa esses valores
 * internamente; aqui só se decide o que sai para o cliente. Comissão, parcelas, valor da venda
 * e base da comissão nunca são tocados.
 */
export const CAMPOS_MARGEM_RESTRITOS = [
  'margemComissionamentoPercentual',
  'resultadoAposDespesas',
  'despesasIPI',
  'despesasIcmsSt',
  'despesasFreteSeguroOutras',
  'despesasTotal',
  'valorIPI',
  'valorIcmsSt',
  'valorFrete',
  'valorSeguro',
  'outrasDespesasFrete',
  'custoTotal',
  'margemTotal',
  'margemVendaPercentual',
  'markupCustoPercentual',
] as const satisfies ReadonlyArray<keyof LinhaComissionamento>;

type CampoMargemRestrito = (typeof CAMPOS_MARGEM_RESTRITOS)[number];

export type LinhaComissionamentoSemMargem = Omit<LinhaComissionamento, CampoMargemRestrito>;

export function podeVerMargemComissionamento(usuario: UsuarioPublico): boolean {
  return usuario.papel === 'administrador';
}

export function ocultarMargem(linha: LinhaComissionamento): LinhaComissionamentoSemMargem {
  const copia: Partial<LinhaComissionamento> = { ...linha };
  for (const campo of CAMPOS_MARGEM_RESTRITOS) delete copia[campo];
  return copia as LinhaComissionamentoSemMargem;
}
