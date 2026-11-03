/**
 * The company — singular, on purpose.
 *
 * This product is deployed **for one company on one database**. It is a conversion of the
 * old desktop app plus its licence server, and the licence server's multi-company control
 * plane existed to sell seats to many dealers; the conversion runs for one of them.
 *
 * Two consequences, and both are enforced here rather than assumed:
 *
 * 1. **Creating a second company is refused.** Not hidden in a UI — refused by the function
 *    that creates companies, so a route, a script or a future screen cannot do it by
 *    accident.
 * 2. **`tenant_id` stays in the schema.** It is one row, and it is the reason a query can
 *    never return another company's rows: the column and the composite foreign keys make
 *    cross-company data impossible rather than merely unintended. Dropping it would save
 *    six files and cost the ability to reproduce a reported bug locally in a minute.
 */

import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';

/** The one company, as the application needs it. */
export interface Company {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  seats: number;
  subscriptionEndsAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
}

/** Raised when something tries to create a company on a single-company installation. */
export class SingleCompanyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SingleCompanyError';
  }
}

/**
 * The installation's company, or `null` before it has been set up.
 *
 * Returns the first row by `created_at` rather than asserting a count, so a database with
 * two rows still opens and the operator can see what happened instead of meeting a startup
 * crash. `assertCompanyIsSingular` is the check that reports the anomaly.
 */
export async function loadCompany(db: Db): Promise<Company | null> {
  const row = await db.get<{
    id: string;
    name: string;
    slug: string;
    status: string;
    seats: number;
    subscription_ends_at: string | null;
    suspended_reason: string | null;
    created_at: string;
  }>(
    `SELECT id, name, slug, status, seats, subscription_ends_at, suspended_reason, created_at
       FROM tenants ORDER BY created_at ASC LIMIT 1`,
  );

  if (row === null) return null;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    seats: row.seats,
    subscriptionEndsAt: row.subscription_ends_at,
    suspendedReason: row.suspended_reason,
    createdAt: row.created_at,
  };
}

/** How many companies exist. */
export async function countCompanies(db: Db): Promise<number> {
  const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tenants');
  return Number(row?.n ?? 0);
}

/**
 * Refuse when more than one company exists.
 *
 * Called at boot. A second company is not a feature that was turned on; it is a state the
 * application cannot reason about — which company would a quote belong to? — so it is
 * reported loudly rather than half-supported.
 */
export async function assertCompanyIsSingular(db: Db): Promise<number> {
  const count = await countCompanies(db);
  if (count > 1) {
    throw new Error(
      `This installation is configured for one company (SINGLE_COMPANY=1) but the database holds ${count} tenants. ` +
        'Either remove the extra rows or set SINGLE_COMPANY=0, having understood that quotes, seats and settings ' +
        'would then be shared across companies.',
    );
  }
  return count;
}

/** What a caller must supply to create the company. No defaults: a placeholder company is
 *  a company nobody recognises six months later. */
export interface CreateCompanyInput {
  name: string;
  slug: string;
  abn?: string | null;
  seats: number;
  subscriptionEndsAt?: string | null;
  adminEmail: string;
  adminDisplayName: string;
  /**
   * The administrator's password.
   *
   * Passed in rather than generated, because the caller differs: `install.ts` reads it from
   * the environment or prompts, and it is the only place a password reaches this function.
   */
  adminPasswordHash: string;
  /** When true, the administrator is forced to replace the password at first sign-in. */
  mustChangePassword: boolean;
}

/** A created company. */
export interface CreatedCompany {
  tenantId: string;
  adminUserId: string;
}

/**
 * Create the installation's company, with its first administrator.
 *
 * One transaction, because a company with no administrator is a company nobody can enter
 * and an administrator with no company is a person who cannot sign in. A half-applied
 * create is worse than a refused one.
 *
 * `singleCompany` is a parameter rather than a module constant so the refusal is testable
 * without an environment variable, and so the one call site that legitimately permits more
 * than one — nothing today — would have to say so out loud.
 */
export async function createCompany(
  db: Db,
  input: CreateCompanyInput,
  singleCompany: boolean,
): Promise<CreatedCompany> {
  if (singleCompany) {
    const existing = await countCompanies(db);
    if (existing > 0) {
      throw new SingleCompanyError(
        'This installation already has its company. It runs for one company on one database, so a second is refused; ' +
          'edit the existing company instead.',
      );
    }
  }

  const tenantId = newId();
  const userId = newId();
  const at = now();

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO tenants (id, name, slug, abn, status, seats, subscription_ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [tenantId, input.name, input.slug, input.abn ?? null, input.seats, input.subscriptionEndsAt ?? null, at, at],
    );

    await tx.run(
      `INSERT INTO users (id, email, display_name, password_hash, must_change_password, password_set_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        input.adminEmail,
        input.adminDisplayName,
        input.adminPasswordHash,
        input.mustChangePassword ? 1 : 0,
        at,
        at,
        at,
      ],
    );

    await tx.run(
      `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, 'company_admin', 'active', ?, ?)`,
      [tenantId, userId, at, at],
    );

    // A settings row from the start, so a quote never has to handle "no settings". The GST
    // rate is deliberately absent: it is 10% by law and lives in the price chain, not in a
    // setting somebody can mistype.
    await tx.run(
      `INSERT INTO company_settings (id, tenant_id, version, settings_json, created_at, created_by)
       VALUES (?, ?, 1, ?, ?, ?)`,
      [newId(), tenantId, JSON.stringify({ name: input.name, depositPct: 10, progressPct: 70 }), at, userId],
    );

    await tx.run(
      `INSERT INTO audit_events (id, at, actor_id, actor_email, action, target_type, target_id, summary)
       VALUES (?, ?, NULL, ?, 'company.install', 'tenant', ?, ?)`,
      [newId(), at, input.adminEmail, tenantId, `Installed ${input.name} with ${input.seats} seat(s)`],
    );
  });

  return { tenantId, adminUserId: userId };
}
