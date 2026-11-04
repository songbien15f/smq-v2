/**
 * What is currently selected on the 2D plan, and the editable fields it exposes.
 *
 * `describeSelection` is the single source of truth for the canvas popover: it
 * turns a `Selection` into a title and an ordered list of `FieldSpec`s whose
 * labels match the form's own, so the popover and the form read identically.
 *
 * A dangling opening id (the AI path can replace `openings` wholesale) resolves
 * to `{ kind: 'none' }` rather than throwing, so the UI never has to special-case
 * a stale selection.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type {
  AlignMode,
  DisplayUnit,
  Opening,
  OpeningType,
  OptionKind,
  ShedConfig,
  ShedOption,
  WallSide,
} from './types';
import type { PlanGeometry } from './plan';

/** What the user has selected on the plan. */
export type Selection =
  | { kind: 'none' }
  | { kind: 'building' }
  | { kind: 'opening'; id: string }
  | { kind: 'option'; id: string };

/** One editable field, ready to render as a number input or a select. */
export interface FieldSpec {
  key: string;
  label: string;
  type: 'number' | 'select';
  /**
   * The stored value. For a dimension field this is **millimetres** — the
   * canonical unit — regardless of `unit`; the popover converts it for display.
   */
  value: number | string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  /**
   * Present on **dimension** fields only: the unit the value, `min`, `max`, and
   * `step` should be shown and entered in. Its absence marks a non-dimension
   * number (bays, roof pitch) that is shown verbatim. This keeps the conversion
   * in one place (the popover) instead of pre-dividing values here, so the spec
   * stays canonical-millimetre.
   */
  unit?: DisplayUnit;
  /**
   * When `true` the control is shown but not editable. Used for `offset`, which
   * is only meaningful when `align === 'custom'` (spec §5.2).
   */
  disabled?: boolean;
}

/** The resolved description of a selection: a title plus its editable fields. */
export interface SelectionDescription {
  title: string;
  kind: 'building' | 'opening' | 'option' | 'none';
  id?: string;
  fields: FieldSpec[];
}

/**
 * The five opening types and their display labels, in form order (spec §5.4).
 *
 * The single source of truth for both the popover's Type field (`openingFields`)
 * and the canvas context menu's "Add door" submenu (`Render2D` derives its rows
 * from this list). Keeping one list means the menu can never offer a type the
 * editor does not know, or vice versa.
 */
export const OPENING_TYPE_OPTIONS: { value: OpeningType; label: string }[] = [
  { value: 'roller_door', label: 'Roller door' },
  { value: 'pa_door', label: 'PA door' },
  { value: 'sliding_door', label: 'Sliding door' },
  { value: 'window', label: 'Window' },
  { value: 'opening', label: 'Opening' },
];

const WALL_OPTIONS: { value: WallSide; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

const ALIGN_OPTIONS: { value: AlignMode; label: string }[] = [
  { value: 'center', label: 'Centre' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'custom', label: 'Custom offset' },
];

const TRACK_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
];

const SWING_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Not applicable' },
  { value: 'inward', label: 'Inward' },
  { value: 'outward', label: 'Outward' },
];

/** Human-readable title for an opening type, matching the form's option labels. */
function openingTitle(type: OpeningType): string {
  return OPENING_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

/** Swing is meaningful for PA and sliding doors only. */
function hasSwing(type: OpeningType): boolean {
  return type === 'pa_door' || type === 'sliding_door';
}

/** The five building fields, in the order the form presents them. */
function buildingFields(shed: ShedConfig): FieldSpec[] {
  // Dimension fields carry `unit` so the popover shows them in the same unit the
  // form does; `roofPitchDeg`/`bays` are plain numbers and are shown verbatim.
  const unit = shed.displayUnit;
  return [
    { key: 'span', label: 'Span', type: 'number', value: shed.span, min: 1000, step: 50, unit },
    { key: 'length', label: 'Length', type: 'number', value: shed.length, min: 1000, step: 50, unit },
    { key: 'height', label: 'Wall height', type: 'number', value: shed.height, min: 1000, step: 50, unit },
    { key: 'roofPitchDeg', label: 'Roof pitch (°)', type: 'number', value: shed.roofPitchDeg, min: 0, max: 45, step: 0.5 },
    { key: 'bays', label: 'Bays', type: 'number', value: shed.bays, min: 2, max: 30, step: 1 },
  ];
}

/** The fields for one opening; swing appears only for types that have it. */
function openingFields(opening: Opening, unit: DisplayUnit): FieldSpec[] {
  const fields: FieldSpec[] = [
    { key: 'type', label: 'Type', type: 'select', value: opening.type, options: OPENING_TYPE_OPTIONS },
    { key: 'width', label: 'Width', type: 'number', value: opening.width, min: 100, unit },
    { key: 'height', label: 'Height', type: 'number', value: opening.height, min: 100, unit },
    { key: 'sill', label: 'Sill', type: 'number', value: opening.sill, min: 0, unit },
    { key: 'wall', label: 'Wall', type: 'select', value: opening.wall, options: WALL_OPTIONS },
    { key: 'align', label: 'Align', type: 'select', value: opening.align, options: ALIGN_OPTIONS },
    // Offset only applies to a custom alignment (spec §5.2), so it is disabled
    // for centre/left/right.
    {
      key: 'offset',
      label: 'Offset',
      type: 'number',
      value: opening.offset ?? 0,
      min: 0,
      unit,
      disabled: opening.align !== 'custom',
    },
  ];
  if (hasSwing(opening.type)) {
    fields.push({
      key: 'swing',
      label: 'Swing',
      type: 'select',
      value: opening.swing ?? '',
      options: SWING_OPTIONS,
    });
  }
  // The spec orders the track below swing: swing describes how the leaf moves,
  // track describes what it runs on, so the movement reads before its hardware.
  if (opening.type === 'sliding_door') {
    fields.push({
      key: 'track',
      label: 'Track',
      type: 'select',
      value: opening.track ?? 'none',
      options: TRACK_OPTIONS,
    });
  }
  return fields;
}

/**
 * Display titles for the eleven option kinds, matching the catalogue's labels.
 */
const OPTION_TITLES: Record<OptionKind, string> = {
  skylight: 'Skylight',
  mezzanine: 'Mezzanine',
  awning: 'Awning',
  outrigger: 'Outrigger',
  dividing_wall: 'Dividing wall',
  gable_infill: 'Gable infill',
  stable: 'Stable',
  carry_beam: 'Carry beam',
  horizontal_cladding: 'Cladding',
  overhang: 'Overhang',
  cantilever: 'Cantilever',
  misc_option: 'Miscellaneous option',
};

/**
 * The part of a shed an option belongs to, used to group the place buttons.
 *
 * Purely a cataloguing aid — the BOM and the geometry never read it — so it can
 * be regrouped without touching what a quote costs.
 */
export type OptionGroup = 'roof' | 'wall' | 'interior' | 'frame' | 'extras';

/** The heading each group is shown under, in the order the groups are offered. */
export const OPTION_GROUP_LABELS: { value: OptionGroup; label: string }[] = [
  { value: 'roof', label: 'Roof' },
  { value: 'wall', label: 'Walls' },
  { value: 'interior', label: 'Interior' },
  { value: 'frame', label: 'Frame' },
  { value: 'extras', label: 'Extras' },
];

/**
 * The eleven option kinds with their display labels and group, in the order a
 * cataloguing UI should offer them (spec §5.4).
 *
 * The single source of truth for the place-option buttons and the options list,
 * which both derive their labels from this list so the two cannot drift apart —
 * the same rule `OPENING_TYPE_OPTIONS` keeps for doors.
 */
export const OPTION_KIND_OPTIONS: { value: OptionKind; label: string; group: OptionGroup }[] = [
  { value: 'skylight', label: OPTION_TITLES.skylight, group: 'roof' },
  { value: 'overhang', label: OPTION_TITLES.overhang, group: 'roof' },
  { value: 'cantilever', label: OPTION_TITLES.cantilever, group: 'roof' },
  { value: 'awning', label: OPTION_TITLES.awning, group: 'wall' },
  { value: 'outrigger', label: OPTION_TITLES.outrigger, group: 'wall' },
  { value: 'horizontal_cladding', label: OPTION_TITLES.horizontal_cladding, group: 'wall' },
  { value: 'gable_infill', label: OPTION_TITLES.gable_infill, group: 'wall' },
  { value: 'stable', label: OPTION_TITLES.stable, group: 'wall' },
  { value: 'mezzanine', label: OPTION_TITLES.mezzanine, group: 'interior' },
  { value: 'dividing_wall', label: OPTION_TITLES.dividing_wall, group: 'interior' },
  { value: 'carry_beam', label: OPTION_TITLES.carry_beam, group: 'frame' },
  { value: 'misc_option', label: OPTION_TITLES.misc_option, group: 'extras' },
];

const CORNER_OPTIONS: { value: string; label: string }[] = [
  { value: 'front_left', label: 'Front left' },
  { value: 'front_right', label: 'Front right' },
  { value: 'back_left', label: 'Back left' },
  { value: 'back_right', label: 'Back right' },
];

const AXIS_OPTIONS: { value: string; label: string }[] = [
  { value: 'x', label: 'Across the span' },
  { value: 'y', label: 'Along the length' },
];

const ON_OFF_OPTIONS: { value: string; label: string }[] = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
];

const END_OPTIONS: { value: string; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
];

/**
 * The editable fields for one option. Only the anchors and sizes the kind
 * actually has appear — a gable infill is a choice of end and nothing else.
 */
function optionFields(option: ShedOption, shed: ShedConfig): FieldSpec[] {
  const unit = shed.displayUnit;
  switch (option.kind) {
    case 'skylight':
      return [
        { key: 'bay', label: 'Bay', type: 'number', value: option.bay, min: 0, step: 1 },
        { key: 'alongBay', label: 'Position in bay', type: 'number', value: option.alongBay, min: 0.1, max: 0.9, step: 0.05 },
        { key: 'width', label: 'Width', type: 'number', value: option.width, min: 300, unit },
        { key: 'height', label: 'Height', type: 'number', value: option.height, min: 300, unit },
      ];
    case 'mezzanine':
      return [
        { key: 'corner', label: 'Corner', type: 'select', value: option.corner, options: CORNER_OPTIONS },
        { key: 'width', label: 'Width', type: 'number', value: option.width, min: 1000, unit },
        { key: 'depth', label: 'Depth', type: 'number', value: option.depth, min: 1000, unit },
        { key: 'level', label: 'Level', type: 'number', value: option.level, min: 2100, unit },
      ];
    case 'awning':
      return [
        { key: 'wall', label: 'Wall', type: 'select', value: option.wall, options: WALL_OPTIONS },
        { key: 'align', label: 'Align', type: 'select', value: option.align, options: ALIGN_OPTIONS },
        {
          key: 'offset',
          label: 'Offset',
          type: 'number',
          value: option.offset ?? 0,
          min: 0,
          unit,
          disabled: option.align !== 'custom',
        },
        { key: 'width', label: 'Width', type: 'number', value: option.width, min: 1000, unit },
        { key: 'depth', label: 'Depth', type: 'number', value: option.depth, min: 500, unit },
      ];
    case 'outrigger':
      return [
        { key: 'wall', label: 'Wall', type: 'select', value: option.wall, options: WALL_OPTIONS },
        { key: 'bay', label: 'Bay', type: 'number', value: option.bay, min: 0, step: 1 },
        { key: 'length', label: 'Length', type: 'number', value: option.length, min: 500, unit },
      ];
    case 'dividing_wall':
      return [
        { key: 'axis', label: 'Runs', type: 'select', value: option.axis, options: AXIS_OPTIONS },
        { key: 'at', label: 'At', type: 'number', value: option.at, min: 300, unit },
        { key: 'height', label: 'Height', type: 'number', value: option.height, min: 1000, unit },
      ];
    case 'gable_infill':
      return [
        { key: 'end', label: 'End', type: 'select', value: option.end, options: END_OPTIONS },
      ];
    case 'stable':
      return [
        { key: 'wall', label: 'Wall', type: 'select', value: option.wall, options: WALL_OPTIONS },
        { key: 'align', label: 'Align', type: 'select', value: option.align, options: ALIGN_OPTIONS },
        {
          key: 'offset', label: 'Offset', type: 'number', value: option.offset ?? 0,
          min: 0, unit, disabled: option.align !== 'custom',
        },
        { key: 'width', label: 'Width', type: 'number', value: option.width, min: 1500, unit },
        { key: 'depth', label: 'Depth', type: 'number', value: option.depth, min: 1200, unit },
        { key: 'height', label: 'Height', type: 'number', value: option.height, min: 1800, unit },
        // Four On/Off selects rather than a new boolean field type: `FieldSpec`
        // has no boolean, and adding one would touch every renderer for one use.
        { key: 'panels.left', label: 'Left panel', type: 'select', value: String(option.panels.left), options: ON_OFF_OPTIONS },
        { key: 'panels.right', label: 'Right panel', type: 'select', value: String(option.panels.right), options: ON_OFF_OPTIONS },
        { key: 'panels.front', label: 'Front panel', type: 'select', value: String(option.panels.front), options: ON_OFF_OPTIONS },
        { key: 'panels.back', label: 'Back panel', type: 'select', value: String(option.panels.back), options: ON_OFF_OPTIONS },
      ];
    case 'carry_beam': {
      // "Spans" lists the openings on this beam's own wall, plus an explicit
      // "open" choice. Offering an opening on another wall would be a choice
      // the normaliser immediately discards.
      const spansOptions = [
        { value: '', label: 'Open (no door)' },
        ...shed.openings
          .filter((opening) => opening.wall === option.wall)
          .map((opening) => ({
            value: opening.id,
            label: `${opening.type.replace(/_/g, ' ')} · ${Math.round(opening.width)} mm`,
          })),
      ];
      return [
        { key: 'wall', label: 'Wall', type: 'select', value: option.wall, options: WALL_OPTIONS },
        { key: 'beginBay', label: 'Bay', type: 'number', value: option.beginBay, min: 0, step: 1 },
        {
          key: 'openingId',
          label: 'Spans',
          type: 'select',
          value: option.openingId ?? '',
          options: spansOptions,
        },
      ];
    }
    case 'horizontal_cladding':
      return [
        { key: 'wall', label: 'Wall', type: 'select', value: option.wall, options: WALL_OPTIONS },
        { key: 'from', label: 'From', type: 'number', value: option.from, min: 0, unit },
        { key: 'to', label: 'To', type: 'number', value: option.to, min: 100, unit },
      ];
    case 'overhang':
      return [
        { key: 'wall', label: 'Wall', type: 'select', value: option.wall, options: WALL_OPTIONS },
        { key: 'depth', label: 'Depth', type: 'number', value: option.depth, min: 300, unit },
      ];
    case 'cantilever':
      return [
        { key: 'wall', label: 'Wall', type: 'select', value: option.wall, options: WALL_OPTIONS },
        { key: 'bay', label: 'Bay', type: 'number', value: option.bay, min: 0, step: 1 },
        { key: 'length', label: 'Length', type: 'number', value: option.length, min: 500, unit },
      ];
    case 'misc_option':
      return [
        { key: 'quantity', label: 'Quantity', type: 'number', value: option.quantity, min: 1, max: 999, step: 1 },
      ];
  }
}

/**
 * Describe `selection` against `shed`. An unknown opening or option id, or a
 * `none` selection, yields an empty description with `kind: 'none'`.
 */
export function describeSelection(shed: ShedConfig, selection: Selection): SelectionDescription {
  if (selection.kind === 'none') {
    return { title: '', kind: 'none', fields: [] };
  }

  if (selection.kind === 'building') {
    return { title: 'Building', kind: 'building', fields: buildingFields(shed) };
  }

  if (selection.kind === 'option') {
    const option = shed.options.find((o) => o.id === selection.id);
    if (!option) {
      return { title: '', kind: 'none', fields: [] };
    }
    return {
      title: OPTION_TITLES[option.kind],
      kind: 'option',
      id: option.id,
      fields: optionFields(option, shed),
    };
  }

  const opening = shed.openings.find((o) => o.id === selection.id);
  if (!opening) {
    return { title: '', kind: 'none', fields: [] };
  }

  return {
    title: openingTitle(opening.type),
    kind: 'opening',
    id: opening.id,
    fields: openingFields(opening, shed.displayUnit),
  };
}

/**
 * Place `popover` beside `anchor`, flipping/clamping so it stays inside
 * `viewport`.
 *
 * Placement prefers the right of the anchor (`x = anchor.x + gap`); when that
 * would overflow the viewport's right edge it flips to the left
 * (`x = anchor.x − popover.width − gap`). Both axes are then clamped into the
 * viewport, with `Math.max(0, …)` pinning a popover larger than the viewport to
 * the origin rather than letting it go negative.
 *
 * Pure geometry (screen pixels): a rectangle fitted inside another rectangle.
 */
export function popoverPosition(
  anchor: { x: number; y: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
): { x: number; y: number } {
  const right = anchor.x + gap;
  const x = right + popover.width <= viewport.width ? right : anchor.x - popover.width - gap;

  const maxX = Math.max(0, viewport.width - popover.width);
  const maxY = Math.max(0, viewport.height - popover.height);

  return {
    x: Math.min(Math.max(x, 0), maxX),
    y: Math.min(Math.max(anchor.y, 0), maxY),
  };
}

/** How far, in mm, a door's anchor sits outside its wall, so the card clears it. */
const ANCHOR_OUTSET_MM = 600;

/** The unit vector pointing out of the building for each wall (away from centre). */
const WALL_OUTWARD: Record<WallSide, { x: number; y: number }> = {
  front: { x: 0, y: -1 },
  back: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Where the selected object's floating affordance buttons (the wrench and the
 * door-actions ⋮) belong, as top-left screen pixels.
 *
 * Both are pushed **outward** from the door, along its wall's normal, and
 * stacked along that same normal — so they sit in the half-plane outside the
 * building and can never cover the door. This matters because the door is a thin
 * line in plan: a button anchored at the door's *centre* (as the popover is)
 * overlaps the door for any door wider than the button, and a press meant to
 * start a drag lands on the button instead and does nothing. A fixed
 * screen-pixel clearance (not a millimetre offset) keeps the gap constant at
 * every zoom level.
 *
 * `door` is the door's on-screen rect in pixels; `sizePx` is the square button
 * size, `gapPx` the space between the two buttons, and `clearancePx` how far the
 * first button's centre sits outside the wall line.
 */
export function affordancePositions(
  door: { x: number; y: number; width: number; height: number },
  wall: WallSide,
  sizePx = 44,
  gapPx = 8,
  clearancePx = 56,
): { wrench: { x: number; y: number }; dots: { x: number; y: number } } {
  const outward = WALL_OUTWARD[wall];
  const centre = { x: door.x + door.width / 2, y: door.y + door.height / 2 };
  const half = sizePx / 2;
  const at = (distance: number) => ({
    x: Math.round(centre.x + outward.x * distance - half),
    y: Math.round(centre.y + outward.y * distance - half),
  });
  return {
    wrench: at(clearancePx),
    dots: at(clearancePx + sizePx + gapPx),
  };
}

/**
 * The plan-millimetre point the selection popover should sit beside, or `null`
 * when there is nothing to anchor to (a `none` selection or a dangling opening
 * id). This is the single source of truth for *where* the popover belongs; the
 * caller converts the result to container pixels with its own camera transform
 * (`screen = position + plan * scale`) and passes it to `popoverPosition`.
 *
 * A selected **door** anchors at its plan rect's midpoint, pushed slightly
 * outward (away from the building centre) along its wall's normal, so the card
 * sits just outside the door rather than on top of it. A selected **building**
 * anchors at the outline's top-left corner — the plan origin, and the corner the
 * plan is dimensioned from.
 *
 * The result is rounded to whole millimetres, matching the canonical unit.
 */
export function selectionAnchor(
  geometry: PlanGeometry,
  selection: Selection,
): { x: number; y: number } | null {
  if (selection.kind === 'none') return null;

  if (selection.kind === 'building') {
    return { x: Math.round(geometry.outline.x), y: Math.round(geometry.outline.y) };
  }

  if (selection.kind === 'option') {
    const placed = geometry.options.find((option) => option.id === selection.id);
    if (placed === undefined) return null;
    return {
      x: Math.round(placed.rect.x + placed.rect.width / 2),
      y: Math.round(placed.rect.y + placed.rect.height / 2),
    };
  }

  const opening = geometry.openings.find((o) => o.id === selection.id);
  if (opening === undefined) return null;

  const { rect, wall } = opening;
  const outward = WALL_OUTWARD[wall];
  return {
    x: Math.round(rect.x + rect.width / 2 + outward.x * ANCHOR_OUTSET_MM),
    y: Math.round(rect.y + rect.height / 2 + outward.y * ANCHOR_OUTSET_MM),
  };
}
