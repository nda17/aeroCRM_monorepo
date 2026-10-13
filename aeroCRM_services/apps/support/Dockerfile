FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base

RUN apt-get update \
	&& apt-get install --yes --no-install-recommends ca-certificates openssl \
	&& rm -rf /var/lib/apt/lists/*

FROM base AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma:generate \
	&& pnpm build \
	&& pnpm prune --prod

FROM base AS runtime

ARG APP_REVISION=unknown
ENV APP_REVISION=${APP_REVISION}
LABEL org.opencontainers.image.title="aerocrm-support" \
	org.opencontainers.image.revision="$APP_REVISION"

ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 1001 support \
	&& useradd --system --uid 1001 --gid support --home-dir /app support

COPY --from=build --chown=support:support /app/dist ./dist
COPY --from=build --chown=support:support /app/node_modules ./node_modules
COPY --from=build --chown=support:support /app/package.json ./package.json
COPY --from=build --chown=support:support /app/prisma ./prisma

USER support
EXPOSE 5100 5101 5102
CMD ["node", "dist/src/main.js"]
