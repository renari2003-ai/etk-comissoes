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
| ICMS na compra dentro de MG | Sai zero na nota (diferimento). Nada a ajustar no custo. |
| ICMS na compra fora de MG | Destacado na nota e **fica no custo**, sem crédito. |
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

**Regra de fallback:** componente sem nota de entrada no Omie usa os percentuais médios da tabela fiscal e aparece marcado na tela como "estimado".

**Validação da fonte de custo (24/11/2026):** relatório do PA00000001 (CEO SOFS 12/24 FO 4D): Valor GGF R$ 59,76; PI10000014 0,192111; MP00000008 17,06279; MO00000013 5,238053; MO00000037 e MP00000045 sem custo unitário. A rota temporária `GET /api/precificacao/diagnostico/:codigo` (só administrador, só leitura, **removida antes de produção**) mostra de qual campo da API sai cada número. Se o custo dos itens for o `nCMC`, a decisão de usá-lo volta ao usuário antes de seguir, porque o código atual o considera pouco confiável (ver `src/calculo/custoEstimado.ts`).

## Custo manual

O Omie ainda é novo na ETK e parte dos componentes vem sem custo. Por isso todo item da estrutura, e também o GGF, aceita custo manual.

**Origem do custo por item.** Cada linha da estrutura mostra uma de três origens: **Omie**, **Manual** ou **Sem custo**. Item sem custo aparece destacado, já com o campo para digitar.

**Digitar ou corrigir.** O operador pode digitar o custo de qualquer item, mesmo os que têm custo do Omie, e o GGF. Ao confirmar, escolhe:

- **Só nesta simulação:** vale para o cálculo atual (e fica gravado na simulação, se for salva), sem afetar os próximos cálculos.
- **Salvar para próximos cálculos:** grava na tabela de custos manuais e passa a ter **prioridade sobre o Omie**.

**Como o custo manual é digitado.** Como aparece na nota de compra, **com impostos**, junto com a marcação **dentro de MG** ou **fora de MG**. O sistema retira os créditos com os percentuais da tabela fiscal, pela mesma regra das notas de entrada:

- Dentro de MG: ICMS zero (diferimento); retira o IPI e o PIS/COFINS.
- Fora de MG: o ICMS fica no custo; retira o IPI e o PIS/COFINS (calculado sem o ICMS na base).
- Os percentuais médios usados nessa conta (IPI na compra e ICMS na compra fora de MG) ficam na tabela fiscal — **valores iniciais a definir com o fiscal**.

**Conflito com o Omie.** Se um item com custo manual salvo passar a ter custo no Omie, a tela mostra os dois valores e o operador escolhe qual usar. Até ele escolher, vale o manual (regra de prioridade).

**Preço incompleto.** Se algum item continuar sem custo, o preço é calculado mesmo assim (o item entra com custo zero) e a tela mostra em destaque **"Preço incompleto: X itens sem custo"**. A simulação salva registra essa condição.

**Rastreabilidade.** A simulação salva guarda, item a item, o custo usado, a origem (Omie, Manual salvo, Manual só da simulação, Sem custo), a marcação dentro/fora de MG e os créditos retirados, para a conta poder ser reconstruída depois, mesmo que o Omie ou a tabela de custos manuais mudem.

**Tabela de custos manuais.** Código do componente (ou do produto acabado, para o GGF), custo com impostos, dentro/fora de MG, data e usuário. Toda alteração vai para um histórico com data, usuário, valor anterior e valor novo. Fica no banco do app, **nunca** é gravada no Omie.

## Regras de cálculo

O preço sai em sete passos: custo líquido, cenário, divisor, preço cheio e piso, IPI por fora, lucro antes e depois do IR/CS e, se pedido, o modo reverso.

1. **Custo bruto** = soma de (quantidade × custo unitário) de cada componente + GGF.
2. **Custo líquido**: para cada componente, retira os créditos da última nota de entrada.
   - PIS/COFINS: 9,25% sobre o valor do item sem o ICMS destacado.
   - IPI: o valor destacado na nota.
   - ICMS: nada a retirar (zero dentro de MG; custo quando vem de fora).
3. **Cenário de venda** define os percentuais sobre o preço:

| Cenário | ICMS destacado | ICMS recolhido | PIS/COFINS efetivo | DIFAL |
| --- | --- | --- | --- | --- |
| A. MG, cliente autorizado | 0% | 0% | 9,25% | não |
| B. MG, cliente não autorizado | alíquota interna do NCM | 0% | 9,25% × (1 − ICMS) | não |
| C. Outra UF, contribuinte | 12%, 7% ou 4% | 0% | 9,25% × (1 − ICMS) | não |
| D. Outra UF, não contribuinte ou uso e consumo | 12%, 7% ou 4% | 0% | 9,25% × (1 − ICMS) | sim, alíquota interna do destino − interestadual |

4. **Preço cheio** (o ICMS destacado entra no divisor como se fosse pago; vira margem extra):

```latex
P_{cheio} = \frac{C_{liq}}{1 - (ICMS + PC_{ef} + DIFAL + Com + Desp + M)}
```

5. **Preço piso** (o ICMS não é custo, porque não é recolhido):

```latex
P_{piso} = \frac{C_{liq}}{1 - (PC_{ef} + DIFAL + Com + Desp + M)}
```

6. **IPI** = preço × alíquota do NCM, somado por fora. A tela mostra o preço sem e com IPI.
7. **Lucro** para qualquer preço P:
   - Antes do IR/CS = P − C\_liq − PIS/COFINS − DIFAL − comissão − despesas (o ICMS destacado fica todo no lucro).
   - Depois do IR/CS = lucro antes × (1 − 34%).

**Margem informada como líquida:** o sistema converte para margem antes do IR/CS dividindo por 0,66 (10% líquido vira cerca de 15,2%).

**Modo reverso:** o usuário digita o preço-alvo e o passo 7 devolve o lucro e as margens antes e depois do IR/CS. Se o preço-alvo ficar abaixo do piso, a tela avisa em vermelho.

## Tabela fiscal editável e campos novos

Os percentuais vivem numa tabela de parâmetros, editada por uma tela de administração, para nenhuma mudança de alíquota exigir deploy.

| Parâmetro | Valor inicial | Observação |
| --- | --- | --- |
| PIS/COFINS não cumulativo | 9,25% | Crédito e débito |
| IRPJ + CSLL sobre o lucro | 34% | Editável por causa do adicional de 10% |
| Ganho do ICMS na base de PIS/COFINS | Desligado | Decisão favorável de 2025 |
| ICMS interestadual por UF de destino | 12% ou 7% | Tabela com as 26 UFs fora de MG |
| ICMS para conteúdo importado | 4% | Usa a origem do produto |
| ICMS interno de MG por NCM | do cadastro | Cenário B |
| Alíquota interna de cada UF (para DIFAL) | por UF | Cenário D |
| Percentual de recolhimento do ICMS na venda | 0% | Para a transição da Reforma Tributária (2029 a 2033) |
| IPI médio na compra | a definir com o fiscal | Crédito de IPI do custo manual e de componente sem nota de entrada |
| ICMS médio na compra fora de MG | a definir com o fiscal | Base do crédito de PIS/COFINS do custo manual fora de MG |
| Despesas fixas padrão | último valor usado | Preenchido na hora de gerar |
| Comissão | 1% a 4% | Escolhida na tela |

**Campo novo no cadastro de cliente:** "Autorizado diferimento MG (S/N)". Pode ser um campo adicional no Omie ou uma tabela própria do app, indexada pelo código do cliente.

**Histórico:** toda alteração na tabela fiscal guarda data, usuário e valor anterior.

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
| `GET /api/parametros-fiscais` | Lê a tabela fiscal |
| `PUT /api/parametros-fiscais` | Altera a tabela (só administrador), grava histórico |
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

**Próximos passos (no VS Code, sobre o repositório do ETK Comissão)**

- [x] Ler o repositório e mapear o cliente do Omie e o banco já usados.
- [ ] Validar a fonte do custo e do GGF com o PA00000001 (rota temporária de diagnóstico no Preview).
- [ ] Criar o módulo `precificacao` com os testes do exemplo numérico.
- [ ] Criar a tabela fiscal e a tela de administração.
- [ ] Custo manual (tabela própria, histórico, prioridade sobre o Omie, preço incompleto).
- [ ] Integrar estrutura, notas de entrada e cliente do Omie.
- [ ] Montar a tela e validar com 3 produtos reais junto com o fiscal.
- [ ] Publicar em preview no Vercel antes de ir para produção.
