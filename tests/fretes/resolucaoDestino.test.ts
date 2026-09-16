import { describe, expect, it } from 'vitest';
import { resolverDestinoFrete, type CandidatoEndereco } from '../../src/fretes/resolucaoDestino.js';

function endereco(parcial: Partial<CandidatoEndereco>): CandidatoEndereco {
  return {
    cep: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    codigoMunicipio: null,
    ...parcial,
  };
}

describe('resolverDestinoFrete (Fase 3.2, seção 40/41)', () => {
  it('caso 1: pedido, entrega do cliente e cadastral todos preenchidos -> usa PEDIDO', () => {
    const resultado = resolverDestinoFrete({
      pedido: endereco({ cep: '11111-111', cidade: 'Pedido' }),
      clienteEntrega: endereco({ cep: '22222-222', cidade: 'Entrega' }),
      clienteCadastral: endereco({ cep: '33333-333', cidade: 'Cadastral' }),
    });
    expect(resultado?.origem).toBe('PEDIDO');
    expect(resultado?.cidade).toBe('Pedido');
  });

  it('caso 2: pedido sem endereço específico, cliente com enderecoEntrega -> usa CLIENTE_ENTREGA', () => {
    const resultado = resolverDestinoFrete({
      pedido: null,
      clienteEntrega: endereco({ cep: '22222-222', cidade: 'Entrega' }),
      clienteCadastral: endereco({ cep: '33333-333', cidade: 'Cadastral' }),
    });
    expect(resultado?.origem).toBe('CLIENTE_ENTREGA');
    expect(resultado?.cidade).toBe('Entrega');
  });

  it('caso 3: sem pedido e sem enderecoEntrega, só cadastral -> usa CLIENTE_CADASTRAL', () => {
    const resultado = resolverDestinoFrete({
      pedido: null,
      clienteEntrega: null,
      clienteCadastral: endereco({ cep: '33333-333', cidade: 'Cadastral' }),
    });
    expect(resultado?.origem).toBe('CLIENTE_CADASTRAL');
  });

  it('caso 4: nenhum endereço utilizável -> null (destino incompleto, exige entrada manual)', () => {
    const resultado = resolverDestinoFrete({ pedido: null, clienteEntrega: null, clienteCadastral: null });
    expect(resultado).toBeNull();
  });

  it('caso 5: enderecoEntrega existe como objeto mas está vazio -> não considera como endereço válido', () => {
    const resultado = resolverDestinoFrete({
      pedido: null,
      clienteEntrega: endereco({}), // objeto presente, todos os campos null
      clienteCadastral: endereco({ cep: '33333-333', cidade: 'Cadastral' }),
    });
    expect(resultado?.origem).toBe('CLIENTE_CADASTRAL');
  });

  it('caso 6: endereço com complemento vazio continua válido', () => {
    const resultado = resolverDestinoFrete({
      pedido: endereco({ cep: '11111-111', cidade: 'Pedido', complemento: null }),
      clienteEntrega: null,
      clienteCadastral: null,
    });
    expect(resultado?.origem).toBe('PEDIDO');
    expect(resultado?.complemento).toBeNull();
  });

  it('aceita endereço sem CEP quando logradouro + cidade estão preenchidos', () => {
    const resultado = resolverDestinoFrete({
      pedido: endereco({ cep: null, logradouro: 'Rua Sem CEP', cidade: 'Cidade X' }),
      clienteEntrega: null,
      clienteCadastral: null,
    });
    expect(resultado?.origem).toBe('PEDIDO');
  });

  it('rejeita endereço com só logradouro, sem cidade e sem CEP', () => {
    const resultado = resolverDestinoFrete({
      pedido: endereco({ logradouro: 'Rua Incompleta' }),
      clienteEntrega: null,
      clienteCadastral: null,
    });
    expect(resultado).toBeNull();
  });
});
