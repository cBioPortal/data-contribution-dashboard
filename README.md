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


