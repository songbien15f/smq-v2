/**
 * Reconcile the product's users with the salesmen ShedSafe actually has.
 *
 * ## Why the old licence database is the wrong source
 *
 * `seed.ts` created a demo tenant, and `import-legacy-accounts.ts` imported `legacy.dbo_salesman`.
 * Both were reasonable, and both are the wrong authority: ShedSafe decides who may pin a site check,
 * and its list is live. Compared on 2026-11-10:
 *
 * ```
 * ShedSafe: 9 salesmen           legacy.dbo_salesman: 6 rows
 *   missing from the snapshot:  hoangduy7617+3@, +5@, +7@, thienduro@, thingo79+1@yahoo.com
 *   deleted at ShedSafe but
 *   still in the snapshot:      hoangduy7617+1@, nguyen.an@
 * ```
 *
 * That is why a user imported from the snapshot failed to pin: `POST /building/create` answers
 * *"The salesman provided is not a valid salesman username."* for an email it does not hold.
 *
 * So this script reads `GET /building/getsalesmanusers` and treats it as the truth.
 *
 * ## What it does, and what it refuses to do
 *
 * - Creates a **user** for every ShedSafe salesman that has none, grouped into a tenant by franchise.
 * - Creates a **membership** in that franchise's tenant.
 * - Marks a membership **`suspended`** when its user is no longer a ShedSafe salesman — never deletes
 *   it, because quotes and revisions reference the user and a person who once quoted is part of the
 *   record.
 * - Never changes an existing role: an administrator who was made `company_admin` stays one.
 *
 * ## Idempotent
 *
 * Users are matched by email, tenants by code, memberships by (tenant, user).
 */

import { dbConfigFromEnv, newId, now, openDb } from '@sq/db';
import type { Db } from '@sq/db';
import { hashPassword } from '../src/lib/password.js';
import { createShedSafeTransport, shedSafeConfigFromEnv } from '../src/lib/shedsafe.js';

const PASSWORD = process.env.IMPORT_PASSWORD ?? '';

/** `Head Office` → `HEADOFFICE`; `Branch_01` → `BRANCH01`. */
function codeOf(franchiseName: string): string {
  return franchiseName
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 16) || 'HEadOFFICE'.toUpperCase();
}

/** The local part of an email, which is what a person types beside the company code. */
function usernameOf(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.replace(/[^a-z0-9._-]/gi, '').slice(0, 40) || 'user';
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('Refusing to run against production. This creates identities.\n');
    process.exitCode = 1;
    return;
  }
  if (PASSWORD === '') {
    process.stderr.write(
      'Set IMPORT_PASSWORD to the password every newly created user starts with.\n' +
        'It is applied with must_change_password, so it cannot outlive the first sign-in.\n',
    );
    process.exitCode = 1;
    return;
  }

  const config = shedSafeConfigFromEnv();
  if (config === null) {
    process.stderr.write(
      'No ShedSafe credentials. Set SHEDSAFE_USERNAME and SHEDSAFE_PASSWORD — this script reads the\n' +
        'live salesman list, which is the only authority on who may pin.\n',
    );
    process.exitCode = 1;
    return;
  }

  const db = openDb(dbConfigFromEnv());
  try {
    const transport = createShedSafeTransport(config);
    const live = await transport.salesmen();
    if (live.length === 0) {
      process.stderr.write('ShedSafe returned no salesmen. Nothing to do.\n');
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`ShedSafe has ${live.length} salesmen\n\n`);

    const at = now();
    const passwordHash = await hashPassword(PASSWORD);

    /*
     * One tenant per **franchise**, which is what ShedSafe groups salesmen by. The franchise name is
     * the closest thing the upstream data has to a company name, so it is what a tenant is called.
     */
    const tenantByFranchise = new Map<string, { id: string; code: string; name: string }>();

    for (const salesman of live) {
      const franchiseId = salesman.franchiseId ?? 'unassigned';
      if (tenantByFranchise.has(franchiseId)) continue;

      const name = salesman.franchiseName ?? 'Unassigned';
      const code = codeOf(name);

      const existing = await db.get<{ id: string; code: string | null }>(
        'SELECT id, code FROM tenants WHERE code = ?',
        [code],
      );
      if (existing !== null) {
        tenantByFranchise.set(franchiseId, { id: existing.id, code: existing.code ?? code, name });
        process.stdout.write(`company ${code.padEnd(12)} exists — ${name}\n`);
        continue;
      }

      const tenantId = newId();
      await db.run(
        `INSERT INTO tenants (id, name, slug, code, status, seats, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 5, ?, ?)`,
        [tenantId, name, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), code, at, at],
      );
      tenantByFranchise.set(franchiseId, { id: tenantId, code, name });
      process.stdout.write(`company ${code.padEnd(12)} created — ${name}\n`);
    }

    process.stdout.write('\n');

    const liveEmails = new Set(live.map((s) => s.email.toLowerCase()));

    for (const salesman of live) {
      const franchiseId = salesman.franchiseId ?? 'unassigned';
      const tenant = tenantByFranchise.get(franchiseId);
      if (tenant === undefined) continue;

      const existingUser = await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [
        salesman.email,
      ]);
      const userId = existingUser?.id ?? newId();
      if (existingUser === null) {
        await db.run(
          `INSERT INTO users (id, email, display_name, password_hash, must_change_password, password_set_at, platform_role, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, NULL, ?, ?)`,
          [userId, salesman.email, salesman.formattedName ?? salesman.email, passwordHash, at, at, at],
        );
      }

      const membership = await db.get<{ role: string; status: string }>(
        'SELECT role, status FROM memberships WHERE tenant_id = ? AND user_id = ?',
        [tenant.id, userId],
      );
      if (membership === null) {
        /*
         * The first salesman of a franchise becomes its administrator, the rest are estimators.
         *
         * Something has to own the company's settings, and ShedSafe has no notion of a role — it only
         * knows who is a salesman. Counting memberships is the cheapest rule that produces a tenant
         * with an administrator, and it is stated rather than hidden so an operator can change it.
         */
        const already = await db.get<{ c: number }>(
          "SELECT COUNT(*) AS c FROM memberships WHERE tenant_id = ? AND role = 'company_admin'",
          [tenant.id],
        );
        const role = Number(already?.c ?? 0) === 0 ? 'company_admin' : 'estimator';
        await db.run(
          `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username)
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
          [tenant.id, userId, role, at, at, usernameOf(salesman.email)],
        );
        process.stdout.write(
          `salesman ${salesman.email.padEnd(28)} → ${tenant.code.padEnd(12)} ${role} (created)\n`,
        );
      } else {
        process.stdout.write(
          `salesman ${salesman.email.padEnd(28)} → ${tenant.code.padEnd(12)} ${membership.role} (exists)\n`,
        );
      }
    }

    /*
     * A membership whose email is no longer a ShedSafe salesman is **suspended**, not deleted.
     *
     * Deleting it would orphan every quote the person made — and "this person can no longer pin" is a
     * narrower fact than "this person never existed". Suspending keeps the history and stops the pin,
     * and the panel already explains why a suspended login cannot pin.
     *
     * ## A salesman who moved franchise
     *
     * Handled first, because a moved person is still a salesman and would otherwise keep an `active`
     * membership in the **old** company forever — two companies, one person, and a quote could be
     * created in either. Measured 2026-11-10: `+2` and `+6` were in `Head Office` in the old database
     * and are in `Company AAA` / `Branch_01` on ShedSafe, so both had two memberships after the first
     * run of this script.
     *
     * The rule: for each ShedSafe salesman, any **active** membership in a tenant that is not their
     * current franchise is suspended. History is kept, and the person can only quote where they work
     * today.
     */
    const emailToFranchise = new Map(live.map((s) => [s.email.toLowerCase(), s.franchiseId ?? 'unassigned']));
    const codeByFranchise = new Map([...tenantByFranchise].map(([fid, tenant]) => [fid, tenant.code]));

    const active = await db.all<{ email: string; role: string; tenant_code: string }>(
      `SELECT u.email, m.role, t.code AS tenant_code
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN tenants t ON t.id = m.tenant_id
        WHERE m.status = 'active'`,
    );

    const moved = active.filter((row) => {
      const franchise = emailToFranchise.get(row.email.toLowerCase());
      if (franchise === undefined) return false;
      const expected = codeByFranchise.get(franchise);
      return expected !== undefined && expected !== row.tenant_code;
    });

    if (moved.length > 0) {
      process.stdout.write('\nsalesman moved to another franchise — suspending the old membership:\n');
      for (const row of moved) {
        await db.run(
          "UPDATE memberships SET status = 'suspended', updated_at = now() WHERE tenant_id = (SELECT id FROM tenants WHERE code = ?) AND user_id = (SELECT id FROM users WHERE email = ?)",
          [row.tenant_code, row.email],
        );
        process.stdout.write(
          `  ${row.email.padEnd(28)} left ${row.tenant_code} (was ${row.role})\n`,
        );
      }
    }

    const toSuspend = active.filter(
      (row) => !liveEmails.has(row.email.toLowerCase()) && !moved.includes(row),
    );
    if (toSuspend.length === 0) {
      process.stdout.write('\nno membership needs suspending for deletion\n');
    } else {
      process.stdout.write('\nno longer a ShedSafe salesman — suspending the membership:\n');
      for (const row of toSuspend) {
        await db.run(
          "UPDATE memberships SET status = 'suspended', updated_at = now() WHERE tenant_id = (SELECT id FROM tenants WHERE code = ?) AND user_id = (SELECT id FROM users WHERE email = ?)",
          [row.tenant_code, row.email],
        );
        process.stdout.write(`  ${row.email.padEnd(28)} in ${row.tenant_code} (was ${row.role})\n`);
      }
    }

    process.stdout.write('\nDone.\n');
  } finally {
    await db.close();
  }
}

await main();
