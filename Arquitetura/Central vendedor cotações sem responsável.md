# Central do Vendedor — cotações sem vendedor — 07/10/2026

Solicitação do usuário: cotações cujo documento Omie ainda não tem vendedor definido devem ser visíveis para todos os vendedores com acesso à Central do Vendedor.

O filtro da central passa a incluir vendedorOmieId nulo ou zero, além das cotações atribuídas ao usuário. Cotações com vendedor definido continuam restritas ao responsável, salvo visão ampliada já existente. Mantida a triagem da logística e exclusão de propostas pendentes de validação humana. Esta alteração trata visibilidade; não atribui vendedor, não amplia permissões de negociação/escolha e não grava na Omie. O vendedor da cotação continua sendo o snapshot gravado na criação; sincronização posterior não foi adicionada.

Verificação: quatro regressões com repositórios simulados (dois vendedores distintos, usuário sem vínculo e administrador).
