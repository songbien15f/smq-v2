/**
 * The engine's own version.
 *
 * Bump this whenever a formula changes. A saved revision stores it, so a number
 * can be explained years later: "this quote was priced by engine 1" is a fact,
 * while "the code was different then" is not. It is deliberately **not** a
 * timestamp — two builds of the same engine must produce the same version, or
 * every revision looks like it used different formulas.
 */
export const ENGINE_VERSION = '1';
