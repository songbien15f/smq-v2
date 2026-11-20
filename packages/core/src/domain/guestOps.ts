/**
 * Design operations for the Guest assistant (plan G-g S10).
 *
 * ## One write path
 *
 * The assistant does not get its own way to change a design: it emits a list of these operations, the
 * **server** applies them here, and the page applies the same list through the same functions. So a
 * sentence like "make it 9 metres wide" and a person typing 9.0 in the width box end in the identical
 * `GuestDesignInput` — one code path, one set of limits, one place to be right.
 *
 * ## Why this is in core and not in the page
 *
 * The server has to try a change set before it answers, because a model will happily suggest an
 * opening 300 mm wide or a width outside the book. Doing that on the server means the check happens
 * once, against the same functions the page uses — and a change set that fails never reaches a
 * browser at all.
 *
 * ## Nothing here validates silently away
 *
 * `applyGuestOps` returns what it could not do and why, rather than dropping an operation. The model
 * is told what failed so it can say so, and the page shows the same list.
 *
 * Pure TypeScript: no React, Next.js, database or HTTP.
 */

import {
  addBay,
  centredGuestOffset,
  nearestLegalGuestOffset,
  refitGuestOpenings,
  removeBay,
  resizeGuestOpening,
  setBayWidth,
  setRoof,
  type GuestCladding,
  type GuestColourChoice,
  type GuestDesignInput,
  type GuestKneeBrace,
  type GuestOpeningKind,
  type GuestOpeningSpec,
  type GuestRoof,
  type GuestSite,
  type GuestSlab,
  type GuestBuildingTypeSpec,
} from './guest';
import type { WallSide } from './types';

/**
 * One change the assistant may ask for.
 *
 * Every kind maps to an operation a person can also perform; there is deliberately no "set the whole
 * design" op, because that would let a model replace work the guest did with a guess.
 */
export type GuestOp =
  | { op: 'setSpan'; mm: number }
  | { op: 'setHeight'; mm: number }
  | { op: 'setPitch'; degrees: number }
  | { op: 'setRoof'; roof: GuestRoof }
  | { op: 'setSlab'; slab: GuestSlab }
  | { op: 'setKneeBrace'; kneeBrace: GuestKneeBrace }
  | { op: 'setCladding'; cladding: GuestCladding }
  | { op: 'addBay'; atIndex?: number }
  | { op: 'setBayWidth'; index: number; mm: number }
  | { op: 'removeBay'; index: number }
  | { op: 'addOpening'; kind: GuestOpeningKind; wall: WallSide; size: { width: number; height: number }; offset?: number }
  | { op: 'removeOpening'; index: number }
  | { op: 'moveOpening'; index: number; wall: WallSide; offset: number }
  | { op: 'resizeOpening'; index: number; size: { width: number; height: number } }
  | { op: 'setColours'; walls?: string; roofColour?: string; trim?: Partial<GuestColourChoice['trim']> }
  | { op: 'setType'; typeId: string };

/** One operation that could not be applied, in words the model and the page can both repeat. */
export interface GuestOpFailure {
  index: number;
  reason: string;
}

export interface GuestOpResult {
  design: GuestDesignInput;
  failures: GuestOpFailure[];
  /** How many operations actually changed the design. */
  applied: number;
}

/** The opening sizes each kind may have, from the type's own chips. `null` when the kind is not offered. */
function allowedSizes(type: GuestBuildingTypeSpec, kind: GuestOpeningKind): { width: number; height: number }[] | null {
  const rule = type.config.openings.rules.find((r) => r.type === kind);
  return rule === undefined ? null : rule.sizes;
}

/**
 * Apply `ops` to `design` in order, collecting the ones that cannot be done.
 *
 * A failed operation does **not** stop the rest: a model that suggests three changes and gets one
 * wrong should still be able to make the other two, and the page tells the guest which one it could
 * not do. `setType` is refused outright — switching building starts a new design from that type's
 * defaults, which is a decision for the person, not for a sentence.
 */
export function applyGuestOps(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  ops: readonly GuestOp[],
): GuestOpResult {
  let next = design;
  const failures: GuestOpFailure[] = [];
  let applied = 0;

  const fail = (index: number, reason: string) => failures.push({ index, reason });

  /**
   * A change to the building's size moves the walls under the openings. Slide each opening to the
   * nearest legal spot; one that fits nowhere is reported against the op that caused it. The size
   * change itself still counts as applied — the page shows that opening as needing attention, exactly
   * as it does when the guest changes the size by hand.
   */
  const refit = (index: number) => {
    const fitted = refitGuestOpenings(next, type);
    next = fitted.design;
    for (const i of fitted.stuck) {
      const o = next.openings[i];
      if (o !== undefined) fail(index, `Opening ${i + 1} (${o.type} on the ${o.wall} wall) no longer fits after this change.`);
    }
  };

  ops.forEach((op, index) => {
    switch (op.op) {
      case 'setSpan':
      case 'setHeight': {
        const key = op.op === 'setSpan' ? 'span' : 'height';
        const range = op.op === 'setSpan' ? type.config.limits.span : type.config.limits.height;
        if (!Number.isFinite(op.mm) || op.mm < range.min || op.mm > range.max) {
          fail(index, `A ${key} of ${op.mm} mm is outside ${range.min}–${range.max} mm.`);
          return;
        }
        next = { ...next, building: { ...next.building, [key]: Math.round(op.mm) } };
        refit(index);
        applied += 1;
        return;
      }

      case 'setPitch': {
        const pitches = type.config.limits.pitchesByRoof[next.building.roof] ?? [];
        if (!pitches.some((p) => Math.abs(p - op.degrees) < 1e-6)) {
          fail(index, `A ${op.degrees}° pitch is not one of ${pitches.join(', ')}°.`);
          return;
        }
        next = { ...next, building: { ...next.building, pitchDeg: op.degrees } };
        applied += 1;
        return;
      }

      case 'setRoof': {
        if (!type.config.roofs.includes(op.roof)) {
          fail(index, `This building does not come with a ${op.roof} roof.`);
          return;
        }
        next = setRoof(next, type, op.roof);
        refit(index);
        applied += 1;
        return;
      }

      case 'setSlab':
        next = { ...next, building: { ...next.building, slab: op.slab } };
        applied += 1;
        return;

      case 'setKneeBrace':
        next = { ...next, building: { ...next.building, kneeBrace: op.kneeBrace } };
        applied += 1;
        return;

      case 'setCladding':
        next = { ...next, building: { ...next.building, cladding: op.cladding } };
        applied += 1;
        return;

      case 'addBay': {
        const before = next.building.bayWidths.length;
        next = addBay(next, type, op.atIndex);
        if (next.building.bayWidths.length === before) {
          fail(index, `This building takes at most ${type.config.limits.bays.max} bays.`);
          return;
        }
        refit(index);
        applied += 1;
        return;
      }

      case 'setBayWidth': {
        if (op.index < 0 || op.index >= next.building.bayWidths.length) {
          fail(index, `There is no bay ${op.index + 1}.`);
          return;
        }
        const range = type.config.limits.bayWidth;
        if (!Number.isFinite(op.mm) || op.mm < range.min || op.mm > range.max) {
          fail(index, `A bay of ${op.mm} mm is outside ${range.min}–${range.max} mm.`);
          return;
        }
        next = setBayWidth(next, op.index, op.mm);
        refit(index);
        applied += 1;
        return;
      }

      case 'removeBay': {
        const before = next.building.bayWidths.length;
        next = removeBay(next, op.index);
        if (next.building.bayWidths.length === before) {
          fail(index, `That bay cannot be removed (a building needs at least ${type.config.limits.bays.min}).`);
          return;
        }
        refit(index);
        applied += 1;
        return;
      }

      case 'addOpening': {
        const sizes = allowedSizes(type, op.kind);
        if (sizes === null) {
          fail(index, `This building does not take a ${op.kind}.`);
          return;
        }
        if (!sizes.some((s) => s.width === op.size.width && s.height === op.size.height)) {
          fail(index, `That ${op.kind} size is not one of the offered sizes.`);
          return;
        }
        const rule = type.config.openings.rules.find((r) => r.type === op.kind);
        const count = next.openings.filter((o) => o.type === op.kind).length;
        if (rule !== undefined && count >= rule.max) {
          fail(index, `This building takes at most ${rule.max} × ${op.kind}.`);
          return;
        }
        const opening: GuestOpeningSpec = {
          type: op.kind,
          wall: op.wall,
          offset: 0,
          size: { ...op.size },
          ...(op.kind === 'roller_door' ? { motorised: false } : {}),
        };
        // No position named means centred, as the page's own add button does; either way the door
        // lands on the nearest legal spot, never flush against a corner post.
        const wanted = op.offset ?? centredGuestOffset(next, type, op.wall, op.size.width);
        if (wanted !== null) {
          const fit = nearestLegalGuestOffset(next, type, next.openings.length, opening, wanted);
          if (!fit.ok) {
            fail(index, `The ${op.kind} does not fit on the ${op.wall} wall: ${fit.reason}`);
            return;
          }
          opening.offset = fit.offset;
        }
        next = { ...next, openings: [...next.openings, opening] };
        applied += 1;
        return;
      }

      case 'removeOpening': {
        if (op.index < 0 || op.index >= next.openings.length) {
          fail(index, `There is no opening ${op.index + 1}.`);
          return;
        }
        next = { ...next, openings: next.openings.filter((_, i) => i !== op.index) };
        applied += 1;
        return;
      }

      case 'moveOpening': {
        const opening = next.openings[op.index];
        if (opening === undefined) {
          fail(index, `There is no opening ${op.index + 1}.`);
          return;
        }
        const moved: GuestOpeningSpec = { ...opening, wall: op.wall, offset: Math.max(0, Math.round(op.offset)) };
        const fit = nearestLegalGuestOffset(next, type, op.index, moved, moved.offset);
        if (!fit.ok && fit.reason !== 'Fix the building size first.') {
          fail(index, `The opening does not fit on the ${op.wall} wall: ${fit.reason}`);
          return;
        }
        if (fit.ok) moved.offset = fit.offset;
        next = { ...next, openings: next.openings.map((o, i) => (i === op.index ? moved : o)) };
        applied += 1;
        return;
      }

      case 'resizeOpening': {
        const opening = next.openings[op.index];
        if (opening === undefined) {
          fail(index, `There is no opening ${op.index + 1}.`);
          return;
        }
        const sizes = allowedSizes(type, opening.type);
        if (sizes === null || !sizes.some((s) => s.width === op.size.width && s.height === op.size.height)) {
          fail(index, `That ${opening.type} size is not one of the offered sizes.`);
          return;
        }
        const resized = resizeGuestOpening(next, type, op.index, op.size);
        if (!resized.ok) {
          fail(index, `The ${opening.type} cannot be that size on the ${opening.wall} wall: ${resized.reason}`);
          return;
        }
        next = resized.design;
        applied += 1;
        return;
      }

      case 'setColours': {
        const allowed = type.config.colours.allowed;
        const bad = [op.walls, op.roofColour, op.trim?.barge, op.trim?.gutter, op.trim?.downpipe].filter(
          (name): name is string => name !== undefined && !allowed.includes(name),
        );
        if (bad.length > 0) {
          fail(index, `${bad.join(', ')} is not one of the colours offered.`);
          return;
        }
        next = {
          ...next,
          colours: {
            walls: op.walls ?? next.colours.walls,
            roof: op.roofColour ?? next.colours.roof,
            trim: {
              barge: op.trim?.barge ?? next.colours.trim.barge,
              gutter: op.trim?.gutter ?? next.colours.trim.gutter,
              downpipe: op.trim?.downpipe ?? next.colours.trim.downpipe,
            },
          },
        };
        applied += 1;
        return;
      }

      case 'setType':
        // Switching building restarts the design from that type's defaults and can lose a guest's
        // work. Deciding that is the person's, not the assistant's.
        fail(index, 'Changing the building type is for the guest to do on step 1.');
        return;
    }
  });

  return { design: next, failures, applied };
}

/** The site, applied separately because the assistant is allowed to fill it from a sentence. */
export function applyGuestSite(design: GuestDesignInput, site: GuestSite | undefined): GuestDesignInput {
  if (site === undefined) return design;
  return { ...design, site };
}
