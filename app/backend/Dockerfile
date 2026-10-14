# syntax=docker/dockerfile:1
# Backend NestJS. Contexto: raíz del repo (pnpm workspace + lockfile).
#   docker compose build backend

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# --- build: dependencias completas, compilación y migraciones ---------------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY app/backend/package.json app/backend/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter backend...
COPY app/backend app/backend
RUN pnpm --filter backend build
# Carpeta autocontenida solo con dependencias de producción.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter backend deploy --prod /prod/backend

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/backend/node_modules ./node_modules
COPY --from=build /repo/app/backend/package.json ./
COPY --from=build /repo/app/backend/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
