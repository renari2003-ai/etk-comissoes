import { Router } from 'express';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import { ErroValidacao } from '../validacao.js';
import {
  servicoAtualizarCotacao,
  servicoAtualizarTransportadora,
  servicoBuscarCotacao,
  servicoBuscarFechamento,
  servicoCancelarCotacao,
  servicoCompararPropostas,
  servicoCriarCotacao,
  servicoCriarProposta,
  servicoCriarTransportadora,
  servicoDashboard,
  servicoDefinirAtivaTransportadora,
  servicoFecharCotacao,
  servicoListarCotacoes,
  servicoListarPropostas,
  servicoListarTransportadoras,
  servicoRejeitarProposta,
  servicoSelecionarProposta,
} from '../fretes/fretesServico.js';
import type { StatusCotacao } from '../fretes/tipos.js';
import {
  validarCnpjOpcional,
  validarEmailOpcional,
  validarIdOmieOpcional,
  validarInteiroNaoNegativoOpcional,
  validarModalidade,
  validarNumeroNaoNegativoObrigatorio,
  validarNumeroNaoNegativoOpcional,
  validarTextoObrigatorio,
  validarTextoOpcional,
  validarUuid,
} from '../fretes/validacao.js';
import { assincrono } from './erroHttp.js';

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
 * Rotas do módulo de Fretes (Fase 1) — cada rota leva `exigirAutenticacao` +
 * `exigirPermissao('fretes')` DIRETO nela, nunca via `app.use(middleware, rotas)` no
 * nível de `server.ts` (mesmo motivo documentado nas demais rotas do projeto: um
 * middleware "global" nesse nível rodaria pra qualquer requisição que chegasse até
 * aqui, mesmo sem bater com nenhuma rota abaixo).
 */
export function criarRotaFretes(): Router {
  const rotas = Router();
  const protegida = [exigirAutenticacao, exigirPermissao('fretes')] as const;

  // --- Transportadoras -----------------------------------------------------

  rotas.get(
    '/api/fretes/transportadoras',
    ...protegida,
    assincrono(async (req, res) => {
      const somenteAtivas = req.query.somenteAtivas === 'true';
      res.json({ transportadoras: await servicoListarTransportadoras(somenteAtivas) });
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

  // --- Cotações --------------------------------------------------------

  rotas.get(
    '/api/fretes/cotacoes',
    ...protegida,
    assincrono(async (req, res) => {
      const status = validarStatusOpcional(req.query.status);
      const modalidade = req.query.modalidade === 'CIF' || req.query.modalidade === 'FOB' ? req.query.modalidade : undefined;
      const codigo = validarTextoOpcional(req.query.codigo, 'codigo') ?? undefined;
      res.json({ cotacoes: await servicoListarCotacoes({ status, modalidade, codigo }) });
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
        observacoes: validarTextoOpcional(req.body?.observacoes, 'observacoes'),
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
      if (req.body?.cepOrigem !== undefined) dados.cepOrigem = validarTextoOpcional(req.body.cepOrigem, 'cepOrigem');
      if (req.body?.destino !== undefined) dados.destino = validarTextoOpcional(req.body.destino, 'destino');
      if (req.body?.cepDestino !== undefined) dados.cepDestino = validarTextoOpcional(req.body.cepDestino, 'cepDestino');
      if (req.body?.peso !== undefined) dados.peso = validarNumeroNaoNegativoOpcional(req.body.peso, 'peso');
      if (req.body?.volumes !== undefined) dados.volumes = validarInteiroNaoNegativoOpcional(req.body.volumes, 'volumes');
      if (req.body?.valorMercadoria !== undefined) dados.valorMercadoria = validarNumeroNaoNegativoOpcional(req.body.valorMercadoria, 'valorMercadoria');
      if (req.body?.modalidade !== undefined) dados.modalidade = validarModalidade(req.body.modalidade);
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
      if (temPercentual === temValorFinal) {
        throw new ErroValidacao('Informe exatamente um dos dois: "percentualAcrescimo" OU "valorFreteClienteInformado".');
      }
      const fechamento = await servicoFecharCotacao(
        {
          cotacaoId,
          percentualAcrescimo: temPercentual ? validarNumeroNaoNegativoObrigatorio(req.body.percentualAcrescimo, 'percentualAcrescimo') : undefined,
          valorFreteClienteInformado: temValorFinal
            ? validarNumeroNaoNegativoObrigatorio(req.body.valorFreteClienteInformado, 'valorFreteClienteInformado')
            : undefined,
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
