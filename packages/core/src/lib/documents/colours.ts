/**
 * Colorbond names, for anywhere a colour is shown to a person.
 *
 * An Australian shed customer names a colour, not a hex code: the order says "Shale Grey", the
 * customer asked for "Shale Grey", and `#bdbfba` is a value only a screen needs. The document must
 * print the name, because it is the one place the name matters most.
 *
 * Kept out of the React component so the document renderer — a server module — uses the same lookup.
 * Two copies of a name table is two chances for the quote and the editor to disagree about what
 * colour a shed is.
 */

import { COLORBOND } from '@/domain/defaults';

/** The range as a list, in the order the supplier prints it. */
export const COLOUR_RANGE: { name: string; hex: string }[] = Object.entries(COLORBOND).map(
  ([name, hex]) => ({ name, hex }),
);

/**
 * The Colorbond name whose hex matches, or `null` for a colour outside the range.
 *
 * A custom colour is not an error: a customer sometimes supplies one. The caller decides what to
 * show — the document prints the name when there is one and the hex when there is not, which is
 * honest about what is known.
 */
export function colourNameOf(hex: string): string | null {
  const wanted = hex.trim().toLowerCase();
  const found = COLOUR_RANGE.find((entry) => entry.hex.toLowerCase() === wanted);
  return found === undefined ? null : found.name;
}

/** A colour as a person reads it: the Colorbond name, else the hex. */
export function colourLabel(hex: string): string {
  return colourNameOf(hex) ?? hex;
}
