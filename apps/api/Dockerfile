# syntax=docker/dockerfile:1.7

FROM node:24.19.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM dependencies AS build

COPY apps/api apps/api
COPY packages packages

RUN pnpm --filter @hktutor/api build

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm --filter @hktutor/api deploy --prod --legacy /production/api && \
  cp -R apps/api/dist /production/api/dist

FROM node:24.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

COPY --from=build --chown=node:node /production/api ./

USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]
