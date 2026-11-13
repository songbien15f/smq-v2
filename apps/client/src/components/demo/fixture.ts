/**
 * The fixed building the demo draws.
 *
 * Deliberately a constant: `/demo` exists to show what the 3D layer can do, not to be edited.
 * Every opening type the quote editor supports appears once, plus one plain hole so the
 * difference between "a cut with a door in it" and "a cut" is visible.
 *
 * Dimensions are a plausible Australian farm shed: 12 m span, 18 m long in three 6 m bays,
 * 4.2 m walls, 15° gable.
 */

import { TEST_SHED } from '@sq/core/domain';
import type { DimensionedShed, Opening } from '@sq/core/domain';

/** Openings are positional; the ids only have to be unique within the building. */
const openings: Opening[] = [
  {
    id: 'demo-roller',
    type: 'roller_door',
    width: 3600,
    height: 3600,
    sill: 0,
    wall: 'front',
    align: 'center',
    offset: null,
    swing: null,
    track: null,
  },
  {
    id: 'demo-window',
    type: 'window',
    width: 1800,
    height: 900,
    sill: 1800,
    wall: 'front',
    align: 'custom',
    offset: 1200,
    swing: null,
    track: null,
  },
  {
    id: 'demo-pa',
    type: 'pa_door',
    width: 900,
    height: 2100,
    sill: 0,
    wall: 'front',
    align: 'custom',
    offset: 9800,
    // Open outward and hinged left, which is what the hardware geometry draws.
    swing: 'outward',
    hinge: 'left',
    track: null,
  },
  {
    id: 'demo-sliding',
    type: 'sliding_door',
    width: 3600,
    height: 2400,
    sill: 0,
    wall: 'left',
    align: 'center',
    offset: null,
    swing: 'outward',
    // Two leaves on two tracks, one slid open — the case that reads worst as a flat panel.
    track: 'double',
    leaves: 2,
  },
  {
    id: 'demo-hole',
    type: 'opening',
    width: 1500,
    height: 1800,
    sill: 1200,
    wall: 'back',
    align: 'custom',
    offset: 3000,
    swing: null,
    track: null,
  },
];

export const DEMO_SHED: DimensionedShed = {
  ...TEST_SHED,
  span: 12000,
  length: 18000,
  height: 4200,
  roofPitchDeg: 15,
  bays: 3,
  nomBaySpacing: 6000,
  openings,
  options: [],
  colors: {
    // A common Australian combination: Shale Grey walls, Monument roof, Surfmist trim.
    wall: '#bdbfba',
    roof: '#323232',
    barge: '#e4e2d5',
    downpipe: '#e4e2d5',
    gutter: '#e4e2d5',
    window: '#e4e2d5',
    paDoor: '#6d6c6e',
    rollerDoor: '#b6b8b4',
    slidingDoor: '#4b4c46',
    dividingWall: '#e4e2d5',
  },
};
