-- 006 — integration credentials, stored where an operator can set them.
--
-- ## Why these are not only environment variables
--
-- `GOOGLE_PLACES_API_KEY` and `SHEDSAFE_USERNAME`/`PASSWORD` were declared in `.env.example` and read
-- by nothing. When the integrations were built they read the environment — which means enabling them
-- required shell access to the server and a restart. An operator with a browser and no terminal could
-- not turn either on, and the panel honestly said "not configured" with no way to fix it.
--
-- ## Why one row per key rather than a typed table
--
-- These are a handful of scalars that change rarely and are read on every request. A key/value table
-- with a `secret` flag lets a new integration be added without a migration, and lets the API mask the
-- secret ones on read without a per-integration rule.
--
-- ## Why the values are not encrypted here
--
-- Encryption at rest is a property of the volume, not of this table: a key that can be read by the
-- process that uses it can be read by anyone who can read the process's files. What this table does
-- guarantee is that the value is **never returned to a browser** — the API masks a `secret` row and
-- says only whether it is set.

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  -- The value, as text. A secret is stored as given; nothing here is logged.
  value       TEXT NOT NULL,
  -- True when the value must never be returned by a read. Masked, not omitted: a UI needs to know
  -- whether something is set.
  secret      INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
