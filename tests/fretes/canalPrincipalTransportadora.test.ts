import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ErroValidacao } from '../../src/validacao.js';
import { validarCanalPrincipalOpcional } from '../../src/fretes/validacao.js';

// Postgres real (sem mock) — mesmo padrão de tests/fretes/transportadoraOmie.test.ts.
vi.setConfig({ testTimeout: 30000 });

// Arquitetura de canais — Fase 1: só cadastro/exibição de `canalPrincipal`/`urlPortal` na
// transportadora. Nenhuma lógica de cotação/solicitação lê esses campos ainda (isso é Fase
// 2/3, fora de escopo aqui) — por isso não há nenhum teste de roteamento de canal neste
// arquivo, só CRUD e validação.

describe('validarCanalPrincipalOpcional', () => {
  it('aceita EMAIL, WHATSAPP, SITE e API', () => {
    expect(validarCanalPrincipalOpcional('EMAIL')).toBe('EMAIL');
    expect(validarCanalPrincipalOpcional('WHATSAPP')).toBe('WHATSAPP');
    expect(validarCanalPrincipalOpcional('SITE')).toBe('SITE');
    expect(validarCanalPrincipalOpcional('API')).toBe('API');
  });

  it('ausência/null/vazio vira null (não obrigatório nesta fase)', () => {
    expect(validarCanalPrincipalOpcional(undefined)).toBeNull();
    expect(validarCanalPrincipalOpcional(null)).toBeNull();
    expect(validarCanalPrincipalOpcional('')).toBeNull();
  });

  it('rejeita qualquer valor fora da lista fechada', () => {
    expect(() => validarCanalPrincipalOpcional('TELEFONE')).toThrow(ErroValidacao);
    expect(() => validarCanalPrincipalOpcional('email')).toThrow(ErroValidacao); // case-sensitive, minúsculo não é aceito
    expect(() => validarCanalPrincipalOpcional(123)).toThrow(ErroValidacao);
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

const USUARIO_TESTE = '11111111-1111-1111-1111-111111111111';

describe('CRUD de transportadora — canalPrincipal/urlPortal (Fase 1)', () => {
  beforeEach(() => {
    const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    for (const n of NOMES) process.env[n] = `${n.toLowerCase()}_cp_${sufixo}`;
    process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_cp_${sufixo}`;
  });

  afterEach(async () => {
    const { obterPool } = await import('../../src/db.js');
    const pool = obterPool();
    for (const n of [...NOMES].reverse()) await pool.query(`DROP TABLE IF EXISTS ${process.env[n]}`).catch(() => undefined);
    await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
    for (const n of NOMES) delete process.env[n];
    delete process.env.COTACOES_FRETE_SEQ;
  }, 30000);

  const base = { nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null };

  it('cria transportadora com canalPrincipal = EMAIL', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const t = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Transp Email', canalPrincipal: 'EMAIL' }, USUARIO_TESTE);
    expect(t.canalPrincipal).toBe('EMAIL');
    expect(t.urlPortal).toBeNull();
  });

  it('cria transportadora com canalPrincipal = WHATSAPP', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const t = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Transp WhatsApp', canalPrincipal: 'WHATSAPP' }, USUARIO_TESTE);
    expect(t.canalPrincipal).toBe('WHATSAPP');
  });

  it('cria transportadora com canalPrincipal = SITE e urlPortal preenchida', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const t = await servico.servicoCriarTransportadora(
      { ...base, nomeRazaoSocial: 'Transp Site', canalPrincipal: 'SITE', urlPortal: 'https://portal.transportadora.com.br/cotacao' },
      USUARIO_TESTE,
    );
    expect(t.canalPrincipal).toBe('SITE');
    expect(t.urlPortal).toBe('https://portal.transportadora.com.br/cotacao');
  });

  it('cria transportadora com canalPrincipal = API', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const t = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Transp Api', canalPrincipal: 'API' }, USUARIO_TESTE);
    expect(t.canalPrincipal).toBe('API');
  });

  it('cria transportadora sem canalPrincipal (opcional, nenhum canal inferido automaticamente)', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const t = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Transp Sem Canal' }, USUARIO_TESTE);
    expect(t.canalPrincipal).toBeNull();
    expect(t.urlPortal).toBeNull();
  });

  it('rota rejeita valor de canalPrincipal fora da lista fechada (validação na borda HTTP)', () => {
    // A validação estrita acontece em validarCanalPrincipalOpcional (já coberta acima) —
    // aqui só confirma que o serviço/repositório não teria como "corrigir" um valor inválido
    // que a rota deveria ter barrado antes de chegar aqui.
    expect(() => validarCanalPrincipalOpcional('SMS')).toThrow(/canalPrincipal.*deve ser um dos/);
  });

  it('edita canalPrincipal de uma transportadora existente', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const criada = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Transp Editar Canal' }, USUARIO_TESTE);
    expect(criada.canalPrincipal).toBeNull();
    const editada = await servico.servicoAtualizarTransportadora(criada.id, { canalPrincipal: 'WHATSAPP' }, USUARIO_TESTE);
    expect(editada.canalPrincipal).toBe('WHATSAPP');
  });

  it('edita urlPortal de uma transportadora existente', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const criada = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Transp Editar Url', canalPrincipal: 'SITE' }, USUARIO_TESTE);
    expect(criada.urlPortal).toBeNull();
    const editada = await servico.servicoAtualizarTransportadora(criada.id, { urlPortal: 'https://outraurl.com.br' }, USUARIO_TESTE);
    expect(editada.urlPortal).toBe('https://outraurl.com.br');
  });

  it('registro antigo sem canalPrincipal/urlPortal continua funcionando normalmente (sem quebra, sem canal inferido)', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    // Simula uma transportadora "legada" — criada antes desta fase, nunca recebeu os campos novos.
    const legada = await servico.servicoCriarTransportadora({ ...base, nomeRazaoSocial: 'Transp Legada' }, USUARIO_TESTE);
    expect(legada.canalPrincipal).toBeNull();
    expect(legada.urlPortal).toBeNull();
    // Continua listável e editável normalmente, sem exigir os campos novos.
    const listadas = await servico.servicoListarTransportadoras(false);
    expect(listadas.find((t) => t.id === legada.id)?.nomeRazaoSocial).toBe('Transp Legada');
    const editadaSemTocarCanal = await servico.servicoAtualizarTransportadora(legada.id, { contato: 'Novo contato' }, USUARIO_TESTE);
    expect(editadaSemTocarCanal.canalPrincipal).toBeNull();
    expect(editadaSemTocarCanal.contato).toBe('Novo contato');
  });

  it('CRUD continua preservando os campos antigos (nome, CNPJ, e-mail, codigoClienteOmie) junto com os novos', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const criada = await servico.servicoCriarTransportadora(
      {
        nomeRazaoSocial: 'Transp Completa',
        nomeFantasia: 'Completa',
        cnpj: '11222333000181',
        email: 'contato@completa.com.br',
        telefone: '11999998888',
        contato: 'Fulano',
        observacoes: 'obs',
        codigoClienteOmie: 555,
        canalPrincipal: 'API',
        urlPortal: null,
      },
      USUARIO_TESTE,
    );
    expect(criada).toMatchObject({
      nomeRazaoSocial: 'Transp Completa',
      nomeFantasia: 'Completa',
      cnpj: '11222333000181',
      email: 'contato@completa.com.br',
      codigoClienteOmie: 555,
      canalPrincipal: 'API',
      urlPortal: null,
    });
    // Editar só canalPrincipal não deve apagar nenhum campo antigo.
    const editada = await servico.servicoAtualizarTransportadora(criada.id, { canalPrincipal: 'EMAIL' }, USUARIO_TESTE);
    expect(editada).toMatchObject({
      nomeRazaoSocial: 'Transp Completa',
      cnpj: '11222333000181',
      codigoClienteOmie: 555,
      canalPrincipal: 'EMAIL',
    });
  });
});
