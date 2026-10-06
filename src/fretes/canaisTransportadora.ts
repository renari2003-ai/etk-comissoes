/**
 * Regras de canal da transportadora — módulo puro (sem banco, sem serviços), para ser usado
 * tanto pelo envio de solicitações quanto pela edição do cadastro sem criar dependência circular
 * (`braspressServico` importa `fretesServico`).
 */
import { config } from '../config.js';
import { emailValido, whatsappValido } from './validacao.js';
import type { CanalPrincipalTransportadora, Transportadora } from './tipos.js';

export type CanalEnvio = 'EMAIL' | 'WHATSAPP' | 'API';

export const CANAIS_ENVIO: readonly CanalEnvio[] = ['EMAIL', 'WHATSAPP', 'API'];

/** Única integração API existente. Identificada pelo nome, como sempre foi (ver `braspressServico.ts`). */
export function ehTransportadoraBraspress(t: Pick<Transportadora, 'nomeRazaoSocial' | 'nomeFantasia'>): boolean {
  return /braspress/i.test(t.nomeRazaoSocial) || /braspress/i.test(t.nomeFantasia ?? '');
}

/** Credenciais da API Braspress presentes no servidor (nunca expostas — só a presença é verificada). */
export function integracaoBraspressConfigurada(): boolean {
  return config.braspressCnpj.trim() !== '' && config.braspressPassword.trim() !== '';
}

/**
 * Canais realmente utilizáveis para a transportadora:
 * - EMAIL: e-mail para cotação válido no cadastro ETK, ou código Omie vinculado (o envio
 *   resolve MANUAL > CADASTRO > OMIE > bloqueio — Omie sem e-mail falha explicitamente).
 * - WHATSAPP: só com `whatsappCotacao` válido no cadastro. Nunca inferido de `telefone` nem de `canalPrincipal`.
 * - API: só integração cadastrada E configurada por nós — hoje, apenas a Braspress com as
 *   credenciais presentes no servidor (2026-10-06). `urlPortal` nunca conta como API.
 */
export function canaisDisponiveis(t: Transportadora): CanalEnvio[] {
  const canais: CanalEnvio[] = [];
  if (emailValido(t.email) || t.codigoClienteOmie !== null) canais.push('EMAIL');
  if (whatsappValido(t.whatsappCotacao)) canais.push('WHATSAPP');
  if (ehTransportadoraBraspress(t) && integracaoBraspressConfigurada()) canais.push('API');
  return canais;
}

export const MENSAGEM_API_NAO_CONFIGURADA =
  'A integração API da Braspress não está configurada no servidor — não é possível usá-la como canal agora.';

const MENSAGEM_CANAL_INDISPONIVEL: Record<CanalEnvio, string> = {
  EMAIL: 'Para usar E-mail como canal principal, cadastre um "E-mail para cotação" válido ou vincule o código Omie da transportadora.',
  WHATSAPP: 'Para usar WhatsApp como canal principal, cadastre um "WhatsApp para cotação" válido (DDD + número).',
  API: 'API só pode ser o canal principal de uma transportadora com integração existente e configurada (atualmente, apenas a Braspress).',
};

/**
 * Validação do canal principal ANTES de salvar o cadastro (edição de 2026-10-06): só aceita um
 * canal de envio que a transportadora — já com os dados que serão gravados — consegue usar.
 * Devolve a mensagem do problema, ou `null` quando está tudo certo. `null`/SITE (legado, só
 * informativo, nunca vira canal de envio) não exigem contato.
 */
export function problemaCanalPrincipal(t: Transportadora, canal: CanalPrincipalTransportadora | null): string | null {
  if (canal === null || canal === 'SITE') return null;
  if (canal === 'API' && ehTransportadoraBraspress(t) && !integracaoBraspressConfigurada()) {
    return MENSAGEM_API_NAO_CONFIGURADA;
  }
  if (!canaisDisponiveis(t).includes(canal)) return MENSAGEM_CANAL_INDISPONIVEL[canal];
  return null;
}
