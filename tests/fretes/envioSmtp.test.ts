import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import type { CotacaoFrete, SolicitacaoCotacao } from '../../src/fretes/tipos.js';

// Canal EMAIL por SMTP direto (padrão) × n8n (rollback). Repositórios, n8n e transporte SMTP
// simulados — nenhum banco real, nenhum servidor de e-mail real.

const SENHA = 'SenhaSmtp#Teste2026';
const enviadosSmtp: Record<string, unknown>[] = [];
let falhaSmtp: Error | null = null;
const auditorias: { acao: string; valorNovo?: unknown }[] = [];

const solicitacaoComErro = {
  id: 'sol-1',
  cotacaoFreteId: 'cot-1',
  transportadoraId: 'tr-1',
  canal: 'EMAIL',
  status: 'ERRO',
  codigoReferencia: 'FRE-2026-000001-abcd1234',
  tentativas: 1,
  erroUltimaTentativa: 'O webhook do n8n respondeu HTTP 500.',
  emailDestino: 'cotacao@transportadora.com.br',
  emailOrigem: 'CADASTRO',
  embalagens: [{ altura: 0.27, largura: 0.36, comprimento: 0.77, quantidade: 6 }],
} as SolicitacaoCotacao;

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: Record<string, unknown>) => {
        if (falhaSmtp !== null) throw falhaSmtp;
        enviadosSmtp.push(m);
        return { messageId: '<gerado@etk.ind.br>', rejected: [] };
      },
      close: () => undefined,
    }),
  },
}));

vi.mock('../../src/fretes/integracoes/n8nCliente.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/integracoes/n8nCliente.js')>()),
  enviarSolicitacaoAoN8n: vi.fn(async () => ({ statusHttp: 200 })),
}));

vi.mock('../../src/fretes/solicitacoesRepositorio.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/solicitacoesRepositorio.js')>()),
  buscarSolicitacaoPorId: vi.fn(async () => solicitacaoComErro),
  marcarSolicitacaoEnviada: vi.fn(async (_id: string, identificador: string | null) => ({
    ...solicitacaoComErro,
    status: 'ENVIADA',
    tentativas: 2,
    erroUltimaTentativa: null,
    identificadorExterno: identificador,
  })),
  marcarSolicitacaoErro: vi.fn(async (_id: string, motivo: string) => ({ ...solicitacaoComErro, tentativas: 2, erroUltimaTentativa: motivo })),
}));

vi.mock('../../src/fretes/fretesServico.js', () => ({
  servicoBuscarCotacao: vi.fn(
    async () =>
      ({
        id: 'cot-1',
        codigo: 'FRE-2026-000001',
        clienteOmieId: null,
        origem: 'São Paulo/SP',
        destino: 'Curitiba/PR',
        cepOrigem: null,
        cepDestino: null,
        volumes: 6,
        peso: 80,
        pesoBruto: 80,
        pesoLiquido: null,
        especieVolumes: 'CAIXA',
        modalidade: 'CIF',
        observacoes: 'TDE no destino',
      }) as CotacaoFrete,
  ),
}));

vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({
  registrarAuditoria: vi.fn(async (dados: { acao: string; valorNovo?: unknown }) => {
    auditorias.push(dados);
  }),
}));

async function carregar(caminhoEmail: 'smtp' | 'n8n') {
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.exemplo.test',
    SMTP_PORT: '587',
    SMTP_USER: 'cotacao@etk.ind.br',
    SMTP_PASS: SENHA,
    SMTP_FROM: 'cotacao@etk.ind.br',
    FRETES_EMAIL_OUTBOUND: caminhoEmail,
  });
  vi.resetModules();
  const servico = await import('../../src/fretes/integracaoCotacoesServico.js');
  const n8n = await import('../../src/fretes/integracoes/n8nCliente.js');
  const repo = await import('../../src/fretes/solicitacoesRepositorio.js');
  return { servico, n8n, repo };
}

beforeEach(() => {
  enviadosSmtp.length = 0;
  auditorias.length = 0;
  falhaSmtp = null;
  vi.clearAllMocks();
});

describe('canal EMAIL por SMTP direto', () => {
  it('padrão: envia pelo SMTP (sem n8n), com o template e as embalagens salvas; ENVIADA só após aceite; Message-ID guardado', async () => {
    const { servico, n8n, repo } = await carregar('smtp');
    const r = await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');

    expect(n8n.enviarSolicitacaoAoN8n).not.toHaveBeenCalled();
    expect(enviadosSmtp).toHaveLength(1);
    const email = enviadosSmtp[0] as { to: string; subject: string; text: string };
    expect(email.to).toBe('cotacao@transportadora.com.br');
    expect(email.subject).toBe('Cotação de Frete ETK | FRE-2026-000001-abcd1234');
    expect(email.text).toContain('Quantidade: 6 | Medidas: 0,77 x 0,36 x 0,27 m (C x L x A)');
    expect(email.text).toContain('Observações: TDE no destino');
    expect(repo.marcarSolicitacaoEnviada).toHaveBeenCalledWith('sol-1', '<gerado@etk.ind.br>');
    expect(r.status).toBe('ENVIADA');
    expect(auditorias).toEqual([expect.objectContaining({ acao: 'SOLICITACAO_ENVIADA_SMTP' })]);
  });

  it('falha SMTP → ERRO (FALHA) com motivo sanitizado na solicitação e na auditoria, sem senha', async () => {
    const { servico, repo } = await carregar('smtp');
    falhaSmtp = Object.assign(new Error('auth'), { code: 'EAUTH', responseCode: 535, response: `535 Authentication failed password=${SENHA}` });

    const r = await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');

    expect(r.status).toBe('ERRO');
    const motivo = vi.mocked(repo.marcarSolicitacaoErro).mock.calls[0]?.[1] ?? '';
    expect(motivo).toMatch(/^SMTP_AUTENTICACAO: /);
    expect(motivo).not.toContain(SENHA);
    expect(auditorias).toEqual([expect.objectContaining({ acao: 'SOLICITACAO_ERRO_SMTP', valorNovo: expect.objectContaining({ erro: motivo }) })]);
    expect(JSON.stringify(auditorias)).not.toContain(SENHA);
  });

  it('rollback FRETES_EMAIL_OUTBOUND=n8n: EMAIL volta ao webhook do n8n, nada sai pelo SMTP', async () => {
    const { servico, n8n } = await carregar('n8n');
    await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');
    expect(n8n.enviarSolicitacaoAoN8n).toHaveBeenCalledTimes(1);
    expect(enviadosSmtp).toHaveLength(0);
    expect(auditorias).toEqual([expect.objectContaining({ acao: 'SOLICITACAO_ENVIADA_N8N' })]);
  });
});
