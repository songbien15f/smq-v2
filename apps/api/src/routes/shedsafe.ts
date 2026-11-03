/**
 * ShedSafe site checks: pin a building, read the certified wind rating back.
 *
 * ## The honest shape of this feature
 *
 * ShedSafe issues a certificate through the **manufacturer's own account**. This product cannot issue
 * one, and the screen says so. What it does is what the desktop did: hand the operator a link into
 * their ShedSafe account to finish the check, then read the six certified numbers back so the quote
 * is priced against a real rating.
 *
 * ## What is deliberately different from the licence server
 *
 * The old server's ShedSafe endpoints had **no authentication** and its credentials were hard-coded
 * in the repository. Here every route is behind this product's session and a capability, the
 * credentials come from the environment, and the bearer token is cached rather than re-fetched.
 *
 * ## Why the check is stored, not just returned
 *
 * A rating is a fact about a **site**, and a dealer quotes several buildings on one block. Storing it
 * lets a second quote reuse the certificate, and lets a re-import update the site without touching
 * any frozen revision — a revision records the values it was priced with, which is the whole point
 * of freezing it.
 */

import type { FastifyInstance } from 'fastify';
import { newId, now } from '@sq/db';
import { z } from 'zod';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import {
  ShedSafeError,
  ShedSafeNotConfigured,
  createShedSafeTransport,
  shedsafeConfigured,
  type ShedSafeTransport,
} from '../lib/shedsafe.js';
import type { Db } from '@sq/db';

/** What the operator supplies to pin a site. Dimensions arrive in millimetres and are sent in metres. */
const pinRequest = z
  .object({
    siteAddress: z.object({
      addressLine1: z.string().trim().min(1).max(255),
      suburb: z.string().trim().max(100).default(''),
      state: z.string().trim().max(10).default(''),
      postcode: z.string().trim().max(10).default(''),
    }),
    client: z.object({
      firstName: z.string().trim().max(100).default(''),
      lastName: z.string().trim().max(100).default(''),
      email: z.string().trim().max(255).default(''),
    }),
    /** Millimetres, as the editor holds them. */
    heightMm: z.number().int().min(1000).max(20000),
    spanMm: z.number().int().min(1000).max(40000),
    lengthMm: z.number().int().min(1000).max(120000),
    importanceLevel: z.number().int().min(1).max(4).default(2),
    /** Reuse an existing check rather than pinning a second building for the same site. */
    reference: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

/** A row of the table, as the screen reads it. */
interface SiteCheckRow {
  id: string;
  building_id: string | null;
  reference: string;
  site_link: string | null;
  importance_level: number | null;
  wind_region: string | null;
  terrain_category: number | null;
  building_class: string | null;
  snow_load: number | null;
  design_wind_speed: number | null;
  status: string;
  last_error: string | null;
  pinned_at: string;
  imported_at: string | null;
}

/** What a screen gets back. camelCase, and the six fields grouped so a UI can label them together. */
function toView(row: SiteCheckRow) {
  return {
    id: row.id,
    buildingId: row.building_id,
    reference: row.reference,
    siteLink: row.site_link,
    status: row.status,
    lastError: row.last_error,
    pinnedAt: row.pinned_at,
    importedAt: row.imported_at,
    values: {
      importanceLevel: row.importance_level === null ? null : Number(row.importance_level),
      windRegion: row.wind_region,
      terrainCategory: row.terrain_category === null ? null : Number(row.terrain_category),
      buildingClass: row.building_class,
      snowLoad: row.snow_load === null ? null : Number(row.snow_load),
      designWindSpeed: row.design_wind_speed === null ? null : Number(row.design_wind_speed),
    },
  };
}

/** A reference ShedSafe will accept and a person can recognise: `SC-20261102-143012`. */
function newReference(): string {
  const at = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `SC-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

/**
 * Build the transport from the environment, or `null` when credentials are not set.
 *
 * **The credentials live in `.env` and nowhere else** — they are deployment secrets, not settings.
 * There is no screen for them, so there is no row to leak and no audit trail of who typed them.
 * Changing them means editing the environment and restarting, which is the right amount of friction
 * for a credential that spends money on every request.
 */
function transport(): ShedSafeTransport | null {
  if (!shedsafeConfigured()) return null;
  const username = (process.env.SHEDSAFE_USERNAME as string).trim();
  const password = (process.env.SHEDSAFE_PASSWORD as string).trim();
  const baseUrl =
    (process.env.SHEDSAFE_BASE_URL as string)?.trim() || 'https://api.sitecheck.shedsafe.com.au/v1';
  return createShedSafeTransport({ username, password, baseUrl });
}

export function registerShedSafe(app: FastifyInstance, db: Db): void {
  /** The check for a quote's site, or `null`. Read-only, so a viewer may see it. */
  app.get<{ Params: { quoteId: string } }>('/quotes/:quoteId/site-check', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return;

    const configured = transport() !== null;
    const row = await db.get<SiteCheckRow & { site_check_id: string | null }>(
      `SELECT sc.*, sc.id AS site_check_id
         FROM quotes q
         LEFT JOIN site_checks sc ON sc.id = q.site_check_id
        WHERE q.id = ? AND q.tenant_id = ?`,
      [request.params.quoteId, session.tenantId],
    );

    // A quote with no check is not an error: it is a quote whose wind fields were typed by hand.
    if (row === null || row.site_check_id === null) {
      return sendOk(reply, { configured, check: null });
    }

    return sendOk(reply, { configured, check: toView(row) });
  });

  /**
   * Pin the site: create the building at ShedSafe and return the link to finish the check.
   *
   * The link is the deliverable. ShedSafe's own web UI is where the map pin and the AutoCalc happen;
   * this product cannot do them, and pretending otherwise would produce a quote with no certificate
   * behind it.
   */
  app.post<{ Params: { quoteId: string } }>('/quotes/:quoteId/site-check/pin', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const shedSafe = transport();
    if (shedSafe === null) {
      return sendFail(reply, 'not_configured', new ShedSafeNotConfigured().message);
    }

    const body = parseBody(pinRequest, request.body, reply);
    if (body === null) return;

    const tenantId = session.tenantId as string;
    const quote = await db.get<{ id: string; site_check_id: string | null }>(
      'SELECT id, site_check_id FROM quotes WHERE id = ? AND tenant_id = ?',
      [request.params.quoteId, tenantId],
    );
    if (quote === null) return sendFail(reply, 'not_found', 'Not found.');

    const reference = body.reference ?? newReference();
    const at = now();

    try {
      const pinned = await shedSafe.pin({
        reference,
        siteAddress: body.siteAddress,
        client: body.client,
        // ShedSafe takes metres; the editor holds millimetres.
        height: body.heightMm / 1000,
        span: body.spanMm / 1000,
        length: body.lengthMm / 1000,
        importanceLevel: body.importanceLevel,
      });

      const existing = await db.get<{ id: string }>(
        'SELECT id FROM site_checks WHERE tenant_id = ? AND reference = ?',
        [tenantId, reference],
      );

      const checkId = existing === null ? newId() : existing.id;
      if (existing === null) {
        await db.run(
          `INSERT INTO site_checks (id, tenant_id, building_id, reference, site_link, status, pinned_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pinned', ?, ?)`,
          [checkId, tenantId, pinned.buildingId, reference, pinned.siteLink, at, at],
        );
      } else {
        // A retry updates the same row, so the quote keeps pointing at one check rather than
        // collecting one per attempt.
        await db.run(
          `UPDATE site_checks SET building_id = ?, site_link = ?, status = 'pinned', last_error = NULL, updated_at = ?
            WHERE id = ?`,
          [pinned.buildingId, pinned.siteLink, at, checkId],
        );
      }

      // The quote now points at the check, so a second quote on the same site can reuse it.
      await db.run('UPDATE quotes SET site_check_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [
        checkId,
        at,
        quote.id,
        tenantId,
      ]);

      const row = await db.get<SiteCheckRow>('SELECT * FROM site_checks WHERE id = ?', [checkId]);
      return sendOk(reply, { check: row === null ? null : toView(row), locked: pinned.locked }, 201);
    } catch (error) {
      /*
       * A failure is recorded on the row, not only returned.
       *
       * An operator who pins, sees an error and comes back an hour later needs to know the last
       * attempt failed and why — otherwise they re-run it blindly and cannot tell a new failure from
       * the old one.
       */
      const message = error instanceof ShedSafeError ? error.message : 'ShedSafe could not be reached.';

      const existing = await db.get<{ id: string }>(
        'SELECT id FROM site_checks WHERE tenant_id = ? AND reference = ?',
        [tenantId, reference],
      );
      if (existing !== null) {
        await db.run("UPDATE site_checks SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", [
          message,
          at,
          existing.id,
        ]);
      }

      return sendFail(reply, 'internal', message);
    }
  });

  /**
   * Import the certified rating.
   *
   * Read-only against ShedSafe: this never writes to their side. A building that has been pinned but
   * not calculated comes back with no values, and the answer says so — a wind region of `0` would be
   * a value nobody certified.
   */
  app.post<{ Params: { quoteId: string } }>('/quotes/:quoteId/site-check/import', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const shedSafe = transport();
    if (shedSafe === null) {
      return sendFail(reply, 'not_configured', new ShedSafeNotConfigured().message);
    }

    const tenantId = session.tenantId as string;
    const quote = await db.get<{ site_check_id: string | null }>(
      'SELECT site_check_id FROM quotes WHERE id = ? AND tenant_id = ?',
      [request.params.quoteId, tenantId],
    );
    if (quote === null) return sendFail(reply, 'not_found', 'Not found.');
    if (quote.site_check_id === null) {
      return sendFail(reply, 'conflict', 'This quote has no site check yet. Pin the site first.');
    }

    const check = await db.get<SiteCheckRow>('SELECT * FROM site_checks WHERE id = ? AND tenant_id = ?', [
      quote.site_check_id,
      tenantId,
    ]);
    if (check === null) return sendFail(reply, 'not_found', 'Not found.');
    if (check.building_id === null) {
      return sendFail(reply, 'conflict', 'The site check has no ShedSafe building id yet. Pin the site again.');
    }

    const at = now();

    try {
      const values = await shedSafe.read(check.building_id);

      if (values === null) {
        await db.run(
          "UPDATE site_checks SET status = 'pinned', last_error = ?, updated_at = ? WHERE id = ?",
          ['ShedSafe has not calculated this building yet. Finish the check in ShedSafe, then import again.', at, check.id],
        );
        return sendFail(
          reply,
          'conflict',
          'ShedSafe has not calculated this building yet. Finish the check in ShedSafe, then import again.',
        );
      }

      await db.run(
        `UPDATE site_checks
            SET importance_level = ?, wind_region = ?, terrain_category = ?, building_class = ?,
                snow_load = ?, design_wind_speed = ?, status = 'imported', last_error = NULL,
                imported_at = ?, updated_at = ?
          WHERE id = ?`,
        [
          values.importanceLevel,
          values.windRegion,
          values.terrainCategory,
          values.buildingClass,
          values.snowLoad,
          values.designWindSpeed,
          at,
          at,
          check.id,
        ],
      );

      const row = await db.get<SiteCheckRow>('SELECT * FROM site_checks WHERE id = ?', [check.id]);
      return sendOk(reply, { check: row === null ? null : toView(row) });
    } catch (error) {
      const message = error instanceof ShedSafeError ? error.message : 'ShedSafe could not be reached.';
      await db.run("UPDATE site_checks SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", [
        message,
        at,
        check.id,
      ]);
      return sendFail(reply, 'internal', message);
    }
  });
}
