/**
 * Typed lookups over the imported price book.
 *
 * This module is where dollars become cents. Everything above it works in whole
 * cents, so a rounding mistake can only happen here, once, where a test can see
 * it.
 *
 * Every statement is prepared once per lookup instance: the BOM asks the same
 * questions hundreds of times per quote, and preparing per call would dominate
 * the cost of building one.
 */

import type { DatabaseSync } from 'node:sqlite';
import { SOURCE_BY_NAME, buildRowKey, rowKeyOf } from './rowKeys';
import type {
  BracingRow,
  ColourRow,
  DevidedRow,
  DoorKind,
  FrameScheduleQuery,
  PackRow,
  PriceLookup,
  PriceRow,
  SheetingRow,
} from './types';
/** Dollars from the price book → whole cents. */
function cents(dollars: unknown): number {
  const value = typeof dollars === 'number' ? dollars : Number(dollars);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** A numeric column, or 0 when it is missing or unreadable. */
function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A string column, or '' when it is missing. */
function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The purlin family suffix the bracket names use: `Z15019` → `Z150`,
 * `TH64075` → `TH64`, `TH120100` → `TH120`.
 *
 * The material code packs the depth and the thickness together with no
 * separator, and the two families pack them differently — `Z15019` is a 150 deep
 * by 1.9, `TH64075` is a 64 deep by 0.75 — so position-based parsing cannot serve
 * both. The book's own `depth` column is authoritative; the parse below is the
 * fallback for a book that does not carry it.
 */
function purlinSuffix(code: string, depth: number): string {
  const value = code.trim().toUpperCase();
  const family = value.startsWith('TH') ? 'TH' : value.startsWith('Z') ? 'Z' : '';
  if (family === '') return '';
  if (depth > 0) return `${family}${depth}`;
  const digits = value.slice(family.length).replace(/\D/g, '');
  // A TopHat states the thickness in three digits (`075`), a Z in two (`19`).
  const thicknessDigits = family === 'TH' ? 3 : 2;
  if (digits.length <= thicknessDigits) return '';
  return `${family}${digits.slice(0, -thicknessDigits)}`;
}

/**
 * The product code to show, falling back to a slug of the description.
 *
 * Much of the book has no product code — 621 gutter rows and every coloured roof
 * and wall screw — because those lines are cut from stock rather than ordered as
 * a catalogue item. A materials list with a blank code column is not orderable,
 * so the description is slugged into one (`115 Quad` → `115-QUAD`). It is marked
 * as derived so nobody mistakes it for a supplier code.
 */
function codeFor(code: unknown, description: string): string {
  const actual = str(code).trim();
  if (actual !== '') return actual;
  const slug = description
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug === '' ? '' : `~${slug}`;
}

/**
 * Map a frame or purlin row.
 *
 * `source` names the catalogue table the row came from, because the row key is
 * built from that table's declared identity columns. Every caller passes the
 * table its statement reads; a wrong source would produce a key that matches
 * nothing, so it is a required argument rather than something inferred.
 */
function priceRow(
  source: string,
  row: Record<string, unknown>,
  costColumn = 'cost',
): PriceRow {
  return {
    code: str(row.code),
    description: str(row.description),
    unitCost: cents(row[costColumn]),
    massKg: num(row.mass),
    rowKey: keyFor(source, row),
  };
}

/**
 * The row key, tolerant of a book that lacks one of the identity columns.
 *
 * A price book is an export from someone else's product and its columns change:
 * `colour_name` is on today's `view_cost_sheeting` and not on an older dump, and
 * a partial book may omit a column entirely. `rowKeyOf` would produce a key with
 * `undefined` for that column — a key nothing can ever match — so the missing
 * columns are simply left out of the key instead.
 *
 * Two books that differ in their columns therefore produce different keys for the
 * same item, which is correct: they are different books, and a price set against
 * one is not a price set against the other.
 */
/**
 * The infill columns a structure row describes.
 *
 * `no_M/EW` is the count **per end wall** and `M1`/`M2` are their sections, in the
 * same row as C1/R1 — one row of the book describes the whole frame, infills
 * included. The column name is not a legal identifier (it has a slash), so it is
 * quoted in the query and read here by that exact name.
 *
 * `M2` is the second section, for a design that uses two. This build prices both
 * from `M1` when only one is named, which is what the book's own designs do: the
 * shipped table has `M2` null on every row that names an `M1`.
 *
 * A count of 0 — or a missing section — is reported as `null`, not as
 * `{ count: 0 }`: "the book says this gable needs no infill" and "this build could
 * not read the row" are different answers, and only the first is safe to quote.
 */
function infillColumns(row: Record<string, unknown>): { count: number; section: string } | null {
  const count = num(row['no_M_EW']);
  if (!Number.isFinite(count) || count <= 0) return null;
  const section = str(row.M1).trim();
  if (section === '') return null;
  return { count: Math.round(count), section };
}

function keyFor(source: string, row: Record<string, unknown>): string {
  const declared = SOURCE_BY_NAME[source];
  if (declared === undefined) return rowKeyOf(source, row);
  const present = declared.identity.filter((field) => field in row);
  return buildRowKey(
    source,
    present.map((field) => [field, row[field]] as [string, unknown]),
  );
}

export function createLookup(db: DatabaseSync): PriceLookup {
  /**
   * Prepare a statement, or return `null` when its table is absent.
   *
   * The price book is imported from a dump that may not contain every table —
   * a partial dump, or a book from an older desktop build. A missing table means
   * "this kind of item has no price", which the BOM already handles as a mocked
   * line; it must not throw and take the whole quote down.
   */
  function prepare(sql: string) {
    try {
      return db.prepare(sql);
    } catch {
      return null;
    }
  }

  /**
   * True when `table` has a column called `column`.
   *
   * A price book is somebody else's schema and it changes between revisions: the
   * dump may carry a colour column or not, and a query that names a missing one
   * fails the whole statement. Asking first is what lets one code path serve
   * both books.
   */
  function hasColumn(table: string, column: string): boolean {
    try {
      const rows = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as {
        name: string;
      }[];
      return rows.some((row) => row.name === column);
    } catch {
      return false;
    }
  }

  const frameBySize = prepare(
    'SELECT code, description, cost, mass FROM cost_frame WHERE description = ? LIMIT 1',
  );
  // `devided.purlin_material` holds the material's *name* ('TH64075'), not its
  // product code ('FFT74608'), so the lookup matches on description. Matching on
  // code silently returns nothing and every frame comes back mocked.
  const purlinByCode = prepare(
    'SELECT code, description, cost, mass FROM cost_purlin WHERE description = ? LIMIT 1',
  );
  // Null on the reference book, which has no girt table at all. `prepare` catches the
  // failure, so one code path serves a book that prices girts apart and one that does
  // not — which is the whole point of returning `separate` from `girt()`.
  const girtByCode = prepare(
    'SELECT code, description, cost, mass FROM cost_girt WHERE description = ? LIMIT 1',
  );
  const sheetingByProfile = prepare(
    `SELECT * FROM view_cost_sheeting
     WHERE profile = ? AND bmt = ?
     ORDER BY id, code ASC LIMIT 1`,
  );
  // The smallest catalogue door that fits: ORDER BY width then height, take the
  // first row whose width AND height are both at least what was asked.
  //
  // Both the zinc and the painted price are needed. A door on a Colorbond shed is
  // painted, and the book prices it apart: the colour column averages 16.3% above
  // the zinc one across the 118 active roller doors. Reading only the zinc price
  // understated every painted door.
  //
  // `SELECT *` with aliases rather than a column list, for the same reason as the
  // PA door below: a book that lacks one of these columns must still price a door,
  // and a named list would fail the whole query — and so the whole quote. The mass
  // is not split by finish: a painted door weighs what a zinc one weighs.
  const rollerDoor = prepare(
    `SELECT *, rdoor_code AS code, rdoor_name AS description, price_zinc AS cost,
            price_color AS cost_color, rdoor_mass AS mass
     FROM roller_door
     WHERE isActive = 1 AND width >= ? AND height >= ?
     ORDER BY width ASC, height ASC, rdoor_code ASC LIMIT 1`,
  );
  // `SELECT *` rather than a column list: the identity is built from the row's
  // own columns, and a book that lacks one of them must still price. A named list
  // would fail the whole query — and therefore the whole quote — on a book that
  // has not got that column.
  const paDoor = prepare(
    `SELECT *, padoor_product_code AS code, padoor_name AS description,
            padoor_price_zinc AS cost, padoor_price_color AS cost_color,
            padoor_mass AS mass
     FROM padoor
     WHERE isActive = 1 AND width >= ? AND height >= ?
     ORDER BY width ASC, height ASC, padoor_product_code ASC LIMIT 1`,
  );
  // A sliding door is priced by **where it is fitted**, not by one generic
  // column: the book carries `sld_price_sidewall`, `sld_price_endwall` and
  // `sld_price_endwall_hangar`, and its `sld_price` column is zero on every one
  // of the 79 rows. Reading `sld_price` therefore quoted every sliding door at
  // nothing, and did it silently — the row was found, so the line was not even
  // marked as missing a price. All three columns are selected here and the
  // placement decides which one is the cost.
  const slidingDoor = prepare(
    `SELECT *, sld_code AS code, sld_size AS description,
            sld_mass AS mass, sld_price_sidewall, sld_price_endwall,
            sld_price_endwall_hangar
     FROM sliding_door
     WHERE sld_width >= ? AND sld_height >= ?
     ORDER BY sld_width ASC, sld_height ASC, sld_id ASC LIMIT 1`,
  );
  // A window is a catalogue item joined to its price: `material_window` states the
  // size, `cost_window` the price per colour. The smallest window that fits is
  // what a factory supplies, matching the door rule.
  const windowBySize = prepare(
    `SELECT w.code, w.description, c.cost, c.mass,
            c.id AS id, c.lyves_code AS lyves_code, c.material_window_id AS material_window_id,
            c.system_color_id AS system_color_id
     FROM material_window w
     JOIN cost_window c ON c.material_window_id = w.id
     WHERE w.is_active = 1 AND w.width >= ? AND w.height >= ?
     ORDER BY w.width ASC, w.height ASC, c.cost ASC
     LIMIT 1`,
  );
  const colourByName = prepare(
    'SELECT colour_name, colour_value FROM system_colour WHERE colour_name = ? AND colour_status = 1 LIMIT 1',
  );
  const colourByHex = prepare(
    'SELECT colour_name, colour_value FROM system_colour WHERE LOWER(colour_value) = LOWER(?) AND colour_status = 1 LIMIT 1',
  );
  const marginByStructureState = prepare(
    'SELECT price_coeffcient FROM setting_price_coeffcient WHERE structure_id = ? AND state_code = ? LIMIT 1',
  );
  // A miscellaneous option is priced per unit. `option_name` is the name a person
  // reads ('Shed Safe fee'), and the table carries no code for it, so the name is
  // the key.
  const miscOptionByName = prepare(
    `SELECT option_name AS description, product_code AS code, price AS cost, mass
     FROM misc_option
     WHERE option_name = ?
     ORDER BY indexSort ASC LIMIT 1`,
  );
  // The margin table is keyed by an integer, and this build names structures by
  // shape. `structure_sub_code` is the stable bridge: it survives a book revision
  // renaming a product line, which the display name does not.
  const structureBySubCode = prepare(
    'SELECT structure_id FROM structure_type WHERE structure_sub_code = ? LIMIT 1',
  );
  /**
   * The structure-to-section table: 2 752 rows naming the section of every frame
   * member for one combination of building size and site conditions.
   *
   * `view_system_lookup_data` is the joined view — the index columns
   * (`span`, `bay`, `height`, `wind_region`, …) alongside the member columns
   * (`C1`, `R1`, `C2`, `R2`, `KB`, `embedment`). The view also carries
   * `no_M/EW`, a column whose name is not a legal identifier; the importer
   * renames it to `no_M_EW`, so a query may name it but need not.
   *
   * Both the table and the view are tried, because a dump may carry either and a
   * book that has the table but not the view should still price a frame.
   */
  const scheduleStatement = prepare(
    `SELECT C1, C2, R1, R2, KB, embedment, "no_M_EW", M1, M2
     FROM view_system_lookup_data
     WHERE structure_code = ? AND wind_region = ? AND terrain_category = ?
       AND importance_level = ? AND internal_pressure = ?
       AND span = ? AND bay = ? AND height = ?
     ORDER BY roof_pitch_code ASC, footing_type_code ASC
     LIMIT 1`,
  );
  // The desktop accepts every row whose `standard_span` is **at least** the bay
  // and lets the cost loop pick (`DevidedLookupManager.cs:76`). An exact match
  // alone returns nothing for a bay size the table does not list — a 3.4 m bay
  // finds no 3400 row — and the whole frame falls back to the mocked minimum.
  // Whether the span table names a girt material of its own. The reference book does
  // not, so naming `girt_material` unconditionally would fail the whole statement and
  // every frame would come back mocked — a silent, total failure for one optional
  // column.
  const devidedHasGirtMaterial = hasColumn('devided', 'girt_material');
  const devidedByCode = prepare(
    `SELECT lookup_code, standard_span, purlin_span, girt_span, open_design, purlin_material${
      devidedHasGirtMaterial ? ', girt_material' : ''
    }
     FROM devided
     WHERE lookup_code = ? AND standard_span >= ?
     ORDER BY standard_span ASC, purlin_material ASC, lookup_id`,
  );
  // The region and the speed are two tables joined by `index_sort`, not by
  // position in one list: `design_wind_region` names A…D, and `design_wind_speed`
  // carries eight rows of which only the first four are regions. Reading region
  // A/B/C/D off the speed list's row order happens to work for this book and
  // silently mislabels every region in a book with a different number of rows.
  const windSpeeds = prepare(
    `SELECT r.display_name AS region, s.display_name AS speed
     FROM design_wind_region r
     JOIN design_wind_speed s ON s.index_sort = r.index_sort
     WHERE r.is_active = 1 AND s.is_active = 1
     ORDER BY r.index_sort`,
  );
  const windSpeedsByOrder = prepare(
    'SELECT display_name FROM design_wind_speed WHERE is_active = 1 ORDER BY index_sort',
  );
  const deliveryRows = prepare('SELECT delivery_name, state_value_array FROM delivery_data');
  // A gutter is priced **per colour and state**, and the book carries 68 rows for
  // one profile (34 colours × 2 states). Ordering by price and taking the first
  // row quoted the dearest: galvanised at $4.31/m on a Colorbond shed whose gutter
  // is $4.10/m, a 5% overcharge on every painted job.
  //
  // Two statements rather than one with an optional filter: a book without a
  // `color` column (an older dump) must still price a gutter, and a `WHERE ? = ''`
  // trick would fail on it. The colour-matched statement is tried first, and the
  // unqualified one is the fallback — which also covers a colour the book does not
  // list, where the painted price is the right answer rather than no price.
  const gutterBySizeAndColour = prepare(
    `SELECT gutter_product_code AS code, gutter_size AS description, gutter_price AS cost,
            gutter_mass AS mass, *
     FROM gutter
     WHERE gutter_type = 'GUTTER' AND gutter_size = ? AND color = ?
     ORDER BY gutter_price ASC, gutter_product_code ASC LIMIT 1`,
  );
  // The unqualified statement, for a colour the book does not list and for a book
  // with no `color` column at all.
  //
  // Which SQL is legal depends on the schema, so the column is checked rather
  // than assumed: a book without `color` cannot be asked to sort by it. When the
  // column is there, the painted rows come first and the galvanised ones last —
  // the cheapest painted gutter, not the cheapest gutter, which would be bare
  // Zinc and the wrong finish for a Colorbond shed.
  const gutterHasColour = hasColumn('gutter', 'color');
  const gutterBySize = prepare(
    gutterHasColour
      ? `SELECT gutter_product_code AS code, gutter_size AS description, gutter_price AS cost,
                gutter_mass AS mass, *
         FROM gutter
         WHERE gutter_type = 'GUTTER' AND gutter_size = ?
         ORDER BY CASE WHEN color LIKE '%Galv%' OR LOWER(color) = 'zinc' THEN 1 ELSE 0 END,
                  gutter_price ASC, gutter_product_code ASC
         LIMIT 1`
      : `SELECT gutter_product_code AS code, gutter_size AS description, gutter_price AS cost,
                gutter_mass AS mass, *
         FROM gutter
         WHERE gutter_type = 'GUTTER' AND gutter_size = ?
         ORDER BY gutter_price ASC, gutter_product_code ASC LIMIT 1`,
  );
  const gutterBracketBySize = prepare(
    `SELECT gutter_product_code AS code, gutter_size AS description, gutter_price AS cost,
            gutter_mass AS mass, *
     FROM gutter
     WHERE gutter_type = 'GUTTER_BRACKET' AND gutter_size = ?
     ORDER BY gutter_price ASC, gutter_product_code ASC LIMIT 1`,
  );
  // `downpipe_type` matters: the book carries an adaptor, a pop, an elbow, a
  // shoe and a trap under the same size, and a pipe run is only the `DOWNPIPE`
  // rows. Without this filter a 4-downpipe shed is priced as four elbows.
  const downpipeByKindSize = prepare(
    `SELECT downpipe_product_code AS code, downpipe_size AS description,
            downpipe_price AS cost, downpipe_mass AS mass, *
     FROM downpipe
     WHERE downpipe_kind = ? AND downpipe_size = ? AND downpipe_type = 'DOWNPIPE'
     ORDER BY downpipe_price DESC, downpipe_product_code ASC, downpipe_size ASC LIMIT 1`,
  );
  const downpipeByKind = prepare(
    `SELECT downpipe_product_code AS code, downpipe_size AS description,
            downpipe_price AS cost, downpipe_mass AS mass, *
     FROM downpipe
     WHERE downpipe_kind = ? AND downpipe_type = 'DOWNPIPE'
     ORDER BY downpipe_price DESC, downpipe_product_code ASC, downpipe_size ASC LIMIT 1`,
  );
  // Flashing is colour-matched: the same profile is 6.86 painted and 7.20
  // galvanised. Ordering by price alone silently quotes galvanised on a Colorbond
  // shed, so the colour is part of the query and a shed without a named colour
  // gets the painted price, which is what nearly every row in the book is.
  const flashingByTypeColour = prepare(
    `SELECT flashing_product_code AS code, flashing_size AS description,
            flashing_price AS cost, flashing_mass AS mass, *
     FROM flashing
     WHERE flashing_type = ? AND flashing_color = ?
     ORDER BY flashing_price ASC, flashing_product_code ASC, flashing_size ASC LIMIT 1`,
  );
  const flashingByType = prepare(
    `SELECT flashing_product_code AS code, flashing_size AS description,
            flashing_price AS cost, flashing_mass AS mass, *
     FROM flashing
     WHERE flashing_type = ?
     ORDER BY flashing_price ASC, flashing_product_code ASC, flashing_size ASC LIMIT 1`,
  );

  const bracketFamily = prepare(
    `SELECT description, code, cost, mass
     FROM cost_bracket
     WHERE description LIKE ?
     ORDER BY cost DESC, description ASC, code ASC`,
  );
  const bracketByName = prepare(
    'SELECT description, code, cost, mass FROM cost_bracket WHERE description = ? LIMIT 1',
  );
  const purlinDepthByCode = prepare(
    'SELECT depth FROM cost_purlin WHERE description = ? LIMIT 1',
  );
  /**
   * A frame section's cross-section, for the punching sheet.
   *
   * `web` is what the connector tables are keyed by — `cost_haunch` carries
   * `HP20-10` for a 20 mm web at 10° — and `depth` is what the desktop uses to
   * decide whether an infill column is deep enough to take a girt. Both come from
   * the same row as the price, so the cut list and the punch sheet describe one
   * section.
   */
  const frameGeometryBySize = prepare(
    'SELECT web, depth FROM cost_frame WHERE description = ? LIMIT 1',
  );
  /**
   * The knee-edge row: the hole offset above the eave, by pitch.
   *
   * The desktop's `KneeedgeDataAccess.FindByPitch` matches the pitch exactly and
   * builds an all-zero `MKneeedge` when it finds nothing — and a zero edge code
   * would punch a hole at the very top of the member. This returns `undefined`
   * instead, and the sheet is withheld rather than printed wrong.
   */
  const kneeEdgeByPitch = prepare(
    'SELECT haunch, apex, knee_edge_code FROM kneeedge WHERE pitch = ? LIMIT 1',
  );
  /**
   * An apex connector by rafter web and pitch: `AP20-10`.
   *
   * The desktop builds the name (`BOMQuoteUtil.getApex`: `'AP' + web + '-' + pitch`,
   * or `'HAP…'` at 30°). Asked by **name** rather than by a numeric pattern,
   * because the name is the identity — a pattern would confuse `AP15-10` with
   * `AP15-10-1.5`, which is a different plate.
   */
  const apexByName = prepare('SELECT d1, d2 FROM cost_apex WHERE description = ? LIMIT 1');
  /** A haunch connector by column web and pitch: `HP20-10`. */
  const haunchByName = prepare('SELECT d1, d2, d3 FROM cost_haunch WHERE description = ? LIMIT 1');
  // Frame plates are named for the purlin they fit, not sized by a number:
  // `EPHB15-TH64` is an eave bracket for a TH64 purlin where `15` is a size class.
  // The purlin family suffix is what selects the right row.
  const bracketByFamilyAndPurlin = prepare(
    `SELECT description, code, cost, mass
     FROM cost_bracket
     WHERE description LIKE ? AND description LIKE ?
     ORDER BY cost ASC, description ASC, code ASC`,
  );
  const bracketByFamily = prepare(
    `SELECT description, code, cost, mass
     FROM cost_bracket
     WHERE description LIKE ?
     ORDER BY cost ASC, description ASC, code ASC`,
  );
  const bracingBySize = prepare(
    'SELECT code, description, cost, mass, unit_length FROM cost_bracing WHERE description = ? LIMIT 1',
  );
  const boltByName = prepare(
    'SELECT code, description, cost_pack, mass, qty_pack FROM cost_bolt WHERE description = ? LIMIT 1',
  );
  const screwByTypeColour = prepare(
    `SELECT * FROM screws WHERE screws_type = ? AND screws_color = ? LIMIT 1`,
  );
  const screwByType = prepare(
    `SELECT * FROM screws WHERE screws_type = ? LIMIT 1`,
  );

  const windSpeedCache = new Map<string, number>();
  let windLoaded = false;

  function loadWindSpeeds(): void {
    if (windLoaded) return;
    windLoaded = true;

    // The joined form: the region table says which region each speed belongs to.
    if (windSpeeds !== null) {
      const rows = windSpeeds.all() as unknown as { region: string; speed: string }[];
      for (const row of rows) {
        const match = /([\d.]+)/.exec(str(row.speed));
        windSpeedCache.set(str(row.region).toUpperCase(), match === null ? 0 : Number(match[1]));
      }
      if (windSpeedCache.size > 0) return;
    }

    // A book without the region table: fall back to the order the speeds are
    // listed in, which is how the older books encoded A, B, C, D.
    if (windSpeedsByOrder === null) return;
    const rows = windSpeedsByOrder.all() as unknown as { display_name: string }[];
    rows.forEach((row, index) => {
      const region = String.fromCharCode('A'.charCodeAt(0) + index);
      const match = /([\d.]+)/.exec(str(row.display_name));
      windSpeedCache.set(region, match === null ? 0 : Number(match[1]));
    });
  }

  return {
    frame(size) {
      if (frameBySize === null) return undefined;
      const row = frameBySize.get(size) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : priceRow('cost_frame', row);
    },

    purlin(code) {
      if (purlinByCode === null) return undefined;
      const row = purlinByCode.get(code) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : priceRow('cost_purlin', row);
    },

    girt(code) {
      // The girt's own row, when the book sells one. `devided.purlin_material` names
      // the material for both, so with a separate girt table the caller passes the
      // girt material name and this finds it by description, exactly as `purlin()` does.
      if (girtByCode !== null) {
        const own = girtByCode.get(code) as Record<string, unknown> | undefined;
        if (own !== undefined) {
          return { row: priceRow('cost_girt', own), separate: true };
        }
      }

      // The fallback, **stated rather than hidden**. `separate: false` is what makes the
      // BOM report the quote as indicative instead of presenting a purlin's price as a
      // girt's. A girt carries different loads from a purlin; when the book cannot tell
      // them apart, the honest answer is the purlin's price *and* a caveat.
      const purlinRow = purlinByCode?.get(code) as Record<string, unknown> | undefined;
      if (purlinRow === undefined) return undefined;
      return { row: priceRow('cost_purlin', purlinRow), separate: false };
    },

    sheeting(profile, bmt) {
      if (sheetingByProfile === null) return undefined;
      const row = sheetingByProfile.get(profile, bmt) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      const base = priceRow('view_cost_sheeting', row);
      return {
        ...base,
        profile: str(row.profile),
        bmt: num(row.bmt),
        coverageMm: num(row.coverage),
        roofInternalSpanMm: num(row.roof_i_span),
        roofEndSpanMm: num(row.roof_e_span),
        wallInternalSpanMm: num(row.wall_i_span),
        wallEndSpanMm: num(row.wall_e_span),
        wallSideSpanMm: num(row.wall_s_span),
      } satisfies SheetingRow;
    },

    door(kind: DoorKind, width, height, placement) {
      const statement = kind === 'roller' ? rollerDoor : kind === 'pa' ? paDoor : slidingDoor;
      if (statement === null) return undefined;
      const row = statement.get(width, height) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      // Each door kind is a different table with a different identity, so the
      // source follows the kind rather than being inferred from the row.
      const source = kind === 'roller' ? 'roller_door' : kind === 'pa' ? 'padoor' : 'sliding_door';

      if (kind === 'sliding') {
        // A sliding door's price is a column choice, not a row choice. A hangar
        // end-wall door takes the hangar rate; any other end wall the end-wall
        // rate; a side wall the side-wall rate. Falling back to the side-wall
        // column keeps a door priced when the book has no hangar rate for its
        // size, and `undefined` — which becomes a mocked line — is reserved for a
        // row where every applicable column is empty.
        const endWall = placement?.endWall === true;
        const hangar = placement?.hangar === true;
        const column = endWall
          ? hangar
            ? 'sld_price_endwall_hangar'
            : 'sld_price_endwall'
          : 'sld_price_sidewall';
        const chosen = num(row[column]);
        const fallback =
          chosen > 0
            ? chosen
            : num(row.sld_price_sidewall) > 0
              ? num(row.sld_price_sidewall)
              : num(row.sld_price_endwall);
        if (!(fallback > 0)) return undefined;
        return {
          code: codeFor(row.code, str(row.description)),
          description: str(row.description),
          unitCost: cents(fallback),
          massKg: num(row.mass),
          rowKey: keyFor(source, row),
        };
      }

      // A painted door costs more than a zinc one, and the book states both. When
      // the caller says the door is painted, the painted column is the price; a
      // book with no painted column falls back to the zinc one rather than
      // returning nothing.
      if (kind === 'roller' || kind === 'pa') {
        const painted = placement?.painted === true;
        const colourCost = num(row.cost_color);
        const zincCost = num(row.cost);
        const chosen = painted && colourCost > 0 ? colourCost : zincCost;
        return {
          code: codeFor(row.code, str(row.description)),
          description: str(row.description),
          unitCost: cents(chosen),
          massKg: num(row.mass),
          rowKey: keyFor(source, row),
        };
      }

      return priceRow(source, row);
    },

    window(width, height) {
      if (windowBySize === null) return undefined;
      const row = windowBySize.get(width, height) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      return {
        code: codeFor(row.code, str(row.description)),
        description: str(row.description),
        unitCost: cents(row.cost),
        massKg: num(row.mass),
        // The price lives on `cost_window` (one row per colour), so the key is
        // that row's id, not the size row's.
        rowKey: rowKeyOf('cost_window', row),
      };
    },

    colour(name) {
      if (colourByName === null) return undefined;
      const row = colourByName.get(name) as
        | { colour_name: string; colour_value: string }
        | undefined;
      return row === undefined
        ? undefined
        : ({ name: str(row.colour_name), hex: str(row.colour_value) } satisfies ColourRow);
    },

    colourName(hex) {
      if (colourByHex === null) return undefined;
      const row = colourByHex.get(hex) as { colour_name: string } | undefined;
      return row === undefined ? undefined : str(row.colour_name);
    },

    margin(structureId, state) {
      if (marginByStructureState === null) return 1;
      const row = marginByStructureState.get(structureId, state) as
        | { price_coeffcient: number }
        | undefined;
      // The desktop's own fallback: no row means no markup, not an error.
      return row === undefined ? 1 : num(row.price_coeffcient) || 1;
    },

    structureId(subCode) {
      if (structureBySubCode === null) return undefined;
      const row = structureBySubCode.get(subCode) as { structure_id: number } | undefined;
      if (row === undefined) return undefined;
      const id = num(row.structure_id);
      return Number.isFinite(id) ? id : undefined;
    },

    frameSchedule(query) {
      if (scheduleStatement === null) return undefined;
      // `internal_pressure` is stored as the pair the book's own form shows
      // (`'+0.7, -0.65'` for an open building), not as a word. The mapping is the
      // book's: `design_internal_pressure.is_open` is 1 for the open pair.
      const pressure =
        query.internalPressure === 'open' ? '+0.7, -0.65' : '+0.2, -0.3';
      const row = scheduleStatement.get(
        query.structureCode,
        query.windRegion,
        query.terrainCategory,
        query.importanceLevel,
        pressure,
        query.span,
        query.bay,
        query.height,
      ) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;

      const mainColumn = str(row.C1).trim();
      const mainRafter = str(row.R1).trim();
      const endWallColumn = str(row.C2).trim();
      const endWallRafter = str(row.R2).trim();
      // A member the design does not have is `null`, not an empty string: an
      // empty section would price a line at no cost and look like a real member.
      if (mainColumn === '' || mainRafter === '') return undefined;

      const kneeBrace = str(row.KB).trim();
      const embedment = num(row.embedment);

      return {
        mainColumn,
        endWallColumn: endWallColumn === '' ? mainColumn : endWallColumn,
        mainRafter,
        endWallRafter: endWallRafter === '' ? mainRafter : endWallRafter,
        kneeBrace: kneeBrace === '' ? null : kneeBrace,
        // A negative embedment is the book's way of saying "the column stops at
        // the slab" (`footing_parameters: -12` for a pinned base), so only a
        // positive value is a length below the floor.
        embedment: Number.isFinite(embedment) && embedment > 0 ? embedment : null,
        infill: infillColumns(row),
      };
    },

    devided(code, standardSpan, openDesign) {
      if (devidedByCode === null) return [];
      const rows = devidedByCode.all(code, standardSpan) as unknown as Record<string, unknown>[];
      const mapped = rows.map((row): DevidedRow => {
        const girtMaterial = devidedHasGirtMaterial ? str(row.girt_material) : '';
        return {
          code: str(row.lookup_code),
          standardSpan: num(row.standard_span),
          purlinSpan: num(row.purlin_span),
          girtSpan: num(row.girt_span),
          openDesign: num(row.open_design) === 1,
          purlinMaterial: str(row.purlin_material),
          // Only present when the book states one, so `optimise` can tell "the book says
          // girts are X" from "the book says nothing and we assumed the purlin".
          ...(girtMaterial === '' ? {} : { girtMaterial }),
        };
      });
      return openDesign === undefined ? mapped : mapped.filter((row) => row.openDesign === openDesign);
    },

    windSpeed(region) {
      loadWindSpeeds();
      return windSpeedCache.get(region.toUpperCase()) ?? 0;
    },

    gutter(size, colour) {
      // The colour-matched row first; the unqualified one covers a book without a
      // colour column and a colour the book does not list.
      const row =
        (colour !== undefined && colour !== '' && gutterBySizeAndColour !== null
          ? (gutterBySizeAndColour.get(size, colour) as Record<string, unknown> | undefined)
          : undefined) ??
        (gutterBySize === null
          ? undefined
          : (gutterBySize.get(size) as Record<string, unknown> | undefined));
      if (row === undefined) return undefined;
      return {
        code: codeFor(row.code, `${str(row.description)} gutter`),
        description: str(row.description),
        unitCost: cents(row.cost),
        massKg: num(row.mass),
        rowKey: rowKeyOf('gutter', row),
      };
    },

    gutterBracket(size) {
      if (gutterBracketBySize === null) return undefined;
      const row = gutterBracketBySize.get(size) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      return {
        code: codeFor(row.code, `${str(row.description)} bracket`),
        description: str(row.description),
        unitCost: cents(row.cost),
        massKg: num(row.mass),
        rowKey: keyFor('gutter', row),
      };
    },

    miscOption(name) {
      if (miscOptionByName === null) return undefined;
      const row = miscOptionByName.get(name) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      return {
        code: codeFor(row.code, str(row.description)),
        description: str(row.description),
        unitCost: cents(row.cost),
        massKg: num(row.mass),
        rowKey: keyFor('misc_option', row),
      };
    },

    downpipe(kind, size) {
      if (downpipeByKindSize === null) return undefined;
      const row =
        (downpipeByKindSize.get(kind, size) as Record<string, unknown> | undefined) ??
        (downpipeByKind?.get(kind) as Record<string, unknown> | undefined);
      if (row === undefined) return undefined;
      return {
        code: codeFor(row.code, `${str(row.description)} downpipe`),
        description: str(row.description),
        unitCost: cents(row.cost),
        massKg: num(row.mass),
        rowKey: rowKeyOf('downpipe', row),
      };
    },

    flashing(type, colour) {
      if (flashingByType === null || flashingByTypeColour === null) return undefined;
      const row =
        (colour === undefined
          ? undefined
          : (flashingByTypeColour.get(type, colour) as Record<string, unknown> | undefined)) ??
        (flashingByType.get(type) as Record<string, unknown> | undefined);
      if (row === undefined) return undefined;
      return {
        code: str(row.code),
        description: str(row.description),
        unitCost: cents(row.cost),
        massKg: num(row.mass),
        rowKey: rowKeyOf('flashing', row),
      };
    },

    purlinDepth(code) {
      if (purlinDepthByCode === null) return 0;
      const row = purlinDepthByCode.get(code) as { depth: number } | undefined;
      return row === undefined ? 0 : num(row.depth);
    },

    frameGeometry(section) {
      if (frameGeometryBySize === null) return undefined;
      const row = frameGeometryBySize.get(section) as
        | { web: number; depth: number }
        | undefined;
      // A zero web is not a section — it is a row the dump could not read — so it
      // is reported as unknown rather than passed on to a connector lookup.
      if (row === undefined) return undefined;
      const web = num(row.web);
      if (web <= 0) return undefined;
      return { web, depth: num(row.depth) };
    },

    kneeEdge(pitchDeg) {
      if (kneeEdgeByPitch === null) return undefined;
      const row = kneeEdgeByPitch.get(pitchDeg) as
        | { haunch: number; apex: number; knee_edge_code: number }
        | undefined;
      if (row === undefined) return undefined;
      const code = num(row.knee_edge_code);
      // A missing edge code would punch a hole at the member's very end. Refusing
      // the row is the only answer that cannot be cut wrong.
      if (code <= 0) return undefined;
      return { kneeEdgeCode: code, apex: num(row.apex), haunch: num(row.haunch) };
    },

    apex(web, pitchDeg) {
      if (apexByName === null) return undefined;
      // The desktop's name: `AP<web>-<pitch>`, and `HAP…` at a 30° pitch.
      const name = `${pitchDeg === 30 ? 'HAP' : 'AP'}${web}-${pitchDeg}`;
      const row = apexByName.get(name) as { d1: number; d2: number } | undefined;
      if (row === undefined) return undefined;
      return { r1: num(row.d1), r2: num(row.d2) };
    },

    haunch(web, pitchDeg) {
      if (haunchByName === null) return undefined;
      const name = `${pitchDeg === 30 ? 'HAP' : 'HP'}${web}-${pitchDeg}`;
      const row = haunchByName.get(name) as { d1: number; d2: number; d3: number } | undefined;
      if (row === undefined) return undefined;
      return { e1: num(row.d1), e2: num(row.d2), e3: num(row.d3) };
    },

    bracketExact(name) {
      if (bracketByName === null) return undefined;
      const row = bracketByName.get(name) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : priceRow('cost_bracket', row);
    },

    bracket(prefix, web) {
      if (bracketFamily === null) return undefined;
      const rows = bracketFamily.all(`${prefix}%`) as unknown as Record<string, unknown>[];
      // The size is the **last** number in the name, because that is the web
      // depth in every family the frame asks for: `BP65A` → 65,
      // `EPHB15-TH64` → 64, `FFB10-TH96` → 96. Reading the first number instead
      // would take the variant tag of `EPHB15` as the size and pick the wrong
      // bracket. A name with no number at all cannot satisfy a size request.
      const sized = rows.flatMap((row) => {
        const numbers = [...str(row.description).slice(prefix.length).matchAll(/\d+(?:\.\d+)?/g)];
        if (numbers.length === 0) return [];
        return [{ row, size: Number(numbers[numbers.length - 1][0]) }];
      });
      if (sized.length === 0) return undefined;
      sized.sort((a, b) => a.size - b.size);
      // The smallest bracket that will take the web. Nothing large enough means
      // the largest there is: a bracket that is too big can be shimmed, one that
      // is too small cannot be fitted.
      const chosen = sized.find((entry) => entry.size >= web) ?? sized[sized.length - 1];
      return priceRow('cost_bracket', chosen.row);
    },

    bracketForPurlin(family, purlinCode) {
      if (bracketByFamilyAndPurlin === null || bracketByFamily === null) return undefined;
      const depth = this.purlinDepth(purlinCode);
      const all = bracketByFamily.all(`${family}%`) as unknown as Record<string, unknown>[];

      // 1. The name the desktop would build: family + web depth (`HFB64`).
      const exact = all.find((row) => str(row.description) === `${family}${depth}`);
      if (exact !== undefined) return priceRow('cost_bracket', exact);

      // 2. A row named for this purlin (`EPHB15-TH64`, `FFB10-TH96`). The book
      //    carries several size classes for one purlin and the field that
      //    separates them — the desktop's `Web` — is not part of this build's
      //    frame model, so the smallest class is taken. Understating a fitting
      //    that a factory would upgrade is a conversation; overstating one loses
      //    the job. Recorded at `/deviations`.
      const suffix = purlinSuffix(purlinCode, depth);
      if (suffix !== '') {
        const named = bracketByFamilyAndPurlin.all(`${family}%`, `%-${suffix}`) as unknown as Record<
          string,
          unknown
        >[];
        if (named.length > 0) return priceRow('cost_bracket', named[0]);
      }

      // 3. A plain size ladder (`HFB10`…`HFB40`, `ZFFB10`…`ZFFB40`), where the
      //    number really is the web depth: the smallest rung that will take it,
      //    else the largest rung there is. A fitting that is too small cannot be
      //    bolted on; one that is too large can.
      const ladder = all
        .filter((row) => !str(row.description).includes('-'))
        .flatMap((row) => {
          const match = /\d+(?:\.\d+)?/g.exec(str(row.description).slice(family.length));
          return match === null ? [] : [{ row, size: Number(match[0]) }];
        })
        .sort((a, b) => a.size - b.size);
      if (ladder.length === 0) {
        return all.length === 0 ? undefined : priceRow('cost_bracket', all[0]);
      }
      const fit = ladder.find((entry) => entry.size >= depth) ?? ladder[ladder.length - 1];
      return priceRow('cost_bracket', fit.row);
    },

    bracing(size) {
      if (bracingBySize === null) return undefined;
      const row = bracingBySize.get(size) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      return {
        code: str(row.code),
        description: str(row.description),
        // One roll is the unit; `unit_length` says how many metres it carries.
        unitCost: cents(row.cost),
        massKg: num(row.mass),
        rowKey: rowKeyOf('cost_bracing', row),
        rollMetres: num(row.unit_length),
      } satisfies BracingRow;
    },

    bolt(description) {
      if (boltByName === null) return undefined;
      const row = boltByName.get(description) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      const qtyPerPack = Math.max(1, Math.round(num(row.qty_pack)));
      const packCost = num(row.cost_pack) || num(row.cost) * qtyPerPack;
      return {
        code: str(row.code),
        description: str(row.description),
        unitCost: cents(packCost),
        massKg: num(row.mass),
        rowKey: rowKeyOf('cost_bolt', row),
        qtyPerPack,
      } satisfies PackRow;
    },

    screw(type, colour) {
      if (screwByTypeColour === null || screwByType === null) return undefined;
      const row =
        (colour === undefined
          ? undefined
          : (screwByTypeColour.get(type, colour) as Record<string, unknown> | undefined)) ??
        (screwByType.get(type) as Record<string, unknown> | undefined);
      if (row === undefined) return undefined;
      const qtyPerPack = Math.max(1, Math.round(num(row.qty_per_pack)));
      // Some rows carry a per-piece price and a null pack price. A pack price of
      // zero would make the line free while still looking priced, which is the
      // worst of both: fall back to the piece price times the pack, and only then
      // to zero.
      const packCost = num(row.screw_price_pack) || num(row.screws_price) * qtyPerPack;
      return {
        code: codeFor(row.screws_product_code, `${str(row.screws_size)} ${type}`),
        description: str(row.screws_size),
        unitCost: cents(packCost),
        massKg: num(row.screws_mass),
        rowKey: rowKeyOf('screws', row),
        qtyPerPack,
      } satisfies PackRow;
    },

    delivery(state, band) {
      if (deliveryRows === null) return 0;
      const rows = deliveryRows.all() as unknown as {
        delivery_name: string;
        state_value_array: string;
      }[];
      const row = rows.find((entry) => entry.delivery_name.includes(band));
      if (row === undefined) return 0;
      // The array is `'QLD : 250; NSW : 300'` — split, trim, match the state.
      for (const part of str(row.state_value_array).split(';')) {
        const [key, value] = part.split(':').map((piece) => piece.trim());
        if (key === state) return cents(Number(value));
      }
      return 0;
    },
  };
}
