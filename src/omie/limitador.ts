import { executarDdlIdempotente, obterPool } from '../db.js';
import { OmieErroLimiteExcedido, OmieErroTransitorio } from './erros.js';

const MAX_TENTATIVAS = 3;
const ESPERAS_BACKOFF_MS = [500, 1000, 2000];

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
    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa += 1) {
      await this.aguardarVez();
      try {
        return await fn();
      } catch (erro) {
        ultimoErro = erro;
        const podeTentarNovamente = erro instanceof OmieErroLimiteExcedido || erro instanceof OmieErroTransitorio;
        if (!podeTentarNovamente || tentativa === MAX_TENTATIVAS - 1) {
          throw erro;
        }
        const espera = ESPERAS_BACKOFF_MS[tentativa] ?? ESPERAS_BACKOFF_MS[ESPERAS_BACKOFF_MS.length - 1] ?? 2000;
        await new Promise((resolve) => setTimeout(resolve, espera));
      }
    }
    throw ultimoErro;
  }
}
