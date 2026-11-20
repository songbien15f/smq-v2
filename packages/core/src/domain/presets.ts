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

/**
 * Stable preset ids. A stored reference (the Guest page's building types keep a
 * `base_preset`) names a preset by id, because the display `name` may be reworded.
 * Never rename or reuse an id; add a new one.
 */
export const PRESET_IDS = [
  'domestic_garage',
  'farm_machinery',
  'skillion_workshop',
  'open_carport',
  'aircraft_hangar',
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** A named starting configuration offered in the toolbar. */
export interface Preset {
  id: PresetId;
  name: string;
  config: ShedConfig;
}

/** The preset with this id. Every `PresetId` has one, so this never returns undefined. */
export function presetById(id: PresetId): Preset {
  const found = PRESETS.find((p) => p.id === id);
  if (found === undefined) throw new Error(`No preset with id ${id}`);
  return found;
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
    // Hinged on the left jamb as seen from outside, which is the desktop's default.
    hinge: 'left' as const,
  };
}

/**
 * The five presets. Order runs from the smallest, most common structure to the
 * simplest open one, so the first option in a `<select>` is the everyday choice.
 */
export const PRESETS: Preset[] = [
  {
    id: 'domestic_garage',
    name: 'Domestic Garage',
    config: {
      ...DEFAULT_SHED,
      structureType: 'gable',
      span: 6000,
      length: 6000,
      height: 2400,
      roofPitchDeg: 15,
      bays: 2,
      nomBaySpacing: 3000,
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
    id: 'farm_machinery',
    name: 'Farm Machinery',
    config: {
      ...DEFAULT_SHED,
      structureType: 'gable',
      span: 12000,
      length: 24000,
      height: 4200,
      roofPitchDeg: 10,
      bays: 4,
      nomBaySpacing: 6000,
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
    id: 'skillion_workshop',
    name: 'Skillion Workshop',
    config: {
      ...DEFAULT_SHED,
      structureType: 'skillion',
      span: 9000,
      length: 15000,
      height: 3600,
      roofPitchDeg: 5,
      bays: 3,
      nomBaySpacing: 5000,
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
    id: 'open_carport',
    name: 'Open Carport',
    config: {
      ...DEFAULT_SHED,
      structureType: 'gable_carport',
      span: 6000,
      length: 6000,
      height: 2400,
      roofPitchDeg: 15,
      bays: 2,
      nomBaySpacing: 3000,
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
  {
    /**
     * A wide-span hangar. The book sells this as `Crossover Aircraft Hangar — Series 6`
     * (`GB_AH`, `structure_sub_code`), which is a gable with a Z150 frame — so the shape is the
     * gable one and only the structure family differs. There was no preset using
     * `aircraft_hangar` before this (S0.2, 2026-11-19), which is why the Guest page's fourth
     * default type had nothing to start from.
     *
     * The span is the widest the book states (15 000 mm, `view_system_shed_parameters`), and the
     * door is the catalogue's tallest wide roller (5100 × 3600) — a hangar that asked for a
     * 6 m clear opening would find no row and price incomplete.
     */
    id: 'aircraft_hangar',
    name: 'Aircraft Hangar',
    config: {
      ...DEFAULT_SHED,
      structureType: 'aircraft_hangar',
      span: 15000,
      length: 12000,
      height: 4500,
      roofPitchDeg: 10,
      bays: 4,
      nomBaySpacing: 3000,
      openings: [rollerDoor(5100, 3600)],
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
