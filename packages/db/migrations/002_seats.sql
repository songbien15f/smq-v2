-- 002 — seat allocation.
--
-- The old licence server decided whether a company had a free seat by counting its
-- enabled keys and then inserting a new one. Three things were missing, and together
-- they let a company exceed the seats it had paid for:
--
--   * no transaction, so two simultaneous sign-ins both saw the same count;
--   * no lock, for the same reason;
--   * no unique index, so even a correct transaction had nothing to conflict with.
--
-- Counting cannot fix this, because a count is a read and a read cannot fail. A
-- **slot** can: one row per seat, primary key `(tenant_id, slot)`. Inserting a slot
-- that is taken is a constraint violation, and a constraint violation is the only
-- thing that actually refuses a second writer.

CREATE TABLE IF NOT EXISTS tenant_seats (
  tenant_id   TEXT NOT NULL,
  -- Zero-based seat index. Seat 0 to `tenants.seats - 1` exist; anything higher is
  -- refused by the allocator before it inserts.
  slot        INTEGER NOT NULL,
  session_id  TEXT NOT NULL UNIQUE,
  claimed_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, slot),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tenant_seats_session ON tenant_seats (session_id);
