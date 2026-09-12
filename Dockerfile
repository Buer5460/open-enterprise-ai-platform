# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm -r build

FROM node:24-bookworm-slim AS api
WORKDIR /app

ENV NODE_ENV=production \
    OEAP_DEPLOYMENT_MODE=production \
    OEAP_API_HOST=0.0.0.0 \
    OEAP_API_PORT=8787

COPY --from=build /app /app

EXPOSE 8787

CMD ["node", "apps/api/dist/index.js"]

FROM nginx:1.29-alpine AS web

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
