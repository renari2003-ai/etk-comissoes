---
tags: [arquitetura, fretes, homologacao]
atualizado: 2026-10-02
---

# Plano de Homologação

Parte de [[Migração n8n para Backend ETK]].

**Transportadora de teste:** a própria ETK, cadastrada como transportadora comum (sem exceção no código), com e-mail para cotação = caixa de teste e WhatsApp de teste.

**Regra geral:**
- testes automatizados sem banco real (mocks, como em `tests/fretes/embalagensSolicitacao.test.ts`);
- homologação manual em produção com a flag do canal ligada só durante o teste ou apontando para a transportadora de teste;
- nada de teste automatizado contra o banco de produção.

## Fase 1: e-mail de saída (SMTP)

**Situação (2026-10-02):** publicado em produção (`f4adedb`) com `SMTP_*` e `FRETES_EMAIL_OUTBOUND=smtp` na Vercel. Testes automatizados verdes. **A homologação manual abaixo ainda não foi feita.** O cenário 1.6 não é possível enquanto o trial do n8n estiver expirado.

| # | Cenário | Esperado |
|---|---|---|
| 1.1 | Envio com 2 tipos de embalagem | e-mail chega; assunto `Cotação de Frete ETK \| <ref>`; 2 linhas de embalagem; status `ENVIADA` |
| 1.2 | Senha SMTP errada (variável de teste) | `ERRO` com motivo sanitizado, sem senha; tela mostra mensagem amigável |
| 1.3 | Reenviar após 1.2 corrigido | mesma solicitação, mesma referência, `tentativas` +1, auditoria |
| 1.4 | E-mail MANUAL / CADASTRO / OMIE | `email_origem` correto em cada caso |
| 1.5 | Conteúdo | sem margem, custo, markup ou valor de venda no HTML e no texto |
| 1.6 | Flag `n8n` | volta a enviar pelo n8n sem deploy de código |

## Fase 2: e-mail de entrada (IMAP + cron)

**Situação (2026-10-02):** implementado, sem commit/deploy. São 50 testes automatizados novos (parser, leitura MIME, job, cliente IMAP), sem banco e sem servidor real.

**Antes do deploy:**
1. Cadastrar `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` (e, se precisar, `IMAP_PORT`/`IMAP_MAILBOX`) e `FRETES_JOB_SECRET` em Production.
2. Fazer deploy e rodar o job **manualmente** (comando em [[Jobs e Polling]]) para os cenários abaixo.
3. Só depois escolher e ligar o agendador de 5 min.


| # | Cenário | Esperado |
|---|---|---|
| 2.1 | Resposta completa (`VALOR_FRETE: 1.500,00`, prazo, validade) | proposta `PENDENTE_VALIDACAO` com 1500; solicitação `RESPONDIDA` |
| 2.2 | Mesma resposta processada de novo (reset do cursor) | nada novo criado |
| 2.3 | E-mail aberto no webmail antes do job | ainda processado |
| 2.4 | Resposta sem `VALOR_FRETE` | extração `REQUER_REVISAO`, sem proposta |
| 2.5 | Resposta sem referência no assunto, mas com `In-Reply-To` | correlacionada pelo Message-ID de saída |
| 2.6 | E-mail sem relação (newsletter) | ignorado, nada gravado |
| 2.6b | Resposta sem referência nenhuma | `REVISAO_MANUAL` com o texto guardado; aparece em `GET /api/fretes/emails-resposta/revisao` |
| 2.6c | `VALOR_FRETE: 1500.00` e `1,500.00` | 1500 (nunca 150000) |
| 2.7 | `VALOR_FRETE: 1.500` (ambíguo) | revisão manual, nunca 1,5 nem 1500 |
| 2.8 | Resposta só em HTML | extraída corretamente |
| 2.9 | Fluxo comercial depois de confirmar | frete base = valor recebido; mínimo com PIS/COFINS/ICMS; final = base + acréscimo |

## Fases 3 e 4: WhatsApp

**Situação (2026-10-02):** implementado, sem commit/deploy. São 26 testes automatizados novos (cliente YCloud, envio, webhook, assinatura, correlação, idempotência), sem banco e sem YCloud real.

**Antes do deploy:**
1. Cadastrar `YCLOUD_API_KEY`, `YCLOUD_WHATSAPP_FROM`, `YCLOUD_WEBHOOK_SECRET` (e, se houver, `YCLOUD_TEMPLATE_NOME`) em Production.
2. Na YCloud, criar o endpoint `https://etk-comissoes.vercel.app/api/fretes/integracoes/ycloud/webhook` com os eventos `whatsapp.inbound_message.received` e `whatsapp.message.updated`, e guardar o `secret`.
3. Se a transportadora de teste não tiver falado com o número nas últimas 24h, é necessário o template aprovado.


| # | Cenário | Esperado |
|---|---|---|
| 3.1 | Envio para número de teste | mensagem recebida; `wamid_outbound` gravado; `ENVIADA` |
| 3.2 | Número inválido | bloqueado antes do envio |
| 3.3 | Erro da API YCloud | `ERRO` sanitizado; Reenviar funciona |
| 4.1 | Reply à mensagem | correlacionada por `context.id`; proposta `PENDENTE_VALIDACAO` |
| 4.2 | Webhook repetido 3x | 1 resposta só |
| 4.3 | Mensagem nova (não reply) | `correlacionado: false`; revisão |
| 4.4 | Webhook com assinatura inválida | 401, nada gravado |

## Saída de cada fase

Fase aprovada quando todos os cenários passam. Depois, a flag fica ligada em produção por **2 semanas** com o n8n do canal **desativado, mas não apagado**, antes da próxima fase. Ver [[Rollback n8n]].
