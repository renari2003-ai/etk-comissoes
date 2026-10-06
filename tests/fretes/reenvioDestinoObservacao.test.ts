import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import type { CotacaoFrete, DestinoEnviado, SolicitacaoCotacao, Transportadora } from '../../src/fretes/tipos.js';

// "Reenviar" (solicitação com ERRO) — regras confirmadas em 2026-10-06:
// - endereço: o SNAPSHOT gravado na solicitação (o efetivamente usado), mesmo que a cotação mude;
// - observação para a transportadora: o snapshot da solicitação;
// - WhatsApp: o número ATUAL do cadastro (não preserva o número original);
// - e-mail: comportamento atual (snapshot `emailDestino`).
// Repositórios, SMTP, n8n e `fetch` simulados — nenhum banco real, nenhum envio real.

const enviadosSmtp: Record<string, unknown>[] = [];
const chamadasYCloud: { corpo: Record<string, unknown> }[] = [];

const DESTINO_ENVIADO: DestinoEnviado = {
  origem: 'MANUAL',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  complemento: 'Galpão 3',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
  texto: 'Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP',
};

let solicitacao: SolicitacaoCotacao;
let transportadora: Partial<Transportadora>;

// Cotação JÁ ALTERADA depois do envio original — o reenvio não pode usar este destino.
const cotacaoAlterada = {
  id: 'cot-1',
  codigo: 'FRE-2026-000001',
  clienteOmieId: null,
  origem: 'São Paulo/SP',
  cepOrigem: null,
  destino: 'Rua Diferente, 1 - Campinas/SP',
  cepDestino: '13000-000',
  origemDestino: 'MANUAL',
  logradouroDestino: 'Rua Diferente',
  numeroDestino: '1',
  complementoDestino: null,
  bairroDestino: null,
  cidadeDestino: 'Campinas',
  ufDestino: 'SP',
  volumes: 6,
  peso: 80,
  pesoBruto: 80,
  pesoLiquido: null,
  especieVolumes: 'CAIXA',
  modalidade: 'CIF',
  observacoes: 'Cobrar TDE no destino',
} as CotacaoFrete;

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: Record<string, unknown>) => {
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
  buscarSolicitacaoPorId: vi.fn(async () => solicitacao),
  marcarSolicitacaoEnviada: vi.fn(async (_id: string, ident: string | null) => ({ ...solicitacao, status: 'ENVIADA', tentativas: 2, identificadorExterno: ident })),
  marcarSolicitacaoErro: vi.fn(async (_id: string, motivo: string) => ({ ...solicitacao, tentativas: 2, erroUltimaTentativa: motivo })),
  registrarWamidOutbound: vi.fn(async (d: { wamidOutbound: string; telefoneDestino: string }) => ({
    solicitacao: { ...solicitacao, status: 'ENVIADA', wamidOutbound: d.wamidOutbound, telefoneDestino: d.telefoneDestino },
    duplicado: false,
  })),
  registrarYcloudMessageIdPendente: vi.fn(async () => ({ ...solicitacao, status: 'ENVIADA' })),
}));

vi.mock('../../src/fretes/transportadorasRepositorio.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/transportadorasRepositorio.js')>()),
  buscarTransportadoraPorId: vi.fn(async () => transportadora as Transportadora),
}));

vi.mock('../../src/fretes/fretesServico.js', () => ({
  servicoBuscarCotacao: vi.fn(async () => cotacaoAlterada),
}));

vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({
  registrarAuditoria: vi.fn(async () => undefined),
}));

async function carregar() {
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.exemplo.test',
    SMTP_PORT: '587',
    SMTP_USER: 'cotacao@etk.ind.br',
    SMTP_PASS: 'senha-de-teste',
    SMTP_FROM: 'cotacao@etk.ind.br',
    FRETES_EMAIL_OUTBOUND: 'smtp',
    YCLOUD_API_KEY: 'ycloud-api-key-de-teste',
    YCLOUD_WHATSAPP_FROM: '+5511900000000',
    YCLOUD_TEMPLATE_NOME: '',
    FRETES_WHATSAPP: 'ycloud',
  });
  vi.resetModules();
  return import('../../src/fretes/integracaoCotacoesServico.js');
}

function base(parcial: Partial<SolicitacaoCotacao>): SolicitacaoCotacao {
  return {
    id: 'sol-1',
    cotacaoFreteId: 'cot-1',
    transportadoraId: 'tr-1',
    status: 'ERRO',
    codigoReferencia: 'FRE-2026-000001-abcd1234',
    tentativas: 1,
    erroUltimaTentativa: 'falha anterior',
    embalagens: [{ altura: 0.27, largura: 0.36, comprimento: 0.77, quantidade: 6 }],
    destinoEnviado: DESTINO_ENVIADO,
    observacoesTransportadora: 'Doca 3 — ligar 30 min antes',
    ...parcial,
  } as SolicitacaoCotacao;
}

beforeEach(() => {
  enviadosSmtp.length = 0;
  chamadasYCloud.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      chamadasYCloud.push({ corpo: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ id: 'yc-1', wamid: 'wamid.R1', status: 'sent' }), { status: 200 });
    }),
  );
});

describe('Reenviar — endereço/observação do snapshot; destino do canal conforme a regra', () => {
  it('E-mail: reenvia para o e-mail SNAPSHOT (comportamento atual), com o endereço e a observação gravados na solicitação', async () => {
    solicitacao = base({ canal: 'EMAIL', emailDestino: 'original@transportadora.com.br', emailOrigem: 'CADASTRO' });
    transportadora = { id: 'tr-1', nomeRazaoSocial: 'T', email: 'novo-no-cadastro@transportadora.com.br' };
    const servico = await carregar();
    await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');

    expect(enviadosSmtp).toHaveLength(1);
    const email = enviadosSmtp[0] as { to: string; text: string; html: string };
    expect(email.to).toBe('original@transportadora.com.br');
    expect(email.text).toContain('Destino: Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP - CEP 01310-100');
    expect(email.text).not.toContain('Rua Diferente');
    expect(email.text).toContain('Observações para a transportadora: Doca 3 — ligar 30 min antes');
  });

  it('WhatsApp: reenvia para o número ATUAL do cadastro (não o original), com endereço e observação do snapshot', async () => {
    solicitacao = base({ canal: 'WHATSAPP', emailDestino: null, emailOrigem: null, telefoneDestino: '+5511911111111' } as Partial<SolicitacaoCotacao>);
    transportadora = { id: 'tr-1', nomeRazaoSocial: 'T', whatsappCotacao: '11922222222' };
    const servico = await carregar();
    await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');

    expect(chamadasYCloud).toHaveLength(1);
    const corpo = chamadasYCloud[0]?.corpo as { to: string; text: { body: string } };
    expect(corpo.to).toBe('+5511922222222');
    expect(corpo.text.body).toContain('*Destino:* Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP - CEP 01310-100');
    expect(corpo.text.body).not.toContain('Rua Diferente');
    expect(corpo.text.body).toContain('*Observações para a transportadora:* Doca 3 — ligar 30 min antes');
  });

  it('WhatsApp: número removido/inválido no cadastro atual → reenvio bloqueado explicitamente (nunca usa o antigo)', async () => {
    solicitacao = base({ canal: 'WHATSAPP', emailDestino: null, emailOrigem: null, telefoneDestino: '+5511911111111' } as Partial<SolicitacaoCotacao>);
    transportadora = { id: 'tr-1', nomeRazaoSocial: 'T', whatsappCotacao: null };
    const servico = await carregar();
    await expect(servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1')).rejects.toThrow(/WHATSAPP_TRANSPORTADORA_NAO_CADASTRADO|WhatsApp/);
    expect(chamadasYCloud).toHaveLength(0);
  });

  it('WhatsApp texto: mensagem acima de 4096 caracteres → ERRO explícito, nada enviado (nunca cortada)', async () => {
    solicitacao = base({ canal: 'WHATSAPP', emailDestino: null, emailOrigem: null, observacoesTransportadora: 'x'.repeat(900) });
    transportadora = { id: 'tr-1', nomeRazaoSocial: 'T', whatsappCotacao: '11922222222' };
    const original = cotacaoAlterada.observacoes;
    cotacaoAlterada.observacoes = 'y'.repeat(3500);
    try {
      const servico = await carregar();
      const r = await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');
      expect(chamadasYCloud).toHaveLength(0);
      expect(r.erroUltimaTentativa).toMatch(/limite 4096/);
    } finally {
      cotacaoAlterada.observacoes = original;
    }
  });
});

describe('Reenviar em modo de contingência n8n', () => {
  it('solicitação com observação + canal roteado pelo n8n → reenvio recusado explicitamente (nada enviado)', async () => {
    solicitacao = base({ canal: 'EMAIL', emailDestino: 'original@transportadora.com.br', emailOrigem: 'CADASTRO' });
    transportadora = { id: 'tr-1', nomeRazaoSocial: 'T' };
    const servico = await carregar();
    const { config } = await import('../../src/config.js');
    config.fretesEmailOutbound = 'n8n';
    const n8n = await import('../../src/fretes/integracoes/n8nCliente.js');
    await expect(servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1')).rejects.toThrow('modo de contingência (n8n)');
    expect(n8n.enviarSolicitacaoAoN8n).not.toHaveBeenCalled();
    expect(enviadosSmtp).toHaveLength(0);
  });
});
