import { config } from '../config.js';
import type { EstoqueOmie, PedidoOmie } from '../calculo/tipos.js';
import { CachePostgres } from './cachePostgres.js';
import {
  CODIGO_OPERACAO_VENDA_PRODUTO,
  classificarEtapa,
  type EtapaFaturamento,
  type ResultadoClassificacao,
} from './classificacaoDocumento.js';
import { OmieError, OmieErroLimiteExcedido, OmieErroTransitorio, indicaLimiteExcedido, verificarFalhaNoCorpo } from './erros.js';
import { Limitador } from './limitador.js';

const URL_BASE = 'https://app.omie.com.br/api/v1';

/** Converte `dd/mm/aaaa` (+ `hh:mm:ss` opcional, como a Omie retorna) num timestamp ordenável. `null` se ausente/inválido. */
function timestampAprovacao(data: string | null, hora: string | null): number | null {
  if (data === null) return null;
  const partesData = data.split('/');
  if (partesData.length !== 3) return null;
  const dia = Number(partesData[0]);
  const mes = Number(partesData[1]);
  const ano = Number(partesData[2]);
  if (!Number.isFinite(dia) || !Number.isFinite(mes) || !Number.isFinite(ano)) return null;

  let horas = 0;
  let minutos = 0;
  let segundos = 0;
  if (hora !== null) {
    const partesHora = hora.split(':').map(Number);
    horas = partesHora[0] ?? 0;
    minutos = partesHora[1] ?? 0;
    segundos = partesHora[2] ?? 0;
  }

  const timestamp = new Date(ano, mes - 1, dia, horas, minutos, segundos).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * Ordena por data de aprovação (`dataAprovacao`/`horaAprovacao`), mais
 * recente primeiro. Pedidos sem data de aprovação vão para o final, sem
 * quebrar a ordenação dos demais.
 */
export function ordenarPorDataAprovacaoDescendente(
  pedidos: Array<{ dataAprovacao: string | null; horaAprovacao: string | null }>,
): void {
  pedidos.sort((a, b) => {
    const tsA = timestampAprovacao(a.dataAprovacao, a.horaAprovacao);
    const tsB = timestampAprovacao(b.dataAprovacao, b.horaAprovacao);
    if (tsA === null && tsB === null) return 0;
    if (tsA === null) return 1;
    if (tsB === null) return -1;
    return tsB - tsA;
  });
}

export interface FiltrosListagem {
  pagina: number;
  registrosPorPagina: number;
  etapa?: string;
  dataDe?: string;
  dataAte?: string;
}

export interface PedidoResumo {
  codigoPedido: number;
  numeroPedido: string;
  etapa: string;
  data?: string;
  valorTotal: number;
  classificacao: ResultadoClassificacao;
  /** Rótulo real do status atual (descrição da etapa configurada na conta Omie), ou `null` se a etapa não pôde ser classificada. */
  statusRotulo: string | null;
  /** Data (`dd/mm/aaaa`) da última alteração do pedido na Omie (`info_cadastro.dAlt`) — usada como proxy de "aprovado em", já que a Omie não expõe histórico de mudança de etapa. `null` se a Omie não informou. */
  dataAprovacao: string | null;
  /** Hora (`hh:mm:ss`) correspondente a `dataAprovacao` (`info_cadastro.hAlt`), quando disponível. */
  horaAprovacao: string | null;
}

export interface ListaPedidosResposta {
  pedidos: PedidoResumo[];
  pagina: number;
  totalDePaginas: number;
}

export interface ListaPedidosCompletaResposta {
  pedidos: PedidoOmie[];
  pagina: number;
  totalDePaginas: number;
}

export interface Vendedor {
  codigo: number;
  nome: string;
  inativo: boolean;
}

/** Confirmado contra a API real em 2026-09-16 (investigação 3.1.2/3.1.3) — endereço cadastral do cliente, campos soltos no nível raiz de `ConsultarCliente`. */
export interface EnderecoCadastralOmie {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigoMunicipio: string | null;
}

/**
 * Confirmado contra a API real em 2026-09-16 (investigação 3.1.3) — endereço de entrega
 * PADRÃO DO CLIENTE (objeto `enderecoEntrega`, prefixo `ent*`), distinto do endereço
 * cadastral acima e também distinto do endereço específico de um pedido (ver
 * `src/fretes/omieFretes.ts`, que lê `informacoes_adicionais.outros_detalhes` do pedido).
 * Nunca tem `complemento` (campo ausente nesta estrutura em todas as respostas observadas).
 */
export interface EnderecoEntregaOmie {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

export interface Cliente {
  codigo: number;
  razaoSocial: string;
  nomeFantasia: string;
  enderecoCadastral: EnderecoCadastralOmie;
  /** `null` quando a Omie não retornou nenhum campo preenchido neste bloco — nunca um objeto com todos os campos `null` (ver Fase 3.2, seção 11: objeto presente não significa endereço válido). */
  enderecoEntrega: EnderecoEntregaOmie | null;
}

/** Campos usados de `ConsultarProduto` — a Omie devolve muito mais campos além destes. */
export interface ProdutoOmie {
  codigo_produto: number;
  codigo?: string;
  descricao?: string;
  codigo_familia?: number;
  descricao_familia?: string;
  /**
   * Preço da tabela de vendas ATIVA do produto (cadastro) — confirmado
   * contra a API real em 2026-09-10: difere do `valor_unitario` gravado na
   * linha do pedido em 25 de 25 itens testados (o preço do pedido carrega
   * ajustes/impostos daquela venda específica; este é o preço de tabela
   * estável do produto). É a base correta para o custo estimado
   * (`custoEstimado.ts`), nunca o preço do pedido.
   */
  valor_unitario?: number;
}

export interface TituloContaReceber {
  codigoLancamentoOmie: number;
  /**
   * Código do pedido de origem (`nCodPedido`) — só populado em títulos
   * gerados a partir de um Pedido de Venda (`id_origem: "VENR"`).
   *
   * ATENÇÃO — faturamento parcial (confirmado contra a API real em
   * 2026-09-10): quando um pedido é faturado em mais de uma nota fiscal
   * (ex.: pedido "154" faturado como NF 00025739 e depois NF 00025767, cada
   * uma virando "154/1", "154/2" na Omie), CADA fatura parcial recebe um
   * `nCodPedido` PRÓPRIO e DIFERENTE do `codigo_pedido` do pedido original —
   * `ConsultarPedido` por número ignora o sufixo "/1"/"/2" e sempre devolve
   * o pedido original, então esses códigos nunca aparecem em `ListarPedidos`.
   * `numeroPedido` (abaixo), porém, continua igual ao do pedido original em
   * todas as faturas parciais — por isso o vínculo título → pedido deve
   * considerar `numeroPedido` também, nunca só `codigoPedido` (ver
   * `relatorioComissionamento.ts`).
   */
  codigoPedido: number | null;
  numeroPedido: string | null;
  /** Formato "NNN/TTT" (parcela atual/total), ex.: "001/003" — numeração reinicia por fatura, não por pedido. */
  numeroParcela: string | null;
  /** Número da nota fiscal emitida para este título (`numero_documento_fiscal`) — identifica de qual fatura parcial o título veio. */
  numeroNotaFiscal: string | null;
  valorDocumento: number;
  dataVencimento: string;
  /**
   * Status literal retornado pela Omie (`status_titulo`). Valores
   * observados: "RECEBIDO" (baixado), "ATRASADO", "A VENCER", "VENCE HOJE",
   * "CANCELADO". A Omie NÃO expõe uma data de baixa explícita nesta
   * consulta (`ConsultarContaReceber` retorna `recebimento: null` mesmo em
   * títulos "RECEBIDO", verificado em 2026-09-05) — por isso a baixa é
   * identificada apenas por este status, sem data associada.
   */
  statusTitulo: string;
  codigoVendedor: number | null;
}

/**
 * Cliente HTTP somente leitura para a API da Omie. Toda chamada de escrita é
 * proibida por design: apenas os métodos ListarPedidos, ConsultarPedido,
 * ConsultarProduto e ObterEstoqueProduto são implementados.
 */
const MINUTOS = 60 * 1000;

export class ClienteOmie {
  private readonly limitador: Limitador;
  // TTL por categoria (regra de 2026-09-11: cache em Postgres, nunca mais vive só até o processo
  // reiniciar) — dados que raramente mudam (produto/etapas/vendedores/clientes) ficam mais tempo;
  // dados voláteis (estoque, listagem de pedidos, status de título financeiro) ficam pouco.
  private readonly cacheProduto = new CachePostgres('produto', 60 * MINUTOS);
  private readonly cacheEstoque = new CachePostgres('estoque', 10 * MINUTOS);
  private readonly cacheEtapas = new CachePostgres('etapas', 60 * MINUTOS);
  private readonly cacheListagem = new CachePostgres('listagem', 10 * MINUTOS);
  private readonly cacheVendedores = new CachePostgres('vendedores', 60 * MINUTOS);
  private readonly cacheClientes = new CachePostgres('clientes', 60 * MINUTOS);
  private readonly cacheContasReceber = new CachePostgres('contas-receber', 5 * MINUTOS);

  constructor(intervaloMinimoMs: number = config.intervaloMinimoMs) {
    this.limitador = new Limitador(intervaloMinimoMs);
  }

  async limparCache(): Promise<void> {
    await Promise.all([
      this.cacheProduto.limpar(),
      this.cacheEstoque.limpar(),
      this.cacheEtapas.limpar(),
      this.cacheListagem.limpar(),
      this.cacheVendedores.limpar(),
      this.cacheClientes.limpar(),
      this.cacheContasReceber.limpar(),
    ]);
  }

  private async chamar<T>(caminho: string, call: string, param: Record<string, unknown>): Promise<T> {
    return this.limitador.executar(async () => {
      let resposta: Response;
      try {
        resposta = await fetch(`${URL_BASE}${caminho}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call,
            app_key: config.omieAppKey,
            app_secret: config.omieAppSecret,
            param: [param],
          }),
        });
      } catch {
        throw new OmieErroTransitorio(`Falha de rede ao chamar ${call}`);
      }

      let corpo: unknown;
      const textoBruto = await resposta.text();
      try {
        corpo = JSON.parse(textoBruto);
      } catch {
        throw new OmieErroTransitorio(`Resposta inválida (não-JSON) ao chamar ${call}`);
      }

      const falha = verificarFalhaNoCorpo(corpo);
      if (falha !== null) {
        const mensagem = falha.faultstring ?? `Erro desconhecido da Omie (${call})`;
        if (indicaLimiteExcedido(falha.faultcode, falha.faultstring)) {
          throw new OmieErroLimiteExcedido(mensagem);
        }
        throw new OmieError(mensagem, falha.faultcode);
      }

      if (resposta.status === 425) {
        throw new OmieErroLimiteExcedido(`Limite de requisições excedido ao chamar ${call}`);
      }

      if (!resposta.ok) {
        throw new OmieError(`Erro HTTP ${resposta.status} ao chamar ${call}`);
      }

      return corpo as T;
    });
  }

  /**
   * Busca (e cacheia em memória, indefinidamente durante o processo — a
   * configuração do Kanban de vendas raramente muda) a configuração real de
   * etapas de "Venda de Produto" desta conta Omie. É a única fonte confiável
   * para decidir se uma etapa representa Orçamento ou Pedido — ver
   * `classificacaoDocumento.ts`.
   */
  async listarEtapasVendaProduto(): Promise<EtapaFaturamento[]> {
    return this.cacheEtapas.obterOuBuscar('etapas-venda-produto', async () => {
      const resposta = await this.chamar<{
        cadastros?: Array<{
          cCodOperacao?: string;
          etapas?: Array<{ cCodigo: string; cDescrPadrao: string; cDescricao: string; cInativo: string }>;
        }>;
      }>('/produtos/etapafat/', 'ListarEtapasFaturamento', { pagina: 1, registros_por_pagina: 100 });

      const operacaoVendaProduto = (resposta.cadastros ?? []).find(
        (cadastro) => cadastro.cCodOperacao === CODIGO_OPERACAO_VENDA_PRODUTO,
      );

      return (operacaoVendaProduto?.etapas ?? []).map((etapa) => ({
        codigo: etapa.cCodigo,
        descricaoPadrao: etapa.cDescrPadrao,
        descricao: etapa.cDescricao,
        inativa: etapa.cInativo === 'S',
      }));
    });
  }

  /** Classifica um código de etapa como PEDIDO ou ORCAMENTO (ou ambíguo) — ver `classificacaoDocumento.ts`. */
  async classificarPedido(etapa: string): Promise<ResultadoClassificacao> {
    const etapas = await this.listarEtapasVendaProduto();
    return classificarEtapa(etapa, etapas);
  }

  /**
   * A Omie considera duas chamadas `ListarPedidos` com os mesmos parâmetros
   * em sequência como "consumo redundante" e rejeita a segunda. Como
   * `/api/pedidos` e `/api/orcamentos` fazem exatamente a mesma chamada
   * subjacente para a mesma página (a Omie pagina os dois tipos juntos —
   * a separação é filtrada localmente, ver `rotas/documentos.ts`), o
   * resultado bruto é cacheado por combinação de filtros: trocar de aba
   * reaproveita a mesma página já buscada, em vez de repetir a chamada.
   */
  private async listarPedidosBruto(
    filtros: FiltrosListagem,
  ): Promise<{ pagina: number; total_de_paginas: number; pedido_venda_produto?: PedidoOmie[] }> {
    const chave = JSON.stringify(filtros);
    return this.cacheListagem.obterOuBuscar(chave, () => {
      const param: Record<string, unknown> = {
        pagina: filtros.pagina,
        registros_por_pagina: filtros.registrosPorPagina,
        apenas_importado_api: 'N',
      };
      if (filtros.etapa !== undefined) param.etapa = filtros.etapa;
      if (filtros.dataDe !== undefined) param.filtrar_por_data_de = filtros.dataDe;
      if (filtros.dataAte !== undefined) param.filtrar_por_data_ate = filtros.dataAte;

      return this.chamar<{
        pagina: number;
        total_de_paginas: number;
        pedido_venda_produto?: PedidoOmie[];
      }>('/produtos/pedido/', 'ListarPedidos', param);
    });
  }

  async listarPedidos(filtros: FiltrosListagem): Promise<ListaPedidosResposta> {
    const [resposta, etapasVendaProduto] = await Promise.all([
      this.listarPedidosBruto(filtros),
      this.listarEtapasVendaProduto(),
    ]);

    const registros = resposta.pedido_venda_produto ?? [];
    const pedidos = registros.map((pedido) => {
      const classificacao = classificarEtapa(pedido.cabecalho.etapa, etapasVendaProduto);
      const dataAprovacao = pedido.infoCadastro?.dAlt ?? null;
      const horaAprovacao = pedido.infoCadastro?.hAlt ?? null;
      return {
        codigoPedido: pedido.cabecalho.codigo_pedido,
        numeroPedido: pedido.cabecalho.numero_pedido,
        etapa: pedido.cabecalho.etapa,
        data: pedido.cabecalho.data_previsao,
        valorTotal: pedido.total_pedido?.valor_total_pedido ?? 0,
        classificacao,
        statusRotulo: classificacao.ambiguo ? null : classificacao.rotulo || null,
        dataAprovacao,
        horaAprovacao,
      };
    });

    ordenarPorDataAprovacaoDescendente(pedidos);

    return {
      pagina: resposta.pagina,
      totalDePaginas: resposta.total_de_paginas,
      pedidos,
    };
  }

  /**
   * Igual a `listarPedidos`, mas retorna o registro completo de cada pedido
   * (com `det`, `informacoes_adicionais`, `lista_parcelas` etc.) em vez do
   * resumo — a Omie já devolve essa estrutura completa em `ListarPedidos`
   * (confirmado em 2026-09-05 contra a API real), então os relatórios de
   * Vendas/Orçamentos/Comissionamento não precisam de uma chamada
   * `ConsultarPedido` por registro: usam o mesmo resultado cacheado de
   * `listarPedidosBruto`.
   */
  async listarPedidosCompletos(filtros: FiltrosListagem): Promise<ListaPedidosCompletaResposta> {
    const resposta = await this.listarPedidosBruto(filtros);
    return {
      pagina: resposta.pagina,
      totalDePaginas: resposta.total_de_paginas,
      pedidos: resposta.pedido_venda_produto ?? [],
    };
  }

  /** Vendedores cadastrados nesta conta Omie — nunca uma lista fixa no código. */
  async listarVendedores(): Promise<Vendedor[]> {
    return this.cacheVendedores.obterOuBuscar('vendedores', async () => {
      const vendedores: Vendedor[] = [];
      const registrosPorPagina = 100;
      let pagina = 1;
      let totalDePaginas = 1;

      do {
        const resposta = await this.chamar<{
          pagina: number;
          total_de_paginas: number;
          cadastro?: Array<{ codigo: number; nome: string; inativo: string }>;
        }>('/geral/vendedores/', 'ListarVendedores', { pagina, registros_por_pagina: registrosPorPagina });

        for (const registro of resposta.cadastro ?? []) {
          vendedores.push({ codigo: registro.codigo, nome: registro.nome, inativo: registro.inativo === 'S' });
        }

        totalDePaginas = resposta.total_de_paginas;
        pagina += 1;
      } while (pagina <= totalDePaginas);

      return vendedores;
    });
  }

  /**
   * Dados cadastrais de um cliente (razão social, nome fantasia, endereço cadastral e
   * endereço de entrega padrão) — cacheado por código. Os campos de endereço foram
   * adicionados na Fase 3.2 do módulo de Fretes (2026-09-16): mesma chamada, mesma chave de
   * cache/TTL já existentes — só passou a extrair mais campos da mesma resposta já buscada
   * (a Omie sempre devolveu esses campos; só não eram lidos antes, ver investigação 3.1.2).
   * Nenhum consumidor existente (`relatorioVendas.ts`, `montarRelatorio.ts`) é afetado —
   * ambos só leem `razaoSocial`/`nomeFantasia`.
   */
  async consultarCliente(codigoCliente: number): Promise<Cliente | null> {
    return this.cacheClientes.obterOuBuscar(`cliente:${codigoCliente}`, async () => {
      try {
        const resposta = await this.chamar<{
          codigo_cliente_omie: number;
          razao_social: string;
          nome_fantasia: string;
          cep?: string;
          logradouro?: string;
          endereco_numero?: string;
          complemento?: string;
          bairro?: string;
          cidade?: string;
          estado?: string;
          cidade_ibge?: string;
          enderecoEntrega?: {
            entCEP?: string;
            entEndereco?: string;
            entNumero?: string;
            entBairro?: string;
            entCidade?: string;
            entEstado?: string;
          };
        }>('/geral/clientes/', 'ConsultarCliente', { codigo_cliente_omie: codigoCliente });

        const entrega = resposta.enderecoEntrega;
        const entregaPreenchida =
          entrega !== undefined &&
          ((entrega.entCEP ?? '').trim() !== '' || ((entrega.entEndereco ?? '').trim() !== '' && (entrega.entCidade ?? '').trim() !== ''));

        return {
          codigo: resposta.codigo_cliente_omie,
          razaoSocial: resposta.razao_social,
          nomeFantasia: resposta.nome_fantasia,
          enderecoCadastral: {
            cep: resposta.cep ?? null,
            logradouro: resposta.logradouro ?? null,
            numero: resposta.endereco_numero ?? null,
            complemento: resposta.complemento ?? null,
            bairro: resposta.bairro ?? null,
            cidade: resposta.cidade ?? null,
            uf: resposta.estado ?? null,
            codigoMunicipio: resposta.cidade_ibge ?? null,
          },
          enderecoEntrega: entregaPreenchida
            ? {
                cep: entrega?.entCEP ?? null,
                logradouro: entrega?.entEndereco ?? null,
                numero: entrega?.entNumero ?? null,
                bairro: entrega?.entBairro ?? null,
                cidade: entrega?.entCidade ?? null,
                uf: entrega?.entEstado ?? null,
              }
            : null,
        };
      } catch (erro) {
        if (erro instanceof OmieError) return null;
        throw erro;
      }
    });
  }

  /**
   * Títulos de contas a receber de um vendedor (`ListarContasReceber`,
   * `financas/contareceber/`, filtro `filtrar_por_vendedor` — confirmado
   * funcional contra a API real em 2026-09-05). Usado pelo comissionamento
   * para localizar as parcelas financeiras de cada pedido: apenas títulos
   * com `id_origem: "VENR"` (gerados a partir de um Pedido de Venda) trazem
   * `nCodPedido`/`numero_pedido`/`numero_parcela` — títulos lançados
   * manualmente (`id_origem: "MANR"`) não têm vínculo com nenhum pedido e
   * são ignorados aqui.
   */
  async listarContasReceberPorVendedor(codigoVendedor: number): Promise<TituloContaReceber[]> {
    return this.cacheContasReceber.obterOuBuscar(`vendedor:${codigoVendedor}`, async () => {
      const titulos: TituloContaReceber[] = [];
      const registrosPorPagina = 100;
      let pagina = 1;
      let totalDePaginas = 1;

      do {
        const resposta = await this.chamar<{
          pagina: number;
          total_de_paginas: number;
          conta_receber_cadastro?: Array<{
            codigo_lancamento_omie: number;
            nCodPedido?: number;
            numero_pedido?: string;
            numero_parcela?: string;
            numero_documento_fiscal?: string;
            valor_documento: number;
            data_vencimento: string;
            status_titulo: string;
            codigo_vendedor?: number;
            id_origem: string;
          }>;
        }>('/financas/contareceber/', 'ListarContasReceber', {
          pagina,
          registros_por_pagina: registrosPorPagina,
          apenas_importado_api: 'N',
          filtrar_por_vendedor: codigoVendedor,
        });

        for (const registro of resposta.conta_receber_cadastro ?? []) {
          if (registro.id_origem !== 'VENR') continue; // sem vínculo confiável com um pedido — ignorado, nunca adivinhado
          titulos.push({
            codigoLancamentoOmie: registro.codigo_lancamento_omie,
            codigoPedido: registro.nCodPedido ?? null,
            numeroPedido: registro.numero_pedido ?? null,
            numeroParcela: registro.numero_parcela ?? null,
            numeroNotaFiscal: registro.numero_documento_fiscal ?? null,
            valorDocumento: registro.valor_documento,
            dataVencimento: registro.data_vencimento,
            statusTitulo: registro.status_titulo,
            codigoVendedor: registro.codigo_vendedor ?? null,
          });
        }

        totalDePaginas = resposta.total_de_paginas;
        pagina += 1;
      } while (pagina <= totalDePaginas);

      return titulos;
    });
  }

  async consultarPedido(identificador: { numeroPedido?: string; codigoPedido?: number }): Promise<PedidoOmie> {
    const param: Record<string, unknown> = {};
    if (identificador.numeroPedido !== undefined) param.numero_pedido = identificador.numeroPedido;
    if (identificador.codigoPedido !== undefined) param.codigo_pedido = identificador.codigoPedido;

    const resposta = await this.chamar<{ pedido_venda_produto: PedidoOmie }>(
      '/produtos/pedido/',
      'ConsultarPedido',
      param,
    );
    return resposta.pedido_venda_produto;
  }

  async consultarProduto(codigoProduto: number): Promise<ProdutoOmie> {
    return this.cacheProduto.obterOuBuscar(`produto:${codigoProduto}`, () =>
      this.chamar<ProdutoOmie>('/geral/produtos/', 'ConsultarProduto', { codigo_produto: codigoProduto }),
    );
  }

  /**
   * A Omie não expõe consulta de estoque por produto individual — apenas a
   * listagem paginada `ListarPosEstoque`, com todos os produtos da posição
   * de estoque na data informada. Por isso a posição inteira é buscada (com
   * paginação) e cacheada em memória por data de referência; a busca por
   * produto é feita localmente sobre esse resultado cacheado.
   *
   * `cExibeTodos: 'S'` (nunca 'N') — confirmado contra a API real em
   * 2026-09-09: com 'N' a Omie OMITE produtos com saldo em estoque zerado da
   * resposta, mesmo quando o produto tem um Custo Médio Contábil (`nCMC`)
   * válido e atualizado (ex.: item totalmente vendido, sem reposição ainda).
   * Isso fazia o sistema relatar "sem custo encontrado" para produtos cujo
   * custo estava, na verdade, disponível — só invisível por causa deste
   * filtro.
   */
  private async obterPosicaoEstoque(dataReferencia: string): Promise<Map<number, Record<string, unknown>>> {
    return this.cacheEstoque.obterOuBuscar(`posicao:${dataReferencia}`, async () => {
      const porProduto = new Map<number, Record<string, unknown>>();
      const registrosPorPagina = 500;
      let pagina = 1;
      let totalDePaginas = 1;

      do {
        const resposta = await this.chamar<{
          nPagina: number;
          nTotPaginas: number;
          produtos?: Record<string, unknown>[];
        }>('/estoque/consulta/', 'ListarPosEstoque', {
          nPagina: pagina,
          nRegPorPagina: registrosPorPagina,
          dDataPosicao: dataReferencia,
          cExibeTodos: 'S',
          codigo_local_estoque: 0,
        });

        for (const registro of resposta.produtos ?? []) {
          const codigo = Number(registro.nCodProd);
          if (Number.isFinite(codigo)) porProduto.set(codigo, registro);
        }

        totalDePaginas = resposta.nTotPaginas;
        pagina += 1;
      } while (pagina <= totalDePaginas);

      return porProduto;
    });
  }

  async obterEstoqueProduto(codigoProduto: number, dataReferencia: string): Promise<EstoqueOmie> {
    const posicao = await this.obterPosicaoEstoque(dataReferencia);
    const registro = posicao.get(codigoProduto);
    return { listaEstoque: registro !== undefined ? [registro] : [] };
  }
}
