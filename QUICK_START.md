## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker (to run Keycloak)
- A reachable PostgreSQL database (app data)
- A Keycloak 11 realm + client (login)
- ClickHouse credentials (analytics charts)

### Configure Environment Variables (one time)
1. Copy the example env files so you have real ones to edit:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
2. **Postgres** — in `backend/.env`, point at your database:
   ```
   PGHOST=localhost
   PGPORT=5432
   PGUSER=postgres
   PGPASSWORD=your-password
   PGDATABASE=postgres
   ```
   (For managed/cloud Postgres, set `PGSSLMODE=verify-full` and `PGSSLROOTCERT`. Leave both blank for local dev.) The tables are created automatically on first start.
3. **Keycloak** — login is handled by Keycloak, so there are no OAuth secrets or JWT secret to manage here. This project runs the legacy Keycloak **11.0.0** image, which serves everything under the `/auth` context path.
   - Start Keycloak (Docker):
     ```bash
     docker run -d --name kc11 --platform linux/amd64 -p 8081:8080 \
       -e KEYCLOAK_USER=admin -e KEYCLOAK_PASSWORD=admin \
       quay.io/keycloak/keycloak:11.0.0
     ```
     Admin console: http://localhost:8081/auth/admin (`admin` / `admin`).
     > On Apple Silicon the `11.0.0` image is amd64-only. Enable **Rosetta** in Docker Desktop (Settings → General → *Use Virtualization framework* + *Use Rosetta for x86_64/amd64 emulation*), or the container will be unusably slow.
   - Backend (`backend/.env`):
     ```
     KEYCLOAK_ISSUER=http://localhost:8081/auth/realms/dashboard
     KEYCLOAK_AUDIENCE=dashboard-frontend   # leave blank for local dev
     ```
   - Frontend (`frontend/.env`):
     ```
     VITE_KEYCLOAK_URL=http://localhost:8081/auth
     VITE_KEYCLOAK_REALM=dashboard
     VITE_KEYCLOAK_CLIENT_ID=dashboard-frontend
     ```
   - In the Keycloak admin console, create the `dashboard` realm and a public client `dashboard-frontend` (Standard flow + PKCE, challenge method `S256`). Google/GitHub sign-in is optional and wired up *inside* Keycloak as identity providers — not in this app.
4. **ClickHouse** — for the analytics charts, fill in the read-only credentials in `backend/.env`:
   ```
   CLICKHOUSE_HOST=
   CLICKHOUSE_USERNAME=
   CLICKHOUSE_PASSWORD=
   CLICKHOUSE_DATABASE=cgds_public_blue
   ```
5. **URLs** — confirm the rest matches your local setup and save:
   - `backend/.env`: `FRONTEND_URL=http://localhost:8080` (required in production)
   - `frontend/.env`: `VITE_API_URL=http://localhost:5001`

### Enable Google / GitHub sign-in via Keycloak

Google and GitHub login are configured *inside Keycloak* as identity providers — not in this app. It's a two-step setup.

**1. Register an OAuth app on Google / GitHub**
- **Google:** Google Cloud Console → create OAuth 2.0 credentials → you get a **Client ID** and **Client Secret**.
- **GitHub:** GitHub → Settings → Developer settings → OAuth Apps → register a new app → get a **Client ID** and **Client Secret**.
- On both, set the **Authorized redirect URI** to point back at Keycloak's broker endpoint (note the `/auth` context path used by Keycloak 11):
  ```
  http://localhost:8081/auth/realms/dashboard/broker/google/endpoint
  http://localhost:8081/auth/realms/dashboard/broker/github/endpoint
  ```
  (Note the alias — `google` / `github` — appears in the URL; it has to match the alias you set in the next step.)

**2. Add the identity provider in Keycloak**
- In the `dashboard` realm → **Identity Providers** → add **Google** and **GitHub** (Keycloak has built-in templates for both).
- Paste in the **Client ID + Client Secret** from step 1.
- In Keycloak 11 the social templates **pre-set the alias to `google` / `github` and lock it** (it isn't an editable field) — just confirm it reads `google` / `github`. This alias is the critical link to the app: `Login.tsx` calls `login('google')` / `login('github')`, which becomes `idpHint=google`. Keycloak matches that hint to the IdP whose alias is `google` and jumps straight to it, skipping Keycloak's own login screen. If the alias doesn't match, the hint silently does nothing.
- Note: Keycloak 11's Google provider has **no `Prompt` field** (added in a later version), so per-login Google account selection isn't configurable from the admin console here.

### Terminal 1: Start Backend
```bash
cd Github/portal-dashboard-44644/backend
npm install
npm run dev
```

### Terminal 2: Start Frontend
```bash
cd Github/portal-dashboard-44644/frontend
npm install
npm run dev
```

### Open Browser
- Frontend: http://localhost:8080
- Login page: http://localhost:8080/login
- Backend API: http://localhost:5001

### Migrating from the old LevelDB store (one time, optional)
If you have existing data in the legacy LevelDB store, copy it into Postgres:
```bash
cd backend
npm run migrate:pg
```
