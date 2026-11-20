-- The Guest assistant's conversation: one session per design, and the lines in it.
--
-- Plan G-g S10. No prices and no contact details are stored here: the turn route strips anything
-- that looks like an email or an Australian mobile before a model sees it, and the transcript is
-- plain text the estimator can read next to the request.
--
-- 30-day expiry is enforced by the cleanup script (`pnpm assistant:prune`) and by `expires_at` in
-- every read; a row is never trusted just because it exists.

CREATE TABLE IF NOT EXISTS guest_assistant_sessions (
  id                 TEXT PRIMARY KEY,
  -- The anonymous visitor's cookie token, hashed. Never the token itself, for the same reason
  -- `guest_tokens` stores a hash: a database dump must not hand somebody a live session.
  token_hash         TEXT NOT NULL UNIQUE,
  -- The contact, once the guest has a verified profile. Null while the session belongs to nobody.
  contact_id         TEXT REFERENCES guest_contacts(id),
  created_at         TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  expires_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS guest_assistant_sessions_contact_idx ON guest_assistant_sessions (contact_id);
CREATE INDEX IF NOT EXISTS guest_assistant_sessions_expiry_idx ON guest_assistant_sessions (expires_at);

CREATE TABLE IF NOT EXISTS guest_assistant_turns (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES guest_assistant_sessions(id) ON DELETE CASCADE,
  -- 'guest' or 'assistant'
  role        TEXT NOT NULL CHECK (role IN ('guest', 'assistant')),
  -- Plain text, already redacted. 4000 because one turn may quote a paragraph; the model never sees
  -- more than the last few turns' worth.
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS guest_assistant_turns_session_idx ON guest_assistant_turns (session_id, created_at);

-- The lead carries its conversation, so whoever quotes it can read what the guest asked for.
ALTER TABLE guest_requests ADD COLUMN IF NOT EXISTS assistant_session_id TEXT;
