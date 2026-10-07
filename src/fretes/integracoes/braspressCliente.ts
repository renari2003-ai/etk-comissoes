/**
 * Cliente isolado da API oficial de cotação da Braspress (Fase Braspress 1). Único ponto do
 * módulo de Fretes que fala com a Braspress: autenticação (Basic), request, timeout,
 * validação de entrada, normalização e tratamento de erro.
 *
 * Contrato validado na documentação oficial (https://api.braspress.com/home):
 * `POST /v1/cotacao/calcular/json`, Basic Auth (CNPJ:senha), resposta `{ id, prazo, totalFrete }`.
 * Cubagem em METROS (altura/largura/comprimento por item + `volumes` do item).
 *
 * Credenciais/URL vêm SEMPRE de `config` — nunca do frontend. Senha e header Authorization
 * nunca são logados nem incluídos em mensagens de erro.
 */
import { config } from '../../config.js';
import { sanitizarTextoErro } from './sanitizacao.js';

export interface ItemCubagemBraspress {
  /** Metros. */
  altura: number;
  largura: number;
  comprimento: number;
  /** Quantidade de volumes com estas dimensões. */
  volumes: number;
}

export interface EntradaCotacaoBraspress {
  cnpjDestinatario: string | null;
  cepOrigem: string | null;
  cepDestino: string | null;
  valorMercadoria: number | null;
  peso: number | null;
  volumes: number | null;
  /** 'CIF' → tipoFrete 1, 'FOB' → tipoFrete 2. */
  tipoFrete: 'CIF' | 'FOB';
  cubagem: ItemCubagemBraspress[] | null;
}

export interface CotacaoBraspressNormalizada {
  transportadora: 'BRASPRESS';
  idCotacaoExterna: string;
  valorFrete: number;
  prazoDias: number | null;
  /** `validade` devolvida pela API (AAAA-MM-DD) — as cotações expiram 23:59:59 do dia. */
  validade: string | null;
}

export interface OpcoesBraspress {
  fetchImpl?: typeof fetch;
  cnpj?: string;
  senha?: string;
  url?: string;
  timeoutMs?: number;
}

export class ErroBraspressNaoConfigurada extends Error {
  constructor() {
    super('INTEGRACAO_BRASPRESS_NAO_CONFIGURADA: configure BRASPRESS_CNPJ e BRASPRESS_PASSWORD no servidor.');
    this.name = 'ErroBraspressNaoConfigurada';
  }
}

/** Dados obrigatórios ausentes — nunca inventados; `faltando` lista exatamente o que precisa ser informado. */
export class ErroDadosBraspressIncompletos extends Error {
  constructor(readonly faltando: string[]) {
    super(`Dados insuficientes para cotar na Braspress. Faltando: ${faltando.join(', ')}.`);
    this.name = 'ErroDadosBraspressIncompletos';
  }
}

/** Timeout/rede/HTTP não-2xx/resposta inválida — mensagem sempre sanitizada. */
export class ErroBraspressFalhou extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ErroBraspressFalhou';
  }
}

function soDigitos(valor: string | null): string {
  return (valor ?? '').replace(/\D/g, '');
}

function positivo(v: number | null): v is number {
  return v !== null && Number.isFinite(v) && v > 0;
}

/** Lista o que falta/é inválido; vazio = pronto para cotar. */
export function validarEntradaBraspress(entrada: EntradaCotacaoBraspress, cnpjRemetente: string): string[] {
  const faltando: string[] = [];
  if (soDigitos(cnpjRemetente).length !== 14) faltando.push('CNPJ remetente (BRASPRESS_CNPJ)');
  if (soDigitos(entrada.cnpjDestinatario).length !== 14) faltando.push('CNPJ do destinatário');
  if (soDigitos(entrada.cepOrigem).length !== 8) faltando.push('CEP de origem');
  if (soDigitos(entrada.cepDestino).length !== 8) faltando.push('CEP de destino');
  if (!positivo(entrada.valorMercadoria)) faltando.push('valor da mercadoria');
  if (!positivo(entrada.peso)) faltando.push('peso');
  if (entrada.volumes === null || !Number.isInteger(entrada.volumes) || entrada.volumes <= 0) faltando.push('volumes');
  if (entrada.cubagem === null || entrada.cubagem.length === 0) {
    faltando.push('cubagem (altura, largura e comprimento em metros)');
  } else if (
    entrada.cubagem.some(
      (i) => !positivo(i.altura) || !positivo(i.largura) || !positivo(i.comprimento) || !Number.isInteger(i.volumes) || i.volumes <= 0,
    )
  ) {
    faltando.push('cubagem válida (altura, largura, comprimento e volumes positivos)');
  }
  return faltando;
}

export async function cotarNaBraspress(entrada: EntradaCotacaoBraspress, opcoes: OpcoesBraspress = {}): Promise<CotacaoBraspressNormalizada> {
  const cnpj = (opcoes.cnpj ?? config.braspressCnpj).trim();
  const senha = (opcoes.senha ?? config.braspressPassword).trim();
  if (cnpj === '' || senha === '') throw new ErroBraspressNaoConfigurada();

  const faltando = validarEntradaBraspress(entrada, cnpj);
  if (faltando.length > 0) throw new ErroDadosBraspressIncompletos(faltando);

  const corpo = {
    cnpjRemetente: Number(soDigitos(cnpj)),
    cnpjDestinatario: Number(soDigitos(entrada.cnpjDestinatario)),
    modal: 'R',
    tipoFrete: entrada.tipoFrete === 'FOB' ? '2' : '1',
    cepOrigem: Number(soDigitos(entrada.cepOrigem)),
    cepDestino: Number(soDigitos(entrada.cepDestino)),
    vlrMercadoria: entrada.valorMercadoria,
    peso: entrada.peso,
    volumes: entrada.volumes,
    cubagem: entrada.cubagem,
  };

  const url = opcoes.url ?? config.braspressUrl;
  const timeoutMs = opcoes.timeoutMs ?? config.braspressTimeoutMs;
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const autorizacao = `Basic ${Buffer.from(`${cnpj}:${senha}`).toString('base64')}`;

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    let resposta: Response;
    try {
      resposta = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: autorizacao },
        body: JSON.stringify(corpo),
        signal: controlador.signal,
      });
    } catch (erro) {
      if (erro instanceof Error && erro.name === 'AbortError') {
        throw new ErroBraspressFalhou(`Tempo limite excedido (${timeoutMs}ms) ao consultar a Braspress.`);
      }
      throw new ErroBraspressFalhou('Falha de rede ao consultar a Braspress.');
    }
    let json: unknown;
    try {
      json = await resposta.json();
    } catch {
      if (!resposta.ok) throw new ErroBraspressFalhou(`A Braspress respondeu HTTP ${resposta.status}.`);
      throw new ErroBraspressFalhou('Resposta da Braspress não é um JSON válido.');
    }
    const objeto = typeof json === 'object' && json !== null ? json as Record<string, unknown> : null;
    // Contrato oficial de erro: statusCode/message/errorList. Não expõe o corpo bruto.
    if (!resposta.ok || (objeto && Number(objeto.statusCode) >= 400)) {
      const mensagens = [objeto?.message, ...(Array.isArray(objeto?.errorList) ? objeto.errorList : [])]
        .map((item) => typeof item === 'string' ? item : (typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).message === 'string' ? (item as Record<string, unknown>).message as string : ''))
        .filter(Boolean);
      const detalhe = sanitizarTextoErro(mensagens.join('; '), [senha, autorizacao, Buffer.from(`${cnpj}:${senha}`).toString('base64')]).slice(0, 1000);
      const codigo = !resposta.ok ? resposta.status : Number(objeto?.statusCode);
      const resumo = codigo === 401 ? 'A Braspress recusou a autenticação' : 'A Braspress recusou a cotação';
      throw new ErroBraspressFalhou(`${resumo} (HTTP ${codigo}).${detalhe ? ` ${detalhe}` : ''}`);
    }
    return normalizarRespostaBraspress(json);
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizarRespostaBraspress(json: unknown): CotacaoBraspressNormalizada {
  if (typeof json !== 'object' || json === null) throw new ErroBraspressFalhou('Resposta da Braspress inesperada.');
  const bruto = json as Record<string, unknown>;
  const id = bruto.id;
  const total = typeof bruto.totalFrete === 'string' ? Number(bruto.totalFrete) : bruto.totalFrete;
  if ((typeof id !== 'number' && typeof id !== 'string') || String(id).trim() === '') {
    throw new ErroBraspressFalhou('Resposta da Braspress sem o identificador da cotação.');
  }
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    throw new ErroBraspressFalhou('Resposta da Braspress sem um valor de frete válido.');
  }
  const prazoNum = typeof bruto.prazo === 'string' ? Number(bruto.prazo) : bruto.prazo;
  const prazoDias = typeof prazoNum === 'number' && Number.isInteger(prazoNum) && prazoNum >= 0 ? prazoNum : null;
  const validade = typeof bruto.validade === 'string' && /^\d{4}-\d{2}-\d{2}/.test(bruto.validade) ? bruto.validade.slice(0, 10) : null;
  return { transportadora: 'BRASPRESS', idCotacaoExterna: String(id), valorFrete: total, prazoDias, validade };
}
