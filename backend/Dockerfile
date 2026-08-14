# syntax=docker/dockerfile:1

# ── deps ─────────────────────────────────────────────────────────────────────
# All runtime deps are pure JS (express, pg, jose), so no build toolchain is
# needed and this stage exists only to keep devDependencies out of the runtime.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine

# tini reaps zombies and forwards SIGTERM, so `kubectl rollout` and Ctrl-C stop
# the server promptly instead of waiting out the grace period.
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

# Numeric on purpose: Kubernetes cannot resolve a username to a UID, so a pod
# with runAsNonRoot rejects an image whose USER is a name ("cannot verify user
# is non-root"). 1000:1000 is the `node` user in node:20-alpine.
USER 1000:1000
EXPOSE 5001

# Liveness/readiness probe target: GET /api/health
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
