/**
 * Types the BOM and pricing layers work in.
 *
 * Money is **whole cents** and dimensions are **millimetres** everywhere below
 * the lookup. The conversion from the price book's dollars happens once, inside
 * `lookup.ts`, so no other module has to remember which unit it is holding.
 */

/** One priced item, as the lookup returns it. */
export interface PriceRow {
  code: string;
  description: string;
  /** Whole cents. */
  unitCost: number;
  massKg: number;
  /**
   * Which catalogue row this came from, as built by `rowKeys.ts`.
   *
   * Required, not optional. A company's price override names one row, and a row
   * that cannot be named cannot be overridden — an optional field would let a
   * lookup member forget it and silently opt out of per-row pricing. The
   * compiler asking for it at every construction site is the point.
   */
  rowKey: string;
}

/** A sheeting row, which carries the cover and span data the BOM needs. */
export interface SheetingRow extends PriceRow {
  profile: string;
  bmt: number;
  /** Millimetres of wall or roof one sheet covers. */
  coverageMm: number;
  roofInternalSpanMm: number;
  roofEndSpanMm: number;
  wallInternalSpanMm: number;
  wallEndSpanMm: number;
  wallSideSpanMm: number;
}

/**
 * A fixing sold in packs.
 *
 * `unitCost` is the **pack** price, not the piece price: a quote buys packs, and
 * pricing the pack is what makes the pack rounding in `bom/groups/fixings.ts`
 * come out right. `massKg` stays the mass of one piece, because a line's mass is
 * the mass of the steel that actually ships, not of the cartons.
 */
export interface PackRow extends PriceRow {
  qtyPerPack: number;
}

/** A wind-bracing roll: priced per roll, and the roll's length is what matters. */
export interface BracingRow extends PriceRow {
  /** Metres of bracing in one roll. */
  rollMetres: number;
}

/** A Colorbond colour. */
export interface ColourRow {
  name: string;
  hex: string;
}

/** One row of the purlin/girt span table. */
export interface DevidedRow {
  code: string;
  standardSpan: number;
  purlinSpan: number;
  girtSpan: number;
  openDesign: boolean;
  purlinMaterial: string;
  /**
   * The girt material, when the book states one.
   *
   * `undefined` for the reference book, whose span table carries `purlin_material`
   * only — so a wall girt has no material of its own to be priced from. A supplier
   * that sells a different section for girts states it here, and then a girt is priced
   * from its own material rather than the roof purlin's.
   */
  girtMaterial?: string;
}

/**
 * A girt price, and whether it is the girt's own.
 *
 * The flag is part of the return value rather than something the caller infers. The
 * fallback is the *default* on the reference book, so a caller that forgets it produces
 * a quote that looks final and is not. `separate: false` means the purlin row was used
 * to price a wall girt.
 */
export interface GirtPrice {
  row: PriceRow;
  /** `true` when the row is the girt material's, `false` when it is the purlin's. */
  separate: boolean;
}

/** What a door type is called in the price book. */
export type DoorKind = 'roller' | 'pa' | 'sliding';

/**
 * Which price column a sliding door takes.
 *
 * A sliding door is the one catalogue item priced three ways, because the same
 * door costs differently depending on where it is fitted: a side wall, a gable
 * end, or a gable end of a hangar (which needs a heavier track and frame). The
 * book carries `sld_price_sidewall`, `sld_price_endwall` and
 * `sld_price_endwall_hangar`, and its generic `sld_price` column is **zero on
 * every row** — reading that column priced every sliding door at nothing.
 */
export type SlidingPosition = 'sidewall' | 'endwall' | 'endwall_hangar';

/** Where a sliding door is fitted, which decides its price column. */
export interface DoorPlacement {
  /** True when the door is in a gable end rather than a long side wall. */
  endWall: boolean;
  /** True when the building is a hangar, whose end-wall doors are heavier. */
  hangar: boolean;
  /**
   * True when the door is painted rather than zincalume.
   *
   * The book states both prices and the painted one is dearer — 16.3% dearer on
   * average across the roller doors. A door on a Colorbond shed is painted, so
   * the default is the painted price; a galvanised shed passes `false`.
   */
  painted: boolean;
}

/**
 * What the structure-to-section table is asked for.
 *
 * The book's `system_lookup_data` (2 752 rows) names the section of every frame
 * member for a combination of building size and site conditions. These are the
 * dimensions the config can state; the two it cannot — the design's pitch class
 * and footing class — are resolved by the lookup (see `frameSchedule`).
 */
export interface FrameScheduleQuery {
  /** The book's `structure_type.id` for the building family. */
  structureCode: number;
  windRegion: string;
  terrainCategory: number;
  importanceLevel: number;
  internalPressure: 'closed' | 'open';
  /** Overall width, mm. */
  span: number;
  /** Bay spacing, mm. */
  bay: number;
  /** Wall height, mm. */
  height: number;
}

/**
 * The section each frame member takes, as the book specifies it.
 *
 * The book names a section per member: `C1` is the main portal column, `R1` its
 * rafter, `C2`/`R2` the gable-end pair, `KB` the knee brace. They are
 * **descriptions in `cost_frame`** (`C20015`, `C15012`), not codes, so each one
 * resolves to a priced row by description.
 *
 * `null` for a member means the book's design has none — a short-span portal
 * needs no knee brace.
 */
export interface FrameSchedule {
  mainColumn: string;
  endWallColumn: string;
  mainRafter: string;
  endWallRafter: string;
  kneeBrace: string | null;
  /**
   * How deep the design puts the column below the floor, mm.
   *
   * This is the book's own footing assumption for the design it chose, and it
   * replaces this build's flat 600 mm allowance when a schedule is found.
   */
  embedment: number | null;
  /**
   * The **infill columns** on each gable end: how many, and in what section.
   *
   * An infill column stands between the gable-end columns, carrying the wall
   * sheeting where the span is too wide for two columns to hold the girt. The book
   * names them `no_M/EW` (how many per end wall), `M1` and `M2` (their sections) in
   * the structure table — which is why they are part of the schedule rather than a
   * separate lookup: one row of the book describes the whole frame, infills
   * included.
   *
   * `count` is **0** for a design with none — a narrow gable needs no infill — and
   * `section` is `null` then. Both are stated rather than omitted so a caller can
   * tell "the book says none" from "this build does not know".
   */
  infill: { count: number; section: string | null } | null;
  /**
   * The section of a **roller door's mullion** (the side post) and **header** (the beam
   * across the top), from the book's `DM` and `DH` columns.
   *
   * A roller door is a hole in a wall, and a hole needs a frame: two posts and a beam.
   * The book states both sections in the same structure row as C1/R1, so they belong to
   * the schedule for the same reason the infills do — one row describes the whole frame.
   *
   * `null` when the book names none, which is different from "this build does not know":
   * a design with no roller door has no mullion to state.
   */
  doorMullion: string | null;
  doorHeader: string | null;
}

/** Everything the BOM asks of the price book. */
export interface PriceLookup {
  frame(size: string): PriceRow | undefined;
  purlin(code: string): PriceRow | undefined;
  /**
   * A wall girt by material, with a flag saying whether the price is the girt's own.
   *
   * **Optional**, because the fallback belongs to the *engine*, not to the book. A book
   * that prices girts apart implements this and says `separate: true`. A book that does
   * not — the reference book, and every lookup that predates girt pricing — simply omits
   * it, and the BOM prices the girt from the purlin row while marking the line `assumed`.
   *
   * Making it required would push the fallback into every implementation, and a lookup
   * that forgot to implement it would return no price at all, so a girt would come back
   * *mocked* — which blocks a send — instead of assumed, which does not. That is the
   * difference between "we cannot price this" and "we priced it from the wrong member",
   * and conflating them either blocks a sendable quote or hides an approximation.
   */
  girt?(code: string): GirtPrice | undefined;
  sheeting(profile: string, bmt: number): SheetingRow | undefined;
  /**
   * The smallest catalogue door that fits `width × height`.
   *
   * A door that is too small cannot be fitted, so the nearest larger catalogue
   * size is what a factory would supply. `undefined` means nothing in the book is
   * large enough, which the BOM turns into a mocked line rather than guessing.
   *
   * `placement` selects the price column for a sliding door, which the book
   * prices by position. Other kinds ignore it.
   */
  door(
    kind: DoorKind,
    width: number,
    height: number,
    placement?: DoorPlacement,
  ): PriceRow | undefined;
  /**
   * The smallest catalogue window that fits `width × height`.
   *
   * Same rule as a door: a window that is too small cannot be fitted, so the
   * nearest larger catalogue size is what a factory supplies.
   */
  window(width: number, height: number): PriceRow | undefined;
  colour(name: string): ColourRow | undefined;
  /**
   * The book's colour name for a hex value, or `undefined` when it is not one of
   * the catalogue colours.
   *
   * The config stores colours as hex because that is what the renderers need;
   * the price book indexes flashing and screws by *name*. This is the one place
   * the two vocabularies meet, so a colour-matched part can be priced.
   */
  colourName(hex: string): string | undefined;
  /** Margin for a structure and state; `1` when the book has no row. */
  margin(structureId: number, state: string): number;
  /**
   * The book's `structure_id` for a stable sub-code (`'GC'`, `'GB_TH64'`, …), or
   * `undefined` when the book has no such family.
   *
   * The margin table is keyed by that integer, so a caller holding a
   * `StructureType` resolves the sub-code first (`structure.ts`) and this second.
   */
  structureId(subCode: string): number | undefined;
  /**
   * The frame section each member takes for this building, from the book's
   * structure-to-section table; `undefined` when the book has no such table or no
   * row for this combination.
   *
   * `undefined` is not an error: a book without the table is a book this build
   * can still quote from, using one fixed section and saying so.
   */
  frameSchedule(query: FrameScheduleQuery): FrameSchedule | undefined;
  /**
   * A frame section's cross-section: web and depth, mm.
   *
   * The connector tables are keyed by **web** rather than by section name
   * (`HP20-10` is the haunch for a 20 mm web at a 10° pitch), so a punching sheet
   * has to resolve a section to its web before it can ask for a connector.
   * Optional, because a book with no `cost_frame` row for a section cannot answer
   * and a sheet that says "I do not know" beats one that guesses.
   */
  frameGeometry?(section: string): { web: number; depth: number } | undefined;
  /** The knee-edge row for a pitch: eave hole offset plus the apex/haunch allowances. */
  kneeEdge?(pitchDeg: number): { kneeEdgeCode: number; apex: number; haunch: number } | undefined;
  /**
   * An apex connector's hole offsets for a rafter web at a pitch.
   *
   * `r1`/`r2` are the book's `d1`/`d2` columns, already millimetres. A zero means
   * that hole is not punched — which is why they are two numbers, not one.
   */
  apex?(web: number, pitchDeg: number): { r1: number; r2: number } | undefined;
  /**
   * A haunch connector's hole offsets for a column web at a pitch.
   *
   * `e1`/`e2`/`e3` are the book's `d1`/`d2`/`d3`. A zero means no hole there.
   */
  haunch?(web: number, pitchDeg: number): { e1: number; e2: number; e3: number } | undefined;
  /** Purlin/girt span rows for a wind code and standard bay. */
  devided(code: string, standardSpan: number, openDesign?: boolean): DevidedRow[];
  /**
   * The wind codes this book is indexed by — `A2`, `A3`, `A5`, `B2`, …
   *
   * Optional, because a partial book (a dump without the span table) has none and the frame path must
   * still run. When present it lets a bare region become the code the book actually lists instead of
   * a guessed combination.
   */
  windCodes?(): readonly string[];
  /** Site wind speed in m/s for a wind region; `0` when unknown. */
  windSpeed(region: string): number;
  /** Delivery cost in cents for a state and a distance band. */
  delivery(state: string, band: string): number;
  /**
   * A gutter profile by size name ('115 Quad'), per metre.
   *
   * `colour` is the book's colour name and it matters: the same profile is
   * $4.31/m galvanised and $4.10/m painted. Omitting it gives the painted price,
   * because an unpainted gutter on a Colorbond roof is a callback.
   */
  gutter(size: string, colour?: string): PriceRow | undefined;
  /** A gutter bracket by size name, per unit. */
  gutterBracket(size: string): PriceRow | undefined;
  /**
   * A miscellaneous option by name, per unit (`'Shed Safe fee'`).
   *
   * The book carries 125 of these. This build uses one: the ShedSafe fee, which
   * every quote in the market carries and which a quote that omits it has to
   * absorb out of its own margin.
   */
  miscOption(name: string): PriceRow | undefined;
  /** A downpipe by kind ('PVC' | 'STEEL') and size. */
  downpipe(kind: string, size: string): PriceRow | undefined;
  /**
   * A flashing profile by its type name ('GABLE_BARGE', 'CORNER_FLASHING', …).
   *
   * `colour` is the book's colour name. It matters: the same profile costs more
   * galvanised than painted, so an unqualified lookup would quote the wrong one.
   * Omitting it gives the painted price.
   */
  flashing(type: string, colour?: string): PriceRow | undefined;
  /** The web depth of a purlin or girt material, mm; `0` when the book has no row. */
  purlinDepth(code: string): number;
  /** A plate bracket by its exact book name (`'KBC20-7.5L'`). */
  bracketExact(name: string): PriceRow | undefined;
  /**
   * A plate bracket by prefix and web depth: `bracket('BP', 64)` asks for the
   * smallest `BP…` that will take a 64 mm web.
   *
   * The book's bracket names are a zoo (`BP65A`, `ABP65`, `EPHB15-TH64`,
   * `GP15-190`), so the match is on the **last** number in the name — the web
   * depth in every family the frame asks for — rather than on a name built by
   * string concatenation. When nothing is large enough the largest row of that
   * prefix is returned: an undersized bracket cannot be fitted, and a bracket
   * that is too big is what a factory would supply.
   */
  bracket(prefix: string, web: number): PriceRow | undefined;
  /**
   * A frame plate by family for the purlin it fits: `bracketForPurlin('FFB',
   * 'TH64075')`.
   *
   * These plates are named for the purlin, not sized by a number — `FFB15-TH64`
   * is a flat fly for a TH64 purlin, where `15` is a size class — so the generic
   * `bracket()` rule would read the wrong number. The book carries several size
   * classes for one purlin; the cheapest is returned.
   */
  bracketForPurlin(family: string, purlinCode: string): PriceRow | undefined;
  /** A wind-bracing roll by size ('30x1.2mm'), priced per roll. */
  bracing(size: string): BracingRow | undefined;
  /** A bolt by description, priced per pack. */
  bolt(description: string): PackRow | undefined;
  /**
   * A screw by type ('ROOF_SCREW', 'WALL_SCREW', …), priced per pack.
   *
   * `colour` selects the colour-matched variant where the book has one, which is
   * what a roof screw has to be: an unpainted screw on a Colorbond roof is a
   * callback. A missing colour falls back to the first row of that type.
   */
  screw(type: string, colour?: string): PackRow | undefined;
}
