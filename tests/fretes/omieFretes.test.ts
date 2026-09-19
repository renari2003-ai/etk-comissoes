import { describe, expect, it } from 'vitest';
import type { ClienteOmie, Cliente } from '../../src/omie/cliente.js';
import type { PedidoOmie } from '../../src/calculo/tipos.js';
import { extrairDadosLogisticos, extrairEnderecoPedido, formatarDestinoTexto, prepararCotacaoDeOmie } from '../../src/fretes/omieFretes.js';
import type { EnderecoDestino } from '../../src/fretes/tipos.js';

/** Pedido bruto no formato confirmado nas investigações 3.1.1/3.1.3 (2026-09-16) — inclui campos não tipados em `PedidoOmie`. */
function pedidoBruto(extra: Record<string, unknown> = {}): PedidoOmie {
  return {
    cabecalho: {
      codigo_pedido: 999001,
      numero_pedido: '999001',
      etapa: '10',
      codigo_cliente: 555,
    },
    det: [
      { produto: { codigo_produto: 1, codigo: 'ABC', descricao: 'Produto Teste', quantidade: 2, valor_unitario: 10 } },
    ],
    total_pedido: { valor_total_pedido: 100 },
    informacoes_adicionais: { codVend: 42 },
    frete: {
      valor_frete: 15,
      valor_seguro: 0,
      outras_despesas: 0,
      // campos confirmados na investigação real, não tipados em FretePedidoOmie:
      peso_bruto: 12.5,
      peso_liquido: 10,
      quantidade_volumes: 3,
      especie_volumes: 'CAIXA',
      modalidade: 'CIF',
      codigo_transportadora: 777,
    } as PedidoOmie['frete'],
    ...extra,
  } as PedidoOmie;
}

describe('extrairDadosLogisticos (Fase 3.2, seção 19)', () => {
  it('extrai peso bruto/líquido/volumes/espécie/CIF-FOB/transportadora confirmados na investigação real', () => {
    const dados = extrairDadosLogisticos(pedidoBruto());
    expect(dados).toEqual({
      pesoBruto: 12.5,
      pesoLiquido: 10,
      quantidadeVolumes: 3,
      especieVolumes: 'CAIXA',
      cifFobOmie: 'CIF',
      transportadoraOmieCodigo: 777,
    });
  });

  it('nunca inventa valores ausentes — tudo null quando o bloco frete não traz esses campos', () => {
    const dados = extrairDadosLogisticos({ ...pedidoBruto(), frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0 } });
    expect(dados).toEqual({
      pesoBruto: null,
      pesoLiquido: null,
      quantidadeVolumes: null,
      especieVolumes: null,
      cifFobOmie: null,
      transportadoraOmieCodigo: null,
    });
  });
});

describe('extrairEnderecoPedido (investigação 3.1.3 — informacoes_adicionais.outros_detalhes)', () => {
  it('extrai o endereço específico do pedido quando outros_detalhes está preenchido', () => {
    const pedido = pedidoBruto({
      informacoes_adicionais: {
        codVend: 42,
        outros_detalhes: {
          cCEPOd: '01000-000',
          cEnderecoOd: 'Rua do Pedido',
          cNumeroOd: '100',
          cBairroOd: 'Centro',
          cCidadeOd: 'São Paulo',
          cEstadoOd: 'SP',
        },
      },
    });
    expect(extrairEnderecoPedido(pedido)).toEqual({
      cep: '01000-000',
      logradouro: 'Rua do Pedido',
      numero: '100',
      complemento: null,
      bairro: 'Centro',
      cidade: 'São Paulo',
      uf: 'SP',
      codigoMunicipio: null,
    });
  });

  it('retorna null quando outros_detalhes não existe', () => {
    expect(extrairEnderecoPedido(pedidoBruto())).toBeNull();
  });
});

describe('formatarDestinoTexto (compatibilidade com o campo destino já existente)', () => {
  it('monta um resumo legível a partir do destino estruturado', () => {
    const destino: EnderecoDestino = {
      origem: 'PEDIDO',
      cep: '01000-000',
      logradouro: 'Rua Teste',
      numero: '100',
      complemento: null,
      bairro: 'Centro',
      cidade: 'São Paulo',
      uf: 'SP',
      codigoMunicipio: null,
    };
    expect(formatarDestinoTexto(destino)).toBe('Rua Teste, nº 100, Centro, São Paulo/SP');
  });

  it('retorna null quando não há nenhum campo preenchido', () => {
    const destino: EnderecoDestino = {
      origem: 'MANUAL',
      cep: null,
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      cidade: null,
      uf: null,
      codigoMunicipio: null,
    };
    expect(formatarDestinoTexto(destino)).toBeNull();
  });
});

/**
 * Fake mínimo de `ClienteOmie` — métodos usados por `prepararCotacaoDeOmie`. Fase 4A.5:
 * `classificarPedido` sempre classifica como PEDIDO (etapa "10", ver `pedidoBruto()`) —
 * estes testes são sobre a montagem da preparação em si, não sobre a classificação.
 */
function clienteOmieFake(pedido: PedidoOmie, cliente: Cliente | null): ClienteOmie {
  return {
    consultarPedido: async () => pedido,
    consultarCliente: async () => cliente,
    classificarPedido: async () => ({ tipo: 'PEDIDO', ambiguo: false, rotulo: '10 - Em andamento' }),
  } as unknown as ClienteOmie;
}

function clienteComEndereco(): Cliente {
  return {
    codigo: 555,
    razaoSocial: 'Cliente Teste LTDA',
    nomeFantasia: 'Cliente Teste',
    enderecoCadastral: {
      cep: '02000-000',
      logradouro: 'Rua Cadastral',
      numero: '10',
      complemento: null,
      bairro: 'Bairro Cadastral',
      cidade: 'Cidade Cadastral',
      uf: 'SP',
      codigoMunicipio: '3550308',
    },
    enderecoEntrega: null,
  };
}

describe('prepararCotacaoDeOmie (Fase 3.2, seção 38 — preparação, nunca persiste)', () => {
  it('monta a preparação combinando pedido + cliente, resolvendo o destino pela prioridade', async () => {
    const cliente = clienteOmieFake(pedidoBruto(), clienteComEndereco());
    const preparacao = await prepararCotacaoDeOmie(cliente, '999001', 'PEDIDO');

    expect(preparacao.pedidoOmieId).toBe(999001);
    expect(preparacao.pedidoOmieNumero).toBe('999001');
    expect(preparacao.clienteOmieId).toBe(555);
    expect(preparacao.clienteNome).toBe('Cliente Teste LTDA');
    expect(preparacao.vendedorOmieId).toBe(42);
    expect(preparacao.destino?.origem).toBe('CLIENTE_CADASTRAL'); // sem endereço no pedido nem enderecoEntrega
    expect(preparacao.destino?.cidade).toBe('Cidade Cadastral');
    expect(preparacao.logistica.pesoBruto).toBe(12.5);
    expect(preparacao.itens).toEqual([{ codigo: 'ABC', descricao: 'Produto Teste', quantidade: 2 }]);
    expect(preparacao.valorTotalPedido).toBe(100);
  });

  it('destino null quando nenhuma das três fontes tem endereço usável', async () => {
    const clienteSemEndereco: Cliente = {
      codigo: 555,
      razaoSocial: 'Cliente Sem Endereço',
      nomeFantasia: '',
      enderecoCadastral: { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, codigoMunicipio: null },
      enderecoEntrega: null,
    };
    const cliente = clienteOmieFake(pedidoBruto(), clienteSemEndereco);
    const preparacao = await prepararCotacaoDeOmie(cliente, '999001', 'PEDIDO');
    expect(preparacao.destino).toBeNull();
  });

  it('rejeita número de pedido vazio sem consultar a Omie', async () => {
    const cliente = clienteOmieFake(pedidoBruto(), clienteComEndereco());
    await expect(prepararCotacaoDeOmie(cliente, '   ', 'PEDIDO')).rejects.toThrow();
  });
});

/**
 * Fase 4A.5 — Orçamento Omie como origem de cotação. Pedido e Orçamento são o MESMO
 * documento na Omie (`pedido_venda_produto`), diferenciados só pela `etapa` — por isso os
 * testes abaixo variam apenas o retorno de `classificarPedido`, nunca o formato do pedido.
 */
function clienteOmieFakeComClassificacao(
  pedido: PedidoOmie,
  cliente: Cliente | null,
  classificacao: { tipo: 'PEDIDO' | 'ORCAMENTO'; ambiguo: false; rotulo: string } | { tipo: null; ambiguo: true; motivo: string },
): ClienteOmie {
  return {
    consultarPedido: async () => pedido,
    consultarCliente: async () => cliente,
    classificarPedido: async () => classificacao,
  } as unknown as ClienteOmie;
}

describe('prepararCotacaoDeOmie — Orçamento Omie (Fase 4A.5)', () => {
  it('Orçamento válido: monta a preparação com cliente, vendedor, destino e snapshot do tipo/etapa', async () => {
    const cliente = clienteOmieFakeComClassificacao(pedidoBruto(), clienteComEndereco(), {
      tipo: 'ORCAMENTO',
      ambiguo: false,
      rotulo: 'Orçamento',
    });
    const preparacao = await prepararCotacaoDeOmie(cliente, '999001', 'ORCAMENTO');

    expect(preparacao.documentoOmieTipo).toBe('ORCAMENTO');
    expect(preparacao.rotuloEtapaOmie).toBe('Orçamento');
    expect(preparacao.pedidoOmieId).toBe(999001);
    expect(preparacao.pedidoOmieNumero).toBe('999001');
    expect(preparacao.clienteOmieId).toBe(555);
    expect(preparacao.clienteNome).toBe('Cliente Teste LTDA');
    expect(preparacao.vendedorOmieId).toBe(42);
    expect(preparacao.destino?.origem).toBe('CLIENTE_CADASTRAL');
    expect(preparacao.destino?.cidade).toBe('Cidade Cadastral');
  });

  it('Orçamento != Pedido: rejeita importar um Pedido real pela origem Orçamento', async () => {
    const cliente = clienteOmieFakeComClassificacao(pedidoBruto(), clienteComEndereco(), {
      tipo: 'PEDIDO',
      ambiguo: false,
      rotulo: '10 - Em andamento',
    });
    await expect(prepararCotacaoDeOmie(cliente, '999001', 'ORCAMENTO')).rejects.toThrow(/é um Pedido/);
  });

  it('Orçamento != Pedido: rejeita importar um Orçamento real pela origem Pedido (regra bidirecional)', async () => {
    const cliente = clienteOmieFakeComClassificacao(pedidoBruto(), clienteComEndereco(), {
      tipo: 'ORCAMENTO',
      ambiguo: false,
      rotulo: 'Orçamento',
    });
    await expect(prepararCotacaoDeOmie(cliente, '999001', 'PEDIDO')).rejects.toThrow(/é um Orçamento/);
  });

  it('etapa ambígua (fora da configuração da conta): rejeita sem assumir Pedido nem Orçamento', async () => {
    const cliente = clienteOmieFakeComClassificacao(pedidoBruto(), clienteComEndereco(), {
      tipo: null,
      ambiguo: true,
      motivo: 'etapa não encontrada em ListarEtapasFaturamento',
    });
    await expect(prepararCotacaoDeOmie(cliente, '999001', 'ORCAMENTO')).rejects.toThrow(/Não foi possível confirmar/);
    await expect(prepararCotacaoDeOmie(cliente, '999001', 'PEDIDO')).rejects.toThrow(/Não foi possível confirmar/);
  });

  it('Omie sem escrita: o fake de ClienteOmie usado na preparação de Orçamento não expõe nenhum método de escrita', async () => {
    const cliente = clienteOmieFakeComClassificacao(pedidoBruto(), clienteComEndereco(), {
      tipo: 'ORCAMENTO',
      ambiguo: false,
      rotulo: 'Orçamento',
    });
    await prepararCotacaoDeOmie(cliente, '999001', 'ORCAMENTO');
    const metodosChamados = Object.keys(cliente as unknown as Record<string, unknown>);
    expect(metodosChamados).toEqual(['consultarPedido', 'consultarCliente', 'classificarPedido']);
  });
});
