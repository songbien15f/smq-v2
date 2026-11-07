/**
 * What the freight costs, from the scope the operator picked.
 *
 * ## Why this exists
 *
 * The price book lists seven delivery scopes with a dollar figure each
 * (`delivery_data.delivery_name` / `delivery_value`, and a per-state array), and two of them —
 * *Delivered to Distributor* and *Delivered to Nominated Carrier* — carry **0**, because the desktop
 * does not read a figure for those two. It computes one from a minimum fee the company negotiated
 * with its distributor, and takes whichever is larger (`Quotation.cs:2183–2222`):
 *
 *     candidate = round50( jobValue × (1 + quoteRate%) × percent / 100 )
 *     delivery  = max( minimumDollars, candidate )
 *
 * This build had the scope on the quote but **nothing read it**: `deliveryCents` was whatever the
 * operator typed, so choosing "Delivered to site 301–400 km" ($650 in the book) changed nothing, and
 * choosing "Delivered to Distributor" left the freight at whatever was there instead of applying the
 * distributor's minimum. A quote could be issued below the freight the company is contracted to pay.
 *
 * ## The one deliberate difference from the desktop
 *
 * The desktop multiplies the whole base — including the engineering and extra charges — by `1.1`
 * inside this formula, so it loads GST onto those charges. The price chain already established, from a
 * real quote file, that the desktop *stores* those charges GST-inclusive and must not load them twice
 * (`price.ts`: `KitOnly 24.42 + DeliveryCost 275 + EngineerCharge 110 = TotalPrice 409.42`). Copying
 * the `1.1` here would reintroduce exactly the overstatement the chain fixes, on a fee that is itself
 * a percentage. So the base is the GST-inclusive value of the job and no further loading is applied.
 * Recorded in `KNOWN-DEVIATIONS.md`.
 *
 * ## Why a zero minimum suggests nothing
 *
 * The two min-fee scopes have no figure of their own, and a company that has never set a minimum has
 * all four numbers at zero — the desktop's own default (`MAllSetting.cs:252`). Returning 0 there would
 * wipe a freight figure the operator had already typed. The function therefore answers `null` for
 * "the book has nothing to say", and the caller leaves the field alone.
 *
 * This lives in `domain/` rather than `lib/pricing/` because the **editor** needs it: a screen that
 * offers the delivery scopes has to know what each one costs. The pricing barrel also re-exports
 * `publish.ts`, which reads the filesystem — importing it from a client component pulled `node:fs`
 * into the browser bundle and took the whole client down with "Can't resolve 'fs'". `domain/` is the
 * layer both the server and the browser may import.
 *
 * Pure TypeScript: no framework imports.
 */

/** One row of the book's delivery table, as `catalogues.ts` reads it. Type-only: erased at build. */
import type { DeliveryScope } from '@/lib/pricing/catalogues';

/**
 * The company's freight minimums, from its distributor contract. Cents and percent.
 *
 * Company-level rather than per quote: it is a term of trade with the distributor, and the desktop's
 * own defaults for it live in the settings table.
 */
export interface FreightMinimums {
  distributorDollarCents: number;
  distributorPercent: number;
  carrierDollarCents: number;
  carrierPercent: number;
}

/** The four numbers at zero, which is the desktop's default and means "no minimum agreed". */
export const NO_MINIMUMS: FreightMinimums = {
  distributorDollarCents: 0,
  distributorPercent: 0,
  carrierDollarCents: 0,
  carrierPercent: 0,
};

/** Which of the two minimum-fee scopes a name is, or `null` for an ordinary one. */
export function freightScope(scope: string): 'distributor' | 'carrier' | null {
  /*
   * Matched on the book's own display name, which the desktop also did — as an exact `switch` over
   * two literals. Matching the distinctive word rather than the whole sentence survives a book that
   * renames "Delivered to Distributor" to "Delivered to distributor depot" without silently treating
   * a minimum-fee scope as an ordinary one, which is the failure that costs money.
   */
  const normalised = scope.trim().toLowerCase();
  if (normalised.includes('distributor')) return 'distributor';
  if (normalised.includes('nominated carrier')) return 'carrier';
  return null;
}

/** The desktop's `Round(x, 50)`: to the nearest fifty **dollars**, expressed in cents. */
function roundToFiftyDollars(cents: number): number {
  return Math.round(cents / 5000) * 5000;
}

/**
 * The minimum freight for one of the two minimum-fee scopes.
 *
 * `baseCents` is the GST-inclusive value of the job **without** freight — the equivalent of the
 * desktop's `(BuildingBaseCost + MiscOptionsPrice) × Margin + charges`.
 */
export function minimumFreightCents(input: {
  scope: 'distributor' | 'carrier';
  minimums: FreightMinimums;
  baseCents: number;
  quoteRatePct: number;
}): number {
  const dollar =
    input.scope === 'distributor' ? input.minimums.distributorDollarCents : input.minimums.carrierDollarCents;
  const percent =
    input.scope === 'distributor' ? input.minimums.distributorPercent : input.minimums.carrierPercent;

  const uplifted = Math.max(0, input.baseCents) * (1 + input.quoteRatePct / 100);
  const candidate = roundToFiftyDollars((uplifted * percent) / 100);
  return Math.max(Math.round(dollar), candidate);
}

/** What the book says the freight is for a scope, and where the figure came from. */
export interface DeliverySuggestion {
  cents: number;
  /** `book`: the scope's own figure. `minimum`: the larger of the agreed minimum and the percentage. */
  kind: 'book' | 'minimum';
  /** The agreed minimum, when the figure is one; so a screen can say what it is being held to. */
  minimumCents?: number;
}

/**
 * The freight a scope implies, or `null` when it implies nothing.
 *
 * `null` is not "free": it means the book has no figure for this scope (an unlisted name, or a
 * minimum-fee scope with no minimum configured), and the caller must leave the typed figure alone.
 */
export function deliveryForScope(input: {
  scope: string;
  stateCode: string;
  scopes: readonly DeliveryScope[];
  minimums: FreightMinimums;
  baseCents: number;
  quoteRatePct: number;
}): DeliverySuggestion | null {
  const scope = input.scope.trim();
  if (scope === '') return null;

  const freight = freightScope(scope);
  if (freight !== null) {
    const minimum = minimumFreightCents({
      scope: freight,
      minimums: input.minimums,
      baseCents: input.baseCents,
      quoteRatePct: input.quoteRatePct,
    });
    if (minimum <= 0) return null;
    return { cents: minimum, kind: 'minimum', minimumCents: minimum };
  }

  const row = input.scopes.find((entry) => entry.name.trim().toLowerCase() === scope.toLowerCase());
  if (row === undefined) return null;

  const perState = row.stateValues?.[input.stateCode];
  const dollars = typeof perState === 'number' && Number.isFinite(perState) ? perState : row.value;
  if (!Number.isFinite(dollars)) return null;

  return { cents: Math.round(dollars * 100), kind: 'book' };
}

/** True when the figure on the quote is below the minimum the chosen scope is subject to. */
export function belowFreightMinimum(input: {
  scope: string;
  deliveryCents: number;
  minimums: FreightMinimums;
  baseCents: number;
  quoteRatePct: number;
}): number | null {
  const freight = freightScope(input.scope);
  if (freight === null) return null;
  const minimum = minimumFreightCents({
    scope: freight,
    minimums: input.minimums,
    baseCents: input.baseCents,
    quoteRatePct: input.quoteRatePct,
  });
  if (minimum <= 0) return null;
  return input.deliveryCents < minimum ? minimum : null;
}
