---
tags: [arquitetura, fretes, email, smtp, imap]
atualizado: 2026-10-02
---

# Email - SMTP e IMAP

Parte de [[Migração n8n para Backend ETK]]. Fases 1 (saída) e 2 (entrada).

## Situação atual

Atualização verificada em 2026-10-05: Production na Vercel está **Ready** no commit `0e9c6e2` (IMAP direto). `IMAP_*` e `FRETES_JOB_SECRET` já estão cadastradas em Production. As indicações de IMAP sem commit/deploy nesta nota descrevem o estado anterior de 2026-10-02. O agendamento e a homologação real ainda precisam ser confirmados.

| Sentido | Caminho | Situação |
|---|---|---|
| Saída | SMTP direto (Locaweb, `nfe@etk.ind.br`) | **ativo em produção** desde o commit `f4adedb` (2026-10-02) |
| Entrada | IMAP direto + job | **implementado, sem commit/deploy**; falta configurar `IMAP_*` e `FRETES_JOB_SECRET` e escolher o agendador |
| Entrada (antigo) | workflow IMAP do n8n | parado: o trial do n8n expirou |

## E-mail de saída: estado atual (n8n)

Workflow `ETK - Homologação Cotação Frete`:

`Webhook (POST, header auth)` → `Rotear Canal` (EMAIL) → `Validar Email Transportadora` (`transportadora.email` não vazio) → `Compor Email Cotacao` → `Enviar Email SMTP` → `Registrar Email Enviado` (só local no n8n)

- **Entrada:** `PayloadSolicitacaoN8n` v1. O n8n usa `referencia`, `solicitacaoId`, `transportadora.{id,email,fonteEmail}` e `logistica.*`, incluindo `embalagens`.
- **Remetente:** `nfe@etk.ind.br` (credencial SMTP no n8n).
- **Assunto:** `Cotação de Frete ETK | <referencia>`. É a chave de correlação da resposta.
- **Corpo (HTML + texto):** tabela "DADOS DA COTAÇÃO" com Referência, Origem/CEP, CNPJ origem, Destino/CEP, CNPJ destino, Modalidade, Peso total (e líquido), Total de volumes (espécie), Embalagens (uma linha por tipo), Observações (TDE destacado). Depois, o pedido de resposta nos campos `VALOR_FRETE:`, `PRAZO_DIAS:`, `VALIDADE:`, `PEDAGIO:`, `GRIS:`, `AD_VALOREM:`, `OBSERVACOES:`.
- **Status:** o ETK marca `ENVIADA` quando o webhook responde 2xx, o que hoje acontece **antes** do SMTP rodar.
- **Erros:** e-mail vazio cai em "Email Ausente - Erro Controlado" (só no n8n). Uma falha de SMTP não volta para o ETK. Desde `cda9784`, um HTTP não-2xx do webhook grava um resumo sanitizado em `erro_ultima_tentativa` e na auditoria.
- **Auditoria:** no ETK, `SOLICITACAO_CRIADA`, `SOLICITACAO_ENVIADA_N8N` / `SOLICITACAO_ERRO_N8N`, `ENVIO_SOLICITACAO_RESULTADO`.

## E-mail de saída: SMTP direto (Fase 1, ativo)

**Situação:** publicado em produção (`etk-comissoes`, commit `f4adedb`). As variáveis `SMTP_*` e `FRETES_EMAIL_OUTBOUND=smtp` estão configuradas em Production. O caminho n8n continua no código como rollback, mas hoje não funciona porque o trial expirou.

| Peça | Arquivo |
|---|---|
| Cliente SMTP (`nodemailer` 10) | `src/fretes/integracoes/smtpCliente.ts` |
| Template portado do n8n (função pura) | `src/fretes/email/templateCotacao.ts` |
| Despacho por canal + flag | `tentarEnviarSolicitacao` em `src/fretes/integracaoCotacoesServico.ts` |
| Sanitização compartilhada | `src/fretes/integracoes/sanitizacao.ts` |
| Testes (sem banco, sem servidor real) | `tests/fretes/integracoes/smtpCliente.test.ts`, `tests/fretes/email/templateCotacao.test.ts`, `tests/fretes/envioSmtp.test.ts`, caso de lote em `envioSolicitacoes.test.ts` |

**Variáveis (Vercel → Production):**

| Variável | Obrigatória | Observação |
|---|---|---|
| `SMTP_HOST` | sim | servidor SMTP da Locaweb |
| `SMTP_PORT` | não (587) | 465 = SSL/TLS implícito; outras = STARTTLS obrigatório |
| `SMTP_USER` | sim | conta de envio |
| `SMTP_PASS` | sim | só na Vercel, nunca no repositório |
| `SMTP_FROM` | sim | ex.: `ETK Fretes <cotacao@...>`; deve ser permitido pela conta |
| `SMTP_TIMEOUT_MS` | não (15000) | timeout de conexão, saudação e socket |
| `FRETES_EMAIL_OUTBOUND` | não (`smtp`) | `n8n` = rollback |

Sem `SMTP_HOST`/`USER`/`PASS`/`FROM`, o envio é recusado (`SMTP_NAO_CONFIGURADO`) e a solicitação fica `ERRO`. Nunca envia sem credencial.

**Comportamento:**
- O destinatário é o snapshot `email_destino` (MANUAL > CADASTRO > OMIE > bloqueio, inalterado).
- Assunto, layout e campos de resposta iguais aos do n8n. Diferenças:
  - medidas com rótulo `(C x L x A)`;
  - as linhas "Cliente" e "Valor da mercadoria" não existiam no payload e continuam fora.
- **`ENVIADA` só quando o servidor SMTP aceita** (não é "entregue"). O Message-ID vai para `identificador_externo` da solicitação.
- **Falha vira `ERRO`** com motivo sanitizado e código estável:

| Código | Situação | Mensagem na tela |
|---|---|---|
| `SMTP_AUTENTICACAO` | usuário/senha recusados | "Erro ao enviar e-mail." |
| `SMTP_DESTINATARIO_RECUSADO` | destinatário recusado | "Erro: e-mail inválido ou não cadastrado." |
| `SMTP_CONEXAO` | conexão/TLS/DNS | "Erro ao enviar e-mail." |
| `SMTP_TIMEOUT` | tempo esgotado | "Erro ao enviar e-mail." |
| `SMTP_OUTRO` | demais recusas | "Erro ao enviar e-mail." |

- O detalhe técnico aparece em "Detalhes" e na auditoria (`SOLICITACAO_ENVIADA_SMTP` / `SOLICITACAO_ERRO_SMTP`). A senha, o usuário e o comando `AUTH` são removidos.
- Lote: cada transportadora isolada; a falha de uma não bloqueia as outras (inalterado).
- Reenviar: mesma solicitação, mesma referência, mesmas embalagens, agora pelo SMTP.
- Uma tentativa por envio, sem retry automático.

**Rollback:** `FRETES_EMAIL_OUTBOUND=n8n` + redeploy. Ver [[Rollback n8n]].

O Message-ID de saída (em `identificador_externo`) é usado pelo IMAP para correlacionar respostas pelos cabeçalhos `In-Reply-To`/`References`.

## E-mail de saída: desenho original (Fase 1)

- Novo adaptador `src/fretes/integracoes/smtpCliente.ts` (`nodemailer`), chamado de `tentarEnviarAoN8n`, que vira `tentarEnviarSolicitacao` com despacho por canal e flag.
- Template portado **sem mudar o conteúdo** para `src/fretes/email/templateCotacao.ts`, como função pura testável. Recebe o mesmo `PayloadSolicitacaoN8n`, o que garante que o e-mail não ganhe campo comercial.
- O e-mail de destino continua sendo o **snapshot** `email_destino` da solicitação (MANUAL > CADASTRO > OMIE > bloqueio, resolvido antes).
- `ENVIADA` só quando o servidor SMTP aceita (`250`). Guardar o **Message-ID gerado** na solicitação (nova coluna `email_message_id`), o que permite correlacionar a resposta por `In-Reply-To`/`References` além do assunto.
- Erro SMTP (autenticação, recusa, timeout) vira `ERRO` com motivo sanitizado. O Reenviar reaproveita a mesma solicitação (mesma referência e mesmas embalagens).
- `Reply-To` = caixa monitorada pelo IMAP (pode ser a mesma do remetente).
- Timeout explícito; uma tentativa por chamada; sem retry automático (regra atual mantida).

## E-mail de entrada: estado atual (n8n)

`IMAP Email Trigger` (INBOX, `UNSEEN` + assunto contém "Frete ETK", marca como lida) → `Filtrar Respostas Cotacao` (assunto contém `Cotação de Frete ETK |`) → `Extrair Referencia e Dados` (regex) → `Verificar Extracao Valida` → `Preparar Callback Email` → `Callback ETK Email` (`POST https://etk-comissoes.vercel.app/api/fretes/integracoes/cotacoes/resposta`)

- **Referência:** regex no assunto `Cota[cç][aã]o de Frete ETK \| ([A-Z]{3}-\d{4}-\d{6}-[a-f0-9]+)`.
- **Message-ID:** obrigatório; vira `mensagemId` (idempotência no ETK).
- **Extração** (linhas `CAMPO: valor` no texto): `valorFrete`, `prazoDias`, `validade` (DD/MM/AAAA ou AAAA-MM-DD, validada), `pedagio`, `gris`, `adValorem`, `observacoes` (uma linha); `confianca: 1`; `versaoExtrator: "email-regex-v1"`.
- **Callback:** contrato v1 `{versao, referencia, canal:"EMAIL", mensagemId, conteudoBruto, versaoExtrator, extracao}`.
- **Idempotência:** no ETK, por `mensagemId`; no n8n, só pelo flag "lido".
- **Falhas (sem referência, sem Message-ID, sem VALOR_FRETE):** ficam só no n8n e **não chegam ao ETK**.

## E-mail de entrada: IMAP direto (Fase 2, implementado em 2026-10-02, sem commit/deploy)

| Peça | Arquivo |
|---|---|
| Cliente IMAP (`imapflow` 2.2) | `src/fretes/integracoes/imapCliente.ts` |
| Decodificação MIME (`mailparser` 3.9) + chave de idempotência | `src/fretes/email/lerMensagemEmail.ts` |
| Parser de resposta (valores, datas, citação) | `src/fretes/email/parserRespostaEmail.ts` |
| Orquestração do job | `src/fretes/jobEmailsRespostaServico.ts` |
| Controle (Message-ID, cursor, lock) | `src/fretes/emailsRespostaRepositorio.ts` |
| Endpoint do job + lista de revisão | `src/rotas/fretes.ts` |
| Testes (sem banco, sem servidor) | `tests/fretes/email/*`, `tests/fretes/jobEmailsResposta.test.ts`, `tests/fretes/integracoes/imapCliente.test.ts` |

**Variáveis (Vercel → Production):**

| Variável | Obrigatória | Observação |
|---|---|---|
| `IMAP_HOST` | sim | servidor IMAP da Locaweb |
| `IMAP_PORT` | não (993) | sempre SSL/TLS |
| `IMAP_USER` / `IMAP_PASS` | sim | conta da caixa que recebe as respostas |
| `IMAP_MAILBOX` | não (`INBOX`) | pasta lida |
| `IMAP_TIMEOUT_MS` | não (20000) | |
| `FRETES_JOB_SECRET` | sim | segredo do endpoint do job |

**Leitura da caixa:**
- `EXAMINE` (somente leitura) + `BODY.PEEK`: **nunca apaga, move nem marca como lido**. O operador pode abrir os e-mails no Outlook ou webmail normalmente.
- **Não depende de "não lido".** Usa um cursor por caixa (`UIDVALIDITY` + último UID) na tabela `cursores_imap_frete`. Sem cursor, ou se o `UIDVALIDITY` mudar, relê os últimos 7 dias; a idempotência impede duplicar.
- Até 30 mensagens por execução e orçamento de 40 s. O excedente fica para a próxima.

**Regra de Message-ID (idempotência):**
- A chave é o `Message-ID` do e-mail. Sem Message-ID, usa `sem-message-id:<sha256(remetente, data, assunto, texto)>`, que é determinística: o mesmo e-mail relido dá a mesma chave.
- A chave é UNIQUE em `emails_resposta_frete` e também é o `mensagemId` da resposta (a idempotência já existente do serviço de respostas). É o mesmo valor que o n8n usava, então uma resposta já processada pelo n8n não duplica.
- Chave já registrada (exceto `ERRO`) resulta em "duplicada", ignorada sem efeito.

**Filtro (o que é do fluxo de fretes):**
- assunto com referência `FRE-AAAA-NNNNNN-xxxxxxxx`, **ou** assunto "Cotação de Frete ETK", **ou** `In-Reply-To`/`References` igual ao Message-ID de um envio SMTP.
- O resto é ignorado sem gravar nada. O remetente só é guardado como apoio, nunca decide.

**Correlação (só por referência exata):** assunto → cabeçalhos de resposta → corpo (só se houver **uma única** referência). Nenhuma, mais de uma ou referência sem solicitação vai para revisão manual.

**Parser monetário** (corrige o bug do n8n em que `1500.00` virava 150000):

| Entrada | Resultado |
|---|---|
| `1500`, `1500,00`, `1500.00`, `1.500,00`, `1,500.00`, `R$ 1.234,56`, `1.500.000,00` | aceito |
| `1.500`, `1,500`, `1500.000`, `1.500,000`, texto | **ambíguo → revisão manual**, valor `null` |

- Validade: `DD/MM/AAAA` ou `AAAA-MM-DD` (data real), normalizada para `AAAA-MM-DD`.
- A citação do e-mail original (o modelo com os rótulos vazios) é removida antes da leitura.
- Rótulo repetido com valores diferentes conta como ambíguo.
- **Nenhum imposto aplicado no parser:** o valor vai como frete base para `servicoProcessarRespostaWebhook`. A composição fiscal/comercial existente roda depois, na tela. A proposta nasce `PENDENTE_VALIDACAO`.

**Revisão manual** (`emails_resposta_frete.status = REVISAO_MANUAL`, texto guardado em `conteudo`): referência ausente, ambígua ou inexistente; valor ausente ou ambíguo; formato inesperado; falha técnica repetida (5x).
- Quando a referência existe, a resposta também é registrada no ETK, sem proposta se não houver valor.
- Lista: `GET /api/fretes/emails-resposta/revisao` (usuários com acesso a fretes). **Ainda não há tela para essa lista.**

**Falha técnica** (banco, IMAP): `ERRO` com motivo sanitizado. O lote para e o cursor não avança; a próxima execução tenta de novo.

**Auditoria** (`origem = job_imap`): `JOB_EMAILS_INICIADO`, `JOB_EMAILS_CONCLUIDO` (encontradas, processadas, revisão, duplicadas, ignoradas, erros), `JOB_EMAILS_FALHOU`, `EMAIL_RESPOSTA_REVISAO_MANUAL`, `EMAIL_RESPOSTA_ERRO`. Sem senha nem token.

**Banco:** tabelas novas `emails_resposta_frete` e `cursores_imap_frete` (aditivas). ⚠️ Já existem em produção, **vazias**: foram criadas em 2026-10-02 por engano, quando um teste com banco rodou durante o desenvolvimento. Desde então, os testes isolam essas tabelas (`tests/fretes/isolamentoTabelasComerciais.ts`).

## E-mail de entrada: desenho original (Fase 2)

Executado pelo job de [[Jobs e Polling]] a cada 5 min.

1. **Leitura por UID, não por "não lido":** guardar `UIDVALIDITY` + último UID processado por caixa. Buscar `UID > ultimo`. Se a `UIDVALIDITY` mudar, reler por `SINCE <data - 7 dias>` e deixar a deduplicação por Message-ID resolver. Nunca alterar flags da caixa (só leitura, `BODY.PEEK`).
2. **Controle interno:** nova tabela `emails_recebidos_frete` com `message_id` UNIQUE, `uid`, `uidvalidity`, `mailbox`, `recebido_em`, `remetente`, `assunto`, `status` (`PROCESSADO` | `REVISAO_MANUAL` | `IGNORADO` | `ERRO`), `referencia`, `resposta_id`, `motivo`, `tentativas`. O Message-ID já registrado é pulado.
3. **Filtro:** só e-mails cujo assunto contém `Cotação de Frete ETK |` **ou** cujo `In-Reply-To`/`References` bate com um `email_message_id` de saída. Outros ficam `IGNORADO` (sem conteúdo armazenado).
4. **Correlação:** referência do assunto; senão, cabeçalhos de resposta. Nunca por nome ou remetente.
5. **Parser** (`src/fretes/email/parserRespostaEmail.ts`, puro e testado):
   - texto via `mailparser`; se só houver HTML, converter para texto;
   - remover citação da mensagem original (linhas `>` e blocos "Em ... escreveu:") antes de extrair, para não ler o modelo vazio que a ETK enviou;
   - número: aceita `1.234,56`, `1234,56`, `1234.56` e `1234`. Formato ambíguo (ex.: `1.234`) resulta em `valorFrete: null` e revisão. Nunca adivinhar;
   - `OBSERVACOES` multilinha até o próximo `CAMPO:`.
6. **Encaminhamento:**
   - referência encontrada → `servicoProcessarRespostaWebhook` com `mensagemId` = Message-ID, `versaoExtrator: "email-nativo-v1"`. Sem `valorFrete`, o serviço já registra `REQUER_REVISAO` e não cria proposta;
   - sem referência → `REVISAO_MANUAL` na tabela de controle, visível numa lista "E-mails não correlacionados" na tela de propostas (Fase 2b).
7. **Auditoria:** `EMAIL_RECEBIDO`, `EMAIL_IGNORADO`, `EMAIL_REVISAO_MANUAL`, mais os eventos já existentes de resposta e proposta.

## Critérios de aceite

- E-mail lido manualmente na caixa antes do job **ainda é processado**.
- Reprocessar a mesma caixa inteira não gera nenhuma resposta ou proposta nova.
- `VALOR_FRETE: 1500.00`, `1.500,00` e `1500,00` dão 1500; `1.500` vai para revisão.
- Resposta sem `VALOR_FRETE` aparece no ETK como extração `REQUER_REVISAO`, sem proposta.
- Resposta sem referência aparece em "não correlacionados" no ETK.
