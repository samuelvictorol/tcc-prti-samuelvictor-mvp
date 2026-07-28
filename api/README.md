# Notify Flow API

Backend multicanal em **Node.js 20**, **Express**, **MongoDB/Mongoose**, **Redis/BullMQ** e **Socket.IO**. A API concentra autenticação, contatos, consentimentos, templates, filas, webhooks e integrações com Telegram Bot API, WhatsApp Cloud API oficial e Gmail.

## Estrutura e responsabilidades

```text
src/
├── config/       ambiente, MongoDB e bootstrap
├── controllers/  tradução HTTP; delegam aos managers
├── dtos/         contratos Zod de entrada
├── enums/        canais e estados
├── managers/     regras de negócio e coordenação
├── middlewares/  JWT, validação, rate limit e erros
├── models/       schemas e índices Mongoose
├── routes/       módulos *.routes.js autocarregados
├── services/     crypto, Redis, BullMQ, Socket.IO e clientes oficiais
└── utils/        normalização, templates, paginação e mídia segura
```

O contrato arquitetural é:

```text
route -> DTO/middleware -> controller -> manager -> model/service/outro manager
```

- Rotas declaram método, autenticação e validação.
- Controllers não acessam models nem chamam outros controllers.
- Managers preservam invariantes, autorização e transações entre domínios.
- Services isolam infraestrutura ou clientes externos.
- `routes/loader.js` descobre todos os arquivos `*.routes.js` no boot.

## Inicialização

`src/server.js` executa, nesta ordem:

1. valida as variáveis obrigatórias de produção;
2. conecta ao MongoDB e cria índices quando habilitado;
3. garante templates fixos e documentos legais iniciais;
4. repara telefones legados inseguros;
5. sincroniza administradores `ADMIN{N}_*`;
6. conecta ao Redis;
7. registra o worker BullMQ e recupera notificações pendentes;
8. inicia Express e Socket.IO;
9. atualiza o webhook Telegram.

O shutdown trata `SIGINT`/`SIGTERM` e encerra HTTP, fila, Redis e MongoDB.

## Execução local

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

É necessário ter MongoDB e Redis acessíveis. Para o conjunto completo, prefira `docker compose up --build -d` na raiz. O Dockerfile da API executa como usuário sem privilégios.

## Domínios e rotas

O prefixo padrão é `/api`. Rotas administrativas exigem `Authorization: Bearer <access-token>`, salvo quando indicado.

| Domínio | Operações principais |
|---|---|
| Saúde | `GET /health` e `GET /api/health`; retorna 503 se Mongo ou Redis obrigatório estiver indisponível |
| Auth | `POST /auth/login`, `/refresh`, `/logout`; `GET /auth/me` |
| Settings | `GET /settings`, `/settings/status`; `PUT /settings`, `PUT/DELETE /settings/:key` |
| Contatos | CRUD `/contacts` |
| Grupos | CRUD `/contact-groups`; `/groups` é alias |
| Privacidade | export, exclusão e consentimento em `/privacy/contacts/:id` |
| Templates | CRUD `/templates` |
| Notificações | lista/criação/stats/issues/detalhe/retry/cancel em `/notifications` |
| Conversas | lista, mensagens, leitura, limpeza e remoção em `/conversations` |
| Logs | `GET /logs` com paginação/filtros |
| Avisos admin | lista, unread count e leitura em `/admin-notifications` |
| Convites | CRUD `/invites`; público `/public/invites/:slug` e tracking de links |
| Termos | CRUD `/terms`; público `/public/terms/:type` |
| Meu perfil | código, perfil, consentimentos, activation links e histórico em `/my-profile` |
| Auditoria de login | `GET /profile-logins` |
| Telegram | status, chats conhecidos, grupos, sync local, envios e registro de webhook em `/telegram` |
| Telegram webhook | `POST /webhooks/telegram` |
| WhatsApp Cloud | status, presets e envio em `/whatsapp-cloud` |
| Meta webhook | `GET/POST /webhooks/whatsapp-cloud` |
| Gmail | status/envio em `/email`; `/gmail` é alias |

### Chats oficiais do WhatsApp

`/whatsapp-cloud/conversations` lista a inbox construída localmente; a Cloud API não importa chats nem o histórico do aplicativo. Somente mensagens recebidas pelo webhook e envios realizados pela aplicação entram nessa inbox. O Socket.IO publica novas mensagens e atualizações de conversa em tempo real.

Texto livre pode ser enviado apenas durante a janela de atendimento de 24 horas aberta pela última mensagem do cliente. Fora dela, use um template oficial aprovado. As mensagens locais expiram após 30 dias; `POST /whatsapp-cloud/conversations/backup` gera um backup JSON manual sem estender a retenção.

Snapshots manuais e automáticos são criptografados e armazenados em GridFS, evitando o limite de 16 MB de um documento BSON. A retenção padrão dos snapshots é de 90 dias e pode ser ajustada por `CONVERSATION_BACKUP_RETENTION_DAYS` (mínimo de 30 dias). `GET /whatsapp-cloud/conversations/backups` lista os snapshots disponíveis e `GET /whatsapp-cloud/conversations/backups/:backupId/download` baixa qualquer snapshot; ambas as rotas exigem autenticação administrativa.

## Autenticação e sessões

### Administrador

- Administradores são criados/atualizados a partir de `ADMIN1_*`, `ADMIN2_*` etc.; senha vira bcrypt com custo 12.
- Access JWT curto usa issuer/audience próprios.
- Refresh JWT é rotacionado, salvo apenas como hash e enviado em cookie `HttpOnly`, `SameSite=Lax`, restrito à rota de auth.
- Remover o par do ambiente desativa o administrador gerenciado no próximo boot.
- O mesmo access token autentica o handshake Socket.IO.

### Contato em `/meu-perfil`

- Identificador público é email ou telefone; a busca exige correspondência única.
- Código aleatório de seis dígitos é guardado apenas como HMAC, tem uso único, expiração e limite de tentativas/reenvio.
- O mesmo código é tentado em paralelo por Gmail, WhatsApp Cloud e Telegram autorizado; falha de um canal não cancela os outros.
- Após a validação, um JWT separado (`notify-app-contact`) permite somente ler/editar o próprio perfil, revogar consentimento e consultar o próprio histórico.

O código não é persistido em logs ou histórico de conversa.

## Contatos, identidades e consentimento

Um `Contact` pode ter várias identidades. Cada uma mantém:

- canal e endereço criptografado;
- blind index HMAC para igualdade/deduplicação;
- estado `authorized` e `consentStatus`;
- origem, datas, comando, ator e evidência criptografada.

Email e telefone são únicos. Telefones, IDs `@lid`, chat IDs e aliases passam por normalização defensiva antes de correlação. Consentimento é auditado em `ConsentEvent`.

### Telegram

- Qualquer mensagem privada recebida atualmente cria/atualiza o contato e concede Telegram, exceto `/stop` ou consentimento já revogado/negado sem nova autorização explícita.
- Os comandos dinâmicos `/notify-me` e `/verify-me` registram a origem automática e abrem o menu de onboarding.
- O telefone só é confiável quando o próprio usuário usa o botão nativo `request_contact` e `contact.user_id` coincide com `from.id`; nesse caso, identidades podem ser fundidas.
- Membros vistos em grupo ficam `unknown`/não autorizados para mensagem privada.

### WhatsApp

- WhatsApp Cloud cria/atualiza contato em qualquer mensagem inbound, mas não autoriza campanhas sem o comando configurado.
- O comando WhatsApp concede consentimento ao canal oficial no contato correlacionado.
- Revogação posterior pode ser feita canal a canal.

`getDestination()` bloqueia contato inativo, `notificationDisabled`, identidade ausente ou sem consentimento.

## Templates

Somente Gmail aceita HTML. Telegram usa definições próprias; WhatsApp Cloud usa templates oficiais.

### Fixos do WhatsApp Cloud

| Template | Definição |
|---|---|
| `verify_code_1` | `pt_BR`; BODY + botão OTP/copiar com a variável `codigo` |
| `jaspers_market_plain_text_v1` | `en_US`; sem parâmetros |
| `jaspers_market_order_confirmation_v1` | `en_US`; `customerName`, `orderNumber`, `orderDate` |

Esses registros são semeados, marcados como `systemManaged` e não podem ter sua identidade alterada ou ser excluídos. `hello_world` é apenas um preset de teste.

O builder custom do Cloud valida componentes `header`, `body` e `button`, índices e subtipos, parâmetros nomeados/posicionais e os tipos aceitos pela Meta.

### Telegram

Tipos: texto, foto, vídeo e menu hierárquico. Menus usam inline keyboard e sessões cifradas no Redis. Mídia remota:

- precisa usar HTTPS/443 sem credenciais na URL;
- bloqueia localhost, redes privadas/reservadas e rebinding básico;
- limita redirects, tempo, bytes e MIME real;
- permite JPEG/PNG/WebP até 10 MB ou MP4 até 50 MB.

## Fila de notificações

`POST /notifications` aceita três modos:

- `quick`: conteúdo direto para um canal compatível;
- `template`: `templateId` do mesmo canal;
- `global`: `channel=global` e `templateIds` separados para Telegram, Cloud e/ou email.

Mensagens iniciadas pela empresa no WhatsApp Cloud usam `template`; respostas em texto livre são restritas à janela de atendimento de 24 horas.

Email e Telegram usam o mesmo contrato para um contato, vários contatos ou grupos. `contactIds`
e `groupIds` podem ser combinados; a API expande os grupos e remove destinos duplicados:

```json
{
  "kind": "quick",
  "channel": "email",
  "content": {
    "subject": "Aviso",
    "text": "Mensagem em texto"
  },
  "contactIds": ["507f1f77bcf86cd799439011"],
  "groupIds": ["507f1f77bcf86cd799439012"]
}
```

```json
{
  "kind": "template",
  "channel": "telegram",
  "templateId": "507f1f77bcf86cd799439013",
  "content": {
    "variables": {
      "protocolo": "ABC-123"
    }
  },
  "contactIds": [],
  "groupIds": ["507f1f77bcf86cd799439012"]
}
```

Troque `channel` entre `email` e `telegram` nos dois modos. Para email rápido, `content`
aceita `subject` e `text` ou `html`; para Telegram rápido, use `content.text`.

Fluxo de processamento:

1. valida até 10.000 contatos, 1.000 grupos e 10.000 entregas;
2. expande grupos e remove duplicados;
3. cria a notificação e o marcador `enqueuePending` no MongoDB;
4. enfileira em BullMQ com até **quatro tentativas** e backoff exponencial;
5. worker com concorrência 5 reclama o job por token/heartbeat;
6. revalida grupo, contato, consentimento, template e canal antes de cada entrega;
7. classifica erro permanente/transitório e repete cada entrega até quatro vezes;
8. consolida `queued`, `sent`, `failed`, `skipped` e agenda novo lote quando necessário.

Se Redis estiver indisponível e for opcional, há fallback inline. Em produção `REDIS_REQUIRED=true` é recomendado. Quando a fila falha depois de persistir a notificação, o marcador durável permanece e o recovery sweep, executado a cada 60 segundos, tenta reagendar estados enfileirados ou `processing` obsoletos.

`idempotencyKey` evita criação duplicada. Receipts Cloud atualizam `sent/delivered/read/failed`; falhas assíncronas transitórias também podem solicitar retry.

Cada destinatário possui uma delivery independente. Consulte todos os resultados em
`GET /notifications/:id/deliveries?page=1&limit=100`, com filtros opcionais `channel`
e `status`. A resposta não expõe endereço nem identificador do provedor. Falhas e
contatos sem permissão também aparecem em `GET /notifications/delivery-issues`.
Eventos operacionais de falha, skip e retry são emitidos em `log:created` sem email,
telefone, `chat_id` ou conteúdo da mensagem.

## Webhooks

### Telegram

`POST /api/webhooks/telegram`

- valida `X-Telegram-Bot-Api-Secret-Token` com comparação segura;
- deduplica `update_id` via Redis/fallback local;
- processa mensagem, callback de menu e mudança de associação;
- persiste conversa/evento e emite realtime.

O registro aceita uma URL HTTPS raiz e acrescenta a rota quando necessário.

### WhatsApp Cloud

`GET /api/webhooks/whatsapp-cloud` responde ao challenge com o verify token. `POST` valida `X-Hub-Signature-256` sobre o corpo bruto usando o App Secret antes de processar:

- mensagens e contatos inbound;
- comandos de consentimento;
- status `sent`, `delivered`, `read` e `failed`;
- receipts recebidos antes de a entrega local terminar, preservados para reconciliação posterior.

Configuração de envio (`access token` + `phone number ID`) é independente da configuração do webhook (`verify token` + `app secret`). Um canal incompleto não impede outro.

## Socket.IO e eventos

O servidor Socket.IO compartilha o HTTP server e exige access JWT administrativo no handshake. Eventos principais:

| Evento | Finalidade |
|---|---|
| `system:ready` | conexão autenticada pronta |
| `log:created` | novo log operacional |
| `admin_notification:created` | sino do administrador |
| `conversation:message`, `conversations:updated` | inbox local |
| `telegram:message`, `telegram:webhook` | updates Telegram |
| `whatsapp_cloud:message/webhook` | eventos Cloud |
| `contact:auto_upserted` | contato criado/atualizado pelo provedor |

O socket é desconectado quando o access token expira; o frontend renova/reconecta.

## Segurança e privacidade

- Helmet, CORS allowlist, HPP, sanitização de operadores Mongo, limites de corpo e erro centralizado.
- Rate limits geral, webhook, auth e código de perfil; strikes podem bloquear IP no Redis ou fallback local.
- AES-256-GCM para PII, destinos, metadados, evidências e settings runtime.
- HMAC-SHA-256 para blind indexes e hashes de tokens.
- Redação de chaves sensíveis nos logs; TTL padrão de 180 dias.
- Índices únicos e TTL para sessão, challenge, receipts, conversas e mensagens.
- App secrets/tokens nunca devem aparecer no repositório, log ou resposta da API.
- A solução cifra dados em repouso e usa TLS até os provedores; não é E2EE servidor-destinatário.

Trocar `ENCRYPTION_KEY` ou `SEARCH_HASH_KEY` sem migração torna registros existentes ilegíveis ou não pesquisáveis.

## Variáveis de ambiente

Consulte `.env.example`. Em produção, são obrigatórios:

- `MONGODB_URI`, `REDIS_URL` e `REDIS_REQUIRED=true`;
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `SEARCH_HASH_KEY`, `INVITE_TOKEN_SECRET` independentes e fortes;
- ao menos `ADMIN1_EMAIL`/`ADMIN1_PASSWORD`;
- `PUBLIC_APP_URL`, `CORS_ORIGINS`, `TRUST_PROXY=1` e `COOKIE_SECURE=true` sob HTTPS.

Outros grupos:

| Grupo | Variáveis |
|---|---|
| Perfil | `PROFILE_JWT_SECRET`, TTL e limites `PROFILE_CODE_*` |
| Telegram | token, webhook secret, username e comando de onboarding |
| Cloud | access token, IDs, verify token, app secret, versão e número público |
| Gmail | usuário, App Password, remetente e nome |
| Proteção | `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_MAX`, `IP_BLOCK_*` |

Settings cadastrados pela UI são cifrados no MongoDB e têm precedência sobre o ambiente.

## Render

O Blueprint da raiz usa esta API como private service Docker. Ela não recebe
subdomínio público próprio: chamadas externas, webhooks e Socket.IO passam pelo
frontend público em `https://notify-flow.onrender.com/api` e
`https://notify-flow.onrender.com/socket.io`. No Compose, o frontend recebe
`API_UPSTREAM=api:3000`; no Render, o mesmo valor é injetado com o `hostport`
real da rede privada. MongoDB é externo (Atlas) e Redis usa Render Key Value.

Para escalar horizontalmente, separe o worker e adicione um adapter Redis ao Socket.IO.

## Qualidade

```powershell
npm run lint
npm test
npm run check
npm audit --omit=dev
```

Os testes cobrem arquitetura, DTOs, criptografia, deduplicação de identidade, consentimento, templates, webhooks, filas, recovery, receipts, autenticação de perfil e convites/LGPD.
