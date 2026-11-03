-- The immutability constraint on saved revisions, for SQLite.
--
-- A revision is a record of what a customer was sent. It is the one table in this
-- schema that must never change, and "the repository has no UPDATE statement" is a
-- convention, not a constraint — a future contributor adding a fix-up query would
-- not read the module comment first.
--
-- SQLite has no `REVOKE` and no rules, so a trigger is the available mechanism.

CREATE TRIGGER IF NOT EXISTS quote_revisions_no_update
BEFORE UPDATE ON quote_revisions
BEGIN
  SELECT RAISE(ABORT, 'quote_revisions is append-only: a saved revision is a record of what a customer was sent');
END;

CREATE TRIGGER IF NOT EXISTS quote_revisions_no_delete
BEFORE DELETE ON quote_revisions
BEGIN
  SELECT RAISE(ABORT, 'quote_revisions is append-only: deleting a revision destroys the evidence of what was sent');
END;
