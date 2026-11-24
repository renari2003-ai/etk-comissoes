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
   - **ICMS da compra:** é sempre custo, nunca crédito. Fica no custo do jeito que veio: 0% em compra de MG com diferimento do PTA, 18% (alíquota interna) em compra de MG sem diferimento, e 12%, 7% ou 4% em compra de fora de MG.
   - **IPI da compra:** se o Omie tem a nota de entrada do item, vale o IPI da nota. Se não tem, vale o tipo de fornecedor. Indústria normal (Lucro Real/Presumido) usa a alíquota do NCM no cadastro do componente. Simples Nacional ou comércio/distribuidor não dá crédito de IPI.

## Quando um item vem sem custo ou com custo errado

Clique no campo de custo do item (ou do GGF) e preencha:

- **Valor da nota:** o valor unitário como aparece na nota de compra, **com impostos**.
- **UF do fornecedor.**
- **Compra com diferimento PTA?** Só aparece quando a UF é MG.
- **Mercadoria importada?** Só aparece quando a UF não é MG. Se for importada, o ICMS da compra é 4%.
- **Tipo de fornecedor:** indústria normal, ou Simples Nacional / comércio-distribuidor.
- **IPI %:** vem preenchido pelo cadastro do componente no Omie (ou 0 para Simples/comércio). Você pode corrigir.

O sistema retira os créditos sozinho. Exemplo: nota de R$ 112,00 com IPI de 12%, de fornecedor de MG com diferimento PTA. O IPI é R$ 12,00 e o PIS/COFINS é R$ 9,25, então o custo líquido fica R$ 90,75.

Se o componente não tem NCM ou alíquota de IPI no cadastro do Omie e o fornecedor é indústria normal, o item fica **incompleto** até alguém informar o IPI. O jeito certo de resolver é corrigir o cadastro no Omie. O **relatório de conferência do cadastro** lista esses componentes.

Depois escolha:

- **Só nesta simulação:** o valor vale só para este cálculo.
- **Salvar para próximos cálculos:** o valor fica guardado e passa a valer em todos os próximos cálculos, **na frente do custo do Omie**. Toda mudança fica registrada (quem mudou, quando e qual era o valor anterior).

Se um item tem custo manual salvo e o Omie passar a ter custo para ele, a tela mostra **os dois valores** para você escolher qual usar.

## "Preço incompleto"

Se ainda sobrar item sem custo (ou sem IPI definido), a tela calcula o preço assim mesmo, contando esse item como custo zero, e mostra em destaque **"Preço incompleto: X itens sem custo"**. Esse preço está **abaixo do real**. Não use em cotação sem preencher os custos que faltam.

## Salvar e exportar

Ao salvar a simulação, o sistema guarda o custo usado em cada item e de onde ele veio, para a conta poder ser refeita depois exatamente como foi feita, mesmo que o Omie ou os custos manuais mudem. A simulação também pode ser exportada em PDF para anexar ao orçamento.

## O que a tela não faz

- Não grava nada no Omie: nem preço, nem custo, nem orçamento.
- Não inclui frete nesta versão.
