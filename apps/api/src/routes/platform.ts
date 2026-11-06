/**
 * The vendor's remaining screens: releases, the template catalogue, and usage.
 *
 * ## Releases
 *
 * The licence server published a desktop **installer** with a force-update flag. A web product has no
 * installer — every user is on the deployed build the moment it ships — so that machinery would be a
 * distribution system for a distribution that does not happen. What survives is the question a
 * support call asks: *what is this deployment running, and what changed?*
 *
 * ## Templates
 *
 * The catalogue existed as three empty tables. A template clones **structure and options**, never the
 * customer's identity, and it drops the ShedSafe building id — a new quote must not inherit another
 * site's wind certificate. That rule is the whole feature, so it is enforced here rather than left to
 * the screen.
 *
 * ## Usage
 *
 * `usage_events` had never been written. See `lib/usage.ts` for what is recorded and what is
 * deliberately not.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { z } from 'zod';
import { normaliseShedConfig } from '@sq/core/domain';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability, requirePlatformCapability } from '../lib/guard.js';
import { ENGINE_VERSION } from '@sq/core/estimating';

/** Publish a release. */
const releaseRequest = z
  .object({
    label: z.string().trim().min(1).max(40),
    note: z.string().trim().max(2000).default(''),
    priceBookHash: z.string().length(64).nullable().default(null),
    /** Make this the running release. Exactly one row carries it. */
    makeCurrent: z.boolean().default(true),
  })
  .strict();

/** Author a template from a quote, or by hand. */
const templateRequest = z
  .object({
    code: z.string().trim().min(2).max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().trim().min(1).max(200),
    typeCode: z.string().trim().min(1).max(40),
    /** The building to clone. Copied as structure only — see the note on identity below. */
    config: z.unknown(),
    note: z.string().trim().max(500).default(''),
  })
  .strict();

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  status: string;
  type_code: string;
  type_name: string;
  config_json: string | null;
  clone_count: number;
  created_at: string;
  updated_at: string;
  active_file_label: string | null;
  file_revisions: number;
}

export function registerPlatform(app: FastifyInstance, db: Db): void {
  /* ------------------------------------------------------------------ releases */

  app.get('/admin/releases', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:versions');
    if (session === null) return;

    const rows = await db.all<{
      id: string;
      label: string;
      engine_version: number;
      price_book_hash: string | null;
      note: string;
      current: number;
      created_at: string;
      created_by: string | null;
    }>('SELECT * FROM releases ORDER BY created_at DESC LIMIT 100');

    return sendOk(reply, {
      items: rows.map((row) => ({
        id: row.id,
        label: row.label,
        engineVersion: Number(row.engine_version),
        priceBookHash: row.price_book_hash,
        note: row.note,
        current: Number(row.current) === 1,
        createdAt: row.created_at,
        createdBy: row.created_by,
      })),
    });
  });

  /**
   * Record a release, and optionally make it the running one.
   *
   * `current` is exclusive by construction: the update clears every other row in the same
   * transaction. Two "current" releases would make the one question this table answers unanswerable.
   */
  app.post('/admin/releases', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:versions');
    if (session === null) return;

    const body = parseBody(releaseRequest, request.body, reply);
    if (body === null) return;

    const id = newId();
    const at = now();

    try {
      await db.transaction(async (tx) => {
        if (body.makeCurrent) await tx.run('UPDATE releases SET current = 0 WHERE current = 1');

        await tx.run(
          `INSERT INTO releases (id, label, engine_version, price_book_hash, note, current, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, body.label, ENGINE_VERSION, body.priceBookHash, body.note, body.makeCurrent ? 1 : 0, at, session.email],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|duplicate key/i.test(message)) {
        return sendFail(reply, 'conflict', `A release called "${body.label}" already exists.`);
      }
      throw error;
    }

    return sendOk(reply, { id, label: body.label, current: body.makeCurrent }, 201);
  });

  /* ----------------------------------------------------------------- templates */

  /** The catalogue. A company sees active templates; the vendor sees all of them. */
  app.get('/admin/templates', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:templates');
    if (session === null) return;

    /*
     * The file columns come along, because the catalogue screen has to say whether a template can
     * actually be downloaded. A template with a `config_json` and no `.sqd` clones inside this
     * product but cannot be handed to a company's desktop — and a list that does not show which is
     * which invites the operator to find out from a support call.
     */
    const rows = await db.all<TemplateRow>(
      `SELECT t.id, t.code, t.name, t.status, t.config_json, t.clone_count, t.created_at, t.updated_at,
              ty.code AS type_code, ty.name AS type_name,
              f.version_label AS active_file_label,
              (SELECT COUNT(*) FROM quote_template_files c WHERE c.template_id = t.id) AS file_revisions
         FROM quote_templates t
         JOIN template_types ty ON ty.id = t.type_id
         LEFT JOIN quote_template_files f ON f.id = t.active_file_revision_id
        ORDER BY t.sort_order, t.name`,
    );

    return sendOk(reply, {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        typeCode: row.type_code,
        typeName: row.type_name,
        cloneCount: Number(row.clone_count),
        hasConfig: row.config_json !== null,
        activeFileLabel: row.active_file_label,
        fileRevisions: Number(row.file_revisions ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  });

  /**
   * Author a template from a building.
   *
   * **What is copied and what is not** is the whole feature: the config is normalised and stored, and
   * nothing else from the source quote travels — no customer, no site, no ShedSafe id. A template that
   * carried a building id would give every clone another site's wind certificate, which is a claim
   * about a site the new quote is not on.
   */
  app.post('/admin/templates', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:templates');
    if (session === null) return;

    const body = parseBody(templateRequest, request.body, reply);
    if (body === null) return;

    const type = await db.get<{ id: string }>('SELECT id FROM template_types WHERE code = ?', [body.typeCode]);
    if (type === null) return sendFail(reply, 'validation_failed', `Unknown template type: ${body.typeCode}`);

    const config = normaliseShedConfig(body.config);
    const id = newId();
    const at = now();

    try {
      await db.run(
        `INSERT INTO quote_templates
           (id, code, name, type_id, status, basic_config_json, config_json, clone_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)`,
        [
          id,
          body.code,
          body.name,
          type.id,
          // The display basics, as the catalogue list shows them.
          JSON.stringify({ span: config.span, length: config.length, height: config.height, bays: config.bays }),
          JSON.stringify(config),
          at,
          at,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|duplicate key/i.test(message)) {
        return sendFail(reply, 'conflict', `A template with the code "${body.code}" already exists.`);
      }
      throw error;
    }

    return sendOk(reply, { id, code: body.code, name: body.name }, 201);
  });

  /** Archive or reactivate a template. Never deleted: a clone that used it still points at it. */
  app.patch<{ Params: { templateId: string } }>('/admin/templates/:templateId', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:templates');
    if (session === null) return;

    const record = (request.body ?? {}) as Record<string, unknown>;
    const status = record.status;
    if (status !== 'active' && status !== 'archived' && status !== 'draft') {
      return sendFail(reply, 'validation_failed', 'Status must be active, archived or draft.');
    }

    const changed = await db.run('UPDATE quote_templates SET status = ?, updated_at = ? WHERE id = ?', [
      status,
      now(),
      request.params.templateId,
    ]);
    if (changed.changes === 0) return sendFail(reply, 'not_found', 'Not found.');

    return sendOk(reply, { status });
  });

  /**
   * The templates a company may clone, with their building.
   *
   * A company route rather than a platform one: cloning is the shed company's act, and the catalogue
   * is what the vendor published for them.
   */
  app.get('/templates', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const rows = await db.all<TemplateRow>(
      `SELECT t.id, t.code, t.name, t.status, t.config_json, t.clone_count, t.created_at, t.updated_at,
              ty.code AS type_code, ty.name AS type_name
         FROM quote_templates t
         JOIN template_types ty ON ty.id = t.type_id
        WHERE t.status = 'active'
        ORDER BY t.name`,
    );

    return sendOk(reply, {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        typeName: row.type_name,
        // The building, ready to seed an editor. `null` for a template authored without one.
        config: row.config_json === null ? null : JSON.parse(row.config_json),
      })),
    });
  });

  /**
   * Count a clone.
   *
   * A separate call from the read, so the count reflects actual use rather than how many people
   * opened the catalogue. A catalogue nobody clones is a catalogue to prune, and without this there
   * is no way to know.
   */
  app.post<{ Params: { templateId: string } }>('/templates/:templateId/cloned', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    await db.run('UPDATE quote_templates SET clone_count = clone_count + 1 WHERE id = ?', [
      request.params.templateId,
    ]);
    return sendOk(reply, { counted: true });
  });
}
