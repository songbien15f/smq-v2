/**
 * The vendor's screen for the Guest page's building types.
 *
 * ## What this owns
 *
 * `guest_building_types` is a **platform** catalogue: one set of building types for every visitor to
 * `/quote`, with no `tenant_id` (migration 020). While the table is empty the API serves the six
 * defaults compiled into `@sq/core`; the first write here copies those six in and then applies the
 * change. That seeding is not a convenience — without it, editing one type would make the other five
 * disappear from the Guest page, because `loadBuildingTypes` answers the defaults only when the table
 * has no rows at all (`routes/guest.ts`).
 *
 * ## What it will not do
 *
 * - **No delete** (Q3). A sent request stores `typeId` in `design_json`, and a guest's browser keeps
 *   it in `localStorage`; a type can be switched off, never removed.
 * - **No id change** (Q5). The id is in deep links (`?type=`), in saved drafts and in leads.
 * - **No silent geometry errors.** `checkGuestBuildingType` runs on every write, so a type whose
 *   starting design cannot be drawn never reaches a guest. Limits beyond the price book are
 *   **warnings** only (Q2): the operator may offer them, and `guestReviewFlags` marks such a request
 *   for an estimator.
 *
 * Every write runs in one transaction: seed if empty → apply → audit.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '@sq/db';
import { now } from '@sq/db';
import {
  GUEST_DEFAULT_TYPES,
  bookWarnings,
  checkGuestBuildingType,
  type GuestBuildingTypeSpec,
} from '@sq/core/domain';
import {
  guestBuildingTypePatchSchema,
  guestBuildingTypeReorderSchema,
  guestBuildingTypeSchema,
  guestBuildingTypeWriteSchema,
  type GuestBuildingTypeAdminDetail,
  type GuestBuildingTypeAdminRow,
  type GuestBuildingTypesAdminResponse,
} from '@sq/contracts';
import { audit } from '../lib/audit.js';
import { requirePlatformCapability } from '../lib/guard.js';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import type { ApiConfig } from '../config.js';

/** The capability that governs this screen (Q1: reuse the catalogue one). */
const CAPABILITY = 'platform:templates';

interface Row {
  id: string;
  name: string;
  description: string;
  base_preset: string;
  config_json: string;
  enabled: number | boolean;
  sort_order: number | string;
  version: number | string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One stored row as the admin sees it.
 *
 * A row whose `config_json` no longer parses is **returned**, marked `invalid`, rather than dropped:
 * the Guest page skips it, so without this the operator would see a type vanish with nothing to fix.
 */
function toAdminRow(row: Row): GuestBuildingTypeAdminRow {
  let config: unknown;
  try {
    config = JSON.parse(row.config_json);
  } catch {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      version: Number(row.version),
      sortOrder: Number(row.sort_order),
      enabled: Number(row.enabled) === 1,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      source: 'database',
      invalid: { reason: 'The stored config is not valid JSON.' },
      // The schema needs a config; an unreadable one is shown as the default type with the same id
      // when there is one, so the form can open and be corrected.
      config: GUEST_DEFAULT_TYPES.find((t) => t.id === row.id)?.config ?? GUEST_DEFAULT_TYPES[0]!.config,
    };
  }
  const parsed = guestBuildingTypeSchema.safeParse({
    id: row.id,
    name: row.name,
    description: row.description,
    version: Number(row.version),
    sortOrder: Number(row.sort_order),
    config,
  });
  if (parsed.success) {
    return {
      ...parsed.data,
      enabled: Number(row.enabled) === 1,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      source: 'database',
    };
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: Number(row.version),
    sortOrder: Number(row.sort_order),
    enabled: Number(row.enabled) === 1,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    source: 'database',
    invalid: { reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
    config: GUEST_DEFAULT_TYPES.find((t) => t.id === row.id)?.config ?? GUEST_DEFAULT_TYPES[0]!.config,
  };
}

/** The six defaults, as admin rows: `source: 'default'` and `version: 0` (never saved). */
function defaultRows(): GuestBuildingTypeAdminRow[] {
  return GUEST_DEFAULT_TYPES.map((type) => ({
    ...type,
    enabled: true,
    updatedAt: null,
    updatedBy: null,
    source: 'default' as const,
  }));
}

async function tableIsEmpty(db: Db): Promise<boolean> {
  const total = await db.get<{ n: number | string }>('SELECT COUNT(*) AS n FROM guest_building_types');
  return Number(total?.n ?? 0) === 0;
}

/**
 * Copy the six code defaults into the table, inside `tx`.
 *
 * `version = 1` because the row now exists and has been saved once; `updated_by = null` because no
 * person did it — the audit row for the seed says the same thing.
 */
async function seedDefaults(tx: Db, actorEmail: string, actorId: string): Promise<void> {
  const at = now();
  for (const type of GUEST_DEFAULT_TYPES) {
    await tx.run(
      `INSERT INTO guest_building_types
         (id, name, description, base_preset, config_json, enabled, sort_order, version, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 1, NULL, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [type.id, type.name, type.description, type.config.basePreset, JSON.stringify(type.config), type.sortOrder, at, at],
    );
  }
  await audit(tx, {
    actorId,
    actorEmail,
    action: 'guest_type.seed_defaults',
    targetType: 'guest_building_type',
    targetId: '*',
    summary: `Copied the ${GUEST_DEFAULT_TYPES.length} code defaults into the database for the first edit`,
  });
}

/**
 * Does the version the form opened still describe the row?
 *
 * A form opened while the table was empty shows a code default, which the read routes report as
 * version 0. If **this** transaction is the one that just seeded the table, that default is exactly
 * the version-1 row now stored, so 0 matches 1. If somebody else seeded it first, the row may have
 * moved on, and 0 matches nothing — the editor gets the usual "reload" conflict.
 */
function versionMatches(expected: number | undefined, current: number, seededHere: boolean): boolean {
  if (expected === undefined) return true;
  if (expected === 0) return seededHere && current === 1;
  return expected === current;
}

/** The spec a write describes, so the core checks see exactly what will be stored. */
function specFromWrite(id: string, write: {
  name: string;
  description: string;
  sortOrder: number;
  config: GuestBuildingTypeSpec['config'];
}): GuestBuildingTypeSpec {
  return { id, name: write.name, description: write.description, version: 0, sortOrder: write.sortOrder, config: write.config };
}

/** Refuse a write whose starting design cannot be drawn, in the operator's words. */
function refuseInvalid(reply: FastifyReply, issues: string[]): undefined {
  sendFail(reply, 'validation_failed', 'This type would not work on the Guest page.', issues.map((message) => ({
    path: 'config',
    message,
  })));
  return undefined;
}

export function registerGuestTypesAdmin(app: FastifyInstance, db: Db, config: ApiConfig): void {
  const siteOrigin = config.origins.site;

  // ---------------------------------------------------------------- read

  app.get('/admin/guest-types', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const rows = await db.all<Row>(
      `SELECT id, name, description, base_preset, config_json, enabled, sort_order, version,
              updated_by, created_at, updated_at
         FROM guest_building_types
        ORDER BY sort_order, name`,
    );
    const data: GuestBuildingTypesAdminResponse = {
      items: rows.length === 0 ? defaultRows() : rows.map(toAdminRow),
      siteOrigin,
    };
    return sendOk(reply, data);
  });

  app.get<{ Params: { id: string } }>('/admin/guest-types/:id', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const empty = await tableIsEmpty(db);
    if (empty) {
      const type = GUEST_DEFAULT_TYPES.find((t) => t.id === request.params.id);
      if (type === undefined) return sendFail(reply, 'not_found', 'That building type does not exist.');
      const data: GuestBuildingTypeAdminDetail = {
        item: { ...type, enabled: true, updatedAt: null, updatedBy: null, source: 'default' },
        issues: checkGuestBuildingType(type),
        warnings: bookWarnings(type),
      };
      return sendOk(reply, data);
    }

    const row = await db.get<Row>(
      `SELECT id, name, description, base_preset, config_json, enabled, sort_order, version,
              updated_by, created_at, updated_at
         FROM guest_building_types WHERE id = ?`,
      [request.params.id],
    );
    if (row === null) return sendFail(reply, 'not_found', 'That building type does not exist.');

    const item = toAdminRow(row);
    const spec = specFromWrite(item.id, item);
    const data: GuestBuildingTypeAdminDetail = {
      item,
      // An unreadable stored config already carries its reason; the core checks would report the
      // substituted default instead, which is not what is stored.
      issues: item.invalid === undefined ? checkGuestBuildingType(spec) : [item.invalid.reason],
      warnings: item.invalid === undefined ? bookWarnings(spec) : [],
    };
    return sendOk(reply, data);
  });

  // ---------------------------------------------------------------- write

  app.post('/admin/guest-types', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const body = parseBody(guestBuildingTypeWriteSchema, request.body, reply);
    if (body === null) return;
    const id = body.id;
    if (id === undefined) {
      return sendFail(reply, 'validation_failed', 'An id is required when creating a type.', [
        { path: 'id', message: 'An id is required' },
      ]);
    }

    const spec = specFromWrite(id, body);
    const issues = checkGuestBuildingType(spec);
    if (issues.length > 0) {
      refuseInvalid(reply, issues);
      return;
    }

    const created = await db.transaction(async (tx) => {
      if (await tableIsEmpty(tx)) await seedDefaults(tx, session.email, session.userId);

      const clash = await tx.get<{ id: string }>('SELECT id FROM guest_building_types WHERE id = ?', [id]);
      if (clash !== null) return null;

      const at = now();
      await tx.run(
        `INSERT INTO guest_building_types
           (id, name, description, base_preset, config_json, enabled, sort_order, version, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          id,
          body.name,
          body.description,
          body.config.basePreset,
          JSON.stringify(body.config),
          body.enabled ? 1 : 0,
          body.sortOrder,
          session.email,
          at,
          at,
        ],
      );
      await audit(tx, {
        actorId: session.userId,
        actorEmail: session.email,
        action: 'guest_type.create',
        targetType: 'guest_building_type',
        targetId: id,
        summary: `Created building type "${body.name}" (${id})`,
      });
      return id;
    });

    if (created === null) {
      return sendFail(reply, 'conflict', `A building type with the id "${id}" already exists.`);
    }
    return sendOk(reply, { id: created }, 201);
  });

  app.put<{ Params: { id: string } }>('/admin/guest-types/:id', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const body = parseBody(guestBuildingTypeWriteSchema, request.body, reply);
    if (body === null) return;
    if (body.id !== undefined && body.id !== request.params.id) {
      return sendFail(reply, 'validation_failed', 'The id cannot be changed.', [
        { path: 'id', message: 'The id is fixed once the type exists' },
      ]);
    }

    const spec = specFromWrite(request.params.id, body);
    const issues = checkGuestBuildingType(spec);
    if (issues.length > 0) {
      refuseInvalid(reply, issues);
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const seededHere = await tableIsEmpty(tx);
      if (seededHere) await seedDefaults(tx, session.email, session.userId);

      const row = await tx.get<{ version: number | string; enabled: number | boolean }>(
        'SELECT version, enabled FROM guest_building_types WHERE id = ?',
        [request.params.id],
      );
      if (row === null) return { kind: 'missing' as const };

      // Optimistic lock (Q7): the form sends the version it opened; a mismatch means somebody else
      // saved in between, and overwriting their work silently is the one outcome worth refusing.
      const current = Number(row.version);
      if (!versionMatches(body.expectedVersion, current, seededHere)) {
        return { kind: 'stale' as const, version: current };
      }

      const at = now();
      const nextVersion = current + 1;
      // `AND version = ?`: the check above read the row without a lock, so a save that committed in
      // between would otherwise be overwritten. Zero rows changed is the same conflict.
      const updated = await tx.run(
        `UPDATE guest_building_types
            SET name = ?, description = ?, base_preset = ?, config_json = ?, enabled = ?,
                sort_order = ?, version = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND version = ?`,
        [
          body.name,
          body.description,
          body.config.basePreset,
          JSON.stringify(body.config),
          body.enabled ? 1 : 0,
          body.sortOrder,
          nextVersion,
          session.email,
          at,
          request.params.id,
          current,
        ],
      );
      if (updated.changes === 0) return { kind: 'stale' as const, version: current + 1 };
      await audit(tx, {
        actorId: session.userId,
        actorEmail: session.email,
        action: 'guest_type.update',
        targetType: 'guest_building_type',
        targetId: request.params.id,
        summary: `Saved building type "${body.name}" (${request.params.id}), version ${current} → ${nextVersion}`,
      });
      return { kind: 'saved' as const, version: nextVersion };
    });

    if (outcome.kind === 'missing') return sendFail(reply, 'not_found', 'That building type does not exist.');
    if (outcome.kind === 'stale') {
      return sendFail(
        reply,
        'conflict',
        `This type was just changed by somebody else (now version ${outcome.version}). Reload and try again.`,
      );
    }
    return sendOk(reply, { id: request.params.id, version: outcome.version });
  });

  app.patch<{ Params: { id: string } }>('/admin/guest-types/:id', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const body = parseBody(guestBuildingTypePatchSchema, request.body, reply);
    if (body === null) return;

    const outcome = await db.transaction(async (tx) => {
      const seededHere = await tableIsEmpty(tx);
      if (seededHere) await seedDefaults(tx, session.email, session.userId);

      const row = await tx.get<{ version: number | string; enabled: number | boolean; name: string }>(
        'SELECT version, enabled, name FROM guest_building_types WHERE id = ?',
        [request.params.id],
      );
      if (row === null) return { kind: 'missing' as const };

      const current = Number(row.version);
      if (!versionMatches(body.expectedVersion, current, seededHere)) {
        return { kind: 'stale' as const, version: current };
      }

      const enabled = body.enabled === undefined ? Number(row.enabled) === 1 : body.enabled;
      const at = now();
      const nextVersion = current + 1;
      const updated = await tx.run(
        `UPDATE guest_building_types
            SET enabled = ?, sort_order = COALESCE(?, sort_order), version = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND version = ?`,
        [enabled ? 1 : 0, body.sortOrder ?? null, nextVersion, session.email, at, request.params.id, current],
      );
      if (updated.changes === 0) return { kind: 'stale' as const, version: current + 1 };

      const action =
        body.enabled === undefined ? 'guest_type.reorder' : enabled ? 'guest_type.enable' : 'guest_type.disable';
      await audit(tx, {
        actorId: session.userId,
        actorEmail: session.email,
        action,
        targetType: 'guest_building_type',
        targetId: request.params.id,
        summary:
          body.enabled === undefined
            ? `Moved "${row.name}" to sort order ${body.sortOrder}`
            : `${enabled ? 'Enabled' : 'Disabled'} "${row.name}" on the Guest page`,
      });
      return { kind: 'saved' as const, version: nextVersion, enabled };
    });

    if (outcome.kind === 'missing') return sendFail(reply, 'not_found', 'That building type does not exist.');
    if (outcome.kind === 'stale') {
      return sendFail(reply, 'conflict', `This type was just changed (now version ${outcome.version}). Reload.`);
    }
    return sendOk(reply, { id: request.params.id, version: outcome.version, enabled: outcome.enabled });
  });

  /**
   * Put the given ids in this order, 10 apart, in one transaction.
   *
   * `10, 20, 30…` rather than `1, 2, 3…` so a later single insert can take a gap without renumbering
   * everything — the same reason the seeds are tens apart.
   */
  app.post('/admin/guest-types/reorder', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const body = parseBody(guestBuildingTypeReorderSchema, request.body, reply);
    if (body === null) return;

    const outcome = await db.transaction(async (tx) => {
      if (await tableIsEmpty(tx)) await seedDefaults(tx, session.email, session.userId);

      const known = await tx.all<{ id: string }>('SELECT id FROM guest_building_types');
      const knownIds = new Set(known.map((r) => r.id));
      const unknown = body.ids.filter((id) => !knownIds.has(id));
      if (unknown.length > 0) return { kind: 'unknown' as const, unknown };

      const at = now();
      for (const [index, id] of body.ids.entries()) {
        await tx.run(
          `UPDATE guest_building_types
              SET sort_order = ?, version = version + 1, updated_by = ?, updated_at = ?
            WHERE id = ?`,
          [(index + 1) * 10, session.email, at, id],
        );
      }
      await audit(tx, {
        actorId: session.userId,
        actorEmail: session.email,
        action: 'guest_type.reorder',
        targetType: 'guest_building_type',
        targetId: '*',
        summary: `Reordered the Guest building types: ${body.ids.join(', ')}`,
      });
      return { kind: 'saved' as const };
    });

    if (outcome.kind === 'unknown') {
      return sendFail(reply, 'validation_failed', `Unknown building type: ${outcome.unknown.join(', ')}`);
    }
    return sendOk(reply, { ids: body.ids });
  });
}
