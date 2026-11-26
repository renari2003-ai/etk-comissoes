import { describe, expect, it } from 'vitest';
import { indicaRegistroInexistente, OmieError, OmieErroLimiteExcedido, OmieErroMetodoEmExecucao, OmieErroTransitorio } from '../../src/omie/erros.js';

describe('indicaRegistroInexistente — só "não existe" de verdade (revisão de 26/11/2026)', () => {
  it('falha de negócio com texto de inexistência: sim', () => {
    for (const m of ['Não existem registros para a página [1]!', 'Cliente não cadastrado para o Código [1]', 'Produto não encontrado', 'Não há registros']) {
      expect(indicaRegistroInexistente(new OmieError(m))).toBe(true);
    }
  });
  it('HTTP 5xx, rede, limite, método em execução, erro qualquer: nunca', () => {
    expect(indicaRegistroInexistente(new OmieError('Erro HTTP 503 ao chamar ConsultarCliente'))).toBe(false);
    expect(indicaRegistroInexistente(new OmieErroTransitorio('Não existe conexão'))).toBe(false);
    expect(indicaRegistroInexistente(new OmieErroLimiteExcedido('Consumo redundante'))).toBe(false);
    expect(indicaRegistroInexistente(new OmieErroMetodoEmExecucao('Já existe uma requisição desse método'))).toBe(false);
    expect(indicaRegistroInexistente(new Error('não encontrado'))).toBe(false);
  });
});
