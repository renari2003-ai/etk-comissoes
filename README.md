# Relatório de Custo e Margem — Pedidos de Venda Omie

Aplicativo local, **somente leitura**, que consulta a API da Omie e calcula
informações que a Omie não fornece diretamente sobre um pedido de venda:
custo unitário e total por item, margem em reais, margem sobre a venda,
markup sobre o custo e o resumo operacional do pedido.

O aplicativo **nunca** cria, altera ou exclui dados na Omie. Todas as
chamadas usam apenas métodos de consulta: `ListarPedidos`, `ConsultarPedido`,
`ConsultarProduto`, `ListarPosEstoque`, `ListarEtapasFaturamento`,
`ListarVendedores`, `ConsultarCliente` e `ListarContasReceber`.

Além da consulta individual de um pedido/orçamento, há uma área de
**Relatórios** com três visões agregadas — Vendas, Orçamentos e
Comissionamento — ver [seção dedicada](#relatórios-vendas-orçamentos-e-comissionamento) abaixo.

## Instalação

### Pré-requisitos

- Node.js 18 ou superior (recomendado 20+, para o carregamento nativo de `.env`).

### Passos

```bash
npm install
```

### Configuração do `.env`

1. Copie o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```
2. Preencha `OMIE_APP_KEY` e `OMIE_APP_SECRET` com as credenciais do **seu**
   aplicativo Omie (veja a seção [Segurança](#segurança) sobre como criar um
   aplicativo dedicado, somente leitura).
3. Opcionalmente ajuste `PORTA` e `OMIE_INTERVALO_MIN_MS`.

O arquivo `.env` nunca é commitado (está no `.gitignore`) e seu conteúdo
nunca é impresso em log, resposta de API ou arquivo gerado pelo aplicativo.

### Executar

```bash
npm start
```

Isso compila o TypeScript (backend e frontend) e inicia o servidor. Acesse
`http://localhost:3000` no navegador (ou a porta configurada em `PORTA`).

Para desenvolvimento com recompilação automática do backend:

```bash
npm run dev
```

(nesse modo, reinicie `node dist/server.js` manualmente após cada mudança,
ou rode em outro terminal).

### Executar os testes

```bash
npm test
```

Os testes do núcleo (cálculo de custo, margem e montagem do relatório) usam
um **cliente Omie falso**, com respostas fixas — nenhum teste toca a rede ou
depende da Omie real.

## De onde vem o custo

O custo unitário de cada produto vem do **custo de entrada mais recente
disponível na posição de estoque** (`ObterEstoqueProduto`), não do cadastro
do produto.

### Lista de campos candidatos

O módulo [`src/calculo/custo.ts`](src/calculo/custo.ts) define, no topo do
arquivo, a constante `CAMPOS_CUSTO_CANDIDATOS`:

```ts
export const CAMPOS_CUSTO_CANDIDATOS: readonly string[] = [
  'nCMC',
  'nCustoMedio',
  'nPrecoUnitario',
  'nCustoUnitario',
];
```

Para alterar quais campos são usados, ou a ordem de prioridade entre eles,
edite essa lista. Nenhuma outra parte do código precisa mudar.

### Algoritmo de busca

1. Percorre os registros de `listaEstoque` da resposta, na ordem em que
   aparecem, procurando o **primeiro campo candidato** (na ordem da lista
   acima) que exista, seja convertível para número e seja maior que zero.
2. Se nada for encontrado em `listaEstoque`, repete a busca nos campos do
   **nível raiz** da resposta.
3. Se ainda assim nada for encontrado, o custo unitário é `0` e a origem é
   `"sem custo"`.
4. Se a própria consulta de estoque falhar (erro de rede, produto sem
   estoque cadastrado, etc.), o custo unitário é `0` e a origem é
   `"indisponivel"`. **Um produto com problema nunca derruba o relatório
   inteiro** — os demais itens continuam sendo calculados normalmente.

A origem do custo (`estoque.nCMC`, `raiz.nPrecoUnitario`, `sem custo`,
`indisponivel`, etc.) fica disponível tanto na API (`origemCusto` de cada
item) quanto na exportação CSV, para rastreabilidade total.

Itens sem custo **permanecem no relatório e entram nos totais** — nunca são
escondidos ou excluídos — e recebem um alerta próprio, pois um custo zero
infla artificialmente a margem calculada.

## Fórmulas

Por item:

```
receita       = valor_mercadoria
                (ou quantidade × valor_unitario − valor_desconto, se valor_mercadoria ausente)
custo_total   = custo_unitario × quantidade
margem_valor  = receita − custo_total

margem_venda% = margem_valor / receita        (quanto sobra de cada real vendido)
markup_custo% = margem_valor / custo_total     (quanto a venda representa de ganho sobre o custo)
```

**Margem e markup não são a mesma coisa.** Um markup de 100% sobre o custo
corresponde a uma margem de 50% sobre a venda — não a 100%. Exemplo: um
produto que custa R$ 50 e é vendido por R$ 100 tem markup de 100%
(50/50 = 100%) e margem de 50% sobre a venda (50/100 = 50%). A interface e o
CSV sempre exibem as duas métricas lado a lado, identificadas separadamente.

### Divisão por zero

- Receita igual a zero → `margem_venda_percentual = null` (nunca zero
  artificial, `Infinity` ou `NaN`).
- Custo igual a zero → `markup_custo_percentual = null`, pelo mesmo motivo.

## Margem total do pedido

```
receita_total = soma das receitas dos itens
custo_total   = soma dos custos totais dos itens
margem_total  = receita_total − custo_total

margem_venda_total% = margem_total / receita_total
```

Isso é calculado exatamente assim porque **pondera cada item pelo seu peso
financeiro real** no pedido.

**A margem percentual total nunca é a média das margens percentuais dos
itens.** Essa abordagem estaria errada: um item de R$ 10.000 com 5% de
margem e um item de R$ 10 com 90% de margem não têm o mesmo peso no
resultado final do pedido, e uma média simples (47,5%) distorceria
completamente a leitura real da rentabilidade. O cálculo correto
(`margem_total / receita_total`) reflete o resultado financeiro agregado de
verdade. O teste [`tests/calculo/margem.test.ts`](tests/calculo/margem.test.ts)
("Caso 4") verifica isso explicitamente e falha se alguém substituir o
cálculo por uma média de percentuais.

## Frete e despesas acessórias

O total do pedido informado pela Omie (`total_pedido.valor_total_pedido`)
pode incluir frete, seguro e outras despesas acessórias que **não** entram
no custo de produto e, portanto, não fazem parte da margem calculada por
este aplicativo.

Por isso, o relatório compara `receita_total` calculada com o total
informado pela Omie. Se a diferença for maior que **R$ 0,05**, um alerta é
exibido, explicando essa possível causa e mostrando os dois valores e a
diferença — nunca escondendo a divergência.

## Requisições à Omie

- **Espaçamento mínimo**: configurável via `OMIE_INTERVALO_MIN_MS` (padrão
  `300` ms). Implementado como uma fila que serializa todas as chamadas,
  segura mesmo com requisições concorrentes.
- **Retry com espera crescente**: aplicado apenas para erro `425` (limite de
  requisições excedido), falha de rede e resposta que não seja JSON válido
  (até 3 tentativas, com backoff de 500ms/1s/2s). Qualquer outro erro da
  Omie (regra de negócio, dado inválido etc.) sobe imediatamente, sem
  retry — para não mascarar problemas reais.
- **Detecção de erro**: a Omie pode responder HTTP 200 mesmo em caso de
  falha. O cliente sempre verifica `faultstring`/`faultcode` no corpo da
  resposta, independentemente do status HTTP.
- **Cache em memória**: consultas de produto e de estoque são cacheadas
  durante a execução do processo — o mesmo produto, aparecendo em várias
  linhas do mesmo pedido, não gera chamadas repetidas. O cache não é
  persistido em arquivo ou banco. Pode ser limpo a qualquer momento, sem
  reiniciar o servidor, via `POST /api/cache/limpar`.
- **Listagem de pedidos/orçamentos**: a Omie rejeita como "consumo
  redundante" duas chamadas `ListarPedidos` idênticas em sequência. Como
  `/api/pedidos` e `/api/orcamentos` fazem a mesma chamada subjacente para a
  mesma página (a Omie pagina os dois tipos juntos — a separação é
  filtrada localmente), o resultado bruto de cada combinação de filtros é
  cacheado em memória: trocar de aba ou repetir a mesma consulta reaproveita
  a página já buscada, em vez de disparar o bloqueio da Omie. Use
  `POST /api/cache/limpar` para forçar uma releitura.
- **Posição de estoque**: a Omie não oferece consulta de estoque por produto
  individual, apenas a listagem paginada `ListarPosEstoque` com todos os
  produtos na data informada. Por isso a posição inteira é buscada (com
  paginação de 500 registros por página) e cacheada em memória por data de
  referência na primeira vez que um item daquele pedido precisa de custo; as
  buscas seguintes (mesmo pedido ou outros pedidos com a mesma data) usam o
  resultado já cacheado.

## Segurança

- **Crie um aplicativo dedicado** no painel da Omie exclusivamente para esta
  ferramenta, com permissão apenas de **consulta** (leitura).
- **Limite o acesso** desse aplicativo às áreas necessárias: Pedidos de
  Venda, Produtos e Estoque. Não conceda permissão de escrita em nenhuma
  área.
- As credenciais são lidas exclusivamente de variáveis de ambiente
  (`OMIE_APP_KEY`, `OMIE_APP_SECRET`). Elas nunca são impressas em log,
  retornadas por qualquer rota da API, incluídas em mensagens de erro ou
  gravadas em arquivo (CSV incluído).
- `GET /api/saude` informa apenas `credenciaisCarregadas: true/false`,
  nunca o conteúdo das credenciais.
- Toda entrada de usuário (identificador de pedido, paginação, datas, etapa,
  flag `por_codigo`) é validada no backend antes de qualquer uso —
  `por_pagina` é sempre limitado a no máximo 200.
- Dados vindos da Omie são tratados como não confiáveis ao serem exibidos no
  navegador: o frontend usa `textContent`/criação de nós DOM, nunca
  `innerHTML`, para renderizar qualquer valor vindo da API.
- Erros internos nunca expõem stack trace, caminhos de arquivo ou variáveis
  de ambiente ao cliente — apenas uma mensagem segura e uma sugestão de
  próximo passo.

## Simulação de precificação (markup editável) — exclusiva de Orçamento

Na tela de um **Orçamento**, a tabela de itens ganha quatro colunas
adicionais para simular um preço de venda diferente do original, sem alterar
nenhum dado da Omie:

| Coluna | Fórmula |
|---|---|
| Markup editável | Editável. Valor inicial = `preço unitário original ÷ custo unitário` |
| Preço de venda | `custo unitário × markup editável` |
| Preço total | `quantidade × preço de venda` |
| Subtotal | igual ao Preço total |

A soma dos subtotais de todos os itens é exibida em destaque como **Valor
total do orçamento (simulação de venda)**, logo acima da tabela, e é
recalculada instantaneamente a cada edição de markup — sem recarregar a
página nem consultar a Omie novamente.

Regras de cálculo (ver [`public-src/precificacao.ts`](public-src/precificacao.ts)):

- **Nenhum arredondamento intermediário**: a cadeia custo → preço de venda →
  preço total é calculada com a precisão nativa do JavaScript; o
  arredondamento acontece só na formatação para exibição.
- **Custo zero nunca causa divisão por zero**: o markup inicial fica
  indeterminado (`null`, nunca `Infinity`/`NaN`), com aviso "Sem custo" no
  campo. Se o usuário digitar um markup mesmo assim, o preço de venda
  resultante é `0` (custo `0` × qualquer markup = `0`) — o sistema nunca
  inventa um preço.
- **Markup inválido nunca é calculado**: texto não numérico ou negativo
  destaca o campo, explica o motivo, e **mantém os últimos valores válidos**
  nas colunas calculadas e no valor total — a edição inválida não se
  propaga.
- **Markup zero é um valor válido** (decisão de negócio documentada aqui):
  resulta em preço de venda e total iguais a zero, não é tratado como erro.
- Esta simulação é **local ao navegador**: nada é enviado à Omie, e os
  valores originais do orçamento (Preço unit., Receita, Markup s/ custo já
  existentes) permanecem intactos e visíveis ao lado.
- Por representar uma simulação sobre uma **intenção de compra**, esta
  funcionalidade só aparece na categoria Orçamento — nunca em Pedido, que já
  é uma venda concretizada.

## Separação obrigatória entre Pedido e Orçamento

A Omie modela Orçamento e Pedido de Venda como o **mesmo tipo de documento**
(`pedido_venda_produto`), diferenciados apenas pelo campo `cabecalho.etapa`.
Os *códigos* de etapa — e principalmente os **rótulos** exibidos para cada
um — são configuráveis por conta, em Configurações de Venda de Produtos >
Kanban de Vendas. **Não existe um código de etapa fixo e universal** que
signifique "isto é um orçamento" em todas as contas Omie: a documentação
genérica da Omie sugere etapa `"00"`, mas isso não é garantido.

Por isso a classificação nunca usa um código de etapa fixo no código-fonte.
Em vez disso, consulta a configuração real da conta via
`ListarEtapasFaturamento` (`/produtos/etapafat/`, operação "Venda de
Produto" — `cCodOperacao` `"11"`) e verifica se a **descrição configurada**
para aquela etapa contém a palavra "orçamento" (ver
[`src/omie/classificacaoDocumento.ts`](src/omie/classificacaoDocumento.ts)).

Verificado em 2026-09-04 contra a conta configurada no `.env` deste
projeto: a etapa `"00"` (inativa) **e** a etapa `"10"` (ativa, em uso
corrente) estão **ambas** rotuladas "Orçamento" nesta conta — prova de que
um código fixo não seria confiável.

Quando a etapa de um documento não existe na configuração retornada pela
Omie, a classificação fica **ambígua**: o documento nunca é tratado como
PEDIDO nem como ORÇAMENTO por padrão. Ele é excluído das listagens
(`/api/pedidos` e `/api/orcamentos`) e, se consultado diretamente por
identificador, o relatório é retornado com `tipoDocumento: null` e um
`motivoClassificacaoAmbigua` explicando o motivo — nunca classificado por
adivinhação.

As rotas de detalhe/CSV são específicas por tipo
(`/api/pedido/:id` vs. `/api/orcamento/:id`) e **rejeitam com HTTP 409**
quando o identificador informado corresponde ao tipo errado — nunca
misturando as duas categorias, mesmo em uma consulta direta por número.

## Relatórios (Vendas, Orçamentos e Comissionamento)

Além da consulta individual, há uma área de **Relatórios** (aba no topo da
interface) com três visões agregadas, cada uma **completamente separada das
outras** — nunca uma tabela ou total misturando categorias diferentes:

- **Vendas** — apenas PEDIDO (compra concreta).
- **Orçamentos** — apenas ORÇAMENTO (intenção de compra), rotulado como
  "Potencial Comercial", nunca somado a Vendas como se fosse faturamento.
- **Comissionamento** — calculado **exclusivamente** sobre Vendas. Um
  orçamento nunca gera comissão, mesmo que sua margem caia numa faixa alta.

Cada relatório tem filtro de período (`data_de`/`data_ate` — filtram pela
**data de previsão do pedido** informada na Omie, a única data disponível em
`ListarPedidos`), filtro por vendedor (carregado diretamente de
`ListarVendedores`, nunca uma lista fixa no código) e busca local por
número/cliente/vendedor.

### Decisões de negócio explicitamente documentadas

A Omie não expõe nenhum dos campos abaixo prontos — por isso, em vez de
adivinhar, as seguintes definições foram fixadas no código
(`src/comissionamento/calcularMargemComissionamento.ts` e
`calcularComissao.ts`) e confirmadas com o usuário:

- **REGRA CRÍTICA — o custo do produto NUNCA é abatido no cálculo da
  margem de comissionamento nem da base da comissão.** Confirmado
  explicitamente em 2026-09-05, após uma primeira implementação incorreta
  ter usado a margem de custo/venda (`margemVendaTotal`) para determinar a
  faixa — essa métrica de custo continua disponível no relatório apenas
  para análise comercial, mas nunca influencia a comissão.
- **Fórmula oficial**: `margem_comissionamento % = (valor_da_venda − despesas) ÷ valor_da_venda × 100`.
  - **"Valor da venda"** = `total_pedido.valor_total_pedido` (bruto, inclui
    impostos destacados na nota) — é também a **base da comissão**
    (`base × percentual da faixa`), conforme o exemplo do usuário.
  - **"Despesas"** = impostos da venda + frete/seguro/outras despesas.
    - *Impostos*: `valor_da_venda − soma(valor_mercadoria dos itens)`. Optou-se
      por essa diferença em vez de somar campos individuais de imposto
      (`valor_IPI`, `valor_icms`, `valor_st`, `valor_pis`, `valor_cofins`,
      `valor_ibs`, `valor_cbs`...) porque a Reforma Tributária introduziu
      campos novos (IBS/CBS) que coexistem com os antigos (ICMS/PIS/COFINS)
      nesta conta, arriscando contagem duplicada ao somar linha por linha.
    - *Frete/seguro/outras despesas*: `frete.valor_frete` +
      `frete.valor_seguro` + `frete.outras_despesas` do pedido (sempre 0
      nesta conta até o momento, mas somados por completude).
- **Faixas de comissão** (fixas, não configuráveis pela interface), aplicadas
  sobre a margem de comissionamento acima: margem ≤ 60% → 1%; 60% < margem
  < 71% → 2%; margem ≥ 71% → 3%.
- **Vínculo pedido ↔ título financeiro**: apenas títulos de
  `ListarContasReceber` com `id_origem: "VENR"` (gerados a partir de um
  Pedido de Venda) trazem `nCodPedido`/`numero_parcela` — títulos lançados
  manualmente (`id_origem: "MANR"`) não têm vínculo com nenhum pedido e são
  ignorados. Pedidos ainda não faturados legitimamente não têm título
  algum — aparecem marcados como "Nenhum título financeiro localizado".
- **Baixa financeira** = `status_titulo === "RECEBIDO"`. A Omie **não expõe
  uma data de baixa explícita** nesta consulta (`ConsultarContaReceber`
  retorna `recebimento: null` mesmo em títulos já "RECEBIDO", verificado em
  2026-09-05) — por isso a baixa é identificada apenas pelo status, sem data
  associada, e a interface nunca afirma "comissão paga": uma parcela baixada
  aparece como **"Baixado — comissão elegível"**, nunca "paga", porque a
  Omie não confirma que o repasse ao vendedor (etapa de folha de pagamento)
  de fato ocorreu.
- **Distribuição da comissão entre parcelas**: proporcional ao valor real de
  cada parcela (nunca dividida igualmente quando os valores diferem).

### Pendência conhecida (não implementada)

O **funil comercial** (quantidade de orçamentos convertidos em pedido, taxa
de conversão) não foi implementado. A Omie modela Orçamento e Pedido como o
**mesmo registro**, apenas com a etapa alterada ao longo do tempo — não há,
na API, um histórico de mudança de etapa. Calcular uma taxa de conversão
exigiria que esta aplicação guardasse um snapshot dos documentos ao longo do
tempo, o que contradiz o design atual (somente leitura, sem banco de dados,
cache apenas em memória durante a execução do processo). Implementar isso
exigiria adicionar persistência — uma mudança de arquitetura, não uma
funcionalidade pontual.

### Desempenho do relatório de Comissionamento

A Omie rejeita chamadas **concorrentes do mesmo método** ("Já existe uma
requisição desse método sendo executada"), então a busca de títulos por
vendedor é sequencial, um vendedor por vez. Num período com muitos
vendedores distintos, a primeira consulta pode levar de dezenas de segundos
a poucos minutos; consultas seguintes com os mesmos vendedores reaproveitam
o cache em memória e são quase instantâneas. Use `POST /api/cache/limpar`
para forçar uma releitura.

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/` | Serve a interface web (Consulta individual + Relatórios). |
| `GET` | `/api/pedidos` | Lista apenas documentos classificados como PEDIDO. Parâmetros: `pagina`, `por_pagina` (máx. 200), `etapa`, `data_de`, `data_ate` (dd/mm/aaaa). |
| `GET` | `/api/orcamentos` | Lista apenas documentos classificados como ORÇAMENTO. Mesmos parâmetros de `/api/pedidos`. |
| `GET` | `/api/pedido/:identificador` | Retorna o pedido completo, com custos, margens, totais, alertas e resumo operacional. Responde 409 se o identificador for de um orçamento. Parâmetro `por_codigo=true` para tratar o identificador como código interno em vez de número do pedido. |
| `GET` | `/api/pedido/:identificador/csv` | Exporta o mesmo relatório em CSV (`;`, UTF-8 com BOM). Aceita `por_codigo`. |
| `GET` | `/api/orcamento/:identificador` | Equivalente a `/api/pedido/:identificador`, mas para orçamentos — responde 409 se o identificador for de um pedido. Inclui `avisoOrcamento` explicando que os valores são projeção, não receita concretizada. |
| `GET` | `/api/orcamento/:identificador/csv` | Exporta o mesmo relatório em CSV. |
| `GET` | `/api/vendedores` | Lista os vendedores cadastrados na Omie (`codigo`, `nome`, `inativo`). |
| `GET` | `/api/relatorios/vendas` | Relatório agregado de Vendas (só PEDIDO). Parâmetros: `data_de`, `data_ate`, `vendedor` (código), `busca`. |
| `GET` | `/api/relatorios/orcamentos` | Relatório agregado de Orçamentos (só ORÇAMENTO). Mesmos parâmetros. |
| `GET` | `/api/relatorios/comissionamento` | Relatório de comissionamento (só Vendas) — faixa, percentual, valor líquido, comissão total/liberada/pendente e parcelas por pedido. Mesmos parâmetros de filtro. |
| `POST` | `/api/cache/limpar` | Limpa o cache em memória de produtos, estoque, etapas de faturamento, vendedores, clientes e contas a receber, forçando nova leitura. |
| `GET` | `/api/saude` | Informa apenas se as credenciais foram carregadas (`true`/`false`). |

## Estrutura do projeto

```
src/omie/        → cliente HTTP, detecção de erro, rate limiting/retry, cache, classificação Pedido/Orçamento
src/calculo/      → custo, margem/markup, arredondamento, tipos
src/relatorio/    → orquestração da consulta individual + relatórios agregados de Vendas/Orçamentos
src/comissionamento/ → faixas de comissão, distribuição por parcela, orquestração do relatório de comissionamento
src/rotas/        → rotas Express (documentos.ts, relatorios.ts, comissionamento.ts, vendedores.ts) e tratamento de erros HTTP
src/csv/          → exportação CSV
src/validacao.ts  → validação de toda entrada externa
src/server.ts     → bootstrap do Express
public/           → interface web (HTML/CSS/JS compilado)
public-src/       → código-fonte TypeScript do frontend
tests/            → testes automatizados (sem rede), com cliente Omie falso
```
