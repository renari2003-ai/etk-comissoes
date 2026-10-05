import { afterEach, describe, expect, it, vi } from 'vitest';
import { indicaLimiteExcedido, OmieErroLimiteExcedido } from '../../src/omie/erros.js';
import { Limitador } from '../../src/omie/limitador.js';

vi.mock('../../src/db.js', () => ({ executarDdlIdempotente: vi.fn(), obterPool: vi.fn() }));
afterEach(() => vi.useRealTimers());

describe('bloqueio REDUNDANT da Omie', () => {
  it('reconhece código e mensagem, sem classificar erro de negócio como limite', () => {
    expect(indicaLimiteExcedido('REDUNDANT', undefined)).toBe(true);
    expect(indicaLimiteExcedido(undefined, 'ERROR: Consumo redundante detectado.')).toBe(true);
    expect(indicaLimiteExcedido('425', undefined)).toBe(true);
    expect(indicaLimiteExcedido('INVALID', 'Pedido não cadastrado')).toBe(false);
  });
  it('respeita a janela reiniciada de 60 segundos, mesmo quando a mensagem informa 53', () => {
    expect(new OmieErroLimiteExcedido('Aguarde 53 segundos (REDUNDANT).').esperaMinimaMs).toBe(61000);
    expect(new OmieErroLimiteExcedido('Consulta repetida', 'REDUNDANT').esperaMinimaMs).toBe(61000);
    expect(new OmieErroLimiteExcedido('Aguarde 1800 segundos.').esperaMinimaMs).toBe(1801000);
  });
  it('não repete durante o bloqueio e faz somente uma tentativa após a janela', async () => {
    vi.useFakeTimers();
    const limitador = new Limitador(0);
    vi.spyOn(limitador as unknown as { aguardarVez(): Promise<void> }, 'aguardarVez').mockResolvedValue();
    const fn = vi.fn().mockRejectedValueOnce(new OmieErroLimiteExcedido('Aguarde 53 segundos (REDUNDANT).')).mockResolvedValue('ok');
    const pendente = limitador.executar(fn);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pendente).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('encerra após um segundo bloqueio, sem insistir e prorrogar o contador', async () => {
    vi.useFakeTimers();
    const limitador = new Limitador(0);
    vi.spyOn(limitador as unknown as { aguardarVez(): Promise<void> }, 'aguardarVez').mockResolvedValue();
    const fn = vi.fn().mockRejectedValue(new OmieErroLimiteExcedido('REDUNDANT'));
    const verifica = expect(limitador.executar(fn)).rejects.toThrow('REDUNDANT');
    await vi.advanceTimersByTimeAsync(61000);
    await verifica;
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('não mantém a consulta esperando um bloqueio de 30 minutos', async () => {
    const limitador = new Limitador(0);
    vi.spyOn(limitador as unknown as { aguardarVez(): Promise<void> }, 'aguardarVez').mockResolvedValue();
    const fn = vi.fn().mockRejectedValue(new OmieErroLimiteExcedido('Aguarde 1800 segundos.'));
    await expect(limitador.executar(fn)).rejects.toThrow('1800');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
