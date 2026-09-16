import { executarDdlIdempotente } from '../db.js';

/**
 * Nomes de tabela — só sobrescritos nos testes (uma var de ambiente por tabela, mesmo
 * padrão de `USUARIOS_TABELA`/`SESSOES_TABELA`), pra rodar contra tabelas isoladas e
 * descartáveis no MESMO banco Supabase (não há um segundo projeto só pra teste). Nunca
 * vêm de entrada do usuário, mas validados porque entram por interpolação direta no
 * SQL — `pg` não parametriza nome de tabela.
 */
function nomeValidado(nome: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Nome de tabela/sequência inválido: "${nome}"`);
  return nome;
}

export function nomeTabelaTransportadoras(): string {
  return nomeValidado(process.env.TRANSPORTADORAS_TABELA ?? 'transportadoras');
}
export function nomeTabelaVeiculos(): string {
  return nomeValidado(process.env.VEICULOS_FRETE_TABELA ?? 'veiculos_frete');
}
export function nomeTabelaCotacoes(): string {
  return nomeValidado(process.env.COTACOES_FRETE_TABELA ?? 'cotacoes_frete');
}
export function nomeTabelaPropostas(): string {
  return nomeValidado(process.env.PROPOSTAS_FRETE_TABELA ?? 'propostas_frete');
}
export function nomeTabelaFechamentos(): string {
  return nomeValidado(process.env.FECHAMENTOS_FRETE_TABELA ?? 'fechamentos_frete');
}
export function nomeTabelaAuditoria(): string {
  return nomeValidado(process.env.AUDITORIA_FRETES_TABELA ?? 'auditoria_fretes');
}
export function nomeSequenciaCodigoCotacao(): string {
  return nomeValidado(process.env.COTACOES_FRETE_SEQ ?? 'cotacoes_frete_codigo_seq');
}

/**
 * Cria (se ainda não existirem) todas as tabelas novas do módulo de Fretes — nunca toca
 * nas 4 tabelas protegidas do sistema existente (`usuarios`, `sessoes`, `omie_cache`,
 * `omie_limitador`). Idempotente e cacheada por processo, mesmo padrão de
 * `usuariosRepositorio.ts`/`sessoes.ts`. Ordem de criação respeita as FKs
 * (transportadoras → cotações → propostas/fechamentos).
 */
let esquemaGarantido: Promise<void> | null = null;
export function garantirEsquemaFretes(): Promise<void> {
  esquemaGarantido ??= (async () => {
    const transportadoras = nomeTabelaTransportadoras();
    const veiculos = nomeTabelaVeiculos();
    const cotacoes = nomeTabelaCotacoes();
    const propostas = nomeTabelaPropostas();
    const fechamentos = nomeTabelaFechamentos();
    const auditoria = nomeTabelaAuditoria();

    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${transportadoras} (
        id UUID PRIMARY KEY,
        nome_razao_social TEXT NOT NULL,
        nome_fantasia TEXT,
        cnpj TEXT,
        email TEXT,
        telefone TEXT,
        contato TEXT,
        ativo BOOLEAN NOT NULL DEFAULT true,
        observacoes TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Veículos próprios (Fase 2, seção 4) — só `descricao` é obrigatória; placa/tipo/
    // capacidade são opcionais para não travar o cadastro por falta de dado secundário.
    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${veiculos} (
        id UUID PRIMARY KEY,
        descricao TEXT NOT NULL,
        placa TEXT,
        tipo TEXT,
        marca TEXT,
        modelo TEXT,
        ano INTEGER,
        capacidade_kg NUMERIC,
        capacidade_m3 NUMERIC,
        ativo BOOLEAN NOT NULL DEFAULT true,
        observacoes TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Sequência global (não reinicia por ano) — só precisa garantir unicidade do código
    // visível (seção 5), nunca precisa "resetar" pra continuar sendo um identificador válido.
    await executarDdlIdempotente(`CREATE SEQUENCE IF NOT EXISTS ${nomeSequenciaCodigoCotacao()}`);

    // `modalidade` (CIF/FOB, Fase 1) e `modalidade_execucao` (TRANSPORTADORA/VEICULO_PROPRIO/
    // RETIRA, Fase 2) são colunas DIFERENTES e independentes — ver comentário em `tipos.ts`.
    // `veiculo_id`/`motorista_nome`/`custo_manual` só usados quando `modalidade_execucao =
    // 'VEICULO_PROPRIO'`. `DEFAULT 'TRANSPORTADORA'` preserva o comportamento da Fase 1 em
    // linhas antigas sem precisar de uma migração de dados.
    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${cotacoes} (
        id UUID PRIMARY KEY,
        codigo TEXT NOT NULL UNIQUE,
        cliente_omie_id BIGINT,
        pedido_omie_id BIGINT,
        vendedor_omie_id BIGINT,
        origem TEXT,
        cep_origem TEXT,
        destino TEXT,
        cep_destino TEXT,
        peso NUMERIC,
        volumes INTEGER,
        valor_mercadoria NUMERIC,
        modalidade TEXT NOT NULL CHECK (modalidade IN ('CIF','FOB')),
        modalidade_execucao TEXT NOT NULL DEFAULT 'TRANSPORTADORA' CHECK (modalidade_execucao IN ('TRANSPORTADORA','VEICULO_PROPRIO','RETIRA')),
        veiculo_id UUID REFERENCES ${veiculos}(id),
        motorista_nome TEXT,
        custo_manual NUMERIC,
        status TEXT NOT NULL CHECK (status IN ('RASCUNHO','AGUARDANDO_PROPOSTAS','EM_ANALISE','AGUARDANDO_APROVACAO','FECHADA','CANCELADA')),
        observacoes TEXT,
        criado_por UUID NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        fechado_em TIMESTAMPTZ
      )
    `);
    // Defensivo: cobre uma tabela `cotacoes_frete` já criada por uma versão anterior (Fase 1)
    // do código, sem essas colunas ainda — nunca dá erro se elas já existirem. O CHECK inline
    // só é aplicado quando a coluna é criada agora (ADD COLUMN IF NOT EXISTS não retroage sobre
    // uma coluna já existente) — cobre o caso realista de primeira criação da tabela nesta fase.
    await executarDdlIdempotente(
      `ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS modalidade_execucao TEXT NOT NULL DEFAULT 'TRANSPORTADORA' CHECK (modalidade_execucao IN ('TRANSPORTADORA','VEICULO_PROPRIO','RETIRA'))`,
    );
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS veiculo_id UUID REFERENCES ${veiculos}(id)`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS motorista_nome TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS custo_manual NUMERIC`);

    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${propostas} (
        id UUID PRIMARY KEY,
        cotacao_id UUID NOT NULL REFERENCES ${cotacoes}(id),
        transportadora_id UUID NOT NULL REFERENCES ${transportadoras}(id),
        valor_custo NUMERIC NOT NULL CHECK (valor_custo >= 0),
        prazo_dias INTEGER,
        validade DATE,
        peso NUMERIC,
        volumes INTEGER,
        origem TEXT,
        destino TEXT,
        tipo_servico TEXT,
        observacoes TEXT,
        origem_proposta TEXT NOT NULL DEFAULT 'MANUAL',
        mensagem_original TEXT,
        anexo_url TEXT,
        status TEXT NOT NULL CHECK (status IN ('RECEBIDA','EM_ANALISE','SELECIONADA','REJEITADA')),
        confianca NUMERIC,
        requer_revisao BOOLEAN NOT NULL DEFAULT false,
        selecionada BOOLEAN NOT NULL DEFAULT false,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // UNIQUE (cotacao_id): trava em nível de banco que uma cotação nunca tenha mais de um
    // fechamento — segunda camada de proteção contra dupla execução, além da trava
    // transacional em `fretesServico.ts` (seção 35/36: concorrência/idempotência).
    // `proposta_id`/`transportadora_id` viraram NULLABLE na Fase 2: só preenchidos quando
    // `modalidade_execucao = 'TRANSPORTADORA'` (ver `FechamentoFrete` em `tipos.ts`).
    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${fechamentos} (
        id UUID PRIMARY KEY,
        cotacao_id UUID NOT NULL UNIQUE REFERENCES ${cotacoes}(id),
        modalidade_execucao TEXT NOT NULL DEFAULT 'TRANSPORTADORA' CHECK (modalidade_execucao IN ('TRANSPORTADORA','VEICULO_PROPRIO','RETIRA')),
        proposta_id UUID REFERENCES ${propostas}(id),
        transportadora_id UUID REFERENCES ${transportadoras}(id),
        veiculo_id UUID REFERENCES ${veiculos}(id),
        motorista_nome TEXT,
        custo_frete NUMERIC NOT NULL,
        percentual_acrescimo NUMERIC NOT NULL,
        valor_acrescimo NUMERIC NOT NULL,
        valor_frete_cliente NUMERIC NOT NULL,
        modo_calculo TEXT NOT NULL CHECK (modo_calculo IN ('PERCENTUAL','VALOR_FINAL')),
        usuario_fechamento UUID NOT NULL,
        observacoes TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Defensivo, mesmo motivo do bloco de `cotacoes` acima (tabela pode já existir da Fase 1).
    await executarDdlIdempotente(
      `ALTER TABLE ${fechamentos} ADD COLUMN IF NOT EXISTS modalidade_execucao TEXT NOT NULL DEFAULT 'TRANSPORTADORA' CHECK (modalidade_execucao IN ('TRANSPORTADORA','VEICULO_PROPRIO','RETIRA'))`,
    );
    await executarDdlIdempotente(`ALTER TABLE ${fechamentos} ADD COLUMN IF NOT EXISTS veiculo_id UUID REFERENCES ${veiculos}(id)`);
    await executarDdlIdempotente(`ALTER TABLE ${fechamentos} ADD COLUMN IF NOT EXISTS motorista_nome TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${fechamentos} ALTER COLUMN proposta_id DROP NOT NULL`);
    await executarDdlIdempotente(`ALTER TABLE ${fechamentos} ALTER COLUMN transportadora_id DROP NOT NULL`);

    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${auditoria} (
        id UUID PRIMARY KEY,
        usuario_id UUID NOT NULL,
        acao TEXT NOT NULL,
        entidade TEXT NOT NULL,
        entidade_id UUID,
        valor_anterior JSONB,
        valor_novo JSONB,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        origem TEXT NOT NULL DEFAULT 'sistema'
      )
    `);
  })();
  return esquemaGarantido;
}

/** Só para os testes: força uma nova checagem de schema após um `DROP TABLE` de limpeza. */
export function resetarEsquemaGarantidoParaTestes(): void {
  esquemaGarantido = null;
}
