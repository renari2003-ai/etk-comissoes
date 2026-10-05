# Busca manual de respostas de e-mail

Atualização: 05/10/2026.

Em **Fretes → Propostas recebidas**, o operador pode clicar em **Buscar respostas de e-mail**. O sistema consulta a caixa IMAP configurada, atualiza a lista e o contador de propostas pendentes e informa o resultado e o horário da última busca concluída nesta tela.

Durante a consulta o botão fica desabilitado. A rotina existente mantém o bloqueio de execuções simultâneas, o cursor IMAP e a idempotência. Mensagens já lidas no Outlook também podem ser processadas, desde que permaneçam na caixa consultada no servidor. Clicar em Enviar/Receber no Outlook não dispara a busca do ETK.

O endpoint manual `POST /api/fretes/emails-resposta/buscar` exige sessão e permissão de fretes. Nenhuma credencial IMAP ou segredo do agendador é enviado ao navegador. A rota interna de agendamento continua protegida por seu segredo próprio.

Nenhuma proposta é aprovada automaticamente. Valores ausentes continuam indo para revisão manual. O WhatsApp continua recebendo pelo webhook direto da YCloud.

Não foi criado agendamento periódico. A consulta pode ser feita pelo operador; se houver mais mensagens do que o limite por execução, a tela pede nova busca. O horário exibido é da consulta nesta sessão, não um histórico persistido global.
