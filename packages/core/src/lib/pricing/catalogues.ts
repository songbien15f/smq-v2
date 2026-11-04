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
  } catch {
    return [];
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

/** Group sheeting rows by profile so a dropdown offers each profile once. */
function profiles(db: DatabaseSync): SheetingProfile[] {
  const byProfile = new Map<string, SheetingProfile>();
  for (const row of rows(
    db,
    `SELECT profile, bmt, is_wall, is_roof FROM material_sheeting
     WHERE is_active = 1 ORDER BY index_sort`,
  )) {
    const profile = str(row.profile);
    if (profile === '') continue;
    const existing = byProfile.get(profile);
    if (existing === undefined) {
      byProfile.set(profile, {
        profile,
        bmtValues: [num(row.bmt)],
        isWall: active(row.is_wall),
        isRoof: active(row.is_roof),
      });
    } else {
      existing.bmtValues.push(num(row.bmt));
      existing.isWall = existing.isWall || active(row.is_wall);
      existing.isRoof = existing.isRoof || active(row.is_roof);
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
      };
    },
  };
}
