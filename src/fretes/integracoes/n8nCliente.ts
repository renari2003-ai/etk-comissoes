/**
 * Camada isolada da chamada OUTBOUND ETK → n8n (Fase 4A.2, seção 9). Único ponto do módulo
 * de Fretes que monta/envia essa requisição HTTP — `integracaoCotacoesServico.ts` nunca usa
 * `fetch` diretamente, só chama `enviarSolicitacaoAoN8n`.
 *
 * URL e segredo vêm EXCLUSIVAMENTE de `config` (variáveis de ambiente do servidor) — nunca
 * de payload do frontend/usuário (seção 36/37: evita SSRF via URL escolhida pelo cliente).
 */
import { config } from '../../config.js';

/** Contrato versionado outbound (seção 12/19) — campos reais do domínio, nunca dado comercial interno (seção 13). */
export interface PayloadSolicitacaoN8n {
  versao: 1;
  evento: 'SOLICITACAO_COTACAO';
  solicitacaoId: string;
  referencia: string;
  cotacaoId: string;
  /**
   * `email`/`fonteEmail` (Fase 4A.4.1, seção 9) são o destinatário JÁ RESOLVIDO pelo ETK
   * (regra MANUAL > OMIE > bloqueio) — `null` para canais diferentes de EMAIL. O n8n nunca
   * decide a fonte nem consulta a Omie; só usa o valor recebido aqui.
   */
  transportadora: {
    id: string;
    email: string | null;
    fonteEmail: 'OMIE' | 'MANUAL' | 'CADASTRO' | null;
    /** Aditivo (compatível com `versao: 1`): `whatsappCotacao` do cadastro, só dígitos — preenchido só no canal WHATSAPP, `null` nos demais. */
    whatsapp: string | null;
  };
  canal: string;
  logistica: {
    origem: string | null;
    destino: string | null;
    cepOrigem: string | null;
    cepDestino: string | null;
    pesoBruto: number | null;
    pesoLiquido: number | null;
    peso: number | null;
    volumes: number | null;
    especie: string | null;
    /**
     * Aditivos (compatível com `versao: 1`) — só dígitos, `null` quando não disponível/válido
     * (nunca inventado). Origem = CNPJ da ETK (`FRETES_CNPJ_ORIGEM`); destino = CNPJ do
     * cliente da cotação no cadastro Omie (consulta somente leitura).
     */
    cnpjOrigem: string | null;
    cnpjDestino: string | null;
  };
}

/** Fail-closed (seção 8): configuração ausente nunca vira envio silencioso, sempre um erro controlado e sinalizável. */
export class ErroIntegracaoN8nNaoConfigurada extends Error {
  constructor() {
    super('INTEGRACAO_N8N_NAO_CONFIGURADA: configure N8N_WEBHOOK_URL e N8N_WEBHOOK_SECRET no servidor.');
    this.name = 'ErroIntegracaoN8nNaoConfigurada';
  }
}

/** Normaliza timeout/erro de rede/HTTP não-2xx num único tipo — mensagem sempre sanitizada (nunca inclui o segredo, seção 31). */
export class ErroEnvioN8nFalhou extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ErroEnvioN8nFalhou';
  }
}

export interface ResultadoEnvioN8n {
  statusHttp: number;
}

/**
 * Envia UMA solicitação de cotação ao n8n. Timeout explícito via `AbortController` (seção
 * 10) — nunca deixa a conexão aberta indefinidamente. Uma única tentativa por chamada
 * (seção 11: nada de retry automático em loop aqui; reenvio é ação humana explícita, ver
 * `servicoReenviarSolicitacao`).
 */
export async function enviarSolicitacaoAoN8n(payload: PayloadSolicitacaoN8n): Promise<ResultadoEnvioN8n> {
  const url = config.n8nWebhookUrl.trim();
  const secret = config.n8nWebhookSecret.trim();
  if (url === '' || secret === '') throw new ErroIntegracaoN8nNaoConfigurada();

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), config.n8nTimeoutMs);
  try {
    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-n8n-webhook-secret': secret },
        body: JSON.stringify(payload),
        signal: controlador.signal,
      });
    } catch (erro) {
      if (erro instanceof Error && erro.name === 'AbortError') {
        throw new ErroEnvioN8nFalhou(`Tempo limite excedido (${config.n8nTimeoutMs}ms) ao chamar o webhook do n8n.`);
      }
      throw new ErroEnvioN8nFalhou('Falha de rede ao chamar o webhook do n8n.');
    }
    if (!resposta.ok) {
      throw new ErroEnvioN8nFalhou(`O webhook do n8n respondeu HTTP ${resposta.status}.`);
    }
    return { statusHttp: resposta.status };
  } finally {
    clearTimeout(timeout);
  }
}
