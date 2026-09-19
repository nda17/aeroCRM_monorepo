# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app
ENV HUSKY=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/landing/package.json apps/landing/package.json
COPY apps/crm/package.json apps/crm/package.json
COPY apps/admin-panel/package.json apps/admin-panel/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/ ./
COPY . .
ARG FRONTEND_APP
ARG NEXT_PUBLIC_MODE=production
ARG NEXT_PUBLIC_SITE_URL=https://aerocrm.space
ARG NEXT_PUBLIC_PRODUCTION_HOST=https://api.aerocrm.space
ARG NEXT_PUBLIC_API_URL=https://api.aerocrm.space/api/v1
ARG NEXT_PUBLIC_APP_URL=https://workspace.aerocrm.space
ARG NEXT_PUBLIC_MAIN_APP_URL=https://aerocrm.space
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_CRM_BILLING_ENABLED=true
ENV NEXT_PUBLIC_MODE=${NEXT_PUBLIC_MODE} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_PRODUCTION_HOST=${NEXT_PUBLIC_PRODUCTION_HOST} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_MAIN_APP_URL=${NEXT_PUBLIC_MAIN_APP_URL} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} \
    NEXT_PUBLIC_CRM_BILLING_ENABLED=${NEXT_PUBLIC_CRM_BILLING_ENABLED}
RUN --network=none set -eu; \
    case "$FRONTEND_APP" in landing|crm|admin-panel) ;; *) exit 64 ;; esac; \
    case "$NEXT_PUBLIC_CRM_BILLING_ENABLED" in true|false) ;; *) exit 64 ;; esac; \
    pnpm --filter "./apps/${FRONTEND_APP}" build; \
    mkdir -p "apps/${FRONTEND_APP}/public"

FROM node:20-alpine AS runner
WORKDIR /app
ARG FRONTEND_APP
ARG APP_REVISION
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    FRONTEND_APP=${FRONTEND_APP} APP_REVISION=${APP_REVISION}
LABEL org.opencontainers.image.revision="${APP_REVISION}" ru.aerocrm.frontend.app="${FRONTEND_APP}"
RUN addgroup -S -g 1001 nodejs && adduser -S -D -H -u 1001 -G nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/${FRONTEND_APP}/.next/standalone/ ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/${FRONTEND_APP}/.next/static/ ./apps/${FRONTEND_APP}/.next/static/
COPY --from=builder --chown=nextjs:nodejs /app/apps/${FRONTEND_APP}/public/ ./apps/${FRONTEND_APP}/public/
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "exec node apps/${FRONTEND_APP}/server.js"]
