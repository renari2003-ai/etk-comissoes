---
tags: [arquitetura, fretes, n8n, migracao]
atualizado: 2026-10-02
status: planejamento
---

# Migração n8n para Backend ETK

## Atualização verificada em 2026-10-05

- A Vercel mostra Production **Ready**, commit `0e9c6e2` (IMAP direto); SMTP e IMAP já foram publicados. As referências abaixo a Fase 2 sem commit/deploy são histórico de 2026-10-02 anterior à publicação.
- `IMAP_*`, `FRETES_JOB_SECRET`, `YCLOUD_API_KEY`, `YCLOUD_WHATSAPP_FROM` e `YCLOUD_WEBHOOK_SECRET` estão cadastradas em Production; `FRETES_WHATSAPP=ycloud` confirmado. Valores secretos não foram expostos.
- WhatsApp direto (Fases 3/4): código validado, publicação autorizada e em preparação. Template `cotacao_frete_etk` cadastrado em `pt_BR`, Utility, em análise pela Meta. Peso e volumes estão no parâmetro de Carga.
- Webhook direto do ETK existe na YCloud, ainda inativo nesta conferência. O webhook antigo do n8n será desativado na troca; o sistema não deverá depender do n8n.
- Agendamento IMAP e homologação real de envio/resposta ainda precisam ser confirmados.

Objetivo: substituir **gradualmente** o n8n por código nativo do backend ETK no módulo de fretes, um canal por vez, sem desligar o n8n até a homologação de cada etapa.

Notas de detalhe:
- [[Email - SMTP e IMAP]]: e-mail de saída e de entrada
- [[WhatsApp - YCloud Direto]]: WhatsApp de saída e de entrada
- [[Jobs e Polling]]: cron de 5 min, lock, retry
- [[Plano de Homologação]]: testes por fase
- [[Rollback n8n]]: como voltar ao n8n em cada fase

As regras de negócio do módulo valem para todas as fases sem exceção (ver `CLAUDE.md`, seção "Regras do módulo de fretes").

## Estado atual

```
ETK (Vercel) ──POST payload v1──▶ n8n webhook "etk-cotacao-frete-homologacao"
                                   ├─ EMAIL    → SMTP (nfe@etk.ind.br)
                                   ├─ WHATSAPP → 2º workflow n8n "ycloud-whatsapp-outbound" → YCloud
                                   └─ API      → erro (Braspress já é direta no ETK)

Caixa IMAP (INBOX) ──n8n IMAP trigger──▶ regex ──▶ POST /api/fretes/integracoes/cotacoes/resposta
YCloud ──▶ n8n (incoming) ──▶ /whatsapp/correlacionar + /cotacoes/resposta
n8n (outbound) ──▶ /api/fretes/integracoes/whatsapp/outbound   (grava wamid)
Braspress ◀── ETK direto (API oficial)
```

### Workflows n8n

| Workflow | Backup | Mapeado |
|---|---|---|
| ETK - Homologação Cotação Frete | `n8n Backup/Workflows` | Sim (nó a nó) |
| ETK - WhatsApp YCloud Outbound | **ausente** | Só pelo contrato do lado ETK |
| ETK - WhatsApp YCloud Incoming | **ausente** | Só pelo contrato do lado ETK |
| TESTE - Homologação Email SMTP-IMAP | **ausente** | Não |

> Baixar os 3 que faltam antes da Fase 3 (WhatsApp). Ver [[Rollback n8n]]: o backup é pré-requisito do rollback.

### Contratos ETK ↔ n8n (já existentes, versionados)

| Direção | Endpoint / payload | Código |
|---|---|---|
| ETK → n8n | `PayloadSolicitacaoN8n` v1 (`logistica.embalagens` incluso desde `cda9784`) | `src/fretes/integracoes/n8nCliente.ts` |
| n8n → ETK | `POST /api/fretes/integracoes/cotacoes/resposta` (v1, idempotente por `mensagemId`) | `src/fretes/webhookCotacoes.ts` |
| n8n → ETK | `POST /api/fretes/integracoes/whatsapp/outbound` (idempotente por `wamidOutbound`) | idem |
| n8n → ETK | `POST /api/fretes/integracoes/whatsapp/correlacionar` (`context.id`) | idem |

Autenticação de entrada: header `x-fretes-webhook-secret` (`FRETES_WEBHOOK_SECRET`). Saída: header `x-n8n-webhook-secret`.

### Problemas encontrados no fluxo atual

1. **"Enviado" não significa e-mail enviado.** O Webhook do n8n está no modo padrão (responde ao receber). O ETK marca `ENVIADA` antes do SMTP rodar, e uma falha de SMTP nunca volta para o ETK.
2. **O HTTP 500 atual** é, por esse mesmo motivo, provavelmente uma falha ao *iniciar* o workflow (credencial do header auth, versão ativa) e não uma falha do SMTP. A confirmar na aba Executions.
3. **IMAP depende de "não lido"** (`UNSEEN` + marca como lida). Um e-mail aberto por alguém na caixa antes do n8n nunca é processado.
4. **A revisão manual não chega ao ETK.** Uma resposta sem referência, sem Message-ID ou sem `VALOR_FRETE` termina no n8n ("Marcar Revisao Humana") e não aparece em lugar nenhum no ETK, embora o ETK já aceite `valorFrete: null` e crie uma extração `REQUER_REVISAO`.
5. **Parser de número ambíguo:** `parseNumBR` remove todos os pontos, então `VALOR_FRETE: 1500.00` vira **150000**. Risco direto de valor errado.
6. **Resposta só em HTML** (sem parte texto) não é lida, porque a extração usa só `text`.
7. **Observações** só capturam a primeira linha, e `conteudoBruto` é truncado em 2.000 caracteres (o ETK aceita 20.000).
8. **WhatsApp:** o 1º workflow repassa o payload ao 2º webhook **sem autenticação**.
9. O template de e-mail **já renderiza** `logistica.embalagens`, no formato "Quantidade: 6 | Medidas: C x L x A m". Não precisa de ajuste para as embalagens.

## Arquitetura alvo

```
ETK backend ──SMTP──▶ Locaweb                       (Fase 1)
Vercel Cron */5 ──▶ /api/interno/jobs/email-respostas
                    └─ IMAP Locaweb → parser → serviço existente de resposta  (Fase 2)
ETK backend ──HTTPS──▶ YCloud API                   (Fase 3)
YCloud webhook ──▶ /api/fretes/integracoes/ycloud/webhook   (Fase 4)
Braspress ◀── ETK direto (sem mudança)
```

Princípios:
- **Mesmo núcleo de domínio.** Os canais nativos chamam os serviços que já existem: `servicoProcessarRespostaWebhook`, `registrarWamidOutbound`, `servicoResolverReferenciaPorWamidOutbound`, `marcarSolicitacaoEnviada/Erro`. A regra de negócio não é reescrita. O n8n vira só mais um "adaptador" que sai.
- **Seleção por canal com flag de ambiente:** `FRETES_EMAIL_OUTBOUND=n8n|nativo`, `FRETES_EMAIL_INBOUND=n8n|nativo`, `FRETES_WHATSAPP=n8n|nativo`. O padrão é `n8n` até a homologação. O rollback é trocar a flag (ver [[Rollback n8n]]).
- **`ENVIADA` só depois do aceite real** do servidor SMTP ou da API YCloud, e não mais no aceite do webhook.
- **Mensagem não compreendida vai para revisão manual dentro do ETK.** Nunca se infere valor.

## Situação em 2026-10-02

- **n8n bloqueado:** o trial expirou. Nenhum fluxo pode depender dele agora, e o rollback para n8n só volta a funcionar se o plano for reativado.
- **Fase 1 ativa em produção** (`etk-comissoes`, commit `f4adedb`). O EMAIL sai por SMTP direto (Locaweb). Detalhes em [[Email - SMTP e IMAP]].
- **Fase 2 implementada, sem commit/deploy.** O IMAP direto lê as respostas, o parser monetário foi corrigido, a idempotência é por Message-ID e a fila de revisão manual existe. Faltam:
  - as variáveis `IMAP_*` e `FRETES_JOB_SECRET` na Vercel;
  - o **agendador** ([[Jobs e Polling]]);
  - uma tela para a fila de revisão (hoje só há API).
- ⚠️ As tabelas `emails_resposta_frete` e `cursores_imap_frete` já existem em produção, **vazias**. Foram criadas por engano por um teste com banco durante o desenvolvimento.
- **Até o job ser agendado**, as respostas por e-mail **não entram sozinhas** no ETK. Dá para rodar o job sob demanda chamando o endpoint.
- **Fase 3/4 (WhatsApp) implementada, sem commit/deploy.** O envio e o recebimento vão direto pela YCloud, e o n8n saiu do caminho. Faltam:
  - as variáveis `YCLOUD_*`;
  - o cadastro do webhook na YCloud;
  - um template aprovado para iniciar conversa.

  Detalhes em [[WhatsApp - YCloud Direto]].
- Braspress sem mudança.

## Fases

| Fase | Entrega | Depende de | Situação |
|---|---|---|---|
| 0 | Backup completo dos 4 workflows; decisões da seção "Dependências" | usuário | parcial (1/4 workflows) |
| 1 | E-mail de saída nativo (SMTP Locaweb) atrás de flag | `nodemailer` ✔; credenciais SMTP na Vercel ✔ | **ativo em produção** (`f4adedb`); homologação manual pendente |
| 2 | E-mail de entrada nativo (IMAP + parser + cron 5 min) | `imapflow` ✔ + `mailparser` ✔; tabelas de controle ✔; `IMAP_*`/`FRETES_JOB_SECRET`; agendador | **código pronto, sem commit/deploy**; agendador pendente |
| 3 | WhatsApp de saída direto (YCloud API) | API key YCloud; número remetente; template aprovado | **código pronto, sem commit/deploy** |
| 4 | WhatsApp de entrada direto (webhook YCloud → ETK) | endpoint cadastrado na YCloud; `YCLOUD_WEBHOOK_SECRET` | **código pronto, sem commit/deploy** |
| 5 | Desativar workflows n8n (sem apagar) | 2 semanas estáveis por canal | pendente |

Cada fase é um PR/commit separado, com testes em `tests/fretes/` e homologação ([[Plano de Homologação]]) antes de trocar a flag em produção.

## Dependências e decisões pendentes

- **Pacotes novos** (exigem autorização): `nodemailer` (SMTP, **instalado**: 10.0.13 + `@types/nodemailer`), `imapflow` (IMAP, **instalado**: 2.2.1), `mailparser` (MIME/HTML → texto, **instalado**: 3.9.33 + `@types/mailparser`). A YCloud usa `fetch` nativo e não precisa de pacote.
- **Plano Vercel:** cron a cada 5 min exige plano **Pro** (no Hobby, cron roda no máximo 1x/dia). Ver alternativas em [[Jobs e Polling]].
- **Credenciais novas na Vercel** (só nomes, nunca valores no repositório): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASS`, `IMAP_MAILBOX`, `CRON_SECRET`, `YCLOUD_API_KEY`, `YCLOUD_WEBHOOK_SECRET`, `YCLOUD_FROM_NUMBER`.
- **Migrations** (aditivas, exigem autorização): controle de e-mails processados, `email_message_id` de saída na solicitação, registro de execuções do job. Detalhe em [[Email - SMTP e IMAP]] e [[Jobs e Polling]].
- `.env.example` já lista `N8N_*`, `SMTP_*` e `FRETES_EMAIL_OUTBOUND` (só nomes).

## Riscos

| Risco | Mitigação |
|---|---|
| E-mail duplicado para a transportadora durante a transição | uma flag por canal; nunca os dois adaptadores enviando ao mesmo tempo |
| Resposta processada duas vezes (n8n e ETK lendo a mesma caixa) | idempotência por `mensagemId` = Message-ID (já existe); desativar o trigger IMAP do n8n ao ligar o nativo |
| Valor extraído errado | parser estrito (formato BR e internacional sem ambiguidade); valor ambíguo vai para revisão, nunca para proposta |
| SMTP Locaweb bloqueia/limita envio | teste de limite na homologação; erro explícito com `FALHA` e Reenviar |
| Timeout de função na Vercel durante o IMAP | lote limitado por execução, `maxDuration` explícito, lock |
| Cron não disponível no plano | alternativa temporária: n8n só como "relógio" chamando o endpoint protegido |
| Vazamento de credencial | variáveis só na Vercel; erros sanitizados (`sanitizarTextoErro`) |

## Critérios de aceite (globais)

- Nenhuma proposta criada sem `valorFrete` extraído; toda proposta nasce `PENDENTE_VALIDACAO`.
- Mesmo Message-ID ou `wamid` processado duas vezes resulta em uma única resposta, extração e proposta.
- `ENVIADA` só após aceite real do provedor; falha vira `ERRO` com motivo sanitizado e Reenviar funciona.
- Toda transição registrada em `registrarAuditoria`.
- Payload/e-mail para transportadora sem margem, custo, markup ou valor de venda.
- Resolução de e-mail MANUAL > CADASTRO > OMIE > bloqueio intacta; Omie só leitura.
- Rollback de cada canal em menos de 5 minutos, só com troca de flag.
