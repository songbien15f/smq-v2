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
import {
  companyLimitsRequest,
  companyStatusRequest,
  createCompanyRequest,
  type AdminCompanyPeopleView,
  type CompanyRow,
} from '@sq/contracts';
import { pageQuery, parseBody, sendFail, sendOk } from '../lib/http.js';
import { requirePlatformCapability } from '../lib/guard.js';
import { audit } from '../lib/audit.js';
import { hashPassword } from '../lib/password.js';
import { newToken } from '../lib/tokens.js';
import { createCompany } from '../lib/company.js';
import { deviceLabel, listDevices, revokeDevice } from '../lib/devices.js';
import type { ApiConfig } from '../config.js';

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
              (SELECT COUNT(*) FROM device_seats s WHERE s.tenant_id = t.id) AS seats_in_use,
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
        /*
         * Revoking the sessions is the point of suspending: a company that stops paying must stop
         * working now, not when its people next sign in. Its **devices** go too — a device left live
         * would re-take a seat the moment the company was reinstated, and would otherwise sit in the
         * admin's device list for a company that is on hold.
         */
        await tx.run('DELETE FROM device_seats WHERE tenant_id = ?', [request.params.tenantId]);
        await tx.run(
          'UPDATE devices SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL',
          [at, request.params.tenantId],
        );
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

  // ---------------------------------------------------------------- one company's people

  /**
   * Who belongs to a company, which browsers hold its seats, and who signed in lately.
   *
   * The desktop licence server let the vendor see every key a company held and its sign-in history.
   * Without the same here, "we are out of seats" could only be answered by the customer's own
   * administrator. Read-only, so it needs `platform:companies` — support staff can look.
   */
  app.get<{ Params: { tenantId: string } }>('/admin/companies/:tenantId/people', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:companies');
    if (session === null) return;

    const tenantId = request.params.tenantId;
    const tenant = await db.get<{ seats: number }>('SELECT seats FROM tenants WHERE id = ?', [tenantId]);
    if (tenant === null) return sendFail(reply, 'not_found', 'That company does not exist.');

    const [members, devices, signIns] = await Promise.all([
      db.all<{
        user_id: string;
        display_name: string;
        username: string | null;
        email: string;
        role: string;
        status: string;
        last_sign_in_at: string | null;
      }>(
        `SELECT m.user_id, u.display_name, m.username, u.email, m.role, m.status,
                (SELECT MAX(s.created_at) FROM sessions s
                  WHERE s.user_id = m.user_id AND s.tenant_id = m.tenant_id) AS last_sign_in_at
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = ?
          ORDER BY CASE WHEN m.status = 'active' THEN 0 ELSE 1 END, u.display_name`,
        [tenantId],
      ),
      listDevices(db, tenantId),
      db.all<{
        id: string;
        created_at: string;
        display_name: string;
        username: string | null;
        user_agent: string | null;
        revoked_at: string | null;
        expires_at: string;
      }>(
        `SELECT s.id, s.created_at, u.display_name, m.username, s.user_agent, s.revoked_at, s.expires_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
          WHERE s.tenant_id = ?
          ORDER BY s.created_at DESC
          LIMIT 25`,
        [tenantId],
      ),
    ]);

    const at = now();
    const view: AdminCompanyPeopleView = {
      seats: Number(tenant.seats),
      seatsInUse: devices.filter((device) => device.holdsSeat).length,
      members: members.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        username: row.username ?? '',
        email: row.email,
        role: row.role,
        status: row.status,
        lastSignInAt: row.last_sign_in_at,
      })),
      devices: devices.map((device) => ({
        id: device.id,
        userDisplayName: device.userDisplayName,
        username: device.username,
        label: device.label,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        holdsSeat: device.holdsSeat,
      })),
      recentSignIns: signIns.map((row) => ({
        id: row.id,
        at: row.created_at,
        userDisplayName: row.display_name,
        username: row.username ?? '',
        label: deviceLabel(row.user_agent),
        // ISO-8601 strings in UTC compare correctly as text.
        state: row.revoked_at === null && row.expires_at > at ? 'active' : 'ended',
      })),
    };
    return sendOk(reply, view);
  });

  /**
   * Free one device's seat on the company's behalf — the vendor's "remove key".
   *
   * Same effect as the company administrator's Team → Devices → Free seat: the device's sessions end
   * on their next request and the seat is free at once. A change to what the customer paid for, so it
   * needs `platform:seats`, and it is audited.
   */
  app.delete<{ Params: { tenantId: string; deviceId: string } }>(
    '/admin/companies/:tenantId/devices/:deviceId',
    async (request, reply) => {
      const session = requirePlatformCapability(request, reply, 'platform:seats');
      if (session === null) return;

      const { tenantId, deviceId } = request.params;
      const device = await db.get<{ label: string; display_name: string; code: string | null }>(
        `SELECT d.label, u.display_name, t.code
           FROM devices d
           JOIN users u ON u.id = d.user_id
           JOIN tenants t ON t.id = d.tenant_id
          WHERE d.id = ? AND d.tenant_id = ? AND d.revoked_at IS NULL`,
        [deviceId, tenantId],
      );
      if (device === null) return sendFail(reply, 'not_found', 'That device is not signed in to this company.');

      const revoked = await revokeDevice(db, { tenantId, deviceId });
      if (!revoked) return sendFail(reply, 'not_found', 'That device is not signed in to this company.');

      await audit(db, {
        actorId: session.userId,
        actorEmail: session.email,
        action: 'device.revoked',
        targetType: 'device',
        targetId: deviceId,
        summary: `Freed the seat of ${device.display_name}'s ${device.label} in company ${device.code ?? tenantId}.`,
      });

      return sendOk(reply, { revoked: deviceId });
    },
  );

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
