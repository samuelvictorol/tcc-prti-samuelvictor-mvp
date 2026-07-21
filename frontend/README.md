# Notify Flow — Frontend

SPA administrativa construída com Vue 3, Quasar, Pinia e Vite. A interface usa a API sob `/api` e Socket.IO sob `/socket.io`.

## Execução local

1. Copie `.env.example` para `.env` se precisar alterar o destino da API.
2. Instale as dependências com `npm install`.
3. Inicie com `npm run dev`.

O servidor de desenvolvimento usa a porta `9000` e encaminha `/api` e `/socket.io` para `http://localhost:3000` por padrão.

## Build

`npm run build` gera os arquivos estáticos em `dist/`. O `Dockerfile` faz um build multi-stage e entrega a SPA com Nginx, incluindo fallback de rotas, proxy para a API, WebSocket e endpoint `/healthz`.

## Contratos principais

- JWT: `/api/auth/login`, `/api/auth/me`, `/api/auth/refresh`, `/api/auth/logout`.
- Configuração e canais: `/api/settings`, `/api/settings/status`.
- Cadastros: `/api/contacts`, `/api/contact-groups`, `/api/templates`, `/api/invites`, `/api/terms`.
- Disparos auditáveis: `/api/notifications`.
- Operação: `/api/logs`, `/api/telegram`, `/api/whatsapp-web`, `/api/whatsapp-cloud`, `/api/email`, `/api/privacy`.

O menu e as rotas de canal ficam indisponíveis enquanto o status correspondente não estiver configurado; essa proteção visual não substitui os guards da API.
