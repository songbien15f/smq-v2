-- Which AI provider answers the Guest assistant, chosen by a platform admin.
--
-- ## No key, ever
--
-- Migration 008 dropped `platform_settings` because credentials must not live in a table. The same rule
-- binds this one: `GEMINI_API_KEY` and `VILAO_API_KEY` stay in `.env`, and the admin screen shows only
-- whether a key is present. Rotating a key means editing `.env` and restarting the API.
--
-- ## One row, no tenant
--
-- The AI provider is a platform decision, not a per-company one, so there is no `tenant_id` — the same
-- shape as the other vendor tables. `id` is always `'global'`. **No row means "use the env defaults"**,
-- so an existing install needs no seed and deleting the row is a supported way back.
--
-- ## Portable subset
--
-- TEXT ids and ISO-8601 TEXT timestamps, as everywhere else (DECISIONS A12): booleans 0/1, `?`
-- placeholders in the code, no dialect features. The migration runner checksums applied files, so this
-- is a new file rather than an edit.

CREATE TABLE IF NOT EXISTS ai_settings (
  id                TEXT PRIMARY KEY CHECK (id = 'global'),
  -- 'gemini' | 'vilao'
  primary_provider  TEXT NOT NULL,
  -- 'vilao' | 'gemini' | 'none'
  fallback_provider TEXT NOT NULL,
  gemini_model      TEXT NOT NULL,
  gemini_stt_model  TEXT NOT NULL,
  -- 'minimal' | 'low' | 'medium' | 'high'
  gemini_thinking   TEXT NOT NULL,
  vilao_model       TEXT NOT NULL,
  vilao_stt_model   TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  -- The platform user who saved it, for the audit trail's benefit ("audit_events" carries the entry).
  updated_by        TEXT NOT NULL
);
