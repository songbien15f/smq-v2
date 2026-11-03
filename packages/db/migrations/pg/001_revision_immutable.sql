-- The immutability constraint on saved revisions, for Postgres.
--
-- Same intent as the SQLite trigger, in the dialect Postgres actually has. A rule
-- is used rather than a trigger function so it applies to `UPDATE` and `DELETE`
-- from any role, including a connection an operator is using by hand — which is
-- exactly the case a code-level guard misses.

CREATE OR REPLACE RULE quote_revisions_no_update AS
  ON UPDATE TO quote_revisions DO INSTEAD NOTHING;

CREATE OR REPLACE RULE quote_revisions_no_delete AS
  ON DELETE TO quote_revisions DO INSTEAD NOTHING;

-- `DO INSTEAD NOTHING` silently ignores the write, which is worse than failing: a
-- caller that believes it updated a revision would report success. A rule cannot
-- raise, so a trigger is added on top purely to make the refusal loud.
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
