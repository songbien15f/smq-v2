-- 005 — ShedSafe site checks.
--
-- A site check is the wind rating a quote is priced against: the six certified fields (importance
-- level, wind region, terrain category, building class, ground snow load, design wind speed) come
-- from ShedSafe, not from a person typing them.
--
-- ## Why a table rather than six columns on the quote
--
-- The check belongs to the **site**, and a dealer quotes several buildings on one block often enough
-- that the same certificate applies to each. It also has a life of its own — pinned, calculated,
-- imported, or stale — and a quote's frozen revision records the values it was priced with, not the
-- live certificate. Keeping them apart is what lets a re-import update the site without rewriting a
-- revision.
--
-- ## Why `building_id` is nullable
--
-- A check exists before ShedSafe returns an id: the operator pins the site, and the id arrives with
-- the answer. A NOT NULL column would force a placeholder, and a placeholder id looks like a real one.

CREATE TABLE IF NOT EXISTS site_checks (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  -- The ShedSafe building id, once ShedSafe has one. Null while a pin is in flight or failed.
  building_id       TEXT,
  -- The reference this build sends to ShedSafe, so a retry is the same building rather than a
  -- second one. Generated once per site check.
  reference         TEXT NOT NULL,
  -- The link ShedSafe hands back for the operator to finish the check in their own account.
  site_link         TEXT,
  -- The six certified fields. Nullable because a check that has been pinned but not calculated has
  -- none of them yet, and a zero would be a value nobody certified.
  importance_level  INTEGER,
  wind_region       TEXT,
  terrain_category  REAL,
  building_class    TEXT,
  snow_load         REAL,
  -- Design wind speed, m/s. ShedSafe calls it `vSite1`; the name here says what it is.
  design_wind_speed REAL,
  -- Pinned → calculated → imported, or failed. Free text with no CHECK: a state a future version
  -- adds must not be refused by a constraint written today.
  status            TEXT NOT NULL DEFAULT 'pinned',
  -- Why the last attempt failed, when it did. A check that cannot say why is one an operator
  -- re-runs blindly.
  last_error        TEXT,
  pinned_at         TEXT NOT NULL,
  imported_at       TEXT,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- One live check per reference: a retry updates rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS site_checks_reference ON site_checks (tenant_id, reference);
CREATE INDEX IF NOT EXISTS site_checks_tenant ON site_checks (tenant_id, updated_at);

-- Which check a quote is priced against.
--
-- On the quote rather than on the revision: a revision records the six values it was priced with
-- (frozen, in `config_json`), while this is the **live** certificate the next revision will use. A
-- re-import updates the site without touching a revision, which is what freezing is for.
--
-- Nullable: every quote that existed before this feature has none, and a quote whose wind fields
-- were typed by hand is a valid quote.
ALTER TABLE quotes ADD COLUMN site_check_id TEXT REFERENCES site_checks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotes_site_check ON quotes (site_check_id);
