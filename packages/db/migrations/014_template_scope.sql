-- 014 — the template catalogue's scope and presentation.
--
-- A template is either **global** (the vendor's catalogue, available to every company) or a
-- company's own. Without a `tenant_id` column there is no way to say which, and every catalogue
-- query has to guess. `NULL` means global, deliberately: it is the "no company owns this" state,
-- and it reads correctly in `WHERE tenant_id IS NULL OR tenant_id = ?` without a sentinel row.
--
-- `description` and `sort_order` are what makes a catalogue browsable rather than a list of codes:
-- a person choosing a template needs to know what it is, and the vendor needs to decide what comes
-- first. Both are vendor-authored, so both are nullable or defaulted.
--
-- **This file is portable.** The index lives in the dialect folders, because `CREATE INDEX IF NOT
-- EXISTS` is spelled differently on SQLite and Postgres.

ALTER TABLE quote_templates ADD COLUMN description TEXT;
ALTER TABLE quote_templates ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quote_templates ADD COLUMN tenant_id TEXT;
