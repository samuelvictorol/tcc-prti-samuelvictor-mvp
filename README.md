# Notify Flow

Painel administrativo multicanal para cadastrar contatos, registrar consentimentos e enviar notificações por Telegram Bot API, WhatsApp Web, WhatsApp Cloud API e Gmail. O projeto separa o backend Express em `api/`, o frontend Quasar/Vue em `frontend/` e mantém a orquestração em `docker-compose.yml` na raiz.

> **MVP operacional, não um serviço de spam.** O escopo de grupos é revalidado ao iniciar o job, e contato, canal e consentimento são revalidados em cada entrega. Clique em convite não é tratado como consentimento por si só. As limitações verificadas dos provedores estão em [`docs/CHANNELS.md`](docs/CHANNELS.md).

## Início rápido

Requisitos: Docker Engine/Desktop 24+ com Docker Compose v2.

```powershell
Copy-Item .env.example .env
# Edite .env e troque todos os segredos e a senha inicial.
docker compose up --build -d
docker compose ps
```

Acesse:

- Painel: <http://localhost:8080>
- API/health: <http://localhost:3000/api/health>
- Login: use `ADMIN1_EMAIL` e `ADMIN1_PASSWORD` do arquivo local `.env`.

O Compose recusa iniciar sem os cinco segredos da aplicação e sem a senha inicial. Administradores são sincronizados no bootstrap por pares `ADMIN1_EMAIL`/`ADMIN1_PASSWORD`, `ADMIN2_EMAIL`/`ADMIN2_PASSWORD` e assim por diante. Remover um par do ambiente desativa aquele administrador gerenciado pelo ambiente.

Para acompanhar a inicialização:

```powershell
docker compose logs -f api frontend
```

Para parar sem apagar dados:

```powershell
docker compose down
```

Para apagar MongoDB, Redis e a sessão do WhatsApp Web, a operação é destrutiva e deve ser intencional:

```powershell
docker compose down --volumes
```

## Serviços

| Serviço | Responsabilidade | Porta publicada |
|---|---|---:|
| `frontend` | SPA Quasar compilada e servida pelo Nginx; proxy de `/api` e Socket.IO | `8080` |
| `api` | Express, webhooks, managers, fila/worker e Socket.IO | `3000` |
| `mongo` | Dados da aplicação e índices cegos | interna |
| `redis` | Fila, locks/coordenação e proteção operacional | interna |

Os volumes `mongo_data`, `redis_data` e `whatsapp_sessions` persistem entre reinícios. A API aguarda Mongo e Redis saudáveis; o frontend aguarda a API responder ao healthcheck.

## Arquitetura

```text
notify-app/
├── api/
│   ├── src/
│   │   ├── config/         # ambiente, MongoDB e inicialização
│   │   ├── controllers/    # tradução HTTP; chamam apenas managers
│   │   ├── dtos/           # contratos Zod
│   │   ├── enums/          # canais e estados
│   │   ├── managers/       # regras de negócio e coordenação
│   │   ├── middlewares/    # JWT, validação, rate limit e erros
│   │   ├── models/         # Mongoose
│   │   ├── routes/         # arquivos *.routes.js autocarregados
│   │   ├── services/       # criptografia, Redis, fila e Socket.IO
│   │   └── utils/          # normalização e paginação
│   └── test/
├── frontend/
│   ├── src/
│   │   ├── components/     # componentes reutilizáveis
│   │   ├── layouts/        # navegação e guards visuais
│   │   ├── pages/          # menus administrativos e convite público
│   │   ├── services/       # HTTP, tokens e Socket.IO
│   │   └── stores/         # Pinia
│   └── nginx.conf
├── docs/
│   └── CHANNELS.md
├── .env.example
└── docker-compose.yml
```

O fluxo obrigatório é:

```text
router -> validação DTO/middleware -> controller -> manager -> model/adaptador/manager
```

Controllers não acessam models e não chamam outros controllers. O autoloader procura `api/src/routes/*.routes.js`; um novo domínio fica disponível ao exportar `{ basePath, router }`.

## Fluxos funcionais

### 1. Autenticação e sessão administrativa

1. No início, a API lê todos os pares `ADMIN{N}_*`, cria/atualiza os administradores e salva apenas hash bcrypt.
2. O login aplica limite próprio e registra tentativas inválidas para bloqueio temporário de IP.
3. Um access token JWT curto protege as rotas administrativas.
4. O refresh token é rotacionado, armazenado apenas como hash e transmitido por cookie `HttpOnly`.
5. Logout revoga a sessão atual; administradores removidos do ambiente deixam de autenticar.

### 2. Ativação de canais

Na tela **Início**, cada provedor é salvo separadamente. Um canal incompleto ou vazio não impede configurar nem testar outro. Valores sensíveis são write-only: respostas da API informam somente se o valor está configurado e qual é sua origem (`environment` ou `runtime`). O menu e a rota do canal repetem a verificação no backend.

- **Telegram:** requer somente o token do bot para envios. Ao salvá-lo, a aplicação consulta `getMe` e mostra automaticamente o nome e o `@username` oficiais, sem campo manual. O webhook é opcional para outbound, mas necessário para receber `/start`, mensagens e mudanças de associação; ao registrá-lo, a API gera um segredo seguro se nenhum tiver sido informado. Uma URL HTTPS raiz do ngrok recebe automaticamente `/api/webhooks/telegram`.
- **Gmail:** requer usuário, remetente e App Password.
- **WhatsApp Cloud:** requer access token, phone number ID, verify token e app secret para assinatura do webhook.
- **WhatsApp Web:** requer uma sessão realmente autenticada; a simples geração de QR não libera o menu.

### 3. WhatsApp Web

1. O administrador solicita um novo QR.
2. A API inicializa `whatsapp-web.js` e Chromium sob demanda, publica o QR por Socket.IO e mantém somente uma instância da sessão.
3. Depois do scan e do evento `ready`, a UI libera chats, envio rápido/template e criação de grupo interno a partir dos chats.
4. A sessão fica em volume persistente. `WHATSAPP_WEB_SESSION_MAX_AGE_DAYS` impõe a expiração local (90 dias por padrão); desconexão ou logout remoto também a invalida.

### 4. Convite público e consentimento

1. O administrador cria um convite com slug, título, descrição, gradiente e links `{ title, linkUrl, channel }`.
2. `/invite/:slug` é público e apresenta os botões configurados.
3. O redirecionamento registra clique agregado ou atribuído por token assinado quando houver um contato associado.
4. O texto da página deixa claro que iniciar uma conversa/autorizar escrita permite notificações futuras.
5. Webhook ou aceite explícito registra um evento de consentimento por canal, finalidade, origem, data e versão dos termos.

### 5. Contatos, grupos e opt-out

Um contato pode ter nenhum ou vários canais. Cada identidade possui endereço criptografado, blind index, origem da interação, autorização e estado de consentimento independentes. Grupos internos têm origem `manual`, `telegram`, `whatsapp_web`, `whatsapp_cloud` ou `email`, imagem quando disponível e podem armazenar um destino externo do canal.

Revogação, `/stop`, bloqueio do bot, exclusão ou `notificationDisabled` torna o destino inelegível imediatamente. Remover um grupo remove o agrupamento, não os contatos que pertenciam a ele. Remover um contato também retira suas referências dos grupos e mantém apenas a evidência mínima necessária de supressão/auditoria.

### 6. Templates e disparos

- Templates são filtrados por canal e `templateType`.
- Gmail aceita `subject`, texto e HTML; a UI mostra preview sanitizado.
- WhatsApp Cloud pode guardar o nome externo, idioma e componentes de um template aprovado pela Meta.
- O template global referencia variantes por canal; ele não tenta reutilizar o mesmo payload incompatível.
- Envio rápido usa conteúdo informado na hora e permite escolher um canal ou **Todos os canais disponíveis**; envio por template resolve a variante do canal.
- Um disparo global expande contatos e grupos, remove duplicados e avalia separadamente cada combinação contato/canal. Apenas canais configurados, prontos e autorizados entram na fila; os demais ficam como `skipped` sem bloquear os envios elegíveis.
- A fila Redis aplica tentativas com backoff. O worker recompõe os grupos ao iniciar o job e revalida contato, consentimento e configuração antes de cada chamada ao provedor.
- `Idempotency-Key`/`idempotencyKey` evita criar a mesma campanha duas vezes.
- A campanha guarda `queued`, `sent`, `failed` e `skipped` por entrega. Canais opcionais ignorados não transformam um lote bem-sucedido em parcial; `partial` indica que houve ao menos uma falha real de provedor junto com algum sucesso.

## Menus do frontend

- **Início:** status dos serviços, credenciais runtime, QR do WhatsApp Web e console paginado/realtime.
- **Contatos:** busca, CRUD, canais/consentimentos e grupos.
- **Templates:** CRUD por canal, payload específico e preview de e-mail.
- **Notificações:** envio rápido/template/global e histórico das entregas.
- **Telegram:** identidade oficial do bot, interações conhecidas, destinos de grupo, envio rápido/template e mensagens recentes atualizadas por Socket.IO enquanto a página estiver aberta. O botão de sincronização continua disponível para uma atualização manual.
- **WhatsApp Web:** caixa responsiva de chats, avatar quando disponível e ações de envio/grupo.
- **WhatsApp Cloud:** configuração protegida, envio e eventos do webhook.
- **Gmail:** texto/HTML, preview e envio.
- **Convites:** CRUD, links e acesso à página pública.
- **Termos e LGPD:** versionamento/publicação de termos, consentimentos e ações de acesso/exportação/revogação/exclusão.

## Endpoints

Todos os recursos administrativos usam `/api` e JWT, exceto healthcheck, login, refresh, convite/termos públicos e webhooks validados pelo provedor.

| Prefixo | Uso |
|---|---|
| `/api/health` | liveness/readiness |
| `/api/auth` | login, `me`, refresh e logout |
| `/api/settings` | credenciais write-only e status dos canais |
| `/api/logs` | console paginado |
| `/api/contacts` | contatos, consentimento, exportação e exclusão |
| `/api/contact-groups` | grupos e membros |
| `/api/templates` | templates por canal/global |
| `/api/notifications` | criação, fila, histórico e detalhes de entrega |
| `/api/invites` | convite administrativo e rotas públicas |
| `/api/terms` | termos versionados e publicação |
| `/api/privacy` | direitos do titular/LGPD |
| `/api/telegram` | webhook, interações, grupos e envio |
| `/api/whatsapp-web` | QR, sessão, chats e envio |
| `/api/whatsapp-cloud` | verificação/webhook e envio Meta |
| `/api/email` | envio rápido/template por Gmail |

Consulte também o próprio código em `api/src/routes`: ele é o contrato executável e contém a proteção/DTO exata de cada operação.

## Segurança e privacidade

- `helmet`, CORS restrito, `hpp`, limite de JSON, sanitização contra operadores Mongo e tratamento central de erros.
- Rate limits geral e de autenticação, contagem de falhas e bloqueio temporário de IP com Redis/fallback local.
- JWT com issuer/audience, access curto, refresh rotativo/revogável e cookies protegidos.
- AES-256-GCM com IV aleatório para contatos, destinos, metadados, credenciais runtime e evidências.
- HMAC-SHA-256 como blind index para igualdade/deduplicação sem guardar telefone/e-mail em claro.
- Segredos e PII não devem ser colocados nos logs; metadados de provider são reduzidos antes da persistência.
- Assinaturas/segredos de webhook são verificados antes de processar eventos.
- MongoDB e Redis não publicam portas no host pelo Compose.

“Criptografia ponta a ponta” não seria uma descrição correta deste servidor: ele precisa descriptografar o destino e o conteúdo no instante do envio. A garantia implementada é criptografia autenticada em repouso, TLS obrigatório na borda de produção e transporte cifrado até os provedores. Mensagens passam pelo respectivo provedor.

Trocar `ENCRYPTION_KEY` ou `SEARCH_HASH_KEY` sem uma migração torna dados existentes ilegíveis/não pesquisáveis. Use um cofre de segredos e backup/rotação planejados em produção.

## LGPD

O MVP fornece mecanismos técnicos para:

- registrar concessão, negação e revogação por canal;
- informar finalidade, origem, versão do termo e data;
- acessar/corrigir dados pelo CRUD administrativo;
- exportar uma cópia estruturada;
- bloquear, excluir ou anonimizar;
- impedir novas entregas após opt-out;
- versionar e publicar Termos de Uso/Serviço/Privacidade;
- preservar trilha mínima de auditoria sem expor o dado original.

Esses mecanismos não tornam uma operação automaticamente aderente à LGPD. A organização ainda deve definir controlador/operador, base legal, finalidade, retenção, compartilhamentos, encarregado, resposta a incidentes e procedimentos para solicitações dos titulares.

## Variáveis de ambiente

Use `.env.example` como catálogo. As principais são:

| Variável | Finalidade |
|---|---|
| `ADMIN{N}_EMAIL` / `ADMIN{N}_PASSWORD` | bootstrap dos administradores |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | assinatura de tokens distintos |
| `ENCRYPTION_KEY` | chave derivada da criptografia de campos |
| `SEARCH_HASH_KEY` | chave dos blind indexes |
| `INVITE_TOKEN_SECRET` | tokens atribuíveis dos convites |
| `MONGODB_ENSURE_INDEXES` | cria índices únicos e TTL declarados pelos models no boot |
| `WHATSAPP_WEB_SESSION_MAX_AGE_DAYS` | TTL local da sessão por QR |
| `PUBLIC_APP_URL` / `CORS_ORIGINS` | URL pública e origens permitidas |
| `RATE_LIMIT_*` / `IP_BLOCK_*` | proteção contra abuso |

Credenciais de canal podem ser fornecidas pelo ambiente ou cadastradas na tela Início. Configuração runtime é criptografada no MongoDB e prevalece sobre o ambiente até ser removida.

## Desenvolvimento sem Docker

Suba MongoDB e Redis e então:

```powershell
Copy-Item api/.env.example api/.env
Set-Location api
npm install
npm run dev
```

Em outro terminal:

```powershell
Set-Location frontend
npm install
npm run dev
```

O Vite abre em <http://localhost:9000> e encaminha `/api` e `/socket.io` para a API em `3000`.

## Testes e verificações

```powershell
Set-Location api
npm test
npm run lint

Set-Location ../frontend
npm test
npm run build

Set-Location ..
docker compose config
docker compose up --build -d
docker compose ps
```

Os testes do backend cobrem, entre outros contratos, criptografia round-trip/adulteração, validação de DTO e políticas críticas de elegibilidade. O build do frontend valida imports, rotas lazy e templates Vue. A validação final deve incluir smoke test autenticado e inspeção visual do painel.

## Implantação pública

Antes de expor a aplicação:

1. gere segredos aleatórios e uma senha administrativa exclusiva no `.env`;
2. publique somente o Nginx atrás de HTTPS; remova a porta direta da API se não for necessária;
3. restrinja `CORS_ORIGINS` e configure `TRUST_PROXY` conforme a quantidade real de proxies;
4. use MongoDB/Redis com autenticação, TLS, backup e política de retenção;
5. configure URLs HTTPS dos webhooks e valide os desafios/assinaturas;
6. avalie OAuth 2.0 para Gmail e a Cloud API oficial para WhatsApp crítico;
7. monitore filas, falhas, 429/403, desconexões e crescimento dos logs;
8. faça revisão jurídica dos termos, consentimentos e bases legais.

## Referências de arquitetura e produto

- [AitoSoftwares/quasar-vue-initializers](https://github.com/AitoSoftwares/quasar-vue-initializers)
- [AitoSoftwares/express-js-initializers — branch MongoDB](https://github.com/AitoSoftwares/express-js-initializers/tree/mongodb/src)
- [Quasar com Vite](https://quasar.dev/start/vite-plugin/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [Gmail App Passwords](https://support.google.com/accounts/answer/185833)
- [Lei Geral de Proteção de Dados](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/Lei13709.pdf)
