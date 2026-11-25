# Como funciona a formação de preço

Guia para quem usa a tela "Formação de preço" do app ETK Comissão. As regras completas e as fórmulas estão em `docs/precificacao.md`.

## O que a tela faz

Você informa o produto, o cliente (ou só a UF e o tipo de cliente), as despesas, a comissão e a margem. A tela devolve dois preços:

- **Preço piso:** o menor preço que ainda entrega a margem pedida.
- **Preço cheio:** o piso mais o ICMS destacado na nota. Na venda a **contribuinte**, a ETK não recolhe esse ICMS (regime especial de MG, o PTA), então ele vira margem extra para negociar.

Na venda a **não contribuinte ou consumidor final** (inclusive contribuinte comprando para uso e consumo), o PTA não se aplica: o ICMS destacado é **recolhido** e vira custo, em MG e nas outras UFs (fora de MG, junto com o DIFAL). Nesse caso não há margem extra: o preço piso e o preço cheio são iguais.

Os dois preços aparecem sem e com IPI, por unidade e no total, com a margem antes e depois do IR/CS.

### Qual é o cenário da venda

| Venda | ICMS na nota | O ICMS é recolhido? |
| --- | --- | --- |
| **A.** Cliente de MG **com PTA (compra para industrialização)** e venda **para industrialização** | sem ICMS | — |
| **B.** Outras vendas em MG a contribuinte (sem PTA, ou com PTA mas não para industrialização) | alíquota interna de MG (18%, ou a do NCM) | não (PTA da ETK) |
| **B.** Venda em MG a não contribuinte ou para uso e consumo | alíquota interna de MG | **sim** (padrão 100%) |
| **C.** Outra UF, contribuinte | 12%, 7% ou 4% | não (PTA da ETK) |
| **D.** Outra UF, não contribuinte ou uso e consumo | 12%, 7% ou 4% + DIFAL | **sim** (padrão 100%) + DIFAL |

O cenário A precisa das **duas** coisas: o cliente ter PTA e a venda ser para industrialização. Se faltar uma, não é A.

Junto do resultado podem aparecer avisos para confirmar com o fiscal:

- **"Parâmetros fiscais ainda não validados pelo fiscal":** aparece em todo cálculo enquanto a tabela fiscal estiver como **"Provisório"**. Só o administrador marca "Validado pelo fiscal".
- **"DIFAL na base simples":** aparece na venda a não contribuinte de outra UF.

Enquanto houver um desses avisos, trate o preço como provisório.

## De onde vem o custo

1. A tela busca no Omie a **estrutura do produto** (componentes, quantidades e % de perda). Os kits que têm estrutura própria são abertos até o último nível, como no relatório "Imprimir Estrutura" do Omie.
   - O custo do produto é a soma, item a item, de **quantidade × (1 + perda) × custo médio do estoque**, usando sempre o custo médio **atual**. Por isso ele pode ser diferente de um relatório antigo.
   - Um kit aberto **nunca** entra com o próprio custo junto com o dos itens de dentro dele, para não contar duas vezes. Se o kit não tem estrutura no Omie, entra com o custo médio do próprio kit.
   - Não existe GGF separado: o custo de fabricação já está dentro das **despesas fixas %** que você informa na tela.
2. Cada item recebe um custo, e a linha mostra de onde ele veio:
   - **Omie:** custo cadastrado no Omie.
   - **Manual:** custo digitado por alguém da ETK.
   - **Sem custo:** nem o Omie nem o cadastro manual têm valor. A linha aparece destacada.
3. Do custo de cada item o sistema retira os impostos que a ETK recupera na compra: PIS/COFINS e IPI.
   - **ICMS da compra:** é sempre custo, nunca crédito. Só é 0% quando o **fornecedor é de MG e tem PTA** (diferimento). Fornecedor de MG sem PTA: o ICMS vem destacado (18%, alíquota interna) e fica no custo. Fornecedor de qualquer outra UF: 12% (4% se a mercadoria for importada).
   - **IPI da compra:** se o Omie tem a nota de entrada do item, vale o IPI da nota. Se não tem, vale o tipo de fornecedor. Indústria normal (Lucro Real/Presumido) usa a alíquota do NCM no cadastro do componente. Simples Nacional nunca dá crédito de IPI. Comércio/distribuidor também não, a não ser que a nota destaque IPI.

## Quando um item vem sem custo ou com custo errado

No modo **💲 Precificação**, use a seção **"Custos manuais"** (ou, quando a tela de preço estiver pronta, o campo de custo do próprio item) e preencha:

- **Valor da nota:** o valor unitário como aparece na nota de compra, **com impostos**.
- **UF do fornecedor.**
- **Fornecedor de MG com PTA?** Só aparece quando a UF é MG. "Sim" = ICMS 0% (diferimento); "Não" = ICMS destacado de 18%, que é custo.
- **Mercadoria importada?** Só aparece quando a UF não é MG. Se for importada, o ICMS da compra é 4%.
- **Tipo de fornecedor:** indústria normal, Simples Nacional ou comércio/distribuidor.
- **IPI %:**
  - Indústria normal: vem preenchido pelo cadastro do componente no Omie, e você pode corrigir.
  - Simples Nacional: fica travado em 0.
  - Comércio/distribuidor: começa em 0. Só mude se a nota destacar IPI (por exemplo, distribuidor de importado equiparado a indústria).

O sistema retira os créditos sozinho. Exemplo: nota de R$ 112,00 com IPI de 12%, de fornecedor de MG com PTA. O IPI é R$ 12,00 e o PIS/COFINS é R$ 9,25, então o custo líquido fica R$ 90,75.

Se o componente não tem NCM ou alíquota de IPI no cadastro do Omie e o fornecedor é indústria normal, o item entra **pelo valor cheio da nota, sem descontar crédito nenhum**. O preço sai um pouco alto, nunca baixo, e fica marcado como incompleto até alguém informar o IPI. O jeito certo de resolver é corrigir o cadastro no Omie. O **relatório de conferência do cadastro** lista esses componentes.

Depois escolha:

- **Só nesta simulação:** o valor vale só para este cálculo.
- **Salvar para próximos cálculos:** o valor fica guardado e passa a valer em todos os próximos cálculos, **na frente do custo do Omie**. Toda mudança fica registrada (quem mudou, quando e qual era o valor anterior) no "Histórico dos custos manuais". Para voltar a usar o custo do Omie, clique em **Remover**.

Se o item tem custo no Omie mas não tem nota de entrada, deixe o **valor da nota vazio** e preencha só UF, "fornecedor de MG com PTA" ou importada, tipo de fornecedor e IPI. O custo do Omie continua valendo, e esses dados ficam guardados para você não ter de informá-los a cada cálculo.

Se duas pessoas alterarem o mesmo item ao mesmo tempo, quem salvar por último recebe o aviso para recarregar a tela. Nada é desfeito sem aviso.

Se um item tem custo manual salvo e o Omie passar a ter custo para ele, a tela mostra **os dois valores** para você escolher qual usar.

## As tarjas do resultado

Tudo o que estiver errado ou faltando aparece numa tarja no topo do resultado, dizendo o que é, em qual item e como resolver. A simulação salva e o PDF levam as mesmas tarjas.

- **Vermelha:** o preço não aparece até o problema ser resolvido. Exemplos: produto sem estrutura no Omie; UF do cliente sem alíquota na tabela fiscal ("peça ao administrador para preencher a UF X"); cadastro do cliente inconsistente; Omie fora do ar ("tente de novo em alguns minutos").
- **Amarela:** o preço aparece, mas marcado **"INCOMPLETO – não usar em cotação"**. Exemplos: item sem custo (com botão para digitar o custo), componente sem NCM ou IPI no cadastro ("corrija o cadastro do item X no Omie"), estrutura com mais de 60 componentes.
- **Azul:** informativa. Exemplos: parâmetros fiscais ainda não validados pelo fiscal (tabela fiscal "Provisório"), item com custo estimado (sem nota de entrada), custo manual diferente do custo do Omie, DIFAL na base simples.

No modo reverso, um preço-alvo abaixo do piso aparece numa tarja vermelha no próprio bloco do modo reverso.

## "Preço incompleto"

Se ainda sobrar item sem custo, a tela calcula o preço assim mesmo, contando esse item como custo zero, e mostra a tarja amarela **"INCOMPLETO – não usar em cotação"** com os códigos dos itens. Item sem IPI definido não entra com zero: entra pelo valor cheio da nota, sem crédito. Esse preço está **abaixo do real**. Não use em cotação sem preencher os custos que faltam.

## Tabela fiscal (administrador)

No modo **💲 Precificação**, a "Tabela fiscal da formação de preço" mostra o **status**: **Provisório** ou **Validado pelo fiscal**. Ela começa como "Provisório". Só o administrador muda o status, e cada mudança fica no histórico (quem mudou e quando).

As alíquotas internas de cada UF (usadas no DIFAL) começam com os valores do Buscador NCM de nov/2026, sem FCP, e estão marcadas **"a confirmar pelo fiscal"**. Todas são editáveis. O percentual de recolhimento do ICMS na venda a não contribuinte / consumidor final começa em 100% e também é editável.

## Salvar e exportar

Ao salvar a simulação, o sistema guarda o custo usado em cada item e de onde ele veio, para a conta poder ser refeita depois exatamente como foi feita, mesmo que o Omie ou os custos manuais mudem. A simulação também pode ser exportada em PDF para anexar ao orçamento.

## O que a tela não faz

- Não grava nada no Omie: nem preço, nem custo, nem orçamento.
- Não inclui frete nesta versão.
