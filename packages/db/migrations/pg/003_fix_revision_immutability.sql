-- 003 — quote_revisions immutability, corrected for Postgres.
--
-- ## What 001 got wrong, found by running it
--
-- 001 protected the table with a `DO INSTEAD NOTHING` rule *and* a raising trigger, on the
-- assumption that the trigger would make the refusal loud on top of the rule. It does not: a
-- rule is applied while the query is rewritten, **before** any trigger, so:
--
--   1. `UPDATE` and `DELETE` answered `UPDATE 0` / `DELETE 0` — the row was protected, but
--      silently. A caller that believed it had changed a revision was told nothing.
--   2. Worse, the rule broke foreign-key enforcement in the other direction. `DELETE FROM
--      quotes` failed with *"referential integrity query on quotes from constraint
--      quote_revisions_quote_id_fkey gave unexpected result — most likely due to a rule having
--      rewritten the query"*. A rule that rewrites a statement to nothing also rewrites the
--      internal cascade check, so the parent table became undeletable.
--
-- The SQLite version never had this problem because SQLite has no rules; it uses a trigger,
-- which is exactly the right tool. This migration makes Postgres match: drop the rules, keep
-- the triggers, and let the trigger raise.
--
-- ## Why a trigger rather than a permission
--
-- `REVOKE UPDATE, DELETE` would depend on the application connecting as a role that does not
-- own the table — and it does own it, because it runs the migrations. A trigger applies to the
-- owner too, and to a person with a psql window open, which is the case a code-level guard
-- misses.

DROP RULE IF EXISTS quote_revisions_no_update ON quote_revisions;
DROP RULE IF EXISTS quote_revisions_no_delete ON quote_revisions;

CREATE OR REPLACE FUNCTION quote_revisions_refuse_write() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'quote_revisions is append-only: a saved revision is a record of what a customer was sent';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_revisions_refuse_update ON quote_revisions;
CREATE TRIGGER quote_revisions_refuse_update
  BEFORE UPDATE ON quote_revisions
  FOR EACH ROW EXECUTE FUNCTION quote_revisions_refuse_write();

DROP TRIGGER IF EXISTS quote_revisions_refuse_delete ON quote_revisions;
CREATE TRIGGER quote_revisions_refuse_delete
  BEFORE DELETE ON quote_revisions
  FOR EACH ROW EXECUTE FUNCTION quote_revisions_refuse_write();
