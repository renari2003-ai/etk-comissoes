# Como funciona a formação de preço

Guia para quem usa a tela "Formação de preço" do app ETK Comissão. As regras completas e as fórmulas estão em `docs/precificacao.md`.

## O que a tela faz

Você informa o produto, o cliente (ou só a UF e o tipo de cliente), as despesas, a comissão e a margem. A tela devolve dois preços:

- **Preço piso:** o menor preço que ainda entrega a margem pedida.
- **Preço cheio:** o piso mais o ICMS destacado na nota. A ETK não recolhe esse ICMS (regime especial de MG), então ele vira margem extra para negociar.

Os dois preços aparecem sem e com IPI, por unidade e no total, com a margem antes e depois do IR/CS.

Junto do resultado podem aparecer avisos para confirmar com o fiscal:

- **"Confirmar com o fiscal se o ICMS é recolhido":** aparece na venda a não contribuinte ou consumidor final em MG.
- **"DIFAL na base simples":** aparece na venda a não contribuinte de outra UF.

Enquanto houver um desses avisos, trate o preço como provisório.

## De onde vem o custo

1. A tela busca no Omie a **estrutura do produto** (componentes e quantidades) e o **GGF**.
2. Cada componente recebe um custo, e a linha mostra de onde ele veio:
   - **Omie:** custo cadastrado no Omie.
   - **Manual:** custo digitado por alguém da ETK.
   - **Sem custo:** nem o Omie nem o cadastro manual têm valor. A linha aparece destacada.
3. Do custo de cada item o sistema retira os impostos que a ETK recupera na compra: PIS/COFINS e IPI.
   - **ICMS da compra:** é sempre custo, nunca crédito. Fica no custo do jeito que veio: 0% em compra de MG com diferimento do PTA, 18% (alíquota interna) em compra de MG sem diferimento, e 12% em compra de qualquer outra UF (4% se a mercadoria for importada).
   - **IPI da compra:** se o Omie tem a nota de entrada do item, vale o IPI da nota. Se não tem, vale o tipo de fornecedor. Indústria normal (Lucro Real/Presumido) usa a alíquota do NCM no cadastro do componente. Simples Nacional nunca dá crédito de IPI. Comércio/distribuidor também não, a não ser que a nota destaque IPI.

## Quando um item vem sem custo ou com custo errado

Clique no campo de custo do item (ou do GGF) e preencha:

- **Valor da nota:** o valor unitário como aparece na nota de compra, **com impostos**.
- **UF do fornecedor.**
- **Compra com diferimento PTA?** Só aparece quando a UF é MG.
- **Mercadoria importada?** Só aparece quando a UF não é MG. Se for importada, o ICMS da compra é 4%.
- **Tipo de fornecedor:** indústria normal, Simples Nacional ou comércio/distribuidor.
- **IPI %:**
  - Indústria normal: vem preenchido pelo cadastro do componente no Omie, e você pode corrigir.
  - Simples Nacional: fica travado em 0.
  - Comércio/distribuidor: começa em 0. Só mude se a nota destacar IPI (por exemplo, distribuidor de importado equiparado a indústria).

O sistema retira os créditos sozinho. Exemplo: nota de R$ 112,00 com IPI de 12%, de fornecedor de MG com diferimento PTA. O IPI é R$ 12,00 e o PIS/COFINS é R$ 9,25, então o custo líquido fica R$ 90,75.

Se o componente não tem NCM ou alíquota de IPI no cadastro do Omie e o fornecedor é indústria normal, o item entra **pelo valor cheio da nota, sem descontar crédito nenhum**. O preço sai um pouco alto, nunca baixo, e fica marcado como incompleto até alguém informar o IPI. O jeito certo de resolver é corrigir o cadastro no Omie. O **relatório de conferência do cadastro** lista esses componentes.

Depois escolha:

- **Só nesta simulação:** o valor vale só para este cálculo.
- **Salvar para próximos cálculos:** o valor fica guardado e passa a valer em todos os próximos cálculos, **na frente do custo do Omie**. Toda mudança fica registrada (quem mudou, quando e qual era o valor anterior).

Se um item tem custo manual salvo e o Omie passar a ter custo para ele, a tela mostra **os dois valores** para você escolher qual usar.

## As tarjas do resultado

Tudo o que estiver errado ou faltando aparece numa tarja no topo do resultado, dizendo o que é, em qual item e como resolver. A simulação salva e o PDF levam as mesmas tarjas.

- **Vermelha:** o preço não aparece até o problema ser resolvido. Exemplos: produto sem estrutura no Omie; UF do cliente sem alíquota na tabela fiscal ("peça ao administrador para preencher a UF X"); cadastro do cliente inconsistente; Omie fora do ar ("tente de novo em alguns minutos").
- **Amarela:** o preço aparece, mas marcado **"INCOMPLETO – não usar em cotação"**. Exemplos: item sem custo (com botão para digitar o custo), componente sem NCM ou IPI no cadastro ("corrija o cadastro do item X no Omie"), GGF ausente, estrutura com mais de 60 componentes.
- **Azul:** informativa. Exemplos: item com custo estimado (sem nota de entrada), custo manual diferente do custo do Omie, DIFAL na base simples, cliente de MG não contribuinte.

No modo reverso, um preço-alvo abaixo do piso aparece numa tarja vermelha no próprio bloco do modo reverso.

## "Preço incompleto"

Se ainda sobrar item sem custo, a tela calcula o preço assim mesmo, contando esse item como custo zero, e mostra a tarja amarela **"INCOMPLETO – não usar em cotação"** com os códigos dos itens. Item sem IPI definido não entra com zero: entra pelo valor cheio da nota, sem crédito. Esse preço está **abaixo do real**. Não use em cotação sem preencher os custos que faltam.

## Salvar e exportar

Ao salvar a simulação, o sistema guarda o custo usado em cada item e de onde ele veio, para a conta poder ser refeita depois exatamente como foi feita, mesmo que o Omie ou os custos manuais mudem. A simulação também pode ser exportada em PDF para anexar ao orçamento.

## O que a tela não faz

- Não grava nada no Omie: nem preço, nem custo, nem orçamento.
- Não inclui frete nesta versão.
