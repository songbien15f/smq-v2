-- 014 — template scope. Postgres half: the index.
CREATE INDEX IF NOT EXISTS quote_templates_tenant ON quote_templates (tenant_id, status);
