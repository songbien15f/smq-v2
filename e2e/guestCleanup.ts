import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/**
 * Removes the quote requests the Guest suite sends, so a run leaves the dev database as it found it.
 *
 * ## Why
 *
 * The send test goes through the real API on purpose (it is the flow under test), so each run wrote a
 * `guest_requests` row and a `guest_contacts` row. Forty of them had piled up in the vendor's Guest
 * request list by 2026-11-25 and were deleted by hand. This deletes them at the end of the run instead.
 *
 * ## Only this run's rows
 *
 * The suite records every e-mail it types (`guestEmail`). Each one is unique to the run, so the delete
 * is keyed on exactly those addresses and additionally refuses anything that is not `@example.com`,
 * has been transferred to a company, or belongs to a Guest account. A contact is removed only once no
 * request and no assistant session points at it.
 *
 * ## Straight to Postgres, not through the API
 *
 * The API has no delete for a quote request, and adding one for a test would put a destructive route
 * in production. The suite already reads `.env` for the vendor password; it reads `DATABASE_URL` the
 * same way. `pg` is loaded from `@sq/db`'s own dependencies, because the workspace root does not
 * depend on it and a new root dependency would be one more thing to install for a cleanup step.
 *
 * Without `DATABASE_URL` (the suite pointed at a deployed site) nothing is deleted and a line says so.
 * `E2E_KEEP_GUEST_REQUESTS=1` keeps the rows, for a run whose requests someone wants to look at in the
 * vendor's list.
 */

const emails: string[] = [];

/** A run-unique `@example.com` address, remembered so `cleanUpGuestRequests` can find its rows. */
export function guestEmail(tag: string): string {
  const email = `test.guest+${tag}${Date.now()}@example.com`;
  emails.push(email.toLowerCase());
  return email;
}

function databaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync('.env', 'utf8'));
    const value = (match?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
    return value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

interface PgClient {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: { number?: string }[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/** Delete the requests (and then orphaned contacts) sent under this run's e-mails. */
export async function cleanUpGuestRequests(): Promise<void> {
  if (emails.length === 0) return;
  if (process.env.E2E_KEEP_GUEST_REQUESTS === '1') {
    console.log(`[guest e2e] kept the requests for ${emails.length} address(es) (E2E_KEEP_GUEST_REQUESTS=1)`);
    return;
  }
  const url = databaseUrl();
  if (url === undefined) {
    console.log('[guest e2e] no DATABASE_URL, so the requests this run sent were not deleted');
    return;
  }

  const requireFromDb = createRequire(resolve('packages/db/package.json'));
  const { Client } = requireFromDb('pg') as { Client: new (opts: { connectionString: string }) => PgClient };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const contacts = `SELECT id FROM guest_contacts WHERE email_norm = ANY($1::text[]) AND email_norm LIKE '%@example.com'`;
    const requests = await client.query(
      `DELETE FROM guest_requests
        WHERE contact_id IN (${contacts}) AND account_id IS NULL AND transferred_tenant_id IS NULL
        RETURNING number`,
      [emails],
    );
    await client.query(
      `DELETE FROM guest_contacts k
        WHERE k.id IN (${contacts})
          AND NOT EXISTS (SELECT 1 FROM guest_requests q WHERE q.contact_id = k.id)
          AND NOT EXISTS (SELECT 1 FROM guest_assistant_sessions s WHERE s.contact_id = k.id)`,
      [emails],
    );
    await client.query('COMMIT');
    const numbers = requests.rows.map((r) => r.number).join(', ');
    if (numbers !== '') console.log(`[guest e2e] deleted the requests this run sent: ${numbers}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
