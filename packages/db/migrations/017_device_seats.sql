-- 017 — a seat belongs to a device, not to a session.
--
-- ## Why this replaces `tenant_seats`
--
-- A seat used to be claimed by inserting a row keyed to a session (`002_seats.sql`). Three ways a
-- session could die without giving its seat back:
--
--   * idle timeout (24 h) or absolute expiry (168 h) — `resolveSession` simply returns null;
--   * Sign out on a session that had already expired;
--   * a member being removed from the company.
--
-- A company with three seats and three people who closed their browsers could not sign anybody in
-- the next morning. The seat was held by a session nobody was using, and nothing was going to come
-- back and release it.
--
-- A **device** is the thing a person actually owns: one browser profile, for one user in one company.
-- Signing in again on the same browser reuses that device's seat, so "my session expired" never
-- costs somebody their seat. A device that is revoked, or idle longer than `DEVICE_IDLE_DAYS`, gives
-- its seat back lazily at the next sign-in in that company — no cron, no sweeper.
--
-- Two users signing in on one browser are two devices and two seats. That is deliberate: the licence
-- is per seat, not per computer.

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  -- Hash of the `sq_device` cookie value. The cookie itself is never stored.
  token_hash    TEXT NOT NULL,
  -- Human-readable, e.g. "Chrome on Windows", so an admin can tell them apart.
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  revoked_at    TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One device per (company, user, cookie). Signing in twice on the same browser is one row.
CREATE UNIQUE INDEX IF NOT EXISTS devices_identity ON devices (tenant_id, user_id, token_hash);
-- The reclaim query filters on (tenant, live?, idle) — this index is what keeps it cheap.
CREATE INDEX IF NOT EXISTS devices_tenant_seen ON devices (tenant_id, revoked_at, last_seen_at);

CREATE TABLE IF NOT EXISTS device_seats (
  tenant_id   TEXT NOT NULL,
  slot        INTEGER NOT NULL,
  -- One seat per device. UNIQUE is what makes two simultaneous sign-ins on one device harmless.
  device_id   TEXT NOT NULL UNIQUE,
  claimed_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, slot),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- `SET NULL`, not `CASCADE`: revoking a device must revoke its sessions in the application (so an
-- audit row survives), not silently delete the session history.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;

-- Seats held by sessions are meaningless under the new rule. A company session with no device is
-- refused by `resolveSession`, so every company user signs in once after this migration — which is
-- the honest cost of the change and is stated in the release note.
DROP TABLE IF EXISTS tenant_seats;
