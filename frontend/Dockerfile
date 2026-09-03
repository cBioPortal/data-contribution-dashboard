# syntax=docker/dockerfile:1

# ── build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
# nginx-unprivileged listens on 8080 as a non-root user, which satisfies a
# "restricted" PodSecurity namespace without extra securityContext wiring.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
# Not under conf.d/, which nginx auto-includes into the http block — this one is
# pulled in explicitly by each location that needs it.
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf

# uid 101 is the `nginx` user; the html dir must be writable so the entrypoint
# can rewrite config.js at startup.
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

# The base image runs everything in /docker-entrypoint.d/ before starting nginx,
# so no custom ENTRYPOINT is needed. The 40- prefix orders it after the base
# image's own scripts.
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.d/40-render-config.sh

EXPOSE 8080

# Probe target: GET /healthz
