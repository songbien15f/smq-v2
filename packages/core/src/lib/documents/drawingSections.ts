/**
 * The section depths a drawing sheet needs to state a clear opening's size.
 *
 * The desktop prints an open end as `End Opening @H…xW…` and an open bay as `Side Opening  @H…xW…`,
 * where the clear size is the wall minus the steel standing in it: the column, the girt, the rafter,
 * the purlin (`OpeningMethods.cs`). Those depths come from the design's sections, read the way
 * `WallDataService.InitData` reads them (`SmartQuote.Framework.Plan.Compute.Model/Base/
 * WallDataService.cs:86-127`):
 *
 * - `GirtDepth`            the girt material's row in the purlin table
 * - `MainColumDepth/Width` the main column's row in the frame table, width doubled for a `DOUBLE` pair
 * - `InternalRafterDepth`  the main rafter's row in the frame table
 * - `EavesPurlin1Depth`    the eaves purlin's row in the frame table, **150** when the design has none
 * - `PurlinDepth`          the purlin material's row in the purlin table
 *
 * A missing row reads as 0, exactly as the desktop's `?? 0` does. The one refusal is a building the
 * book has no design for (`scheduleFor` finds nothing): there are no sections to subtract, and a size
 * printed from invented steel would be a claim about a frame nobody chose.
 */

import type { DimensionedShed } from '@/domain/types';
import { optimise } from '../bom/optimise';
import { scheduleFor } from '../bom/groups/frame';
import { safeCall } from '../bom/safe';
import type { PriceLookup } from '../pricing/types';

export interface DrawingSections {
  girtDepth: number;
  mainColumnDepth: number;
  mainColumnWidth: number;
  internalRafterDepth: number;
  eavesPurlinDepth: number;
  purlinDepth: number;
}

/** The desktop's default eaves purlin depth when the design names none (`?? 150`). */
const DEFAULT_EAVES_PURLIN_DEPTH = 150;

export function drawingSections(shed: DimensionedShed, lookup: PriceLookup): DrawingSections | null {
  const frame = safeCall(() => optimise(shed, lookup));
  if (frame === undefined) return null;
  const schedule = safeCall(() => scheduleFor(shed, frame, lookup));
  if (schedule === undefined) return null;

  const geometry = (section: string | null | undefined) =>
    section ? safeCall(() => lookup.frameGeometry?.(section)) : undefined;
  const purlinDepth = (code: string) => safeCall(() => lookup.purlinDepth(code)) ?? 0;

  const column = geometry(schedule.mainColumn);
  const eaves = geometry(schedule.eavesPurlin);
  return {
    girtDepth: purlinDepth(frame.girtMaterial),
    mainColumnDepth: column?.depth ?? 0,
    mainColumnWidth: (column?.width ?? 0) * (schedule.mainColumnDouble === true ? 2 : 1),
    internalRafterDepth: geometry(schedule.mainRafter)?.depth ?? 0,
    eavesPurlinDepth: eaves?.depth ?? DEFAULT_EAVES_PURLIN_DEPTH,
    purlinDepth: purlinDepth(frame.purlinMaterial),
  };
}
