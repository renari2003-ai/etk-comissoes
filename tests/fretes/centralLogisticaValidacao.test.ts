import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSOES_VAZIAS, type Permissoes, type UsuarioPublico } from '../../src/auth/tipos.js';

// Regressão: proposta automática ainda PENDENTE_VALIDACAO aparecia na Central da Logística
// (status_revisao nasce AGUARDANDO_LOGISTICA) e podia ser liberada antes da validação humana —
// ao confirmar depois, ela já estava LIBERADA e "sumia" da Logística.
vi.setConfig({ testTimeout: 60000 });

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
  for (const n of NOMES) process.env[n] = `${n.toLowerCase()}_cl_${sufixo}`;
  process.env.COTACOES_FRETE_SEQ = `cotacoes_frete_seq_cl_${sufixo}`;
});

afterEach(async () => {
  const { obterPool } = await import('../../src/db.js');
  const pool = obterPool();
  for (const n of [...NOMES].reverse()) await pool.query(`DROP TABLE IF EXISTS ${process.env[n]}`).catch(() => undefined);
  await pool.query(`DROP SEQUENCE IF EXISTS ${process.env.COTACOES_FRETE_SEQ}`).catch(() => undefined);
  for (const n of NOMES) delete process.env[n];
  delete process.env.COTACOES_FRETE_SEQ;
}, 30000);

function usuarioFake(permissoes: Partial<Permissoes>, papel: 'administrador' | 'convidado' = 'convidado'): UsuarioPublico {
  return {
    id: randomUUID(),
    usuario: 'teste',
    nome: 'Usuário de teste',
    papel,
    permissoes: { ...PERMISSOES_VAZIAS, ...permissoes },
    senhaProvisoria: false,
    mestre: false,
    vendedorOmieId: null,
  };
}

describe('Propostas recebidas → Central da Logística → Central do Vendedor', () => {
  it('pendente de validação fica fora das Centrais e não pode ser triada; após confirmar aparece na Logística; liberada vai ao Vendedor', async () => {
    vi.resetModules();
    const servico = await import('../../src/fretes/fretesServico.js');
    const integracao = await import('../../src/fretes/integracaoCotacoesServico.js');
    const propostasRepo = await import('../../src/fretes/propostasRepositorio.js');
    const solicitacoesRepo = await import('../../src/fretes/solicitacoesRepositorio.js');
    const logistica = usuarioFake({ fretesLogistica: true });
    const admin = usuarioFake({}, 'administrador');

    const transportadora = await servico.servicoCriarTransportadora(
      { nomeRazaoSocial: 'Transp Central', nomeFantasia: null, cnpj: null, email: null, telefone: null, contato: null, observacoes: null },
      logistica.id,
    );
    const cotacao = await servico.servicoCriarCotacao(
      {
        clienteOmieId: null, pedidoOmieId: null, vendedorOmieId: null, origem: 'SP', cepOrigem: null, destino: 'RJ', cepDestino: null,
        peso: 10, volumes: 1, valorMercadoria: 100, modalidade: 'CIF', modalidadeExecucao: 'TRANSPORTADORA',
        veiculoId: null, motoristaNome: null, custoManual: null, observacoes: null,
      },
      logistica.id,
    );
    const solicitacao = await solicitacoesRepo.criarSolicitacao({
      cotacaoFreteId: cotacao.id,
      transportadoraId: transportadora.id,
      canal: 'EMAIL',
      codigoReferencia: `${cotacao.codigo}-teste`,
      criadoPor: logistica.id,
      emailDestino: null,
      emailOrigem: null,
    });
    const pendente = await propostasRepo.criarPropostaAutomatica({
      cotacaoId: cotacao.id, transportadoraId: transportadora.id, solicitacaoId: solicitacao.id, valorCusto: 250, prazoDias: 3,
      validade: null, observacoes: null, canal: 'EMAIL', mensagemOriginal: 'Frete R$ 250', confianca: 0.9, requerRevisao: false,
    });
    expect(pendente).toMatchObject({ status: 'PENDENTE_VALIDACAO', statusRevisao: 'AGUARDANDO_LOGISTICA' });

    // antes da validação humana: fora das Centrais e sem triagem possível
    expect(await servico.servicoListarCentralLogistica()).toHaveLength(0);
    expect(await servico.servicoListarCentralVendedor(admin)).toHaveLength(0);
    await expect(servico.servicoLiberarPropostaLogistica(pendente.id, logistica)).rejects.toThrow(/pendente de validação/);
    await expect(servico.servicoDescartarPropostaLogistica(pendente.id, logistica)).rejects.toThrow(/pendente de validação/);
    expect((await propostasRepo.buscarPropostaPorId(pendente.id))?.statusRevisao).toBe('AGUARDANDO_LOGISTICA');

    // "Confirmar" em Propostas recebidas → aparece na Central da Logística aguardando triagem
    await integracao.servicoValidarProposta(pendente.id, {}, logistica.id);
    const naLogistica = await servico.servicoListarCentralLogistica();
    expect(naLogistica.map((l) => [l.proposta.id, l.proposta.status, l.proposta.statusRevisao])).toEqual([[pendente.id, 'RECEBIDA', 'AGUARDANDO_LOGISTICA']]);

    // logística libera → Central do Vendedor
    await servico.servicoLiberarPropostaLogistica(pendente.id, logistica);
    const noVendedor = await servico.servicoListarCentralVendedor(admin);
    expect(noVendedor.map((l) => [l.proposta.id, l.proposta.statusRevisao])).toEqual([[pendente.id, 'LIBERADA']]);
  });
});
