import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CotacaoFrete, SolicitacaoCotacao } from '../../src/fretes/tipos.js';

// Snapshot de embalagens na solicitação: gravação/leitura (banco simulado — nenhuma tabela é
// criada em banco real) e presença no payload outbound do n8n.

const consultas: { sql: string; params: unknown[] }[] = [];
let proximaLinha: Record<string, unknown> | null = null;

vi.mock('../../src/db.js', () => ({
  obterPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql, params });
      return { rows: proximaLinha === null ? [] : [proximaLinha] };
    },
  }),
  executarDdlIdempotente: async () => undefined,
}));

vi.mock('../../src/fretes/schema.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/schema.js')>()),
  garantirEsquemaFretes: async () => undefined,
  nomeTabelaSolicitacoes: () => 'solicitacoes_cotacao_frete',
}));

const { criarSolicitacao, buscarSolicitacaoPorId, lerEmbalagensPersistidas } = await import('../../src/fretes/solicitacoesRepositorio.js');
const { montarPayloadN8n } = await import('../../src/fretes/integracaoCotacoesServico.js');

const EMBALAGENS = [
  { altura: 0.27, largura: 0.36, comprimento: 0.77, quantidade: 6 },
  { altura: 1.2, largura: 0.8, comprimento: 1, quantidade: 2 },
];

function linhaBanco(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sol-1',
    cotacao_frete_id: 'cot-1',
    transportadora_id: 'tr-1',
    canal: 'EMAIL',
    status: 'PENDENTE_ENVIO',
    codigo_referencia: 'FR-1-abcd1234',
    data_envio: null,
    data_resposta: null,
    identificador_externo: null,
    tentativas: 0,
    erro_ultima_tentativa: null,
    email_destino: 'cotacao@etk.com.br',
    email_origem: 'CADASTRO',
    wamid_outbound: null,
    ycloud_message_id: null,
    telefone_destino: null,
    criado_por: 'u-1',
    criado_em: new Date('2026-10-02T12:00:00Z'),
    atualizado_em: new Date('2026-10-02T12:00:00Z'),
    ...extra,
  };
}

beforeEach(() => {
  consultas.length = 0;
  proximaLinha = null;
});

describe('persistência das embalagens na solicitação', () => {
  it('grava as embalagens (todas as linhas, medidas como informadas) como JSONB e devolve o snapshot', async () => {
    proximaLinha = linhaBanco({ embalagens: EMBALAGENS });
    const s = await criarSolicitacao({
      cotacaoFreteId: 'cot-1',
      transportadoraId: 'tr-1',
      canal: 'EMAIL',
      codigoReferencia: 'FR-1-abcd1234',
      criadoPor: 'u-1',
      emailDestino: 'cotacao@etk.com.br',
      emailOrigem: 'CADASTRO',
      embalagens: EMBALAGENS,
    });
    const insert = consultas.find((c) => c.sql.includes('INSERT'));
    expect(insert?.sql).toContain('embalagens');
    expect(insert?.sql).toContain('$9::jsonb');
    expect(JSON.parse(insert?.params[8] as string)).toEqual(EMBALAGENS);
    expect(s.embalagens).toEqual(EMBALAGENS);
  });

  it('sem embalagens (ou lista vazia) grava NULL', async () => {
    proximaLinha = linhaBanco({ embalagens: null });
    const base = { cotacaoFreteId: 'cot-1', transportadoraId: 'tr-1', canal: 'EMAIL' as const, codigoReferencia: 'x', criadoPor: 'u-1' };
    await criarSolicitacao(base);
    await criarSolicitacao({ ...base, embalagens: [] });
    const inserts = consultas.filter((c) => c.sql.includes('INSERT'));
    expect(inserts.map((c) => c.params[8])).toEqual([null, null]);
  });

  it('registro antigo (coluna ausente ou NULL) é lido normalmente com embalagens = null', async () => {
    const semColuna = linhaBanco();
    delete semColuna.embalagens;
    proximaLinha = semColuna;
    expect((await buscarSolicitacaoPorId('sol-1'))?.embalagens).toBeNull();
    proximaLinha = linhaBanco({ embalagens: null });
    const s = await buscarSolicitacaoPorId('sol-1');
    expect(s?.embalagens).toBeNull();
    expect(s?.emailDestino).toBe('cotacao@etk.com.br');
  });

  it('conteúdo fora do formato gravado falha alto (nunca aproveitado pela metade)', () => {
    expect(lerEmbalagensPersistidas([])).toBeNull();
    expect(() => lerEmbalagensPersistidas({})).toThrow(/inconsistente/);
    expect(() => lerEmbalagensPersistidas([{ altura: '0.27', largura: 0.36, comprimento: 0.77, quantidade: 6 }])).toThrow(/inconsistente/);
  });
});

describe('payload outbound do n8n com embalagens', () => {
  const cotacao = {
    id: 'cot-1',
    origem: 'ETK',
    destino: 'Cliente',
    cepOrigem: '01000-000',
    cepDestino: '80000-000',
    pesoBruto: 120,
    pesoLiquido: 110,
    peso: 120,
    volumes: 8,
    especieVolumes: 'Caixas',
    modalidade: 'CIF',
    observacoes: 'TDE no destino',
  } as CotacaoFrete;

  function solicitacao(embalagens: SolicitacaoCotacao['embalagens']): SolicitacaoCotacao {
    return {
      id: 'sol-1',
      transportadoraId: 'tr-1',
      codigoReferencia: 'FR-1-abcd1234',
      canal: 'EMAIL',
      emailDestino: 'cotacao@etk.com.br',
      emailOrigem: 'CADASTRO',
      embalagens,
    } as SolicitacaoCotacao;
  }

  it('vários tipos de embalagem → uma linha por tipo; total de volumes, peso, espécie e demais campos mantidos', () => {
    const payload = montarPayloadN8n(cotacao, solicitacao(EMBALAGENS), { cnpjOrigem: '11222333000181', cnpjDestino: null }, null);
    expect(payload.logistica.embalagens).toEqual(EMBALAGENS);
    expect(payload.logistica).toMatchObject({
      volumes: 8,
      peso: 120,
      pesoBruto: 120,
      especie: 'Caixas',
      cnpjOrigem: '11222333000181',
      modalidade: 'CIF',
      observacoes: 'TDE no destino',
    });
    expect(payload.versao).toBe(1);
    expect(payload.transportadora).toEqual({ id: 'tr-1', email: 'cotacao@etk.com.br', fonteEmail: 'CADASTRO', whatsapp: null });
  });

  it('solicitação antiga sem embalagens → lista vazia, sem quebrar o payload', () => {
    const payload = montarPayloadN8n(cotacao, solicitacao(null), { cnpjOrigem: null, cnpjDestino: null }, null);
    expect(payload.logistica.embalagens).toEqual([]);
    expect(payload.logistica.volumes).toBe(8);
  });
});
