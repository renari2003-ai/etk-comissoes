# CLAUDE.md

Fonte principal de regras operacionais deste projeto. Leia antes de qualquer alteração.

## Arquitetura

- Backend: Node.js + Express + TypeScript (`strict`, ESM/NodeNext), compilado com `tsc` puro (sem bundler) para `dist/`.
- Banco: PostgreSQL/Supabase via `pg` (`src/db.ts`).
- Frontend: TypeScript vanilla (`public-src/*.ts` → `public/*.js`) + CSS puro, sem framework.
- Testes: Vitest, espelhando a estrutura de `src/` em `tests/`.
- Deploy: Vercel (`vercel.json`).
- Omie: integração **somente leitura** (app key/secret devem ter permissão apenas de consulta).
- Integrações externas do módulo de fretes: **n8n** (outbound/inbound de cotações), **Braspress** (API oficial de cotação), **YCloud** (WhatsApp, correlação de mensagens).

## Regras de segurança

- Nunca ler, imprimir, copiar ou alterar valores reais de `.env`. `.env.example` pode ser lido/editado normalmente.
- Nunca expor secrets, tokens ou credenciais (Omie, `FRETES_WEBHOOK_SECRET`, `N8N_WEBHOOK_SECRET`, Braspress, `DATABASE_URL`) em código, logs, mensagens ou commits.
- Nunca executar escrita na Omie — apenas consultas. Nenhum novo endpoint/método de escrita deve ser criado ou sugerido.
- Nunca fazer deploy sem autorização explícita do usuário.
- Nunca fazer commit ou push sem autorização explícita do usuário.
- Nunca instalar ou atualizar dependências sem autorização explícita.
- Migrations só podem ser executadas com autorização explícita.

## Regras do módulo de fretes (`src/fretes/**`)

- Nunca aprovar proposta de frete automaticamente — toda proposta nasce `PENDENTE_VALIDACAO` e só sai desse estado por ação humana explícita (confirmar/corrigir e confirmar).
- Nunca inferir valores ausentes (ex.: sem `valorFrete` extraído, não criar proposta — só registrar extração/resposta para revisão manual).
- Preservar idempotência por `mensagemId` (respostas de cotação) e por `wamid` (correlação WhatsApp/YCloud) — nunca duplicar processamento da mesma mensagem.
- Resolução de e-mail de destino segue sempre a ordem fixa: **MANUAL > CADASTRO > OMIE > bloqueio**. Nunca inventar e-mail nem usar fallback genérico/silencioso.
  - **MANUAL**: override informado para aquela solicitação específica da cotação (vale só para ela; nunca grava no cadastro nem na Omie). Manual preenchido mas malformado é rejeitado explicitamente, nunca ignorado.
  - **CADASTRO**: "E-mail para cotação" da transportadora no cadastro ETK (coluna `email` de `transportadoras`).
  - **OMIE**: fallback, só quando não houver MANUAL nem CADASTRO válidos (cadastro Omie via `codigoClienteOmie`, somente leitura).
  - Se nenhuma fonte fornecer e-mail válido, o envio é bloqueado com erro explícito (`EMAIL_TRANSPORTADORA_NAO_CADASTRADO`).
  - A origem efetivamente usada é gravada/auditada na solicitação (`email_origem`) como `MANUAL`, `CADASTRO` ou `OMIE`, junto do snapshot do e-mail (`email_destino`).
- Payloads de webhook (entrada e saída) devem continuar estritamente validados por tipo/tamanho/enum — nunca aceitar "melhor esforço"; payload malformado deve lançar erro explícito (400).
- Alterações em contratos de webhook (`webhookCotacoes.ts` e correlatos) devem ter testes correspondentes em `tests/fretes/`, e mudanças breaking devem atualizar a versão do contrato.
- Toda mudança relevante de estado no módulo de fretes deve continuar auditável via `auditoriaRepositorio.ts`.
- Integrações outbound (ex.: payload enviado ao n8n) não devem expor margem, custo de produto, markup ETK, valor de venda ou credenciais — só dados logísticos necessários para cotar.
- Preservar as regras já existentes de transportadora, veículo próprio e retira (modalidades de execução da cotação) sem alterar o comportamento sem revisão explícita.

## Frontend

- Preservar TypeScript vanilla + CSS puro.
- Não introduzir React, Tailwind ou qualquer framework/lib de UI novo sem autorização explícita.
- Alterações de UI não podem mudar regra de negócio sem aprovação — UI é apresentação, não decisão.

## Testes e validação

Antes de considerar qualquer alteração concluída:

1. Type-check (`tsc -p tsconfig.json --noEmit` e, se frontend foi tocado, `tsconfig.frontend.json`).
2. Build (`npm run build`).
3. Vitest (`npm test`).
4. Verificar `git diff` do que foi alterado.
5. Verificar a lista de arquivos alterados (nada fora do escopo pedido).
6. Verificar se `.env` foi tocado (não deve ter sido).
7. Verificar se a integração Omie continua somente leitura (nenhuma chamada de escrita introduzida).

## Modo de trabalho

Para mudanças relevantes:

1. Analisar o pedido e o código afetado.
2. Propor um plano antes de implementar.
3. Implementar somente após autorização quando houver risco estrutural (mudança de contrato, schema, integração externa, regra de negócio do módulo de fretes).
4. Validar (ver seção "Testes e validação").
5. Apresentar diff/resumo da mudança.
6. Aguardar autorização explícita antes de commit ou push.
