---
tags: [arquitetura, comissionamento, omie, tabela-de-precos]
atualizado: 2026-10-06
---

# Comissão por Tabela de Preços

Regra de comissão normal **por produto**, a partir das tabelas de preço da Omie. Substitui a antiga regra pela margem global do pedido. Código: `src/comissionamento/comissaoPorTabela.ts`. Leitura na Omie (somente consulta): `ListarTabelasPreco` + `ListarTabelaItens` (`src/omie/cliente.ts` → `listarTabelasPreco`).

## Regra

| Tabela (código comercial) | Regra |
|---|---|
| **001** | Comissão fixa de 1% (não usa preço) |
| **002** | Custo de referência = Preço da Tabela ÷ **1,75** |
| **003** | Custo de referência = Preço da Tabela ÷ **1,90** |
| Qualquer outra | **Sem regra** → pedido fica fora da apuração até ser configurada explicitamente no código |

Nas tabelas 002 e 003:

- multiplicador realizado = preço unitário vendido após descontos ÷ custo de referência
- acréscimo (%) = (multiplicador realizado − 1) × 100
- comissão normal: abaixo de 70% → 1%; de 70% até abaixo de 90% → 1 + (acréscimo − 70) × 0,10; 90% ou mais → 3%

Depois, por item: + 1 ponto percentual para os vendedores com adicional já configurados (Sandro, Horacio, Roberto Rocha), inclusive na tabela 001 (1% + 1 = 2%). Renato Pinto: 4% fixo sobre o pedido inteiro, sem consultar tabela. Comissão do pedido = soma dos itens; base do item = valor de mercadoria − desconto.

"Preço da Tabela" = coluna da tela da Omie (Configurações → Venda de Produtos → Tabelas de Preço dos Produtos → Produtos da Tabela de Preço), campo `nValorTabela` da API. Nunca o "Preço Original" nem o preço do cadastro do produto.

## Qual tabela vale para o item

1. `codigo_tabela_preco` do item = ID interno (`nCodTabPreco`) de uma tabela **ativa** que contém o produto.
2. Ou = código comercial (ex.: 3 → "003") de uma tabela ativa que contém o produto.
3. Sem correspondência válida: a **única** tabela ativa que contém o produto.
4. Zero ou várias tabelas possíveis, tabela inativa, ou tabela sem regra → exceção. Nunca há escolha arbitrária.

Na prática, a Omie grava `codigo_tabela_preco = 2` (ou `1`) em itens de produtos das três tabelas. Por isso o passo 3 resolve a maioria dos pedidos (ex.: pedido 207 → tabela 003).

## Referência de preço (decisão de 2026-10-06)

Nesta fase as tabelas estão **fixas**. A apuração usa o **preço ATUAL da tabela ativa** como referência, inclusive para pedidos anteriores. A API da Omie **não tem histórico de preços**, então essa referência **não é preço histórico comprovado**. As datas de alteração do item e da tabela são exibidas só como informação e não bloqueiam a apuração.

A composição de cada item, visível só para administradores, registra a tabela usada (ID e código), o Preço da Tabela, o multiplicador, o custo de referência, o momento da consulta à Omie (`precoConsultadoEm`), o momento da apuração (`apuradoEm`) e a indicação `PRECO_ATUAL_TABELA_ATIVA`.

**Consequência:** se um preço mudar, toda apuração feita depois disso, inclusive de vendas antigas, passa a usar o preço novo. Hoje não existe registro permanente do preço usado em cada apuração: o cache dura 10 minutos e a resposta da tela não fica guardada. Ver "Snapshot (proposta, não implementada)".

## Orientação ao responsável pelas tabelas na Omie

Comunique **antes** de novas apurações de comissão:

- **Mudança significativa de preço** em qualquer item das tabelas 002 ou 003. Ela muda a comissão de todas as vendas desse produto apuradas depois, inclusive as antigas.
- **Desativação** de uma tabela. Os itens dela deixam de ter tabela e os pedidos vão para exceção.
- **Substituição** de uma tabela, por exemplo uma nova "TABELA DE VENDA - 10/26". Uma tabela nova não herda a regra pelo nome: o código comercial dela precisa ser configurado, e o produto não pode ficar em duas tabelas ativas.
- **Criação** de tabela, ou inclusão de um produto em mais de uma tabela ativa. Isso gera ambiguidade e exceção.
- **Preço zerado** em item das tabelas 002 ou 003. O pedido fica fora da apuração.

Depois de corrigir um preço, o sistema leva até **10 minutos** para enxergá-lo (cache `tabelas-preco`). A invalidação pontual desse cache existe em `ClienteOmie.limparCacheTabelasPreco()`. O botão geral "Limpar cache" da tela invalida tudo.

## Exceções (pedido inteiro fora da apuração)

Os motivos possíveis são `TABELA_NAO_IDENTIFICADA`, `TABELA_AMBIGUA`, `TABELA_INATIVA`, `PRODUTO_FORA_DA_TABELA_INFORMADA`, `TABELA_SEM_REGRA`, `PRECO_TABELA_AUSENTE` (zero, ausente ou inválido, só nas tabelas 002 e 003) e `ITEM_INVALIDO`. Cada exceção mostra produto, tabela e motivo, sem preço nem custo. O pedido nunca aparece com comissão zero.

## Snapshot (proposta, não implementada)

O único armazenamento persistente hoje é o cache Omie (`omie_cache`, com TTL), que não serve como histórico. Para congelar o preço usado em cada apuração, seria preciso:

- uma tabela nova, por exemplo `comissao_apuracao_referencia`, com: numero_pedido, codigo_produto, tabela_id, tabela_codigo, preco_tabela, multiplicador, custo_referencia, consultado_em, apurado_em, usuario;
- gravação apenas quando um administrador "fechar" uma apuração;
- leitura desse snapshot nas reapurações daquele pedido.

Isso exige migration e decisão de negócio (quem fecha, quando reabre). **Não executar sem autorização.**
