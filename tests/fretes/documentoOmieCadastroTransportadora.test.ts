import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';

// Documento Omie único (orçamento OU pedido) na Nova cotação + cadastro de transportadora a
// partir da cotação (busca ETK → Omie → conferência → "Confirmar cadastro"). Omie sempre
// simulada (somente leitura); Postgres real com tabelas isoladas; n8n nunca chamado.
vi.setConfig({ testTimeout: 60000 });

const USUARIO = '11111111-1111-1111-1111-111111111111';
const NOMES = [
  'TRANSPORTADORAS_TABELA',
  'VEICULOS_FRETE_TABELA',
  'COTACOES_FRETE_TABELA',
  'PROPOSTAS_FRETE_TABELA',
  'FECHAMENTOS_FRETE_TABELA',
  'AUDITORIA_FRETES_TABELA',
  'SOLICITACOES_COTACAO_TABELA',
  'RESPOSTAS_COTACAO_TABELA',
  'EXTRACOES_PROPOSTA_TABELA',
] as const;

beforeEach(() => {
  const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  for (const n of NOMES) process.env[n] = `${n.toLowerCase()}_doc_${sufixo}`;
  process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_doc_${sufixo}`;
  process.env.N8N_WEBHOOK_URL = ''; // fail-closed: nenhuma chamada real ao n8n neste arquivo
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  for (const n of [...NOMES].reverse()) await pool.query(`DROP TABLE IF EXISTS ${process.env[n]}`).catch(() => undefined);
  await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
  for (const n of NOMES) delete process.env[n];
  delete process.env.COTACOES_FRETE_SEQ;
  delete process.env.N8N_WEBHOOK_URL;
}, 30000);

/** Omie falsa: o tipo vem da classificação da etapa (como na real), vendedor por `ListarVendedores`. */
function omieFalsa(tipoNaOmie: 'ORCAMENTO' | 'PEDIDO', chamadas: string[], consultarPedido?: () => Promise<never>): ClienteOmie {
  return {
    consultarPedido:
      consultarPedido ??
      (async (id: { numeroPedido?: string }) => {
        chamadas.push(`consultarPedido:${id.numeroPedido}`);
        return {
          cabecalho: { codigo_pedido: 7001, numero_pedido: id.numeroPedido ?? '', etapa: '10', codigo_cliente: 321 },
          det: [],
          total_pedido: { valor_total_pedido: 2500 },
          informacoes_adicionais: { codVend: 42 },
          frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0, peso_bruto: 40, quantidade_volumes: 3, modalidade: '0' },
        };
      }),
    classificarPedido: async () => ({ tipo: tipoNaOmie, ambiguo: false, rotulo: tipoNaOmie === 'ORCAMENTO' ? 'Orçamento' : 'Faturar', motivo: '' }),
    consultarCliente: async () => ({
      codigo: 321, razaoSocial: 'CLIENTE DOC LTDA', nomeFantasia: null, email: null, cnpjCpf: '11222333000181', enderecoEntrega: null,
      enderecoCadastral: { cep: '80000-000', logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro', cidade: 'Curitiba', uf: 'PR', codigoMunicipio: null },
    }),
    listarVendedores: async () => [{ codigo: 42, nome: 'MARIA VENDEDORA' }],
  } as unknown as ClienteOmie;
}

const complementar = {
  modalidade: 'CIF' as const, modalidadeExecucao: 'TRANSPORTADORA' as const, veiculoId: null, motoristaNome: null,
  custoManual: null, valorMercadoria: null, observacoes: null,
};

describe('documento Omie único (serviço)', () => {
  it('localiza ORÇAMENTO e PEDIDO pelo número (tipo dito pela Omie), vendedor por nome; criar reconsulta e grava a origem correta', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');

    const chamadas: string[] = [];
    const orcamento = await servico.servicoPrepararCotacaoDeOmie(omieFalsa('ORCAMENTO', chamadas), '555', null);
    expect(orcamento).toMatchObject({ documentoOmieTipo: 'ORCAMENTO', pedidoOmieNumero: '555', vendedorOmieId: 42, vendedorNome: 'MARIA VENDEDORA' });
    const pedido = await servico.servicoPrepararCotacaoDeOmie(omieFalsa('PEDIDO', chamadas), '777', null);
    expect(pedido).toMatchObject({ documentoOmieTipo: 'PEDIDO', pedidoOmieNumero: '777', vendedorNome: 'MARIA VENDEDORA' });
    expect(await servico.servicoListarCotacoes({})).toHaveLength(0); // consultar nunca cria

    const chamadasCriacao: string[] = [];
    const cotOrc = await servico.servicoCriarCotacaoDeOmie(omieFalsa('ORCAMENTO', chamadasCriacao), '555', 'ORCAMENTO', null, complementar, USUARIO);
    const cotPed = await servico.servicoCriarCotacaoDeOmie(omieFalsa('PEDIDO', chamadasCriacao), '777', 'PEDIDO', null, complementar, USUARIO);
    expect(chamadasCriacao).toEqual(['consultarPedido:555', 'consultarPedido:777']); // reconsulta no backend ao criar
    expect(cotOrc).toMatchObject({ documentoOmieTipo: 'ORCAMENTO', pedidoOmieNumero: '555', vendedorOmieId: 42 });
    expect(cotPed).toMatchObject({ documentoOmieTipo: 'PEDIDO', pedidoOmieNumero: '777', vendedorOmieId: 42 });

    // tipo mudou entre a conferência e a criação → rejeita, nada criado
    await expect(servico.servicoCriarCotacaoDeOmie(omieFalsa('PEDIDO', []), '555', 'ORCAMENTO', null, complementar, USUARIO)).rejects.toThrow(
      /é um Pedido.*não um Orçamento/,
    );
    expect(await servico.servicoListarCotacoes({})).toHaveLength(2);
  });

  it('documento inexistente: "Documento Omie não localizado." e nada é criado; falha transitória da Omie não é mascarada', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    // mesma instância de módulo do serviço (vi.resetModules), senão `instanceof` falharia
    const { OmieError, OmieErroTransitorio } = await import('../../src/omie/erros.js');
    const naoExiste = omieFalsa('ORCAMENTO', [], async () => {
      throw new OmieError('ERROR: Pedido não cadastrado para o Número de Pedido [999]', 'SOAP-ENV:Client-103');
    });
    await expect(servico.servicoPrepararCotacaoDeOmie(naoExiste, '999', null)).rejects.toThrow('Documento Omie não localizado.');
    const foraDoAr = omieFalsa('ORCAMENTO', [], async () => {
      throw new OmieErroTransitorio('timeout');
    });
    await expect(servico.servicoPrepararCotacaoDeOmie(foraDoAr, '999', null)).rejects.toBeInstanceOf(OmieErroTransitorio);
    expect(await servico.servicoListarCotacoes({})).toHaveLength(0);
  });
});

describe('cadastro de transportadora a partir da cotação (serviço)', () => {
  const dadosOmie = {
    nomeRazaoSocial: 'TRANSPORTES NOVA LTDA',
    nomeFantasia: 'NOVA LOG',
    cnpj: '98765432000198',
    email: 'cotacao@novalog.com.br',
    telefone: '(11) 3333-4444',
    contato: 'Ana',
    observacoes: null,
    codigoClienteOmie: 8801,
    canalPrincipal: 'EMAIL' as const,
    urlPortal: 'https://portal.novalog.com.br',
    whatsappCotacao: '11988887777',
  };

  it('confirmar cadastro grava os dados conferidos (e-mail, WhatsApp, portal); mesmo CNPJ não duplica; portal não vira API', async () => {
    vi.resetModules();
    const envio = await import('../../src/fretes/envioSolicitacoesServico.js');
    const repo = await import('../../src/fretes/transportadorasRepositorio.js');

    const primeira = await envio.servicoConfirmarCadastroTransportadora(dadosOmie, USUARIO);
    expect(primeira.existente).toBe(false);
    expect(primeira.transportadora).toMatchObject({
      canaisDisponiveis: ['EMAIL'], // e-mail para cotação cadastrado; WhatsApp ainda não habilitado; portal ≠ API
      canalSugerido: 'EMAIL',
      urlPortal: 'https://portal.novalog.com.br',
      whatsappCadastrado: true,
      apiIntegrada: false,
    });
    const gravada = await repo.buscarTransportadoraPorId(primeira.transportadora.id);
    expect(gravada).toMatchObject({ email: 'cotacao@novalog.com.br', whatsappCotacao: '11988887777', urlPortal: 'https://portal.novalog.com.br', telefone: '(11) 3333-4444' });

    // mesmo CNPJ (com máscara, dados diferentes) → usa o existente, não cria nem altera
    const segunda = await envio.servicoConfirmarCadastroTransportadora({ ...dadosOmie, cnpj: '98.765.432/0001-98', email: 'outro@x.com' }, USUARIO);
    expect(segunda).toMatchObject({ existente: true, ativa: true });
    expect(segunda.transportadora.id).toBe(primeira.transportadora.id);
    expect(await repo.listarTransportadoras(false)).toHaveLength(1);
    expect((await repo.buscarTransportadoraPorId(primeira.transportadora.id))?.email).toBe('cotacao@novalog.com.br');

    // não obriga canais: só identificação também cadastra (fica sem canal de cotação)
    const semCanal = await envio.servicoConfirmarCadastroTransportadora(
      { ...dadosOmie, cnpj: '12312312000112', email: null, whatsappCotacao: null, urlPortal: null, codigoClienteOmie: null, canalPrincipal: null },
      USUARIO,
    );
    expect(semCanal.transportadora.canaisDisponiveis).toEqual([]);

    // API continua só Braspress
    const braspress = await envio.servicoConfirmarCadastroTransportadora(
      { ...dadosOmie, nomeRazaoSocial: 'BRASPRESS TRANSPORTES URGENTES', nomeFantasia: 'BRASPRESS', cnpj: '55666777000155', email: null, codigoClienteOmie: null, canalPrincipal: 'API', urlPortal: null },
      USUARIO,
    );
    expect(braspress.transportadora).toMatchObject({ canaisDisponiveis: ['API'], canalSugerido: 'API', apiIntegrada: true });

    await expect(envio.servicoConfirmarCadastroTransportadora({ ...dadosOmie, cnpj: null }, USUARIO)).rejects.toThrow(/CNPJ/);
  });

  it('e-mail de destino: MANUAL > CADASTRO > OMIE (origem CADASTRO registrada na solicitação)', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const integracao = await import('../../src/fretes/integracaoCotacoesServico.js');
    const consultarCliente = vi.fn(async () => ({ email: 'omie@novalog.com.br' }));
    const omie = { consultarCliente } as unknown as ClienteOmie;
    const t = await servico.servicoCriarTransportadora(dadosOmie, USUARIO);
    const cotacao = await servico.servicoCriarCotacao(
      {
        clienteOmieId: null, pedidoOmieId: null, vendedorOmieId: null, origem: 'SP', cepOrigem: null, destino: 'RJ', cepDestino: null,
        peso: 10, volumes: 1, valorMercadoria: 100, modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA',
        veiculoId: null, motoristaNome: null, custoManual: null, observacoes: null,
      },
      USUARIO,
    );
    const [doCadastro] = await integracao.servicoSolicitarCotacoes(omie, cotacao.id, [{ transportadoraId: t.id }], 'EMAIL', USUARIO);
    expect(doCadastro).toMatchObject({ emailDestino: 'cotacao@novalog.com.br', emailOrigem: 'CADASTRO' });
    expect(consultarCliente).not.toHaveBeenCalled(); // cadastro vence a Omie
    const [manual] = await integracao.servicoSolicitarCotacoes(omie, cotacao.id, [{ transportadoraId: t.id, emailManual: 'manual@x.com.br' }], 'EMAIL', USUARIO);
    expect(manual).toMatchObject({ emailDestino: 'manual@x.com.br', emailOrigem: 'MANUAL' });
  });
});

describe('tela: busca ETK → Omie → conferência → confirmar cadastro', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const codigo = readFileSync('public-src/fretes.ts', 'utf8');

  it('oferece "Buscar na Omie?" só quando não acha no ETK; conferência editável antes de gravar; retorna já selecionada', () => {
    expect(html).toContain('Transportadora não cadastrada.');
    expect(html).toContain('Buscar na Omie?');
    expect(codigo).toContain('ofertaBuscaOmie.hidden = dados.transportadoras.length > 0');
    expect(codigo).toContain("'/api/fretes/transportadoras/buscar-omie'");
    expect(html).toContain('Conferir transportadora antes de cadastrar');
    for (const rotulo of ['E-mail para cotação', 'WhatsApp para cotação', 'URL do portal / site', 'Canal principal', 'Confirmar cadastro']) {
      expect(html).toContain(rotulo);
    }
    expect(codigo).toContain("'/api/fretes/transportadoras/confirmar-cadastro'");
    expect(codigo).toContain('selecionarTransportadora(transportadora);');
    expect(codigo).toContain("preencher('fretes-conferir-whatsapp', null);"); // telefone nunca vira WhatsApp
    expect(codigo).toContain('API INTEGRADA: NÃO');
    expect(codigo).toContain('Portal cadastrado — integração API não disponível');
    expect(codigo).toContain('Transportadora cadastrada, mas sem canal de cotação disponível.');
  });
});
