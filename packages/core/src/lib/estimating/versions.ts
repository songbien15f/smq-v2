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
 */
export const ENGINE_VERSION = '2';
