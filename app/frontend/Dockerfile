# syntax=docker/dockerfile:1
# Frontend Vite servido por nginx. Contexto: raíz del repo (pnpm workspace).
#   docker compose build frontend

FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY app/frontend/package.json app/frontend/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter frontend...
COPY app/frontend app/frontend
# Ruta del mismo dominio: Traefik manda /api/* al backend (sin CORS ni puertos).
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter frontend build

FROM nginx:1.27-alpine AS runtime
COPY app/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/app/frontend/dist /usr/share/nginx/html
EXPOSE 80
