import { executarDdlIdempotente } from '../db.js';

/**
 * Correção cirúrgica (homologação 2026-09-16, Fase 4A.3): três FKs do domínio de Fretes
 * foram criadas, na primeira execução real de `garantirEsquemaFretes()`, apontando para
 * tabelas de TESTE (`*_teste_1789577687814_airk3qshvlj`) em vez das tabelas reais —
 * evidência direta via `pg_constraint`: `solicitacoes_cotacao_frete.cotacao_frete_id`,
 * `solicitacoes_cotacao_frete.transportadora_id` e
 * `extracoes_proposta_frete.proposta_id` apontavam para tabelas de teste com o MESMO
 * sufixo de timestamp, confirmando uma única execução corrompida (variáveis `*_TABELA` de
 * teste ativas no processo no exato instante em que essas 2 tabelas foram criadas pela
 * primeira vez em produção). Nunca reproduzido nos testes porque lá TODAS as variáveis
 * `*_TABELA` são sempre sobrescritas juntas em `beforeEach`; a causa mais provável é
 * vazamento de `process.env` entre arquivos de teste rodando na mesma worker thread do
 * Vitest (pool "threads" compartilha o processo, e portanto `process.env`, entre arquivos
 * concorrentes) coincidindo com uma chamada real ao servidor no mesmo processo.
 *
 * `CREATE TABLE IF NOT EXISTS` nunca corrige uma FK já existente — por isso essa correção
 * é necessária e roda a cada start (idempotente: no-op quando a FK já está correta).
 * Localiza a constraint pela COLUNA (não pelo nome, mais robusto), e só a substitui se o
 * alvo atual divergir da tabela real resolvida neste processo. `ADD CONSTRAINT` revalida
 * as linhas existentes contra a tabela nova — se existisse alguma linha órfã, a migração
 * falharia alto e claro em vez de mascarar o problema; nenhuma linha é apagada ou alterada.
 */
async function repararFkSeApontarParaTabelaErrada(tabelaOrigem: string, colunaOrigem: string, tabelaCorreta: string): Promise<void> {
  await executarDdlIdempotente(`
    DO $$
    DECLARE
      nome_constraint text;
      tabela_atual text;
    BEGIN
      SELECT con.conname, rel_ref.relname INTO nome_constraint, tabela_atual
      FROM pg_constraint con
      JOIN pg_class rel_src ON rel_src.oid = con.conrelid
      JOIN pg_class rel_ref ON rel_ref.oid = con.confrelid
      JOIN pg_attribute att ON att.attrelid = rel_src.oid AND att.attnum = con.conkey[1]
      WHERE rel_src.relname = '${tabelaOrigem}' AND con.contype = 'f'
        AND array_length(con.conkey, 1) = 1 AND att.attname = '${colunaOrigem}';

      IF nome_constraint IS NOT NULL AND tabela_atual IS DISTINCT FROM '${tabelaCorreta}' THEN
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', '${tabelaOrigem}', nome_constraint);
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (${colunaOrigem}) REFERENCES %I (id)',
          '${tabelaOrigem}', nome_constraint, '${tabelaCorreta}');
      END IF;
    END $$;
  `);
}

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
// Fase 4A.1 — automação de cotações com transportadoras (seção 12/14/15).
export function nomeTabelaSolicitacoes(): string {
  return nomeValidado(process.env.SOLICITACOES_COTACAO_TABELA ?? 'solicitacoes_cotacao_frete');
}
export function nomeTabelaRespostas(): string {
  return nomeValidado(process.env.RESPOSTAS_COTACAO_TABELA ?? 'respostas_cotacao_frete');
}
export function nomeTabelaExtracoes(): string {
  return nomeValidado(process.env.EXTRACOES_PROPOSTA_TABELA ?? 'extracoes_proposta_frete');
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

    // Fase 3.2 (2026-09-16) — importação Omie → Fretes: colunas 100% aditivas/nullable, só
    // preenchidas no fluxo de importação (ver `omieFretes.ts`/`resolucaoDestino.ts`). Nunca
    // usadas em cotações criadas manualmente (fluxo da Fase 1, inalterado). `origem_destino`
    // documenta de qual das 3 fontes Omie (ou `MANUAL`) veio o destino estruturado abaixo —
    // `destino`/`cep_destino` (texto livre, já existentes) continuam preenchidos também aqui,
    // como resumo compatível com a exibição já existente.
    await executarDdlIdempotente(
      `ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS origem_destino TEXT CHECK (origem_destino IN ('PEDIDO','CLIENTE_ENTREGA','CLIENTE_CADASTRAL','MANUAL'))`,
    );
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS logradouro_destino TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS numero_destino TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS complemento_destino TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS bairro_destino TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS cidade_destino TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS uf_destino TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS codigo_municipio_destino TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS peso_bruto NUMERIC`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS peso_liquido NUMERIC`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS especie_volumes TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS cif_fob_omie TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS transportadora_omie_codigo BIGINT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS pedido_omie_numero TEXT`);
    await executarDdlIdempotente(`ALTER TABLE ${cotacoes} ADD COLUMN IF NOT EXISTS cliente_nome_snapshot TEXT`);

    // Seção 34: usado para localizar rapidamente se um pedido Omie já tem cotação (seção 25 —
    // só aviso, nunca bloqueio). Parcial (`WHERE ... IS NOT NULL`) porque a maioria das
    // cotações manuais da Fase 1 não tem `pedido_omie_id` preenchido.
    await executarDdlIdempotente(
      `CREATE INDEX IF NOT EXISTS idx_${cotacoes}_pedido_omie_id ON ${cotacoes} (pedido_omie_id) WHERE pedido_omie_id IS NOT NULL`,
    );

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
    // Fase 4A.1 (seção 34) — eventos de origem máquina (webhook n8n) não têm usuário humano
    // associado. Mesmo padrão já usado em `fechamentos.proposta_id`/`transportadora_id`
    // (DROP NOT NULL aditivo, nunca invalida linha existente).
    await executarDdlIdempotente(`ALTER TABLE ${auditoria} ALTER COLUMN usuario_id DROP NOT NULL`);

    // ========================================================================================
    // Fase 4A.1 — automação de cotações com transportadoras (e-mail/WhatsApp/n8n/IA).
    // IA e automação NUNCA escolhem transportadora, definem acréscimo ou fecham cotação —
    // só coletam/estruturam dados; a decisão comercial final permanece humana (ver relatório
    // da fase). Tabelas 100% novas e isoladas do domínio Fretes; nenhuma tabela protegida
    // (usuarios/sessoes/omie_cache/omie_limitador) nem as 6 tabelas de Fretes já existentes
    // acima perdem coluna, constraint restritiva ou dado.
    // ========================================================================================
    const solicitacoes = nomeTabelaSolicitacoes();
    const respostas = nomeTabelaRespostas();
    const extracoes = nomeTabelaExtracoes();

    // codigo_referencia (seção 24) é o identificador seguro incluído na comunicação enviada
    // à transportadora — é ele, nunca nome/assunto/texto aproximado, que reconcilia a
    // resposta recebida de volta com esta solicitação (seção 23). UNIQUE garante que o
    // webhook sempre encontre no máximo uma solicitação por referência.
    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${solicitacoes} (
        id UUID PRIMARY KEY,
        cotacao_frete_id UUID NOT NULL REFERENCES ${cotacoes}(id),
        transportadora_id UUID NOT NULL REFERENCES ${transportadoras}(id),
        canal TEXT NOT NULL CHECK (canal IN ('EMAIL','WHATSAPP','MANUAL','API','OUTRO')),
        status TEXT NOT NULL DEFAULT 'PENDENTE_ENVIO' CHECK (status IN ('PENDENTE_ENVIO','ENVIADA','ENTREGUE','RESPONDIDA','ERRO','CANCELADA')),
        codigo_referencia TEXT NOT NULL UNIQUE,
        data_envio TIMESTAMPTZ,
        data_resposta TIMESTAMPTZ,
        identificador_externo TEXT,
        tentativas INTEGER NOT NULL DEFAULT 0,
        erro_ultima_tentativa TEXT,
        criado_por UUID NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await executarDdlIdempotente(`CREATE INDEX IF NOT EXISTS idx_${solicitacoes}_cotacao ON ${solicitacoes} (cotacao_frete_id)`);
    await executarDdlIdempotente(`CREATE INDEX IF NOT EXISTS idx_${solicitacoes}_transportadora ON ${solicitacoes} (transportadora_id)`);
    await executarDdlIdempotente(`CREATE INDEX IF NOT EXISTS idx_${solicitacoes}_status ON ${solicitacoes} (status)`);

    // Ver comentário completo de `repararFkSeApontarParaTabelaErrada` no topo do arquivo.
    // As 2 FKs de `${solicitacoes}` foram as primeiras encontradas com o problema.
    await repararFkSeApontarParaTabelaErrada(solicitacoes, 'cotacao_frete_id', cotacoes);
    await repararFkSeApontarParaTabelaErrada(solicitacoes, 'transportadora_id', transportadoras);

    // Material bruto — NUNCA alterado depois de criado (seção 18); correções humanas
    // alteram só a proposta estruturada. UNIQUE (canal, identificador_mensagem) é a
    // idempotência em nível de banco (seção 19): a mesma mensagem chegando duas vezes
    // nunca gera duas linhas aqui (a segunda tentativa de INSERT é ignorada pelo
    // repositório via ON CONFLICT, nunca vira um erro pro chamador do webhook).
    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${respostas} (
        id UUID PRIMARY KEY,
        solicitacao_id UUID NOT NULL REFERENCES ${solicitacoes}(id),
        canal TEXT NOT NULL CHECK (canal IN ('EMAIL','WHATSAPP','MANUAL','API','OUTRO')),
        identificador_mensagem TEXT NOT NULL,
        conteudo_bruto TEXT,
        data_recebimento TIMESTAMPTZ NOT NULL DEFAULT now(),
        status_processamento TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status_processamento IN ('PENDENTE','PROCESSADA','ERRO')),
        erro_processamento TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (canal, identificador_mensagem)
      )
    `);
    await executarDdlIdempotente(`CREATE INDEX IF NOT EXISTS idx_${respostas}_solicitacao ON ${respostas} (solicitacao_id)`);

    // A extração NÃO é a proposta definitiva (seção 15). `proposta_id` só é preenchido
    // quando houver `valorFrete` utilizável (seção 40: nunca inferir valor) — permanece
    // NULL nos casos ERRO/REQUER_REVISAO sem valor, que ficam só nesta tabela + na
    // resposta bruta associada, aguardando ação manual (seção 41).
    await executarDdlIdempotente(`
      CREATE TABLE IF NOT EXISTS ${extracoes} (
        id UUID PRIMARY KEY,
        resposta_id UUID NOT NULL REFERENCES ${respostas}(id),
        versao_extrator TEXT NOT NULL,
        dados_extraidos JSONB NOT NULL,
        confianca NUMERIC,
        status TEXT NOT NULL CHECK (status IN ('EXTRAIDA','REQUER_REVISAO','ERRO')),
        proposta_id UUID REFERENCES ${propostas}(id),
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await executarDdlIdempotente(`CREATE INDEX IF NOT EXISTS idx_${extracoes}_resposta ON ${extracoes} (resposta_id)`);

    // Ver comentário completo de `repararFkSeApontarParaTabelaErrada` no topo do arquivo —
    // terceira e última FK encontrada com o mesmo problema (mesma execução corrompida).
    await repararFkSeApontarParaTabelaErrada(extracoes, 'proposta_id', propostas);

    // Rastreabilidade proposta ↔ solicitação (seção 33) — NULL em toda proposta manual
    // (Fase 1, inalterada). Aditivo/nullable, mesmo padrão das demais colunas desta fase.
    await executarDdlIdempotente(`ALTER TABLE ${propostas} ADD COLUMN IF NOT EXISTS solicitacao_id UUID REFERENCES ${solicitacoes}(id)`);

    // Único ponto desta fase que NÃO é uma simples ADD COLUMN: amplia o CHECK de `status`
    // de `propostas` para admitir 'PENDENTE_VALIDACAO' (seção 7) sem invalidar nenhum valor
    // já aceito antes — só ADICIONA uma opção. Descobre o nome real da constraint em
    // vez de supor `${propostas}_status_check` (mais seguro contra qualquer diferença de
    // nome herdada de uma criação anterior da tabela); idempotente — rodar de novo encontra
    // a constraint já ampliada e a recria de forma idêntica, sem efeito.
    await executarDdlIdempotente(`
      DO $$
      DECLARE
        nome_constraint text;
      BEGIN
        SELECT con.conname INTO nome_constraint
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
        WHERE rel.relname = '${propostas}' AND con.contype = 'c' AND att.attname = 'status';
        IF nome_constraint IS NOT NULL THEN
          EXECUTE format('ALTER TABLE ${propostas} DROP CONSTRAINT %I', nome_constraint);
        END IF;
        EXECUTE 'ALTER TABLE ${propostas} ADD CONSTRAINT ${propostas}_status_check
          CHECK (status IN (''RECEBIDA'',''EM_ANALISE'',''SELECIONADA'',''REJEITADA'',''PENDENTE_VALIDACAO''))';
      END $$;
    `);
  })();
  return esquemaGarantido;
}

/** Só para os testes: força uma nova checagem de schema após um `DROP TABLE` de limpeza. */
export function resetarEsquemaGarantidoParaTestes(): void {
  esquemaGarantido = null;
}
