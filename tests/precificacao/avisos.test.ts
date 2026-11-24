import { describe, expect, it } from 'vitest';
import { ErroPrecificacao, ordenarAvisos, precoBloqueado, precoIncompleto, type Aviso } from '../../src/precificacao/avisos.js';
import { ErroValidacao } from '../../src/validacao.js';

const azul: Aviso = { nivel: 'AZUL', codigo: 'DIFAL_BASE_SIMPLES', item: null, mensagem: 'a' };
const amarelo1: Aviso = { nivel: 'AMARELO', codigo: 'ITEM_SEM_CUSTO', item: 'X', mensagem: 'b' };
const amarelo2: Aviso = { nivel: 'AMARELO', codigo: 'GGF_AUSENTE', item: 'GGF', mensagem: 'c' };
const vermelho: Aviso = { nivel: 'VERMELHO', codigo: 'PRODUTO_SEM_ESTRUTURA', item: 'PA1', mensagem: 'd' };
const alvo: Aviso = { nivel: 'VERMELHO', codigo: 'ALVO_ABAIXO_DO_PISO', item: null, mensagem: 'e' };

describe('avisos (tarjas)', () => {
  it('ordena vermelho → amarelo → azul, estável dentro do mesmo nível', () => {
    expect(ordenarAvisos([azul, amarelo1, vermelho, amarelo2])).toEqual([vermelho, amarelo1, amarelo2, azul]);
  });

  it('vermelho bloqueia o preço; o vermelho do modo reverso (alvo abaixo do piso) não bloqueia o preço principal', () => {
    expect(precoBloqueado([azul, vermelho])).toBe(true);
    expect(precoBloqueado([alvo, azul])).toBe(false);
    expect(precoBloqueado([amarelo1])).toBe(false);
  });

  it('amarelo marca o preço como incompleto; azul sozinho não', () => {
    expect(precoIncompleto([azul, amarelo2])).toBe(true);
    expect(precoIncompleto([azul])).toBe(false);
  });

  it('ErroPrecificacao é um ErroValidacao (400 na API) que carrega a tarja vermelha', () => {
    const erro = new ErroPrecificacao('OMIE_INDISPONIVEL', null, 'Não foi possível consultar o Omie. Tente de novo em alguns minutos.');
    expect(erro).toBeInstanceOf(ErroValidacao);
    expect(erro.message).toBe('Não foi possível consultar o Omie. Tente de novo em alguns minutos.');
    expect(erro.aviso).toEqual({ nivel: 'VERMELHO', codigo: 'OMIE_INDISPONIVEL', item: null, mensagem: erro.message });
  });
});
