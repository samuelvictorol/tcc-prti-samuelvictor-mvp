FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ARG VITE_API_BASE_URL=/api
ARG VITE_SOCKET_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}

RUN npm run build

FROM nginx:1.27-alpine AS runtime

ENV PORT=80 \
    API_UPSTREAM=api:3000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

# A imagem oficial processa templates em runtime. Isso mantém o mesmo artefato
# compatível com o DNS do Docker Compose e com o host privado injetado pelo Render.
COPY --chmod=755 docker-entrypoint.d/16-normalize-api-upstream.envsh /docker-entrypoint.d/16-normalize-api-upstream.envsh
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["nginx", "-g", "daemon off;"]
