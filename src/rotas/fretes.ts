import { Router } from 'express';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import type { ClienteOmie } from '../omie/cliente.js';
import { ErroValidacao } from '../validacao.js';
import {
  servicoAtualizarCotacao,
  servicoAtualizarTransportadora,
  servicoAtualizarVeiculo,
  servicoBuscarCotacao,
  servicoBuscarFechamento,
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
  servicoFecharCotacao,
  servicoListarCotacoes,
  servicoListarPropostas,
  servicoListarTransportadoras,
  servicoListarVeiculos,
  servicoPrepararCotacaoDeOmie,
  servicoRejeitarProposta,
  servicoSelecionarProposta,
} from '../fretes/fretesServico.js';
import type { ModalidadeExecucao, StatusCotacao } from '../fretes/tipos.js';
import {
  validarCnpjOpcional,
  validarDestinoManualOpcional,
  validarEmailOpcional,
  validarIdOmieOpcional,
  validarInteiroNaoNegativoOpcional,
  validarModalidade,
  validarModalidadeExecucao,
  validarNumeroNaoNegativoObrigatorio,
  validarNumeroNaoNegativoOpcional,
  validarTextoObrigatorio,
  validarTextoOpcional,
  validarUuid,
  validarUuidOpcional,
} from '../fretes/validacao.js';
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

  rotas.get(
    '/api/fretes/omie/pedidos/:numero/preparar',
    ...protegida,
    assincrono(async (req, res) => {
      const numero = validarTextoObrigatorio(req.params.numero, 'numero');
      res.json(await servicoPrepararCotacaoDeOmie(cliente, numero));
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
      const cotacao = await servicoCriarCotacaoDeOmie(cliente, numero, destinoOverride, dadosComplementares, req.usuario!.id);
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
