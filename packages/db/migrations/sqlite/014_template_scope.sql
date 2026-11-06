-- 014 — template scope. SQLite half: the index.
CREATE INDEX IF NOT EXISTS quote_templates_tenant ON quote_templates (tenant_id, status);
