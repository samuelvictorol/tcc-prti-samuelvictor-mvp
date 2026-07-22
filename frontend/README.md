# Notify Flow Frontend

SPA administrativa e pública construída com **Vue 3**, **Quasar 2**, **Pinia**, **Vue Router**, **Axios**, **Socket.IO Client** e **Vite**. Em produção, o build é servido por Nginx com fallback de rotas, headers de segurança e proxy same-origin para a API e o Socket.IO.

## Estrutura

```text
src/
├── components/  dialogs, builders e componentes reutilizáveis
├── css/         tokens Quasar e estilos globais
├── layouts/     shell autenticado, navegação e sino realtime
├── pages/       páginas administrativas e públicas
├── router/      rotas lazy e guards
├── services/    HTTP, tokens, Socket.IO e contratos de domínio
└── stores/      sessão e status dos canais com Pinia
```

As páginas não armazenam credenciais de provedor. Elas chamam serviços HTTP, recebem somente estados seguros (`configured`, origem e valores não sensíveis) e apresentam erros normalizados pela API.

## Rotas e páginas

### Públicas

| Rota | Função |
|---|---|
| `/login` | autenticação administrativa |
| `/invite/:slug` | convite público, documentos legais, links e QR da URL completa |
| `/meu-perfil` | login do contato, dados, permissões e histórico próprio |

### Administrativas

| Rota | Página |
|---|---|
| `/` | saúde, configurações independentes dos canais, QR Web e console de logs |
| `/contacts` | contatos, identidades, consentimentos e grupos |
| `/templates` | templates por canal e builders amigáveis |
| `/notifications` | campanhas por template, contatos/grupos e histórico de entregas |
| `/telegram` | conversas conhecidas, grupos e mensagens realtime |
| `/whatsapp-web` | inbox local e resposta direta autorizada; ativo somente após `ready` |
| `/whatsapp-cloud` | eventos do webhook, contatos e teste de template oficial |
| `/email` | teste/envio Gmail e preview sanitizado |
| `/invites` | CRUD, slug automático, ícone, links, cores e URL pública |
| `/terms` | documentos legais versionados |
| `/logins` | disponibilidade do login de contatos e auditoria dos challenges |

O router faz bootstrap da sessão antes de navegar. Rotas administrativas exigem access token; rotas de canal podem consultar o status real antes de liberar o menu. O guard visual não substitui as validações do backend.

## Estado e autenticação

### Administrador

- Access token e usuário ficam em `sessionStorage` ou `localStorage` quando “lembrar” é escolhido.
- Refresh token permanece em cookie `HttpOnly` gerenciado pela API.
- O interceptor tenta renovar a sessão e repete a requisição elegível.
- Logout limpa o estado local e revoga a sessão no servidor.

### Contato

- `/meu-perfil` oferece seleção explícita entre email e telefone.
- O campo de telefone usa teclado `tel`, máscara brasileira de 10/11 dígitos e normaliza o valor antes do envio.
- Após validar o código, o profile token separado fica em `localStorage` com a expiração.
- Um timer e o interceptor removem a sessão expirada e voltam ao login.
- A área autenticada consulta apenas o perfil e o histórico daquele contato.

## Serviços do frontend

| Arquivo/área | Responsabilidade |
|---|---|
| `services/http.js` | Axios administrativo, refresh e envelope de erros |
| `services/tokens.js` | access token e usuário administrativo |
| `services/profile.js` | client isolado e token de `/meu-perfil` |
| `services/profile-identifier.js` | máscara, validação e normalização do login |
| `services/socket.js` | conexão autenticada, reconexão e recuperação de token |
| `services/channels.js` | status/configuração de provedores |
| `services/telegram*.js` | chats e templates Telegram |
| `services/whatsapp-web.js` | normalização do estado QR/ready |
| `services/public-invites.js` | termos públicos e links de convite |
| `services/contact-identities.js` | apresentação segura das identidades |

## Realtime

Socket.IO é criado com o access JWT administrativo e usa `/socket.io`. As telas assinam eventos somente enquanto montadas e removem listeners no unmount.

| Evento | Consumidor |
|---|---|
| `admin_notification:created` | sino do header e atalho para contato/canal |
| `log:created` | console da página Início e acompanhamento Cloud |
| `whatsapp_web:qr/status/ready/disconnected` | QR, botões e disponibilidade do menu Web |
| `conversation:message`, `conversations:updated` | chats Telegram e WhatsApp Web |
| `telegram:chats`, `telegram:webhook` | lista e mensagens Telegram |
| `whatsapp_cloud:webhook` | banner/resumo do webhook Meta |
| `contact:auto_upserted` | atualização de contatos reconhecidos |

A tela faz fetch inicial e usa o socket como atualização incremental; a consistência não depende de o usuário manter a página aberta.

## Builders e previews

- **WhatsApp Cloud:** preset ou nome oficial, idioma e componentes/parameters construídos por formulário; sem JSON manual.
- **Telegram:** texto, foto, vídeo ou árvore de menus/submenus com botões de URL/navegação.
- **Email:** assunto, texto e HTML; preview usa DOMPurify.
- **Convite:** preview responsivo, ícone HTTPS, gradiente, links e QR.
- **Termos:** visualização sanitizada em dialog persistente e rolável.

HTML é permitido apenas para email e documentos legais; nunca é renderizado sem sanitização.

## WhatsApp Web

O frontend não pede histórico ao provedor. Depois do QR e `ready`, mostra apenas eventos novos persistidos pela API em `/api/conversations`.

- Remetente desconhecido aparece somente para leitura.
- Responder exige contato e identidade Web autorizada.
- Não há grupos, templates, campanha ou envio em massa.
- Os endpoints legados de sync/histórico retornam 410 e não devem ser usados.
- Logout e regeneração do QR são ações explícitas na tela Início.

## Variáveis de ambiente

Arquivo de exemplo: `.env.example`.

| Variável | Uso |
|---|---|
| `VITE_API_BASE_URL` | base REST; `/api` por padrão |
| `VITE_SOCKET_URL` | origem explícita do Socket.IO; vazio usa same-origin |
| `VITE_DEV_API_TARGET` | destino do proxy Vite em desenvolvimento |

Variáveis `VITE_*` são incorporadas ao bundle e nunca devem conter segredos. Em Docker/Render, mantenha `/api` e Socket.IO same-origin para usar o Nginx como única borda pública.

## Desenvolvimento

```powershell
npm ci
npm run dev
```

O Vite abre a porta `9000` e encaminha `/api` e `/socket.io` para `VITE_DEV_API_TARGET` ou `http://localhost:3000`.

## Testes e build

```powershell
npm test
npm run build
```

Os testes Vitest cobrem sessão/refresh, dialogs, contatos, convites, perfil, templates, páginas de canal, Socket.IO e contratos HTTP. O build alvo é ES2022 e gera `dist/`.

## Docker e Nginx

O Dockerfile multi-stage:

1. instala dependências e executa o build Vite;
2. copia `dist/` para Nginx Alpine;
3. expõe `/healthz`, fallback SPA, cache de assets, `/api` e upgrade WebSocket.

O CSP restringe scripts à própria origem, proíbe frames e permite imagens HTTPS/data/blob necessárias para avatars, QR e previews.

## Deploy no Render

O `render.yaml` da raiz publica este container como web service. O Nginx atual usa `http://api:3000` como upstream privado; portanto, o serviço backend do Blueprint precisa se chamar `api` e ficar na mesma região/rede privada.

O health check recomendado no Blueprint é `/api/health`, pois atravessa o proxy e comprova frontend, API, MongoDB e Redis. `PUBLIC_APP_URL` e `CORS_ORIGINS` são variáveis da API e devem conter a URL HTTPS pública deste frontend.

WebSockets funcionam pelo mesmo domínio. Conexões podem cair em deploy/manutenção; o client reconecta e refaz o fetch de estado.
