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
/**
 * One shed dimension's recommended values, as **the price book** states them.
 *
 * ## Why these are not constants in the domain
 *
 * They used to be. `DEFAULT_SHED` hard-coded `span: 12000, height: 4200, length: 24000, bays: 4` and
 * the editor bounded span at 2 000–30 000 mm — numbers with no source. The book says something else,
 * measured on the reference book (2026-11-10):
 *
 * ```
 * span     default 6000   min 1800   max 15000   hints 6000 7500 9000 10500 12000 13500 15000
 * height   default 3000   min 2200   max 6000    hints 3000 3600 4200 4800 6000
 * bay      default 3000   min 1000   max 4000    hints 3000 3500 4000
 * pitch    default none   min 7.5    max 15/30   hints 7.5 10 15 (+20 25 30 on one group)
 * ```
 *
 * A hard-coded 12 000 mm span sits inside this book's list, so it looks plausible — while the editor
 * accepted a 24 000 mm span that is **outside** the book's 15 000 maximum. Same class of defect as
 * the wind region being narrowed: a number the engine was never given a row for.
 *
 * `hints` is **de-duplicated**. The book stores one row per `shed_parameters` group, so the raw list
 * repeats itself — 38 rows for 7 distinct spans. The desktop de-duplicates (`Distinct().OrderBy()`);
 * a dropdown showing 7 500 mm five times looks broken.
 */
export interface ShedDimension {
  /** What a new quote starts from — the book's `*_default`, or `null` when it states none. */
  defaultValue: number | null;
  min: number;
  max: number;
  /** The values the book sells, ascending and unique. */
  hints: number[];
}

/**
 * The four dimensions a shed is described by, each with the book's own bounds.
 *
 * Structurally identical to `BookDimensions` in `domain/suggest.ts`, and deliberately duplicated there
 * rather than imported: `domain/` must not depend on `lib/pricing/`, whose barrel reaches `node:fs`.
 * The two stay in step because a mismatch is a type error at the call site, not a runtime surprise.
 */
export interface ShedDimensions {
  span: ShedDimension;
  height: ShedDimension;
  baySpacing: ShedDimension;
  roofPitch: ShedDimension;
}

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
   * The book's own bounds and default for each dimension.
   *
   * Separate from the `*Hints` lists above, kept because other callers already read them. New code
   * should use this object: it carries the min/max that decide **validity**, and the default that
   * decides **where a new quote starts**.
   */
  dimensions: ShedDimensions;
  /**
   * The `structure_sub_code`s the book flags `is_nonstandard = 1`.
   *
   * A non-standard building is not a defect — it is one the factory builds to order, and the desktop
   * relaxes exactly one rule for it: the cantilever limit (`ValidateDesignInfoBlock` skips the
   * 1 400 mm check when `IS_NON_STANDARD_BUILDING`). Read from the book so the flag follows the
   * structure the operator actually chose, rather than a hard-coded name — the desktop compares
   * `display_name` strings, which breaks the day somebody renames a row.
   */
  nonStandardStructureCodes: string[];
  /**
   * Roof pitch groups, each valid over a range of **span**.
   *
   * ## Why this exists separately from `dimensions.roofPitch`
   *
   * The book states roof pitch per `config_shed` row, and each row covers a span band. Measured on the
   * reference book, the six rows split into two families: three offer 7.5/10/15° and three offer
   * 20/25/30°. Its `span_min`/`span_max` are 1 800–15 000 for every row, so **on this book the pitch
   * list never changes with span** — but the table is structured that way, and the desktop filters on
   * it (`GetHintListRoofPitch`, `ShedConfigCombo.cs:66-102`), so a supplier whose bands do differ would
   * get the wrong list from a single global constant.
   *
   * ## The desktop's bug, not reproduced
   *
   * That function assigns `min = cfg.BayMin; max = cfg.BayMax;` and then compares the **span** against
   * them — bay limits standing in for span limits. It only corrects `min` in one branch, so whenever the
   * span list's maximum differs from `BayMax` the comparison uses bay numbers for a span. The result is
   * a wrong *suggestion* list, not a wrong price: the dropdown is editable. Reproduced here against
   * `span_min`/`span_max`, which is what the code obviously meant.
   */
  roofPitchGroups: {
    spanMin: number;
    spanMax: number;
    pitchMin: number;
    pitchMax: number;
    hints: number[];
  }[];
  /**
   * The downpipe materials the book stocks, and which colour names each one is sold in.
   *
   * The desktop's **Downpipe Type** dropdown was `SELECT DISTINCT downpipe_kind`
   * (`RepositoryDownpipe.FindDownpipeMaterials`) — `PVC` and `STEEL` — and that choice re-filters
   * the downpipe colour list (`FindDownpipeColors`). Both facts live in one table, so they are read
   * as one list here rather than as a materials list plus a colour list that could disagree.
   *
   * `colourNames` keeps the book's spelling: the rule in `domain/downpipe.ts` resolves names to
   * hexes against `colours`, the same way the desktop's join did.
   */
  downpipeMaterials: { kind: string; colourNames: string[] }[];
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

/**
 * The hints of a dimension, unique and ascending.
 *
 * The book stores one row per `shed_parameters` group, so the same hint repeats: measured on the
 * reference book, `shed_hint_span` holds **38 rows for 7 distinct spans**. The desktop called
 * `Distinct()` before showing them; a dropdown listing 7 500 mm five times reads as broken data
 * rather than as a book with several configuration groups.
 */
function uniqueHints(db: DatabaseSync, table: string): number[] {
  return [...new Set(hints(db, table))].sort((a, b) => a - b);
}

/**
 * The book's default, min and max for each shed dimension.
 *
 * ## One row per group, so the answer is the union
 *
 * `view_system_shed_parameters` has six rows on the reference book — one per `shed_parameters` group —
 * and they disagree slightly (one group caps roof pitch at 15°, another at 30°). A quote has not chosen
 * a group at this point, so the honest bounds are the **widest** the book offers: minimum of the
 * minimums, maximum of the maximums. Anything narrower would refuse a building the book can price.
 *
 * The default is the **smallest** stated default, which is what the desktop takes for span and height
 * (`OrderBy(x => x).FirstOrDefault()`). It notes separately that bay takes the **largest** — an
 * inconsistency with no recorded reason, and this build does not copy it: a new quote starts from the
 * smallest bay the book sells, and the operator widens it.
 *
 * A dimension the book gives no default for (roof pitch, on every row) comes back as `null`, which is
 * different from `0`: **nothing to suggest**, not "suggest zero".
 */
function dimensionsFromBook(db: DatabaseSync): ShedDimensions {
  const table = 'view_system_shed_parameters';
  const present = rows(
    db,
    `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = '${table}'`,
  );
  if (present.length === 0) {
    /*
     * A book without the table: return empty hints and no default, with bounds that do not refuse
     * everything. A partial book must still draw a shed; the caller shows the hints it has.
     */
    const empty: ShedDimension = { defaultValue: null, min: 0, max: 0, hints: [] };
    return { span: empty, height: empty, baySpacing: empty, roofPitch: empty };
  }

  const all = rows(db, `SELECT * FROM ${table}`);
  const collect = (prefix: string, hintTable: string): ShedDimension => {
    const defaults = all
      .map((row) => all[0] === undefined ? null : (row[`${prefix}_default`] ?? null))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const mins = all
      .map((row) => row[`${prefix}_min`])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const maxes = all
      .map((row) => row[`${prefix}_max`])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    return {
      defaultValue: defaults.length === 0 ? null : Math.min(...defaults),
      min: mins.length === 0 ? 0 : Math.min(...mins),
      max: maxes.length === 0 ? 0 : Math.max(...maxes),
      hints: uniqueHints(db, hintTable),
    };
  };

  return {
    span: collect('span', 'shed_hint_span'),
    height: collect('height', 'shed_hint_height'),
    baySpacing: collect('bay_spacing', 'shed_hint_bay'),
    roofPitch: collect('roof_pitch', 'shed_hint_roof_pitch'),
  };
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

/**
 * Roof pitch rows, each with the span band it applies to.
 *
 * `config_shed` carries the band and `shed_hint_roof_pitch` carries the angles, keyed by
 * `config_shed_id`. A book without either table yields `[]`, and the caller then offers the global
 * list — an empty answer must not hide the control.
 */
function roofPitchGroups(db: DatabaseSync): Catalogue['roofPitchGroups'] {
  const configs = rows(
    db,
    `SELECT id, span_min, span_max, roof_pitch_min, roof_pitch_max
       FROM config_shed ORDER BY id`,
  );
  const groups: Catalogue['roofPitchGroups'] = [];
  for (const config of configs) {
    const id = num(config.id);
    const hints = rows(
      db,
      `SELECT hint_value FROM shed_hint_roof_pitch WHERE config_shed_id = ${id} ORDER BY hint_value`,
    )
      .map((row) => num(row.hint_value))
      .filter((value) => value > 0);
    if (hints.length === 0) continue;
    const pitchMin = num(config.roof_pitch_min);
    const pitchMax = num(config.roof_pitch_max);
    groups.push({
      spanMin: num(config.span_min),
      spanMax: num(config.span_max),
      // A row that states no bounds still has hints; its own hints are the bounds then.
      pitchMin: pitchMin > 0 ? pitchMin : Math.min(...hints),
      pitchMax: pitchMax > 0 ? pitchMax : Math.max(...hints),
      hints: [...new Set(hints)].sort((a, b) => a - b),
    });
  }
  return groups;
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
        spanHints: uniqueHints(db, 'shed_hint_span'),
        heightHints: uniqueHints(db, 'shed_hint_height'),
        roofPitchHints: uniqueHints(db, 'shed_hint_roof_pitch'),
        bayHints: uniqueHints(db, 'shed_hint_bay'),
        dimensions: dimensionsFromBook(db),
        roofPitchGroups: roofPitchGroups(db),
        nonStandardStructureCodes: rows(
          db,
          `SELECT structure_sub_code FROM structure_type
            WHERE is_nonstandard = 1 AND CAST(is_active AS REAL) = 1`,
        )
          .map((row) => str(row.structure_sub_code).trim())
          .filter((code) => code !== ''),
        downpipeMaterials: rows(
          db,
          // The same join the desktop used, and the same two filters: the colour must be active in
          // `system_colour`, and only whole pipe rows count — a material's adaptor or elbow names a
          // colour too, and listing a colour because an elbow of it is stocked would be a palette
          // entry with no pipe behind it.
          `SELECT DISTINCT dp.downpipe_kind AS kind, dp.downpipe_color AS colour
             FROM downpipe dp
             JOIN system_colour sc ON sc.colour_name = dp.downpipe_color AND sc.colour_status = 1
            WHERE dp.downpipe_type = 'DOWNPIPE'
            ORDER BY dp.downpipe_kind, dp.downpipe_color`,
        ).reduce<{ kind: string; colourNames: string[] }[]>((materials, row) => {
          const kind = str(row.kind).trim();
          if (kind === '') return materials;
          const existing = materials.find((material) => material.kind === kind);
          if (existing === undefined) {
            materials.push({ kind, colourNames: [str(row.colour)] });
          } else {
            existing.colourNames.push(str(row.colour));
          }
          return materials;
        }, []),
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
