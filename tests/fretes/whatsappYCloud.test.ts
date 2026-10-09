import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import type { CotacaoFrete, SolicitacaoCotacao, Transportadora } from '../../src/fretes/tipos.js';

// Canal WHATSAPP pela YCloud direto (padrão) × n8n (rollback). Repositórios, n8n e `fetch`
// simulados — nenhum banco real, nenhuma chamada real à YCloud.

const CHAVE = 'ycloud-api-key-de-teste-0123456789';
const auditorias: { acao: string; valorNovo?: unknown }[] = [];
let respostaYCloud: { status: number; corpo: unknown } = { status: 200, corpo: { id: 'yc-1', wamid: 'wamid.ENVIO1', status: 'sent' } };
const chamadasYCloud: { url: string; corpo: Record<string, unknown>; headers: Record<string, string> }[] = [];
let transportadora: Partial<Transportadora> = { id: 'tr-1', nomeRazaoSocial: 'ETK Teste', whatsappCotacao: '11987654321', telefone: '1133334444' };

const solicitacao = {
  id: 'sol-1',
  cotacaoFreteId: 'cot-1',
  transportadoraId: 'tr-1',
  canal: 'WHATSAPP',
  status: 'ERRO',
  codigoReferencia: 'FRE-2026-000001-abcd1234',
  tentativas: 1,
  erroUltimaTentativa: 'falha anterior',
  emailDestino: null,
  emailOrigem: null,
  embalagens: [{ altura: 0.27, largura: 0.36, comprimento: 0.77, quantidade: 6 }],
} as unknown as SolicitacaoCotacao;

vi.mock('../../src/fretes/integracoes/n8nCliente.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/integracoes/n8nCliente.js')>()),
  enviarSolicitacaoAoN8n: vi.fn(async () => ({ statusHttp: 200 })),
}));

vi.mock('../../src/fretes/solicitacoesRepositorio.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/solicitacoesRepositorio.js')>()),
  buscarSolicitacaoPorId: vi.fn(async () => solicitacao),
  marcarSolicitacaoEnviada: vi.fn(async (_id: string, ident: string | null) => ({ ...solicitacao, status: 'ENVIADA', tentativas: 2, erroUltimaTentativa: null, identificadorExterno: ident })),
  marcarSolicitacaoErro: vi.fn(async (_id: string, motivo: string) => ({ ...solicitacao, tentativas: 2, erroUltimaTentativa: motivo })),
  registrarWamidOutbound: vi.fn(async (d: { wamidOutbound: string; ycloudMessageId: string; telefoneDestino: string }) => ({
    solicitacao: { ...solicitacao, status: 'ENVIADA', wamidOutbound: d.wamidOutbound, ycloudMessageId: d.ycloudMessageId, telefoneDestino: d.telefoneDestino },
    duplicado: false,
  })),
  registrarYcloudMessageIdPendente: vi.fn(async () => ({ ...solicitacao, status: 'ENVIADA' })),
}));

vi.mock('../../src/fretes/transportadorasRepositorio.js', async (original) => ({
  ...(await original<typeof import('../../src/fretes/transportadorasRepositorio.js')>()),
  buscarTransportadoraPorId: vi.fn(async () => transportadora as Transportadora),
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
        valorMercadoria: 264.72,
        especieVolumes: 'CAIXA',
        modalidade: 'CIF',
        observacoes: 'Cobrar TDE no destino',
      }) as CotacaoFrete,
  ),
}));

vi.mock('../../src/fretes/auditoriaRepositorio.js', () => ({
  registrarAuditoria: vi.fn(async (d: { acao: string; valorNovo?: unknown }) => {
    auditorias.push(d);
  }),
}));

async function carregar(caminho: 'ycloud' | 'n8n' | 'meta', extra: Record<string, string> = {}) {
  Object.assign(process.env, { YCLOUD_API_KEY: CHAVE, YCLOUD_WHATSAPP_FROM: '+5511900000000', YCLOUD_TEMPLATE_NOME: '', FRETES_WHATSAPP: caminho, ...extra });
  vi.resetModules();
  return {
    servico: await import('../../src/fretes/integracaoCotacoesServico.js'),
    n8n: await import('../../src/fretes/integracoes/n8nCliente.js'),
    repo: await import('../../src/fretes/solicitacoesRepositorio.js'),
  };
}

beforeEach(() => {
  auditorias.length = 0;
  chamadasYCloud.length = 0;
  respostaYCloud = { status: 200, corpo: { id: 'yc-1', wamid: 'wamid.ENVIO1', status: 'sent' } };
  transportadora = { id: 'tr-1', nomeRazaoSocial: 'ETK Teste', whatsappCotacao: '11987654321', telefone: '1133334444' };
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      chamadasYCloud.push({ url, corpo: JSON.parse(String(init.body)) as Record<string, unknown>, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(respostaYCloud.corpo), { status: respostaYCloud.status });
    }),
  );
});

describe('canal WHATSAPP pela YCloud direto', () => {
  it('Meta envia template à Graph API e grava WAMID sem identificador YCloud', async () => {
    respostaYCloud = { status: 200, corpo: { messages: [{ id: 'wamid.META1' }] } };
    const { servico, repo, n8n } = await carregar('meta', { META_WHATSAPP_ACCESS_TOKEN: 'token-meta-teste', META_WHATSAPP_PHONE_NUMBER_ID: '1433778859808018', META_WHATSAPP_TEMPLATE_NOME: 'cotacao_frete_etk' });
    await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');
    expect(chamadasYCloud[0]?.url).toBe('https://graph.facebook.com/v26.0/1433778859808018/messages');
    expect(chamadasYCloud[0]?.corpo).toMatchObject({ messaging_product: 'whatsapp', to: '5511987654321', type: 'template' });
    const t = chamadasYCloud[0]?.corpo.template as { components: { parameters: { text: string }[] }[] };
    expect(t.components[0]?.parameters[3]?.text).toContain('264,72');
    expect(t.components[0]?.parameters[3]?.text).toContain('80 kg');
    expect(repo.registrarWamidOutbound).toHaveBeenCalledWith(expect.objectContaining({ wamidOutbound: 'wamid.META1', ycloudMessageId: null }));
    expect(n8n.enviarSolicitacaoAoN8n).not.toHaveBeenCalled();
  });
  it('Meta sem template recusa e nunca tenta YCloud ou n8n', async () => {
    const { servico, n8n } = await carregar('meta', { META_WHATSAPP_TEMPLATE_NOME: '' });
    const r = await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');
    expect(r.erroUltimaTentativa).toContain('META_TEMPLATE_NAO_CONFIGURADO');
    expect(chamadasYCloud).toHaveLength(0);
    expect(n8n.enviarSolicitacaoAoN8n).not.toHaveBeenCalled();
  });
  it('padrão: envia à YCloud (sem n8n) para o whatsapp_cotacao, com a mensagem completa; grava wamid; ENVIADA', async () => {
    const { servico, n8n, repo } = await carregar('ycloud');
    const r = await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');

    expect(n8n.enviarSolicitacaoAoN8n).not.toHaveBeenCalled();
    expect(chamadasYCloud).toHaveLength(1);
    const corpo = chamadasYCloud[0]?.corpo as { to: string; type: string; text: { body: string } };
    expect(corpo.to).toBe('+5511987654321'); // whatsapp_cotacao, nunca o telefone genérico
    expect(corpo.type).toBe('text');
    for (const trecho of ['FRE-2026-000001-abcd1234', 'Modalidade:* CIF', 'Peso total:* 80 kg', 'Total de volumes:* 6 (CAIXA)', 'Quantidade: 6 | Medidas: 0,77 x 0,36 x 0,27 m', '⚠️ Cobrar TDE no destino', 'VALOR_FRETE:']) {
      expect(corpo.text.body).toContain(trecho);
    }
    expect(repo.marcarSolicitacaoEnviada).toHaveBeenCalledWith('sol-1', 'yc-1');
    expect(repo.registrarWamidOutbound).toHaveBeenCalledWith(expect.objectContaining({ solicitacaoId: 'sol-1', wamidOutbound: 'wamid.ENVIO1', ycloudMessageId: 'yc-1', telefoneDestino: '+5511987654321' }));
    expect(r).toMatchObject({ status: 'ENVIADA', wamidOutbound: 'wamid.ENVIO1' });
    expect(auditorias).toEqual([expect.objectContaining({ acao: 'SOLICITACAO_ENVIADA_YCLOUD', valorNovo: expect.objectContaining({ statusYCloud: 'sent', wamid: 'wamid.ENVIO1' }) })]);
  });

  it('YCloud aceita sem wamid ainda: guarda o id da YCloud para o webhook de status completar', async () => {
    respostaYCloud = { status: 200, corpo: { id: 'yc-2', status: 'accepted' } };
    const { servico, repo } = await carregar('ycloud');
    await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');
    expect(repo.registrarYcloudMessageIdPendente).toHaveBeenCalledWith('sol-1', 'yc-2', '+5511987654321');
    expect(repo.registrarWamidOutbound).not.toHaveBeenCalled();
  });

  it('template configurado: envia template com os parâmetros na ordem documentada', async () => {
    const { servico } = await carregar('ycloud', { YCLOUD_TEMPLATE_NOME: 'cotacao_frete_etk' });
    await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');
    const t = (chamadasYCloud[0]?.corpo as { template: { name: string; components: { parameters: { text: string }[] }[] } }).template;
    expect(t.name).toBe('cotacao_frete_etk');
    const p = t.components[0]?.parameters.map((x) => x.text) ?? [];
    expect(p[0]).toBe('FRE-2026-000001-abcd1234');
    expect(p[4]).toContain('Quantidade: 6');
    expect(p[5]).toBe('Cobrar TDE no destino');
    expect(p.every((x) => !/[\n\t]/.test(x))).toBe(true);
  });

  it('YCloud rejeita → ERRO com motivo sanitizado (sem a API key) e auditoria', async () => {
    respostaYCloud = { status: 400, corpo: { errorCode: 'INVALID_PARAMETER', errorMessage: `to is not a valid WhatsApp number key=${CHAVE}` } };
    const { servico, repo } = await carregar('ycloud');
    const r = await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');
    const motivo = vi.mocked(repo.marcarSolicitacaoErro).mock.calls[0]?.[1] ?? '';
    expect(r.status).toBe('ERRO');
    expect(motivo).toMatch(/^YCLOUD_DESTINO_INVALIDO: /);
    expect(JSON.stringify([motivo, auditorias])).not.toContain(CHAVE);
    expect(auditorias).toEqual([expect.objectContaining({ acao: 'SOLICITACAO_ERRO_YCLOUD' })]);
  });

  it('whatsapp_cotacao inválido bloqueia antes de chamar a YCloud (nunca usa o telefone genérico)', async () => {
    transportadora = { ...transportadora, whatsappCotacao: null };
    const { servico } = await carregar('ycloud');
    await expect(servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1')).rejects.toThrow(/WHATSAPP_TRANSPORTADORA_NAO_CADASTRADO/);
    expect(chamadasYCloud).toHaveLength(0);
  });

  it('rollback FRETES_WHATSAPP=n8n: volta ao webhook do n8n e não chama a YCloud', async () => {
    const { servico, n8n } = await carregar('n8n');
    await servico.servicoReenviarSolicitacao({} as ClienteOmie, 'sol-1', 'u-1');
    expect(n8n.enviarSolicitacaoAoN8n).toHaveBeenCalledTimes(1);
    expect(chamadasYCloud).toHaveLength(0);
  });
});
