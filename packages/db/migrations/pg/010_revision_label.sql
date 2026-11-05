-- 010 — a revision's label may change; its content may not. Postgres half.
--
-- `IS DISTINCT FROM` rather than `<>` because a NULL would make `<>` yield NULL, and a NULL
-- condition in `IF` is false — which would let a nullable column change silently.
--
-- DELETE keeps its unconditional refusal. `TG_OP` is checked first because `NEW` is null in a
-- DELETE trigger, and touching `NEW.x` there would raise a different error than the message the
-- operator needs to read.

CREATE OR REPLACE FUNCTION quote_revisions_refuse_write() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quote_revisions is append-only: deleting a revision destroys the evidence of what was sent';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.config_json IS DISTINCT FROM OLD.config_json
     OR NEW.bom_json IS DISTINCT FROM OLD.bom_json
     OR NEW.price_json IS DISTINCT FROM OLD.price_json
     OR NEW.issues_json IS DISTINCT FROM OLD.issues_json
     OR NEW.customer_json IS DISTINCT FROM OLD.customer_json
     OR NEW.company_json IS DISTINCT FROM OLD.company_json
     OR NEW.provenance_json IS DISTINCT FROM OLD.provenance_json
     OR NEW.config_hash IS DISTINCT FROM OLD.config_hash
     OR NEW.result_hash IS DISTINCT FROM OLD.result_hash
     OR NEW.bom_hash IS DISTINCT FROM OLD.bom_hash
     OR NEW.price_book_hash IS DISTINCT FROM OLD.price_book_hash
     OR NEW.override_version IS DISTINCT FROM OLD.override_version
     OR NEW.settings_version IS DISTINCT FROM OLD.settings_version
     OR NEW.engine_version IS DISTINCT FROM OLD.engine_version
     OR NEW.contract_cents IS DISTINCT FROM OLD.contract_cents
     OR NEW.total_cost_cents IS DISTINCT FROM OLD.total_cost_cents
     OR NEW.total_mass_kg IS DISTINCT FROM OLD.total_mass_kg
     OR NEW.mocked_lines IS DISTINCT FROM OLD.mocked_lines
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_by_email IS DISTINCT FROM OLD.created_by_email
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'quote_revisions is append-only: only the name and description may change';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
