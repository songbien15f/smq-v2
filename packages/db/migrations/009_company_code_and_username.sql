-- 009 — the portable half: two columns.
--
-- Only the `ALTER`s live here. The backfills and the unique indexes are dialect-specific
-- (`instr()` is SQLite, `split_part()` and window functions are Postgres), and the runner applies
-- the portable file **before** the dialect extras — so anything driver-specific written here
-- would fail on the other driver before its own file was reached. That is exactly the trap that
-- made `instr()` break the Postgres run on the first attempt.
--
-- `migrations/sqlite/009_…sql` and `migrations/pg/009_…sql` carry the rest.
--
-- Both columns are nullable. `NOT NULL` cannot be added to a populated table without a default,
-- and the create-company route supplies a code explicitly, so a new row always has one.

ALTER TABLE tenants ADD COLUMN code TEXT;
ALTER TABLE memberships ADD COLUMN username TEXT;
