/**
 * Company settings: the document's header, the company's own numbers, and the people who may act.
 *
 * Settings are a **versioned** row: a change writes a new version, and a saved revision records the
 * version it was priced under. Overwriting in place would make "this quote used a 15% margin"
 * unanswerable the moment the margin moved — which is the whole reason the row is frozen in the
 * revision in the first place.
 *
 * Members are the second person a company cannot add today, which is why they sit here: a workspace
 * with no way to seat somebody else is a tool for one person, and the seat limit is what makes a
 * second person not just possible but bounded.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { z } from 'zod';
import { newId, now } from '@sq/db';
import { loadSettings, saveSettings, type CompanySettings } from '../lib/settings.js';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';

/** What a patch may set. Every field is optional and a version bump is one act. */
const settingsPatch = z
  .object({
    name: z.string().trim().min(1).max(200),
    abn: z.string().trim().max(20).nullable(),
    margin: z.number().min(1).max(10).nullable(),
    depositPct: z.number().min(0).max(100),
    progressPct: z.number().min(0).max(100),
    bomProfileId: z.string().min(1).max(80).nullable(),
    assumptions: z
      .array(z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(2000) }))
      .max(40),
    paymentDetails: z.string().max(2000).nullable(),
    address: z.string().max(400).nullable(),
    phone: z.string().max(40).nullable(),
    email: z.string().max(200).nullable(),
    logoText: z.string().max(40).nullable(),
    terms: z.array(z.string().max(2000)).max(40),
  })
  .partial()
  .strict();

/** The roles a member may hold. */
const ROLES = ['company_admin', 'estimator', 'viewer'] as const;

/** A person in the company. */
export interface MemberView {
  id: string;
  email: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
  /** True while one of their sessions holds a seat, which is what a seat actually is. */
  active: boolean;
}

/**
 * Members, and the operations that change them.
 *
 * Every operation is **inside one seat limit**, which is the invariant a multi-company server's
 * "seats are a number" model does not have: a sign-in that exceeds the count is refused, so the
 * number on this screen is a promise the system keeps.
 */
export function registerSettings(app: FastifyInstance, db: Db): void {
  /* --------------------------------------------------------------- settings */

  app.get('/settings', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'settings:manage');
    if (session === null) return;

    const settings = await loadSettings(db, session.tenantId as string);
    return sendOk(reply, settings);
  });

  app.patch('/settings', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'settings:manage');
    if (session === null) return;

    const patch = parseBody(settingsPatch, request.body, reply);
    if (patch === null) return;

    const next = await saveSettings(db, session.tenantId as string, session.userId, {
      ...patch,
    } as Partial<CompanySettings>);

    // A settings change moves the company's own numbers, and a saved revision is a record of what
    // they were — so the change is audited with the version it created.
    await db.run(
      `INSERT INTO audit_events (id, at, actor_id, actor_email, action, target_type, target_id, summary)
       VALUES (?, ?, ?, ?, ?, 'settings', ?, ?)`,
      [
        newId(),
        now(),
        session.userId,
        session.email,
        'settings.update',
        session.tenantId,
        `Settings moved to version ${next.version}`,
      ],
    );

    return sendOk(reply, next);
  });

  /* --------------------------------------------------------------- members */

  app.get('/team', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'members:manage');
    if (session === null) return;

    const tenantId = session.tenantId as string;

    /*
     * One query, joining the person to their membership.
     *
     * `memberships` holds `(tenant_id, user_id, role)` and nothing else — the address and the name are
     * on `users`. A first version selected `m.email` and the route answered 500; the join is the fix,
     * and pulling `user_id` out with the rest removes the second lookup that was doing the same job.
     */
    const members = await db.all<{
      user_id: string;
      email: string;
      display_name: string;
      role: string;
      must_change_password: number;
    }>(
      `SELECT u.id AS user_id, u.email, COALESCE(NULLIF(u.display_name, ''), u.email) AS display_name,
              m.role, u.must_change_password
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ? AND m.status = 'active'
        ORDER BY m.role, u.email`,
      [tenantId],
    );

    // A seat is a live session, so the flag comes from `sessions` rather than from a column that
    // would need keeping in step with them.
    const seated = await db.all<{ user_id: string }>(
      'SELECT DISTINCT user_id FROM sessions WHERE tenant_id = ? AND revoked_at IS NULL',
      [tenantId],
    );
    const holdsSeat = new Set(seated.map((row) => row.user_id));

    const view: MemberView[] = members.map((row) => ({
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      mustChangePassword: Number(row.must_change_password) === 1,
      active: holdsSeat.has(row.user_id),
    }));

    return sendOk(reply, { items: view });
  });

  /** Change a member's role. An operator cannot change their own role to a lower one: the last
   *  administrator leaving a company is a lockout with no one left to undo it. */
  app.patch<{ Params: { email: string } }>('/team/:email/role', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'members:manage');
    if (session === null) return;

    const role = ROLES.includes((request.body as { role?: string }).role as (typeof ROLES)[number])
      ? ((request.body as { role: string }).role as (typeof ROLES)[number])
      : null;
    if (role === null) {
      return sendFail(reply, 'validation_failed', `Role must be one of: ${ROLES.join(', ')}`);
    }

    // You may not demote yourself out of the last admin seat.
    if (request.params.email === session.email && role !== 'company_admin') {
      const admins = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ? AND role = 'company_admin'`,
        [session.tenantId],
      );
      if (Number(admins?.n ?? 0) <= 1) {
        return sendFail(
          reply,
          'conflict',
          'You are the only company administrator, so you cannot remove that role from yourself. Add another administrator first.',
        );
      }
    }

    /*
     * The address identifies the member, but it lives on `users`, so the update joins through.
     *
     * `UPDATE … WHERE email = ?` was the first version and `memberships` has no such column: the
     * statement failed with a 42703 and the route answered 500. A subquery on `users` keeps this to
     * one statement and refuses a row that belongs to another company, because the membership is
     * still keyed on the tenant in the path.
     */
    const changed = await db.run(
      `UPDATE memberships SET role = ?, updated_at = ?
        WHERE tenant_id = ?
          AND user_id = (SELECT id FROM users WHERE email = ?)`,
      [role, now(), session.tenantId, request.params.email],
    );
    if (changed.changes === 0) return sendFail(reply, 'not_found', 'Not found.');

    return sendOk(reply, { email: request.params.email, role });
  });

  /** Remove a member. The last administrator cannot leave: the company would have no one who can act. */
  app.delete<{ Params: { email: string } }>('/team/:email', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'members:manage');
    if (session === null) return;

    const target = await db.get<{ user_id: string; role: string }>(
      `SELECT m.user_id, m.role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ? AND u.email = ?`,
      [session.tenantId, request.params.email],
    );
    if (target === null) return sendFail(reply, 'not_found', 'Not found.');

    if (target.role === 'company_admin') {
      const admins = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ? AND role = 'company_admin' AND status = 'active'`,
        [session.tenantId],
      );
      if (Number(admins?.n ?? 0) <= 1) {
        return sendFail(
          reply,
          'conflict',
          "This is the company's only administrator, and a company without one cannot be administered. Transfer the role first.",
        );
      }
    }

    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?', [
        session.tenantId,
        target.user_id,
      ]);
      // Their live sessions end with the membership: a removed person must not keep a seat or a
      // session that can still reach the company's routes. Keyed on the user id, which is what
      // `sessions` holds — the earlier version selected from `memberships` after deleting the row it
      // needed, so the revocation silently matched nothing.
      await tx.run(
        'UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL',
        [now(), session.tenantId, target.user_id],
      );
    });

    return sendOk(reply, { removed: request.params.email });
  });
}
