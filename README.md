# Notify Flow

O **Notify Flow** é um painel de notificações multicanal orientado a consentimento. Ele centraliza contatos, grupos, templates, filas e evidências de entrega para **Telegram Bot API**, **WhatsApp Cloud API oficial** e **Gmail**. A integração opcional com `whatsapp-web.js` funciona somente como monitor de conversas e resposta individual autorizada — ela não participa de campanhas, templates ou disparos em massa.

O principal problema resolvido é a integração com a API oficial do WhatsApp: mensagens proativas saem por templates aprovados pela Meta, com webhooks de status, rastreabilidade e menor risco operacional do que automações baseadas em uma sessão pessoal. Isso não substitui o cumprimento das políticas da Meta nem garante a entrega de cada mensagem.

## Documentação do projeto

- [Guia técnico e funcional](docs/notify-flow-guia-tecnico-funcional.docx) — tutorial, requisitos, user stories, arquitetura e operação.
- [Apresentação do sistema](docs/notify-flow-apresentacao.pptx) — visão executiva e técnica em slides.
- [Regras dos canais](docs/CHANNELS.md) — capacidades, consentimento e limitações por provedor.
- [API](api/README.md) — camadas, rotas, filas, webhooks e segurança.
- [Frontend](frontend/README.md) — páginas, estado, realtime e build.

## Visão da arquitetura

```mermaid
flowchart LR
    U[Contato / visitante] -->|convite, Meu perfil| FE
    A[Administrador] -->|SPA| FE[Vue + Quasar\nNginx]
    FE -->|REST /api| API[Express API]
    FE <-->|Socket.IO| API
    API --> M[(MongoDB)]
    API --> R[(Redis / BullMQ)]
    R --> W[Worker de notificações]
    W --> TG[Telegram Bot API]
    W --> META[WhatsApp Cloud API]
    W --> GM[Gmail SMTP]
    TG -->|webhook| API
    META -->|webhook assinado| API
    WW[WhatsApp Web opcional\nQR + chat direto] <-->|eventos novos| API
```

O backend segue `route -> DTO/middleware -> controller -> manager -> model/service`. MongoDB mantém o estado durável; Redis coordena filas, retries e recursos temporários; Socket.IO atualiza QR, chats, logs e avisos administrativos em tempo real.

## Matriz de canais

| Canal | Campanhas | Conteúdo | Entrada/realtime | Regra principal |
|---|---|---|---|---|
| Telegram | Sim | Texto, foto, vídeo e menus/submenus | Webhook + Socket.IO | O usuário precisa iniciar/interagir com o bot; `/stop` revoga. |
| WhatsApp Cloud | Sim | Somente template oficial aprovado | Webhook Meta + receipts | O comando configurado autoriza Web e Cloud; envios proativos usam template. |
| Gmail | Sim | Texto e HTML sanitizado | Log de envio | Exige endereço conhecido e consentimento para campanhas. |
| WhatsApp Web | **Não** | Resposta direta em chat individual | Eventos novos após QR/`ready` | Integração não oficial, opcional e fora da fila de notificações. |

Falha ou ausência de um canal não bloqueia os demais. Em um disparo global, o administrador escolhe um template próprio para cada canal selecionado; destinatários sem identidade autorizada ficam como `skipped`, com motivo auditável.

## Jornadas principais

### Contato

1. Abre um convite público e lê Termos de Uso, Termos de Serviço e Política de Privacidade.
2. Inicia o canal escolhido e autoriza notificações quando aplicável.
3. Pode acessar `/meu-perfil` por email ou telefone usando um código único de seis dígitos, válido por dez minutos por padrão.
4. Consulta seus dados e histórico e revoga permissões separadamente.

### Administrador

1. Configura e testa cada provedor de forma independente.
2. Cadastra contatos/grupos e cria templates por formulários, sem editar JSON.
3. Seleciona contatos ou grupos e agenda um envio por canal ou global.
4. Acompanha fila, tentativas, receipts, falhas e contatos que precisam de autorização.

## Preparação da Meta e do WhatsApp oficial

Para produção, a Meta espera uma organização real e dados consistentes. O fluxo resumido é:

1. constituir/usar uma empresa real e manter documentos, telefone, domínio e endereço verificáveis;
2. criar uma conta pessoal no Facebook para administrar os ativos;
3. criar uma Página da empresa e associá-la a um **Portfólio Empresarial (Business Manager)** como requisito de governança deste projeto — a Página é recomendada, mas não é um requisito técnico universal da Cloud API para todo caso de envio;
4. em [developers.facebook.com/apps](https://developers.facebook.com/apps/), criar um app do tipo Empresa e adicionar o produto WhatsApp;
5. no modo de teste, usar o número, token temporário e destinatários autorizados fornecidos pela Meta;
6. criar/configurar a WABA, o número de produção, método de pagamento, permissões, URLs públicas e webhook HTTPS;
7. criar e submeter templates, aguardar aprovação e testar mensagens e receipts;
8. verificar a empresa, concluir os requisitos de análise/permissões e colocar o app em modo ao vivo quando aplicável.

O modo de teste é limitado a recursos e destinatários de teste. Em produção, preços, categorias de template e limites de conversas iniciadas pela empresa variam por mercado, categoria, conta e política vigente. O nível atual aparece no WhatsApp Manager; sua evolução depende de verificação, qualidade e volume de mensagens elegíveis. Consulte sempre as páginas oficiais de [preços](https://whatsappbusiness.com/products/platform-pricing/) e [onboarding/limites](https://whatsappbusiness.com/resources/resource-library/api-onboarding/), porque esses critérios podem mudar.

A revisão pode exigir documentos societários, correspondência exata dos dados da empresa, domínio, política de privacidade, método de pagamento e comprovação do caso de uso. Planeje essa burocracia antes da data de lançamento.

### Templates do sistema

Três templates WhatsApp Cloud são semeados e protegidos contra exclusão:

| Nome oficial | Idioma | Uso |
|---|---|---|
| `verify_code_1` | `pt_BR` | Código de acesso ao Meu perfil; BODY e botão de copiar recebem `{{codigo}}`. |
| `jaspers_market_plain_text_v1` | `en_US` | Exemplo disponibilizado em determinadas contas de teste; sem parâmetros. |
| `jaspers_market_order_confirmation_v1` | `en_US` | Exemplo de conta de teste com nome, número do pedido e data. |

O nome e idioma precisam existir e estar aprovados na WABA usada pelo envio. O preset `hello_world` também está disponível para teste, mas não é um registro fixo do banco.

## Execução local com Docker

Requisitos: Docker Engine/Desktop 24+ e Docker Compose v2.

```powershell
Copy-Item .env.example .env
# Troque senhas, chaves e URLs antes de iniciar.
docker compose up --build -d
docker compose ps
```

- Painel: <http://localhost:8080>
- Health da API: <http://localhost:3000/api/health>
- Login: `ADMIN1_EMAIL` e `ADMIN1_PASSWORD` definidos no `.env` local.

O Compose sobe `frontend`, `api`, MongoDB e Redis. Os volumes `mongo_data`, `redis_data` e `whatsapp_sessions` preservam dados entre reinícios. `docker compose down --volumes` apaga esses dados e deve ser usado apenas de forma intencional.

## Variáveis de ambiente

Use `.env.example` como catálogo e nunca versione `.env`.

| Grupo | Variáveis principais |
|---|---|
| URLs/infra | `PUBLIC_APP_URL`, `CORS_ORIGINS`, `API_PORT`, `FRONTEND_PORT`, `MONGODB_URI`, `REDIS_URL`, `REDIS_REQUIRED` |
| Administração | `ADMIN{N}_EMAIL`, `ADMIN{N}_PASSWORD` |
| JWT/criptografia | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PROFILE_JWT_SECRET`, `ENCRYPTION_KEY`, `SEARCH_HASH_KEY`, `INVITE_TOKEN_SECRET` |
| Meu perfil | `PROFILE_JWT_TTL`, `PROFILE_CODE_TTL_SECONDS`, `PROFILE_CODE_MAX_ATTEMPTS`, limites de solicitação/reenvio |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `START_VERIFY_TELEGRAM_PERMISSION` |
| WhatsApp Cloud | `WHATSAPP_CLOUD_ACCESS_TOKEN`, IDs, verify token, app secret, versão e número público |
| WhatsApp Web | caminho/TTL da sessão, retenção de mensagens, auto init e executável Chromium |
| Gmail | `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM`, `GMAIL_FROM_NAME` |
| Consentimento | `START_NOTIFY_WHATSAPP_PERMISSION` (`/notify-me` por padrão) |

Credenciais de canal podem ser cadastradas na tela **Início**. Valores runtime ficam criptografados no MongoDB, prevalecem sobre o ambiente e são retornados à UI apenas como “configurado/não configurado”. `PUBLIC_APP_URL` continua sendo a fonte para links públicos; não há URL ngrok fixa no código.

## Fila, retries e observabilidade

- BullMQ processa até cinco jobs simultâneos no worker atual.
- O job e cada entrega admitem até quatro tentativas, com backoff para falhas transitórias.
- Um marcador no MongoDB preserva notificações que não puderam ser enfileiradas; uma varredura recupera estados parados.
- Contatos, grupos, consentimentos e configuração são revalidados antes de cada entrega.
- Logs ocultam chaves sensíveis e expiram em 180 dias por padrão; receipts do WhatsApp Cloud são reconciliados com cada entrega.
- Socket.IO exige JWT administrativo e transmite somente eventos operacionais autenticados.

## Rotas de alto nível

| Área | Prefixo |
|---|---|
| Auth administrativa | `/api/auth` |
| Contatos e grupos | `/api/contacts`, `/api/contact-groups` |
| Templates e campanhas | `/api/templates`, `/api/notifications` |
| Conversas locais | `/api/conversations` |
| Canais | `/api/telegram`, `/api/whatsapp-cloud`, `/api/whatsapp-web`, `/api/email` |
| Webhooks | `/api/webhooks/telegram`, `/api/webhooks/whatsapp-cloud` |
| Convites e termos públicos | `/api/public/invites`, `/api/public/terms` |
| Meu perfil | `/api/my-profile` |
| LGPD e auditoria | `/api/privacy`, `/api/logs`, `/api/admin-notifications` |

## Deploy com Render Blueprint

O arquivo suportado pelo Render é **[`render.yaml`](render.yaml)** — não existe formato `render.xml` para Blueprints. Consulte a [especificação oficial de Blueprints](https://render.com/docs/blueprint-spec). O Blueprint deste projeto provisiona:

- frontend Docker público, que também encaminha `/api` e `/socket.io`;
- API Docker privada referenciada pelo Blueprint;
- Render Key Value compatível com Redis;
- disco persistente pago para `/app/.wwebjs_auth`;
- `MONGODB_URI` solicitado durante o sync para uma instância MongoDB Atlas.

Antes do primeiro deploy, informe a URL pública do frontend em `PUBLIC_APP_URL` e `CORS_ORIGINS`, as credenciais administrativas e a URI do Atlas. No Atlas, autorize a saída do Render e exija TLS. Integrações externas podem ser configuradas depois pela UI.

Os três recursos do Blueprint usam `plan: starter`: é o menor tipo de instância
pago para o frontend, a API privada e o Render Key Value. Assim, nenhum deles
usa a modalidade gratuita que hiberna. A API mantém um disco persistente de
1 GB para a sessão opcional do WhatsApp Web e, por restrição do Render, não
define `maxShutdownDelaySeconds` enquanto esse disco estiver anexado.

O frontend usa um template de configuração do Nginx em runtime. No Compose,
`API_UPSTREAM=api:3000`; no Render, o Blueprint injeta automaticamente o
`hostport` privado real da API. Assim, o proxy não depende de um hostname local
que não existe na rede privada do Render.

O WhatsApp Web impõe restrições importantes no Render: Chromium consome memória/CPU, o [disco persistente](https://render.com/docs/disks) é pago e limita a API a uma instância, deploys interrompem a sessão e o filesystem não garante que o WhatsApp manterá a autenticação. Por isso ele continua opcional. [WebSockets são suportados](https://render.com/docs/websocket), mas o cliente deve reconectar após deploys ou manutenção. Para MongoDB, siga as recomendações de [deploy e backup do Render](https://render.com/docs/deploy-mongodb) ou use Atlas gerenciado.

## Qualidade

```powershell
Set-Location api
npm run check

Set-Location ..\frontend
npm test
npm run build

Set-Location ..
docker compose config
```

Antes de produção, faça smoke test dos webhooks, fila, receipts, opt-out e restauração de backup. A tecnologia oferece controles para LGPD, mas a organização ainda precisa definir base legal, retenção, encarregado, resposta a incidentes e processo de atendimento ao titular.
