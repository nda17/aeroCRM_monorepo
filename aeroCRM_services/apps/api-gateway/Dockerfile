FROM node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2 AS build

WORKDIR /app
ENV PNPM_VERSION=9.15.9
RUN corepack enable \
	&& NODE_OPTIONS=--dns-result-order=ipv4first corepack prepare pnpm@${PNPM_VERSION} --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2 AS runtime

ARG APP_REVISION=unknown
ENV NODE_ENV=production
ENV APP_REVISION=${APP_REVISION}
WORKDIR /app

COPY --from=build /app/dist/src ./dist/src

LABEL org.opencontainers.image.revision="${APP_REVISION}"

USER node
EXPOSE 4100

CMD ["node", "dist/src/main.js"]
