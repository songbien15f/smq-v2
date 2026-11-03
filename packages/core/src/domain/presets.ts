/**
 * Starting-point templates.
 *
 * Four presets mirroring the competitor's template vocabulary (spec §13,
 * ShedMate analysis §6). Every linear value is in millimetres — the canonical
 * unit — and every config is written so that it survives `normaliseShedConfig`
 * unchanged in its key fields: bays already in `[2, 30]`, dimensions well above
 * the metre-drift thresholds, openings that fit their walls, and colours taken
 * from `DEFAULT_SHED` so a preset never introduces a new palette.
 *
 * A preset is a whole `ShedConfig`, applied through the store's `applyConfig`, so
 * choosing one is undoable exactly like any other change.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import { DEFAULT_OPENING_SIZE, DEFAULT_SHED } from './defaults';
import type { ShedConfig } from './types';

/** A named starting configuration offered in the toolbar. */
export interface Preset {
  name: string;
  config: ShedConfig;
}

/** Shared palette, so a preset is visually identical to a fresh shed. */
const COLORS = DEFAULT_SHED.colors;

/** A roller door, centred on the front wall unless stated otherwise. */
function rollerDoor(width: number, height: number) {
  return {
    id: 'roller-1',
    type: 'roller_door' as const,
    width,
    height,
    sill: 0,
    wall: 'front' as const,
    align: 'center' as const,
    offset: null,
    swing: null,
    track: null,
  };
}

/**
 * A personal-access door.
 *
 * The size comes from `DEFAULT_OPENING_SIZE`, which is a catalogue size. The
 * preset used to hardcode 900 × 2100, and the personal-access catalogue tops out
 * at 2040 mm high — so the preset's own door could not be priced and the whole
 * quote read "incomplete".
 */
function paDoor(id: string, wall: 'front' | 'back' | 'left' | 'right', align: 'center' | 'left' | 'right') {
  return {
    id,
    type: 'pa_door' as const,
    width: DEFAULT_OPENING_SIZE.width,
    height: DEFAULT_OPENING_SIZE.height,
    sill: 0,
    wall,
    align,
    offset: null,
    swing: 'outward' as const,
    track: null,
  };
}

/**
 * The four presets. Order runs from the smallest, most common structure to the
 * simplest open one, so the first option in a `<select>` is the everyday choice.
 */
export const PRESETS: Preset[] = [
  {
    name: 'Domestic Garage',
    config: {
      structureType: 'gable',
      span: 6000,
      length: 6000,
      height: 2400,
      roofPitchDeg: 15,
      bays: 2,
      openings: [rollerDoor(4200, 2100)],
      options: [],
      charges: [],
      internalPressure: 'closed',
      windRegion: 'A',
      terrainCategory: 2.5,
      shieldingFactor: 1,
      importanceLevel: 1,
      topographyFactor: 1,
      stateCode: 'QLD',
      colors: COLORS,
      displayUnit: 'm',
    },
  },
  {
    name: 'Farm Machinery',
    config: {
      structureType: 'gable',
      span: 12000,
      length: 24000,
      height: 4200,
      roofPitchDeg: 10,
      bays: 4,
      // 5100 wide, not 6000: the roller-door catalogue's tallest wide opening is
      // 5100 mm at a 3600 height, and a preset asking for more finds nothing and
      // quotes incomplete.
      openings: [rollerDoor(5100, 3600), paDoor('pa-1', 'front', 'right')],
      options: [],
      charges: [],
      internalPressure: 'closed',
      windRegion: 'A',
      terrainCategory: 2.5,
      shieldingFactor: 1,
      importanceLevel: 1,
      topographyFactor: 1,
      stateCode: 'QLD',
      colors: COLORS,
      displayUnit: 'm',
    },
  },
  {
    name: 'Skillion Workshop',
    config: {
      structureType: 'skillion',
      span: 9000,
      length: 15000,
      height: 3600,
      roofPitchDeg: 5,
      bays: 3,
      openings: [rollerDoor(4800, 3000)],
      options: [],
      charges: [],
      internalPressure: 'closed',
      windRegion: 'A',
      terrainCategory: 2.5,
      shieldingFactor: 1,
      importanceLevel: 1,
      topographyFactor: 1,
      stateCode: 'QLD',
      colors: COLORS,
      displayUnit: 'm',
    },
  },
  {
    name: 'Open Carport',
    config: {
      structureType: 'gable_carport',
      span: 6000,
      length: 6000,
      height: 2400,
      roofPitchDeg: 15,
      bays: 2,
      openings: [],
      options: [],
      charges: [],
      internalPressure: 'closed',
      windRegion: 'A',
      terrainCategory: 2.5,
      shieldingFactor: 1,
      importanceLevel: 1,
      topographyFactor: 1,
      stateCode: 'QLD',
      colors: COLORS,
      displayUnit: 'm',
    },
  },
];
