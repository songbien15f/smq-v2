/**
 * Tab ③'s edits to a Guest design (plan G-a S6), as pure functions: no React, no store.
 *
 * Every position an opening ends up at is one core's `placeOpening` accepts (R1 margins, R2 no
 * overlap, R10 roller minimum) — the page never decides on its own that a spot is legal. When the
 * spot the guest asked for is refused, the opening goes to the **nearest** legal spot on that wall;
 * when the wall has none, the edit is refused with a sentence the page shows.
 *
 * Offsets are wall-local millimetres from the wall's left corner seen from outside, the same as
 * `Opening.offset`, so `planPointToWallU` (a point on the plan → offset) needs no translation.
 */

import {
  configFromGuestDesign,
  nearestLegalGuestOffset,
  refitGuestOpenings,
  resizeGuestOpening,
  wallLength,
  withDimensions,
  GUEST_SNAP_MM,
  type DimensionedShed,
  type GuestBuildingTypeSpec,
  type GuestDesignInput,
  type GuestOpeningKind,
  type GuestOpeningRuleSpec,
  type GuestOpeningSpec,
  type WallSide,
} from '@sq/core/domain';

/** Drag and position chips land on this grid before the placement rules are asked. */
export const SNAP_MM = GUEST_SNAP_MM;
/** `placeOpening`'s R1 margin; used only to aim the Left/Right chips, never to decide legality. */
const CORNER_AIM_MM = 100;

export const WALLS: readonly WallSide[] = ['front', 'right', 'back', 'left'];

export const WALL_NAMES: Record<WallSide, string> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
};

export const OPENING_NAMES: Record<GuestOpeningKind, string> = {
  roller_door: 'Roller door',
  pa_door: 'Personal access door 820 mm',
  sliding_door: 'Sliding door',
  window: 'Window',
};

/** Short names for tight places (the plan's popover, a door's own row). */
export const OPENING_SHORT: Record<GuestOpeningKind, string> = {
  roller_door: 'Roller door',
  pa_door: 'PA door',
  sliding_door: 'Sliding door',
  window: 'Window',
};

export type Fit = { ok: true; design: GuestDesignInput } | { ok: false; reason: string };

/** The engine's view of a design, or null when its size cannot be built (core's own check). */
export function shedOf(design: GuestDesignInput, type: GuestBuildingTypeSpec): DimensionedShed | null {
  return withDimensions(configFromGuestDesign(design, type));
}

/** `9000` → `9.0 m`; `2950` → `2.95 m`. One decimal unless the second one carries information. */
export function metresLabel(mm: number): string {
  const m = mm / 1000;
  const two = m.toFixed(2);
  return `${two.endsWith('0') ? m.toFixed(1) : two} m`;
}

/** `3000 × 2100` → `3.0 × 2.1 m`. */
export function sizeLabel(size: { width: number; height: number }): string {
  return `${(size.width / 1000).toFixed(size.width % 100 === 0 ? 1 : 2)} × ${(size.height / 1000).toFixed(size.height % 100 === 0 ? 1 : 2)} m`;
}

function withOpening(design: GuestDesignInput, index: number, spec: GuestOpeningSpec): GuestDesignInput {
  const openings = design.openings.slice();
  openings[index] = spec;
  return { ...design, openings };
}

/** Where on a wall the centre of an opening `width` wide would start. */
function centreOf(shed: DimensionedShed, wall: WallSide, width: number): number {
  return (wallLength(shed, wall) - width) / 2;
}

export function ruleFor(type: GuestBuildingTypeSpec, kind: GuestOpeningKind): GuestOpeningRuleSpec | undefined {
  return type.config.openings.rules.find((r) => r.type === kind);
}

export function countOf(design: GuestDesignInput, kind: GuestOpeningKind): number {
  return design.openings.filter((o) => o.type === kind).length;
}

/**
 * Add an opening of `kind` (first size chip), centred on `wall` or as near the centre as it fits — or at
 * `near` (a wall offset, from a tap on the plan). With no wall given, the type's default wall is tried
 * first, then the others.
 */
export function addOpening(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  kind: GuestOpeningKind,
  wall?: WallSide,
  near?: number,
): Fit {
  const rule = ruleFor(type, kind);
  if (rule === undefined) {
    return { ok: false, reason: type.config.openings.lockedReason ?? 'This building takes no doors or windows.' };
  }
  if (countOf(design, kind) >= rule.max) {
    return { ok: false, reason: `This building takes at most ${rule.max} × ${OPENING_SHORT[kind].toLowerCase()}.` };
  }
  const size = rule.sizes[0];
  if (size === undefined) return { ok: false, reason: 'No size is offered for this opening.' };

  const shed = shedOf(design, type);
  if (shed === null) return { ok: false, reason: 'Fix the building size first.' };

  const walls = wall !== undefined ? [wall] : [rule.defaultWall, ...WALLS.filter((w) => w !== rule.defaultWall)];
  const index = design.openings.length;
  let firstReason: string | null = null;
  for (const w of walls) {
    const spec: GuestOpeningSpec = {
      type: kind,
      wall: w,
      offset: 0,
      size: { ...size },
      ...(kind === 'roller_door' ? { motorised: false } : {}),
    };
    const wanted = near !== undefined && w === wall ? near - size.width / 2 : centreOf(shed, w, size.width);
    const fit = nearestLegalGuestOffset(design, type, index, spec, snap(wanted));
    if (fit.ok) return { ok: true, design: withOpening(design, index, { ...spec, offset: fit.offset }) };
    firstReason ??= fit.reason;
  }
  return { ok: false, reason: firstReason ?? 'There is no room for it.' };
}

export function removeOpening(design: GuestDesignInput, index: number): GuestDesignInput {
  return { ...design, openings: design.openings.filter((_, i) => i !== index) };
}

/** Remove the last opening of `kind` (the stepper's −). */
export function removeLastOf(design: GuestDesignInput, kind: GuestOpeningKind): GuestDesignInput {
  for (let i = design.openings.length - 1; i >= 0; i--) {
    if (design.openings[i]!.type === kind) return removeOpening(design, i);
  }
  return design;
}

export function snap(mm: number): number {
  return Math.round(mm / SNAP_MM) * SNAP_MM;
}

/** Move opening `index` to the legal spot nearest `wanted` on its wall (a drag, a position chip). */
export function moveOpening(design: GuestDesignInput, type: GuestBuildingTypeSpec, index: number, wanted: number): Fit {
  const spec = design.openings[index];
  if (spec === undefined) return { ok: false, reason: 'That opening no longer exists.' };
  const fit = nearestLegalGuestOffset(design, type, index, spec, wanted);
  return fit.ok ? { ok: true, design: withOpening(design, index, { ...spec, offset: fit.offset }) } : fit;
}

export type Position = 'left' | 'centre' | 'right';

/** Aim for a wall's left end, centre or right end (seen from outside), then the nearest legal spot. */
export function positionOpening(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  index: number,
  position: Position,
): Fit {
  const spec = design.openings[index];
  const shed = shedOf(design, type);
  if (spec === undefined || shed === null) return { ok: false, reason: 'Fix the building size first.' };
  const run = wallLength(shed, spec.wall);
  const wanted =
    position === 'left' ? CORNER_AIM_MM : position === 'right' ? run - spec.size.width - CORNER_AIM_MM : (run - spec.size.width) / 2;
  return moveOpening(design, type, index, wanted);
}

/** Which position chip describes where an opening sits now, if any. */
export function positionOf(design: GuestDesignInput, type: GuestBuildingTypeSpec, index: number): Position | null {
  const spec = design.openings[index];
  const shed = shedOf(design, type);
  if (spec === undefined || shed === null) return null;
  const run = wallLength(shed, spec.wall);
  const free = run - spec.size.width;
  if (Math.abs(spec.offset - free / 2) <= SNAP_MM) return 'centre';
  if (spec.offset <= CORNER_AIM_MM + SNAP_MM) return 'left';
  if (spec.offset >= free - CORNER_AIM_MM - SNAP_MM) return 'right';
  return null;
}

/** Put opening `index` on another wall, centred or as near the centre as it fits. */
export function setOpeningWall(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  index: number,
  wall: WallSide,
): Fit {
  const spec = design.openings[index];
  const shed = shedOf(design, type);
  if (spec === undefined || shed === null) return { ok: false, reason: 'Fix the building size first.' };
  const next: GuestOpeningSpec = { ...spec, wall };
  const fit = nearestLegalGuestOffset(design, type, index, next, snap(centreOf(shed, wall, spec.size.width)));
  return fit.ok ? { ok: true, design: withOpening(design, index, { ...next, offset: fit.offset }) } : fit;
}

/** Change opening `index` to another size chip, keeping its centre where it was if it still fits. */
export function setOpeningSize(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  index: number,
  size: { width: number; height: number },
): Fit {
  return resizeGuestOpening(design, type, index, size);
}

export function setMotorised(design: GuestDesignInput, index: number, motorised: boolean): GuestDesignInput {
  const spec = design.openings[index];
  if (spec === undefined || spec.type !== 'roller_door') return design;
  return withOpening(design, index, { ...spec, motorised });
}

/**
 * After the building changes size, slide each opening to the nearest spot that is still legal, in
 * order. One that fits nowhere on its wall stays where it was, and `validateGuestDesign` reports it.
 */
export function refitOpenings(design: GuestDesignInput, type: GuestBuildingTypeSpec): GuestDesignInput {
  return refitGuestOpenings(design, type).design;
}
