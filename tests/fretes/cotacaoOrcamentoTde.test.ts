import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteOmie } from '../../src/omie/cliente.js';
import { CEP_ORIGEM_ETK, OBSERVACAO_TDE, aplicarObservacaoTde } from '../../src/fretes/origemEtk.js';

// Ajuste Nova cotação: Orçamento (proposta), CEP de origem fixo no backend e observação TDE.
vi.setConfig({ testTimeout: 30000 });

const FRASE = 'Entrega com data programada, favor incluir a taxa (TDE) na cotação.';

describe('observação TDE', () => {
  it('marcado inclui exatamente a frase; desmarcado não inclui', () => {
    expect(OBSERVACAO_TDE).toBe(FRASE);
    expect(aplicarObservacaoTde(null, true)).toBe(FRASE);
    expect(aplicarObservacaoTde('Entregar pela manhã', true)).toBe(`Entregar pela manhã ${FRASE}`);
    expect(aplicarObservacaoTde('Entregar pela manhã', false)).toBe('Entregar pela manhã');
    expect(aplicarObservacaoTde(null, false)).toBeNull();
  });

  it('não duplica a frase ao recalcular/reabrir e a remove se desmarcada', () => {
    const uma = aplicarObservacaoTde('Obs livre', true);
    const duas = aplicarObservacaoTde(uma, true);
    expect(duas).toBe(uma);
    expect((duas as string).split(FRASE)).toHaveLength(2);
    expect(aplicarObservacaoTde(uma, false)).toBe('Obs livre');
  });
});

describe('tela Nova cotação', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const form = html.slice(html.indexOf('id="fretes-form-nova-cotacao"'), html.indexOf('</form>', html.indexOf('id="fretes-form-nova-cotacao"')));
  const codigo = readFileSync('public-src/fretes.ts', 'utf8');

  it('campo ORÇAMENTO (PROPOSTA) no lugar do Pedido Omie (nº); CEP origem removido; checkbox TDE presente', () => {
    expect(form).toContain('Orçamento (proposta)');
    expect(form).not.toContain('Pedido Omie (nº)');
    expect(form).not.toMatch(/CEP origem/i);
    expect(form).not.toContain('name="cepOrigem"');
    expect(form).toContain(FRASE);
    expect(form).toContain('name="entregaProgramadaTde"');
  });

  it('sem botão novo: só o "Criar cotação" existente; consulta ao sair do campo/Enter preenche o formulário direto, sem card de resumo duplicado', () => {
    expect(form).not.toContain('buscar-orcamento');
    expect((form.match(/<button/g) ?? []).length).toBe(1);
    expect(form).toContain('Criar cotação');
    expect(form).not.toContain('fretes-cotacao-orcamento-resumo');
    expect(form).not.toContain('Orçamento localizado na Omie — confira antes de criar');
    expect(form).toContain('fretes-cotacao-cliente-nome-campo');
    expect(form).toContain('fretes-cotacao-vendedor-nome-campo');
    const bloco = codigo.slice(codigo.indexOf('Orçamento (proposta) da Omie'), codigo.indexOf('formNovaCotacao.addEventListener'));
    expect(bloco).toContain("addEventListener('change'");
    expect(bloco).toMatch(/Enter[\s\S]*preventDefault/);
    expect(bloco).toContain("addEventListener('input', limparDadosOrcamento)");
    expect(bloco).not.toContain('/confirmar'); // a consulta nunca chama a rota que cria
  });

  it('o número informado consulta a rota de ORÇAMENTO, nunca a de Pedido, e o navegador não envia cepOrigem', () => {
    const bloco = codigo.slice(codigo.indexOf('Orçamento (proposta) da Omie'), codigo.indexOf('el<HTMLSelectElement>(\'fretes-filtro-status\')'));
    expect(bloco).toContain('/api/fretes/omie/orcamentos/');
    expect(bloco).not.toContain('/api/fretes/omie/pedidos/');
    expect(bloco).not.toContain('cepOrigem');
  });
});

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

const USUARIO = '11111111-1111-1111-1111-111111111111';

function omieFalso(etapaTipo: 'ORCAMENTO' | 'PEDIDO', chamadas: string[]): ClienteOmie {
  return {
    consultarPedido: async (id: { numeroPedido?: string }) => {
      chamadas.push(`consultarPedido:${id.numeroPedido}`);
      return {
        cabecalho: { codigo_pedido: 5001, numero_pedido: id.numeroPedido ?? '', etapa: '10', codigo_cliente: 321 },
        det: [{ produto: { codigo_produto: 1, codigo: 'A', descricao: 'Prod', quantidade: 1, valor_unitario: 10 } }],
        total_pedido: { valor_total_pedido: 1500 },
        informacoes_adicionais: { codVend: 42 },
        frete: { valor_frete: 0, valor_seguro: 0, outras_despesas: 0, peso_bruto: 30, quantidade_volumes: 2 },
      };
    },
    classificarPedido: async () => ({ tipo: etapaTipo, ambiguo: false, rotulo: 'Etapa teste', motivo: '' }),
    consultarCliente: async () => ({
      codigo: 321, razaoSocial: 'CLIENTE TESTE LTDA', nomeFantasia: 'Cliente Teste', email: null, cnpjCpf: '11222333000181', enderecoEntrega: null,
      enderecoCadastral: { cep: '80000-000', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cidade: 'Curitiba', uf: 'PR', codigoMunicipio: null },
    }),
  } as unknown as ClienteOmie;
}

describe('serviço (Postgres real, tabelas isoladas)', () => {
  beforeEach(() => {
    const sufixo = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    for (const n of NOMES) process.env[n] = `${n.toLowerCase()}_oc_${sufixo}`;
    process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_oc_${sufixo}`;
  });

  afterEach(async () => {
    const { obterPool } = await import('../../src/db.js');
    const pool = obterPool();
    for (const n of [...NOMES].reverse()) await pool.query(`DROP TABLE IF EXISTS ${process.env[n]}`).catch(() => undefined);
    await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
    for (const n of NOMES) delete process.env[n];
    delete process.env.COTACOES_FRETE_SEQ;
  }, 30000);

  const complementar = { modalidade: 'CIF' as const, modalidadeExecucao: 'TRANSPORTADORA' as const, veiculoId: null, motoristaNome: null, custoManual: null, valorMercadoria: null, observacoes: null };

  it('orçamento: preenche dados da Omie, origem fixa 37646352 no backend; número de Pedido é rejeitado (Pedido e Orçamento separados)', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const chamadas: string[] = [];

    const prep = await servico.servicoPrepararCotacaoDeOmie(omieFalso('ORCAMENTO', chamadas), '12345', 'ORCAMENTO');
    expect(prep).toMatchObject({ documentoOmieTipo: 'ORCAMENTO', clienteOmieId: 321, clienteNome: 'CLIENTE TESTE LTDA', vendedorOmieId: 42, valorTotalPedido: 1500 });
    expect(prep.destino?.cep).toBe('80000-000');
    expect(chamadas).toEqual(['consultarPedido:12345']);

    const cotacao = await servico.servicoCriarCotacaoDeOmie(omieFalso('ORCAMENTO', []), '12345', 'ORCAMENTO', null, { ...complementar, observacoes: aplicarObservacaoTde(null, true) }, USUARIO);
    expect(cotacao).toMatchObject({ documentoOmieTipo: 'ORCAMENTO', clienteOmieId: 321, vendedorOmieId: 42, cepDestino: '80000-000', cepOrigem: CEP_ORIGEM_ETK, peso: 30, volumes: 2, valorMercadoria: 1500 });
    expect(cotacao.observacoes).toBe(FRASE);

    const erro = await servico.servicoPrepararCotacaoDeOmie(omieFalso('PEDIDO', []), '999', 'ORCAMENTO').catch((e: unknown) => e);
    expect((erro as Error).message).toMatch(/é um Pedido.*não um Orçamento/);
  });

  it('consultar (preparar) não cria cotação; criar revalida a Omie e usa os dados da Omie, não os do navegador; falha na Omie não cria nada', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const chamadas: string[] = [];
    await servico.servicoPrepararCotacaoDeOmie(omieFalso('ORCAMENTO', chamadas), '12345', 'ORCAMENTO');
    expect(await servico.servicoListarCotacoes({})).toHaveLength(0);
    expect(chamadas).toEqual(['consultarPedido:12345']);

    const chamadasCriacao: string[] = [];
    const cotacao = await servico.servicoCriarCotacaoDeOmie(
      omieFalso('ORCAMENTO', chamadasCriacao),
      '12345',
      'ORCAMENTO',
      null,
      { ...complementar, valorMercadoria: null, peso: 999, volumes: 99 },
      USUARIO,
    );
    expect(chamadasCriacao).toEqual(['consultarPedido:12345']); // revalidou na Omie no momento da criação
    expect(cotacao).toMatchObject({ valorMercadoria: 1500, peso: 30, volumes: 2, clienteOmieId: 321 }); // Omie prevalece sobre o navegador
    expect(await servico.servicoListarCotacoes({})).toHaveLength(1);

    const omieQuebrada = { ...omieFalso('ORCAMENTO', []), consultarPedido: async () => { throw new Error('orçamento não existe mais'); } } as unknown as ClienteOmie;
    await expect(servico.servicoCriarCotacaoDeOmie(omieQuebrada, '12345', 'ORCAMENTO', null, complementar, USUARIO)).rejects.toThrow();
    expect(await servico.servicoListarCotacoes({})).toHaveLength(1);
  });

  it('CEP de origem é sempre 37646352 no backend, mesmo que o navegador envie outro (criação manual e edição)', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const cotacao = await servico.servicoCriarCotacao(
      {
        clienteOmieId: null, pedidoOmieId: null, vendedorOmieId: null, origem: null, cepOrigem: '99999-999', destino: 'Curitiba', cepDestino: '80000-000',
        peso: 10, volumes: 1, valorMercadoria: 100, modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA', veiculoId: null, motoristaNome: null, custoManual: null, observacoes: null,
      },
      USUARIO,
    );
    expect(cotacao.cepOrigem).toBe('37646352');
    const editada = await servico.servicoAtualizarCotacao(cotacao.id, { peso: 20 }, USUARIO);
    expect(editada.cepOrigem).toBe('37646352');
  });
});
