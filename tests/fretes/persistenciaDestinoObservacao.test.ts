import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { droparTabelasRemanescentes, isolarTabelasComerciais, limparTabelasComerciais } from './isolamentoTabelasComerciais.js';

// Postgres REAL, mas SÓ o isolado (PGlite da suíte `vitest.isolado.config.ts`): fora dela, este
// arquivo é pulado — nunca roda contra o banco compartilhado. Saídas (SMTP/YCloud) simuladas.
const NO_BANCO_ISOLADO = process.env.BANCO_ISOLADO_PGLITE === '1';

const emailsEnviados: { para: string; texto: string }[] = [];
const chamadasYCloud: { to: string; corpo: string }[] = [];
let falharProximoWhatsapp = false;

vi.mock('../../src/fretes/integracoes/smtpCliente.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/integracoes/smtpCliente.js')>()),
  enviarEmailSmtp: vi.fn(async (m: { para: string; texto: string }) => {
    emailsEnviados.push({ para: m.para, texto: m.texto });
    return { messageId: `<teste-${emailsEnviados.length}@etk.test>` };
  }),
}));

const USUARIO = '11111111-1111-1111-1111-111111111111';
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

const cliente = { consultarCliente: async () => null } as unknown as ClienteOmie;

describe.skipIf(!NO_BANCO_ISOLADO)('persistência (PGlite isolado): migração, observação por transportadora, destino enviado, legado e reenvio', () => {
  beforeEach(() => {
    const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    isolarTabelasComerciais(sufixo);
    for (const n of NOMES) process.env[n] = `${n.toLowerCase()}_pdo_${sufixo}`;
    process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_pdo_${sufixo}`;
    Object.assign(process.env, {
      FRETES_EMAIL_OUTBOUND: 'smtp',
      SMTP_HOST: 'smtp.teste.invalid',
      SMTP_PORT: '587',
      SMTP_USER: 'teste@etk.test',
      SMTP_PASS: 'senha-ficticia',
      SMTP_FROM: 'teste@etk.test',
      FRETES_WHATSAPP: 'ycloud',
      YCLOUD_API_KEY: 'chave-ficticia',
      YCLOUD_WHATSAPP_FROM: '+5511900000000',
      YCLOUD_TEMPLATE_NOME: '',
    });
    emailsEnviados.length = 0;
    chamadasYCloud.length = 0;
    falharProximoWhatsapp = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (!String(url).includes('ycloud')) throw new Error(`fetch inesperado no teste: ${url}`);
      const corpo = JSON.parse(String(init.body)) as { to: string; text?: { body: string } };
      chamadasYCloud.push({ to: corpo.to, corpo: corpo.text?.body ?? '' });
      if (falharProximoWhatsapp) {
        falharProximoWhatsapp = false;
        return new Response(JSON.stringify({ error: { message: 'falha simulada' } }), { status: 500 });
      }
      return new Response(JSON.stringify({ id: `yc-${chamadasYCloud.length}`, wamid: `wamid.T${chamadasYCloud.length}`, status: 'sent' }), { status: 200 });
    });
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    const { obterPool } = await import('../../src/db.js');
    const pool = obterPool();
    await limparTabelasComerciais(pool);
    for (const n of [...NOMES].reverse()) await pool.query(`DROP TABLE IF EXISTS ${process.env[n]} CASCADE`).catch(() => undefined);
    await droparTabelasRemanescentes(pool);
    await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
    for (const n of NOMES) delete process.env[n];
    delete process.env.COTACOES_FRETE_SEQ;
  }, 60000);

  async function modulos() {
    return {
      servico: await import('../../src/fretes/fretesServico.js'),
      envio: await import('../../src/fretes/envioSolicitacoesServico.js'),
      integracao: await import('../../src/fretes/integracaoCotacoesServico.js'),
      cotacoesRepo: await import('../../src/fretes/cotacoesRepositorio.js'),
      solicitacoesRepo: await import('../../src/fretes/solicitacoesRepositorio.js'),
      schema: await import('../../src/fretes/schema.js'),
      db: await import('../../src/db.js'),
    };
  }

  /** Cotação com endereço MANUAL completo (como gravado por "Informar outro endereço") + 2 transportadoras. */
  async function prepararCenario(m: Awaited<ReturnType<typeof modulos>>) {
    const alfa = await m.servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Alfa Transportes', nomeFantasia: null, cnpj: null, email: 'cotacao@alfa.test', telefone: null, contato: null, observacoes: null, canalPrincipal: 'EMAIL' },
      USUARIO,
    );
    const beta = await m.servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Beta Cargas', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null, whatsappCotacao: '11977776666', canalPrincipal: 'WHATSAPP' },
      USUARIO,
    );
    const criada = await m.servico.servicoCriarCotacao(
      {
        clienteOmieId: null, pedidoOmieId: null, vendedorOmieId: null, origem: 'Itupeva/SP', cepOrigem: null, destino: 'provisório',
        cepDestino: null, peso: 80, volumes: 4, valorMercadoria: 5000, modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA',
        veiculoId: null, motoristaNome: null, custoManual: null, observacoes: 'Carga frágil',
      },
      USUARIO,
    );
    const cotacao = await m.cotacoesRepo.atualizarCotacao(criada.id, {
      origemDestino: 'MANUAL',
      destino: 'Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP',
      cepDestino: '01310-100',
      logradouroDestino: 'Av. Paulista',
      numeroDestino: '1000',
      complementoDestino: 'Galpão 3',
      bairroDestino: 'Bela Vista',
      cidadeDestino: 'São Paulo',
      ufDestino: 'SP',
    });
    return { alfa, beta, cotacao };
  }

  it('migração: colunas aditivas criadas (TEXT com CHECK ≤ 900, JSONB) e idempotentes', async () => {
    const m = await modulos();
    await m.schema.garantirEsquemaFretes();
    const tabela = process.env.SOLICITACOES_COTACAO_TABELA!;
    const pool = m.db.obterPool();
    const { rows } = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name IN ('observacoes_transportadora','destino_enviado') ORDER BY column_name`,
      [tabela],
    );
    expect(rows).toEqual([
      { column_name: 'destino_enviado', data_type: 'jsonb', is_nullable: 'YES' },
      { column_name: 'observacoes_transportadora', data_type: 'text', is_nullable: 'YES' },
    ]);
    // Rodar o DDL de novo (novo processo/cold start) não falha nem duplica nada.
    vi.resetModules();
    const m2 = await modulos();
    await expect(m2.schema.garantirEsquemaFretes()).resolves.toBeUndefined();
  });

  it('CHECK no banco: observação acima de 900 é recusada pelo próprio Postgres (defesa além da validação HTTP)', async () => {
    const m = await modulos();
    const { alfa, cotacao } = await prepararCenario(m);
    const base = { cotacaoFreteId: cotacao.id, transportadoraId: alfa.id, canal: 'EMAIL' as const, criadoPor: USUARIO, emailDestino: 'a@a.test', emailOrigem: 'MANUAL' as const };
    await expect(m.solicitacoesRepo.criarSolicitacao({ ...base, codigoReferencia: 'REF-OK', observacoesTransportadora: 'x'.repeat(900) })).resolves.toMatchObject({
      observacoesTransportadora: 'x'.repeat(900),
    });
    await expect(m.solicitacoesRepo.criarSolicitacao({ ...base, codigoReferencia: 'REF-LONGA', observacoesTransportadora: 'x'.repeat(901) })).rejects.toThrow(/check constraint/i);
  });

  it('envio real (repositórios reais): cada solicitação grava a PRÓPRIA observação e o snapshot do endereço enviado', async () => {
    const m = await modulos();
    const { alfa, beta, cotacao } = await prepararCenario(m);
    const resultados = await m.envio.servicoEnviarSolicitacoes(
      cliente,
      cotacao.id,
      [
        { transportadoraId: alfa.id, canal: 'EMAIL', emailManual: null, observacoesTransportadora: 'Doca 2 <manhã>\nResponsável: João' },
        { transportadoraId: beta.id, canal: 'WHATSAPP', emailManual: null, observacoesTransportadora: 'Somente após as 14h' },
      ],
      null,
      USUARIO,
    );
    expect(resultados.map((r) => r.status)).toEqual(['ENVIADO', 'ENVIADO']);

    const pool = m.db.obterPool();
    const { rows } = await pool.query<{ transportadora_id: string; observacoes_transportadora: string | null; destino_enviado: Record<string, unknown> }>(
      `SELECT transportadora_id, observacoes_transportadora, destino_enviado FROM ${process.env.SOLICITACOES_COTACAO_TABELA} ORDER BY criado_em`,
    );
    const porTransportadora = new Map(rows.map((r) => [r.transportadora_id, r]));
    expect(porTransportadora.get(alfa.id)?.observacoes_transportadora).toBe('Doca 2 <manhã>\nResponsável: João');
    expect(porTransportadora.get(beta.id)?.observacoes_transportadora).toBe('Somente após as 14h');
    const snapshotEsperado = {
      origem: 'MANUAL', cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', complemento: 'Galpão 3', bairro: 'Bela Vista',
      cidade: 'São Paulo', uf: 'SP', texto: 'Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP',
    };
    expect(porTransportadora.get(alfa.id)?.destino_enviado).toEqual(snapshotEsperado);
    expect(porTransportadora.get(beta.id)?.destino_enviado).toEqual(snapshotEsperado);

    // O que saiu: cada canal com a sua observação, nunca a da outra.
    expect(emailsEnviados).toHaveLength(1);
    expect(emailsEnviados[0]?.texto).toContain('Observações para a transportadora: Doca 2 <manhã>');
    expect(emailsEnviados[0]?.texto).not.toContain('14h');
    expect(chamadasYCloud[0]?.corpo).toContain('*Observações para a transportadora:* Somente após as 14h');
    expect(chamadasYCloud[0]?.corpo).not.toContain('Doca 2');
  });

  it('reenvio: endereço e observação do snapshot gravado; WhatsApp para o número ATUAL do cadastro', async () => {
    const m = await modulos();
    const { beta, cotacao } = await prepararCenario(m);
    falharProximoWhatsapp = true;
    const [r] = await m.envio.servicoEnviarSolicitacoes(
      cliente,
      cotacao.id,
      [{ transportadoraId: beta.id, canal: 'WHATSAPP', emailManual: null, observacoesTransportadora: 'Portão lateral' }],
      null,
      USUARIO,
    );
    expect(r?.status).toBe('FALHOU');
    const [solicitacao] = await m.solicitacoesRepo.listarSolicitacoesPorCotacao(cotacao.id);
    expect(solicitacao?.status).toBe('ERRO');

    // Depois do envio: a cotação muda de endereço (vira MANUAL texto livre) e o WhatsApp do cadastro muda.
    await m.servico.servicoAtualizarCotacao(cotacao.id, { destino: 'Rua Mudou Depois, 77 - Santos/SP', cepDestino: '11010-000' }, USUARIO);
    await m.servico.servicoAtualizarTransportadora(beta.id, { whatsappCotacao: '11955554444' }, USUARIO);

    const reenviada = await m.integracao.servicoReenviarSolicitacao(cliente, solicitacao!.id, USUARIO);
    expect(reenviada.status).toBe('ENVIADA');
    const ultima = chamadasYCloud.at(-1)!;
    expect(ultima.to).toBe('+5511955554444');
    expect(ultima.corpo).toContain('Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP - CEP 01310-100');
    expect(ultima.corpo).not.toContain('Santos');
    expect(ultima.corpo).toContain('Portão lateral');
    // O snapshot gravado não muda com o reenvio.
    const [depois] = await m.solicitacoesRepo.listarSolicitacoesPorCotacao(cotacao.id);
    expect(depois?.destinoEnviado?.texto).toBe('Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP');
    expect(depois?.codigoReferencia).toBe(solicitacao?.codigoReferencia);
  });

  it('registros legados (tabela anterior à migração): preservados; colunas novas NULL; reenvio usa o destino atual da cotação, como antes', async () => {
    const m = await modulos();
    const { alfa, cotacao } = await prepararCenario(m);
    const tabela = process.env.SOLICITACOES_COTACAO_TABELA!;
    const pool = m.db.obterPool();
    // Simula a tabela de produção ANTES da migração (só a tabela isolada deste teste).
    await pool.query(`ALTER TABLE ${tabela} DROP COLUMN observacoes_transportadora, DROP COLUMN destino_enviado`);
    const colunasLegado = await pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [tabela]);
    const temEmail = colunasLegado.rows.some((c) => c.column_name === 'email_destino');
    await pool.query(
      `INSERT INTO ${tabela} (id, cotacao_frete_id, transportadora_id, canal, status, codigo_referencia, tentativas, erro_ultima_tentativa, criado_por${temEmail ? ', email_destino, email_origem' : ''})
       VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, $2, 'EMAIL', 'ERRO', 'FRE-LEGADO-0001', 1, 'falha antiga', $3${temEmail ? ", 'legado@alfa.test', 'CADASTRO'" : ''})`,
      [cotacao.id, alfa.id, USUARIO],
    );

    // Novo processo com o código novo: a migração aditiva roda e NÃO apaga/recria nada.
    vi.resetModules();
    const m2 = await modulos();
    await m2.schema.garantirEsquemaFretes();
    const legado = await m2.solicitacoesRepo.buscarSolicitacaoPorId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(legado).toMatchObject({ codigoReferencia: 'FRE-LEGADO-0001', status: 'ERRO', observacoesTransportadora: null, destinoEnviado: null });

    // Reenvio do legado: sem snapshot, usa o destino atual da cotação (comportamento anterior) e o e-mail snapshot.
    const reenviado = await m2.integracao.servicoReenviarSolicitacao(cliente, legado!.id, USUARIO);
    expect(reenviado.status).toBe('ENVIADA');
    expect(emailsEnviados.at(-1)?.para).toBe('legado@alfa.test');
    expect(emailsEnviados.at(-1)?.texto).toContain('Destino: Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP - CEP 01310-100');
    expect(emailsEnviados.at(-1)?.texto).not.toContain('Observações para a transportadora');
  });
});
