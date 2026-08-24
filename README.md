# cBioPortal Data Contribution Dashboard

The cBioPortal Data Contribution Dashboard makes it easy for researchers to contribute cancer genomics datasets to cBioPortal and follow their progress through the curation process.

Researchers can suggest published papers or submit their own datasets, track each submission from start to finish, and explore analytics about the data already available in cBioPortal. The curation team can review submissions, manage the curation workflow, and communicate progress in one place.

---

## Features

### Submit Data

Researchers can:

- Suggest a published paper for curation.
- Submit their own dataset to cBioPortal.
- Provide a link to their data (Google Drive, Dropbox, Box, etc.) instead of uploading files directly.
- Add study details and give the curation team access to the data.

### Track Submission Status

After submitting, contributors can monitor the progress of their submission through each stage of the curation pipeline, from **Submitted** to **Released**, without needing to contact the curation team for updates.

### Explore Analytics

The dashboard includes interactive analytics powered by cBioPortal data, including:

- Samples by cancer type
- Growth of studies over time
- Available data types
- Submission and curation pipeline statistics

## Tech stack

**Frontend**
- React + TypeScript, built with Vite
- Tailwind CSS with shadcn/ui (Radix UI primitives)
- React Router, TanStack Query
- Recharts and AG Grid for charts and tables
- `keycloak-js` for authentication

**Backend**
- Node.js + Express
- **PostgreSQL** (`pg`) — the app's own data (users, submissions)
- **ClickHouse** (over HTTP) — read-only access to cBioPortal's genomics dataset for analytics
- **Keycloak (OIDC)** — authentication; tokens validated via JWKS (`jose`)
- Helmet, CORS, rate limiting, and request validation

## Architecture at a glance

Authentication is handled by Keycloak.

Users sign in through Keycloak, and the backend validates the JWT before creating or retrieving the corresponding user record. 

The application uses two databases:
| Database | Purpose |
|----------|---------|
| PostgreSQL | Stores users, submissions, comments, workflow status, and other application data. |
| ClickHouse | Provides read-only access to cBioPortal genomics data used for analytics and dashboards. |


```text
                 +--------------------+
                 |     Keycloak       |
                 | Authentication     |
                 +---------+----------+
                           |
                           | JWT
                           v
+----------------+     +--------------------+
| React (Vite)   | --> | Express API        |
+----------------+     +---------+----------+
                                 |
                  +--------------+--------------+
                  |                             |
                  v                             v
          PostgreSQL                     ClickHouse
     (Users & Submissions)      (cBioPortal Analytics)
          Read / Write               Read Only
```

---

## Project structure


```text
backend/
├── src/
│   ├── db/            # PostgreSQL and ClickHouse clients
│   ├── middleware/    # Authentication and authorization
│   ├── routes/        # API endpoints
│   └── utils/         # Helper functions
└── scripts/           # LevelDB → PostgreSQL migration (one-time)

frontend/
└── src/
    ├── components/    # Shared UI components
    ├── pages/         # Application pages
    ├── services/      # API client and Keycloak setup
    └── hooks/         # React hooks
```

---

## Authentication

The application uses Keycloak with OpenID Connect (OIDC).

1. Users authenticate through Keycloak.
2. Keycloak returns a JWT access token.
3. The frontend includes the token with each API request.
4. The backend validates the token using Keycloak's JWKS endpoint.
5. Once validated, the request is processed using the authenticated user's identity and roles.

The application does **not** store or manage user passwords.

---


## Docker

Both services ship as container images, published to the DockerHub repo
`cbioportal/curation-dashboard` and distinguished by a tag suffix:

| Image | Tags | Port | Probe |
| --- | --- | --- | --- |
| Backend (Express API) | `:latest-backend`, `:<short-sha>-backend` | 5001 | `GET /api/health` |
| Frontend (nginx + SPA) | `:latest-frontend`, `:<short-sha>-frontend` | 8080 | `GET /healthz` |

`.github/workflows/docker_ci.yml` builds and pushes both on every push to `main`,
and on demand via **workflow_dispatch** with a `ref` input. Deployments should
reference the immutable `<short-sha>` tag — rollouts against a moving `latest` don't
reliably restart pods.

Images are multi-arch (`linux/amd64`, `linux/arm64`). **Keep `linux/arm64`**: the
`curation` EKS nodegroup these run on is Graviton (`t4g.medium`,
`BOTTLEROCKET_ARM_64`), so an amd64-only image would fail with `exec format error`.

### Building and running locally

```bash
# Backend
docker build -t dcd-backend ./backend
docker run --rm -p 5001:5001 \
  -e KEYCLOAK_ISSUER=http://localhost:8081/auth/realms/dashboard \
  -e FRONTEND_URL=http://localhost:8080 \
  -e PGHOST=host.docker.internal -e PGUSER=postgres -e PGPASSWORD=... -e PGDATABASE=dashboard \
  dcd-backend

# Frontend
docker build -t dcd-frontend ./frontend
docker run --rm -p 8080:8080 \
  -e VITE_API_URL=http://localhost:5001 \
  -e VITE_KEYCLOAK_URL=http://localhost:8081/auth \
  -e VITE_KEYCLOAK_REALM=dashboard \
  -e VITE_KEYCLOAK_CLIENT_ID=dashboard-frontend \
  dcd-frontend
```

### Frontend configuration is applied at runtime, not build time

Vite normally freezes `import.meta.env.VITE_*` values into the bundle, which would
make each image environment-specific. Instead, the app reads its configuration from
`window.__ENV__` via `src/config.ts`, and `docker-entrypoint.sh` rewrites
`/config.js` from the container environment on every start. One image is therefore
promotable across dev/staging/prod by changing a ConfigMap — no rebuild required.

Precedence is runtime (`window.__ENV__`) → build-time (`.env`) → local dev default,
so `npm run dev` keeps working unchanged.

Recognised variables: `VITE_API_URL`, `VITE_KEYCLOAK_URL`, `VITE_KEYCLOAK_REALM`,
`VITE_KEYCLOAK_CLIENT_ID`. To add one, extend both `src/config.ts` and
`docker-entrypoint.sh`.

### Backend deployment notes

- The image sets `NODE_ENV=production`, which makes **both** `KEYCLOAK_ISSUER` and
  `FRONTEND_URL` mandatory — the process exits non-zero at startup if either is
  missing. `FRONTEND_URL` is the CORS origin.
- `initializeDatabases()` applies `src/db/schema.sql` (idempotent) and throws if
  Postgres is unreachable, so a bad database config produces a crash-loop rather
  than a silently degraded pod. Give the pod a `startupProbe` with enough slack for
  Postgres to accept connections.
- `PGSSLROOTCERT` is resolved relative to the app root when it is a bare filename,
  so in-cluster set it to the **absolute** path of a mounted Secret, e.g.
  `PGSSLROOTCERT=/etc/ssl/pg/ca.pem`. Certificates are never baked into the image
  (`*.pem` is in `backend/.dockerignore`).
- ClickHouse is optional: without `CLICKHOUSE_HOST` the app still boots, and only
  the analytics endpoints fail.

### Node version

The frontend build requires **Node 18+** (Vite 4); the images use `node:20-alpine`.
Both packages declare `engines.node: >=18` to match.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local
setup and the checks to run before opening a pull request.

## License

Licensed under the GNU Affero General Public License v3.0 — see [LICENSE](LICENSE),
matching the license used across the cBioPortal project.
