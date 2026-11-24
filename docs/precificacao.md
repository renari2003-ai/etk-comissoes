# ETK – Formação de Preço de Venda (Especificação)

Nov 24, 2026 · @Ricardo

## Objetivo e escopo

Uma nova tela no app ETK Comissão: o usuário digita o código do produto, escolhe o cliente e recebe o **preço de venda sugerido**, já calculado sobre a carga tributária real da ETK (Lucro Real + regime especial de ICMS em MG).

**Dentro do escopo**

- Custo do produto a partir da estrutura no Omie (componentes + GGF).
- Limpeza do custo: retira os impostos recuperáveis (PIS/COFINS e IPI) e mantém o ICMS que é custo.
- Preço por cenário de venda (MG autorizado, MG não autorizado, outra UF, não contribuinte com DIFAL).
- Faixa de negociação: **preço piso** e **preço cheio**, com margem antes e depois do IR/CS.
- Modo reverso: preço-alvo → margem real.
- Tabela fiscal editável, sem precisar mexer no código.
- Custo manual por item da estrutura (e do GGF) quando o Omie não tiver custo ou o custo estiver errado — ver "Custo manual".

**Fora do escopo (nesta versão)**

- Gravar o preço no Omie ou gerar o orçamento automaticamente.
- Frete, que pode vir depois da automação de cotação de frete.

## Premissas tributárias da ETK

Todas as regras abaixo foram confirmadas pelo Ricardo e pelo fiscal da ETK; cada percentual fica editável na tabela fiscal.

| Tema | Regra |
| --- | --- |
| Regime | Lucro Real |
| PIS/COFINS | Não cumulativo, 1,65% + 7,6% = 9,25%. Crédito na compra de insumos, débito na venda. ICMS excluído da base do débito (Tema 69 do STF) e da base do crédito (lei de 2023). |
| IPI | Recuperável na compra (ETK é indústria). Na venda, calculado sobre o preço e somado por fora, pela alíquota do NCM no cadastro. |
| ICMS na compra | **Sempre é custo, nunca crédito.** MG para industrialização com diferimento do PTA: 0%. MG sem diferimento: alíquota interna (padrão 18%, editável). Fora de MG: 12% de qualquer UF (4% se a mercadoria for importada). O percentual só serve para tirar o ICMS da base do crédito de PIS/COFINS (ver "Impostos na compra"). |
| IPI na compra | Recuperável. Sai da nota de entrada do Omie quando existe; sem nota, depende do tipo de fornecedor (ver "Impostos na compra"). |
| ICMS na venda | Pelo regime especial, a ETK **não recolhe** o ICMS destacado: ele vira resultado. Vale para venda interestadual e para venda dentro de MG a cliente não autorizado. |
| Cliente de MG autorizado | Cliente industrializador autorizado pela Delegacia Fiscal de MG: nota sai sem ICMS, e a ETK pode repassar como desconto. |
| DIFAL | Venda para não contribuinte (ou uso e consumo) em outra UF: o DIFAL é pago ao estado de destino e **continua sendo custo**. |
| Ganho do ICMS em IRPJ/CSLL | É receita tributável: entra no lucro e paga cerca de 34% (IRPJ 15% + adicional 10% + CSLL 9%). |
| Ganho do ICMS em PIS/COFINS | **Não** entra na base, por decisão favorável obtida em 2025. Fica como chave liga/desliga na tabela fiscal. |

## Fontes de dados (API do Omie)

Todo dado vem do Omie pela API que o app já usa; os nomes de endpoint abaixo são a referência inicial e devem ser conferidos na documentação do Omie durante o desenvolvimento.

| Dado | Para que serve | Endpoint de referência |
| --- | --- | --- |
| Produto acabado: código, descrição, NCM, alíquota de IPI, origem | Alíquota de IPI na venda; origem define o ICMS de 4% para conteúdo importado | `geral/produtos` – ConsultarProduto |
| Estrutura do produto: componentes, quantidades, unidade, % de perda | Montar o custo, como no relatório "Imprimir Estrutura" | `geral/malha` – ConsultarEstrutura (endpoint confirmado na documentação em 24/11/2026) |
| GGF do produto acabado | Somado ao custo bruto | `geral/malha` – `custoProducao.vGGF` (ConsultarEstrutura) ou `nValorGGF` (ConsultarDadosProducao) — **campo exato em validação** |
| Custo unitário dos componentes | Custo bruto (com impostos) | A estrutura **não traz custo por item**. Hipótese: `nCMC` da posição de estoque (`estoque/consulta` – ListarPosEstoque) — **em validação** com o PA00000001 pela rota temporária de diagnóstico |
| Última nota de entrada de cada componente: UF do fornecedor, ICMS, IPI, PIS, COFINS | Saber se veio de dentro ou de fora de MG e quanto retirar de crédito | `produtos/recebimentonfe` – ListarRecebimentos |
| Cliente: UF, inscrição estadual, contribuinte, campo "autorizado diferimento MG" | Escolher o cenário de venda | `geral/clientes` – ConsultarCliente |

**Regra de fallback:** componente sem nota de entrada no Omie aparece marcado na tela como "estimado", e os créditos saem das regras de "Impostos na compra" (tipo de fornecedor, UF e cadastro do componente), nunca de um percentual médio.

**Cadastro do componente (`geral/produtos` – ConsultarProduto):** NCM e alíquota de IPI de cada componente, usados no IPI da compra sem nota. Componente sem NCM ou sem alíquota de IPI (com fornecedor indústria normal) entra **pelo valor bruto, sem crédito**, e deixa o preço **incompleto** (ver "Relatório de conferência do cadastro").

**Validação da fonte de custo (24/11/2026):** relatório do PA00000001 (CEO SOFS 12/24 FO 4D): Valor GGF R$ 59,76; PI10000014 0,192111; MP00000008 17,06279; MO00000013 5,238053; MO00000037 e MP00000045 sem custo unitário. A rota temporária `GET /api/precificacao/diagnostico/:codigo` (só administrador, só leitura, **removida antes de produção**) mostra de qual campo da API sai cada número. Se o custo dos itens for o `nCMC`, a decisão de usá-lo volta ao usuário antes de seguir, porque o código atual o considera pouco confiável (ver `src/calculo/custoEstimado.ts`).

## Custo manual

O Omie ainda é novo na ETK e parte dos componentes vem sem custo. Por isso todo item da estrutura, e também o GGF, aceita custo manual.

**Origem do custo por item.** Cada linha da estrutura mostra uma de três origens: **Omie**, **Manual** ou **Sem custo**. Item sem custo aparece destacado, já com o campo para digitar.

**Digitar ou corrigir.** O operador pode digitar o custo de qualquer item, mesmo os que têm custo do Omie, e o GGF. Ao confirmar, escolhe:

- **Só nesta simulação:** vale para o cálculo atual (e fica gravado na simulação, se for salva), sem afetar os próximos cálculos.
- **Salvar para próximos cálculos:** grava na tabela de custos manuais e passa a ter **prioridade sobre o Omie**.

**Formulário do custo manual.** O custo é digitado como aparece na nota de compra, **com impostos**. Campos:

| Campo | Regra |
| --- | --- |
| Valor da nota (unitário, com impostos) | Obrigatório, maior que zero |
| UF do fornecedor | Obrigatório; define o ICMS da compra |
| Compra com diferimento PTA? | **Só aparece se a UF for MG**. Sim → ICMS 0%; Não → alíquota interna de MG da tabela fiscal (padrão 18%) |
| Mercadoria importada? | **Só aparece se a UF não for MG**. Sim → ICMS 4%; Não → 12% (entrada em MG vinda de qualquer UF) |
| Tipo de fornecedor | Indústria normal (Lucro Real/Presumido), Simples Nacional ou comércio/distribuidor |
| IPI % | **Indústria normal:** já preenchido com a alíquota do NCM no cadastro do componente no Omie, editável; sem NCM/IPI no cadastro, vem vazio e, se ficar vazio, o item entra pelo valor bruto, sem crédito (preço incompleto). **Simples Nacional:** travado em 0, campo desabilitado. **Comércio/distribuidor:** começa em 0, editável, com a dica "só se a nota destacar IPI (ex.: distribuidor de importado equiparado a indústria)" |

Os créditos saem pelas regras de "Impostos na compra", as mesmas usadas para item estimado.

**Item estimado** (tem custo no Omie, mas não tem nota de entrada): o operador informa a UF do fornecedor, o diferimento PTA ou a mercadoria importada, e o tipo de fornecedor. Esses dados ficam salvos na tabela de custos manuais, **sem trocar o custo do Omie**, para não ser preciso informar de novo a cada cálculo.

**Conflito com o Omie.** Se um item com custo manual salvo passar a ter custo no Omie, a tela mostra os dois valores e o operador escolhe qual usar. Até ele escolher, vale o manual (regra de prioridade).

**Preço incompleto.** Se algum item continuar sem custo, o preço é calculado mesmo assim (o item entra com custo zero) e a tela mostra em destaque **"Preço incompleto: X itens sem custo"**. A simulação salva registra essa condição.

**Rastreabilidade.** A simulação salva guarda, item a item, o custo usado, a origem (Omie, Manual salvo, Manual só da simulação, Sem custo), a UF do fornecedor, o diferimento PTA, o tipo de fornecedor, as alíquotas de IPI e ICMS usadas e os créditos retirados, para a conta poder ser reconstruída depois, mesmo que o Omie ou a tabela de custos manuais mudem.

**Tabela de custos manuais.** Código do componente (ou do produto acabado, para o GGF), valor da nota com impostos (vazio quando o registro só guarda os dados fiscais de um item estimado), UF do fornecedor, diferimento PTA (S/N, só MG), mercadoria importada (S/N, só fora de MG), tipo de fornecedor, IPI %, data e usuário. Toda alteração vai para um histórico com data, usuário, valor anterior e valor novo. Fica no banco do app, **nunca** é gravada no Omie.

## Impostos na compra (créditos do custo)

**ICMS na compra — sempre custo, nunca crédito.** O percentual só é usado para tirar o ICMS da base do crédito de PIS/COFINS.

| Compra | ICMS |
| --- | --- |
| MG, para industrialização, com diferimento do PTA | 0% |
| MG sem diferimento | alíquota interna de MG (padrão 18%, editável na tabela fiscal) |
| Fora de MG | 12% de qualquer UF; 4% para mercadoria importada. (Os 7% só existem na **venda** de MG para Norte, Nordeste, Centro-Oeste e ES.) |

Com nota de entrada no Omie, vale o ICMS destacado na nota.

**IPI na compra — nesta ordem:**

1. **Com nota de entrada no Omie:** o IPI da nota.
2. **Sem nota** (custo manual ou item estimado): o operador informa o tipo de fornecedor.
   - **Indústria normal (Lucro Real/Presumido):** alíquota de IPI do NCM no cadastro do componente no Omie.
   - **Simples Nacional:** IPI = 0, sempre (campo travado).
   - **Comércio/distribuidor:** IPI = 0, salvo se a nota destacar IPI (campo editável).
   - **Componente sem NCM/IPI no cadastro** (e fornecedor indústria normal, sem IPI informado): o item entra **pelo valor bruto, sem crédito nenhum**, e o preço fica **incompleto** (decisão de 24/11/2026: conservador, o preço sai alto, nunca baixo).

**Conta por item** (valor da nota V com impostos, alíquotas de IPI e ICMS da compra):

- Valor dos produtos: `vProd = V ÷ (1 + IPI)`
- IPI (crédito): `V − vProd`
- ICMS (fica no custo): `vProd × ICMS`
- PIS/COFINS (crédito): `9,25% × (vProd − ICMS)`
- **Custo líquido** = `V − IPI − PIS/COFINS` = `vProd − PIS/COFINS`

Exemplos com V = R$ 112,00 e IPI 12% (vProd = R$ 100,00, IPI = R$ 12,00):

| Compra | ICMS | PIS/COFINS | Custo líquido |
| --- | --- | --- | --- |
| MG com diferimento PTA | R$ 0,00 | 9,25% × 100,00 = R$ 9,25 | R$ 90,75 |
| MG sem diferimento (18%) | R$ 18,00 | 9,25% × 82,00 = R$ 7,585 | R$ 92,415 (sem arredondar no meio da conta) |
| SP, 12% | R$ 12,00 | 9,25% × 88,00 = R$ 8,14 | R$ 91,86 |
| Fornecedor Simples, MG com PTA (IPI 0, V = R$ 100,00) | R$ 0,00 | R$ 9,25 | R$ 90,75 |

A última linha mostra que, sem IPI na nota, o valor digitado já é o vProd.

A regra é a mesma para nota de entrada (com os valores destacados na nota), custo manual e item estimado. **Validar com o fiscal:** o IPI fora da base do PIS/COFINS e do ICMS (compra para industrialização).

## Relatório de conferência do cadastro

Somente leitura. Para um produto (ou para todos os produtos que têm estrutura no Omie), lista os componentes **sem NCM** ou **sem alíquota de IPI** no cadastro do Omie, para a correção ser feita lá. Colunas: produto acabado, código e descrição do componente, NCM, alíquota de IPI, problema ("sem NCM", "sem IPI"). Usa `ListarEstruturas`/`ConsultarEstrutura` e `ConsultarProduto`, com cache e pelo limitador de chamadas. A varredura de todos os produtos roda em lotes, porque cada componente custa uma chamada ao Omie. Rota prevista: `GET /api/precificacao/conferencia-cadastro?produto=` (sem `produto` = todos), só para administrador.

## Regras de cálculo

O preço sai em sete passos: custo líquido, cenário, divisor, preço cheio e piso, IPI por fora, lucro antes e depois do IR/CS e, se pedido, o modo reverso.

1. **Custo bruto** = soma de (quantidade × custo unitário) de cada componente + GGF.
2. **Custo líquido**: para cada componente, retira os créditos pelas regras de "Impostos na compra" (nota de entrada do Omie, ou tipo de fornecedor e cadastro quando não há nota).
   - PIS/COFINS: 9,25% sobre o valor dos produtos sem o ICMS.
   - IPI: o da nota; sem nota, pelo tipo de fornecedor e NCM.
   - ICMS: nada a retirar; é sempre custo.
3. **Cenário de venda** define os percentuais sobre o preço:

| Cenário | ICMS destacado | ICMS recolhido | PIS/COFINS efetivo | DIFAL |
| --- | --- | --- | --- | --- |
| A. MG, cliente autorizado | 0% | 0% | 9,25% | não |
| B. MG, cliente não autorizado | alíquota interna de MG (geral 18%, ou exceção do NCM) | 0% | 9,25% × (1 − ICMS) | não |
| C. Outra UF, contribuinte | 12%, 7% ou 4% | 0% | 9,25% × (1 − ICMS) | não |
| D. Outra UF, não contribuinte ou uso e consumo | 12%, 7% ou 4% | 0% | 9,25% × (1 − ICMS) | sim, alíquota interna do destino − interestadual |

Detalhes dos cenários (aprovados em 24/11/2026):

- **ICMS recolhido** = ICMS destacado × "percentual de recolhimento do ICMS" da tabela fiscal (0% hoje; até 100% na transição da Reforma).
- **Cliente de MG consumidor final** (não contribuinte, ou contribuinte comprando para uso e consumo, mesmo se autorizado): cenário B, com o recolhimento dado pelo parâmetro próprio "% de recolhimento do ICMS em MG para não contribuinte" (padrão 0%) e o aviso **"Confirmar com o fiscal se o ICMS é recolhido"**, até o fiscal confirmar se o PTA cobre esse caso.
- **"Autorizado diferimento MG"** só vale para cliente de MG contribuinte (industrializador); marcado para cliente de fora de MG ou não contribuinte é recusado como dado inconsistente.
- **Alíquota interna de MG na venda (cenário B):** a geral (padrão 18%) da tabela fiscal; se o NCM do produto tiver exceção cadastrada, vale a exceção.
- **Conteúdo importado** (4%) só vale para venda interestadual; dentro de MG vale a alíquota interna de MG.
- **DIFAL** nunca é negativo: alíquota interna menor que a interestadual dá DIFAL zero. O cenário D sempre mostra o aviso "DIFAL na base simples — validar com o fiscal".
- **Chave "ganho do ICMS na base de PIS/COFINS"**: desligada, PIS/COFINS efetivo = 9,25% × (1 − ICMS destacado); ligada, só o ICMS recolhido sai da base: 9,25% × (1 − ICMS destacado × recolhimento). Com recolhimento 0%, ligada dá 9,25% cheio.

4. **Preço cheio** (o ICMS destacado entra no divisor como se fosse pago; vira margem extra):

```latex
P_{cheio} = \frac{C_{liq}}{1 - (ICMS + PC_{ef} + DIFAL + Com + Desp + M)}
```

5. **Preço piso** (só o ICMS efetivamente recolhido é custo; com recolhimento 0% o termo some e vale a fórmula original):

```latex
P_{piso} = \frac{C_{liq}}{1 - (ICMS_{recolhido} + PC_{ef} + DIFAL + Com + Desp + M)}
```

   Se a soma do divisor chegar a 100% ou mais, não há preço possível e o cálculo dá erro explícito. Se só o divisor do preço cheio passar de 100%, o piso continua valendo e o cheio aparece como indisponível.

6. **IPI** = preço × alíquota do NCM, somado por fora. A tela mostra o preço sem e com IPI.
7. **Lucro** para qualquer preço P (sem IPI):
   - Antes do IR/CS = P − C\_liq − PIS/COFINS − DIFAL − comissão − despesas − ICMS recolhido (o ICMS destacado e não recolhido fica todo no lucro).
   - Depois do IR/CS = lucro antes × (1 − 34%). **Prejuízo não gera IR/CS:** com lucro antes ≤ 0, lucro depois = lucro antes (aprovado em 24/11/2026).

**Margem informada como líquida:** o sistema converte para margem antes do IR/CS dividindo por (1 − IR/CS), ou seja 0,66 hoje (10% líquido vira cerca de 15,2%). Se a conversão passar de 100%, o cálculo dá erro explicando a conversão.

**Modo reverso:** o usuário digita o preço-alvo **sem IPI** e o passo 7 devolve o lucro e as margens antes e depois do IR/CS. Se o preço-alvo ficar abaixo do piso, a tela avisa em vermelho. A comparação é feita em centavos, como aparece na tela: digitar o próprio piso exibido não gera aviso.

## Tabela fiscal editável e campos novos

Os percentuais vivem numa tabela de parâmetros, editada por uma tela de administração, para nenhuma mudança de alíquota exigir deploy.

| Parâmetro | Valor inicial | Observação |
| --- | --- | --- |
| PIS/COFINS não cumulativo | 9,25% | Crédito e débito |
| IRPJ + CSLL sobre o lucro | 34% | Editável por causa do adicional de 10% |
| Ganho do ICMS na base de PIS/COFINS | Desligado | Decisão favorável de 2025 |
| ICMS interestadual por UF de destino | 12% ou 7% | Tabela com as 26 UFs fora de MG |
| ICMS para conteúdo importado | 4% | Usa a origem do produto |
| ICMS interno de MG na venda (geral) | 18% | Cenário B, quando o NCM não tem exceção |
| Exceções de ICMS interno de MG por NCM | nenhuma | Cenário B; só os NCMs com alíquota diferente da geral |
| Alíquota interna de cada UF (para DIFAL) | vazia (preenchida pelo administrador) | Cenário D; UF vazia dá tarja vermelha só no cenário D |
| Percentual de recolhimento do ICMS na venda | 0% | Para a transição da Reforma Tributária (2029 a 2033) |
| % de recolhimento do ICMS em MG para não contribuinte | 0% | Venda a consumidor final em MG (cenário B); pendente de confirmação do fiscal sobre a cobertura do PTA |
| ICMS interno de MG na compra sem diferimento | 18% | Compra em MG sem PTA; só tira o ICMS da base do PIS/COFINS |
| ICMS interestadual na compra | 12% | Entrada em MG vinda de qualquer UF (sem tabela por UF) |
| ICMS na compra de mercadoria importada | 4% | Compra de fora com conteúdo importado |
| Despesas fixas padrão | último valor usado | Preenchido na hora de gerar |
| Comissão | 1% a 4% | Escolhida na tela |

**Campo novo no cadastro de cliente:** "Autorizado diferimento MG (S/N)". Pode ser um campo adicional no Omie ou uma tabela própria do app, indexada pelo código do cliente.

**Histórico:** toda alteração na tabela fiscal guarda data, usuário (id e nome), campo, valor anterior e valor novo (tabela `precificacao_parametros_historico`, visível só para o administrador).

**Onde fica (etapa 2):** `precificacao_parametros_fiscais` (uma linha, parâmetros gerais), `precificacao_icms_uf` (26 UFs fora de MG: ICMS interestadual de venda e alíquota interna), `precificacao_icms_mg_ncm` (exceções por NCM) e o histórico. Percentuais em pontos (9,25 = 9,25%), até 4 casas. Valores iniciais entram só na primeira vez, nunca por cima de uma edição. Tela: modo "💲 Precificação" → "Tabela fiscal da formação de preço" (quem tem a permissão `precificacao` vê; só o administrador edita).

## Avisos (tarjas)

Toda inconsistência do cálculo aparece como uma **tarja no topo do resultado**, dizendo o que está errado, em qual item e como resolver. As tarjas vêm do cálculo, como uma lista de avisos com **nível, código, item e mensagem**; a tela só as exibe, nunca as monta. A simulação salva e o PDF levam as mesmas tarjas.

**Vermelha: bloqueia, o preço não é exibido.**

| Código | Quando | Mensagem / como resolver |
| --- | --- | --- |
| `PRODUTO_SEM_ESTRUTURA` | Produto sem estrutura no Omie | Cadastrar a estrutura no Omie |
| `ALIQUOTA_INTERNA_UF_NAO_CONFIGURADA` | Cenário D com a alíquota interna da UF vazia | "Peça ao administrador para preencher a UF X na tabela fiscal" |
| `ICMS_INTERESTADUAL_UF_NAO_CONFIGURADO` | Venda interestadual com a UF sem ICMS interestadual | "Peça ao administrador para preencher a UF X na tabela fiscal" |
| `CLIENTE_INCONSISTENTE` | Ex.: autorizado diferimento MG de fora de MG ou não contribuinte | Corrigir o cadastro do cliente |
| `OMIE_INDISPONIVEL` | Erro ou demora da Omie | "Não foi possível consultar o Omie. Tente de novo em alguns minutos" |
| `SEM_PRECO_POSSIVEL` | Impostos + comissão + despesas + margem ≥ 100% | Reduzir a margem, a comissão ou as despesas |

**Amarela: preço exibido, marcado "INCOMPLETO – não usar em cotação".**

| Código | Quando | Mensagem / como resolver |
| --- | --- | --- |
| `ITEM_SEM_CUSTO` | Item sem custo (entra como zero) | Lista os códigos, com botão para digitar o custo manual |
| `ITEM_SEM_NCM_IPI` | Componente sem NCM ou sem IPI no cadastro (entra pelo bruto, sem crédito) | "Corrija o cadastro do item X no Omie" |
| `GGF_AUSENTE` | GGF não encontrado (entra como zero) | Digitar o GGF manual |
| `COMPONENTES_NAO_CONSULTADOS` | Estrutura com mais de 60 componentes | Lista os itens que ficaram de fora da consulta |

**Azul: informativa.**

| Código | Quando |
| --- | --- |
| `CUSTO_ESTIMADO` | Itens com custo "estimado" (sem nota de entrada) |
| `CUSTO_MANUAL_DIFERENTE_OMIE` | Custo manual diferente do custo do Omie (mostra os dois) |
| `DIFAL_BASE_SIMPLES` | Cenário D: "validar com o fiscal" |
| `MG_CONSUMIDOR_FINAL_ICMS` | Cliente de MG não contribuinte ou uso e consumo: "confirmar com o fiscal se o ICMS é recolhido" |
| `PRECO_CHEIO_INDISPONIVEL` | Só o preço cheio passa de 100% no divisor; vale o piso |

**Modo reverso:** preço-alvo abaixo do piso dá tarja **vermelha no bloco do resultado do modo reverso** (`ALVO_ABAIXO_DO_PISO`), sem bloquear o preço principal.

**Testes:** um teste por aviso. Implementados na etapa 1: `ALIQUOTA_INTERNA_UF_NAO_CONFIGURADA`, `ICMS_INTERESTADUAL_UF_NAO_CONFIGURADO`, `CLIENTE_INCONSISTENTE`, `SEM_PRECO_POSSIVEL`, `ITEM_SEM_CUSTO`, `ITEM_SEM_NCM_IPI`, `GGF_AUSENTE`, `DIFAL_BASE_SIMPLES`, `MG_CONSUMIDOR_FINAL_ICMS`, `PRECO_CHEIO_INDISPONIVEL` e `ALVO_ABAIXO_DO_PISO`. Os que dependem do Omie ou do custo manual (`PRODUTO_SEM_ESTRUTURA`, `OMIE_INDISPONIVEL`, `COMPONENTES_NAO_CONSULTADOS`, `CUSTO_ESTIMADO`, `CUSTO_MANUAL_DIFERENTE_OMIE`) entram nas etapas 3 e 4.

## Tela

Uma página, três blocos: entradas no topo, o preço em destaque no meio, a cascata de custos e impostos embaixo.

**Entradas**

- Código do produto (com busca por descrição) e quantidade.
- Cliente (busca no Omie) **ou** UF + tipo de cliente, para simulação rápida.
- Despesas fixas % (sugere o último valor usado), comissão 1% a 4%, margem desejada.
- Chave: margem informada "antes do IR/CS" ou "líquida".
- Campo opcional: preço-alvo (ativa o modo reverso).

**Resultado em destaque**

- Cenário aplicado (A, B, C ou D) e o motivo ("Cliente SP contribuinte → ICMS 12%").
- Preço piso e preço cheio, sem e com IPI, unitário e total.
- Margem antes e depois do IR/CS de cada um.
- No modo reverso: margem real do preço-alvo e aviso se estiver abaixo do piso.

**Cascata**

- Custo bruto → créditos (PIS/COFINS, IPI) → custo líquido → ICMS destacado (e quanto dele vira lucro) → PIS/COFINS → DIFAL → comissão → despesas → lucro → IR/CS → lucro líquido.
- Lista dos componentes, cada um com UF de origem, créditos retirados e marca de "estimado" quando faltou nota de entrada.
- Origem do custo de cada item (Omie, Manual ou Sem custo), campo para digitar o custo e, quando houver custo manual e do Omie ao mesmo tempo, os dois valores para o operador escolher.
- Aviso em destaque "Preço incompleto: X itens sem custo" quando faltar custo.

**Ações:** salvar a simulação e exportar em PDF para anexar ao orçamento.

## Arquitetura técnica

A tela entra no app existente (Node.js 24 + Express, deploy no Vercel pelo branch `main`), seguindo os padrões que já estão no repositório.

**Módulos**

- `omie` – cliente da API do Omie (reaproveitar o que já existe): produto, estrutura, notas de entrada, cliente.
- `precificacao` – funções puras, sem chamada externa: custo líquido, cenário, preço piso/cheio, lucro, modo reverso. É aqui que ficam os testes.
- `parametros-fiscais` – leitura e gravação da tabela fiscal e do histórico.

**Rotas**

| Método e rota | Faz |
| --- | --- |
| `GET /api/preco/:codigo?cliente=&uf=&tipo=&despesas=&comissao=&margem=&alvo=` | Devolve custo, cascata, preços e margens |
| `GET /api/precificacao/parametros-fiscais` | Lê a tabela fiscal (permissão `precificacao`) |
| `PUT /api/precificacao/parametros-fiscais` | Altera a tabela inteira (só administrador), com a `versao` lida: se outro administrador salvou antes, responde 409 e a tela oferece recarregar. Validação estrita (400), grava histórico |
| `GET /api/precificacao/parametros-fiscais/historico?limite=` | Histórico de alterações (só administrador) |
| `POST /api/simulacoes` | Salva uma simulação |
| `GET /api/precificacao/custos-manuais` / `PUT /api/precificacao/custos-manuais/:codigo` | Lê e grava custo manual salvo (com histórico) |

Rotas da tabela fiscal com o prefixo `/api/precificacao/parametros-fiscais` (para não confundir com os parâmetros fiscais do módulo de fretes).

**Dados persistidos:** tabela fiscal, histórico de alterações, custos manuais e seu histórico, simulações salvas (com o custo usado em cada item) e o campo "autorizado diferimento MG". Banco: o Postgres/Supabase que o app já usa (`src/db.ts`); tabelas criadas com `CREATE TABLE IF NOT EXISTS`. **Atenção:** o Preview do Vercel usa o mesmo `DATABASE_URL` da produção — só são criadas tabelas novas da precificação, nunca alteradas ou apagadas tabelas existentes.

**Cache:** estrutura e notas de entrada em cache por algumas horas, para não estourar o limite de chamadas do Omie, com botão "atualizar custos" na tela.

**Testes:** casos unitários de `precificacao` com o exemplo numérico da próxima seção, um por cenário (A, B, C, D) e o modo reverso. Para o custo manual: produto com item sem custo (preço incompleto), com custo manual salvo, e com custo manual que sobrepõe o Omie.

## Exemplo numérico de validação

Com custo líquido de R$ 90,75, comissão de 3%, despesas de 10% e margem de 12% antes do IR/CS, o sistema tem de devolver exatamente estes valores (sem IPI, sem DIFAL). Os percentuais são ilustrativos e servem de caso de teste.

| Caso | Divisor | Preço | Lucro antes do IR/CS | Lucro depois do IR/CS |
| --- | --- | --- | --- | --- |
| C, cheio (ICMS 12%) | 0,5486 | R$ 165,42 | R$ 39,70 (24,0%) | R$ 26,20 (15,8%) |
| C, piso (ICMS 12%) | 0,6686 | R$ 135,73 | R$ 16,29 (12,0%) | R$ 10,75 (7,9%) |
| A, MG autorizado | 0,6575 | R$ 138,02 | R$ 16,56 (12,0%) | R$ 10,93 (7,9%) |

No caso C cheio, os 12 pontos de margem a mais são o ICMS destacado e não recolhido (R$ 19,85).

## Pontos de atenção e próximos passos

**Validar com o fiscal antes de usar em cotação real**

- Alíquotas internas de MG por NCM (cenário B) e a regra de DIFAL por UF (base simples ou dupla).
- Se os custos unitários da ficha técnica já incluem o IPI da compra.
- O IPI fora da base do PIS/COFINS e do ICMS na compra para industrialização.
- Se o PTA cobre venda a não contribuinte/consumidor final em MG (hoje: parâmetro de recolhimento próprio, padrão 0%, com aviso na tela).
- DIFAL de contribuinte de outra UF comprando para uso e consumo: pela LC 190/2022, quem recolhe é o destinatário; hoje o cálculo trata como custo da ETK (cenário D).

**Próximos passos (no VS Code, sobre o repositório do ETK Comissão)**

- [x] Ler o repositório e mapear o cliente do Omie e o banco já usados.
- [ ] Validar a fonte do custo e do GGF com o PA00000001 (rota temporária de diagnóstico no Preview).
- [x] Criar o módulo `precificacao` com os testes do exemplo numérico (etapa 1).
- [x] Criar a tabela fiscal e a tela de administração (etapa 2).
- [ ] Custo manual (tabela própria, histórico, prioridade sobre o Omie, preço incompleto, formulário com UF, PTA, tipo de fornecedor e IPI).
- [ ] Integrar estrutura, notas de entrada, cadastro (NCM/IPI) e cliente do Omie.
- [ ] Relatório de conferência do cadastro (componentes sem NCM/IPI), só leitura.
- [ ] Montar a tela e validar com 3 produtos reais junto com o fiscal.
- [ ] Publicar em preview no Vercel antes de ir para produção.
