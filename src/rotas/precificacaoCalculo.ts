import { Router } from 'express';
import { exigirAutenticacao, exigirPermissao } from '../auth/middleware.js';
import type { ClienteOmie } from '../omie/cliente.js';
import { OmieError } from '../omie/erros.js';
import type { Aviso } from '../precificacao/avisos.js';
import type { ClienteVenda } from '../precificacao/calculo.js';
import { calcularProduto, clienteSimulado, validarEntradaCalculo, type EntradaCalculo } from '../precificacao/calculoProduto.js';
import { clienteParaVenda } from '../precificacao/clienteVenda.js';
import { obterClientePta } from '../precificacao/clientesPtaRepositorio.js';
import { coletarDadosOmie, type FonteOmiePrecificacao } from '../precificacao/coletaOmie.js';
import { obterCustosManuais } from '../precificacao/custosManuaisRepositorio.js';
import { lerTabelaFiscal } from '../precificacao/parametrosFiscaisRepositorio.js';
import { dataDeHojeFormatoOmie } from '../relatorio/relatorioVendas.js';
import { assincrono } from './erroHttp.js';

export type FonteOmieCalculo = FonteOmiePrecificacao & Pick<ClienteOmie, 'consultarClienteFiscal'>;

const AVISO_OMIE_CLIENTE: Aviso = {
  nivel: 'VERMELHO',
  codigo: 'OMIE_INDISPONIVEL',
  item: null,
  mensagem: 'Não foi possível consultar o cliente no Omie. Tente de novo em alguns minutos.',
};

/** Cliente do Omie (só leitura) + "cliente com PTA" do app, ou a simulação rápida. */
async function resolverCliente(
  entrada: EntradaCalculo,
  omie: FonteOmieCalculo,
): Promise<{ cliente: ClienteVenda | null; descricao: string; avisos: Aviso[] }> {
  if (!('codigo' in entrada.cliente)) {
    const s = clienteSimulado(entrada.cliente, entrada.finalidade);
    return { cliente: s.cliente, descricao: s.descricao, avisos: [] };
  }
  const codigo = entrada.cliente.codigo;
  let fiscal;
  try {
    fiscal = await omie.consultarClienteFiscal(codigo);
  } catch (erro) {
    if (erro instanceof OmieError) return { cliente: null, descricao: `Cliente ${codigo}`, avisos: [AVISO_OMIE_CLIENTE] };
    throw erro;
  }
  const pta = await obterClientePta(codigo);
  const r = clienteParaVenda(codigo, fiscal, pta?.comPta ?? false, entrada.finalidade);
  const nome = fiscal === null || fiscal.razaoSocial === '' ? `Cliente ${codigo}` : fiscal.razaoSocial;
  return { cliente: r.cliente, descricao: fiscal?.uf ? `${nome} (${fiscal.uf})` : nome, avisos: r.avisos };
}

/**
 * Etapa 5 — cálculo do preço de um produto (permissão `precificacao`). Omie SOMENTE LEITURA
 * (estrutura, cadastro, estoque e cliente); banco: tabela fiscal, custos manuais e "cliente com
 * PTA" (só leitura aqui). POST porque leva os custos "só nesta simulação"; nada é gravado.
 */
export function criarRotasCalculo(omie: FonteOmieCalculo, hojeFormatoOmie: () => string = dataDeHojeFormatoOmie): Router {
  const rotas = Router();

  rotas.post(
    '/api/precificacao/calculo',
    exigirAutenticacao,
    exigirPermissao('precificacao'),
    assincrono(async (req, res) => {
      const entrada = validarEntradaCalculo(req.body);
      const [tabela, dados, cliente] = await Promise.all([
        lerTabelaFiscal(),
        coletarDadosOmie(entrada.produto, omie, hojeFormatoOmie()),
        resolverCliente(entrada, omie),
      ]);
      const manuaisSalvos = await obterCustosManuais(dados.folhas.map((f) => f.codigo));
      res.json(
        calcularProduto({
          entrada,
          dados,
          tabela,
          manuaisSalvos,
          cliente: cliente.cliente,
          descricaoCliente: cliente.descricao,
          avisosCliente: cliente.avisos,
        }),
      );
    }),
  );

  return rotas;
}
