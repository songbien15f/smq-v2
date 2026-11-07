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

import type { FastifyInstance, FastifyReply } from 'fastify';
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
      /*
       * Required, because ShedSafe requires it.
       *
       * Measured against the live API on 2026-11-06: an empty suburb comes back as *"An invalid
       * argument was supplied. The SuburbName field is required."* — a sentence that names a field
       * by its wire spelling, on a screen that shows "Suburb". So the refusal happens here, in words
       * that match the form.
       */
      suburb: z
        .string()
        .trim()
        .min(1, 'ShedSafe needs the site suburb. Fill it in above, then pin the site.')
        .max(100),
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
    /**
     * Who is doing the check, as ShedSafe shows it on their side.
     *
     * **Required, and that is not a preference of ours.** ShedSafe answers an empty value with
     * *"The Salesman field is required."* — measured against the live API on 2026-11-06, after this
     * route passed the desktop's literal `Salesman = ""` straight through and the pin failed with a
     * message that named nothing on our screen.
     *
     * Free text rather than an account: the licence server kept a 72-column `Salesman` table because
     * it managed buildings by a franchise's staff, and none of that survives into a quoting product.
     */
    salesman: z
      .string()
      .trim()
      .min(1, 'Who is doing the site check? ShedSafe requires a salesperson name.')
      .max(200),
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
  /** The site's geographic readings, as JSON. `null` for a check imported before this existed. */
  detail_json: string | null;
}

/** What a screen gets back. camelCase, and the six fields grouped so a UI can label them together. */
function toView(row: SiteCheckRow) {
  const detail = row.detail_json === null ? null : (JSON.parse(row.detail_json) as Record<string, unknown>);
  /*
   * The raw readings ShedSafe returned before Auto Calc, kept apart from the six that price.
   *
   * They are shown so an operator can see the site was reached and what ShedSafe currently thinks,
   * and they are **never** written into the pricing columns — a quote priced from a raw
   * `topographicFactor` is a quote against a rating nobody issued.
   */
  const provisional =
    detail !== null && typeof detail.provisional === 'object' && detail.provisional !== null
      ? (detail.provisional as Record<string, unknown>)
      : null;

  return {
    id: row.id,
    buildingId: row.building_id,
    reference: row.reference,
    siteLink: row.site_link,
    status: row.status,
    lastError: row.last_error,
    pinnedAt: row.pinned_at,
    importedAt: row.imported_at,
    /**
     * True only when ShedSafe has Auto Calculated the building and reported no error.
     *
     * The one property that answers the question. `windRegion` is populated **before** Auto Calc, so
     * a screen that inferred "calculated" from a non-empty wind region would be wrong on exactly the
     * sites that matter.
     */
    calculated: row.status === 'imported',
    /** The raw readings, when a check has been read but not calculated. `null` otherwise. */
    provisional,
    values: {
      importanceLevel: row.importance_level === null ? null : Number(row.importance_level),
      windRegion: row.wind_region,
      terrainCategory: row.terrain_category === null ? null : Number(row.terrain_category),
      buildingClass: row.building_class,
      snowLoad: row.snow_load === null ? null : Number(row.snow_load),
      designWindSpeed: row.design_wind_speed === null ? null : Number(row.design_wind_speed),
    },
    /*
     * The site's geographic readings, separate from the six that drive the design.
     *
     * Two groups because they answer two questions: `values` is what the engine priced from, and
     * `site` is what the certificate says about the place. A screen that mixed them would suggest
     * the elevation affects the price, which it does not.
     *
     * `detail_json` also carries `salesman` and `provisional`, which are **not** readings — passing
     * the whole blob through made the screen print "Shielding: undefined", because it read keys that
     * were never there. Only the readings come out here; the other two are surfaced by name.
     */
    site:
      detail === null
        ? null
        : {
            shielding: detail.shielding ?? null,
            topographicFactor: detail.topographicFactor ?? null,
            snowLoadRegion: detail.snowLoadRegion ?? null,
            earthquakeHazardFactor: detail.earthquakeHazardFactor ?? null,
            elevation: detail.elevation ?? null,
            latitude: detail.latitude ?? null,
            longitude: detail.longitude ?? null,
            rainfallIntensity100Years: detail.rainfallIntensity100Years ?? null,
            rainfallIntensity20Years: detail.rainfallIntensity20Years ?? null,
            rainfallIntensityTown: detail.rainfallIntensityTown ?? null,
          },
    /** Who asked for the check, as recorded at pin time. */
    salesman: typeof detail?.salesman === 'string' ? detail.salesman : null,
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
/**
 * Import a ShedSafe building into a site-check row, and refuse it until it has been calculated.
 *
 * ## One implementation for two routes
 *
 * `POST /quotes/:id/site-check/import` and `POST /site-checks/:id/import` differ only in how they
 * find the check. The **guard** is the reason they must share the rest: a second copy is how one of
 * them would come to skip it.
 *
 * ## Why the guard exists at all
 *
 * ShedSafe answers with the wind fields whether or not the operator has pressed **Auto Calc** on its
 * own web app, and the pre-calculation values are raw — `topographicFactor` and `vSite1` above all.
 * Accepting them prices a building against a rating nobody issued, and every screen still says the
 * check succeeded. The desktop's own comment records that this happened to it:
 *
 * > *"Without this, the app silently accepts raw/uncalculated values (e.g. wrong topographicFactor /
 * > vSite1) and reports success, corrupting the structural design."*
 *
 * It keys off `autoCalc` **and** an empty `errorMessage`, exactly as the desktop does — **not** on
 * whether the values look plausible, and not on `windRegion`, which ShedSafe fills in before Auto
 * Calc runs and would therefore pass as "calculated".
 *
 * ## What the operator is told
 *
 * The refusal names the one action they can take. "Not calculated" alone sends them back to the app
 * to guess; "open the site link and run Auto Calc" is the fix.
 */
async function importIntoCheck(
  reply: FastifyReply,
  db: Db,
  shedSafe: ShedSafeTransport,
  check: SiteCheckRow,
): Promise<unknown> {
  const at = now();
  // A check with no building id never reached ShedSafe; calling read would ask for `undefined`.
  const buildingId = check.building_id;
  if (buildingId === null) {
    return sendFail(reply, 'conflict', 'The site check has no ShedSafe building id yet. Pin the site again.');
  }

  try {
    const result = await shedSafe.read(buildingId);

    if (result === null) {
      const message = 'ShedSafe has no building with that id. Pin the site again.';
      await db.run(
        "UPDATE site_checks SET status = 'pinned', last_error = ?, updated_at = ? WHERE id = ?",
        [message, at, check.id],
      );
      return sendFail(reply, 'conflict', message);
    }

    if (!result.calculated) {
      /*
       * **Read, but do not price.** The operator asked for the site's data and ShedSafe has some —
       * refusing the whole call left them staring at "not calculated" with no idea whether the
       * building had even been reached. So the raw readings are stored under `provisional` and
       * returned, and the six columns that price the quote stay **null**.
       *
       * That split is the whole point. `windRegion` and `terrainCategory` are populated before Auto
       * Calc, so writing them here would price the building against a rating nobody issued — the
       * exact defect the desktop's own comment records. A screen can show a provisional number; the
       * engine must not read one.
       */
      const message =
        result.errorMessage !== null && result.errorMessage !== ''
          ? `ShedSafe reported a problem with this building: ${result.errorMessage}`
          : 'This site has not been Auto Calculated in ShedSafe yet, so its wind rating is not issued. ' +
            'Open the site link, pin the location and run Auto Calc, then check again.';

      const prior = await db.get<{ detail_json: string | null }>(
        'SELECT detail_json FROM site_checks WHERE id = ?',
        [check.id],
      );
      const existingDetail: Record<string, unknown> =
        prior?.detail_json == null ? {} : (JSON.parse(prior.detail_json) as Record<string, unknown>);

      await db.run(
        "UPDATE site_checks SET status = 'pinned', last_error = ?, detail_json = ?, updated_at = ? WHERE id = ?",
        [
          message,
          JSON.stringify({ ...existingDetail, provisional: result.values }),
          at,
          check.id,
        ],
      );

      const row = await db.get<SiteCheckRow>('SELECT * FROM site_checks WHERE id = ?', [check.id]);
      /*
       * 200, not 409. The call succeeded: it read the building and reported what ShedSafe says. The
       * *rating* is not issued, and `calculated: false` plus `lastError` say so — a status code
       * cannot carry that distinction, and a 409 made the screen treat a normal state as a failure.
       */
      return sendOk(reply, { check: row === null ? null : toView(row) });
    }

    const v = result.values;
    await db.run(
      `UPDATE site_checks
          SET importance_level = ?, wind_region = ?, terrain_category = ?, building_class = ?,
              snow_load = ?, design_wind_speed = ?, status = 'imported', last_error = NULL,
              imported_at = ?, updated_at = ?
        WHERE id = ?`,
      [
        v.importanceLevel,
        v.windRegion,
        v.terrainCategory,
        v.buildingClass,
        v.snowLoad,
        v.designWindSpeed,
        at,
        at,
        check.id,
      ],
    );

    /*
     * The seven geographic parameters go into `detail_json` rather than columns of their own.
     *
     * They describe the **site**, not the quote's structural inputs: nothing prices from them, and a
     * column per reading would mean a migration each time a rating body adds one. They are stored so
     * a quote can be read against the certificate it was issued under, which is the question an
     * engineer asks — not so the engine can compute from them.
     */
    /*
     * **Merge, do not replace.** `detail_json` already holds the salesman recorded at pin time, and
     * writing a fresh object would delete it — the check would lose who asked for it the moment it
     * was imported, which is exactly when somebody wants to know.
     */
    const prior = await db.get<{ detail_json: string | null }>(
      'SELECT detail_json FROM site_checks WHERE id = ?',
      [check.id],
    );
    const existingDetail: Record<string, unknown> =
      prior?.detail_json == null ? {} : (JSON.parse(prior.detail_json) as Record<string, unknown>);

    await db.run('UPDATE site_checks SET detail_json = ? WHERE id = ?', [
      JSON.stringify({
        ...existingDetail,
        /*
         * The provisional block is **dropped** here, because it is no longer provisional: the six
         * columns above now hold the certified figures. Keeping it would leave a screen free to show
         * a stale raw number beside a real one and invite somebody to trust the wrong one.
         */
        provisional: undefined,
        shielding: v.shielding,
        topographicFactor: v.topographicFactor,
        snowLoadRegion: v.snowLoadRegion,
        earthquakeHazardFactor: v.earthquakeHazardFactor,
        elevation: v.elevation,
        latitude: v.latitude,
        longitude: v.longitude,
        rainfallIntensity100Years: v.rainfallIntensity100Years,
        rainfallIntensity20Years: v.rainfallIntensity20Years,
        rainfallIntensityTown: v.rainfallIntensityTown,
      }),
      check.id,
    ]);

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
}

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
        salesman: body.salesman,
      });

      const existing = await db.get<{ id: string }>(
        'SELECT id FROM site_checks WHERE tenant_id = ? AND reference = ?',
        [tenantId, reference],
      );

      const checkId = existing === null ? newId() : existing.id;
      // Who asked for the check, kept beside the site's readings. Not a table: the licence server's
      // 72-column `Salesman` existed to manage buildings by franchise, and a quoting product has no
      // franchise to manage. A name on the check is what a support call asks for.
      const salesperson = body.salesman === '' ? null : body.salesman;
      if (existing === null) {
        await db.run(
          `INSERT INTO site_checks (id, tenant_id, building_id, reference, site_link, status, detail_json, pinned_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pinned', ?, ?, ?)`,
          [
            checkId,
            tenantId,
            pinned.buildingId,
            reference,
            pinned.siteLink,
            salesperson === null ? null : JSON.stringify({ salesman: salesperson }),
            at,
            at,
          ],
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

    return importIntoCheck(reply, db, shedSafe, check);
  });

  /**
   * Pin a site **before the quote exists**.
   *
   * The desktop lets an operator pin and fetch the report while still filling Step 1;
   * requiring a saved quote first turns a two-minute check into save-then-edit-then-save
   * and produces a throwaway revision. The check is stored against the tenant and linked
   * to the quote when it is first saved (`POST /quotes` with `siteCheckId`).
   */
  app.post('/site-checks/pin', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const shedSafe = transport();
    if (shedSafe === null) {
      return sendFail(reply, 'not_configured', new ShedSafeNotConfigured().message);
    }

    const body = parseBody(pinRequest, request.body, reply);
    if (body === null) return;

    const tenantId = session.tenantId as string;
    const reference = body.reference ?? newReference();
    const at = now();

    try {
      const pinned = await shedSafe.pin({
        reference,
        siteAddress: body.siteAddress,
        client: body.client,
        height: body.heightMm / 1000,
        span: body.spanMm / 1000,
        length: body.lengthMm / 1000,
        importanceLevel: body.importanceLevel,
        salesman: body.salesman,
      });

      const existing = await db.get<{ id: string }>(
        'SELECT id FROM site_checks WHERE tenant_id = ? AND reference = ?',
        [tenantId, reference],
      );
      const checkId = existing === null ? newId() : existing.id;

      const salesperson = body.salesman === '' ? null : body.salesman;
      if (existing === null) {
        await db.run(
          `INSERT INTO site_checks
             (id, tenant_id, building_id, reference, site_link, status, detail_json, pinned_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pinned', ?, ?, ?)`,
          [
            checkId,
            tenantId,
            pinned.buildingId,
            reference,
            pinned.siteLink,
            salesperson === null ? null : JSON.stringify({ salesman: salesperson }),
            at,
            at,
          ],
        );
      } else {
        await db.run(
          `UPDATE site_checks SET building_id = ?, site_link = ?, status = 'pinned', last_error = NULL, updated_at = ?
            WHERE id = ?`,
          [pinned.buildingId, pinned.siteLink, at, checkId],
        );
      }

      const row = await db.get<SiteCheckRow>('SELECT * FROM site_checks WHERE id = ?', [checkId]);
      return sendOk(reply, { check: row === null ? null : toView(row), locked: pinned.locked }, 201);
    } catch (error) {
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

  /** Import the rating for a check that is not tied to a quote yet. */
  app.post<{ Params: { checkId: string } }>('/site-checks/:checkId/import', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const shedSafe = transport();
    if (shedSafe === null) {
      return sendFail(reply, 'not_configured', new ShedSafeNotConfigured().message);
    }

    const tenantId = session.tenantId as string;
    const check = await db.get<SiteCheckRow>(
      'SELECT * FROM site_checks WHERE id = ? AND tenant_id = ?',
      [request.params.checkId, tenantId],
    );
    if (check === null) return sendFail(reply, 'not_found', 'Not found.');
    if (check.building_id === null) {
      return sendFail(reply, 'conflict', 'The site check has no ShedSafe building id yet. Pin the site again.');
    }

    return importIntoCheck(reply, db, shedSafe, check);
  });
}
