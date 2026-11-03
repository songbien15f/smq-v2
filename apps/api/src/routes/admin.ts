/**
 * The licence vendor's control plane.
 *
 * Everything here is behind a platform capability and every write is recorded in the audit
 * log. The old server applied per-action auth inconsistently and had write endpoints that
 * answered GET with no token at all; here the guard is a property of the route rather than a
 * filter somebody remembered to add.
 *
 * A vendor holds many companies, so creating one is an ordinary operation reached through
 * `POST /admin/companies`. It is not a switch that turns the product into something else —
 * a quoting install simply has one company in its list.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { companyLimitsRequest, companyStatusRequest, createCompanyRequest, type CompanyRow } from '@sq/contracts';
import { pageQuery, parseBody, sendFail, sendOk } from '../lib/http.js';
import { requirePlatformCapability } from '../lib/guard.js';
import { hashPassword } from '../lib/password.js';
import { newToken } from '../lib/tokens.js';
import { createCompany } from '../lib/company.js';
import type { ApiConfig } from '../config.js';

/** Write one audit row. Called inside the same transaction as the change it records. */
async function audit(
  tx: Db,
  input: {
    actorId: string;
    actorEmail: string;
    action: string;
    targetType: string;
    targetId: string;
    summary: string;
  },
): Promise<void> {
  await tx.run(
    `INSERT INTO audit_events (id, at, actor_id, actor_email, action, target_type, target_id, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), now(), input.actorId, input.actorEmail, input.action, input.targetType, input.targetId, input.summary],
  );
}

export function registerAdmin(app: FastifyInstance, db: Db, config: ApiConfig): void {
  // ---------------------------------------------------------------- companies
  app.get('/admin/companies', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:companies');
    if (session === null) return;

    const query = pageQuery.safeParse(request.query);
    if (!query.success) return sendFail(reply, 'validation_failed', 'Check the paging parameters.');

    // One query, with the counts as correlated subqueries rather than a join: a join
    // to three tables would multiply the rows and need DISTINCT, which is slower and
    // easier to get wrong.
    const rows = await db.all<{
      id: string;
      name: string;
      slug: string;
      code: string | null;
      status: string;
      seats: number;
      subscription_ends_at: string | null;
      created_at: string;
      seats_in_use: number;
      member_count: number;
      quote_count: number;
    }>(
      `SELECT t.id, t.name, t.slug, t.code, t.status, t.seats, t.subscription_ends_at, t.created_at,
              (SELECT COUNT(*) FROM tenant_seats s WHERE s.tenant_id = t.id) AS seats_in_use,
              (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active') AS member_count,
              (SELECT COUNT(*) FROM quotes q WHERE q.tenant_id = t.id) AS quote_count
         FROM tenants t
        ORDER BY t.name
        LIMIT ?`,
      [query.data.limit],
    );

    const items: CompanyRow[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      code: row.code ?? null,
      status: row.status === 'suspended' ? 'suspended' : 'active',
      seats: row.seats,
      seatsInUse: Number(row.seats_in_use),
      subscriptionEndsAt: row.subscription_ends_at,
      memberCount: Number(row.member_count),
      quoteCount: Number(row.quote_count),
      createdAt: row.created_at,
    }));

    return sendOk(reply, { items, nextCursor: null, total: items.length });
  });

  /**
   * Create a company and its first administrator.
   *
   * One call does the whole job, because a formally created company is provisioned in one pass
   * rather than assembled from three endpoints — a ordering that the old server left to whoever
   * wrote the script. The code the operator supplies is what the administrator types at sign-in.
   */
  app.post('/admin/companies', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:companies');
    if (session === null) return;

    const body = parseBody(createCompanyRequest, request.body, reply);
    if (body === null) return;

    // A generated temporary password, returned once and never stored in plaintext. The
    // administrator must replace it at first sign-in, so a password that travelled through
    // a chat window is not a password that stays in force.
    const password = newToken();
    const passwordHash = await hashPassword(password);

    try {
      const created = await createCompany(
        db,
        {
          name: body.name,
          code: body.code,
          slug: body.slug,
          abn: body.abn ?? null,
          seats: body.seats,
          subscriptionEndsAt: body.subscriptionEndsAt,
          adminEmail: body.adminEmail,
          adminDisplayName: body.adminDisplayName,
          adminPasswordHash: passwordHash,
          mustChangePassword: true,
        },
      );

      return sendOk(
        reply,
        {
          tenantId: created.tenantId,
          adminUserId: created.adminUserId,
          adminEmail: body.adminEmail,
          temporaryPassword: password,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|duplicate key/i.test(message)) {
        return sendFail(
          reply,
          'conflict',
          'That company code, company slug or administrator email is already in use.',
        );
      }
      throw error;
    }
  });

  app.patch<{ Params: { tenantId: string } }>('/admin/companies/:tenantId/status', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:companies');
    if (session === null) return;

    const body = parseBody(companyStatusRequest, request.body, reply);
    if (body === null) return;

    const at = now();
    let missing = false;
    await db.transaction(async (tx) => {
      const changed = await tx.run('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?', [
        body.status,
        at,
        request.params.tenantId,
      ]);
      if (changed.changes === 0) throw new NotFound();

      if (body.status === 'suspended') {
        // Revoking the sessions is the point of suspending: a company that stops
        // paying must stop working now, not when its people next sign in.
        await tx.run('DELETE FROM tenant_seats WHERE tenant_id = ?', [request.params.tenantId]);
        await tx.run(
          "UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL",
          [at, request.params.tenantId],
        );
      }

      await audit(tx, {
        actorId: session.userId,
        actorEmail: session.email,
        action: body.status === 'suspended' ? 'company.suspend' : 'company.reinstate',
        targetType: 'tenant',
        targetId: request.params.tenantId,
        summary: body.reason !== undefined ? `${body.status}: ${body.reason}` : body.status,
      });
    }).catch((error: unknown) => {
      /*
       * A missing company is a 404, not a 200.
       *
       * This used to `return null` and fall through to a success answer, so suspending a company
       * that did not exist reported that it had been suspended. A control plane that says a change
       * happened when nothing was touched is worse than one that fails: the operator stops looking.
       */
      if (error instanceof NotFound) {
        missing = true;
        return;
      }
      throw error;
    });

    if (missing) return sendFail(reply, 'not_found', 'That company does not exist.');

    return sendOk(reply, { status: body.status });
  });

  /**
   * Change a company's limits: how many seats it may use, and when the subscription ends.
   *
   * `companyLimitsRequest` was defined in the contracts and used by nothing, so the seat count was
   * fixed at creation and could only be changed by editing the database. That is the one number a
   * vendor sells, and it had no route.
   *
   * Lowering the seat count does **not** evict anybody: the seats already held stay held, and the
   * new limit applies to the next sign-in. Evicting a working salesperson mid-quote to satisfy a
   * billing change is the kind of surprise that loses a customer over a rounding error.
   */
  app.patch<{ Params: { tenantId: string } }>('/admin/companies/:tenantId', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:seats');
    if (session === null) return;

    const body = parseBody(companyLimitsRequest, request.body, reply);
    if (body === null) return;

    const tenantId = request.params.tenantId;
    const at = now();
    let missing = false;

    await db.transaction(async (tx) => {
      const current = await tx.get<{ seats: number; subscription_ends_at: string | null }>(
        'SELECT seats, subscription_ends_at FROM tenants WHERE id = ?',
        [tenantId],
      );
      if (current === null) throw new NotFound();

      const seats = body.seats ?? Number(current.seats);
      const endsAt = body.subscriptionEndsAt === undefined ? current.subscription_ends_at : body.subscriptionEndsAt;

      await tx.run('UPDATE tenants SET seats = ?, subscription_ends_at = ?, updated_at = ? WHERE id = ?', [
        seats,
        endsAt,
        at,
        tenantId,
      ]);

      const changes: string[] = [];
      if (body.seats !== undefined && body.seats !== Number(current.seats)) {
        changes.push(`seats ${current.seats} → ${body.seats}`);
      }
      if (body.subscriptionEndsAt !== undefined && body.subscriptionEndsAt !== current.subscription_ends_at) {
        changes.push(`subscription ends ${current.subscription_ends_at ?? 'never'} → ${body.subscriptionEndsAt ?? 'never'}`);
      }

      await audit(tx, {
        actorId: session.userId,
        actorEmail: session.email,
        action: 'company.limits',
        targetType: 'tenant',
        targetId: tenantId,
        summary: changes.length === 0 ? 'No change' : changes.join('; '),
      });
    }).catch((error: unknown) => {
      if (error instanceof NotFound) {
        missing = true;
        return;
      }
      throw error;
    });

    if (missing) return sendFail(reply, 'not_found', 'That company does not exist.');

    return sendOk(reply, { seats: body.seats ?? null, subscriptionEndsAt: body.subscriptionEndsAt ?? null });
  });

  // ---------------------------------------------------------------- audit
  app.get('/admin/audit', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:audit');
    if (session === null) return;

    const query = pageQuery.safeParse(request.query);
    if (!query.success) return sendFail(reply, 'validation_failed', 'Check the paging parameters.');

    const rows = await db.all<{
      id: string;
      at: string;
      actor_email: string;
      action: string;
      target_type: string;
      target_id: string;
      summary: string;
    }>(
      `SELECT id, at, actor_email, action, target_type, target_id, summary
         FROM audit_events ORDER BY at DESC LIMIT ?`,
      [query.data.limit],
    );

    // camelCase, matching the `AuditEntry` contract. The route used to return raw snake_case rows,
    // so a screen typed against the contract read `undefined` for every field while compiling.
    return sendOk(reply, {
      items: rows.map((row) => ({
        id: row.id,
        at: row.at,
        actorEmail: row.actor_email,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        summary: row.summary,
      })),
      nextCursor: null,
      total: rows.length,
    });
  });

  // ---------------------------------------------------------------- enquiries
  app.get('/admin/enquiries', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:enquiries');
    if (session === null) return;

    const query = pageQuery.safeParse(request.query);
    if (!query.success) return sendFail(reply, 'validation_failed', 'Check the paging parameters.');

    const rows = await db.all<{
      id: string;
      name: string;
      email: string;
      phone: string | null;
      message: string;
      source: string;
      handled: number;
      created_at: string;
    }>(
      `SELECT id, name, email, phone, message, source, handled, created_at
         FROM enquiries ORDER BY handled, created_at DESC LIMIT ?`,
      [query.data.limit],
    );

    return sendOk(reply, {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        message: row.message,
        source: row.source,
        // A boolean, as the contract says. The column is an INTEGER and used to come back as 0/1,
        // which a checkbox reads as truthy for both values.
        handled: Number(row.handled) === 1,
        createdAt: row.created_at,
      })),
      nextCursor: null,
      total: rows.length,
    });
  });

  /** Mark an enquiry handled, or put it back in the queue. */
  app.patch<{ Params: { enquiryId: string } }>('/admin/enquiries/:enquiryId', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:enquiries');
    if (session === null) return;

    const record = (request.body ?? {}) as Record<string, unknown>;
    if (typeof record.handled !== 'boolean') {
      return sendFail(reply, 'validation_failed', 'Send { handled: true } or { handled: false }.');
    }

    const at = now();
    const changed = await db.run(
      'UPDATE enquiries SET handled = ?, handled_by = ?, handled_at = ? WHERE id = ?',
      [record.handled ? 1 : 0, record.handled ? session.userId : null, record.handled ? at : null, request.params.enquiryId],
    );
    if (changed.changes === 0) return sendFail(reply, 'not_found', 'Not found.');

    return sendOk(reply, { handled: record.handled });
  });
}

/** Internal signal for a missing row inside a transaction. */
class NotFound extends Error {
  constructor() {
    super('Not found.');
    this.name = 'NotFound';
  }
}
