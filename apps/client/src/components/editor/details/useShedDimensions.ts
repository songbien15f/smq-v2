'use client';

import { reconcileBays, shouldWipeOptions } from '@sq/core/domain';
import type { ShedConfig } from '@sq/core/domain';
import type { Catalogue } from '@sq/core/pricing';
import { bookBounds } from '../bookBounds';
import type { Range } from '../bookBounds';
import { useApplyBuilding, useShedStoreConfig } from './shared';

export interface ShedDimensions {
  spanBounds: { min: number; max: number };
  heightBounds: { min: number; max: number };
  lengthBounds: { min: number; max: number };
  /** The roof pitch range for this span — the book's band, or the fallback. */
  pitchBounds: Range;
  /** What one bay may measure: the book's band, or 1000–20000 when it states none. */
  baySpacingBounds: Range;
  /*
   * Every writer returns whether it applied: false only when the person cancelled the "removes every
   * option" confirm, so the field that asked can show the stored value again instead of the number
   * that was not taken.
   */
  commitSpan(mm: number): boolean;
  commitHeight(mm: number): boolean;
  commitLength(mm: number): boolean;
  applyDimension(patch: Partial<ShedConfig>): boolean;
  applyBays(input: { length: number; bays: number; nomBaySpacing: number }): boolean;
}

/**
 * The building's three dimensions: their bounds and the only writers that may change them.
 *
 * Shared by the Shed group and the SiteCheck popover, so a span typed in either place asks the same
 * "removes every option" question and a length reconciles the bays the same way.
 */
export function useShedDimensions(catalogue: Catalogue | null | undefined): ShedDimensions {
  const config = useShedStoreConfig();
  const applyPartial = useApplyBuilding();

  /*
   * The bounds the price book states — the same numbers the validator blocks saving on, from one
   * function (`bookBounds`), so a field never accepts a size the form then calls invalid.
   *
   * Bay inputs with no book bounds keep the range they always had, and the validator checks no bay size.
   */
  const bounds = bookBounds(catalogue, config.span);
  const baySpacingBounds = bounds.baySpacing ?? { min: 1000, max: 20000 };

  /**
   * Apply a dimension change, asking first when it invalidates placed options.
   *
   * The desktop wiped options on a span/height/pitch/bay change and asked first. Doing
   * it silently would delete work; never doing it would leave a door on a wall that no
   * longer exists. The confirm is that middle ground, and it only appears when there is
   * something to lose.
   */
  const applyDimension = (patch: Partial<ShedConfig>): boolean => {
    const next = { ...config, ...patch };
    const wipes = shouldWipeOptions(config, next);
    if (
      wipes &&
      !window.confirm(
        'Changing this size removes every option placed on the building. Continue?',
      )
    ) {
      return false;
    }
    applyPartial(wipes ? { ...patch, options: [] } : patch);
    return true;
  };

  /**
   * Apply a reconciled bay triple, so the three fields can never disagree.
   *
   * Changing any of the three **discards a per-bay array**, which is what the desktop does too: editing
   * the length or the count resets the array from the new nominal spacing
   * (`ResetBayUnitsToNomBay`), because an array for a different building is not a set of bays. The
   * array comes back the moment somebody edits one bay in the panel below.
   */
  const applyBays = (input: { length: number; bays: number; nomBaySpacing: number }): boolean => {
    const next = reconcileBays(input);
    return applyDimension({
      length: next.length,
      bays: next.bays,
      nomBaySpacing: next.nomBaySpacing,
      bayWidths: undefined,
    });
  };

  return {
    spanBounds: bounds.span,
    heightBounds: bounds.height,
    lengthBounds: bounds.length,
    pitchBounds: bounds.pitch,
    baySpacingBounds,
    commitSpan: (mm) => applyDimension({ span: mm }),
    commitHeight: (mm) => applyDimension({ height: mm }),
    commitLength: (mm) => applyBays({ length: mm, bays: config.bays, nomBaySpacing: 0 }),
    applyDimension,
    applyBays,
  };
}
