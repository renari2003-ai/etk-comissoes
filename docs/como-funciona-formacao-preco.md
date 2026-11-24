# Como funciona a formação de preço

Guia para quem usa a tela "Formação de preço" do app ETK Comissão. As regras completas e as fórmulas estão em `docs/precificacao.md`.

## O que a tela faz

Você informa o produto, o cliente (ou só a UF e o tipo de cliente), as despesas, a comissão e a margem. A tela devolve dois preços:

- **Preço piso:** o menor preço que ainda entrega a margem pedida.
- **Preço cheio:** o piso mais o ICMS destacado na nota. A ETK não recolhe esse ICMS (regime especial de MG), então ele vira margem extra para negociar.

Os dois preços aparecem sem e com IPI, por unidade e no total, com a margem antes e depois do IR/CS.

## De onde vem o custo

1. A tela busca no Omie a **estrutura do produto** (componentes e quantidades) e o **GGF**.
2. Cada componente recebe um custo, e a linha mostra de onde ele veio:
   - **Omie:** custo cadastrado no Omie.
   - **Manual:** custo digitado por alguém da ETK.
   - **Sem custo:** nem o Omie nem o cadastro manual têm valor. A linha aparece destacada.
3. Do custo de cada item o sistema retira os impostos que a ETK recupera na compra (PIS/COFINS e IPI). O ICMS de compras de fora de MG continua no custo.

## Quando um item vem sem custo ou com custo errado

Clique no campo de custo do item (ou do GGF) e digite o valor **como aparece na nota de compra, com impostos**. Marque também se o fornecedor é **de dentro ou de fora de MG**. O sistema retira os créditos sozinho, pelos percentuais da tabela fiscal.

Depois escolha:

- **Só nesta simulação:** o valor vale só para este cálculo.
- **Salvar para próximos cálculos:** o valor fica guardado e passa a valer em todos os próximos cálculos, **na frente do custo do Omie**. Toda mudança fica registrada (quem mudou, quando e qual era o valor anterior).

Se um item tem custo manual salvo e o Omie passar a ter custo para ele, a tela mostra **os dois valores** para você escolher qual usar.

## "Preço incompleto"

Se ainda sobrar item sem custo, a tela calcula o preço assim mesmo, contando esse item como custo zero, e mostra em destaque **"Preço incompleto: X itens sem custo"**. Esse preço está **abaixo do real**. Não use em cotação sem preencher os custos que faltam.

## Salvar e exportar

Ao salvar a simulação, o sistema guarda o custo usado em cada item e de onde ele veio, para a conta poder ser refeita depois exatamente como foi feita, mesmo que o Omie ou os custos manuais mudem. A simulação também pode ser exportada em PDF para anexar ao orçamento.

## O que a tela não faz

- Não grava nada no Omie: nem preço, nem custo, nem orçamento.
- Não inclui frete nesta versão.
