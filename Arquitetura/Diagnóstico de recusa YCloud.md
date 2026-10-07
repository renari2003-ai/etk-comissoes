# Diagnóstico de recusa YCloud

Atualização: 07/10/2026.

O cliente de envio interpreta o formato oficial de erros `error.code` e `error.message`, mantendo compatibilidade com `errorCode` e `errorMessage`.

HTTP 401 é apresentado como falha de autenticação. HTTP 403 é uma recusa de envio, com código específico e orientação para template indisponível, saldo insuficiente, conta limitada ou número remetente indisponível, quando informado pela YCloud. Mensagens externas são sanitizadas antes de persistir e exibir; nenhum segredo é registrado.

Tentativas antigas que salvaram somente a mensagem genérica não permitem recuperar o motivo original. O diagnóstico novo exige consultar o registro na YCloud ou reenviar uma vez por ação explícita do operador. Não há repetição automática nem recarga automática.
