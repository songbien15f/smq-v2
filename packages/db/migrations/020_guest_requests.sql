-- 020 — the Guest quote page's leads, contacts and building types.
--
-- Spec: docs/specs/quote-tiers-guest.md ("Data model"). Plan: docs/plans/quote-tiers-guest-ga.md (S2).
--
-- ## Why these tables have no tenant_id
--
-- A guest designs a shed on the public page without signing in, and the request goes to the
-- **platform**, not to a company (D-T5 / D-T6): a super admin reads it and, in slice G-c, transfers
-- it to one company (G1). Until then the lead belongs to nobody's tenant, so these three tables are
-- platform-level like `users` and `price_books`. `isolation.test.ts` inserts named rows rather than
-- enumerating tables, so it needs no exclusion for them.
--
-- ## Why the contact is split from the request
--
-- `guest_contacts` is the guest's profile, one row per normalised email, so a returning guest's
-- requests line up. What the guest typed on each request is kept verbatim in
-- `guest_requests.contact_json`: the profile is only overwritten while the email is unverified.
--
-- `assistant_session_id` (spec) is left out until slice G-g adds the assistant (plan P1).
-- The request number's sequence is Postgres-only and lives in pg/020_guest_requests.sql.

CREATE TABLE IF NOT EXISTS guest_contacts (
  id                 TEXT PRIMARY KEY,
  email_norm         TEXT NOT NULL UNIQUE,
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  mobile             TEXT NOT NULL,
  email_verified_at  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_requests (
  id                     TEXT PRIMARY KEY,
  number                 TEXT NOT NULL UNIQUE,
  contact_id             TEXT NOT NULL REFERENCES guest_contacts(id),
  contact_json           TEXT NOT NULL,
  design_json            TEXT NOT NULL,
  notes                  TEXT,
  -- Google place ID only: Places policy allows nothing else to be stored (plan G-a §3).
  place_id               TEXT,
  -- utm_* tags from the brand site's link (plan P16).
  source_json            TEXT,
  status                 TEXT NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new', 'transferred', 'declined', 'spam')),
  ip_hash                TEXT,
  transferred_tenant_id  TEXT REFERENCES tenants(id),
  transferred_at         TEXT,
  transferred_by         TEXT,
  decline_reason         TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS guest_requests_contact_idx ON guest_requests (contact_id);
CREATE INDEX IF NOT EXISTS guest_requests_status_idx ON guest_requests (status, created_at);

CREATE TABLE IF NOT EXISTS guest_building_types (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  base_preset  TEXT NOT NULL,
  config_json  TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 1,
  updated_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS guest_building_types_enabled_idx ON guest_building_types (enabled, sort_order);
