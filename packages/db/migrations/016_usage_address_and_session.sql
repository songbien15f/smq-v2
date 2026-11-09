-- 016 — a readable address, and a visitor session to measure time on screen.
--
-- ## Why an address column when `ip_hash` already exists
--
-- `ip_hash` was a deliberate choice, and it was the wrong one for this operator: eight characters
-- cannot answer "is that a real customer or my own test traffic", which is the question a dashboard
-- nobody trusts gets asked. `ip_enc` holds the address **AES-256-GCM encrypted** (`iv:tag:body`, hex),
-- so a database dump contains nobody's address in the clear and rotating `SESSION_SECRET` makes the
-- column unreadable — the data ages out instead of needing a deletion job.
--
-- Nextext to it:
--   `ip_hash`  a stable handle that survives a key rotation; the log groups by this.
--   `ip_enc`   the address itself, readable only with the key.
--   neither is ever used to authorise anything.
--
-- ## Why `session_id`
--
-- "How long did they stay" needs a boundary between visits, and the product's session cookie is the
-- honest one: a person who closes the laptop and comes back tomorrow has a new session and should not
-- be credited with fourteen hours. It holds the session's own id, which the API already has on every
-- request — no new cookie, no client change.
--
-- A row written without a request behind it (a queued send finishing later) has `NULL` and is simply
-- not part of any visit.

ALTER TABLE usage_events ADD COLUMN ip_enc TEXT;
ALTER TABLE usage_events ADD COLUMN session_id TEXT;

-- Grouping a visit reads every event of one session in order; the dashboard does that per render.
CREATE INDEX IF NOT EXISTS usage_events_session ON usage_events (session_id, at);
