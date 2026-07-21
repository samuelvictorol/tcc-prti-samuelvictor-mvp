# Notify App API

Backend multicanal em Node.js 20, Express, MongoDB, Redis/BullMQ e Socket.IO. Integra Telegram Bot API, Gmail, WhatsApp Cloud e `whatsapp-web.js`, mantendo contatos, consentimentos e entregas em uma base compartilhada.

## Execucao

```bash
cp .env.example .env
npm ci
npm run dev
```

Em container, o `Dockerfile` instala Chromium para o WhatsApp Web. MongoDB e Redis são fornecidos pelo Compose na raiz do projeto.

Variáveis obrigatórias em produção:

- `MONGODB_URI` e `REDIS_URL`;
- segredos independentes `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `SEARCH_HASH_KEY` e `INVITE_TOKEN_SECRET`;
- ao menos um par `ADMIN1_EMAIL`/`ADMIN1_PASSWORD` (outros administradores seguem a mesma numeração);
- `CORS_ORIGINS` com as origens exatas do frontend.

As senhas `ADMINn_PASSWORD` são transformadas em bcrypt no bootstrap. Remover um administrador do ambiente o desativa no próximo início.

## Arquitetura

Fluxo HTTP: `route -> DTO/Zod -> controller -> manager -> model/service`.

- Controllers importam apenas managers e não acessam models ou outros controllers.
- Managers concentram regras, consentimento e coordenação entre domínios.
- Services isolam criptografia, Redis/BullMQ, Socket.IO e cliente WhatsApp Web.
- Arquivos `src/routes/*.routes.js` são descobertos automaticamente por `routes/loader.js`.
- Os adaptadores de canal compartilham contatos, mas não credenciais nem formatos de template.

## Segurança e privacidade

- JWT de acesso curto e refresh rotativo armazenado como hash.
- Refresh token entregue em cookie `HttpOnly`, `SameSite=Lax`, limitado a `/api/auth`; `COOKIE_SECURE` deve ser habilitado sob HTTPS.
- Helmet, CORS restritivo, HPP, sanitização Mongo, limite de corpo, rate limit e bloqueio temporário por tentativas inválidas.
- Socket.IO exige o mesmo access token em `auth.token` ou no header Bearer antes de transmitir logs, QR ou mensagens.
- Campos de contatos, identidades de canal, destinos externos de grupos e credenciais runtime usam AES-256-GCM em repouso. URLs públicas configuradas nos botões de convite não são secretas e ficam em claro.
- Buscas/deduplicação usam HMAC; não há armazenamento reversível usado como índice.
- HTTPS/TLS deve ser terminado pelo proxy. A solução oferece criptografia em trânsito e em repouso; não é E2EE entre remetente e destinatário, pois o servidor precisa acessar o destino para realizar o envio.
- HTML de templates e termos é sanitizado antes de persistir.

Consentimento é independente por canal. Toda concessão/revogação relevante gera `ConsentEvent`. Observar um membro em grupo Telegram/WhatsApp não concede autorização para mensagem privada. Para Telegram, somente conversa privada verificada pelo webhook pode conceder; `/stop`, bloqueio do bot e erro 403 revogam. Um contato/grupo removido ou desativado é revalidado pelo worker antes do envio.

## Rotas principais

Todas usam o prefixo configurável `API_PREFIX` (padrão `/api`). Rotas administrativas exigem Bearer JWT.

| Domínio | Rotas |
| --- | --- |
| Saúde | `GET /health`, `GET /api/health` |
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Settings | `GET /settings`, `GET /settings/status`, `PUT /settings`, `PUT/DELETE /settings/:key` |
| Logs | `GET /logs?page=&limit=&channel=&level=` |
| Contatos | CRUD `/contacts` |
| Grupos | CRUD `/contact-groups` (`/groups` é alias) |
| Templates | CRUD `/templates` |
| Notificações | `GET/POST /notifications`, `GET /notifications/stats`, `GET /notifications/:id`, `POST /notifications/:id/retry|cancel` |
| Convites | CRUD `/invites`; público `GET /public/invites/:slug` e tracking/redirect `GET /public/invites/:slug/links/:linkId` |
| Termos | CRUD `/terms`; publicado `GET /public/terms/:type` |
| LGPD | `GET /privacy/contacts/:id/export`, `DELETE /privacy/contacts/:id`, `POST /privacy/contacts/:id/consents` |
| Telegram | `/telegram/status`, `/telegram/chats`, CRUD `/telegram/groups`, `/telegram/sync`, `/telegram/send`, `/telegram/webhook/register` |
| Telegram webhook | `POST /webhooks/telegram` com `X-Telegram-Bot-Api-Secret-Token` |
| Gmail | `/email/status`, `/email/send` (`/gmail` é alias) |
| WhatsApp Cloud | `/whatsapp-cloud/status`, `/whatsapp-cloud/send`, `GET/POST /webhooks/whatsapp-cloud` |
| WhatsApp Web | `GET/POST/DELETE /whatsapp-web/session`, `/status`, `/chats`, `/chats/:chatId/messages`, `/groups`, `/sync`, `/send` |

`PUT /settings` aceita o contrato amigável:

```json
{
  "telegram": { "botToken": "...", "webhookSecret": "..." },
  "whatsappWeb": { "sessionTtlDays": 90 },
  "whatsappCloud": {
    "accessToken": "...",
    "phoneNumberId": "...",
    "businessAccountId": "...",
    "verifyToken": "...",
    "appSecret": "...",
    "apiVersion": "v25.0"
  },
  "email": { "user": "...", "from": "...", "fromName": "...", "appPassword": "..." }
}
```

Valores vazios são ignorados e segredos nunca retornam ao cliente.

## Notificacoes

`POST /notifications` recebe `kind`, `channel`, `templateId` ou `content`, `contactIds`, `groupIds` e `idempotencyKey` opcional. Um template global contém `variants` por canal. Variáveis como `{{displayName}}` são interpoladas no worker.

O worker:

1. expande apenas grupos ainda ativos;
2. revalida contato, opt-out e consentimento no momento do envio;
3. escolhe a variante específica do canal;
4. executa até três tentativas para falhas transitórias;
5. registra cada entrega como `sent`, `failed` ou `skipped` e consolida o resultado global.

## Limitações dos canais

- Telegram não permite iniciar conversa privada por telefone ou username; é necessário `chat_id` obtido depois da interação privada. O bot não enumera arbitrariamente membros de grupos.
- O WhatsApp Cloud exige templates aprovados para determinados disparos proativos e valida `X-Hub-Signature-256` com o app secret.
- `whatsapp-web.js` é uma integração não oficial. A aplicação impõe o TTL configurado (90 dias por padrão), mas o WhatsApp pode invalidar a sessão antes. O carregamento da biblioteca é lazy e só ocorre ao criar a sessão.
- Gmail usa app password e SMTP. Para ambientes corporativos, OAuth é uma evolução recomendada.

## Qualidade

```bash
npm run lint
npm test
npm audit --omit=dev
```

Os testes cobrem criptografia e adulteração, DTOs críticos, limites de arquitetura, auto-loader, envelopes HTTP e revalidação de grupo entre fila e entrega.
