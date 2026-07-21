# Regras operacionais dos canais

Verificado em **20 de julho de 2026**. Este documento registra as limitações que a aplicação aplica ou deixa explícitas na interface. As políticas dos provedores continuam prevalecendo e devem ser revistas antes de cada implantação pública.

## Telegram Bot API

- Um bot comum **não inicia uma conversa privada arbitrária**. O usuário deve primeiro abrir o bot e tocar em **Iniciar**, enviar uma mensagem, ou conceder permissão explícita de escrita por uma Mini App. Telefone, ID compartilhado ou `@username` isolado não substituem um `chat_id` conhecido pelo bot.
- O deep link recomendado é `https://t.me/<bot>?start=<parametro>`. O parâmetro tem no máximo 64 caracteres base64url e apenas abrir o link não basta: o usuário precisa acionar o botão de início.
- Estar no mesmo grupo não autoriza uma DM. O bot pode escrever **no grupo** de que participa, segundo suas permissões. Em canais, precisa ser administrador com permissão para publicar.
- A aplicação salva `message.chat.id` após uma interação. O valor é tratado como string/inteiro de 64 bits, e não como um número de 32 bits.
- Não há uma janela geral de 24 horas para bots comuns depois do primeiro contato. A janela de 24 horas documentada para `can_reply` pertence a bots conectados ao Telegram Business, outro recurso.
- O limite gratuito documentado para broadcasts é aproximadamente 30 mensagens por segundo no total, além de limites por chat e por grupo. Broadcast pago pode chegar a 1.000 mensagens por segundo com `allow_paid_broadcast`, sujeito à habilitação e às condições vigentes do BotFather. A documentação oficial atual diverge sobre alguns critérios de elegibilidade; por isso eles não são codificados como promessa do produto.
- `/stop`, revogação administrativa, `my_chat_member` indicando bloqueio, ou resposta `403` do provedor removem a elegibilidade daquele destino.
- O token do bot basta para testar envios a `chat_id` já autorizado. O webhook é uma configuração independente para receber novos updates: exige HTTPS, usa `/api/webhooks/telegram` e sempre valida `X-Telegram-Bot-Api-Secret-Token`; se o administrador não informar um segredo, a aplicação gera e armazena um valor aleatório.
- A aplicação identifica o bot automaticamente com `getMe` e expõe somente `id`, nome e `@username`, nunca o token. Enquanto a página Telegram estiver aberta, updates processados com sucesso são enviados aos administradores autenticados por Socket.IO e aparecem como mensagens recentes; esse painel de sessão não é um histórico permanente de conteúdo.

Referências oficiais: [introdução a bots](https://core.telegram.org/bots#how-are-bots-different-from-users), [tutorial de envio](https://core.telegram.org/bots/tutorial#sending-messages), [deep links](https://core.telegram.org/api/links#bot-links), [Mini Apps](https://core.telegram.org/bots/webapps), [Bot API 10.2](https://core.telegram.org/bots/api), [limites de broadcast](https://core.telegram.org/bots/faq#broadcasting-to-users), [broadcast pago](https://core.telegram.org/bots/api#paid-broadcasts) e [Termos para desenvolvedores](https://telegram.org/tos/bot-developers#5-2-operation).

## Orquestração multicanal

- Cada provedor pode permanecer vazio e ser configurado/testado isoladamente.
- O envio rápido aceita um canal específico ou todos os canais disponíveis para o contato.
- “Disponível” significa configurado no momento do lote; para WhatsApp Web, a sessão também precisa estar pronta. Consentimento e disponibilidade são revalidados antes de cada chamada.
- Combinações sem configuração, sessão pronta, autorização ou variante de template são registradas como `skipped` e não impedem as demais. Uma falha real em um provedor produz resultado `partial` quando outro canal foi enviado com sucesso.

## WhatsApp Cloud API (oficial/Meta)

- O envio usa `POST /<PHONE_NUMBER_ID>/messages` com Bearer Token e `messaging_product: "whatsapp"`.
- Texto livre, mídia e templates são payloads diferentes. Iniciações proativas podem exigir um template criado e aprovado pela Meta; o painel não transforma texto livre em um template aprovado.
- A API cria entregas individuais. IDs e estados posteriores chegam pelo webhook e devem ser correlacionados com a entrega registrada.
- O webhook de produção precisa de HTTPS público. O desafio `GET` usa o verify token; requisições `POST` devem ter sua assinatura verificada com o app secret antes de atualizar contatos ou consentimentos.
- Um contato inbound é criado/atualizado a partir do `wa_id` e do perfil recebidos, sem duplicar o blind index do telefone.

Referências oficiais: [início da WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started), [coleção oficial da Meta](https://www.postman.com/meta/whatsapp-business-platform/overview), [endpoint de mensagens](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc) e [payload de webhook](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference).

## WhatsApp Web (`whatsapp-web.js`)

- É uma automação **não oficial** do cliente Web, sujeita a mudanças, desconexões e medidas do WhatsApp. Para operações críticas, prefira a Cloud API oficial.
- A sessão só libera o menu após o evento real de autenticação/ready. O TTL configurável (90 dias por padrão) é uma política desta aplicação: não garante que a sessão remota permanecerá válida durante todo o período.
- Apenas uma instância deve controlar a mesma sessão. O Compose mantém um volume persistente e a integração é inicializada sob demanda para evitar abrir o Chromium antes do QR.
- Remoção de contato ou revogação é conferida novamente no momento da entrega; jobs antigos não podem contornar o opt-out.

Referência do projeto: [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js).

## Gmail

- O modo implementado usa SMTP (`smtp.gmail.com`, TLS) com e-mail e App Password. App Password exige verificação em duas etapas e pode não estar disponível em todas as contas.
- O próprio Google recomenda preferir “Sign in with Google”/OAuth quando possível. App Password é uma opção de implantação do MVP, não a melhor opção para todo ambiente de produção.
- Alterar a senha principal da conta revoga App Passwords existentes. Credenciais cadastradas em runtime ficam criptografadas no MongoDB e nunca retornam à UI; valores fornecidos por `.env` dependem da proteção do host/cofre de segredos.

Referências oficiais: [App Passwords](https://support.google.com/accounts/answer/185833) e [configuração SMTP](https://support.google.com/mail/answer/7104828).

## Consentimento, convite e LGPD

- Clique em convite é telemetria; **não é automaticamente consentimento**. Consentimento é registrado por finalidade, canal, origem, versão dos termos e data, ou inferido somente de um evento permitido pelo provedor conforme a política configurada.
- Exclusão, bloqueio e revogação criam supressão imediata antes da remoção/anônimização para impedir reenvios já enfileirados.
- O painel oferece acesso/exportação, correção, revogação e exclusão/anônimização. Isso ajuda a operação, mas não substitui avaliação jurídica, definição de base legal, política de retenção, encarregado e processos organizacionais.

Referências oficiais: [Lei 13.709/2018](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/Lei13709.pdf), [FAQ da ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes) e [direitos dos titulares](https://www.gov.br/funasa/pt-br/acesso-a-informacao/lei-geral-de-protecao-de-dados-pessoais-lgpd/titular-de-dados-e-seus-direitos).
