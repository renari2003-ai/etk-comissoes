# Correções de cotação — 07/10/2026

- Na criação a partir da Omie, o peso confirmado pelo operador passa a prevalecer sobre o peso bruto consultado. O valor é gravado em peso e peso bruto; o peso líquido continua sendo o informado pela Omie. Omie continua somente leitura.
- E-mail HTML e texto incluem o valor declarado da mercadoria (nota), usando o valor da cotação, sem margem/custo/markup interno. Campo opcional adicionado ao payload logístico v1, compatível com registros/chamadores antigos.
- Braspress: os campos oficiais message/errorList/statusCode passam a compor o diagnóstico sanitizado. A mensagem da falha aparece ao operador em vez de somente “Erro na API da transportadora”. Não há repetição automática.
- A imagem original não contém o motivo da recusa. Consulta aos logs de produção nas últimas 24h não encontrou registros Braspress. Ainda falta validar uma consulta real após publicação; credenciais e cadastro da filial podem exigir ajuste conforme o erro retornado.
- Build e type-check passaram; 16 testes específicos passaram com dependências simuladas, sem chamadas reais nem banco de produção. A suíte completa com PGlite ficou travada após o primeiro arquivo e foi interrompida; não é considerada aprovada.

Documentação Braspress: https://api.braspress.com/home
