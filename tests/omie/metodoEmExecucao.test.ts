import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  indicaLimiteExcedido,
  indicaMetodoEmExecucao,
  OmieErroLimiteExcedido,
  OmieErroMetodoEmExecucao,
  OmieErroTransitorio,
} from '../../src/omie/erros.js';
import { ESPERAS_METODO_EM_EXECUCAO_MS, LIMITE_ESPERA_METODO_EM_EXECUCAO_MS, Limitador } from '../../src/omie/limitador.js';

vi.mock('../../src/db.js', () => ({ executarDdlIdempotente: vi.fn(), obterPool: vi.fn() }));
afterEach(() => vi.useRealTimers());

/** Resposta real da Omie em 2026-10-06 (HTTP 500), `ListarContasReceber` com `filtrar_por_vendedor`. */
const FAULTCODE_REAL = 'SOAP-ENV:Client-1880';
const FAULTSTRING_REAL = 'ERROR: Já existe uma requisição desse método sendo executada e você pode tentar novamente em alguns instantes. (1)';
const erro1880 = () => new OmieErroMetodoEmExecucao(`${FAULTSTRING_REAL} [ListarContasReceber]`, FAULTCODE_REAL);

function limitadorSemFila(): Limitador {
  const limitador = new Limitador(0);
  vi.spyOn(limitador as unknown as { aguardarVez(): Promise<void> }, 'aguardarVez').mockResolvedValue();
  return limitador;
}

describe('Client-1880 "já existe uma requisição desse método sendo executada" — classificação', () => {
  it('reconhece o código e a mensagem reais, sem confundir com REDUNDANT nem com erro de negócio', () => {
    expect(indicaMetodoEmExecucao(FAULTCODE_REAL, FAULTSTRING_REAL)).toBe(true);
    expect(indicaMetodoEmExecucao(undefined, FAULTSTRING_REAL)).toBe(true);
    expect(indicaMetodoEmExecucao(FAULTCODE_REAL, undefined)).toBe(true);
    expect(indicaLimiteExcedido(FAULTCODE_REAL, FAULTSTRING_REAL)).toBe(false);
    expect(indicaMetodoEmExecucao('SOAP-ENV:Client-6', 'ERROR: Consumo redundante detectado. Aguarde 16 segundos para tentar novamente (REDUNDANT).')).toBe(false);
    expect(indicaMetodoEmExecucao('SOAP-ENV:Client-18800', 'Pedido não cadastrado')).toBe(false);
  });

  it('esperas progressivas dentro do teto de duração', () => {
    expect([...ESPERAS_METODO_EM_EXECUCAO_MS]).toEqual([10_000, 61_000]);
    expect(ESPERAS_METODO_EM_EXECUCAO_MS.reduce((s, e) => s + e, 0)).toBeLessThanOrEqual(LIMITE_ESPERA_METODO_EM_EXECUCAO_MS);
  });
});

describe('Limitador — retry de Client-1880', () => {
  it('recupera na 2ª tentativa, após 10 s (nunca antes)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(erro1880()).mockResolvedValue('ok');
    const pendente = limitadorSemFila().executar(fn);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pendente).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('recupera na 3ª tentativa, 61 s depois da 2ª (fora da janela REDUNDANT)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(erro1880()).mockRejectedValueOnce(erro1880()).mockResolvedValue('ok');
    const pendente = limitadorSemFila().executar(fn);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pendente).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('falha persistente: no máximo 3 chamadas em ~71 s e erro claro (nunca resultado parcial)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(erro1880());
    const verificacao = expect(limitadorSemFila().executar(fn)).rejects.toThrow(
      /continuou recusando a consulta .* após 3 tentativas em 71 s\. Nenhum valor foi calculado com dados incompletos.*\[ListarContasReceber\]/,
    );
    await vi.advanceTimersByTimeAsync(71_000);
    await verificacao;
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fn).toHaveBeenCalledTimes(3); // não insiste depois de desistir
  });

  it('o erro final continua sendo OmieErroMetodoEmExecucao (vira HTTP 502 com o motivo)', async () => {
    vi.useFakeTimers();
    const pendente = limitadorSemFila().executar(vi.fn().mockRejectedValue(erro1880())).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(71_000);
    const erro = await pendente;
    expect(erro).toBeInstanceOf(OmieErroMetodoEmExecucao);
    expect((erro as OmieErroMetodoEmExecucao).faultcode).toBe(FAULTCODE_REAL);
  });

  it('REDUNDANT depois de um 1880 encerra na hora (não ganha mais 61 s além do teto)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(erro1880()).mockRejectedValue(new OmieErroLimiteExcedido('ERROR: Consumo redundante detectado. Aguarde 16 segundos para tentar novamente (REDUNDANT).', 'SOAP-ENV:Client-6'));
    const verificacao = expect(limitadorSemFila().executar(fn)).rejects.toThrow('REDUNDANT');
    await vi.advanceTimersByTimeAsync(10_000);
    await verificacao;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('não altera as políticas existentes: transitório continua com 3 tentativas curtas', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new OmieErroTransitorio('Falha de rede ao chamar X'));
    const verificacao = expect(limitadorSemFila().executar(fn)).rejects.toThrow('Falha de rede');
    await vi.advanceTimersByTimeAsync(1_500);
    await verificacao;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
