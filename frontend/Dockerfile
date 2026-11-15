FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
# Nome do produto vem do .env (via docker-compose); o Vite injeta em import.meta.env e no index.html.
ARG PRODUCT_NAME
ENV PRODUCT_NAME=${PRODUCT_NAME}
RUN test -n "$PRODUCT_NAME" && npm run build

# Landing em "/" e app em "/app/" no mesmo nginx. A landing chega pelo contexto extra "landing"
# (docker-compose.yml: additional_contexts); copiamos só o que a página publica.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=landing index.html /usr/share/nginx/html/
COPY --from=landing css /usr/share/nginx/html/css
COPY --from=landing js /usr/share/nginx/html/js
COPY --from=landing assets /usr/share/nginx/html/assets
COPY --from=landing data /usr/share/nginx/html/data
COPY --from=build /app/dist /usr/share/nginx/html/app
