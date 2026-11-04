/**
 * Colour roles, and the bridge from the desktop's four-role colour block.
 *
 * The desktop paints ten surfaces separately: wall, roof, barge/fascia, downpipe,
 * gutter, window, PA door, roller door, sliding door and dividing wall. The first
 * build of this app stored four (`wall`, `roof`, `trim`, `door`) because those were
 * the only ones its renderers read. A parity build needs all ten, and an old quote
 * must keep the look it was sent with — so the old block is mapped, not dropped.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type { OpeningType, ShedColors } from './types';
import { DEFAULT_SHED } from './defaults';

/** Every colour role, in the order the desktop's form presents them. */
export const COLOUR_ROLES = [
  'wall',
  'roof',
  'barge',
  'downpipe',
  'gutter',
  'window',
  'paDoor',
  'rollerDoor',
  'slidingDoor',
  'dividingWall',
] as const satisfies readonly (keyof ShedColors)[];

/** True for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `#rrggbb` string, or the fallback. */
function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/**
 * Read a stored colour block into the ten current roles.
 *
 * The old block is the important half:
 *
 * - `trim` was the *only* colour the old BOM used for gutter and downpipe lines, and
 *   the old projection showed it as the barge. It therefore seeds all three.
 * - `door` was the only colour the old opening BOM read, for every door type. It
 *   therefore seeds all four door roles.
 *
 * Reading a new block is idempotent: a role already present wins over its legacy
 * fallback. Anything unreadable falls back to `DEFAULT_SHED`, so a corrupt block
 * produces a paintable shed rather than a blank one.
 */
export function migrateColors(input: unknown): ShedColors {
  const source = isPlainObject(input) ? input : {};
  const d = DEFAULT_SHED.colors;

  const legacyTrim = hex(source.trim, d.barge);
  const legacyDoor = hex(source.door, d.rollerDoor);

  return {
    wall: hex(source.wall, d.wall),
    roof: hex(source.roof, d.roof),
    barge: hex(source.barge, legacyTrim),
    downpipe: hex(source.downpipe, legacyTrim),
    gutter: hex(source.gutter, legacyTrim),
    window: hex(source.window, legacyDoor),
    paDoor: hex(source.paDoor, legacyDoor),
    rollerDoor: hex(source.rollerDoor, legacyDoor),
    slidingDoor: hex(source.slidingDoor, legacyDoor),
    dividingWall: hex(source.dividingWall, d.dividingWall),
  };
}

/**
 * The colour the door BOM checks for a painted finish.
 *
 * A door takes the colour of its own role; a plain hole is the wall's colour. This
 * lives here rather than in the BOM so the mapping exists once: the price of a door
 * swings on whether the finish is painted, so two mappings would be two quotes.
 */
export function doorColour(colours: ShedColors, type: OpeningType): string {
  switch (type) {
    case 'window':
      return colours.window;
    case 'pa_door':
      return colours.paDoor;
    case 'sliding_door':
      return colours.slidingDoor;
    case 'roller_door':
      return colours.rollerDoor;
    case 'opening':
      return colours.wall;
  }
}
