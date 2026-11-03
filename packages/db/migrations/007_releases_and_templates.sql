-- 007 — releases, and the template catalogue's missing pieces.
--
-- ## Why a release record, when the licence server's "version channel" was about installers
--
-- The old server published a desktop **installer**: a source version, a database version, an update
-- file on disk, and a force-update flag that refused a sign-in until the machine was patched. A web
-- product has no installer — every user is on the deployed build the moment it ships. Reproducing that
-- machinery would be building a distribution system for a distribution that does not happen.
--
-- What survives is the question a support call actually asks: **"what is this deployment running, and
-- what changed?"** A release row answers it, and it is the one thing the old channel was really for.
--
-- ## Why the engine version and price-book hash are recorded with it
--
-- A quote states the engine version it was priced under, and a revision records the book hash. A
-- release that does not say which of either it shipped leaves a support engineer unable to connect
-- "this quote looks wrong" to "we changed the BOM last Tuesday".

CREATE TABLE IF NOT EXISTS releases (
  id              TEXT PRIMARY KEY,
  -- What a person calls it: "2026.11.1".
  label           TEXT NOT NULL UNIQUE,
  engine_version  INTEGER NOT NULL,
  -- The price book this release shipped with, when it shipped one.
  price_book_hash TEXT,
  note            TEXT NOT NULL DEFAULT '',
  -- True for the release this deployment is running. Exactly one row has it.
  current         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  created_by      TEXT
);

CREATE INDEX IF NOT EXISTS releases_created ON releases (created_at DESC);

-- ---------------------------------------------------------------------------
-- Template catalogue: the columns the screens need
-- ---------------------------------------------------------------------------

-- The structure a template clones. Separate from `basic_config_json` because that holds the
-- *display* basics (span, bay count) while this holds the whole `ShedConfig` — options, openings,
-- colours — which is what "clone this quote" actually copies.
ALTER TABLE quote_templates ADD COLUMN config_json TEXT;

-- Which company authored it, when it came from a real quote rather than being authored by hand.
ALTER TABLE quote_templates ADD COLUMN source_tenant_id TEXT;

-- Times the template has been cloned. A catalogue nobody uses is a catalogue to prune, and without
-- this there is no way to know.
ALTER TABLE quote_templates ADD COLUMN clone_count INTEGER NOT NULL DEFAULT 0;

-- The three types a shed company actually distinguishes. Seeded so a fresh install has a usable
-- catalogue rather than an empty dropdown.
INSERT INTO template_types (id, code, name, sort_order)
SELECT 'tt-gable', 'gable', 'Gable shed', 10
WHERE NOT EXISTS (SELECT 1 FROM template_types WHERE code = 'gable');

INSERT INTO template_types (id, code, name, sort_order)
SELECT 'tt-skillion', 'skillion', 'Skillion', 20
WHERE NOT EXISTS (SELECT 1 FROM template_types WHERE code = 'skillion');

INSERT INTO template_types (id, code, name, sort_order)
SELECT 'tt-carport', 'carport', 'Carport', 30
WHERE NOT EXISTS (SELECT 1 FROM template_types WHERE code = 'carport');
