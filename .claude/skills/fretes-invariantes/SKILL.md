---
name: fretes-invariantes
description: Conhecimento de fundo sobre as invariantes de negócio do módulo de cotação de fretes deste projeto (src/fretes/**, tests/fretes/**, e integrações com n8n, Braspress e YCloud). Use SEMPRE que for analisar, planejar ou editar qualquer coisa nesse módulo — mesmo mudanças que pareçam pequenas, como ajustar um campo de webhook, mexer na resolução de e-mail de transportadora, tocar em status de proposta/solicitação, ou alterar o payload enviado ao n8n/YCloud. Também se aplica a discussões sobre aprovação automática de proposta, idempotência de mensagemId/wamid, ou qualquer coisa envolvendo a Omie a partir deste módulo. Não é preciso o usuário pedir por nome — carregue esta skill sempre que a tarefa tocar esses arquivos ou esses conceitos.
---

# Invariantes do módulo de fretes

Este módulo carrega risco desproporcional ao seu tamanho: ele fala com transportadoras reais, dispara mensagens de WhatsApp reais via YCloud, e é uma das áreas críticas do sistema que integra com a Omie, sempre em modo somente leitura. As regras abaixo não são estilo de código — são decisões de produto e de segurança já tomadas e implementadas. A fonte oficial é `CLAUDE.md` na raiz do repositório (seções "Regras de segurança" e "Regras do módulo de fretes"); esta skill existe para trazer esse conhecimento para o primeiro plano automaticamente, sem depender de o usuário lembrar de mencionar `CLAUDE.md` a cada pedido.

Se `CLAUDE.md` for editado no futuro e divergir do que está aqui, `CLAUDE.md` vence — trate esta skill como um resumo operacional dele, não como a fonte de verdade.

## Por que isso importa

Cada invariante abaixo existe porque uma alternativa mais "conveniente" foi deliberadamente rejeitada no design do sistema. Por exemplo: seria mais simples aprovar uma proposta automaticamente quando a confiança da extração é alta, mas isso tira o humano do loop numa decisão financeira que afeta o custo de venda. Entender o *porquê* ajuda a reconhecer quando uma mudança pedida esbarra numa dessas decisões, mesmo que o pedido não mencione a regra explicitamente.

## As invariantes

**Omie é somente leitura.** Nenhuma função nova pode escrever na Omie — nem criar, nem atualizar, nem excluir nada por lá. Se uma tarefa parecer precisar de escrita na Omie, isso é um sinal de que algo no design da tarefa está errado; não implemente um jeito de contornar isso.

**Proposta de frete nunca é aprovada automaticamente.** Toda proposta criada a partir de uma resposta de transportadora nasce com status `PENDENTE_VALIDACAO`, mesmo quando a extração tem confiança altíssima. Só um humano, através do fluxo de confirmar/corrigir e confirmar, tira a proposta desse estado. Isso vale mesmo que a "correção" humana seja nula (nada mudou) — a ação de confirmar ainda precisa acontecer.

**Nunca inferir valor de frete ausente.** Se a extração não trouxe `valorFrete`, nenhuma proposta é criada — só a extração/resposta ficam registradas para revisão manual depois. Não é aceitável "estimar" ou "assumir" um valor a partir de outros campos (pedágio, GRIS, ad valorem, taxas) para preencher essa lacuna.

**Idempotência por `mensagemId`.** Uma resposta de transportadora processada pelo mesmo `mensagemId` nunca gera uma segunda resposta/extração/proposta — o sistema detecta a duplicata e devolve o resultado já existente. Qualquer mudança no fluxo de webhook de resposta precisa preservar essa checagem.

**Idempotência/correlação por `wamid`.** O registro de envio outbound via WhatsApp/YCloud é idempotente por `wamidOutbound`; a correlação de um reply recebido usa o `context.id` (`contextoReplyId`) para achar a solicitação original, sem nunca "adivinhar" uma correlação quando o WAMID não foi registrado antes (nesse caso a resposta correta é `correlacionado: false`, explícito).

**Resolução de e-mail de destino: MANUAL > CADASTRO > OMIE > bloqueio, nessa ordem, sempre.**
- **MANUAL**: override informado para aquela solicitação específica da cotação — sempre vence e vale só para ela (nunca grava no cadastro nem na Omie). Um e-mail manual malformado é rejeitado explicitamente, nunca ignorado silenciosamente para cair no próximo passo da cascata.
- **CADASTRO**: na ausência de manual, o "E-mail para cotação" da transportadora no cadastro ETK (campo `email` de `transportadoras`).
- **OMIE**: fallback, só quando não há MANUAL nem CADASTRO válidos — cadastro da transportadora na Omie via `codigoClienteOmie` (somente leitura).
- Se nenhuma fonte fornecer e-mail válido, a operação é bloqueada com erro explícito (`EMAIL_TRANSPORTADORA_NAO_CADASTRADO`) — nunca um fallback silencioso, nunca um e-mail "chutado" ou genérico.
- A origem efetivamente usada é registrada na solicitação em `email_origem` como `MANUAL`, `CADASTRO` ou `OMIE` (junto do snapshot em `email_destino`) — nunca rotular um e-mail do cadastro como MANUAL, nem o contrário.

**Webhooks mantêm validação estrita.** Todo campo de entrada é validado por tipo, tamanho e enum antes de tocar o banco — nada é aceito "no melhor esforço". Um payload malformado ou com versão de contrato não suportada deve lançar erro explícito (400), nunca ser interpretado parcialmente.

**Contratos de webhook são versionados e testados.** Mudar um contrato de webhook (campos aceitos, formato, obrigatoriedade) exige teste correspondente em `tests/fretes/`. Uma mudança breaking exige decisão explícita sobre a versão do contrato (ex.: `VERSAO_CONTRATO_WEBHOOK`) — não é algo para decidir sozinho sem apontar a trade-off para quem pediu a mudança.

**Toda mudança relevante de estado é auditável.** Criação de solicitação, envio ao n8n (sucesso ou erro), recebimento de resposta, criação de proposta, validação/correção de proposta, registro de WAMID outbound, consulta de correlação — tudo isso já passa por `registrarAuditoria`. Uma mudança que adiciona uma nova transição de estado sem registrar auditoria está incompleta.

**Payload outbound nunca expõe dado comercial interno.** O que é enviado para o n8n (e por extensão para a transportadora ou para mensagens de WhatsApp) contém só dados logísticos — origem, destino, peso, volumes, referência. Margem, custo de produto, markup ETK, valor de venda e qualquer credencial não pertencem a esse payload, mesmo que "seria conveniente" incluir para depuração.

**As três modalidades de execução são distintas e não se misturam.** `TRANSPORTADORA`, `VEICULO_PROPRIO` e `RETIRA` têm regras próprias (por exemplo, solicitação de cotação a transportadora só faz sentido para `TRANSPORTADORA`). Uma mudança pensada para uma modalidade não deve vazar comportamento para as outras sem que isso seja intencional e explícito.

**Snapshot de e-mail e regras de fechamento existentes são preservados.** O e-mail resolvido para uma solicitação (`emailDestino`/`emailOrigem`) é um snapshot gravado no momento da solicitação — ele não deve passar a ser recalculado dinamicamente a partir do estado atual da transportadora sem decisão explícita, porque isso quebraria a auditabilidade histórica de qual e-mail foi realmente usado.

## Como aplicar isso ao trabalhar na tarefa

**Antes de propor ou editar algo:** liste mentalmente (ou explicitamente, se a mudança for não-trivial) quais das invariantes acima a tarefa toca. A maioria das tarefas nesse módulo toca pelo menos uma, mesmo quando o pedido parece só sobre UI ou sobre um campo extra.

**Durante a implementação:** se o caminho mais direto para atender o pedido violaria uma invariante — por exemplo, aprovar automaticamente quando a confiança é alta, ou usar um e-mail "provável" quando nem manual, nem cadastro, nem Omie estão disponíveis — não implemente esse caminho. Proponha a alternativa que preserva a invariante, ou explique o conflito e pergunte como prosseguir.

**Depois da mudança:** releia o diff especificamente procurando por violações: uma nova escrita na Omie, uma proposta saindo de `PENDENTE_VALIDACAO` sem ação humana, um valor inferido, uma checagem de idempotência removida ou enfraquecida, um payload outbound carregando um campo que não deveria estar lá, uma transição de estado sem `registrarAuditoria`.

**Exija teste quando a mudança tocar:** regra de negócio do módulo, contrato de webhook, idempotência/correlação (mensagemId ou wamid), aprovação/validação de proposta, ou qualquer integração externa (n8n, Braspress, YCloud, Omie). Se a mudança se encaixa em uma dessas categorias e não há teste cobrindo o comportamento novo ou alterado, isso é uma lacuna a apontar antes de considerar a tarefa concluída — não depois.

**Na dúvida, pare.** Se não estiver claro se uma regra específica se aplica a uma situação nova (por exemplo, um caso de borda que nenhuma invariante acima cobre explicitamente), não infira a resposta que parece mais razoável e siga em frente. Pergunte. O custo de uma pergunta é baixo; o custo de uma suposição errada num módulo que fala com transportadoras e dispara WhatsApp reais não é.

## Fora de escopo para esta skill

Esta skill é sobre invariantes de negócio, não sobre estilo de código, convenções de nomenclatura ou arquitetura geral do projeto (essas estão em `CLAUDE.md`, se aplicável). Também não é um mandato para adicionar validações, testes ou auditoria extras em áreas que a tarefa não pediu — o objetivo é impedir violações das regras já existentes, não expandir escopo por conta própria.
