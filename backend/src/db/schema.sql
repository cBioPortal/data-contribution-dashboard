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
  submitted_at      DATE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  doc               JSONB       NOT NULL
);

-- Submission time-of-day is not part of the record. Preserve the calendar day
-- users previously saw in the tracker (America/New_York), then keep the JSON
-- document and promoted column in the same date-only format.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'submissions'
       AND column_name = 'submitted_at'
       AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE submissions
      ALTER COLUMN submitted_at TYPE DATE
      USING (submitted_at AT TIME ZONE 'America/New_York')::date;
  END IF;
END $$;

UPDATE submissions
   SET doc = jsonb_set(doc, '{submittedAt}', to_jsonb(submitted_at::text), true)
 WHERE submitted_at IS NOT NULL
   AND doc->>'submittedAt' IS DISTINCT FROM submitted_at::text;

UPDATE submissions
   SET status = 'in-review',
       doc = jsonb_set(
         jsonb_set(doc, '{status}', '"in-review"'::jsonb, true),
         '{displayStatus}', '"Preparing for Release"'::jsonb, true
       ),
       updated_at = now()
 WHERE doc->>'displayStatus' = 'Import in Progress';

UPDATE submissions
   SET status = 'approved',
       doc = jsonb_set(
         jsonb_set(doc, '{status}', '"approved"'::jsonb, true),
         '{displayStatus}', '"Released"'::jsonb, true
       ),
       updated_at = now()
 WHERE doc->>'displayStatus' = 'In Portal'
    OR status = 'in-portal'
    OR doc->>'status' = 'in-portal';

UPDATE submissions
   SET doc = jsonb_set(doc, '{displayStatus}', '"Approved for Curation"'::jsonb, true),
       updated_at = now()
 WHERE doc->>'displayStatus' IN ('Approved for Portal', 'Approved for Portal Curation');

-- One label per stage. Sub-labels (Clarification Needed, Missing Data, …) are
-- retired: each submission is rewritten to its stage's main label, and the
-- status code is realigned to the one the tracker's dropdown sends for it.
-- A submission with no displayStatus is labelled from its code, preserving the
-- stage it was already shown at ('received' was drawn at Submitted).
-- updated_at is left alone: this is a relabel, not a change to the submission.
-- Unrecognised labels are left untouched rather than guessed at.
WITH mapped AS (
  SELECT id,
         CASE
           WHEN doc->>'displayStatus' IN ('Submitted', 'Initial Review', 'Approved for Curation',
                                          'Curation in Progress', 'Final Review',
                                          'Preparing for Release', 'Released', 'Rejected')
             THEN doc->>'displayStatus'
           WHEN doc->>'displayStatus' IN ('Awaiting Review', 'Submission', 'Received') THEN 'Submitted'
           WHEN doc->>'displayStatus' = 'Pending Review' THEN 'Initial Review'
           WHEN doc->>'displayStatus' IN ('Clarification Needed', 'Changes Requested',
                                          'Awaiting Submitter''s Response',
                                          'Awaiting Submitters Response', 'In Progress')
             THEN 'Curation in Progress'
           WHEN doc->>'displayStatus' IN ('Under Review', 'In Review') THEN 'Final Review'
           WHEN doc->>'displayStatus' IN ('Missing Data', 'Not Curatable') THEN 'Rejected'
           WHEN NULLIF(doc->>'displayStatus', '') IS NULL THEN
             CASE status
               WHEN 'received'      THEN 'Submitted'
               WHEN 'in-progress'   THEN 'Curation in Progress'
               WHEN 'in-review'     THEN 'Final Review'
               WHEN 'approved'      THEN 'Released'
               WHEN 'missing-data'  THEN 'Rejected'
               WHEN 'not-curatable' THEN 'Rejected'
               WHEN 'rejected'      THEN 'Rejected'
             END
         END AS label
    FROM submissions
), coded AS (
  SELECT id, label,
         CASE label
           WHEN 'Submitted'             THEN 'pending'
           WHEN 'Initial Review'        THEN 'received'
           WHEN 'Approved for Curation' THEN 'received'
           WHEN 'Curation in Progress'  THEN 'in-progress'
           WHEN 'Final Review'          THEN 'in-review'
           WHEN 'Preparing for Release' THEN 'in-review'
           WHEN 'Released'              THEN 'approved'
           WHEN 'Rejected'              THEN 'not-curatable'
         END AS code
    FROM mapped
   WHERE label IS NOT NULL
)
UPDATE submissions s
   SET status = c.code,
       doc = jsonb_set(
         jsonb_set(s.doc, '{status}', to_jsonb(c.code), true),
         '{displayStatus}', to_jsonb(c.label), true
       )
  FROM coded c
 WHERE s.id = c.id
   AND (s.doc->>'displayStatus' IS DISTINCT FROM c.label
        OR s.status IS DISTINCT FROM c.code
        OR s.doc->>'status' IS DISTINCT FROM c.code);

CREATE INDEX IF NOT EXISTS submissions_user_id_idx ON submissions (user_id);
CREATE INDEX IF NOT EXISTS submissions_status_idx  ON submissions (status);
CREATE INDEX IF NOT EXISTS submissions_pubtype_idx ON submissions (publication_type);

-- A submission's owner must exist. RESTRICT (not CASCADE) so deleting a user
-- who still has submissions fails loudly rather than destroying curation work;
-- the API surfaces this as a 409. NULL user_id is still permitted.
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the DO block.
DO $$ BEGIN
  ALTER TABLE submissions
    ADD CONSTRAINT submissions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Curation record: the README ─────────────────────────────────────────────
-- One document per submission, edited in place by the curation team: what the
-- study is, where the data came from, what was excluded, how it was transformed.
--
-- Deliberately not inside submissions.doc. Writing it there would rewrite the
-- entire submission document on every edit — losing a concurrent status change —
-- and the markdown would then travel in every list response, though no grid
-- column shows it.
--
-- `sections` is JSONB rather than a column per section because the section list
-- is editorial and will change; adding one should not need a migration.
CREATE TABLE IF NOT EXISTS curation_readme (
  submission_id TEXT PRIMARY KEY REFERENCES submissions (id) ON DELETE CASCADE,
  sections      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT        REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS curation_deliverables (
  submission_id         TEXT PRIMARY KEY REFERENCES submissions (id) ON DELETE CASCADE,
  workspace_url         TEXT        NOT NULL DEFAULT '',
  validation_report_url TEXT        NOT NULL DEFAULT '',
  version                TEXT        NOT NULL DEFAULT '',
  summary                TEXT        NOT NULL DEFAULT '',
  data_types             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  checklist              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by             TEXT        REFERENCES users (id) ON DELETE SET NULL
);

-- ─── Curation record: the activity log ───────────────────────────────────────
-- Append-only, and anchored to the pipeline stage the submission was in when the
-- note was written, so each stage carries its own rationale rather than the
-- whole history pooling in one undifferentiated list.
--
-- These were arrays inside submissions.doc, which made every note a
-- read-modify-write of the entire document: two people writing at once and one
-- note vanishes. It also left no way to address, paginate or retract a single
-- note.
--
-- `visibility` carries a CHECK because it is a disclosure boundary and its two
-- values are stable — a typo here would publish an internal note. `kind` and
-- `stage` deliberately have none: both are editorial vocabularies that will grow,
-- and an unrecognised value should render in a fallback group rather than fail
-- the insert.
CREATE TABLE IF NOT EXISTS curation_notes (
  id            TEXT PRIMARY KEY,
  submission_id TEXT        NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  stage         TEXT,                                    -- pipeline stage, as displayed
  kind          TEXT        NOT NULL DEFAULT 'note',     -- note | transformation | decision | rejection | submitter
  visibility    TEXT        NOT NULL DEFAULT 'public'
                            CHECK (visibility IN ('public', 'internal')),
  body          TEXT        NOT NULL,
  author_id     TEXT        REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at     TIMESTAMPTZ,
  -- Soft: a log that can be silently rewritten is not a log.
  deleted_at    TIMESTAMPTZ
);

-- Every read is "the notes on this submission, oldest first".
CREATE INDEX IF NOT EXISTS curation_notes_submission_idx
  ON curation_notes (submission_id, created_at);

-- Notes are filed under the stage the submission was in; bring any filed under
-- a retired sub-label onto its main stage too.
UPDATE curation_notes
   SET stage = CASE
         WHEN stage IN ('Awaiting Review', 'Submission', 'Received') THEN 'Submitted'
         WHEN stage = 'Pending Review' THEN 'Initial Review'
         WHEN stage IN ('Approved for Portal', 'Approved for Portal Curation') THEN 'Approved for Curation'
         WHEN stage IN ('Clarification Needed', 'Changes Requested', 'Awaiting Submitter''s Response',
                        'Awaiting Submitters Response', 'In Progress') THEN 'Curation in Progress'
         WHEN stage IN ('Under Review', 'In Review') THEN 'Final Review'
         WHEN stage = 'Import in Progress' THEN 'Preparing for Release'
         WHEN stage = 'In Portal' THEN 'Released'
         WHEN stage IN ('Missing Data', 'Not Curatable') THEN 'Rejected'
       END
 WHERE stage IN ('Awaiting Review', 'Submission', 'Received', 'Pending Review',
                 'Approved for Portal', 'Approved for Portal Curation',
                 'Clarification Needed', 'Changes Requested', 'Awaiting Submitter''s Response',
                 'Awaiting Submitters Response', 'In Progress', 'Under Review', 'In Review',
                 'Import in Progress', 'In Portal', 'Missing Data', 'Not Curatable');

-- ─── Questions: threads on a submission ──────────────────────────────────────
-- Two conversations share this table, told apart by `visibility`: a submitter
-- asking the curation team about their own submission, and anyone asking about a
-- released study long afterwards. They are the same shape — a question and the
-- replies to it — and keeping them in one place is what stops a submitter having
-- to learn which of two inboxes their answer arrived in.
--
-- There is no title column. Asking for a subject line as well as a question is
-- friction that suppresses questions, so the first message *is* the question and
-- the interface shortens it for the list. Nothing is stored twice.
--
-- `visibility` carries a CHECK because it decides disclosure and its two values
-- are stable. Threads are never hard-deleted; a retracted question leaves a row.
CREATE TABLE IF NOT EXISTS question_threads (
  id            TEXT PRIMARY KEY,
  submission_id TEXT        NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  visibility    TEXT        NOT NULL DEFAULT 'public'
                            CHECK (visibility IN ('public', 'private')),
  asked_by      TEXT        REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS question_threads_submission_idx
  ON question_threads (submission_id, created_at);

-- Messages in a thread, oldest first: the question itself is the first row.
--
-- `from_curator` records the author's role at the time of writing rather than
-- joining to it later. Roles change, and "was this answered by the curation
-- team?" is a question about the past — a curator who later loses the role did
-- not retroactively stop answering.
CREATE TABLE IF NOT EXISTS question_messages (
  id           TEXT        PRIMARY KEY,
  thread_id    TEXT        NOT NULL REFERENCES question_threads (id) ON DELETE CASCADE,
  body         TEXT        NOT NULL,
  author_id    TEXT        REFERENCES users (id) ON DELETE SET NULL,
  from_curator BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at    TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS question_messages_thread_idx
  ON question_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS study_upvotes (
  submission_id TEXT        NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  user_id       TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, user_id)
);

CREATE INDEX IF NOT EXISTS study_upvotes_submission_idx
  ON study_upvotes (submission_id);

-- Community members may express interest in helping curate an unassigned
-- submission. These are private applications, not assignments. Withdrawal is
-- soft so the team retains an audit record.
CREATE TABLE IF NOT EXISTS curation_volunteers (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT        NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  user_id        TEXT        REFERENCES users (id) ON DELETE SET NULL,
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  designation    TEXT        NOT NULL,
  current_work   TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'completed', 'declined', 'withdrawn')),
  consented_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  review_requested_at TIMESTAMPTZ,
  review_feedback TEXT,
  review_feedback_at TIMESTAMPTZ,
  review_feedback_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  withdrawn_at   TIMESTAMPTZ,
  UNIQUE (submission_id, user_id)
);

CREATE INDEX IF NOT EXISTS curation_volunteers_submission_idx
  ON curation_volunteers (submission_id, status, created_at);

-- Expressions of interest are applications, not assignments. Multiple people
-- may be interested in one study; the per-user constraint above prevents the
-- same person from applying twice.
DROP INDEX IF EXISTS curation_volunteers_one_active_idx;

ALTER TABLE curation_volunteers
  DROP CONSTRAINT IF EXISTS curation_volunteers_status_check;
UPDATE curation_volunteers SET status = 'pending' WHERE status = 'active';
ALTER TABLE curation_volunteers
  ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE curation_volunteers
  ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ;
ALTER TABLE curation_volunteers
  ADD COLUMN IF NOT EXISTS review_feedback TEXT;
ALTER TABLE curation_volunteers
  ADD COLUMN IF NOT EXISTS review_feedback_at TIMESTAMPTZ;
ALTER TABLE curation_volunteers
  ADD COLUMN IF NOT EXISTS review_feedback_by TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE curation_volunteers
  ADD CONSTRAINT curation_volunteers_status_check
  CHECK (status IN ('pending', 'accepted', 'completed', 'declined', 'withdrawn'));

DROP INDEX IF EXISTS curation_volunteers_one_accepted_idx;
CREATE UNIQUE INDEX IF NOT EXISTS curation_volunteers_one_assigned_idx
  ON curation_volunteers (submission_id)
  WHERE status IN ('accepted', 'completed');

CREATE TABLE IF NOT EXISTS user_notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  submission_id TEXT        REFERENCES submissions (id) ON DELETE CASCADE,
  type          TEXT        NOT NULL CHECK (type IN (
                                'curation_application_accepted',
                                'curation_application_declined',
                                'curation_changes_requested',
                                'curation_completed'
                              )),
  title         TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_idx
  ON user_notifications (user_id, created_at DESC);

ALTER TABLE user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE user_notifications
  ADD CONSTRAINT user_notifications_type_check
  CHECK (type IN (
    'curation_application_accepted',
    'curation_application_declined',
    'curation_changes_requested',
    'curation_completed'
  ));
