-- 009 (SQLite) — backfill the columns the portable file added.
--
-- `demo-sheds` becomes `DEMOSHEDS`: upper, hyphens dropped, first ten characters — the width the
-- old licence server's CompanyCode used.
UPDATE tenants
   SET code = upper(substr(replace(slug, '-', ''), 1, 10))
 WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_code ON tenants (code);

-- The local part of the email, lowercased.
UPDATE memberships
   SET username = lower(substr(
     (SELECT u.email FROM users u WHERE u.id = memberships.user_id),
     1,
     instr((SELECT u.email FROM users u WHERE u.id = memberships.user_id), '@') - 1
   ))
 WHERE username IS NULL;

-- Disambiguate inside each company: every row but the earliest of a duplicate group gets a
-- numeric suffix. Without this the unique index below would fail on a company that has two people
-- whose emails start the same way, and the migration would stop half applied.
UPDATE memberships
   SET username = username || CAST((
     SELECT COUNT(*) FROM memberships m2
      WHERE m2.tenant_id = memberships.tenant_id
        AND m2.username  = memberships.username
        AND m2.rowid    < memberships.rowid
   ) + 1 AS TEXT)
 WHERE (SELECT COUNT(*) FROM memberships m2
         WHERE m2.tenant_id = memberships.tenant_id
           AND m2.username  = memberships.username
           AND m2.rowid   <= memberships.rowid) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_username ON memberships (tenant_id, username);
