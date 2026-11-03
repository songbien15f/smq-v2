-- 009 (Postgres) — backfill the columns the portable file added.
--
-- The `ALTER`s are deliberately absent: the portable file ran first and added both columns, so
-- repeating them here would fail with "column already exists". This file carries only what
-- Postgres needs and SQLite cannot express — `split_part` instead of `instr`, and a window
-- function instead of the correlated `rowid` count.

UPDATE tenants SET code = upper(substr(replace(slug, '-', ''), 1, 10)) WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_code ON tenants (code);

-- The local part of the email, lowercased.
UPDATE memberships m
   SET username = lower(split_part(u.email, '@', 1))
  FROM users u
 WHERE u.id = m.user_id
   AND m.username IS NULL;

-- Disambiguate inside each company: every row but the earliest of a duplicate group gets a
-- numeric suffix, so the unique index below can be created.
UPDATE memberships m
   SET username = m.username || d.rn::text
  FROM (
    SELECT tenant_id, user_id,
           row_number() OVER (
             PARTITION BY tenant_id,
                          lower(split_part((SELECT email FROM users WHERE id = user_id), '@', 1))
             ORDER BY created_at, user_id
           ) AS rn
      FROM memberships
  ) d
 WHERE d.tenant_id = m.tenant_id
   AND d.user_id   = m.user_id
   AND d.rn       > 1;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_username ON memberships (tenant_id, username);
