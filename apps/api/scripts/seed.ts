/**
 * Seed a development database: one platform administrator and one demo company.
 *
 * Run with `pnpm db:seed`. Idempotent — running it twice does not create a second
 * company, because a duplicate seed is how a developer ends up debugging two tenants
 * that look identical.
 *
 * The passwords come from the environment when set, so this never bakes a credential
 * into the repository. The defaults are printed, and they are development defaults on
 * purpose: a seed with a memorable password is safer than a seed with a secret nobody
 * can find, as long as it refuses to run in production.
 */

import { dbConfigFromEnv, newId, now, openDb } from '@sq/db';
import type { Db } from '@sq/db';
import { hashPassword } from '../src/lib/password.js';

const PLATFORM_EMAIL = process.env.SEED_PLATFORM_EMAIL ?? 'ops@smartquote.local';
const PLATFORM_PASSWORD = process.env.SEED_PLATFORM_PASSWORD ?? 'platform-password-change-me';
const COMPANY_SLUG = process.env.SEED_COMPANY_SLUG ?? 'demo-sheds';
const COMPANY_EMAIL = process.env.SEED_COMPANY_EMAIL ?? 'owner@demo-sheds.local';
const COMPANY_PASSWORD = process.env.SEED_COMPANY_PASSWORD ?? 'company-password-change-me';

/** Create the user if the email is new, and return its id either way. */
async function ensureUser(
  db: Db,
  input: {
    email: string;
    displayName: string;
    password: string;
    platformRole?: 'platform_admin' | null;
    mustChange?: boolean;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [input.email]);
  if (existing !== null) return { id: existing.id, created: false };

  const id = newId();
  const at = now();
  const hash = await hashPassword(input.password);

  await db.run(
    `INSERT INTO users (id, email, display_name, password_hash, must_change_password, password_set_at, platform_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.email,
      input.displayName,
      hash,
      input.mustChange === true ? 1 : 0,
      at,
      input.platformRole ?? null,
      at,
      at,
    ],
  );

  return { id, created: true };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('Refusing to seed a production database. This script creates known passwords.\n');
    process.exitCode = 1;
    return;
  }

  const db = openDb(dbConfigFromEnv());

  try {
    const platform = await ensureUser(db, {
      email: PLATFORM_EMAIL,
      displayName: 'Platform Admin',
      password: PLATFORM_PASSWORD,
      platformRole: 'platform_admin',
    });
    process.stdout.write(`platform admin ${PLATFORM_EMAIL}: ${platform.created ? 'created' : 'exists'}\n`);

    const existingTenant = await db.get<{ id: string }>('SELECT id FROM tenants WHERE slug = ?', [
      COMPANY_SLUG,
    ]);

    if (existingTenant !== null) {
      process.stdout.write(`company ${COMPANY_SLUG}: exists (${existingTenant.id})\n`);
    } else {
      const tenantId = newId();
      const at = now();

      const owner = await ensureUser(db, {
        email: COMPANY_EMAIL,
        displayName: 'Demo Owner',
        password: COMPANY_PASSWORD,
      });

      await db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO tenants (id, name, slug, status, seats, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
          [tenantId, 'Demo Sheds Pty Ltd', COMPANY_SLUG, 3, at, at],
        );
        await tx.run(
          `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at)
           VALUES (?, ?, 'company_admin', 'active', ?, ?)`,
          [tenantId, owner.id, at, at],
        );
        await tx.run(
          `INSERT INTO company_settings (id, tenant_id, version, settings_json, created_at, created_by)
           VALUES (?, ?, 1, ?, ?, ?)`,
          [
            newId(),
            tenantId,
            JSON.stringify({
              name: 'Demo Sheds Pty Ltd',
              abn: '00 000 000 000',
              // GST is not a setting. It is 10% by law and lives in the price chain.
              depositPct: 10,
              progressPct: 70,
            }),
            at,
            owner.id,
          ],
        );
      });

      process.stdout.write(`company ${COMPANY_SLUG}: created (${tenantId})\n`);
    }

    process.stdout.write(
      '\nSign in to the client app at http://localhost:3061\n' +
        `  company admin: ${COMPANY_EMAIL} / ${COMPANY_PASSWORD}\n\n` +
        'Platform administration at http://localhost:3062\n' +
        `  ${PLATFORM_EMAIL} / ${PLATFORM_PASSWORD}\n\n` +
        'Change these in .env (SEED_*) before any shared deployment.\n',
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
