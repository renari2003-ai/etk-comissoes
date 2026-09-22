import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClienteOmie } from '../../src/omie/cliente.js';

// Ajuste Transportadoras — busca na Omie por CNPJ/razão/fantasia (somente leitura) e
// prevenção de duplicidade por CNPJ. Parte Omie: fetch simulado (sem rede). Parte ETK:
// Postgres real com tabelas descartáveis (todas isoladas).
vi.setConfig({ testTimeout: 30000 });

const USUARIO_TESTE = '11111111-1111-1111-1111-111111111111';
const CNPJ_A = '11222333000181';
const CNPJ_B = '44555666000181';

function registro(codigo: number, razao: string, fantasia: string, cnpj: string) {
  return { codigo_cliente_omie: codigo, razao_social: razao, nome_fantasia: fantasia, cnpj_cpf: cnpj, email: 'a@b.com', telefone1_ddd: '11', telefone1_numero: '99999-0000', contato: 'Maria' };
}

function stubOmie(respostas: Array<unknown | { fault: string }>) {
  const chamadas: Array<{ call: string; param: Record<string, unknown> }> = [];
  const fila = [...respostas];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(init.body as string) as { call: string; param: Array<Record<string, unknown>> };
      chamadas.push({ call: corpo.call, param: corpo.param[0] as Record<string, unknown> });
      const proxima = fila.shift() as { fault?: string } | undefined;
      if (proxima?.fault !== undefined) {
        return new Response(JSON.stringify({ faultstring: proxima.fault, faultcode: 'SOAP-ENV:Client-5113' }), { status: 500 });
      }
      return new Response(JSON.stringify(proxima ?? { clientes_cadastro: [] }), { status: 200 });
    }),
  );
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());

describe('ClienteOmie.buscarClientes (somente leitura)', () => {
  it('busca exata por CNPJ: só ListarClientes, aceita só igualdade de dígitos', async () => {
    const chamadas = stubOmie([
      { clientes_cadastro: [registro(1, 'TRANSP A LTDA', 'Transp A', '11.222.333/0001-81'), registro(2, 'OUTRA LTDA', 'Outra', '99.999.999/0001-99')] },
    ]);
    const r = await new ClienteOmie().buscarClientes({ cnpj: '11.222.333/0001-81' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ codigo: 1, razaoSocial: 'TRANSP A LTDA', nomeFantasia: 'Transp A', cnpjCpf: CNPJ_A, email: 'a@b.com', telefone: '11 99999-0000', contato: 'Maria' });
    expect(chamadas.map((c) => c.call)).toEqual(['ListarClientes']);
    expect((chamadas[0]?.param.clientesFiltro as Record<string, string>).cnpj_cpf).toBe('11.222.333/0001-81');
  });

  it('CNPJ tem prioridade: com CNPJ informado, nome nunca é usado no filtro', async () => {
    const chamadas = stubOmie([{ clientes_cadastro: [registro(1, 'TRANSP A LTDA', 'A', CNPJ_A)] }]);
    await new ClienteOmie().buscarClientes({ cnpj: CNPJ_A, razaoSocial: 'qualquer nome' });
    expect(Object.keys(chamadas[0]?.param.clientesFiltro as object)).toEqual(['cnpj_cpf']);
  });

  it('busca por razão social e por nome fantasia usam o filtro correspondente', async () => {
    const chamadas = stubOmie([{ clientes_cadastro: [registro(1, 'TRANSP A LTDA', 'A', CNPJ_A)] }, { clientes_cadastro: [registro(2, 'TRANSP B', 'B', CNPJ_B)] }]);
    const omie = new ClienteOmie();
    expect(await omie.buscarClientes({ razaoSocial: 'TRANSP' })).toHaveLength(1);
    expect(await omie.buscarClientes({ nomeFantasia: 'B' })).toHaveLength(1);
    expect(chamadas[0]?.param.clientesFiltro).toEqual({ razao_social: 'TRANSP' });
    expect(chamadas[1]?.param.clientesFiltro).toEqual({ nome_fantasia: 'B' });
  });

  it('"não existem registros" da Omie vira lista vazia (não encontrada)', async () => {
    stubOmie([{ fault: 'ERROR: Não existem registros para a página [1]!' }, { fault: 'ERROR: Não existem registros para a página [1]!' }]);
    expect(await new ClienteOmie().buscarClientes({ cnpj: CNPJ_A })).toEqual([]);
  });
});

describe('tela de transportadoras', () => {
  it('Código Omie removido da tela (só campo oculto interno) e ação de busca presente', () => {
    const html = readFileSync('public/index.html', 'utf8');
    expect(html).not.toMatch(/C[óo]digo Omie/);
    expect(html).toMatch(/id="fretes-transportadora-codigo-omie"[^>]*type="hidden"/);
    expect(html).toContain('fretes-transportadora-botao-buscar-omie');
  });
});

const NOMES = [
  'TRANSPORTADORAS_TABELA',
  'VEICULOS_FRETE_TABELA',
  'COTACOES_FRETE_TABELA',
  'PROPOSTAS_FRETE_TABELA',
  'FECHAMENTOS_FRETE_TABELA',
  'AUDITORIA_FRETES_TABELA',
  'SOLICITACOES_COTACAO_TABELA',
  'RESPOSTAS_COTACAO_TABELA',
  'EXTRACOES_PROPOSTA_TABELA',
] as const;

describe('serviço de transportadoras (ETK)', () => {
  beforeEach(() => {
    const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    for (const n of NOMES) process.env[n] = `${n.toLowerCase()}_tr_${sufixo}`;
    process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_tr_${sufixo}`;
  });

  afterEach(async () => {
    const { obterPool } = await import('../../src/db.js');
    const pool = obterPool();
    for (const n of [...NOMES].reverse()) await pool.query(`DROP TABLE IF EXISTS ${process.env[n]}`).catch(() => undefined);
    await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
    for (const n of NOMES) delete process.env[n];
    delete process.env.COTACOES_FRETE_SEQ;
  }, 30000);

  const base = { nomeFantasia: null, email: null, telefone: null, contato: null, observacoes: null };

  it('múltiplos resultados por nome não escolhem sozinhos; CNPJ único é resolvido; cadastrada é sinalizada; duplicidade por CNPJ bloqueia', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const { servicoBuscarTransportadoraOmie } = await import('../../src/fretes/transportadoraOmieServico.js');
    const a = { codigo: 10, razaoSocial: 'TRANSP RAPIDO LTDA', nomeFantasia: 'Rápido', cnpjCpf: CNPJ_A, email: null, telefone: null, contato: null };
    const b = { codigo: 11, razaoSocial: 'TRANSP RAPIDO SUL LTDA', nomeFantasia: 'Rápido Sul', cnpjCpf: CNPJ_B, email: null, telefone: null, contato: null };
    const buscador = { buscarClientes: vi.fn(async (f: { cnpj?: string }) => (f.cnpj !== undefined ? [a] : [a, b])) };

    // Já cadastrada no ETK com o CNPJ da opção A (gravada com máscara — cadastro legado).
    await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Rápido (ETK)', cnpj: CNPJ_A }, USUARIO_TESTE);

    const porNome = await servicoBuscarTransportadoraOmie(buscador, { cnpj: null, razaoSocial: 'TRANSP RAPIDO', nomeFantasia: null });
    expect(porNome.criterio).toBe('RAZAO_SOCIAL');
    expect(porNome.resultados).toHaveLength(2); // nenhuma escolha automática
    expect(porNome.resultados.find((r) => r.codigo === 10)?.jaCadastrada?.nomeRazaoSocial).toBe('Rápido (ETK)');
    expect(porNome.resultados.find((r) => r.codigo === 11)?.jaCadastrada).toBeNull();

    const porCnpj = await servicoBuscarTransportadoraOmie(buscador, { cnpj: CNPJ_A, razaoSocial: 'ignorado', nomeFantasia: null });
    expect(porCnpj.criterio).toBe('CNPJ');
    expect(buscador.buscarClientes).toHaveBeenLastCalledWith({ cnpj: CNPJ_A });

    const naoEncontrada = await servicoBuscarTransportadoraOmie({ buscarClientes: async () => [] }, { cnpj: CNPJ_B, razaoSocial: null, nomeFantasia: null });
    expect(naoEncontrada.resultados).toEqual([]);

    const erro = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Duplicada', cnpj: CNPJ_A }, USUARIO_TESTE).catch((e: unknown) => e);
    expect((erro as Error).message).toContain('Rápido (ETK)');
    expect((await servico.servicoListarTransportadoras(false)).filter((t) => t.cnpj === CNPJ_A)).toHaveLength(1);
  });

  it('cadastro manual (sem Omie) fica com vínculo nulo; vínculo técnico da Omie é preservado quando selecionado', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const manual = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Manual Ltda', cnpj: CNPJ_B }, USUARIO_TESTE);
    expect(manual.codigoClienteOmie).toBeNull();
    const semCnpj = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Sem CNPJ A', cnpj: null }, USUARIO_TESTE);
    const semCnpj2 = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Sem CNPJ B', cnpj: null }, USUARIO_TESTE);
    expect([semCnpj.cnpj, semCnpj2.cnpj]).toEqual([null, null]); // sem CNPJ não é tratado como duplicidade
    const vinculada = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Vinculada', cnpj: CNPJ_A, codigoClienteOmie: 777 }, USUARIO_TESTE);
    expect(vinculada.codigoClienteOmie).toBe(777);
    expect(vinculada.cnpj).toBe(CNPJ_A);
  });
});
