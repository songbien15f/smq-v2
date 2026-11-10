/**
 * Import the real companies and salesmen from the old licence database.
 *
 * ## Why this exists
 *
 * The dev database grew up around a demo tenant — `DEMOSHEDS` / `owner@demo-sheds.local` — created by
 * `seed.ts`. That account is fine for a smoke test and useless for anything else: ShedSafe refuses it
 * as a salesman, so a site check pinned as the demo owner fails with *"The salesman provided is not a
 * valid salesman username."* and the whole Step 1 flow cannot be exercised end-to-end.
 *
 * Meanwhile the **real** data is already in this database, in the `legacy` schema, imported from the
 * old SQL Server: 7 companies, 6 salesmen, 47 buildings. This script turns that into v2 tenants and
 * users, so the product is driven by real records instead of fixtures.
 *
 * ## What it maps
 *
 * ```
 * legacy.dbo_account    → tenants            (CompanyCode → code, CompanyName → name)
 * legacy.dbo_salesman   → users + memberships (Email → user, FranchiseId → which tenant)
 * legacy.dbo_role       → role               (1 Admin → company_admin, 2 Manager → estimator)
 * ```
 *
 * A salesman's `FranchiseId` is what groups them into a company. Two salesmen share the head-office
 * franchise, one has `Branch_01`, and that grouping is the only company structure the old data states
 * — so it is what is used. Inventing a hierarchy would be a guess.
 *
 * ## What it deliberately does **not** do
 *
 * - **It does not touch quotes.** 47 legacy buildings exist, but mapping `HousePlan` → `ShedConfig` is
 *   a separate piece of work (see the note in the wiki), and importing half a building would produce
 *   quotes that look real and are not.
 * - **It does not delete the demo tenant.** Removing data is the operator's decision; `--purge-demo`
 *   does it only when asked, and says what it removed.
 * - **It does not invent passwords per person.** One password from the environment, applied to every
 *   imported user with `must_change_password` set, so a shared default cannot outlive the first
 *   sign-in. Nobody's real password is in the old database in a form this could reuse: `dbo_account`
 *   carries a Base64 pair, which is an encoding, not a hash.
 *
 * ## Idempotent
 *
 * Run it twice and nothing is duplicated: tenants are matched by `code`, users by `email`.
 */

import { dbConfigFromEnv, newId, now, openDb } from '@sq/db';
import type { Db } from '@sq/db';
import { hashPassword } from '../src/lib/password.js';

/** The tenants a legacy account becomes. */
interface LegacyAccount {
  id: number;
  companyName: string;
  companyCode: string | null;
  /** The person who owns this licence account — matched against a salesman's email. */
  email: string | null;
  roleId: number | null;
  active: boolean | null;
}

/** A salesman, and the franchise that decides their company. */
interface LegacySalesman {
  email: string;
  firstName: string | null;
  lastName: string | null;
  formattedName: string | null;
  franchiseId: string | null;
  franchiseName: string | null;
  isActive: boolean | null;
}

const PASSWORD = process.env.IMPORT_PASSWORD ?? '';

/**
 * `/building/create` in the old licence database was driven by a franchise, not a company leaf.
 *
 * The two names that matter are `Head Office` and `Branch_01`; neither matches a `CompanyName`, so the
 * matching below tries the code first and then falls back to the franchise name itself. The point is
 * the **tenant code** — that is what a person types at sign-in — and the legacy `CompanyCode` is the
 * only column that states one.
 */
const franchiseTenant = new Map<string, { id: string; code: string; name: string }>();

/** `ABC Test` → `ABC-TEST`; a code the sign-in screen can carry. */
function slugOf(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The company code typed at sign-in: the legacy `CompanyCode` when it has one.
 *
 * The old codes are short and uppercase (`VGS`, `SSA`, `ABC`) and they are what people already know,
 * so they are reused rather than regenerated. A fallback derives one from the name for an account
 * that has none, because the column is nullable and a tenant without a code cannot be signed into.
 */
function codeOf(account: LegacyAccount): string {
  const stated = (account.companyCode ?? '').trim().toUpperCase();
  if (stated !== '') return stated;
  return (account.companyName ?? `TENANT${account.id}`)
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 10);
}

/** The role a legacy `RoleId` maps to. Admin keeps admin; everything else is an estimator. */
function roleOf(roleId: number | null): 'company_admin' | 'estimator' {
  return roleId === 1 ? 'company_admin' : 'estimator';
}

/** The display name a person recognises, falling back through the columns the old table has. */
function nameOf(salesman: LegacySalesman): string {
  const formatted = (salesman.formattedName ?? '').trim();
  if (formatted !== '') return formatted;
  const joined = [salesman.firstName, salesman.lastName].map((part) => (part ?? '').trim()).filter((part) => part !== '');
  if (joined.length > 0) return joined.join(' ');
  return salesman.email;
}

/** The username a person types beside the company code. The local part of their email. */
function usernameOf(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.replace(/[^a-z0-9._-]/gi, '').slice(0, 40) || 'user';
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write(
      'Refusing to run against production. This imports identities and sets one shared password.\n',
    );
    process.exitCode = 1;
    return;
  }

  if (PASSWORD === '') {
    process.stderr.write(
      'Set IMPORT_PASSWORD to the password every imported user starts with.\n' +
        'It is applied with must_change_password, so it cannot outlive the first sign-in.\n',
    );
    process.exitCode = 1;
    return;
  }

  const db = openDb(dbConfigFromEnv());

  try {
    /*
     * The `legacy` schema exists only on Postgres.
     *
     * It is the bacpac clone of the old SQL Server licence database. SQLite has no schemas, and a dev
     * machine on SQLite would answer "no such table: legacy.dbo_account" for the query below — a
     * confusing message for what is really "this import needs the Postgres clone". Saying so is the
     * point of this check.
     */
    const hasLegacy = await db
      .get<{ present: number }>(
        "SELECT COUNT(*) AS present FROM information_schema.schemata WHERE schema_name = 'legacy'",
      )
      .catch(() => null);
    if (hasLegacy === null || Number(hasLegacy.present) === 0) {
      process.stderr.write(
        'This database has no `legacy` schema. The import reads the old licence database, which is\n' +
          'loaded into Postgres from `database/SmartQuote.bacpac`. Run it against the Postgres dev\n' +
          'database (DATABASE_URL), not SQLite.\n',
      );
      process.exitCode = 1;
      return;
    }

    /*
     * ## Why every alias is quoted
     *
     * PostgreSQL **folds unquoted identifiers to lower case**, so `"FranchiseId" AS franchiseId` comes
     * back as a column named `franchiseid` and `row.franchiseId` is `undefined`. The first run of this
     * script did exactly that: every salesman's franchise read as `undefined`, all six collapsed into
     * one tenant, and `Branch_01` silently became part of head office. Quoting the alias keeps the
     * case the TypeScript interfaces expect.
     */
    const accounts = await db.all<LegacyAccount>(
      `SELECT "Id" AS "id", "CompanyName" AS "companyName", "CompanyCode" AS "companyCode", "Email" AS "email",
              "RoleId" AS "roleId", "Active" AS "active"
         FROM legacy.dbo_account ORDER BY "Id"`,
    );
    const salesmen = await db.all<LegacySalesman>(
      `SELECT "Email" AS "email", "FirstName" AS "firstName", "LastName" AS "lastName",
              "FormattedName" AS "formattedName", "FranchiseId" AS "franchiseId",
              "FranchiseName" AS "franchiseName", "IsActive" AS "isActive"
         FROM legacy.dbo_salesman WHERE "IsDeleted" = false ORDER BY "Email"`,
    );

    if (accounts.length === 0) {
      process.stderr.write('No rows in legacy.dbo_account — is the bacpac clone loaded under `legacy`?\n');
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`${accounts.length} legacy companies, ${salesmen.length} legacy salesmen\n\n`);

    /*
     * A **franchise** is the company a salesman works in, and that is the only company structure the
     * old data states: `dbo_salesman.FranchiseId` groups six people into two branches. `dbo_account`
     * is a licence account, not a workspace — seven rows, three of them the same test company — so
     * turning each account into a tenant would produce companies nobody signs into.
     *
     * ## Choosing the tenant code
     *
     * The code is what a person types at sign-in, so it should be something they recognise:
     *
     * 1. The legacy `CompanyCode` of an account **whose name matches the franchise** — the real case
     *    for `Head Office`, which is not an account name.
     * 2. Otherwise a code derived from the franchise name (`Head Office` → `HEADOFFICE`).
     *
     * The first branch will usually not fire, and that is stated rather than hidden: the franchise
     * names and the licence account names are different vocabularies, and inventing a match would
     * attach real people to the wrong licence. The account a tenant belongs to is a licensing
     * question, not a quoting one, and copying it here would be a guess.
     */
    const headOffice = (() => {
      const counts = new Map<string, number>();
      for (const salesman of salesmen) {
        const key = salesman.franchiseId ?? '';
        if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    })();

    const tenantByFranchise = new Map<string, { id: string; code: string; name: string }>();
    const at = now();

    for (const salesman of salesmen) {
      const franchiseId = salesman.franchiseId ?? headOffice ?? 'unknown';
      if (tenantByFranchise.has(franchiseId)) continue;

      const franchiseName = (salesman.franchiseName ?? '').trim() || 'Head Office';

      /*
       * The account whose **name** matches the franchise, if any. Matched on the slug so `Head
       * Office`, `head office` and `Head-Office` are one thing.
       */
      const matched = accounts.find((account) => slugOf(account.companyName) === slugOf(franchiseName));
      const code = matched !== undefined ? codeOf(matched) : codeOf({ id: 0, companyName: franchiseName, companyCode: '', roleId: null, active: true });
      const name = matched?.companyName ?? franchiseName;

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
        [tenantId, name, slugOf(name), code, at, at],
      );
      tenantByFranchise.set(franchiseId, { id: tenantId, code, name });
      process.stdout.write(`company ${code.padEnd(12)} created — ${name}\n`);
    }

    process.stdout.write('\n');

    for (const salesman of salesmen) {
      const franchiseId = salesman.franchiseId ?? headOffice ?? 'unknown';
      const tenant = tenantByFranchise.get(franchiseId);
      if (tenant === undefined) {
        process.stderr.write(`  ${salesman.email}: no company, skipped\n`);
        continue;
      }

      const existingUser = await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [
        salesman.email,
      ]);
      const userId =
        existingUser?.id ??
        (() => newId())();
      if (existingUser === null) {
        await db.run(
          `INSERT INTO users (id, email, display_name, password_hash, must_change_password, password_set_at, platform_role, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, NULL, ?, ?)`,
          [userId, salesman.email, nameOf(salesman), await hashPassword(PASSWORD), at, at, at],
        );
      }

      const membership = await db.get<{ id: string }>(
        'SELECT user_id AS id FROM memberships WHERE tenant_id = ? AND user_id = ?',
        [tenant.id, userId],
      );
      if (membership === null) {
        /*
         * The role comes from the licence account **that names this person**, matched on email first.
         *
         * `dbo_account.RoleId` is the licence's own admin/manager flag (`1` Admin, `2` Manager), and
         * the account row carries an `Email` for the person who owns it. Matching that first is what
         * makes `hoangduy7617@gmail.com` — the owner of the `ABC` account — a `company_admin`, rather
         * than an estimator in a company they administer.
         *
         * Falling back to the account whose *name* matches the tenant is the weaker rule and is used
         * only when no account names the person: it keeps a salesman in a tenant that has an admin,
         * instead of leaving every imported user at the same level.
         */
        const ownAccount = accounts.find(
          (entry) => (entry.email ?? '').toLowerCase() === salesman.email.toLowerCase(),
        );
        const tenantAccount = accounts.find((entry) => slugOf(entry.companyName) === slugOf(tenant.name));
        await db.run(
          `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username)
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
          [
            tenant.id,
            userId,
            roleOf((ownAccount ?? tenantAccount)?.roleId ?? null),
            at,
            at,
            usernameOf(salesman.email),
          ],
        );
      }

      process.stdout.write(
        `salesman ${salesman.email.padEnd(28)} → ${tenant.code.padEnd(12)} ${existingUser === null ? 'created' : 'exists'}\n`,
      );
    }

    /*
     * The demo tenant, only when asked.
     *
     * ## Why this refuses rather than forcing
     *
     * `quote_revisions` is **append-only by trigger**
     * (`pg/003_fix_revision_immutability.sql`): a saved revision is a record of what a customer was
     * sent, and deleting the quote it hangs from deletes that record. The first run of this branch
     * died on that trigger, which is the guard doing its job — the honest response is to stop and say
     * what is in the way, not to disable the guard.
     *
     * So: a demo company with **no quotes** is removed. One with quotes is reported, with the count,
     * and left alone. Removing sent quotes is a decision for a person, made deliberately, not a side
     * effect of importing accounts.
     */
    if (process.argv.includes('--purge-demo')) {
      const demo = await db.get<{ id: string; code: string | null; name: string }>(
        "SELECT id, code, name FROM tenants WHERE code = 'DEMOSHEDS'",
      );
      if (demo === null) {
        process.stdout.write('\ndemo company: none\n');
      } else {
        const quotes = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM quotes WHERE tenant_id = ?', [
          demo.id,
        ]);
        const count = Number(quotes?.c ?? 0);

        if (count > 0) {
          process.stdout.write(
            `\ndemo company ${demo.code ?? '?'} (${demo.name}) has ${count} quotes and was NOT removed.\n` +
              'Its revisions are append-only — a saved revision is a record of what a customer was sent —\n' +
              'and the database refuses to delete them. Delete those quotes deliberately if you want it gone.\n',
          );
        } else {
          process.stdout.write(`\nremoving empty demo company ${demo.code ?? '?'} (${demo.name})\n`);
          await db.transaction(async (tx) => {
            await tx.run('DELETE FROM memberships WHERE tenant_id = ?', [demo.id]);
            await tx.run('DELETE FROM company_settings WHERE tenant_id = ?', [demo.id]);
            await tx.run('DELETE FROM tenant_seats WHERE tenant_id = ?', [demo.id]);
            await tx.run('DELETE FROM sessions WHERE tenant_id = ?', [demo.id]);
            await tx.run('DELETE FROM tenants WHERE id = ?', [demo.id]);
          });
          process.stdout.write('demo company removed\n');
        }
      }

      /*
       * A demo **user** is removed only when it has no company left and is not platform staff.
       *
       * `ops@smartquote.local` is deliberately kept even though it belongs to no tenant: it is the
       * platform administrator, the only account that can reach the admin app, and deleting it would
       * lock the operator out of their own tool. `owner@demo-sheds.local` goes only when the demo
       * company above actually went — which, with quotes present, it did not.
       */
      const orphans = await db.all<{ email: string }>(
        `SELECT u.email FROM users u
          WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
            AND u.platform_role IS NULL`,
      );
      for (const orphan of orphans) {
        await db.run('DELETE FROM users WHERE email = ?', [orphan.email]);
        process.stdout.write(`removed user ${orphan.email} (no company left)\n`);
      }
    }

    process.stdout.write('\nDone.\n');
  } finally {
    await db.close();
  }
}

await main();
