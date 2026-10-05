---
tags: [arquitetura, fretes, rollback, n8n]
atualizado: 2026-10-02
---

# Rollback n8n

Parte de [[Migração n8n para Backend ETK]].

## Pré-requisitos (antes de qualquer fase)

- Backup JSON dos 4 workflows em `n8n Backup/Workflows`, com SHA-256 conferido. **Hoje só 1 de 4 está salvo.**
- Os endpoints de entrada usados pelo n8n (`/cotacoes/resposta`, `/whatsapp/outbound`, `/whatsapp/correlacionar`) **permanecem** até a Fase 5 terminar.
- Credenciais do n8n (SMTP, IMAP, YCloud, header auth) **não são revogadas** durante a migração.
- `N8N_WEBHOOK_URL` / `N8N_WEBHOOK_SECRET` continuam configuradas na Vercel.

## Como voltar, por canal

| Canal | Ação | Tempo |
|---|---|---|
| E-mail saída (**flag implementada**, padrão `smtp`) | `FRETES_EMAIL_OUTBOUND=n8n` na Vercel + redeploy | ~2 min |
| E-mail entrada (**implementado sem flag**) | parar o agendador do job (ou não chamar o endpoint) + reativar o "IMAP Email Trigger" no n8n. O job não altera a caixa, então o n8n encontra os e-mails como estavam | ~3 min |
| WhatsApp (**flag implementada**, padrão `ycloud`) | `FRETES_WHATSAPP=n8n` + redeploy + reativar os workflows YCloud + apontar o webhook da YCloud de volta para o n8n (só com o n8n reativado) | ~5 min |

Solicitações com `ERRO` durante o problema: usar Reenviar depois do rollback (mesma referência).

> ⚠️ **Situação em 2026-10-02:** o trial do n8n **expirou**. Os rollbacks para n8n acima **não funcionam** até o plano ser reativado. Hoje, a contingência real é:
> - **saída:** corrigir a variável ou credencial SMTP e usar **Reenviar**;
> - **entrada:** a mensagem nunca se perde (a caixa não é alterada e o job relê pela idempotência). Se o job falhar, as respostas podem ser lançadas manualmente a partir da caixa de e-mail.

## Por que o rollback é seguro

- Mesmo contrato e mesmo núcleo de domínio: o n8n e o adaptador nativo chamam os mesmos serviços.
- Idempotência por `mensagemId` (Message-ID / wamid): se os dois adaptadores lerem a mesma mensagem na troca, só uma resposta é criada.
- A referência e o snapshot de e-mail e embalagens ficam na solicitação, então o reenvio por qualquer adaptador manda o mesmo conteúdo.

## Coexistência (cuidados)

- **Nunca** os dois adaptadores enviando no mesmo canal. A flag escolhe um.
- E-mail de entrada: é possível ligar os dois por algumas horas, porque a idempotência protege. A chave do job (Message-ID) é o mesmo `mensagemId` que o n8n enviava. O padrão, porém, é desativar o trigger IMAP do n8n ao ligar o nativo: o n8n marca os e-mails como lidos (o job nativo não, mas também não depende disso).
- As migrations são aditivas; o rollback não exige desfazer o schema.

## Desligamento definitivo (Fase 5)

Depois de 2 semanas estáveis por canal: desativar (não apagar) o workflow, manter o backup e remover as flags e o adaptador n8n só num commit separado, autorizado.
