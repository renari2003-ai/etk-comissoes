import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { exigirAdministrador, exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import { ErroSemPermissao } from '../auth/erros.js';
import { config } from '../config.js';
import type { ClienteOmie } from '../omie/cliente.js';
import type { TipoDocumento } from '../omie/classificacaoDocumento.js';
import { ErroValidacao } from '../validacao.js';
import {
  servicoAprovarValorMinimo,
  servicoAtualizarCotacao,
  servicoAtualizarParametrosFiscais,
  servicoAtualizarTransportadora,
  servicoAtualizarVeiculo,
  servicoBuscarComposicaoPorProposta,
  servicoBuscarCotacao,
  servicoBuscarFechamento,
  servicoBuscarParametrosFiscais,
  servicoCalcularPreviewComposicao,
  servicoCancelarCotacao,
  servicoCompararPropostas,
  servicoCriarCotacao,
  servicoCriarCotacaoDeOmie,
  servicoCriarProposta,
  servicoCriarTransportadora,
  servicoCriarVeiculo,
  servicoDashboard,
  servicoDefinirAtivaTransportadora,
  servicoDefinirAtivoVeiculo,
  servicoDescartarPropostaLogistica,
  servicoDetalheHistoricoFrete,
  servicoEscolherFreteVencedor,
  servicoFecharCotacao,
  servicoLiberarPropostaLogistica,
  servicoListarAprovacoesValorMinimo,
  servicoListarCentralLogistica,
  servicoListarCentralVendedor,
  servicoListarCotacoes,
  servicoListarPropostas,
  servicoListarTransportadoras,
  servicoListarVeiculos,
  servicoMarcarPropostaEmNegociacao,
  servicoPrepararCotacaoDeOmie,
  servicoRegistrarComposicaoComercial,
  servicoRejeitarProposta,
  servicoRejeitarValorMinimo,
  servicoResumoClienteHistorico,
  servicoSelecionarProposta,
  servicoSolicitarAprovacaoValorMinimo,
  servicoBuscarClientesHistorico,
  servicoListarHistoricoCliente,
} from '../fretes/fretesServico.js';
import {
  servicoBuscarOrigemProposta,
  servicoListarInboxPropostas,
  servicoListarSolicitacoes,
  servicoProcessarRespostaWebhook,
  servicoReenviarSolicitacao,
  servicoRegistrarOutboundWhatsapp,
  servicoResolverReferenciaPorWamidOutbound,
  servicoSolicitarCotacoes,
  servicoValidarProposta,
} from '../fretes/integracaoCotacoesServico.js';
import { aplicarObservacaoTde } from '../fretes/origemEtk.js';
import {
  CANAIS_ENVIO,
  LIMITE_TRANSPORTADORAS_POR_ENVIO,
  servicoBuscarTransportadorasParaSolicitacao,
  servicoConfirmarCadastroTransportadora,
  servicoEnviarSolicitacoes,
  type CanalEnvio,
} from '../fretes/envioSolicitacoesServico.js';
import { servicoBuscarTransportadoraOmie } from '../fretes/transportadoraOmieServico.js';
import { ErroCnpjDestinatarioNaoDisponivel, ErroDadosCotacaoIncompletos, servicoCotarBraspress } from '../fretes/braspressServico.js';
import {
  ErroBraspressFalhou,
  ErroBraspressNaoConfigurada,
  type ItemCubagemBraspress,
} from '../fretes/integracoes/braspressCliente.js';
import type { CanalOrigemProposta, ModalidadeExecucao, StatusCotacao } from '../fretes/tipos.js';
import {
  validarCanalOrigem,
  validarCanalPrincipalOpcional,
  validarCnpjOpcional,
  validarDestinoManualOpcional,
  validarEmailOpcional,
  validarIdOmieOpcional,
  validarInteiroNaoNegativoOpcional,
  validarModalidade,
  validarModalidadeExecucao,
  validarNumeroNaoNegativoObrigatorio,
  validarNumeroNaoNegativoOpcional,
  validarTextoComTamanhoMaximo,
  validarTextoObrigatorio,
  validarTextoOpcional,
  validarUuid,
  validarUuidOpcional,
  validarWhatsappOpcional,
} from '../fretes/validacao.js';
import {
  validarPayloadCorrelacionarWhatsapp,
  validarPayloadOutboundWhatsapp,
  validarPayloadWebhookResposta,
} from '../fretes/webhookCotacoes.js';
import { assincrono } from './erroHttp.js';

const MODALIDADES_EXECUCAO_VALIDAS: readonly ModalidadeExecucao[] = ['TRANSPORTADORA', 'VEICULO_PROPRIO', 'RETIRA'];
function validarModalidadeExecucaoOpcional(valor: unknown): ModalidadeExecucao | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'string' || !MODALIDADES_EXECUCAO_VALIDAS.includes(valor as ModalidadeExecucao)) {
    throw new ErroValidacao(`O parâmetro "modalidadeExecucao" deve ser um dos: ${MODALIDADES_EXECUCAO_VALIDAS.join(', ')}.`);
  }
  return valor as ModalidadeExecucao;
}

const STATUS_VALIDOS: readonly StatusCotacao[] = [
  'RASCUNHO',
  'AGUARDANDO_PROPOSTAS',
  'EM_ANALISE',
  'AGUARDANDO_APROVACAO',
  'FECHADA',
  'CANCELADA',
];

function validarStatusOpcional(valor: unknown): StatusCotacao | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'string' || !STATUS_VALIDOS.includes(valor as StatusCotacao)) {
    throw new ErroValidacao(`O parâmetro "status" deve ser um dos: ${STATUS_VALIDOS.join(', ')}.`);
  }
  return valor as StatusCotacao;
}

/**
 * Autenticação máquina-a-máquina do webhook de cotações (Fase 4A.1, seção 20/21/52) — NUNCA
 * depende de cookie/sessão de usuário. Compara com `timingSafeEqual` (evita side-channel de
 * tempo) e falha fechado: segredo não configurado (`config.fretesWebhookSecret` vazio)
 * rejeita TODA chamada, nunca trata "sem segredo" como "sem proteção". O valor do segredo
 * nunca é logado, só o resultado (autorizado/negado).
 */
function exigirSegredoWebhookFretes(req: Request, _res: Response, next: NextFunction): void {
  const segredoConfigurado = config.fretesWebhookSecret;
  const segredoRecebido = req.header('x-fretes-webhook-secret') ?? '';
  if (segredoConfigurado.trim() === '' || segredoRecebido === '') {
    next(new ErroSemPermissao('Webhook não autorizado.'));
    return;
  }
  const bufferConfigurado = Buffer.from(segredoConfigurado);
  const bufferRecebido = Buffer.from(segredoRecebido);
  const autorizado = bufferConfigurado.length === bufferRecebido.length && timingSafeEqual(bufferConfigurado, bufferRecebido);
  if (!autorizado) {
    next(new ErroSemPermissao('Webhook não autorizado.'));
    return;
  }
  next();
}

/** Lista de embalagens (cubagem Braspress) — até 50 itens, cada campo numérico validado. */
function validarCubagemOpcional(bruto: unknown): ItemCubagemBraspress[] | null {
  if (bruto === undefined || bruto === null) return null;
  if (!Array.isArray(bruto) || bruto.length > 50) throw new ErroValidacao('O campo "cubagem" deve ser uma lista de até 50 itens.');
  return bruto.map((item: Record<string, unknown>, i: number) => ({
    altura: validarNumeroNaoNegativoObrigatorio(item?.altura, `cubagem[${i}].altura`),
    largura: validarNumeroNaoNegativoObrigatorio(item?.largura, `cubagem[${i}].largura`),
    comprimento: validarNumeroNaoNegativoObrigatorio(item?.comprimento, `cubagem[${i}].comprimento`),
    volumes: validarNumeroNaoNegativoObrigatorio(item?.volumes, `cubagem[${i}].volumes`),
  }));
}

function validarCanalEnvio(valor: unknown, campo: string): CanalEnvio {
  if (typeof valor !== 'string' || !CANAIS_ENVIO.includes(valor as CanalEnvio)) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um dos: ${CANAIS_ENVIO.join(', ')}.`);
  }
  return valor as CanalEnvio;
}

function validarTipoDocumentoOmie(valor: unknown): TipoDocumento {
  if (valor !== 'ORCAMENTO' && valor !== 'PEDIDO') {
    throw new ErroValidacao('O campo "tipoDocumento" deve ser ORCAMENTO ou PEDIDO (o tipo conferido na consulta).');
  }
  return valor;
}

function validarCanalOpcional(valor: unknown): CanalOrigemProposta {
  if (valor === undefined || valor === null || valor === '') return 'EMAIL';
  return validarCanalOrigem(valor, 'canal');
}

/**
 * Fase 4A.8 — gate de "porta" do Histórico por Cliente: `fretesComercial` OU `fretesGerencia`
 * (administrador sempre passa). Um `exigirPermissao('fretesComercial')` sozinho bloquearia um
 * usuário só-gerência antes mesmo de chegar no serviço — mesmo bug já corrigido em
 * `exigirAcessoComercial` (Fase 4A.7) para o fluxo de aprovação; aqui a rota já nasce certa.
 * A restrição fina por vendedor continua só no serviço (`resolverRestricaoVendedorHistorico`).
 */
function exigirAcessoHistorico(req: Request, _res: Response, next: NextFunction): void {
  if (req.usuario === undefined) {
    next(new ErroSemPermissao('Não autenticado.'));
    return;
  }
  if (req.usuario.papel === 'administrador' || req.usuario.permissoes.fretesComercial || req.usuario.permissoes.fretesGerencia) {
    next();
    return;
  }
  next(new ErroSemPermissao('Você não tem permissão para ver o histórico de fretes (permissão "fretesComercial" ou "fretesGerencia" necessária).'));
}

/** Fase 4A.7 — percentual fiscal (PIS/COFINS/ICMS): 0–100 ou `null` explícito ("ainda não configurado"), nunca inferido. */
function validarPercentualFiscalOpcional(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (Number.isNaN(numero) || numero < 0 || numero > 100) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um percentual entre 0 e 100.`);
  }
  return numero;
}

/**
 * Rotas do módulo de Fretes (Fase 1) — cada rota leva `exigirAutenticacao` +
 * `exigirPermissao('fretes')` DIRETO nela, nunca via `app.use(middleware, rotas)` no
 * nível de `server.ts` (mesmo motivo documentado nas demais rotas do projeto: um
 * middleware "global" nesse nível rodaria pra qualquer requisição que chegasse até
 * aqui, mesmo sem bater com nenhuma rota abaixo).
 */
export function criarRotaFretes(cliente: ClienteOmie): Router {
  const rotas = Router();
  const protegida = [exigirAutenticacao, exigirPermissao('fretes')] as const;

  // --- Importação de pedido Omie (Fase 3.2) ---------------------------------

  // Fase 4A.5 (seção 1/6): Pedido e Orçamento são o MESMO documento na Omie — as duas rotas
  // abaixo chamam exatamente o mesmo serviço, só variando o `tipoDocumento` esperado. A
  // checagem de tipo acontece em `prepararCotacaoDeOmie` (nunca aqui) — se o número informado
  // na rota de Pedido resolver para um documento classificado como Orçamento (ou vice-versa),
  // o serviço rejeita explicitamente (nunca importa com o rótulo errado).
  rotas.get(
    '/api/fretes/omie/pedidos/:numero/preparar',
    ...protegida,
    assincrono(async (req, res) => {
      const numero = validarTextoObrigatorio(req.params.numero, 'numero');
      res.json(await servicoPrepararCotacaoDeOmie(cliente, numero, 'PEDIDO'));
    }),
  );

  rotas.post(
    '/api/fretes/omie/pedidos/:numero/confirmar',
    ...protegida,
    assincrono(async (req, res) => {
      const numero = validarTextoObrigatorio(req.params.numero, 'numero');
      const destinoOverride = validarDestinoManualOpcional(req.body?.destinoOverride);
      const dadosComplementares = {
        modalidade: validarModalidade(req.body?.modalidade),
        modalidadeExecucao: validarModalidadeExecucao(req.body?.modalidadeExecucao ?? 'TRANSPORTADORA'),
        veiculoId: validarUuidOpcional(req.body?.veiculoId, 'veiculoId'),
        motoristaNome: validarTextoOpcional(req.body?.motoristaNome, 'motoristaNome'),
        custoManual: validarNumeroNaoNegativoOpcional(req.body?.custoManual, 'custoManual'),
        valorMercadoria: validarNumeroNaoNegativoOpcional(req.body?.valorMercadoria, 'valorMercadoria'),
        observacoes: validarTextoOpcional(req.body?.observacoes, 'observacoes'),
      };
      const cotacao = await servicoCriarCotacaoDeOmie(cliente, numero, 'PEDIDO', destinoOverride, dadosComplementares, req.usuario!.id);
      res.status(201).json(cotacao);
    }),
  );

  // Documento Omie único (Nova cotação): o operador informa só o número; a Omie diz se é
  // Orçamento ou Pedido (classificação pela etapa). Ao confirmar, o tipo conferido na tela
  // volta obrigatório e o backend reconsulta a Omie — se o tipo mudou, rejeita (nunca mistura).
  rotas.get(
    '/api/fretes/omie/documentos/:numero/preparar',
    ...protegida,
    assincrono(async (req, res) => {
      const numero = validarTextoObrigatorio(req.params.numero, 'numero');
      res.json(await servicoPrepararCotacaoDeOmie(cliente, numero, null));
    }),
  );

  rotas.post(
    '/api/fretes/omie/documentos/:numero/confirmar',
    ...protegida,
    assincrono(async (req, res) => {
      const numero = validarTextoObrigatorio(req.params.numero, 'numero');
      const tipoDocumento = validarTipoDocumentoOmie(req.body?.tipoDocumento);
      const destinoOverride = validarDestinoManualOpcional(req.body?.destinoOverride);
      const dadosComplementares = {
        modalidade: validarModalidade(req.body?.modalidade),
        modalidadeExecucao: validarModalidadeExecucao(req.body?.modalidadeExecucao ?? 'TRANSPORTADORA'),
        veiculoId: validarUuidOpcional(req.body?.veiculoId, 'veiculoId'),
        motoristaNome: validarTextoOpcional(req.body?.motoristaNome, 'motoristaNome'),
        custoManual: validarNumeroNaoNegativoOpcional(req.body?.custoManual, 'custoManual'),
        valorMercadoria: validarNumeroNaoNegativoOpcional(req.body?.valorMercadoria, 'valorMercadoria'),
        observacoes: aplicarObservacaoTde(validarTextoOpcional(req.body?.observacoes, 'observacoes'), req.body?.entregaProgramadaTde === true),
        peso: validarNumeroNaoNegativoOpcional(req.body?.peso, 'peso'),
        volumes: validarInteiroNaoNegativoOpcional(req.body?.volumes, 'volumes'),
      };
      const cotacao = await servicoCriarCotacaoDeOmie(cliente, numero, tipoDocumento, destinoOverride, dadosComplementares, req.usuario!.id);
      res.status(201).json(cotacao);
    }),
  );

  rotas.get(
    '/api/fretes/omie/orcamentos/:numero/preparar',
    ...protegida,
    assincrono(async (req, res) => {
      const numero = validarTextoObrigatorio(req.params.numero, 'numero');
      res.json(await servicoPrepararCotacaoDeOmie(cliente, numero, 'ORCAMENTO'));
    }),
  );

  rotas.post(
    '/api/fretes/omie/orcamentos/:numero/confirmar',
    ...protegida,
    assincrono(async (req, res) => {
      const numero = validarTextoObrigatorio(req.params.numero, 'numero');
      const destinoOverride = validarDestinoManualOpcional(req.body?.destinoOverride);
      const dadosComplementares = {
        modalidade: validarModalidade(req.body?.modalidade),
        modalidadeExecucao: validarModalidadeExecucao(req.body?.modalidadeExecucao ?? 'TRANSPORTADORA'),
        veiculoId: validarUuidOpcional(req.body?.veiculoId, 'veiculoId'),
        motoristaNome: validarTextoOpcional(req.body?.motoristaNome, 'motoristaNome'),
        custoManual: validarNumeroNaoNegativoOpcional(req.body?.custoManual, 'custoManual'),
        valorMercadoria: validarNumeroNaoNegativoOpcional(req.body?.valorMercadoria, 'valorMercadoria'),
        observacoes: aplicarObservacaoTde(validarTextoOpcional(req.body?.observacoes, 'observacoes'), req.body?.entregaProgramadaTde === true),
        peso: validarNumeroNaoNegativoOpcional(req.body?.peso, 'peso'),
        volumes: validarInteiroNaoNegativoOpcional(req.body?.volumes, 'volumes'),
      };
      const cotacao = await servicoCriarCotacaoDeOmie(cliente, numero, 'ORCAMENTO', destinoOverride, dadosComplementares, req.usuario!.id);
      res.status(201).json(cotacao);
    }),
  );

  // --- Transportadoras -----------------------------------------------------

  rotas.get(
    '/api/fretes/transportadoras',
    ...protegida,
    assincrono(async (req, res) => {
      const somenteAtivas = req.query.somenteAtivas === 'true';
      res.json({ transportadoras: await servicoListarTransportadoras(somenteAtivas) });
    }),
  );

  // Busca somente-leitura no cadastro local (nome/CNPJ) para o detalhe da cotação — limitada,
  // só ativas, sem duplicidade por CNPJ, com os canais realmente disponíveis.
  rotas.get(
    '/api/fretes/transportadoras/buscar',
    ...protegida,
    assincrono(async (req, res) => {
      const termo = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (termo.length < 2 || termo.length > 100) throw new ErroValidacao('Informe de 2 a 100 caracteres para buscar.');
      res.json({ transportadoras: await servicoBuscarTransportadorasParaSolicitacao(termo) });
    }),
  );

  // "Confirmar cadastro" (a partir da cotação, depois da conferência dos dados vindos da Omie):
  // único ponto desse fluxo que grava. Mesmo CNPJ normalizado já cadastrado → usa o existente.
  rotas.post(
    '/api/fretes/transportadoras/confirmar-cadastro',
    ...protegida,
    assincrono(async (req, res) => {
      const dados = {
        nomeRazaoSocial: validarTextoObrigatorio(req.body?.nomeRazaoSocial, 'nomeRazaoSocial'),
        nomeFantasia: validarTextoOpcional(req.body?.nomeFantasia, 'nomeFantasia'),
        cnpj: validarCnpjOpcional(req.body?.cnpj),
        email: validarEmailOpcional(req.body?.email),
        telefone: validarTextoOpcional(req.body?.telefone, 'telefone'),
        contato: validarTextoOpcional(req.body?.contato, 'contato'),
        observacoes: null,
        codigoClienteOmie: validarIdOmieOpcional(req.body?.codigoClienteOmie, 'codigoClienteOmie'),
        canalPrincipal: validarCanalPrincipalOpcional(req.body?.canalPrincipal),
        urlPortal: validarTextoComTamanhoMaximo(req.body?.urlPortal, 'urlPortal', 500),
        whatsappCotacao: validarWhatsappOpcional(req.body?.whatsappCotacao),
      };
      const resultado = await servicoConfirmarCadastroTransportadora(dados, req.usuario!.id);
      res.status(resultado.existente ? 200 : 201).json(resultado);
    }),
  );

  // Busca somente-leitura na Omie (CNPJ > razão social > nome fantasia). Nunca cria nada.
  rotas.post(
    '/api/fretes/transportadoras/buscar-omie',
    ...protegida,
    assincrono(async (req, res) => {
      res.json(
        await servicoBuscarTransportadoraOmie(cliente, {
          cnpj: validarCnpjOpcional(req.body?.cnpj),
          razaoSocial: validarTextoOpcional(req.body?.razaoSocial, 'razaoSocial'),
          nomeFantasia: validarTextoOpcional(req.body?.nomeFantasia, 'nomeFantasia'),
        }),
      );
    }),
  );

  rotas.post(
    '/api/fretes/transportadoras',
    ...protegida,
    assincrono(async (req, res) => {
      const dados = {
        nomeRazaoSocial: validarTextoObrigatorio(req.body?.nomeRazaoSocial, 'nomeRazaoSocial'),
        nomeFantasia: validarTextoOpcional(req.body?.nomeFantasia, 'nomeFantasia'),
        cnpj: validarCnpjOpcional(req.body?.cnpj),
        email: validarEmailOpcional(req.body?.email),
        telefone: validarTextoOpcional(req.body?.telefone, 'telefone'),
        contato: validarTextoOpcional(req.body?.contato, 'contato'),
        observacoes: validarTextoOpcional(req.body?.observacoes, 'observacoes'),
        codigoClienteOmie: validarIdOmieOpcional(req.body?.codigoClienteOmie, 'codigoClienteOmie'),
        canalPrincipal: validarCanalPrincipalOpcional(req.body?.canalPrincipal),
        urlPortal: validarTextoComTamanhoMaximo(req.body?.urlPortal, 'urlPortal', 500),
        whatsappCotacao: validarWhatsappOpcional(req.body?.whatsappCotacao),
      };
      const transportadora = await servicoCriarTransportadora(dados, req.usuario!.id);
      res.status(201).json(transportadora);
    }),
  );

  rotas.put(
    '/api/fretes/transportadoras/:id',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      const dados: Record<string, unknown> = {};
      if (req.body?.nomeRazaoSocial !== undefined) dados.nomeRazaoSocial = validarTextoObrigatorio(req.body.nomeRazaoSocial, 'nomeRazaoSocial');
      if (req.body?.nomeFantasia !== undefined) dados.nomeFantasia = validarTextoOpcional(req.body.nomeFantasia, 'nomeFantasia');
      if (req.body?.cnpj !== undefined) dados.cnpj = validarCnpjOpcional(req.body.cnpj);
      if (req.body?.email !== undefined) dados.email = validarEmailOpcional(req.body.email);
      if (req.body?.telefone !== undefined) dados.telefone = validarTextoOpcional(req.body.telefone, 'telefone');
      if (req.body?.contato !== undefined) dados.contato = validarTextoOpcional(req.body.contato, 'contato');
      if (req.body?.observacoes !== undefined) dados.observacoes = validarTextoOpcional(req.body.observacoes, 'observacoes');
      if (req.body?.codigoClienteOmie !== undefined) dados.codigoClienteOmie = validarIdOmieOpcional(req.body.codigoClienteOmie, 'codigoClienteOmie');
      if (req.body?.canalPrincipal !== undefined) dados.canalPrincipal = validarCanalPrincipalOpcional(req.body.canalPrincipal);
      if (req.body?.urlPortal !== undefined) dados.urlPortal = validarTextoComTamanhoMaximo(req.body.urlPortal, 'urlPortal', 500);
      if (req.body?.whatsappCotacao !== undefined) dados.whatsappCotacao = validarWhatsappOpcional(req.body.whatsappCotacao);
      const transportadora = await servicoAtualizarTransportadora(id, dados, req.usuario!.id);
      res.json(transportadora);
    }),
  );

  rotas.post(
    '/api/fretes/transportadoras/:id/ativar',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoDefinirAtivaTransportadora(id, true, req.usuario!.id));
    }),
  );

  rotas.post(
    '/api/fretes/transportadoras/:id/desativar',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoDefinirAtivaTransportadora(id, false, req.usuario!.id));
    }),
  );

  // --- Veículos próprios (Fase 2) -------------------------------------------

  rotas.get(
    '/api/fretes/veiculos',
    ...protegida,
    assincrono(async (req, res) => {
      const somenteAtivos = req.query.somenteAtivos === 'true';
      res.json({ veiculos: await servicoListarVeiculos(somenteAtivos) });
    }),
  );

  rotas.post(
    '/api/fretes/veiculos',
    ...protegida,
    assincrono(async (req, res) => {
      const dados = {
        descricao: validarTextoObrigatorio(req.body?.descricao, 'descricao'),
        placa: validarTextoOpcional(req.body?.placa, 'placa'),
        tipo: validarTextoOpcional(req.body?.tipo, 'tipo'),
        marca: validarTextoOpcional(req.body?.marca, 'marca'),
        modelo: validarTextoOpcional(req.body?.modelo, 'modelo'),
        ano: validarInteiroNaoNegativoOpcional(req.body?.ano, 'ano'),
        capacidadeKg: validarNumeroNaoNegativoOpcional(req.body?.capacidadeKg, 'capacidadeKg'),
        capacidadeM3: validarNumeroNaoNegativoOpcional(req.body?.capacidadeM3, 'capacidadeM3'),
        observacoes: validarTextoOpcional(req.body?.observacoes, 'observacoes'),
      };
      const veiculo = await servicoCriarVeiculo(dados, req.usuario!.id);
      res.status(201).json(veiculo);
    }),
  );

  rotas.put(
    '/api/fretes/veiculos/:id',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      const dados: Record<string, unknown> = {};
      if (req.body?.descricao !== undefined) dados.descricao = validarTextoObrigatorio(req.body.descricao, 'descricao');
      if (req.body?.placa !== undefined) dados.placa = validarTextoOpcional(req.body.placa, 'placa');
      if (req.body?.tipo !== undefined) dados.tipo = validarTextoOpcional(req.body.tipo, 'tipo');
      if (req.body?.marca !== undefined) dados.marca = validarTextoOpcional(req.body.marca, 'marca');
      if (req.body?.modelo !== undefined) dados.modelo = validarTextoOpcional(req.body.modelo, 'modelo');
      if (req.body?.ano !== undefined) dados.ano = validarInteiroNaoNegativoOpcional(req.body.ano, 'ano');
      if (req.body?.capacidadeKg !== undefined) dados.capacidadeKg = validarNumeroNaoNegativoOpcional(req.body.capacidadeKg, 'capacidadeKg');
      if (req.body?.capacidadeM3 !== undefined) dados.capacidadeM3 = validarNumeroNaoNegativoOpcional(req.body.capacidadeM3, 'capacidadeM3');
      if (req.body?.observacoes !== undefined) dados.observacoes = validarTextoOpcional(req.body.observacoes, 'observacoes');
      res.json(await servicoAtualizarVeiculo(id, dados, req.usuario!.id));
    }),
  );

  rotas.post(
    '/api/fretes/veiculos/:id/ativar',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoDefinirAtivoVeiculo(id, true, req.usuario!.id));
    }),
  );

  rotas.post(
    '/api/fretes/veiculos/:id/desativar',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoDefinirAtivoVeiculo(id, false, req.usuario!.id));
    }),
  );

  // --- Cotações --------------------------------------------------------

  rotas.get(
    '/api/fretes/cotacoes',
    ...protegida,
    assincrono(async (req, res) => {
      const status = validarStatusOpcional(req.query.status);
      const modalidade = req.query.modalidade === 'CIF' || req.query.modalidade === 'FOB' ? req.query.modalidade : undefined;
      const modalidadeExecucao = validarModalidadeExecucaoOpcional(req.query.modalidadeExecucao);
      const codigo = validarTextoOpcional(req.query.codigo, 'codigo') ?? undefined;
      res.json({ cotacoes: await servicoListarCotacoes({ status, modalidade, modalidadeExecucao, codigo }) });
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes',
    ...protegida,
    assincrono(async (req, res) => {
      const dados = {
        clienteOmieId: validarIdOmieOpcional(req.body?.clienteOmieId, 'clienteOmieId'),
        pedidoOmieId: validarIdOmieOpcional(req.body?.pedidoOmieId, 'pedidoOmieId'),
        vendedorOmieId: validarIdOmieOpcional(req.body?.vendedorOmieId, 'vendedorOmieId'),
        origem: validarTextoOpcional(req.body?.origem, 'origem'),
        cepOrigem: validarTextoOpcional(req.body?.cepOrigem, 'cepOrigem'),
        destino: validarTextoOpcional(req.body?.destino, 'destino'),
        cepDestino: validarTextoOpcional(req.body?.cepDestino, 'cepDestino'),
        peso: validarNumeroNaoNegativoOpcional(req.body?.peso, 'peso'),
        volumes: validarInteiroNaoNegativoOpcional(req.body?.volumes, 'volumes'),
        valorMercadoria: validarNumeroNaoNegativoOpcional(req.body?.valorMercadoria, 'valorMercadoria'),
        modalidade: validarModalidade(req.body?.modalidade),
        modalidadeExecucao: validarModalidadeExecucao(req.body?.modalidadeExecucao ?? 'TRANSPORTADORA'),
        veiculoId: validarUuidOpcional(req.body?.veiculoId, 'veiculoId'),
        motoristaNome: validarTextoOpcional(req.body?.motoristaNome, 'motoristaNome'),
        custoManual: validarNumeroNaoNegativoOpcional(req.body?.custoManual, 'custoManual'),
        observacoes: aplicarObservacaoTde(validarTextoOpcional(req.body?.observacoes, 'observacoes'), req.body?.entregaProgramadaTde === true),
      };
      const cotacao = await servicoCriarCotacao(dados, req.usuario!.id);
      res.status(201).json(cotacao);
    }),
  );

  rotas.get(
    '/api/fretes/cotacoes/:id',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoBuscarCotacao(id));
    }),
  );

  rotas.put(
    '/api/fretes/cotacoes/:id',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      const dados: Record<string, unknown> = {};
      if (req.body?.origem !== undefined) dados.origem = validarTextoOpcional(req.body.origem, 'origem');
      if (req.body?.destino !== undefined) dados.destino = validarTextoOpcional(req.body.destino, 'destino');
      if (req.body?.cepDestino !== undefined) dados.cepDestino = validarTextoOpcional(req.body.cepDestino, 'cepDestino');
      if (req.body?.peso !== undefined) dados.peso = validarNumeroNaoNegativoOpcional(req.body.peso, 'peso');
      if (req.body?.volumes !== undefined) dados.volumes = validarInteiroNaoNegativoOpcional(req.body.volumes, 'volumes');
      if (req.body?.valorMercadoria !== undefined) dados.valorMercadoria = validarNumeroNaoNegativoOpcional(req.body.valorMercadoria, 'valorMercadoria');
      if (req.body?.modalidade !== undefined) dados.modalidade = validarModalidade(req.body.modalidade);
      if (req.body?.modalidadeExecucao !== undefined) dados.modalidadeExecucao = validarModalidadeExecucao(req.body.modalidadeExecucao);
      if (req.body?.veiculoId !== undefined) dados.veiculoId = validarUuidOpcional(req.body.veiculoId, 'veiculoId');
      if (req.body?.motoristaNome !== undefined) dados.motoristaNome = validarTextoOpcional(req.body.motoristaNome, 'motoristaNome');
      if (req.body?.custoManual !== undefined) dados.custoManual = validarNumeroNaoNegativoOpcional(req.body.custoManual, 'custoManual');
      if (req.body?.observacoes !== undefined) dados.observacoes = validarTextoOpcional(req.body.observacoes, 'observacoes');
      res.json(await servicoAtualizarCotacao(id, dados, req.usuario!.id));
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/cancelar',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoCancelarCotacao(id, req.usuario!.id));
    }),
  );

  // --- Propostas -------------------------------------------------------

  // Fase Braspress 1 — cota na API oficial e cria/reaproveita a proposta no fluxo existente.
  rotas.post(
    '/api/fretes/cotacoes/:id/cotar-braspress',
    ...protegida,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const dados = {
        cepOrigem: validarTextoOpcional(req.body?.cepOrigem, 'cepOrigem'),
        cubagem: validarCubagemOpcional(req.body?.cubagem),
      };
      try {
        const resultado = await servicoCotarBraspress(cliente, cotacaoId, dados, req.usuario!.id);
        res.status(resultado.duplicada ? 200 : 201).json(resultado);
      } catch (erro) {
        if (erro instanceof ErroBraspressNaoConfigurada) {
          res.status(503).json({ erro: 'Integração Braspress não configurada no servidor.' });
          return;
        }
        if (erro instanceof ErroBraspressFalhou) {
          res.status(502).json({ erro: erro.message });
          return;
        }
        if (erro instanceof ErroCnpjDestinatarioNaoDisponivel) {
          res.status(400).json({ erro: erro.message, codigo: erro.codigo });
          return;
        }
        if (erro instanceof ErroDadosCotacaoIncompletos) {
          res.status(400).json({ erro: erro.message, faltando: erro.faltando });
          return;
        }
        throw erro;
      }
    }),
  );

  rotas.get(
    '/api/fretes/cotacoes/:id/propostas',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json({ propostas: await servicoListarPropostas(id) });
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/propostas',
    ...protegida,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const dados = {
        cotacaoId,
        transportadoraId: validarUuid(req.body?.transportadoraId, 'transportadoraId'),
        valorCusto: validarNumeroNaoNegativoObrigatorio(req.body?.valorCusto, 'valorCusto'),
        prazoDias: validarInteiroNaoNegativoOpcional(req.body?.prazoDias, 'prazoDias'),
        validade: validarTextoOpcional(req.body?.validade, 'validade'),
        peso: validarNumeroNaoNegativoOpcional(req.body?.peso, 'peso'),
        volumes: validarInteiroNaoNegativoOpcional(req.body?.volumes, 'volumes'),
        origem: validarTextoOpcional(req.body?.origem, 'origem'),
        destino: validarTextoOpcional(req.body?.destino, 'destino'),
        tipoServico: validarTextoOpcional(req.body?.tipoServico, 'tipoServico'),
        observacoes: validarTextoOpcional(req.body?.observacoes, 'observacoes'),
      };
      const proposta = await servicoCriarProposta(dados, req.usuario!.id);
      res.status(201).json(proposta);
    }),
  );

  rotas.get(
    '/api/fretes/cotacoes/:id/comparacao',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json({ linhas: await servicoCompararPropostas(id) });
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/propostas/:propostaId/selecionar',
    ...protegida,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const propostaId = validarUuid(req.params.propostaId, 'propostaId');
      res.json(await servicoSelecionarProposta(cotacaoId, propostaId, req.usuario!.id));
    }),
  );

  rotas.post(
    '/api/fretes/propostas/:id/rejeitar',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoRejeitarProposta(id, req.usuario!.id));
    }),
  );

  // --- Fase 4A.6: Central da Logística + Central do Vendedor ----------------
  // Gate de rota é só a permissão "de porta" (`fretesLogistica`/`fretesComercial`); a
  // checagem fina (dono da cotação/visão ampliada/substituição) mora inteiramente no
  // serviço (`fretesServico.ts`), nunca aqui — mesma separação já usada no resto do módulo.

  const protegidaLogistica = [exigirAutenticacao, exigirPermissao('fretesLogistica')] as const;
  const protegidaComercial = [exigirAutenticacao, exigirPermissao('fretesComercial')] as const;

  rotas.get(
    '/api/fretes/central-logistica',
    ...protegidaLogistica,
    assincrono(async (_req, res) => {
      res.json({ linhas: await servicoListarCentralLogistica() });
    }),
  );

  rotas.post(
    '/api/fretes/propostas/:id/liberar',
    ...protegidaLogistica,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoLiberarPropostaLogistica(id, req.usuario!));
    }),
  );

  rotas.post(
    '/api/fretes/propostas/:id/descartar',
    ...protegidaLogistica,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoDescartarPropostaLogistica(id, req.usuario!));
    }),
  );

  rotas.get(
    '/api/fretes/central-vendedor',
    ...protegidaComercial,
    assincrono(async (req, res) => {
      res.json({ linhas: await servicoListarCentralVendedor(req.usuario!) });
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/propostas/:propostaId/negociar',
    ...protegidaComercial,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const propostaId = validarUuid(req.params.propostaId, 'propostaId');
      res.json(await servicoMarcarPropostaEmNegociacao(cotacaoId, propostaId, req.usuario!));
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/propostas/:propostaId/escolher',
    ...protegidaComercial,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const propostaId = validarUuid(req.params.propostaId, 'propostaId');
      const motivoSubstituicao = validarTextoOpcional(req.body?.substituicao?.motivo, 'substituicao.motivo');
      const substituicao = motivoSubstituicao !== null ? { motivo: motivoSubstituicao } : undefined;
      res.json(await servicoEscolherFreteVencedor(cotacaoId, propostaId, req.usuario!, substituicao));
    }),
  );

  // --- Fase 4A.7: Composição comercial do frete (valor mínimo/acréscimo/aprovação) ---------
  // Alíquotas fiscais (só administrador — configuração de sistema, não decisão por cotação).

  rotas.get(
    '/api/fretes/parametros-fiscais',
    exigirAutenticacao,
    exigirAdministrador,
    assincrono(async (_req, res) => {
      res.json(await servicoBuscarParametrosFiscais());
    }),
  );

  rotas.put(
    '/api/fretes/parametros-fiscais',
    exigirAutenticacao,
    exigirAdministrador,
    assincrono(async (req, res) => {
      const dados = {
        pisPercentual: validarPercentualFiscalOpcional(req.body?.pisPercentual, 'pisPercentual'),
        cofinsPercentual: validarPercentualFiscalOpcional(req.body?.cofinsPercentual, 'cofinsPercentual'),
        icmsPercentual: validarPercentualFiscalOpcional(req.body?.icmsPercentual, 'icmsPercentual'),
      };
      res.json(await servicoAtualizarParametrosFiscais(dados, req.usuario!.id));
    }),
  );

  // Preview somente leitura — a tela do vendedor recalcula o valor final localmente a cada
  // mudança de acréscimo, sem expor PIS/COFINS/ICMS individualmente (nunca retornados aqui).
  rotas.get(
    '/api/fretes/propostas/:id/composicao-preview',
    ...protegidaComercial,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoCalcularPreviewComposicao(id));
    }),
  );

  rotas.get(
    '/api/fretes/propostas/:id/composicao',
    ...protegidaComercial,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      const composicao = await servicoBuscarComposicaoPorProposta(id);
      if (composicao === null) {
        res.status(404).json({ erro: 'Esta proposta ainda não tem composição comercial registrada.' });
        return;
      }
      res.json(composicao);
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/propostas/:propostaId/composicao',
    ...protegidaComercial,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const propostaId = validarUuid(req.params.propostaId, 'propostaId');
      const acrescimoPercentual = validarNumeroNaoNegativoObrigatorio(req.body?.acrescimoPercentual, 'acrescimoPercentual');
      const motivoSubstituicao = validarTextoOpcional(req.body?.substituicao?.motivo, 'substituicao.motivo');
      const substituicao = motivoSubstituicao !== null ? { motivo: motivoSubstituicao } : undefined;
      const composicao = await servicoRegistrarComposicaoComercial(cotacaoId, propostaId, acrescimoPercentual, req.usuario!, substituicao);
      res.status(201).json(composicao);
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/propostas/:propostaId/composicao/solicitar-aprovacao',
    ...protegidaComercial,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const propostaId = validarUuid(req.params.propostaId, 'propostaId');
      const acrescimoPercentual = validarNumeroNaoNegativoObrigatorio(req.body?.acrescimoPercentual, 'acrescimoPercentual');
      const motivo = validarTextoObrigatorio(req.body?.motivo, 'motivo');
      const aprovacao = await servicoSolicitarAprovacaoValorMinimo(cotacaoId, propostaId, acrescimoPercentual, motivo, req.usuario!);
      res.status(201).json(aprovacao);
    }),
  );

  // --- Fase 4A.7: aprovação gerencial (abaixo do mínimo) --------------------

  const protegidaGerencia = [exigirAutenticacao, exigirPermissao('fretesGerencia')] as const;

  rotas.get(
    '/api/fretes/aprovacoes-valor-minimo',
    ...protegidaGerencia,
    assincrono(async (req, res) => {
      const status = req.query.status;
      const statusValido = status === 'PENDENTE' || status === 'APROVADA' || status === 'REJEITADA' ? status : undefined;
      res.json({ aprovacoes: await servicoListarAprovacoesValorMinimo(req.usuario!, statusValido) });
    }),
  );

  rotas.post(
    '/api/fretes/aprovacoes-valor-minimo/:id/aprovar',
    ...protegidaGerencia,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoAprovarValorMinimo(id, req.usuario!));
    }),
  );

  rotas.post(
    '/api/fretes/aprovacoes-valor-minimo/:id/rejeitar',
    ...protegidaGerencia,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoRejeitarValorMinimo(id, req.usuario!));
    }),
  );

  // --- Fase 4A.8: Histórico de fretes por cliente (só leitura) --------------
  // A restrição fina por vendedor (Fase 4A.6) mora inteiramente no serviço, nunca aqui.

  const protegidaHistorico = [exigirAutenticacao, exigirAcessoHistorico] as const;

  rotas.get(
    '/api/fretes/historico/clientes',
    ...protegidaHistorico,
    assincrono(async (req, res) => {
      const termo = validarTextoOpcional(req.query.termo, 'termo') ?? '';
      res.json({ clientes: await servicoBuscarClientesHistorico(termo, req.usuario!) });
    }),
  );

  rotas.get(
    '/api/fretes/historico/resumo',
    ...protegidaHistorico,
    assincrono(async (req, res) => {
      const clienteOmieId = validarIdOmieOpcional(req.query.clienteOmieId, 'clienteOmieId');
      if (clienteOmieId === null) throw new ErroValidacao('Informe "clienteOmieId".');
      const resumo = await servicoResumoClienteHistorico(clienteOmieId, req.usuario!);
      if (resumo === null) {
        res.status(404).json({ erro: 'Nenhum histórico encontrado para este cliente (ou sem permissão para vê-lo).' });
        return;
      }
      res.json(resumo);
    }),
  );

  rotas.get(
    '/api/fretes/historico/:propostaId',
    ...protegidaHistorico,
    assincrono(async (req, res) => {
      const propostaId = validarUuid(req.params.propostaId, 'propostaId');
      const detalhe = await servicoDetalheHistoricoFrete(propostaId, req.usuario!);
      if (detalhe === null) {
        res.status(404).json({ erro: 'Registro de histórico não encontrado (ou sem permissão para vê-lo).' });
        return;
      }
      res.json(detalhe);
    }),
  );

  rotas.get(
    '/api/fretes/historico',
    ...protegidaHistorico,
    assincrono(async (req, res) => {
      const clienteOmieId = validarIdOmieOpcional(req.query.clienteOmieId, 'clienteOmieId');
      if (clienteOmieId === null) throw new ErroValidacao('Informe "clienteOmieId".');
      const vendedorOmieId = validarIdOmieOpcional(req.query.vendedorOmieId, 'vendedorOmieId') ?? undefined;
      const transportadoraId = validarUuidOpcional(req.query.transportadoraId, 'transportadoraId') ?? undefined;
      const tipoBruto = req.query.tipo;
      const documentoOmieTipo = tipoBruto === 'PEDIDO' || tipoBruto === 'ORCAMENTO' || tipoBruto === 'MANUAL' ? tipoBruto : undefined;
      const statusBruto = req.query.status;
      const statusRevisao =
        statusBruto === 'AGUARDANDO_LOGISTICA' ||
        statusBruto === 'LIBERADA' ||
        statusBruto === 'DESCARTADA' ||
        statusBruto === 'EM_NEGOCIACAO' ||
        statusBruto === 'ESCOLHIDA'
          ? statusBruto
          : undefined;
      const dataInicio = validarTextoOpcional(req.query.dataInicio, 'dataInicio') ?? undefined;
      const dataFim = validarTextoOpcional(req.query.dataFim, 'dataFim') ?? undefined;
      const pagina = validarInteiroNaoNegativoOpcional(req.query.pagina, 'pagina') ?? 1;
      const tamanhoPagina = validarInteiroNaoNegativoOpcional(req.query.tamanhoPagina, 'tamanhoPagina') ?? 25;
      const resultado = await servicoListarHistoricoCliente(
        { clienteOmieId, vendedorOmieId, transportadoraId, documentoOmieTipo, statusRevisao, dataInicio, dataFim, pagina: pagina || 1, tamanhoPagina: tamanhoPagina || 25 },
        req.usuario!,
      );
      res.json(resultado);
    }),
  );

  // --- Fase 4A.1: solicitações de cotação (seção 12/25/35) -----------------

  rotas.get(
    '/api/fretes/cotacoes/:id/solicitacoes',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json({ solicitacoes: await servicoListarSolicitacoes(id) });
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/solicitacoes',
    ...protegida,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      // Fase 4A.4.1 (seção 7): aceita `transportadoras: [{ id, emailManual? }]` (permite
      // override de e-mail por transportadora, só válido para canal EMAIL). Mantém
      // compatibilidade com o formato anterior `transportadoraIds: string[]` (sem override).
      const brutoTransportadoras = req.body?.transportadoras;
      const brutoIds = req.body?.transportadoraIds;
      let itens: { transportadoraId: string; emailManual: string | null }[];
      if (Array.isArray(brutoTransportadoras) && brutoTransportadoras.length > 0) {
        itens = brutoTransportadoras.map((v: unknown, i: number) => {
          const item = v as Record<string, unknown>;
          return {
            transportadoraId: validarUuid(item?.id, `transportadoras[${i}].id`),
            emailManual: validarEmailOpcional(item?.emailManual),
          };
        });
      } else if (Array.isArray(brutoIds) && brutoIds.length > 0) {
        itens = brutoIds.map((v, i) => ({ transportadoraId: validarUuid(v, `transportadoraIds[${i}]`), emailManual: null }));
      } else {
        throw new ErroValidacao('Informe "transportadoras" (lista com ao menos um item) ou "transportadoraIds".');
      }
      const canal = validarCanalOpcional(req.body?.canal);
      // Fase 4A.2: o destino do envio (URL/segredo do n8n) vem exclusivamente de
      // `config` (variáveis de ambiente do servidor) — nunca de `req.body` (seção 36/37,
      // nunca SSRF via URL escolhida pelo cliente).
      const solicitacoes = await servicoSolicitarCotacoes(cliente, cotacaoId, itens, canal, req.usuario!.id);
      res.status(201).json({ solicitacoes });
    }),
  );

  // Envio único do detalhe da cotação: até 7 transportadoras, um canal cada (EMAIL/WHATSAPP/API).
  // Só despacha para os serviços existentes; cadastro e canal são revalidados no servidor.
  rotas.post(
    '/api/fretes/cotacoes/:id/enviar-solicitacoes',
    ...protegida,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const bruto = req.body?.transportadoras;
      if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > LIMITE_TRANSPORTADORAS_POR_ENVIO) {
        throw new ErroValidacao(`Informe "transportadoras" com 1 a ${LIMITE_TRANSPORTADORAS_POR_ENVIO} itens.`);
      }
      const itens = bruto.map((v: unknown, i: number) => {
        const item = v as Record<string, unknown>;
        // Canal ausente segue como `null` para o serviço, que bloqueia o envio inteiro dizendo
        // quais transportadoras estão sem canal; canal preenchido fora do enum continua 400 aqui.
        const semCanal = item?.canal === undefined || item?.canal === null || item?.canal === '';
        const canal = semCanal ? null : validarCanalEnvio(item.canal, `transportadoras[${i}].canal`);
        return {
          transportadoraId: validarUuid(item?.id, `transportadoras[${i}].id`),
          canal,
          emailManual: canal === 'EMAIL' ? validarEmailOpcional(item?.emailManual) : null,
        };
      });
      const cubagem = validarCubagemOpcional(req.body?.cubagem);
      res.json({ resultados: await servicoEnviarSolicitacoes(cliente, cotacaoId, itens, cubagem, req.usuario!.id) });
    }),
  );

  // Fase 4A.2 (seção 29) — reenvio manual: reusa a MESMA solicitação (nunca cria uma nova).
  rotas.post(
    '/api/fretes/solicitacoes/:id/reenviar',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      res.json(await servicoReenviarSolicitacao(cliente, id, req.usuario!.id));
    }),
  );

  // --- Fase 4A.1: caixa de entrada e validação humana (seção 17/36/37) -----

  rotas.get(
    '/api/fretes/propostas/pendentes',
    ...protegida,
    assincrono(async (_req, res) => {
      res.json(await servicoListarInboxPropostas());
    }),
  );

  rotas.get(
    '/api/fretes/propostas/:id/origem',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      const origem = await servicoBuscarOrigemProposta(id);
      if (origem === null) {
        res.status(404).json({ erro: 'Esta proposta não tem origem automática registrada (foi criada manualmente).' });
        return;
      }
      res.json(origem);
    }),
  );

  rotas.post(
    '/api/fretes/propostas/:id/validar',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      const correcao = {
        valorCusto: req.body?.valorCusto !== undefined ? validarNumeroNaoNegativoObrigatorio(req.body.valorCusto, 'valorCusto') : undefined,
        prazoDias: req.body?.prazoDias !== undefined ? validarInteiroNaoNegativoOpcional(req.body.prazoDias, 'prazoDias') : undefined,
        validade: req.body?.validade !== undefined ? validarTextoOpcional(req.body.validade, 'validade') : undefined,
        observacoes: req.body?.observacoes !== undefined ? validarTextoOpcional(req.body.observacoes, 'observacoes') : undefined,
        tipoServico: req.body?.tipoServico !== undefined ? validarTextoOpcional(req.body.tipoServico, 'tipoServico') : undefined,
      };
      res.json(await servicoValidarProposta(id, correcao, req.usuario!.id));
    }),
  );

  // --- Fase 4A.1: webhook de entrada (n8n → ETK, seção 20) ------------------
  // NUNCA usa `exigirAutenticacao`/`exigirPermissao` (essas dependem de sessão de usuário,
  // seção 52) — autenticação própria máquina-a-máquina via `exigirSegredoWebhookFretes`.

  rotas.post(
    '/api/fretes/integracoes/cotacoes/resposta',
    exigirSegredoWebhookFretes,
    assincrono(async (req, res) => {
      const payload = validarPayloadWebhookResposta(req.body);
      const resultado = await servicoProcessarRespostaWebhook(payload);
      res.status(200).json({
        recebido: true,
        duplicado: resultado.duplicado,
        respostaId: resultado.resposta.id,
        extracaoId: resultado.extracao.id,
        extracaoStatus: resultado.extracao.status,
        propostaId: resultado.proposta?.id ?? null,
      });
    }),
  );

  // --- Fase WhatsApp — Etapa 3: persistência WAMID outbound + correlação (n8n → ETK) -----
  // Mesma autenticação máquina-a-máquina já existente (`exigirSegredoWebhookFretes`, seção 4/5
  // da fase — "seguir o padrão já existente", nenhum segredo novo). NUNCA dispara o webhook de
  // resposta (`/integracoes/cotacoes/resposta`) automaticamente (seção 8, explícito).

  rotas.post(
    '/api/fretes/integracoes/whatsapp/outbound',
    exigirSegredoWebhookFretes,
    assincrono(async (req, res) => {
      const payload = validarPayloadOutboundWhatsapp(req.body);
      const resultado = await servicoRegistrarOutboundWhatsapp(payload);
      res.status(200).json({
        registrado: true,
        duplicado: resultado.duplicado,
        solicitacaoId: resultado.solicitacao.id,
        referencia: resultado.solicitacao.codigoReferencia,
      });
    }),
  );

  rotas.post(
    '/api/fretes/integracoes/whatsapp/correlacionar',
    exigirSegredoWebhookFretes,
    assincrono(async (req, res) => {
      const payload = validarPayloadCorrelacionarWhatsapp(req.body);
      res.status(200).json(await servicoResolverReferenciaPorWamidOutbound(payload));
    }),
  );

  // --- Fechamento --------------------------------------------------------

  rotas.get(
    '/api/fretes/cotacoes/:id/fechamento',
    ...protegida,
    assincrono(async (req, res) => {
      const id = validarUuid(req.params.id, 'id');
      const fechamento = await servicoBuscarFechamento(id);
      if (fechamento === null) {
        res.status(404).json({ erro: 'Esta cotação ainda não tem fechamento.' });
        return;
      }
      res.json(fechamento);
    }),
  );

  rotas.post(
    '/api/fretes/cotacoes/:id/fechamento',
    ...protegida,
    assincrono(async (req, res) => {
      const cotacaoId = validarUuid(req.params.id, 'id');
      const temPercentual = req.body?.percentualAcrescimo !== undefined && req.body?.percentualAcrescimo !== null && req.body?.percentualAcrescimo !== '';
      const temValorFinal = req.body?.valorFreteClienteInformado !== undefined && req.body?.valorFreteClienteInformado !== null && req.body?.valorFreteClienteInformado !== '';
      // "Exatamente um dos dois" só é exigido quando os dois foram informados ao mesmo tempo
      // (ambíguo) — a ausência dos dois é válida para a modalidade RETIRA (sempre R$ 0,00,
      // ignora acréscimo por completo, seção 12); `fretesServico.servicoFecharCotacao` já
      // rejeita a ausência dos dois para as demais modalidades.
      if (temPercentual && temValorFinal) {
        throw new ErroValidacao('Informe apenas um dos dois: "percentualAcrescimo" OU "valorFreteClienteInformado".');
      }
      const temCustoManual = req.body?.custoManual !== undefined && req.body?.custoManual !== null && req.body?.custoManual !== '';
      const fechamento = await servicoFecharCotacao(
        {
          cotacaoId,
          percentualAcrescimo: temPercentual ? validarNumeroNaoNegativoObrigatorio(req.body.percentualAcrescimo, 'percentualAcrescimo') : undefined,
          valorFreteClienteInformado: temValorFinal
            ? validarNumeroNaoNegativoObrigatorio(req.body.valorFreteClienteInformado, 'valorFreteClienteInformado')
            : undefined,
          custoManual: temCustoManual ? validarNumeroNaoNegativoObrigatorio(req.body.custoManual, 'custoManual') : undefined,
          observacoes: validarTextoOpcional(req.body?.observacoes, 'observacoes'),
        },
        req.usuario!.id,
      );
      res.status(201).json(fechamento);
    }),
  );

  // --- Dashboard -----------------------------------------------------------

  rotas.get(
    '/api/fretes/dashboard',
    ...protegida,
    assincrono(async (_req, res) => {
      res.json(await servicoDashboard());
    }),
  );

  return rotas;
}
