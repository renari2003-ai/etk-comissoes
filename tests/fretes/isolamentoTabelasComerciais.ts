// Isolamento das tabelas comerciais do módulo de Fretes nos testes que já isolam
// cotações/propostas. Sem isto, `garantirEsquemaFretes()` usava as tabelas REAIS de
// composição/aprovação/parâmetros fiscais junto com cotações/propostas de TESTE — e, quando
// a tabela real era criada nesse momento, nascia com FKs apontando para `*_teste_*`
// (bug encontrado em produção em 2026-09-23).
//
// Nomes curtos de propósito: identificadores do Postgres acima de 63 caracteres são
// truncados, o que cortaria o sufixo aleatório (e os índices `idx_<tabela>_...`).

const VARIAVEIS: ReadonlyArray<[variavel: string, prefixo: string]> = [
  ['COMPOSICOES_COMERCIAIS_FRETE_TABELA', 'composicoes_t'],
  ['APROVACOES_VALOR_MINIMO_FRETE_TABELA', 'aprovacoes_vm_t'],
  ['PARAMETROS_FISCAIS_FRETE_TABELA', 'parametros_fiscais_t'],
];

/** Tabelas isoladas pelos testes de Fretes (uma variável de ambiente por tabela). */
const VARIAVEIS_TABELAS_FRETES = [
  'EXTRACOES_PROPOSTA_TABELA',
  'RESPOSTAS_COTACAO_TABELA',
  'FECHAMENTOS_FRETE_TABELA',
  'PROPOSTAS_FRETE_TABELA',
  'SOLICITACOES_COTACAO_TABELA',
  'COTACOES_FRETE_TABELA',
  'TRANSPORTADORAS_TABELA',
  'VEICULOS_FRETE_TABELA',
  'AUDITORIA_FRETES_TABELA',
] as const;

/**
 * Chamar no `afterEach` DEPOIS dos DROPs do próprio teste e ANTES de apagar as variáveis de
 * ambiente. Os DROPs individuais engolem erro (`.catch`), e uma ordem que viole alguma FK
 * (ex.: solicitações antes de propostas, que referenciam solicitações) deixava tabelas para
 * trás no banco — foi assim que milhares de tabelas de teste se acumularam. Aqui tenta de
 * novo, em passadas, até não sobrar nenhuma (ou nenhuma passada avançar).
 */
export async function droparTabelasRemanescentes(pool: { query(sql: string): Promise<unknown> }): Promise<void> {
  let pendentes = VARIAVEIS_TABELAS_FRETES.map((v) => process.env[v]).filter(
    (nome): nome is string => nome !== undefined && /^[a-z_][a-z0-9_]*$/.test(nome) && /\d{13}/.test(nome),
  );
  while (pendentes.length > 0) {
    const falharam: string[] = [];
    for (const nome of pendentes) {
      await pool.query(`DROP TABLE IF EXISTS ${nome}`).catch(() => falharam.push(nome));
    }
    if (falharam.length === pendentes.length) return; // nenhuma passada avançou: não insiste
    pendentes = falharam;
  }
}

/** Chamar no `beforeEach`, com o MESMO sufixo usado nas demais tabelas isoladas do teste. */
export function isolarTabelasComerciais(sufixo: string): void {
  for (const [variavel, prefixo] of VARIAVEIS) process.env[variavel] = `${prefixo}_${sufixo}`;
}

/**
 * Chamar no início do `afterEach`, ANTES de apagar cotações/propostas: composição e
 * aprovação referenciam essas tabelas, então precisam sair primeiro (senão o DROP delas
 * falharia e deixaria tabelas de teste para trás no banco).
 */
export async function limparTabelasComerciais(pool: { query(sql: string): Promise<unknown> }): Promise<void> {
  for (const [variavel] of VARIAVEIS) {
    const nome = process.env[variavel];
    if (nome !== undefined && /^[a-z_][a-z0-9_]*$/.test(nome)) {
      await pool.query(`DROP TABLE IF EXISTS ${nome}`).catch(() => undefined);
    }
    delete process.env[variavel];
  }
}
