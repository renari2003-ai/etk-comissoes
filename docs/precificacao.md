# ETK – Formação de Preço de Venda (Especificação)

Nov 24, 2026 · @Ricardo

## Objetivo e escopo

Uma nova tela no app ETK Comissão: o usuário digita o código do produto, escolhe o cliente e recebe o **preço de venda sugerido**, já calculado sobre a carga tributária real da ETK (Lucro Real + regime especial de ICMS em MG).

**Dentro do escopo**

- Custo do produto a partir da estrutura no Omie: todos os kits abertos até as folhas, quantidade × (1 + perda) × custo médio de cada folha, sem GGF separado (ver "Decisões de 25/11/2026").
- Limpeza do custo: retira os impostos recuperáveis (PIS/COFINS e IPI) e mantém o ICMS que é custo.
- Preço por cenário de venda (MG com PTA para industrialização, demais vendas em MG, outra UF contribuinte, não contribuinte/consumidor final com DIFAL).
- Faixa de negociação: **preço piso** e **preço cheio**, com margem antes e depois do IR/CS.
- Modo reverso: preço-alvo → margem real.
- Tabela fiscal editável, sem precisar mexer no código.
- Custo manual por item da estrutura quando o Omie não tiver custo ou o custo estiver errado — ver "Custo manual".

**Fora do escopo (nesta versão)**

- Gravar o preço no Omie ou gerar o orçamento automaticamente.
- Frete, que pode vir depois da automação de cotação de frete.

## Premissas tributárias da ETK

Todas as regras abaixo foram confirmadas pelo Ricardo e pelo fiscal da ETK; cada percentual fica editável na tabela fiscal.

| Tema | Regra |
| --- | --- |
| Regime | Lucro Real |
| PIS/COFINS | Não cumulativo, 1,65% + 7,6% = 9,25%. Crédito na compra de insumos, débito na venda. ICMS excluído da base do débito (Tema 69 do STF) e da base do crédito (lei de 2023). |
| IPI | Recuperável na compra (ETK é indústria). Na venda, calculado sobre o preço e somado por fora, pela alíquota do NCM do produto na tabela NCM → IPI do app (o cadastro do Omie não tem alíquota de IPI). |
| ICMS na compra | **Sempre é custo, nunca crédito.** Só é 0% (diferimento) quando o **fornecedor é de MG E tem PTA**. Fornecedor de MG sem PTA: ICMS destacado, alíquota interna (padrão 18%, editável). Fora de MG: 12% de qualquer UF (4% se a mercadoria for importada). O percentual só serve para tirar o ICMS da base do crédito de PIS/COFINS (ver "Impostos na compra"). |
| IPI na compra | Recuperável. No custo do Omie já vem descontado (o `nCMC` é líquido). No custo manual, depende do tipo de fornecedor (ver "Impostos na compra"). |
| ICMS na venda a contribuinte | Pelo regime especial (PTA), a ETK **não recolhe** o ICMS destacado na venda a contribuinte: ele vira resultado. Vale para venda interestadual a contribuinte e para venda dentro de MG a contribuinte (fora do cenário A). |
| ICMS na venda a não contribuinte / consumidor final | **O PTA não se aplica** (fiscal, 25/11/2026): o ICMS destacado é **recolhido** e vira custo, não lucro. Vale em MG (cenário B) e nas outras UFs (cenário D, junto com o DIFAL). Percentual de recolhimento editável na tabela fiscal, padrão 100%. |
| Cliente com PTA (compra para industrialização) | Cliente industrializador de MG com PTA: na **venda para industrialização**, a nota sai sem ICMS (cenário A), e a ETK pode repassar como desconto. |
| DIFAL | Venda para não contribuinte (ou uso e consumo) em outra UF: o DIFAL é pago ao estado de destino e **continua sendo custo**. |
| Ganho do ICMS em IRPJ/CSLL | É receita tributável: entra no lucro e paga cerca de 34% (IRPJ 15% + adicional 10% + CSLL 9%). |
| Ganho do ICMS em PIS/COFINS | **Não** entra na base, por decisão favorável obtida em 2025. Fica como chave liga/desliga na tabela fiscal. |

## Fontes de dados (API do Omie)

Todo dado vem do Omie pela API que o app já usa; os nomes de endpoint abaixo são a referência inicial e devem ser conferidos na documentação do Omie durante o desenvolvimento.

| Dado | Para que serve | Endpoint de referência |
| --- | --- | --- |
| Produto acabado: código, descrição, NCM, origem | NCM → alíquota de IPI na venda (tabela NCM → IPI do app); origem define o ICMS de 4% para conteúdo importado | `geral/produtos` – ConsultarProduto (`ncm`, `recomendacoes_fiscais.origem_mercadoria`) |
| Estrutura do produto: componentes, quantidades, unidade, % de perda | Montar o custo, como no relatório "Imprimir Estrutura". Kits (tipo 03/04) têm estrutura própria e são abertos até as folhas | `geral/malha` – ConsultarEstrutura (endpoint confirmado na documentação em 24/11/2026) |
| Custo unitário de cada folha | Custo líquido (já sem os impostos recuperáveis, decisão de 26/11/2026) | A estrutura **não traz custo por item**. **Confirmado em 25/11/2026:** custo médio do estoque, `nCMC` da posição de estoque (`estoque/consulta` – ListarPosEstoque), sempre o atual |
| Cliente: UF, inscrição estadual, contribuinte | Escolher o cenário de venda (junto com a finalidade da venda: industrialização, revenda ou uso e consumo). "Cliente com PTA" fica no app (decisão de 26/11/2026) | `geral/clientes` – ConsultarCliente (`estado`, `inscricao_estadual`, `contribuinte`) |

**O custo do Omie já vem líquido dos impostos recuperáveis**, conforme a configuração "Custo de Estoque" do recebimento de NF-e. A ETK deve manter "ICMS é custo = SIM" (PTA) nessa configuração. Por isso o app **não lê as notas de entrada** e não aplica crédito nenhum ao `nCMC` (decisão de 26/11/2026). Componente sem custo médio (0 ou vazio) vai para o custo manual; não existe item "estimado".

**Cadastro do componente (`geral/produtos` – ConsultarProduto):** só o **NCM** (`ncm`). **O cadastro do Omie não tem alíquota de IPI** (documentação conferida em 26/11/2026): a alíquota sai da **tabela NCM → IPI** do app. Só importa no **custo manual**: componente sem NCM no cadastro, ou com NCM fora da tabela NCM → IPI (com fornecedor indústria normal e sem IPI informado), entra **pelo valor da nota, sem crédito**, e deixa o preço **incompleto** (ver "Relatório de conferência do cadastro").

**Validação da fonte de custo (24/11/2026):** relatório do PA00000001 (CEO SOFS 12/24 FO 4D): "Valor GGF" R$ 59,76; PI10000014 0,192111; MP00000008 17,06279; MO00000013 5,238053; MO00000037 e MP00000045 sem custo unitário. A rota temporária `GET /api/precificacao/diagnostico/:codigo` (só administrador, só leitura, **removida antes de produção**) mostra de qual campo da API sai cada número.

### Decisões de 25/11/2026 (após o diagnóstico do PA00000001)

1. **Custo base = custo médio do estoque (`nCMC`), sempre o ATUAL.** PI10000014 e MO00000013 batem com o relatório. MP00000008 (17,06 → 12,86) e MP00000002 mudaram porque o relatório é antigo, e isso não é erro.
2. **"Valor GGF" do relatório = custo total do produto (CONFIRMADO em 25/11/2026).** Os R$ 59,76 do relatório "Imprimir Estrutura" são a soma de quantidade × custo de todas as folhas, abrindo todos os kits. Não são um GGF. A soma atual dá R$ 50,72 com o custo médio de hoje e R$ 53,77 com os 5 valores unitários anotados do relatório. Os ~R$ 6,00 que faltam têm duas causas:
   - **Itens hoje sem custo médio, que no relatório antigo tinham valor total** (≈ R$ 5,08). Os valores do relatório são da linha inteira:
     - MO00000037: 2,46 (qtd 1, ≈ 2,46/un);
     - MO00000067: 1,28 (qtd 8, ≈ 0,16/un);
     - MP00000045: 0,6908 (qtd 0,044, ≈ 15,70/un);
     - MP00000042: 0,41241 (qtd 0,059, ≈ 6,99/un);
     - MO00000038: 0,2353664 (qtd 0,04597, ≈ 5,12/un).
   - **Mudança de preço:** o MP00000002 caiu de 21,97 para 15,52 (≈ R$ 0,86 no produto).

   Conclusão: o custo total do produto confere com o relatório do Omie. A diferença é explicada pela mudança de preço e pelos itens sem custo médio. O diagnóstico chama a linha de "Custo total do produto (o relatório chama de 'Valor GGF')".

   **Origem do custo desses 5 itens (investigação encerrada em 2026-11-26):** nenhum campo da API do Omie bate com o custo que o relatório antigo mostrava. Foram comparados `ListarPosEstoque`, o cadastro completo (`ConsultarProduto`), os dados de produção do item e o `estoque/resumo` → `ObterEstoqueProduto` (`nCMC` por local e `nPrecoUltComp`). Os campos mais próximos eram alíquotas, `tipoItem` e `origem_mercadoria`, sem relação com custo. **Decisão do usuário: não há 2ª fonte de custo.** Esses 5 itens ficam no custo manual. O formulário do custo manual mostra, só como **sugestão (relatório antigo do Omie)**, o unitário implícito de cada um: MO00000037 R$ 2,46; MO00000067 R$ 0,16; MP00000045 R$ 15,70; MP00000042 R$ 6,99; MO00000038 R$ 5,12. A sugestão nunca entra no cálculo sozinha: o operador confere, usa ou digita o valor e salva. A busca foi tirada do diagnóstico para não confundir.
3. **Regra de custo:** abrir os kits até as folhas e somar quantidade × (1 + perda) × custo médio de cada folha, igual ao relatório do Omie. A quantidade acumulada é o produto de quantidade × (1 + perda) de cada nível do caminho. **Nunca** se soma o custo do kit e o dos itens de dentro dele ao mesmo tempo. Kit sem estrutura entra com o custo médio do próprio kit. Estrutura em ciclo ou com mais de 10 níveis é erro explícito. Implementado em `src/precificacao/estrutura.ts`, com testes de não duplicidade.
4. **Itens sem custo** no PA00000001 (PI00000048, MO00000038, MP00000045, MO00000067, MP00000042, MO00000037) vão para o **custo manual** (etapa 3).
5. **Sem GGF separado.** O custo de fabricação fica dentro das "despesas fixas %" informadas na tela. O GGF saiu do cálculo do custo: não há mais aviso "GGF ausente" nem custo manual de GGF. A estrutura fica pronta para um futuro **"% de custo de fabricação"** (`calcularCusto(itens, { percentualCustoFabricacao })`), **desligado por padrão (0)**: fração sobre o custo bruto dos materiais, somada ao bruto e ao líquido, sem crédito. Quando for ligado, a base precisa ser confirmada, e o parâmetro vai para uma tabela nova (a tabela fiscal existente não recebe `ALTER`).

### Decisões para a etapa 4 (25/11/2026)

6. **Custo médio 0 no Omie = "sem custo" em todos os pontos** (cálculo, soma da estrutura, diagnóstico e avisos). O 0 nunca é usado como custo válido. O item vai para o custo manual, com tarja amarela.
7. **"Manual" escolhido sem custo manual salvo = "sem custo".** Aparece a tarja amarela com o código do item e o campo para digitar. O custo nunca vira 0, e o sistema nunca volta sozinho para o custo do Omie sem avisar.

Implementado em 25/11/2026: `somarFolhas` e `calcularCusto` tratam custo 0 como sem custo (tarja amarela `ITEM_SEM_CUSTO`), e o diagnóstico já usava só custo positivo. `resolverCustoItem` com a escolha "MANUAL" sem valor manual salvo devolve `SEM_CUSTO` com a tarja amarela, avisando que o custo do Omie não foi usado.

### Decisões de 26/11/2026 (fontes do Omie)

8. **Sem 2ª fonte de custo.** Os 5 itens sem custo médio ficam no custo manual, com a sugestão do relatório antigo no formulário.
9. **IPI por NCM numa tabela do app.** A documentação do Omie mostra que o cadastro de produto não tem alíquota de IPI, só o NCM. Nova tabela **NCM → IPI %**, parte da tabela fiscal (mesma versão, mesmo histórico, mesmo status "Provisório / Validado"; editável só pelo administrador). Vale para o IPI da compra no custo manual (indústria normal sem IPI informado) e para o IPI na venda do produto acabado. Começa vazia, "a confirmar pelo fiscal".
   - Compra: NCM ausente ou fora da tabela → sem crédito, tarja amarela `ITEM_SEM_NCM_IPI`.
   - Venda: produto acabado sem NCM ou com NCM fora da tabela → tarja **vermelha** `IPI_VENDA_NCM_NAO_CONFIGURADO` (o preço com IPI não pode sair errado).
10. **"Cliente com PTA (compra para industrialização)" é marcado no app**, por cliente do Omie (código do cliente), só pelo administrador, com histórico e concorrência por versão. Tabela nova `precificacao_clientes_pta` (+ histórico). Nada é gravado no Omie.
11. ~~Última nota de entrada: janela de 6 meses.~~ **Substituída pela decisão 12.**
12. **O `nCMC` já vem líquido dos impostos recuperáveis** (documentação do Omie: a aba "Custo de Estoque" do recebimento da NF-e deduz os créditos antes do custo médio). "O custo do Omie já vem líquido dos impostos recuperáveis, conforme a configuração 'Custo de Estoque' do recebimento de NF-e. A ETK deve manter 'ICMS é custo = SIM' (PTA) nessa configuração." Portanto:
    - custo do Omie entra **como está, sem crédito nenhum** (nem IPI, nem PIS/COFINS, nem ICMS);
    - custo manual ("valor da nota, com impostos") continua tirando IPI e PIS/COFINS pelas regras de "Impostos na compra";
    - as notas de entrada **não são mais lidas** (o cálculo fica mais rápido; o módulo de notas foi retirado);
    - não existe mais item "estimado" nem a tarja `CUSTO_ESTIMADO`: custo médio > 0 é o custo; sem ele, custo manual;
    - `ITEM_SEM_DADOS_FISCAIS` vale só para custo manual sem UF/tipo de fornecedor (a gravação exige os dois, então é só defesa);
    - o valor da nota passou a ser **obrigatório** no custo manual (o registro "só dados fiscais" existia para o item estimado). Registro antigo sem valor vale como "sem custo manual".

### Etapa 4 — como foi implementada (26/11/2026)

- **Leitura do Omie** (`precificacao/coletaOmie.ts`, só consultas): estrutura aberta até as folhas (kits tipo 03/04), `nCMC` atual de cada folha (0 = sem custo), NCM do cadastro (produto e folhas), origem da mercadoria do produto (1, 2, 3 e 8 = conteúdo importado). Notas de entrada não são lidas (decisão 12). Erro temporário do Omie em qualquer consulta → `OMIE_INDISPONIVEL` (vermelha); nunca vira "sem custo". Kit sem estrutura no Omie entra como folha, com o próprio custo médio.
- **Custo por folha** (`precificacao/montagemCusto.ts`): valor por `resolverCustoItem`; custo do Omie entra como está (`OMIE_LIQUIDO`, sem crédito); custo manual tira os créditos pelos dados digitados (`DADOS_MANUAIS`). Custo manual sem UF/tipo de fornecedor (só defesa) entra pelo valor da nota, sem crédito, com a tarja amarela `ITEM_SEM_DADOS_FISCAIS`. IPI da venda = tabela NCM → IPI do NCM do produto; sem NCM ou fora da tabela = `IPI_VENDA_NCM_NAO_CONFIGURADO` (vermelha).
- **Cliente** (`precificacao/clienteVenda.ts`): UF, contribuinte ("S"/"N") e IE do `ConsultarCliente`; "cliente com PTA" do app; finalidade (industrialização, revenda, uso e consumo) escolhida na tela. Cliente não encontrado, sem UF, do exterior ou sem "contribuinte" no cadastro → `CLIENTE_INCONSISTENTE` (vermelha), sem adivinhar.
- **Relatório de conferência** (`precificacao/conferenciaCadastro.ts`, `GET /api/precificacao/conferencia-cadastro?produto=` ou `?pagina=`, só administrador): um produto, ou todos em lotes de 10 produtos (`ListarEstruturas`); tela no modo Precificação.
- **Estrutura sem cache próprio por enquanto** (`ConsultarEstrutura` é lido a cada cálculo, para o diagnóstico ver o dado atual); cadastro (60 min) e estoque (10 min) têm cache. Avaliar cache da estrutura na etapa 5.
- **Contrato da etapa 5:** o resultado do cálculo junta SEMPRE os avisos de `coletarDadosOmie`, `montarCusto` (inclusive `ITEM_SEM_DADOS_FISCAIS`, que não aparece em `calcularCusto`), `clienteParaVenda`, `calcularCusto`, do cenário e da tabela fiscal; "incompleto" = qualquer amarelo da lista inteira.
- **Revisão de 26/11/2026 (corrigido):** "cliente não encontrado" só quando o Omie diz que não existe (HTTP 5xx ou rede = Omie indisponível, e o "não existe" não fica no cache); o PUT do cliente com PTA confere o cliente no Omie e grava nome e CNPJ de lá; a conferência nunca sai "limpa" sem conferir (produto sem itens = sem estrutura; item sem id, acima do teto, em ciclo ou fundo demais = "não conferido"); kit em ciclo ou com mais de 10 níveis é erro explícito no cálculo.
- **Fica para a etapa 5 (tela de cálculo):** a rota do cálculo que junta tudo isso, o botão "atualizar custos" (limpa o cache das notas), a escolha da finalidade da venda e os avisos da tabela fiscal em todo cálculo.

## Custo manual

O Omie ainda é novo na ETK e parte dos componentes vem sem custo. Por isso todo item da estrutura aceita custo manual (não há GGF separado, pela decisão de 25/11/2026).

**Origem do custo por item.** Cada linha da estrutura mostra uma de três origens: **Omie**, **Manual** ou **Sem custo**. Item sem custo aparece destacado, já com o campo para digitar.

**Digitar ou corrigir.** O operador pode digitar o custo de qualquer item, mesmo os que têm custo do Omie. Ao confirmar, escolhe:

- **Só nesta simulação:** vale para o cálculo atual (e fica gravado na simulação, se for salva), sem afetar os próximos cálculos.
- **Salvar para próximos cálculos:** grava na tabela de custos manuais e passa a ter **prioridade sobre o Omie**.

**Formulário do custo manual.** O custo é digitado como aparece na nota de compra, **com impostos**. Campos:

| Campo | Regra |
| --- | --- |
| Valor da nota (unitário, com impostos) | Obrigatório, maior que zero |
| UF do fornecedor | Obrigatório; define o ICMS da compra |
| Fornecedor de MG com PTA? | **Só aparece se a UF for MG**. Sim → ICMS 0% (diferimento); Não → ICMS destacado, alíquota interna de MG da tabela fiscal (padrão 18%), que é custo. (No banco e na API o campo continua `diferimento_pta` / `diferimentoPta`.) |
| Mercadoria importada? | **Só aparece se a UF não for MG**. Sim → ICMS 4%; Não → 12% (entrada em MG vinda de qualquer UF) |
| Tipo de fornecedor | Indústria normal (Lucro Real/Presumido), Simples Nacional ou comércio/distribuidor |
| IPI % | **Indústria normal:** vazio = alíquota da tabela NCM → IPI para o NCM do componente (cadastro do Omie), editável; sem NCM no cadastro ou com NCM fora da tabela, se ficar vazio, o item entra pelo valor bruto, sem crédito (preço incompleto). **Simples Nacional:** travado em 0, campo desabilitado. **Comércio/distribuidor:** começa em 0, editável, com a dica "só se a nota destacar IPI (ex.: distribuidor de importado equiparado a indústria)" |

Os créditos saem pelas regras de "Impostos na compra". O custo do Omie não passa por elas: já vem líquido.


**Conflito com o Omie.** Se um item com custo manual salvo passar a ter custo no Omie, a tela mostra os dois valores e o operador escolhe qual usar. Até ele escolher, vale o manual (regra de prioridade).

**Preço incompleto.** Se algum item continuar sem custo, o preço é calculado mesmo assim (o item entra com custo zero) e a tela mostra em destaque **"Preço incompleto: X itens sem custo"**. A simulação salva registra essa condição.

**Rastreabilidade.** A simulação salva guarda, item a item, o custo usado, a origem (Omie, Manual salvo, Manual só da simulação, Sem custo), a UF do fornecedor, "fornecedor de MG com PTA", o tipo de fornecedor, as alíquotas de IPI e ICMS usadas e os créditos retirados, para a conta poder ser reconstruída depois, mesmo que o Omie ou a tabela de custos manuais mudem.

**Tabela de custos manuais.** Código do componente, valor da nota com impostos (obrigatório; registro antigo sem valor vale como "sem custo manual"), UF do fornecedor, fornecedor de MG com PTA (S/N, só MG), mercadoria importada (S/N, só fora de MG), tipo de fornecedor, IPI %, data e usuário. Toda alteração vai para um histórico com data, usuário, valor anterior e valor novo. Fica no banco do app, **nunca** é gravada no Omie.

**Onde fica (etapa 3):** `precificacao_custos_manuais` (um registro por código, com `versao` para concorrência otimista) e `precificacao_custos_manuais_historico` (campo a campo: data, usuário, valor anterior e valor novo, inclusive na remoção). Funções puras em `src/precificacao/custoManual.ts` (validação estrita, créditos pela regra de "Impostos na compra" e prioridade); repositório em `custosManuaisRepositorio.ts`. Quem tem a permissão `precificacao` lê, inclui, altera e remove, porque é o operador que digita o custo. A tela fica no modo "💲 Precificação" → "Custos manuais". Remover um custo manual volta a valer o Omie. Gravar em cima de uma leitura antiga responde 409.

**Prioridade (implementada em `resolverCustoItem`):** manual "só nesta simulação" > manual salvo > Omie > sem custo. Se o manual salvo for diferente do Omie, aparece a tarja azul `CUSTO_MANUAL_DIFERENTE_OMIE` com os dois valores, e vale o manual até o operador escolher "Omie". Registro antigo sem valor não é custo manual: vale o Omie.

## Impostos na compra (créditos do custo)

**ICMS na compra — sempre custo, nunca crédito.** O percentual só é usado para tirar o ICMS da base do crédito de PIS/COFINS.

| Compra | ICMS |
| --- | --- |
| Fornecedor de MG **com PTA** (diferimento) | 0% |
| Fornecedor de MG sem PTA | ICMS destacado: alíquota interna de MG (padrão 18%, editável na tabela fiscal) |
| Fora de MG | 12% de qualquer UF; 4% para mercadoria importada. (Os 7% só existem na **venda** de MG para Norte, Nordeste, Centro-Oeste e ES.) |

**Custo do Omie: nada a calcular.** O `nCMC` já vem líquido dos impostos recuperáveis (decisão 12 de 26/11/2026); estas regras valem só para o **custo manual**.

**IPI na compra (custo manual):** o operador informa o tipo de fornecedor.
   - **Indústria normal (Lucro Real/Presumido):** IPI informado no custo manual; senão, a alíquota da tabela NCM → IPI para o NCM do componente (cadastro do Omie).
   - **Simples Nacional:** IPI = 0, sempre (campo travado).
   - **Comércio/distribuidor:** IPI = 0, salvo se a nota destacar IPI (campo editável).
   - **Componente sem NCM no cadastro ou com NCM fora da tabela NCM → IPI** (e fornecedor indústria normal, sem IPI informado): o item entra **pelo valor bruto, sem crédito nenhum**, e o preço fica **incompleto** (decisão de 24/11/2026: conservador, o preço sai alto, nunca baixo).

**Conta por item** (valor da nota V com impostos, alíquotas de IPI e ICMS da compra):

- Valor dos produtos: `vProd = V ÷ (1 + IPI)`
- IPI (crédito): `V − vProd`
- ICMS (fica no custo): `vProd × ICMS`
- PIS/COFINS (crédito): `9,25% × (vProd − ICMS)`
- **Custo líquido** = `V − IPI − PIS/COFINS` = `vProd − PIS/COFINS`

Exemplos com V = R$ 112,00 e IPI 12% (vProd = R$ 100,00, IPI = R$ 12,00):

| Compra | ICMS | PIS/COFINS | Custo líquido |
| --- | --- | --- | --- |
| Fornecedor de MG com PTA | R$ 0,00 | 9,25% × 100,00 = R$ 9,25 | R$ 90,75 |
| Fornecedor de MG sem PTA (18%) | R$ 18,00 | 9,25% × 82,00 = R$ 7,585 | R$ 92,415 (sem arredondar no meio da conta) |
| SP, 12% | R$ 12,00 | 9,25% × 88,00 = R$ 8,14 | R$ 91,86 |
| Fornecedor Simples, MG com PTA (IPI 0, V = R$ 100,00) | R$ 0,00 | R$ 9,25 | R$ 90,75 |

A última linha mostra que, sem IPI na nota, o valor digitado já é o vProd.

A regra vale para o custo manual; o custo do Omie já vem líquido. **Validar com o fiscal:** o IPI fora da base do PIS/COFINS e do ICMS (compra para industrialização).

## Relatório de conferência do cadastro

Somente leitura. Para um produto (ou para todos os produtos que têm estrutura no Omie), lista os componentes **sem NCM** no cadastro do Omie (correção no Omie) ou com **NCM fora da tabela NCM → IPI** (correção na tabela fiscal, pelo administrador), e o próprio produto acabado nas mesmas condições. Colunas: produto acabado, código e descrição do componente, NCM, alíquota de IPI da tabela, problema ("sem NCM", "NCM sem IPI na tabela"). Usa `ListarEstruturas`/`ConsultarEstrutura` e `ConsultarProduto`, com cache e pelo limitador de chamadas. A varredura de todos os produtos roda em lotes, porque cada componente custa uma chamada ao Omie. Rota prevista: `GET /api/precificacao/conferencia-cadastro?produto=` (sem `produto` = todos), só para administrador.

## Regras de cálculo

O preço sai em sete passos: custo líquido, cenário, divisor, preço cheio e piso, IPI por fora, lucro antes e depois do IR/CS e, se pedido, o modo reverso.

1. **Custo bruto** = soma de (quantidade acumulada × custo unitário) de cada **folha** da estrutura. Os kits são abertos e o kit nunca entra junto com os itens de dentro dele. Não há GGF separado.
2. **Custo líquido**: o custo do Omie já é líquido. No custo manual, retira os créditos pelas regras de "Impostos na compra" (tipo de fornecedor, UF e NCM).
   - PIS/COFINS: 9,25% sobre o valor dos produtos sem o ICMS.
   - IPI: o informado, ou pelo tipo de fornecedor e NCM.
   - ICMS: nada a retirar; é sempre custo.
3. **Cenário de venda** define os percentuais sobre o preço:

| Cenário | ICMS destacado | ICMS recolhido | PIS/COFINS efetivo | DIFAL |
| --- | --- | --- | --- | --- |
| A. MG, cliente com PTA **e** venda para industrialização | 0% | 0% | 9,25% | não |
| B. MG, demais vendas a contribuinte (sem PTA, ou com PTA mas não para industrialização) | alíquota interna de MG (geral 18%, ou exceção do NCM) | recolhimento a contribuinte (0% hoje) | 9,25% × (1 − ICMS) | não |
| B. MG, não contribuinte ou uso e consumo (consumidor final) | alíquota interna de MG | **recolhimento a consumidor final (padrão 100%)** | 9,25% × (1 − ICMS) | não |
| C. Outra UF, contribuinte | 12%, 7% ou 4% | recolhimento a contribuinte (0% hoje) | 9,25% × (1 − ICMS) | não |
| D. Outra UF, não contribuinte ou uso e consumo | 12%, 7% ou 4% | **recolhimento a consumidor final (padrão 100%)** | 9,25% × (1 − ICMS) | sim, alíquota interna do destino − interestadual |

Detalhes dos cenários (aprovados em 24/11/2026; respostas do fiscal em 25/11/2026):

- **ICMS recolhido na venda a contribuinte** = ICMS destacado × "recolhimento do ICMS na venda a contribuinte" da tabela fiscal (0% hoje, pelo PTA; até 100% na transição da Reforma).
- **ICMS recolhido na venda a não contribuinte ou consumidor final** (não contribuinte, ou contribuinte comprando para uso e consumo, mesmo com PTA) = ICMS destacado × "recolhimento do ICMS na venda a não contribuinte / consumidor final", **padrão 100%**: o PTA não se aplica, o ICMS destacado é recolhido e vira custo. Vale em MG (cenário B) e nas outras UFs (cenário D, junto com o DIFAL). Com 100%, preço piso = preço cheio. O aviso antigo "confirmar com o fiscal se o ICMS é recolhido" (`MG_CONSUMIDOR_FINAL_ICMS`) saiu: o fiscal respondeu.
- **Cenário A** só quando as duas condições valem: **venda para industrialização E cliente com PTA**. Cliente com PTA numa venda que não é para industrialização cai no cenário B (contribuinte). A finalidade da venda (industrialização, revenda, uso e consumo) é escolhida na tela a cada cálculo; "para industrialização" e "para uso e consumo" juntos, ou "para industrialização" com cliente não contribuinte, são recusados como dado inconsistente.
- **"Cliente com PTA (compra para industrialização)"** (antes "autorizado diferimento MG") só vale para cliente de MG contribuinte (industrializador); marcado para cliente de fora de MG ou não contribuinte é recusado como dado inconsistente.
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
| IPI por NCM | nenhum (**a confirmar pelo fiscal**) | IPI na venda do produto acabado e IPI da compra no custo manual (decisão de 26/11/2026). Tabela nova `precificacao_ipi_ncm` |
| Alíquota interna de cada UF (para DIFAL), sem FCP | Buscador NCM, nov/2026, **a confirmar pelo fiscal**: AC 19; AL 20,5; AM 20; AP 18; BA 20,5; CE 20; DF 20; ES 17; GO 19; MA 23; MS 17; MT 17; PA 19; PB 20; PE 20,5; PI 22,5; PR 19,5; RJ 20; RN 20; RO 19,5; RR 20; RS 17; SC 17; SE 19; SP 18; TO 20 (MG 18 é o ICMS interno de MG na venda) | Cenário D; todas editáveis; UF vazia dá tarja vermelha só no cenário D. Sem FCP por enquanto (depende do produto) |
| Recolhimento do ICMS na venda a contribuinte | 0% | PTA da ETK; para a transição da Reforma Tributária (2029 a 2033) |
| Recolhimento do ICMS na venda a não contribuinte / consumidor final | **100%** | O PTA não se aplica (fiscal, 25/11/2026); cenários B (consumidor final em MG) e D |
| ICMS interno de MG na compra (fornecedor de MG sem PTA) | 18% | Fornecedor de MG com PTA: 0%; só tira o ICMS da base do PIS/COFINS |
| Status da tabela | **Provisório** | "Provisório / Validado pelo fiscal": só o administrador muda, com histórico. Enquanto "Provisório", **todo cálculo mostra a tarja azul "Parâmetros fiscais ainda não validados pelo fiscal"** |
| ICMS interestadual na compra | 12% | Entrada em MG vinda de qualquer UF (sem tabela por UF) |
| ICMS na compra de mercadoria importada | 4% | Compra de fora com conteúdo importado |
| Despesas fixas padrão | último valor usado | Preenchido na hora de gerar |
| Comissão | 1% a 4% | Escolhida na tela |

**Cliente com PTA (compra para industrialização):** marcado no app, por cliente do Omie, só pelo administrador, com histórico (decisão de 26/11/2026). Tabela `precificacao_clientes_pta` e `precificacao_clientes_pta_historico`.

**Histórico:** toda alteração na tabela fiscal guarda data, usuário (id e nome), campo, valor anterior e valor novo (tabela `precificacao_parametros_historico`, visível só para o administrador).

**Onde fica (etapa 2):** `precificacao_parametros_fiscais` (uma linha, parâmetros gerais), `precificacao_icms_uf` (26 UFs fora de MG: ICMS interestadual de venda e alíquota interna), `precificacao_icms_mg_ncm` (exceções por NCM) e o histórico. Percentuais em pontos (9,25 = 9,25%), até 4 casas. Valores iniciais entram só na primeira vez, nunca por cima de uma edição. Tela: modo "💲 Precificação" → "Tabela fiscal da formação de preço" (quem tem a permissão `precificacao` vê; só o administrador edita).

**Onde fica (25/11/2026):** como a tabela de parâmetros já existe no banco da produção e não recebe `ALTER`, os parâmetros novos ficam numa tabela nova, `precificacao_parametros_fiscais_extra` (uma linha): recolhimento a não contribuinte/consumidor final e o status (com data e quem mudou). A coluna antiga `recolhimento_icms_mg_nao_contribuinte` ficou sem uso. Na primeira vez que essa tabela é criada, as alíquotas internas **vazias** das UFs são preenchidas com os valores do Buscador NCM, com uma linha de histórico por UF ("Valor inicial: Buscador NCM, nov/2026 (a confirmar pelo fiscal)"). Alíquota já editada pelo administrador nunca é trocada, e uma UF esvaziada depois de propósito não é preenchida de novo. O status muda por `PUT /api/precificacao/parametros-fiscais/status` (`{ versao, status }`, só administrador; mesma `versao` da tabela, 409 se outro admin salvou antes). A tarja azul sai de `avisosDaTabelaFiscal` e entra em todo cálculo quando a tela de cálculo for ligada (etapa 5). **Item obrigatório da etapa 5, com teste:** todo resultado de cálculo inclui os avisos da tabela fiscal.

Regras do status (revisão de 25/11/2026):
- **Qualquer edição de uma tabela "Validada" a volta sozinha para "Provisório"**, com uma linha de histórico (status VALIDADO → PROVISORIO). É a escolha conservadora, porque um valor novo nunca foi validado pelo fiscal. Salvar sem mudar nada não mexe no status.
- O recolhimento a consumidor final nasce em 100% (resposta do fiscal) e **não aproveita** o valor da coluna antiga `recolhimento_icms_mg_nao_contribuinte` (era 0%, aguardando o fiscal).
- Num banco novo, as alíquotas internas entram direto como valor inicial, sem linha de histórico. A linha "Valor inicial: Buscador NCM…" só aparece num banco que já existia com as alíquotas vazias.

## Avisos (tarjas)

Toda inconsistência do cálculo aparece como uma **tarja no topo do resultado**, dizendo o que está errado, em qual item e como resolver. As tarjas vêm do cálculo, como uma lista de avisos com **nível, código, item e mensagem**; a tela só as exibe, nunca as monta. A simulação salva e o PDF levam as mesmas tarjas.

**Vermelha: bloqueia, o preço não é exibido.**

| Código | Quando | Mensagem / como resolver |
| --- | --- | --- |
| `PRODUTO_SEM_ESTRUTURA` | Produto sem estrutura no Omie | Cadastrar a estrutura no Omie |
| `ALIQUOTA_INTERNA_UF_NAO_CONFIGURADA` | Cenário D com a alíquota interna da UF vazia | "Peça ao administrador para preencher a UF X na tabela fiscal" |
| `ICMS_INTERESTADUAL_UF_NAO_CONFIGURADO` | Venda interestadual com a UF sem ICMS interestadual | "Peça ao administrador para preencher a UF X na tabela fiscal" |
| `IPI_VENDA_NCM_NAO_CONFIGURADO` | Produto acabado sem NCM no Omie ou com NCM fora da tabela NCM → IPI | "Peça ao administrador para preencher o NCM X na tabela NCM → IPI" (ou corrigir o NCM no Omie) |
| `CLIENTE_INCONSISTENTE` | Ex.: cliente com PTA de fora de MG ou não contribuinte; venda "para industrialização" e "para uso e consumo" ao mesmo tempo, ou para industrialização a não contribuinte | Corrigir o cadastro do cliente ou a finalidade da venda |
| `OMIE_INDISPONIVEL` | Erro ou demora da Omie | "Não foi possível consultar o Omie. Tente de novo em alguns minutos" |
| `SEM_PRECO_POSSIVEL` | Impostos + comissão + despesas + margem ≥ 100% | Reduzir a margem, a comissão ou as despesas |

**Amarela: preço exibido, marcado "INCOMPLETO – não usar em cotação".**

| Código | Quando | Mensagem / como resolver |
| --- | --- | --- |
| `ITEM_SEM_CUSTO` | Item sem custo (entra como zero) | Lista os códigos, com botão para digitar o custo manual |
| `ITEM_SEM_NCM_IPI` | Componente sem NCM no cadastro ou com NCM fora da tabela NCM → IPI (entra pelo bruto, sem crédito) | "Corrija o NCM do item X no Omie" ou "preencha o NCM na tabela NCM → IPI" |
| `COMPONENTES_NAO_CONSULTADOS` | Estrutura com mais de **150** componentes (a spec previa 60, mas o PA00000001 já tem 69) | Lista os itens que ficaram de fora da consulta; eles entram sem custo |
| `ITEM_SEM_DADOS_FISCAIS` | Custo manual sem UF ou tipo de fornecedor (entra pelo valor da nota, sem crédito). A gravação exige os dois: é só defesa | "Informe UF e tipo de fornecedor no custo manual do item X" |

**Azul: informativa.**

| Código | Quando |
| --- | --- |
| `CUSTO_MANUAL_DIFERENTE_OMIE` | Custo manual diferente do custo do Omie (mostra os dois) |
| `DIFAL_BASE_SIMPLES` | Cenário D: "validar com o fiscal" |
| `PARAMETROS_FISCAIS_PROVISORIOS` | Tabela fiscal com status "Provisório": "Parâmetros fiscais ainda não validados pelo fiscal" (em todo cálculo) |
| `PRECO_CHEIO_INDISPONIVEL` | Só o preço cheio passa de 100% no divisor; vale o piso |

**Modo reverso:** preço-alvo abaixo do piso dá tarja **vermelha no bloco do resultado do modo reverso** (`ALVO_ABAIXO_DO_PISO`), sem bloquear o preço principal.

**Testes:** um teste por aviso. Implementados na etapa 1: `ALIQUOTA_INTERNA_UF_NAO_CONFIGURADA`, `ICMS_INTERESTADUAL_UF_NAO_CONFIGURADO`, `CLIENTE_INCONSISTENTE`, `SEM_PRECO_POSSIVEL`, `ITEM_SEM_CUSTO`, `ITEM_SEM_NCM_IPI`, `DIFAL_BASE_SIMPLES`, `PRECO_CHEIO_INDISPONIVEL` e `ALVO_ABAIXO_DO_PISO`. Na etapa 3: `CUSTO_MANUAL_DIFERENTE_OMIE`. Em 25/11/2026: `PARAMETROS_FISCAIS_PROVISORIOS` entrou e `MG_CONSUMIDOR_FINAL_ICMS` saiu (o fiscal respondeu). `CUSTO_ESTIMADO` entrou e saiu em 26/11/2026 (o `nCMC` já é líquido). Na etapa 4 (26/11/2026): `PRODUTO_SEM_ESTRUTURA`, `OMIE_INDISPONIVEL`, `COMPONENTES_NAO_CONSULTADOS`, `ITEM_SEM_DADOS_FISCAIS`, `IPI_VENDA_NCM_NAO_CONFIGURADO` e `CLIENTE_INCONSISTENTE` do cadastro do cliente. `GGF_AUSENTE` foi retirado em 25/11/2026 (sem GGF separado).

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
- Lista dos componentes, cada um com a origem do custo; no custo manual, UF de origem e créditos retirados (o custo do Omie aparece como "já líquido").
- Origem do custo de cada item (Omie, Manual ou Sem custo), campo para digitar o custo e, quando houver custo manual e do Omie ao mesmo tempo, os dois valores para o operador escolher.
- Aviso em destaque "Preço incompleto: X itens sem custo" quando faltar custo.

**Ações:** salvar a simulação e exportar em PDF para anexar ao orçamento.

## Arquitetura técnica

A tela entra no app existente (Node.js 24 + Express, deploy no Vercel pelo branch `main`), seguindo os padrões que já estão no repositório.

**Módulos**

- `omie` – cliente da API do Omie (reaproveitar o que já existe): produto, estrutura, estoque (custo médio), cliente.
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
| `GET /api/precificacao/custos-manuais` / `PUT` e `DELETE /api/precificacao/custos-manuais/:codigo` | Lê, grava e remove custo manual salvo, com `versao` (409 se outro usuário mudou antes) e validação estrita (400) |
| `GET /api/precificacao/custos-manuais/historico?codigo=&limite=` | Histórico dos custos manuais |
| `GET /api/precificacao/clientes-pta` / `GET /api/precificacao/clientes-pta/:codigo` | Clientes com PTA (permissão `precificacao`) |
| `PUT /api/precificacao/clientes-pta/:codigo` | Marca ou desmarca "cliente com PTA" (`{ versao, comPta }`, só administrador, 409 se outro admin mudou antes, histórico). O servidor confere o cliente no Omie (só leitura); nome e CNPJ/CPF vêm de lá |
| `GET /api/precificacao/clientes-pta/historico?codigo=&limite=` | Histórico dos clientes com PTA (só administrador) |
| `GET /api/precificacao/conferencia-cadastro?produto=` ou `?pagina=` | Relatório de conferência do cadastro (só administrador; Omie só leitura; lotes de 10 produtos) |
| `GET /api/precificacao/clientes/busca?cnpj=` ou `?nome=` | Busca de cliente no Omie (só leitura, `ListarClientes`), com a situação no app |

Rotas da tabela fiscal com o prefixo `/api/precificacao/parametros-fiscais` (para não confundir com os parâmetros fiscais do módulo de fretes).

**Dados persistidos:** tabela fiscal, histórico de alterações, custos manuais e seu histórico, simulações salvas (com o custo usado em cada item), tabela NCM → IPI (`precificacao_ipi_ncm`) e "cliente com PTA (compra para industrialização)" (`precificacao_clientes_pta` e histórico). Banco: o Postgres/Supabase que o app já usa (`src/db.ts`); tabelas criadas com `CREATE TABLE IF NOT EXISTS`. **Atenção:** o Preview do Vercel usa o mesmo `DATABASE_URL` da produção — só são criadas tabelas novas da precificação, nunca alteradas ou apagadas tabelas existentes.

**Cache:** cadastro e estoque em cache (60 e 10 minutos); estrutura a avaliar na etapa 5, para não estourar o limite de chamadas do Omie, com botão "atualizar custos" na tela.

**Testes:** casos unitários de `precificacao` com o exemplo numérico da próxima seção, um por cenário (A, B, C, D) e o modo reverso. Para o custo manual: produto com item sem custo (preço incompleto), com custo manual salvo, e com custo manual que sobrepõe o Omie.

## Exemplo numérico de validação

Com custo líquido de R$ 90,75, comissão de 3%, despesas de 10% e margem de 12% antes do IR/CS, o sistema tem de devolver exatamente estes valores (sem IPI, sem DIFAL). Os percentuais são ilustrativos e servem de caso de teste.

| Caso | Divisor | Preço | Lucro antes do IR/CS | Lucro depois do IR/CS |
| --- | --- | --- | --- | --- |
| C, cheio (ICMS 12%) | 0,5486 | R$ 165,42 | R$ 39,70 (24,0%) | R$ 26,20 (15,8%) |
| C, piso (ICMS 12%) | 0,6686 | R$ 135,73 | R$ 16,29 (12,0%) | R$ 10,75 (7,9%) |
| A, MG com PTA, venda para industrialização | 0,6575 | R$ 138,02 | R$ 16,56 (12,0%) | R$ 10,93 (7,9%) |

No caso C cheio, os 12 pontos de margem a mais são o ICMS destacado e não recolhido (R$ 19,85).

## Pontos de atenção e próximos passos

**Validar com o fiscal antes de usar em cotação real**

- Alíquotas internas de MG por NCM (cenário B) e a regra de DIFAL por UF (base simples ou dupla).
- Se os custos unitários da ficha técnica já incluem o IPI da compra.
- O IPI fora da base do PIS/COFINS e do ICMS na compra para industrialização.
- ~~Se o PTA cobre venda a não contribuinte/consumidor final~~ — respondido em 25/11/2026: não cobre; o ICMS é recolhido (padrão 100%, editável).
- As alíquotas internas por UF (valores iniciais do Buscador NCM, nov/2026) e o FCP por produto. Até o fiscal validar a tabela inteira, ela fica "Provisório", com tarja azul em todo cálculo.
- DIFAL de contribuinte de outra UF comprando para uso e consumo: pela LC 190/2022, quem recolhe é o destinatário; hoje o cálculo trata como custo da ETK (cenário D).

**Próximos passos (no VS Code, sobre o repositório do ETK Comissão)**

- [x] Ler o repositório e mapear o cliente do Omie e o banco já usados.
- [x] Validar a fonte do custo com o PA00000001: custo médio do estoque (`nCMC`), sem GGF separado (decisões de 25/11/2026).
- [x] Confirmar no Preview se o "Valor GGF" (R$ 59,76) do relatório é o custo total do produto: confirmado em 25/11/2026.
- [x] Respostas do fiscal de 25/11/2026 (ICMS na compra só 0% com fornecedor de MG com PTA; consumidor final recolhe; cenário A só com PTA + industrialização; alíquotas internas iniciais; status "Provisório / Validado"): cálculo, tabela fiscal, telas e testes.
- [x] Criar o módulo `precificacao` com os testes do exemplo numérico (etapa 1).
- [x] Criar a tabela fiscal e a tela de administração (etapa 2).
- [x] Custo manual (tabela própria, histórico, prioridade sobre o Omie, preço incompleto, formulário com UF, PTA, tipo de fornecedor e IPI): etapa 3. O IPI pré-preenchido pelo cadastro do Omie e o uso no preço entram nas etapas 4 e 5.
- [x] Tabela NCM → IPI (parte da tabela fiscal) e "cliente com PTA" no app (decisões de 26/11/2026).
- [x] Integrar estrutura, custo médio, cadastro (NCM) e cliente do Omie (notas de entrada retiradas em 26/11/2026: o `nCMC` já é líquido) (etapa 4, 26/11/2026; ver "Etapa 4 — como foi implementada").
- [x] Relatório de conferência do cadastro (sem NCM no Omie / NCM fora da tabela NCM → IPI), só leitura.
- [ ] Montar a tela e validar com 3 produtos reais junto com o fiscal.
- [ ] Publicar em preview no Vercel antes de ir para produção.
