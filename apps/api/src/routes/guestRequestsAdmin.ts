/**
 * Guest requests, as the vendor sees them (`/admin/guest-requests`).
 *
 * The guest page (`routes/guest.ts`) stores every accepted request in `guest_requests` and mails a
 * notification; until this file no screen showed the table, so a request whose mail was lost (or a
 * deployment with no mail configured) was invisible. These routes read it and let the vendor mark a
 * request declined or spam, or put it back to new.
 *
 * `transferred` is **not** settable here: it means "handed to a company as a quote" and belongs to
 * the transfer slice (G-c), which has to create the company's quote in the same transaction.
 *
 * The table is platform-level (no `tenant_id`), so the guard is the platform capability that already
 * governs the website's enquiries.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '@sq/db';
import { now } from '@sq/db';
import { GUEST_DEFAULT_TYPES } from '@sq/core/domain';
import { audit } from '../lib/audit.js';
import { requirePlatformCapability } from '../lib/guard.js';
import { parseBody, sendFail, sendOk } from '../lib/http.js';

const CAPABILITY = 'platform:enquiries';

const STATUSES = ['new', 'transferred', 'declined', 'spam'] as const;
type GuestRequestStatus = (typeof STATUSES)[number];

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const statusPatch = z.object({
  status: z.enum(['new', 'declined', 'spam']),
  reason: z.string().trim().max(500).optional(),
});

interface Row {
  id: string;
  number: string;
  contact_json: string;
  design_json: string;
  notes: string | null;
  source_json: string | null;
  status: GuestRequestStatus;
  site_estimate_json: string | null;
  review_flags: string | null;
  assistant_transcript_json: string | null;
  transferred_tenant_id: string | null;
  transferred_at: string | null;
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, number, contact_json, design_json, notes, source_json, status, site_estimate_json,
  review_flags, assistant_transcript_json, transferred_tenant_id, transferred_at, decline_reason,
  created_at, updated_at`;

/** A stored JSON column, or `null` when it is empty or no longer parses (never a 500). */
function json(text: string | null): unknown {
  if (text === null || text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Every building type's name by id, switched off ones included: an old request still names the type
 * it was designed as. With no row in the table the guest page offers the core defaults, so those
 * names apply.
 */
async function typeNames(db: Db): Promise<Map<string, string>> {
  const rows = await db.all<{ id: string; name: string }>('SELECT id, name FROM guest_building_types');
  const names = new Map<string, string>(GUEST_DEFAULT_TYPES.map((t) => [t.id, t.name]));
  for (const row of rows) names.set(row.id, row.name);
  return names;
}

function summary(row: Row, names: Map<string, string>) {
  const contact = record(json(row.contact_json));
  const design = record(json(row.design_json));
  const building = record(design.building);
  const site = record(design.site);
  const bays = Array.isArray(building.bayWidths) ? (building.bayWidths as unknown[]).map(Number) : [];
  const flags = json(row.review_flags);
  const typeId = typeof design.typeId === 'string' ? design.typeId : '';
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    name: [text(contact.firstName), text(contact.lastName)].filter((p) => p !== '').join(' '),
    email: text(contact.email),
    mobile: text(contact.mobile),
    typeId,
    typeName: names.get(typeId) ?? typeId,
    suburb: text(site.suburb),
    state: text(site.state),
    postcode: text(site.postcode),
    spanMm: Number(building.span) || 0,
    lengthMm: bays.reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0),
    heightMm: Number(building.height) || 0,
    reviewFlags: Array.isArray(flags) ? flags.filter((f): f is string => typeof f === 'string') : [],
    createdAt: row.created_at,
  };
}

export function registerGuestRequestsAdmin(app: FastifyInstance, db: Db): void {
  /** The list, newest first; `?status=` narrows it. */
  app.get('/admin/guest-requests', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const query = listQuery.safeParse(request.query);
    if (!query.success) return sendFail(reply, 'validation_failed', 'Check the status and limit.');

    // The parameter list is built to match the SQL: no `? IS NULL` (Postgres cannot type it).
    const where = query.data.status === undefined ? '' : 'WHERE status = ?';
    const params = query.data.status === undefined ? [query.data.limit] : [query.data.status, query.data.limit];
    const [rows, counts, names] = await Promise.all([
      db.all<Row>(`SELECT ${COLUMNS} FROM guest_requests ${where} ORDER BY created_at DESC LIMIT ?`, params),
      db.all<{ status: GuestRequestStatus; n: number | string }>(
        'SELECT status, COUNT(*) AS n FROM guest_requests GROUP BY status',
      ),
      typeNames(db),
    ]);

    const byStatus: Record<GuestRequestStatus, number> = { new: 0, transferred: 0, declined: 0, spam: 0 };
    for (const c of counts) byStatus[c.status] = Number(c.n);

    return sendOk(reply, {
      items: rows.map((row) => summary(row, names)),
      counts: byStatus,
    });
  });

  /** One request in full: contact, design, notes, the server's estimate and the assistant transcript. */
  app.get<{ Params: { number: string } }>('/admin/guest-requests/:number', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const row = await db.get<Row>(`SELECT ${COLUMNS} FROM guest_requests WHERE number = ?`, [request.params.number]);
    if (row === null) return sendFail(reply, 'not_found', 'No guest request has that number.');

    const names = await typeNames(db);
    const transcript = json(row.assistant_transcript_json);
    return sendOk(reply, {
      ...summary(row, names),
      contact: record(json(row.contact_json)),
      design: json(row.design_json),
      notes: row.notes,
      source: json(row.source_json),
      estimate: json(row.site_estimate_json),
      transcript: Array.isArray(transcript) ? transcript : [],
      declineReason: row.decline_reason,
      transferredTenantId: row.transferred_tenant_id,
      transferredAt: row.transferred_at,
      updatedAt: row.updated_at,
    });
  });

  /** Decline, mark spam, or put back to new. A transferred request stays transferred. */
  app.patch<{ Params: { number: string } }>('/admin/guest-requests/:number', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const body = parseBody(statusPatch, request.body, reply);
    if (body === null) return;
    const reason = body.status === 'declined' && body.reason !== undefined && body.reason !== '' ? body.reason : null;

    const outcome = await db.transaction(async (tx) => {
      const current = await tx.get<{ id: string; status: GuestRequestStatus }>(
        'SELECT id, status FROM guest_requests WHERE number = ?',
        [request.params.number],
      );
      if (current === null) return 'not_found' as const;
      if (current.status === 'transferred') return 'transferred' as const;

      const at = now();
      await tx.run('UPDATE guest_requests SET status = ?, decline_reason = ?, updated_at = ? WHERE id = ?', [
        body.status,
        reason,
        at,
        current.id,
      ]);
      await audit(tx, {
        actorId: session.userId,
        actorEmail: session.email,
        action: 'guest_request.status',
        targetType: 'guest_request',
        targetId: current.id,
        summary: `${request.params.number}: ${current.status} → ${body.status}${reason === null ? '' : ` (${reason})`}`,
      });
      return { status: body.status, declineReason: reason, updatedAt: at };
    });

    if (outcome === 'not_found') return sendFail(reply, 'not_found', 'No guest request has that number.');
    if (outcome === 'transferred') {
      return sendFail(reply, 'conflict', 'This request was handed to a company; its status can no longer change.');
    }
    return sendOk(reply, outcome);
  });
}
