-- 013 — the punching detail is frozen with the revision. SQLite half.
--
-- The trigger from 010 lists every frozen column by name, so a new column is not protected until
-- the trigger names it. Re-created here with `punchings_json` added; `name` and `description` stay
-- the only two a person may change.

DROP TRIGGER IF EXISTS quote_revisions_no_update;

CREATE TRIGGER quote_revisions_no_update
BEFORE UPDATE ON quote_revisions
WHEN NEW.id IS NOT OLD.id
  OR NEW.quote_id IS NOT OLD.quote_id
  OR NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.revision IS NOT OLD.revision
  OR NEW.config_json IS NOT OLD.config_json
  OR NEW.bom_json IS NOT OLD.bom_json
  OR NEW.members_json IS NOT OLD.members_json
  OR NEW.punchings_json IS NOT OLD.punchings_json
  OR NEW.price_json IS NOT OLD.price_json
  OR NEW.issues_json IS NOT OLD.issues_json
  OR NEW.customer_json IS NOT OLD.customer_json
  OR NEW.company_json IS NOT OLD.company_json
  OR NEW.provenance_json IS NOT OLD.provenance_json
  OR NEW.config_hash IS NOT OLD.config_hash
  OR NEW.result_hash IS NOT OLD.result_hash
  OR NEW.bom_hash IS NOT OLD.bom_hash
  OR NEW.price_book_hash IS NOT OLD.price_book_hash
  OR NEW.override_version IS NOT OLD.override_version
  OR NEW.settings_version IS NOT OLD.settings_version
  OR NEW.engine_version IS NOT OLD.engine_version
  OR NEW.contract_cents IS NOT OLD.contract_cents
  OR NEW.total_cost_cents IS NOT OLD.total_cost_cents
  OR NEW.total_mass_kg IS NOT OLD.total_mass_kg
  OR NEW.mocked_lines IS NOT OLD.mocked_lines
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_by_email IS NOT OLD.created_by_email
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'quote_revisions is append-only: only the name and description may change');
END;
