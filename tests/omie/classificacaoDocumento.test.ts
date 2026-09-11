import { describe, expect, it } from 'vitest';
import { classificarEtapa, type EtapaFaturamento } from '../../src/omie/classificacaoDocumento.js';

const ETAPAS_CONTA_COM_ROTULOS_PADRONIZADOS: EtapaFaturamento[] = [
  { codigo: '00', descricaoPadrao: 'Proposta', descricao: 'Orçamento', inativa: false },
  { codigo: '10', descricaoPadrao: 'Pedido de Venda', descricao: 'Pedido de Venda', inativa: false },
  { codigo: '60', descricaoPadrao: 'Faturado', descricao: 'Faturado', inativa: false },
];

/**
 * Reflete a conta real usada em desenvolvimento (verificado em 2026-09-04):
 * tanto a etapa "00" quanto a "10" estão rotuladas "Orçamento" — prova de
 * que um código de etapa fixo não seria confiável.
 */
const ETAPAS_CONTA_COM_ROTULOS_CUSTOMIZADOS: EtapaFaturamento[] = [
  { codigo: '00', descricaoPadrao: 'Proposta', descricao: 'Orçamento', inativa: true },
  { codigo: '10', descricaoPadrao: 'Pedido de Venda', descricao: 'Orçamento', inativa: false },
  { codigo: '20', descricaoPadrao: 'Separar Estoque', descricao: 'Pedido de Venda', inativa: false },
  { codigo: '60', descricaoPadrao: 'Faturado', descricao: 'Faturado', inativa: false },
];

describe('classificarEtapa', () => {
  it('classifica como ORCAMENTO uma etapa cuja descrição contém "orçamento"', () => {
    const resultado = classificarEtapa('00', ETAPAS_CONTA_COM_ROTULOS_PADRONIZADOS);
    expect(resultado).toEqual({ tipo: 'ORCAMENTO', ambiguo: false, rotulo: 'Orçamento' });
  });

  it('classifica como PEDIDO uma etapa cuja descrição não contém "orçamento"', () => {
    const resultado = classificarEtapa('10', ETAPAS_CONTA_COM_ROTULOS_PADRONIZADOS);
    expect(resultado).toEqual({ tipo: 'PEDIDO', ambiguo: false, rotulo: 'Pedido de Venda' });
  });

  it('retorna ambíguo (nunca adivinha) para uma etapa fora da configuração da conta', () => {
    const resultado = classificarEtapa('99', ETAPAS_CONTA_COM_ROTULOS_PADRONIZADOS);
    expect(resultado.ambiguo).toBe(true);
    expect(resultado.tipo).toBeNull();
    if (resultado.ambiguo) {
      expect(resultado.motivo).toContain('99');
    }
  });

  it('não usa um código de etapa fixo: respeita rótulos customizados por conta, mesmo quando "10" é Orçamento', () => {
    // Nesta conta, diferente da documentação genérica da Omie (que sugere
    // etapa "00" fixo para orçamento), a etapa "10" ativa também é Orçamento.
    expect(classificarEtapa('00', ETAPAS_CONTA_COM_ROTULOS_CUSTOMIZADOS)).toEqual({
      tipo: 'ORCAMENTO',
      ambiguo: false,
      rotulo: 'Orçamento',
    });
    expect(classificarEtapa('10', ETAPAS_CONTA_COM_ROTULOS_CUSTOMIZADOS)).toEqual({
      tipo: 'ORCAMENTO',
      ambiguo: false,
      rotulo: 'Orçamento',
    });
    expect(classificarEtapa('20', ETAPAS_CONTA_COM_ROTULOS_CUSTOMIZADOS)).toEqual({
      tipo: 'PEDIDO',
      ambiguo: false,
      rotulo: 'Pedido de Venda',
    });
  });

  it('classifica como PEDIDO uma etapa "Faturado" (compra concreta e já concluída)', () => {
    expect(classificarEtapa('60', ETAPAS_CONTA_COM_ROTULOS_PADRONIZADOS)).toEqual({
      tipo: 'PEDIDO',
      ambiguo: false,
      rotulo: 'Faturado',
    });
  });
});
