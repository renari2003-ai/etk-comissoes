/**
 * Contrato JSON do webhook de entrada (Fase 4A.1, seção 20/43/44) — n8n → ETK. NUNCA confia
 * no payload (seção 22): todo campo é validado por tipo/tamanho/enum antes de tocar o
 * banco. `transportadora` propositalmente NÃO faz parte do contrato — a transportadora é
 * sempre derivada da solicitação encontrada por `referencia` (seção 23), nunca de um campo
 * solto do payload (evita associação frágil por nome/texto).
 */
import { ErroValidacao } from '../validacao.js';
import type { CanalOrigemProposta, DadosExtracaoProposta } from './tipos.js';
import {
  validarCanalOrigem,
  validarConfiancaOpcional,
  validarNumeroNaoNegativoOpcional,
  validarInteiroNaoNegativoOpcional,
  validarTextoComTamanhoMaximo,
  validarTextoObrigatorio,
} from './validacao.js';

/** Versão suportada do contrato (seção 44) — payloads com outra versão são rejeitados explicitamente, nunca interpretados "no melhor esforço". */
export const VERSAO_CONTRATO_WEBHOOK = 1;

const REFERENCIA_MAX = 100;
const MENSAGEM_ID_MAX = 300;
const CONTEUDO_BRUTO_MAX = 20000;
const OBSERVACOES_MAX = 4000;
const NUMERO_PROPOSTA_MAX = 100;
const TAXA_NOME_MAX = 200;
const MAX_TAXAS = 20;

export interface PayloadRespostaWebhook {
  referencia: string;
  canal: CanalOrigemProposta;
  mensagemId: string;
  conteudoBruto: string | null;
  /** Identifica quem gerou a extração (ex.: "n8n-ia-v1") — informativo, nunca usado em lógica de decisão. `"externo"` quando o remetente não informa. */
  versaoExtrator: string;
  extracao: DadosExtracaoProposta;
}

function validarTaxas(valor: unknown): { nome: string; valor: number }[] | null {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) throw new ErroValidacao('O campo "extracao.taxas" deve ser uma lista.');
  if (valor.length > MAX_TAXAS) throw new ErroValidacao(`O campo "extracao.taxas" excede o máximo de ${MAX_TAXAS} itens.`);
  return valor.map((item, indice) => {
    if (typeof item !== 'object' || item === null) {
      throw new ErroValidacao(`O item "extracao.taxas[${indice}]" deve ser um objeto.`);
    }
    const bruto = item as Record<string, unknown>;
    const nome = validarTextoComTamanhoMaximo(bruto.nome, `extracao.taxas[${indice}].nome`, TAXA_NOME_MAX);
    if (nome === null) throw new ErroValidacao(`O campo "extracao.taxas[${indice}].nome" é obrigatório.`);
    const valorNumerico = validarNumeroNaoNegativoOpcional(bruto.valor, `extracao.taxas[${indice}].valor`);
    if (valorNumerico === null) throw new ErroValidacao(`O campo "extracao.taxas[${indice}].valor" é obrigatório.`);
    return { nome, valor: valorNumerico };
  });
}

function validarDataOpcional(valor: unknown, campo: string): string | null {
  const texto = validarTextoComTamanhoMaximo(valor, campo, 10);
  if (texto === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new ErroValidacao(`O campo "${campo}" deve estar no formato AAAA-MM-DD.`);
  return texto;
}

function validarExtracao(valor: unknown): DadosExtracaoProposta {
  if (typeof valor !== 'object' || valor === null) throw new ErroValidacao('O campo "extracao" é obrigatório e deve ser um objeto.');
  const bruto = valor as Record<string, unknown>;
  return {
    valorFrete: validarNumeroNaoNegativoOpcional(bruto.valorFrete, 'extracao.valorFrete'),
    prazoDias: validarInteiroNaoNegativoOpcional(bruto.prazoDias, 'extracao.prazoDias'),
    validade: validarDataOpcional(bruto.validade, 'extracao.validade'),
    pedagio: validarNumeroNaoNegativoOpcional(bruto.pedagio, 'extracao.pedagio'),
    gris: validarNumeroNaoNegativoOpcional(bruto.gris, 'extracao.gris'),
    adValorem: validarNumeroNaoNegativoOpcional(bruto.adValorem, 'extracao.adValorem'),
    taxas: validarTaxas(bruto.taxas),
    observacoes: validarTextoComTamanhoMaximo(bruto.observacoes, 'extracao.observacoes', OBSERVACOES_MAX),
    numeroProposta: validarTextoComTamanhoMaximo(bruto.numeroProposta, 'extracao.numeroProposta', NUMERO_PROPOSTA_MAX),
    confianca: validarConfiancaOpcional(bruto.confianca),
  };
}

/** Lança `ErroValidacao` (400) para qualquer payload malformado — nunca lança exceção não tratada nem aceita "no melhor esforço". */
export function validarPayloadWebhookResposta(body: unknown): PayloadRespostaWebhook {
  if (typeof body !== 'object' || body === null) throw new ErroValidacao('Corpo da requisição inválido.');
  const bruto = body as Record<string, unknown>;

  const versao = bruto.versao;
  if (versao !== VERSAO_CONTRATO_WEBHOOK) {
    throw new ErroValidacao(`Versão de contrato não suportada (recebida: ${JSON.stringify(versao)}, esperada: ${VERSAO_CONTRATO_WEBHOOK}).`);
  }

  const referencia = validarTextoComTamanhoMaximo(bruto.referencia, 'referencia', REFERENCIA_MAX);
  if (referencia === null) throw new ErroValidacao('O campo "referencia" é obrigatório.');

  const canal = validarCanalOrigem(bruto.canal, 'canal');
  const mensagemId = validarTextoObrigatorio(bruto.mensagemId, 'mensagemId');
  if (mensagemId.length > MENSAGEM_ID_MAX) throw new ErroValidacao(`O campo "mensagemId" excede o tamanho máximo de ${MENSAGEM_ID_MAX} caracteres.`);
  const conteudoBruto = validarTextoComTamanhoMaximo(bruto.conteudoBruto, 'conteudoBruto', CONTEUDO_BRUTO_MAX);
  const versaoExtrator = validarTextoComTamanhoMaximo(bruto.versaoExtrator, 'versaoExtrator', 100) ?? 'externo';
  const extracao = validarExtracao(bruto.extracao);

  return { referencia, canal, mensagemId, conteudoBruto, versaoExtrator, extracao };
}
