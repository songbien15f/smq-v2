/**
 * The company, and there can be more than one.
 *
 * Two deployments share this code: a quoting install runs for one customer on one database, while
 * the licence-vendor control plane holds many. Both are the same model — a `tenants` row with its
 * staff — so there is no mode to switch on and no single-company invariant to enforce. What makes
 * cross-company data impossible is the schema, not a count: every business table carries
 * `tenant_id` and its composite foreign keys, so a query cannot return another company's rows
 * however many companies exist.
 *
 * `tenant_id` therefore stays, and the business key a person types to reach a company is
 * `tenants.code`.
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

/**
 * A company, or `null` before any has been set up.
 *
 * Returns the first row by `created_at`. With more than one company this answers "the oldest",
 * which is only meaningful for a caller that predates multi-company; new code reads the company
 * from the session instead of guessing.
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

/** What a caller must supply to create the company. No defaults: a placeholder company is
 *  a company nobody recognises six months later. */
export interface CreateCompanyInput {
  name: string;
  /** The business code printed on a quote and typed at sign-in. Unique, upper-cased. */
  code: string;
  slug: string;
  abn?: string | null;
  seats: number;
  subscriptionEndsAt?: string | null;
  adminEmail: string;
  adminDisplayName: string;
  /**
   * The name the first administrator signs in with.
   *
   * Optional, defaulting to the local part of their email — which is what the 009 migration
   * backfills for existing companies, so a created company and a migrated one look the same.
   * A named value wins when the operator supplies one, because "owner" is a better sign-in name
   * than the first word of somebody's mailbox.
   */
  adminUsername?: string;
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
 * There is no longer any notion of "the" company: a second create is an ordinary operation, and
 * the business code it is given is what a person types to reach it.
 */
export async function createCompany(db: Db, input: CreateCompanyInput): Promise<CreatedCompany> {
  const tenantId = newId();
  const userId = newId();
  const at = now();

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO tenants (id, name, slug, code, abn, status, seats, subscription_ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        tenantId,
        input.name,
        input.slug,
        input.code.trim().toUpperCase(),
        input.abn ?? null,
        input.seats,
        input.subscriptionEndsAt ?? null,
        at,
        at,
      ],
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

    // A membership without a username is an administrator nobody can sign in as, because the
    // username is the sign-in key. The default matches what migration 009 backfills, so a
    // created company and a migrated one are reachable the same way.
    const adminUsername =
      input.adminUsername?.trim().toLowerCase() ||
      input.adminEmail.split('@')[0]?.toLowerCase() ||
      'admin';

    await tx.run(
      `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username)
       VALUES (?, ?, 'company_admin', 'active', ?, ?, ?)`,
      [tenantId, userId, at, at, adminUsername],
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
