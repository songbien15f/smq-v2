/**
 * The engine's own version.
 *
 * Bump this whenever a formula changes. A saved revision stores it, so a number
 * can be explained years later: "this quote was priced by engine 1" is a fact,
 * while "the code was different then" is not. It is deliberately **not** a
 * timestamp — two builds of the same engine must produce the same version, or
 * every revision looks like it used different formulas.
 *
 * ## History
 *
 * - `1` — the initial engine.
 * - `2` — a skillion's principal rafter spans the whole width, not half of it.
 *   The formula halved every structure; the desktop divides by `cos(pitch)` once
 *   over the full width for a skillion (`SkillionBuildingQuote.cs:242`). Every
 *   skillion revision priced by engine 1 ordered roughly half a rafter.
 * - `3` — a skillion falls across the span, as the desktop builds it: roof sheets run
 *   `span / cos(pitch)` and are counted along the length; the high side wall and the high
 *   columns are `tan(pitch) × span` taller, on their own lines; one rafter per skillion frame,
 *   not two; the barge (every roof, gables included) is cut as the desktop cuts it, sloped
 *   pieces with laps plus a skillion's high eave (`SkillionBuildingQuote.cs:54-80,238-283,838-861`,
 *   `SubMaterial.cs:823-850`). KNOWN-DEVIATIONS row 58.
 */
export const ENGINE_VERSION = '3';
