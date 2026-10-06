import { executarDdlIdempotente, obterPool } from '../db.js';
import { OmieErroLimiteExcedido, OmieErroMetodoEmExecucao, OmieErroTransitorio } from './erros.js';

const MAX_TENTATIVAS = 3;
const ESPERAS_BACKOFF_MS = [500, 1000, 2000];

/**
 * "Método em execução" (Client-1880, ver `OmieErroMetodoEmExecucao`): esperas progressivas medidas
 * contra a API real em 2026-10-06 — 10 s (a 2ª consulta idêntica ainda não vira REDUNDANT) e depois
 * 61 s (fora da janela de 60 s em que a 3ª consulta idêntica vira REDUNDANT). No máximo 3 chamadas
 * e ~71 s de espera por consulta; esgotado, o erro sobe (nunca devolve dado parcial).
 */
export const ESPERAS_METODO_EM_EXECUCAO_MS = [10_000, 61_000] as const;
export const LIMITE_ESPERA_METODO_EM_EXECUCAO_MS = 75_000;

/** Nome da tabela — só sobrescrito nos testes (`LIMITADOR_TABELA`). Nunca vem de entrada do usuário, mas validado porque entra por interpolação direta no SQL. */
function nomeTabela(): string {
  const nome = process.env.LIMITADOR_TABELA ?? 'omie_limitador';
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Nome de tabela inválido: "${nome}"`);
  return nome;
}

/**
 * Serializa as chamadas à Omie garantindo um intervalo mínimo entre o início
 * de cada requisição, mesmo sob concorrência — via uma linha única no
 * Postgres travada com `SELECT ... FOR UPDATE` (regra de 2026-09-11:
 * hospedagem em Vercel, onde cada invocação serverless é um processo
 * isolado; a fila em memória baseada numa cadeia de Promises não sobrevivia
 * entre invocações, então duas requisições concorrentes em instâncias
 * diferentes podiam disparar pra Omie ao mesmo tempo, sem respeitar o
 * espaçamento — foi exatamente esse cenário que gerou os erros de "consumo
 * redundante" vistos ao vivo antes dessa correção). Cada chamada reserva seu
 * horário atomicamente (a trava do FOR UPDATE serializa até instâncias
 * diferentes do processo Node) e só libera a linha depois de já ter
 * calculado a PRÓXIMA vez livre — quem chegar depois espera a vez certa.
 */
export class Limitador {
  constructor(private readonly intervaloMinimoMs: number) {}

  private tabelaGarantida: Promise<void> | null = null;
  private async garantirTabela(): Promise<void> {
    this.tabelaGarantida ??= (async () => {
      await executarDdlIdempotente(`
        CREATE TABLE IF NOT EXISTS ${nomeTabela()} (
          id SMALLINT PRIMARY KEY,
          proxima_liberacao TIMESTAMPTZ NOT NULL
        )
      `);
      await obterPool().query(`INSERT INTO ${nomeTabela()} (id, proxima_liberacao) VALUES (1, now()) ON CONFLICT (id) DO NOTHING`);
    })();
    return this.tabelaGarantida;
  }

  /** Reserva atomicamente a próxima vez livre (linha travada com FOR UPDATE) e espera até que ela chegue. */
  private async aguardarVez(): Promise<void> {
    await this.garantirTabela();
    const pool = obterPool();
    const cliente = await pool.connect();
    let minhaVezMs: number;
    try {
      await cliente.query('BEGIN');
      const { rows } = await cliente.query<{ proxima_liberacao: Date }>(
        `SELECT proxima_liberacao FROM ${nomeTabela()} WHERE id = 1 FOR UPDATE`,
      );
      const proximaAtual = rows[0]?.proxima_liberacao.getTime() ?? Date.now();
      minhaVezMs = Math.max(Date.now(), proximaAtual);
      await cliente.query(`UPDATE ${nomeTabela()} SET proxima_liberacao = $1 WHERE id = 1`, [
        new Date(minhaVezMs + this.intervaloMinimoMs),
      ]);
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      cliente.release();
    }

    const esperaMs = minhaVezMs - Date.now();
    if (esperaMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, esperaMs));
    }
  }

  /** Executa `fn` respeitando o espaçamento mínimo e aplicando retry com backoff quando aplicável. */
  async executar<T>(fn: () => Promise<T>): Promise<T> {
    let ultimoErro: unknown;
    let esperasMetodoEmExecucao = 0;
    let esperadoMetodoEmExecucaoMs = 0;
    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa += 1) {
      await this.aguardarVez();
      try {
        return await fn();
      } catch (erro) {
        ultimoErro = erro;
        // Política própria para Client-1880: sequencial (a mesma chamada, nesta mesma fila), poucas
        // tentativas, espera progressiva e teto de duração. Esgotada, erro claro — nunca resultado parcial.
        if (erro instanceof OmieErroMetodoEmExecucao) {
          const espera = ESPERAS_METODO_EM_EXECUCAO_MS[esperasMetodoEmExecucao];
          if (espera === undefined || esperadoMetodoEmExecucaoMs + espera > LIMITE_ESPERA_METODO_EM_EXECUCAO_MS) {
            throw new OmieErroMetodoEmExecucao(
              `A Omie continuou recusando a consulta ("já existe uma requisição desse método sendo executada") ` +
                `após ${esperasMetodoEmExecucao + 1} tentativas em ${Math.round(esperadoMetodoEmExecucaoMs / 1000)} s. ` +
                `Nenhum valor foi calculado com dados incompletos; tente novamente em alguns minutos. Detalhe: ${erro.message}`,
              erro.faultcode,
            );
          }
          esperasMetodoEmExecucao += 1;
          esperadoMetodoEmExecucaoMs += espera;
          tentativa -= 1; // não consome as tentativas das outras políticas
          await new Promise((resolve) => setTimeout(resolve, espera));
          continue;
        }
        const podeTentarNovamente = erro instanceof OmieErroLimiteExcedido || erro instanceof OmieErroTransitorio;
        // Não manter uma requisição HTTP esperando bloqueios longos (ex.: bloqueio de 30min).
        // Para REDUNDANT, permite só uma nova tentativa, após toda a janela de 60 segundos.
        const esperaMinima = erro instanceof OmieErroLimiteExcedido ? erro.esperaMinimaMs : 0;
        // Depois de esperas por Client-1880, um bloqueio REDUNDANT não ganha mais 61 s: respeita o teto de duração.
        if (!podeTentarNovamente || tentativa === MAX_TENTATIVAS - 1 ||
            esperaMinima > 61000 || (esperaMinima > 0 && (tentativa > 0 || esperasMetodoEmExecucao > 0))) {
          throw erro;
        }
        const espera = Math.max(esperaMinima, ESPERAS_BACKOFF_MS[tentativa] ?? ESPERAS_BACKOFF_MS[ESPERAS_BACKOFF_MS.length - 1] ?? 2000);
        await new Promise((resolve) => setTimeout(resolve, espera));
      }
    }
    throw ultimoErro;
  }
}
