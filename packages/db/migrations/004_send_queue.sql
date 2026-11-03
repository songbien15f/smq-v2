-- 004 — what a durable send queue needs, added to the table that was designed before the queue.
--
-- `send_jobs` was written in 001 as a record of an attempt. A queue needs four more facts, and each
-- exists because of a specific way a send can go wrong:
--
--   * `idempotency_key` — a double-click is two requests and must be one email. Unique per company,
--     so the second insert is refused by the database rather than by a check that can race.
--   * `lease_until` — a worker claims a job before sending it. Without a lease, a crashed worker
--     leaves the job `sending` forever and nobody knows whether the customer got the mail.
--   * `acknowledged_indicative` — an indicative quote carries allowances. Sending one without the
--     operator having said so is how an allowance becomes a promise.
--   * `message_id` — the relay's own id for the message. It is the only handle for "did this
--     actually go out", and it is not recoverable later.

ALTER TABLE send_jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE send_jobs ADD COLUMN leased_until TEXT;
ALTER TABLE send_jobs ADD COLUMN message_id TEXT;
ALTER TABLE send_jobs ADD COLUMN acknowledged_indicative INTEGER NOT NULL DEFAULT 0;

-- One key, one job. A partial index rather than a unique constraint on the column, because the
-- column is nullable and older rows have none — SQLite and Postgres both index NULLs as distinct,
-- but an explicit `WHERE` states the intent.
CREATE UNIQUE INDEX IF NOT EXISTS send_jobs_idempotency
  ON send_jobs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The queue is drained oldest-first, and only ever from `queued`.
CREATE INDEX IF NOT EXISTS send_jobs_queue ON send_jobs (state, created_at);
