---
tags: [arquitetura, fretes, whatsapp, ycloud]
atualizado: 2026-10-05
---

# WhatsApp - YCloud Direto

Parte de [[Migração n8n para Backend ETK]]. Fases 3 (saída) e 4 (entrada).

> Os workflows `ETK - WhatsApp YCloud Outbound` e `ETK - WhatsApp YCloud Incoming` **não estão no backup**, e o n8n está bloqueado (trial expirado). Por isso, a mensagem enviada pelo n8n não pôde ser copiada: a mensagem nativa foi reconstruída com os mesmos dados do e-mail de cotação.

## Situação (2026-10-02): saída e entrada diretas implementadas, sem commit/deploy

Atualização em 2026-10-05: publicação das Fases 3/4 autorizada pelo usuário e em preparação. TypeScript e build aprovados; 26 testes isolados de WhatsApp/YCloud passaram. `FRETES_WHATSAPP=ycloud` confirmado em Production. O template foi submetido à Meta e está em análise. Não considerar homologação real concluída antes do teste de envio e resposta.

O backend fala direto com a YCloud (a YCloud é mantida; Meta direta fica para depois). O n8n saiu do caminho de WhatsApp. Os workflows não foram apagados e servem só de rollback, quando o n8n for reativado.

| Peça | Arquivo |
|---|---|
| Cliente da API YCloud (`fetch` nativo, sem pacote novo) | `src/fretes/integracoes/ycloudCliente.ts` |
| Mensagem (texto) e parâmetros do template | `src/fretes/whatsapp/mensagemCotacao.ts` |
| Despacho do canal WHATSAPP + flag | `tentarEnviarPorYCloud` em `src/fretes/integracaoCotacoesServico.ts` |
| Contrato e assinatura do webhook | `src/fretes/webhookYCloud.ts` |
| Processamento dos eventos | `src/fretes/webhookYCloudServico.ts` |
| Controle de mensagens recebidas | `src/fretes/whatsappRecebidasRepositorio.ts` (tabela `whatsapp_recebidas_frete`) |
| Corpo bruto para HMAC | `src/rotas/corpoBruto.ts` + `verify` do `express.json` em `src/server.ts` |
| Testes (sem banco, sem YCloud real) | `tests/fretes/integracoes/ycloudCliente.test.ts`, `tests/fretes/whatsappYCloud.test.ts`, `tests/fretes/webhookYCloud.test.ts` |

### Variáveis (Vercel → Production)

| Variável | Obrigatória | Observação |
|---|---|---|
| `YCLOUD_API_KEY` | sim | Console YCloud → Developers → API Keys. Só na Vercel |
| `YCLOUD_WHATSAPP_FROM` | sim | número remetente em E.164 (`+55...`) |
| `YCLOUD_WEBHOOK_SECRET` | sim | `whsec_...` devolvido ao criar o endpoint de webhook na YCloud |
| `YCLOUD_TEMPLATE_NOME` | recomendada | template aprovado; vazio = texto livre (ver janela de 24h) |
| `YCLOUD_TEMPLATE_IDIOMA` | não (`pt_BR`) | |
| `YCLOUD_TIMEOUT_MS` | não (15000) | |
| `FRETES_WHATSAPP` | não (`ycloud`) | `n8n` = rollback |

Conferido em 2026-10-05: `YCLOUD_API_KEY`, `YCLOUD_WHATSAPP_FROM`, `YCLOUD_WEBHOOK_SECRET` e `FRETES_WHATSAPP` já estão cadastradas em Production na Vercel. `YCLOUD_TEMPLATE_NOME=cotacao_frete_etk` foi configurado durante a preparação da publicação. Os valores secretos não foram expostos.

O endpoint direto do ETK já existe na YCloud, mas permanece inativo até publicar e validar o backend. O endpoint antigo do n8n ainda está ativo e deverá ser desativado na troca. A operação pretendida é ETK ↔ YCloud, sem dependência de n8n.

### Saída

- **Destino:** só `whatsapp_cotacao` do cadastro. 10/11 dígitos viram `+55` + número; 12/13 dígitos já com 55 recebem `+`; qualquer outra coisa é bloqueada. Nunca usa `telefone`.
- **Chamada:** `POST https://api.ycloud.com/v2/whatsapp/messages/sendDirectly` com cabeçalho `X-API-Key`, síncrona, uma tentativa.
- **Conteúdo:** os mesmos dados do e-mail (referência, origem/destino, CNPJs, modalidade, peso, volumes, embalagens e observações com destaque ⚠️ para TDE) e os mesmos campos de resposta (`VALOR_FRETE:` ...).
- **⚠️ Janela de 24h:** texto livre só é entregue se a transportadora falou com o número nas últimas 24h. Para iniciar conversa é preciso **template aprovado na Meta** (`YCLOUD_TEMPLATE_NOME`). Ver [[#Template WhatsApp vigente (fonte da verdade)]].
- **Status:**
  - YCloud aceitou (`accepted`/`sent`) → `ENVIADA`, **nunca "entregue"**;
  - recusa → `ERRO` com motivo sanitizado: `YCLOUD_DESTINO_INVALIDO` aparece na tela como "Erro: WhatsApp inválido ou não cadastrado."; `YCLOUD_AUTENTICACAO`, `YCLOUD_RECUSADO`, `YCLOUD_FALHOU`, `YCLOUD_TIMEOUT` e `YCLOUD_CONEXAO` aparecem como "Erro ao enviar WhatsApp.".
- **Rastreio:** `identificador_externo` e `ycloud_message_id` recebem o id da YCloud; `wamid_outbound` recebe o WAMID; `telefone_destino` recebe o número usado; `data_envio` recebe a data/hora. Se a YCloud ainda não devolveu o WAMID, ele é completado pelo webhook de status.
- **Auditoria:** `SOLICITACAO_ENVIADA_YCLOUD` (status YCloud, id, wamid, tipo de mensagem) e `SOLICITACAO_ERRO_YCLOUD`. Sem API key.

### Entrada

`POST /api/fretes/integracoes/ycloud/webhook`. Cadastrar esta URL como endpoint de webhook na YCloud, com os eventos `whatsapp.inbound_message.received` e `whatsapp.message.updated`.

- **Autenticidade (mecanismo oficial):** cabeçalho `YCloud-Signature: t={unix},s={hex}`, com `s = HMAC-SHA256(YCLOUD_WEBHOOK_SECRET, "{t}.{corpo bruto}")`. Comparação em tempo constante e tolerância de 5 min (anti-replay). Inválida resulta em **401** sem tocar o banco; payload malformado, em **400**.
- **Mensagem recebida:**
  - **Idempotência:** chave = `wamid` (ou `ycloud:<id>`), UNIQUE em `whatsapp_recebidas_frete`, e também é o `mensagemId` da resposta. A reentrega da YCloud é ignorada.
  - **Correlação:** `context.id` (reply) → solicitação com esse `wamid_outbound`. Sem reply, uma única referência `FRE-...` no texto serve de apoio. Reply + referência diferente, mais de uma referência ou nenhuma correlação vão para **revisão manual**. Nunca fuzzy.
  - **Extração:** o mesmo parser seguro do e-mail. Valor real, sem imposto, nunca fixo; ambíguo vai para revisão; a proposta nasce `PENDENTE_VALIDACAO`.
  - Mídia sem legenda (ex.: PDF) vai para revisão.
- **Status (`whatsapp.message.updated`):** completa o WAMID se faltava; `delivered`/`read` marca `ENTREGUE` (confirmação real, só a partir de `ENVIADA`); `failed` marca `ERRO` com `YCLOUD_FALHA_ENTREGA` e o operador usa Reenviar.
- **Revisão manual:** `GET /api/fretes/whatsapp-recebidas/revisao` (usuários com acesso a fretes). **Ainda sem tela.**
- **Auditoria** (`origem = webhook_ycloud`): `WHATSAPP_RECEBIDO`, `WHATSAPP_REVISAO_MANUAL`, `WHATSAPP_STATUS_ATUALIZADO`.
- **Endpoints antigos do n8n** (`/integracoes/whatsapp/outbound` e `/correlacionar`) continuam existindo, só para rollback.

## Template WhatsApp vigente (fonte da verdade)

> **Versão vigente em 2026-10-05.** Esta seção é a **fonte da verdade** do template de cotação por WhatsApp. Ela substitui as descrições genéricas anteriores, como a seção "Saída: desenho original (Fase 3)" abaixo e a lista de parâmetros que ficava em "Saída".
>
> É compatível com `parametrosTemplateWhatsapp` em `src/fretes/whatsapp/mensagemCotacao.ts`: 6 parâmetros, nesta ordem, coberto pelo teste `tests/fretes/whatsappYCloud.test.ts`.
>
> ⚠️ **Não alterar a ordem nem a quantidade dos parâmetros sem alterar também o backend**, no mesmo commit. O backend envia os valores por posição.

| Campo | Valor |
|---|---|
| Nome | `cotacao_frete_etk` |
| Idioma | `pt_BR` |
| Categoria | `UTILITY` |
| Situação na YCloud | **cadastrado em 2026-10-05, em análise pela Meta (In review)**. `YCLOUD_TEMPLATE_NOME=cotacao_frete_etk`; idioma `pt_BR`, padrão do código. A aprovação ainda é necessária para iniciar conversas. |

**Corpo:**

```
Olá! A ETK Indústria e Comércio solicita uma cotação de frete.
Referência: {{1}}
Origem: {{2}}
Destino: {{3}}
Carga: {{4}}
Embalagens: {{5}}
Observações: {{6}}

IMPORTANTE:
Use a opção "Responder" nesta própria mensagem para que a cotação seja identificada automaticamente.

Informe:
VALOR_FRETE:
PRAZO_DIAS:
VALIDADE:
OBSERVACOES:
```

**Parâmetros** (preenchidos pelo backend; sem quebra de linha, tab ou 4+ espaços seguidos, e várias linhas viram ` | `):

| # | Conteúdo | Exemplo (para a aprovação da Meta) |
|---|---|---|
| `{{1}}` | referência FRE | `FRE-2026-000123-abcd1234` |
| `{{2}}` | origem + CEP + CNPJ | `São Paulo/SP - CEP 01000-000 - CNPJ 11.222.333/0001-81` |
| `{{3}}` | destino + CEP + CNPJ | `Curitiba/PR - CEP 80000-000 - CNPJ 44.555.666/0001-81` |
| `{{4}}` | modalidade + peso + volumes | `CIF - 120 kg - 6 (CAIXA) volumes` |
| `{{5}}` | embalagens | `Quantidade: 6 \| Medidas: 0,77 x 0,36 x 0,27 m (C x L x A)` |
| `{{6}}` | observações/TDE | `Cobrar TDE no destino` |

Dado ausente vai como `—`; nunca é inventado. Nenhum dado comercial (margem, custo, markup, valor de venda) entra nos parâmetros.

**Histórico:**
- 2026-10-05: cadastrado na YCloud/Meta em `pt_BR`, categoria Utility, com os seis parâmetros e a instrução explícita de usar Responder na própria mensagem. Peso e quantidade de volumes são enviados em `{{4}}` (Carga); quantidade e medidas das embalagens em `{{5}}`. Situação verificada: In review.
- 2026-10-02: primeira versão completa (esta). Antes existiam só descrições genéricas: "referência, origem, destino, peso, volumes, embalagens resumidas", sem ordem nem texto. Esta versão fixou os 6 parâmetros, juntou o CNPJ à origem e ao destino, agrupou modalidade, peso e volumes em "Carga" e separou observações/TDE.


## Saída: como era via n8n (referência para rollback)

- O ETK envia `PayloadSolicitacaoN8n` com `canal: "WHATSAPP"` e `transportadora.whatsapp` (dígitos de `whatsappCotacao`; nunca inferido de `telefone`).
- O workflow principal roteia para `https://etk.app.n8n.cloud/webhook/ycloud-whatsapp-outbound` **sem autenticação**.
- O workflow de saída envia pela YCloud e chama `POST /api/fretes/integracoes/whatsapp/outbound` com `{referencia|solicitacaoId, wamidOutbound, ycloudMessageId, telefoneDestino, statusEnvio?, enviadoEm?}`.
- O ETK grava `wamid_outbound` (UNIQUE), `ycloud_message_id` e `telefone_destino` (`registrarWamidOutbound`, idempotente por `wamidOutbound`, auditado como `SOLICITACAO_WHATSAPP_OUTBOUND_REGISTRADA`).
- Status: `ENVIADA` ao aceite do webhook do n8n, com o mesmo problema do e-mail.

## Entrada: como era via n8n (referência para rollback)

- A YCloud chama o workflow de entrada.
- O n8n chama `POST /api/fretes/integracoes/whatsapp/correlacionar` com `{contextoReplyId}` (o `context.id` do reply). O ETK devolve `{correlacionado:true, referencia, solicitacaoId}` ou `{correlacionado:false}`, sem nunca adivinhar.
- O n8n extrai e chama `/cotacoes/resposta` com `canal: "WHATSAPP"` e `mensagemId` = id da mensagem recebida (idempotência).

## Saída: desenho original (Fase 3)

- Adaptador `src/fretes/integracoes/ycloudCliente.ts` com `fetch` nativo, timeout explícito, chave `YCLOUD_API_KEY` só na Vercel e remetente `YCLOUD_FROM_NUMBER`.
- ~~**Mensagem de template aprovada** (HSM) é obrigatória para iniciar conversa fora da janela de 24h. O texto do template é dependência do usuário e da Meta. Os parâmetros são só dados logísticos (referência, origem, destino, peso, volumes, embalagens resumidas).~~ **Substituído** por [[#Template WhatsApp vigente (fonte da verdade)]].
- A resposta síncrona da YCloud traz o id da mensagem e o `wamid`. Gravar direto com `registrarWamidOutbound` (reuso, mesma idempotência) e marcar `ENVIADA` só nesse momento.
- Falha da API (4xx/5xx/timeout) vira `ERRO` com motivo sanitizado; o Reenviar existente cobre o caso.
- O endpoint `/whatsapp/outbound` continua existindo enquanto o n8n puder ser reativado (rollback).

## Entrada: desenho original (Fase 4)

- Novo endpoint `POST /api/fretes/integracoes/ycloud/webhook`:
  - **valida a assinatura** da YCloud (HMAC com `YCLOUD_WEBHOOK_SECRET`, comparação em tempo constante, tolerância de timestamp). Sem assinatura válida, 401;
  - validação estrita do corpo (tipo, tamanho, enum); payload malformado dá 400.
- Eventos de **mensagem recebida**:
  1. `context.id` → `servicoResolverReferenciaPorWamidOutbound` (reuso);
  2. não correlacionado → registro para revisão manual (sem proposta);
  3. correlacionado → parser (mesmo de [[Email - SMTP e IMAP]], formato `CAMPO: valor`) → `servicoProcessarRespostaWebhook` com `canal: "WHATSAPP"`, `mensagemId` = wamid recebido.
- Eventos de **status** (sent/delivered/read/failed): só atualizam `ENTREGUE` com confirmação real de entrega; `failed` vira `ERRO` com motivo. Nunca chamar `ENVIADA` de `ENTREGUE`.
- Responder 200 rápido; a YCloud reenvia em caso de erro, e a idempotência por wamid absorve as repetições.

## Critérios de aceite

- O mesmo webhook YCloud entregue 3 vezes gera 1 resposta.
- Reply sem `context.id` conhecido fica `correlacionado: false` e vai para revisão; nenhuma proposta.
- Número sem `whatsappCotacao` válido é bloqueado antes do envio (regra atual).
- Webhook sem assinatura válida é recusado com 401, sem efeito no banco.
