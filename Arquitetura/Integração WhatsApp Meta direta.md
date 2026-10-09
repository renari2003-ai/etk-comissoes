# WhatsApp Cloud API direto — 09/10/2026

## Código
- Provedor opcional FRETES_WHATSAPP=meta. O valor atual não é alterado automaticamente; YCloud/n8n continuam disponíveis para contingência.
- POST Graph API /{phoneNumberId}/messages com template aprovado obrigatório e seis parâmetros. Sem fallback para texto livre e sem repetição automática. Destinatário vem de whatsappCotacao do cadastro.
- Peso, volumes e valor declarado da nota compõem o parâmetro de carga. Sem margem/markup/custo interno.
- WAMID é gravado na solicitação existente, sem identificador YCloud. Status de envio significa aceitação pela API; entrega real vem de webhook.
- GET /api/fretes/integracoes/meta/webhook verifica hub.mode/verify_token e devolve hub.challenge. POST verifica X-Hub-Signature-256 com app secret sobre bytes exatos e filtra metadata.phone_number_id.
- Envelope Meta é normalizado para o núcleo WhatsApp: correlação por reply/referência, deduplicação por WAMID, revisão manual se não houver correlação ou valor extraído. Nenhuma proposta aprovada automaticamente. Mensagens de telefone diferente do destinatário ficam em revisão.
- Sem novas dependências ou migrations. Omie somente leitura.

## Configuração pendente (servidor Vercel, ambiente Production)
META_WHATSAPP_PHONE_NUMBER_ID=1433778859808018
META_WHATSAPP_GRAPH_VERSION=v26.0
META_WHATSAPP_TEMPLATE_NOME=cotacao_frete_etk
META_WHATSAPP_TEMPLATE_IDIOMA=pt_BR
META_WHATSAPP_ACCESS_TOKEN: token de usuário do sistema com acesso ao aplicativo e WABA, permissões WhatsApp necessárias. Não utilizar o token temporário que apareceu em captura.
META_WHATSAPP_APP_SECRET: segredo do aplicativo ETK Fretes (Configurações básicas).
META_WHATSAPP_VERIFY_TOKEN: valor aleatório privado escolhido para verificar o webhook; não é o access token.
FRETES_WHATSAPP=meta somente ao terminar a configuração.

Não inserir os três segredos em notas, código ou conversa. Configurar diretamente na Vercel, marcar sensíveis, e fazer novo deploy após alterações.

## Painel Meta
- Aplicativo ETK Fretes 109326873985029.
- Nova WABA ETK indústria e comércio 2965164870494763.
- Número +553584627094 inscrito; usuário apagou conta mobile, sem histórico.
- Callback: https://etk-comissoes.vercel.app/api/fretes/integracoes/meta/webhook
- Token de verificação: mesmo valor privado META_WHATSAPP_VERIFY_TOKEN da Vercel.
- Verificar/salvar callback, assinar campo messages e WABA, confirmar teste de webhook. Em produção, publicar app conforme requisitos do painel Meta.
- Template a cadastrar/aprovar: nome cotacao_frete_etk, idioma pt_BR, seis parâmetros abaixo. Confirmar categoria aprovada na Meta; não presumir utilidade.

## Rascunho do corpo do template
Olá! A ETK Indústria e Comércio solicita cotação de frete.
Referência: {{1}}
Origem: {{2}}
Destino: {{3}}
Carga (modalidade, peso, volumes e valor da nota): {{4}}
Embalagens: {{5}}
Observações: {{6}}
Use Responder nesta própria mensagem e informe VALOR_FRETE, PRAZO_DIAS, VALIDADE e OBSERVACOES.

## Validação e limites
Testes locais usam fetch e repositórios simulados; não enviam mensagens reais. Credenciais, handshake real, template aprovado, pagamento e teste completo ETK → destinatário → ETK ainda pendentes. Cartão empresarial disponível apenas terça-feira, informado pelo usuário. Não cadastrar cobrança antes disso.

Suíte completa com banco isolado já apresentou travamento na sessão anterior; não executar testes de integração contra banco real.

Referência oficial: https://github.com/fbsamples/whatsapp-api-examples (exemplos de templates, webhook e assinatura).
