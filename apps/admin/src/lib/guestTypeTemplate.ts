/**
 * The starting configuration for a new Guest building type.
 *
 * ## Why a module of its own
 *
 * It reads `GUEST_DEFAULT_TYPES` from `@sq/core/domain`, which is fine on the server; but it used to
 * live inside `GuestTypeEditor.tsx`, a `'use client'` module, so the server page that needs it could
 * not call it ("Attempted to call newTypeTemplate() from the server but it is on the client").
 *
 * ## Why the garage
 *
 * Every field of a building type has to pass `checkGuestBuildingType`, and a blank form does not: a
 * pitch of 0 is not one of the roof's pitches, and a span of 0 is outside every limit. Starting from a
 * type the product already ships means everything the operator does not touch is already sound.
 */

import { GUEST_DEFAULT_TYPES } from '@sq/core/domain';
import type { GuestBuildingTypeAdminRow } from '@sq/contracts';

export function newTypeTemplate(): GuestBuildingTypeAdminRow {
  const garage = GUEST_DEFAULT_TYPES.find((t) => t.id === 'garage') ?? GUEST_DEFAULT_TYPES[0]!;
  return { ...garage, enabled: true, updatedAt: null, updatedBy: null, source: 'default' };
}
