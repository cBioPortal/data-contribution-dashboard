-- Application schema for the cBioPortal Data Contribution Dashboard
-- (Postgres). Run idempotently on startup by initializeDatabases().
--
-- NOTE: This is the app's *own* operational data. The read-only genomics
-- analytics live in ClickHouse and are untouched by this schema.

-- ─── Users: OAuth accounts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT        NOT NULL,
  name         TEXT        NOT NULL DEFAULT '',
  institution  TEXT        NOT NULL DEFAULT '',
  role         TEXT        NOT NULL DEFAULT 'user',  -- 'user' | 'super'
  provider     TEXT,                                 -- 'google' | 'github'
  provider_id  TEXT,                                 -- provider's user id
  keycloak_sub TEXT,                                 -- Keycloak subject (OIDC identity link)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email lookups are case-insensitive. Kept non-unique to exactly preserve
-- current LevelDB semantics (no uniqueness was enforced before); can be
-- tightened to a UNIQUE index later once data is known to be clean.
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_provider_idx    ON users (provider, provider_id);
-- One app user per Keycloak identity.
CREATE UNIQUE INDEX IF NOT EXISTS users_keycloak_sub_idx ON users (keycloak_sub) WHERE keycloak_sub IS NOT NULL;

-- ─── Submissions: rich documents (JSONB) + promoted columns ──────────────────
-- The full submission object is stored in `doc` to preserve the sparse,
-- evolving schema and arbitrary keys. A handful of columns are promoted out of
-- the document purely for indexed querying; they are derived from `doc` on write.
CREATE TABLE IF NOT EXISTS submissions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT,
  submission_type   TEXT,         -- 'suggest-paper' | 'submit-data'
  publication_type  TEXT,         -- 'published' | 'preprint'
  status            TEXT,
  submitted_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  doc               JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_user_id_idx ON submissions (user_id);
CREATE INDEX IF NOT EXISTS submissions_status_idx  ON submissions (status);
CREATE INDEX IF NOT EXISTS submissions_pubtype_idx ON submissions (publication_type);
