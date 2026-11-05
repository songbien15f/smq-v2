/**
 * The dropdown catalogues the editor reads from the price book.
 *
 * The desktop's Step 1 and Step 2 forms are not free text: span, height, roof pitch,
 * profile, footing, delivery scope, colours, miscellaneous options and engineering
 * charges all come from the book. A web form that hardcodes them drifts from the
 * book the moment a supplier changes one, and the drift is invisible until a
 * customer is quoted on a size the factory no longer sells.
 *
 * ## Shape
 *
 * `EditorCatalogueSource` is a pure interface so a test can build one from a fixture.
 * `createSqliteCatalogueSource` is the SQLite adapter, placed next to
 * `createLookup` because the price book belongs to the pricing layer.
 *
 * ## Missing tables are empty lists, not errors
 *
 * A price book is an export from someone else's product and older exports lack
 * tables this build knows about. Each query is run in isolation and a missing
 * table yields `[]`, so an old book still opens with the catalogues it does have.
 * A 500 here would make the whole editor unusable over a table nobody uses yet.
 */

import type { DatabaseSync } from 'node:sqlite';

/** A Colorbond colour and the roles the book permits it in. */
export interface ColourOption {
  name: string;
  hex: string;
  /** The book's `option_spec_array`, e.g. `['WALL_SPEC', 'GUTTER_SPEC']`. */
  roles: string[];
}

/** A priced catalogue line (a misc option or an engineering charge). */
export interface CatalogueOption {
  name: string;
  code: string;
  unit: string;
}

/** One structure option the Options dock can offer. */
export interface StructureOptionRow {
  code: string;
  name: string;
  description: string;
  displayPriority: number;
  min: number | null;
  defaultValue: number | null;
  max: number | null;
}

/** A `value`/`label` pair for a select. */
export interface LabelledOption {
  value: string;
  label: string;
}

/** One sheeting profile, with every BMT it is sold in. */
export interface SheetingProfile {
  profile: string;
  bmtValues: number[];
  isWall: boolean;
  isRoof: boolean;
  /**
   * Sheet cover per state, mm, or `null` when the book does not say.
   *
   * The cover is **not** one number: `sheeting_cover` stores `QLD:762;NSW:762;…` and a
   * state can differ (a 0.35 Lo-Rib is 817 everywhere, but a book may vary). It is also
   * what a **skylight is snapped to** — a skylight replaces one sheet — so the editor
   * needs it per profile rather than a single figure.
   */
  coverByState: Record<string, number> | null;
}

/** A footing code and its label. */
export interface CodeLabel {
  code: string;
  label: string;
}

/** A delivery scope and its per-state prices. */
export interface DeliveryScope {
  name: string;
  value: number;
  indexOrder: number;
  stateValues: Record<string, number> | null;
}

/** One catalogue size a door or window can be ordered in. */
export interface DoorSize {
  code: string;
  label: string;
  width: number;
  height: number;
  /** Roller doors only: the series the size belongs to. */
  series?: string;
}

/** Everything the editor's Step 1 and Step 2 dropdowns need. */
export interface Catalogue {
  colours: ColourOption[];
  miscOptions: CatalogueOption[];
  engineeringCharges: CatalogueOption[];
  structureOptions: StructureOptionRow[];
  windRegions: LabelledOption[];
  terrainCategories: LabelledOption[];
  importanceLevels: LabelledOption[];
  profiles: SheetingProfile[];
  footingTypes: CodeLabel[];
  footingSubTypes: CodeLabel[];
  deliveryScopes: DeliveryScope[];
  spanHints: number[];
  heightHints: number[];
  roofPitchHints: number[];
  bayHints: number[];
  /**
   * The catalogue sizes per opening type.
   *
   * The desktop's Size/Type dropdown was this table: an operator picked a size the factory sells
   * rather than typing one. The four tables spell their columns differently, so each is mapped
   * to the same shape here.
   */
  doorSizes: {
    window: DoorSize[];
    paDoor: DoorSize[];
    rollerDoor: DoorSize[];
    slidingDoor: DoorSize[];
  };
}

/**
 * A catalogue reader. One implementation reads SQLite; tests supply fixtures.
 *
 * Named `EditorCatalogueSource` rather than `CatalogueSource` because `rowKeys.ts`
 * already uses that name for a bill-of-materials source table, and the barrel
 * re-exports both.
 */
export interface EditorCatalogueSource {
  load(): Catalogue;
}

/** A row as SQLite returns it. */
type Row = Record<string, unknown>;

/** Read every row of a statement, or `[]` when the table is missing. */
function rows(db: DatabaseSync, sql: string): Row[] {
  try {
    return db.prepare(sql).all() as Row[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    /*
     * An older dump lacks a table this build knows about; that is a book with fewer
     * catalogues, not a failure. Anything else — a missing **column**, a corrupt
     * file, a closed handle — is a real incompatibility, and turning it into `[]`
     * would leave the editor with an empty list and no error to act on.
     */
    if (/no such table/i.test(message)) return [];
    throw error;
  }
}

/** A string from a value, `''` for null. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

/** A finite number from a value, `0` for anything else. */
function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A finite number or `null`, so "not stated" stays distinct from zero. */
function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True for the book's `1`, `'1'` and `'1.0'`. */
function active(value: unknown): boolean {
  return Number(value) === 1;
}

/** Split the book's `"ACT : 250; NSW : 250"` into `{ ACT: 250, NSW: 250 }`. */
function parseStateValues(raw: unknown): Record<string, number> | null {
  const text = str(raw).trim();
  if (text === '') return null;
  const out: Record<string, number> = {};
  for (const pair of text.split(';')) {
    const [state, value] = pair.split(':');
    if (state === undefined || value === undefined) continue;
    const key = state.trim();
    const parsed = Number(value.trim());
    if (key !== '' && Number.isFinite(parsed)) out[key] = parsed;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** Distinct numbers from a list, in first-seen order. */
function distinct(values: number[]): number[] {
  return [...new Set(values)];
}

/** Read the option catalogue lines of one `misc_option.type`. */
function miscOfType(db: DatabaseSync, type: string): CatalogueOption[] {
  return rows(
    db,
    `SELECT option_name, product_code, unit FROM misc_option
     WHERE type = '${type}' ORDER BY indexSort`,
  ).map((row) => ({ name: str(row.option_name), code: str(row.product_code), unit: str(row.unit) }));
}

/** Read the active rows of a `display_name`/`index_sort` lookup table. */
function labelled(db: DatabaseSync, table: string): LabelledOption[] {
  return rows(
    db,
    `SELECT display_name FROM ${table} WHERE is_active = 1 ORDER BY index_sort`,
  ).map((row) => {
    const label = str(row.display_name);
    return { value: label, label };
  });
}

/** Read one hint list. */
function hints(db: DatabaseSync, table: string): number[] {
  return rows(db, `SELECT hint_value FROM ${table} ORDER BY id`).map((row) => num(row.hint_value));
}

/**
 * Sheet cover per state, keyed by the sheeting description.
 *
 * `sheeting_cover.sheet_cover` is a packed string (`'QLD:0.762;NSW:0.762;'`), in
 * **metres**, while everything above this works in millimetres. Reading it as
 * millimetres — which the desktop did with a cast, and which this build's side-wall
 * path once did too — turns a 762 mm cover into 0, so every count divides by one.
 */
function coversBySheeting(db: DatabaseSync): Map<string, Record<string, number>> {
  const byDescription = new Map<string, Record<string, number>>();
  for (const row of rows(db, 'SELECT sheeting_size, sheet_cover FROM sheeting_cover')) {
    const packed = str(row.sheet_cover);
    if (packed === '') continue;
    const perState: Record<string, number> = {};
    for (const pair of packed.split(';')) {
      const [state, value] = pair.split(':');
      if (state === undefined || value === undefined) continue;
      const metres = Number(value);
      if (!Number.isFinite(metres) || metres <= 0) continue;
      perState[state.trim().toUpperCase()] = Math.round(metres * 1000);
    }
    if (Object.keys(perState).length > 0) {
      byDescription.set(str(row.sheeting_size), perState);
    }
  }
  return byDescription;
}

/** Group sheeting rows by profile so a dropdown offers each profile once. */
function profiles(db: DatabaseSync): SheetingProfile[] {
  const byProfile = new Map<string, SheetingProfile>();
  // Read once: this is a full table scan, and doing it per row would be N scans for a
  // list of a dozen profiles.
  const covers = coversBySheeting(db);
  for (const row of rows(
    db,
    // `description` is what `sheeting_cover` keys on (`'0.42 Corro'`), so it has to be
    // selected. Reading `row.description` off a query that does not ask for it gives
    // `undefined` without complaint, and every profile's cover came back null.
    `SELECT profile, bmt, is_wall, is_roof, description FROM material_sheeting
     WHERE is_active = 1 ORDER BY index_sort`,
  )) {
    const profile = str(row.profile);
    if (profile === '') continue;
    const cover = covers.get(str(row.description)) ?? null;
    const existing = byProfile.get(profile);
    if (existing === undefined) {
      byProfile.set(profile, {
        profile,
        bmtValues: [num(row.bmt)],
        isWall: active(row.is_wall),
        isRoof: active(row.is_roof),
        coverByState: cover,
      });
    } else {
      existing.bmtValues.push(num(row.bmt));
      existing.isWall = existing.isWall || active(row.is_wall);
      existing.isRoof = existing.isRoof || active(row.is_roof);
      // The first row with a cover wins: within one profile the cover is the same.
      existing.coverByState = existing.coverByState ?? cover;
    }
  }
  return [...byProfile.values()].map((entry) => ({
    ...entry,
    bmtValues: distinct(entry.bmtValues).sort((a, b) => a - b),
  }));
}

/** Read a code/label table (`shed_footing_type`, `shed_footing_sub_type`). */
function codeLabels(db: DatabaseSync, table: string, codeColumn: string): CodeLabel[] {
  return rows(
    db,
    `SELECT ${codeColumn} AS code, display_name FROM ${table}
     WHERE is_active = 1 ORDER BY index_sort`,
  ).map((row) => ({ code: str(row.code), label: str(row.display_name) }));
}

/** Build the SQLite-backed catalogue reader. */
export function createSqliteCatalogueSource(db: DatabaseSync): EditorCatalogueSource {
  return {
    load(): Catalogue {
      return {
        colours: rows(
          db,
          `SELECT colour_name, colour_value, option_spec_array FROM system_colour
           WHERE colour_status = 1 ORDER BY colour_index`,
        ).map((row) => ({
          name: str(row.colour_name),
          hex: str(row.colour_value),
          roles: str(row.option_spec_array)
            .split(',')
            .map((role) => role.trim())
            .filter((role) => role !== ''),
        })),
        miscOptions: miscOfType(db, 'MicsellaneousOptions'),
        engineeringCharges: miscOfType(db, 'EngineeringCharges'),
        structureOptions: rows(
          db,
          `SELECT code, name, description, display_priority, min_value, default_value, max_value
           FROM system_structure_option
           WHERE CAST(is_active AS REAL) = 1 ORDER BY display_priority`,
        ).map((row) => ({
          code: str(row.code),
          name: str(row.name),
          description: str(row.description),
          displayPriority: num(row.display_priority),
          min: nullableNum(row.min_value),
          defaultValue: nullableNum(row.default_value),
          max: nullableNum(row.max_value),
        })),
        windRegions: labelled(db, 'design_wind_region'),
        terrainCategories: labelled(db, 'design_terrain_category'),
        importanceLevels: labelled(db, 'design_importance_level'),
        profiles: profiles(db),
        footingTypes: codeLabels(db, 'shed_footing_type', 'footing_code'),
        footingSubTypes: codeLabels(db, 'shed_footing_sub_type', 'footing_sub_type_code'),
        deliveryScopes: rows(
          db,
          `SELECT delivery_name, delivery_value, index_order, state_value_array
           FROM delivery_data WHERE status = 1 ORDER BY index_order`,
        ).map((row) => ({
          name: str(row.delivery_name),
          value: num(row.delivery_value),
          indexOrder: num(row.index_order),
          stateValues: parseStateValues(row.state_value_array),
        })),
        spanHints: hints(db, 'shed_hint_span'),
        heightHints: hints(db, 'shed_hint_height'),
        roofPitchHints: hints(db, 'shed_hint_roof_pitch'),
        bayHints: hints(db, 'shed_hint_bay'),
        doorSizes: {
          window: rows(
            db,
            `SELECT code, description, width, height FROM material_window
             WHERE is_active = 1 ORDER BY index_sort`,
          ).map((row) => ({
            code: str(row.code),
            label: str(row.description),
            width: num(row.width),
            height: num(row.height),
          })),
          paDoor: rows(
            db,
            `SELECT padoor_product_code AS code, padoor_name AS label, width, height FROM padoor
             WHERE isActive = 1 ORDER BY indexSort`,
          ).map((row) => ({
            code: str(row.code),
            label: str(row.label),
            width: num(row.width),
            height: num(row.height),
          })),
          rollerDoor: rows(
            db,
            `SELECT rdoor_code AS code, rdoor_name AS label, width, height, rdoor_type AS series
             FROM roller_door WHERE isActive = 1 ORDER BY indexSort`,
          ).map((row) => ({
            code: str(row.code),
            label: str(row.label),
            width: num(row.width),
            height: num(row.height),
            series: str(row.series),
          })),
          slidingDoor: rows(
            db,
            `SELECT sld_code AS code, sld_size AS label, sld_width AS width, sld_height AS height
             FROM sliding_door ORDER BY sld_id`,
          ).map((row) => ({
            code: str(row.code),
            label: str(row.label),
            width: num(row.width),
            height: num(row.height),
          })),
        },
      };
    },
  };
}
