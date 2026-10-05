---
tags: [arquitetura, fretes, cron, jobs]
atualizado: 2026-10-02
---

# Jobs e Polling

Parte de [[Migração n8n para Backend ETK]]. Usado na Fase 2 ([[Email - SMTP e IMAP]]).

## Situação (2026-10-02)

- **Job implementado** (sem commit/deploy): `POST`/`GET /api/fretes/jobs/processar-emails`, código em `src/fretes/jobEmailsRespostaServico.ts`.
- **Agendador NÃO implementado.** Nada chama o job automaticamente. Antes de escolher, confirmar o plano Vercel do time `etk-industria`, já que o cron de 5 min exige Pro. O n8n não serve como relógio enquanto o trial estiver expirado.
- Para rodar sob demanda:

```
curl -X POST https://etk-comissoes.vercel.app/api/fretes/jobs/processar-emails -H "Authorization: Bearer <FRETES_JOB_SECRET>"
```

A resposta traz `{status, encontradas, processadas, revisao, duplicadas, ignoradas, erros, restantes, erro, duracaoMs}`. HTTP 502 quando `status = ERRO`; 403 sem segredo válido.

## Agendamento a cada 5 minutos

**Opção principal: Vercel Cron**, em `vercel.json`:

```json
"crons": [{ "path": "/api/fretes/jobs/processar-emails", "schedule": "*/5 * * * *" }]
```

- Exige plano **Pro**. No Hobby, o cron roda no máximo 1x/dia e não serve. **Confirmar o plano do time `etk-industria` antes da Fase 2.**
- A Vercel chama com **GET** e envia `Authorization: Bearer <CRON_SECRET>`.
- Cron só roda no deployment de **Production**.

**Alternativas, se não houver Pro:**

| Alternativa | Observação |
|---|---|
| n8n "Schedule Trigger" só como relógio, chamando o endpoint | transição; mantém a lógica no ETK |
| Serviço externo de cron (ex.: cron-job.org) | precisa guardar o segredo lá |
| GitHub Actions `schedule` | atraso irregular, não recomendado |

Em todos os casos o endpoint é o mesmo. Trocar de agendador não muda o código.

## Endpoint interno

`POST` (agendador externo) e `GET` (Vercel Cron) em `/api/fretes/jobs/processar-emails`, ambos implementados.
- Autenticação: `Authorization: Bearer ${FRETES_JOB_SECRET}`, comparação em tempo constante. Fora disso, **403** e nada executado. Segredo vazio no servidor recusa tudo. Para Vercel Cron, definir `CRON_SECRET` com o **mesmo valor**.
- Não aparece no frontend; não aceita parâmetros que mudem o comportamento (sem URL, caixa ou credencial vindas de fora).
- Orçamento interno de 40 s por execução: perto do limite, para e deixa o resto para a próxima.

## Concorrência e lote

- **Lock:** `pg_try_advisory_lock(<chave fixa do job>)`. Se outra execução estiver rodando, sai com `PULADO_LOCK` sem erro.
- **Lote:** no máximo 30 e-mails por execução, em ordem de UID (`LIMITE_POR_EXECUCAO`).
- O cursor (último UID) só avança depois que cada e-mail é gravado na tabela de controle. Se o processo cair, a próxima execução retoma sem perda, e o Message-ID UNIQUE evita duplicar.

## Retry

- **Saída (SMTP/YCloud):** sem retry automático (regra atual). O Reenviar manual tem limite de 5 tentativas.
- **Entrada (implementado):** um e-mail com erro *técnico* (banco indisponível, timeout) fica `ERRO` com `tentativas + 1`. O lote **para nessa mensagem** e o cursor não avança, então a próxima execução tenta de novo. Depois de 5 tentativas vai para `REVISAO_MANUAL` e o cursor segue. Erro de *conteúdo* (sem referência, sem valor) vai direto para revisão, sem retry.

## Registro de execuções

**Implementado de forma mais simples que o desenho:** sem tabela própria. Cada execução fica na auditoria de fretes (`origem = job_imap`): `JOB_EMAILS_INICIADO`, `JOB_EMAILS_CONCLUIDO` (com as contagens e a duração), `JOB_EMAILS_FALHOU`, `EMAIL_RESPOSTA_REVISAO_MANUAL`, `EMAIL_RESPOSTA_ERRO`. A tabela `execucoes_job_frete` continua como melhoria futura, caso a auditoria fique volumosa (288 execuções por dia a cada 5 min).

Logs (`console`) apenas com contagens e ids, nunca corpo de e-mail, endereço completo ou credencial.

## Critérios de aceite

- Duas execuções simultâneas: uma processa e a outra sai com `PULADO_LOCK`.
- Execução interrompida no meio: a próxima completa sem duplicar.
- Chamada sem `FRETES_JOB_SECRET` válido responde 403 e não registra execução.
- Um `JOB_EMAILS_CONCLUIDO` por intervalo de 5 min aparece na auditoria de fretes em produção por 24h seguidas.
