-- 003 — the portable half of the immutability correction.
--
-- Nothing to do here: SQLite already uses triggers, which is the mechanism the Postgres version
-- is being corrected to. The file exists so `003` has a portable counterpart and the numbering
-- stays aligned — the runner applies dialect extras after the portable file with the same
-- prefix, so a dialect file with no portable sibling would be applied at the end of the run
-- under a version number nothing else shares.
--
-- Leaving it empty rather than absent is also what makes `schema_migrations` a complete record:
-- "003 ran on this database" is true on both drivers, and the dialect row next to it says what
-- that meant.

SELECT 1;
