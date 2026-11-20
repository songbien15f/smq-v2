/**
 * Estimate an AS/NZS 1170.2 wind region from a coordinate.
 *
 * ## Why an estimate at all
 *
 * The customer asked the Guest page to show a line like "Region B · 10a Enclosed · Importance Level
 * 2" as soon as an address is picked (Q3). Calling ShedSafe for every visitor would create a junk
 * building on the company's account for each of them, and its answer is not certified until a person
 * clicks Auto Calc — so the page estimates and says so: **"Indicative — confirmed in your quote"**.
 * The estimator still runs a real SiteCheck when the quote is written.
 *
 * ## What the estimate is, and is not
 *
 * - It answers a **letter**: `A`, `B`, `C` or `D`. Nothing here computes a wind speed. The claim
 *   that "Region B is 45 m/s" could not be sourced from the Standard in this session (Table 3.1 is
 *   paywalled), so `GuestSiteEstimate.windSpeedMs` is left unset rather than guessed — printing a
 *   number carries far more liability than printing a region name.
 * - Near a boundary it answers **`null`**, not the nearer side. A 5 km error that silently flips a
 *   coastal site from B to A under-states the frame, and the page's own fallback — "confirmed in your
 *   quote" — is a correct answer while a wrong letter is not.
 *
 * ## How it answers
 *
 * Point-in-polygon over the simplified ring table (`windRegionData.ts`), then two guards:
 *
 * 1. **A margin.** The distance from the point to the nearest ring vertex is measured; inside the
 *    margin the answer is `null`. 0.08° ≈ 8.9 km in latitude, a little less in longitude at these
 *    latitudes — wider than the 0.05° simplification tolerance, so a point that survived
 *    simplification still reads the same letter it had in the full dataset.
 * 2. **A nearest-strip fallback** for points just off a coastline that the simplification pulled the
 *    edge past: within `COAST_FALLBACK_DEG` of a ring and inside no ring, the nearest ring's letter
 *    wins. Measured: without it, coastal towns such as Brisbane and Darwin landed in no polygon.
 *
 * Pure TypeScript: no React, Next.js, database or HTTP.
 */

import { WIND_REGION_EXTENT, WIND_REGION_RINGS } from './windRegionData';

/** AS/NZS 1170.2 wind regions for Australia. */
export type GuestWindRegion = 'A' | 'B' | 'C' | 'D';

/**
 * How close to a **different region's** boundary a point may be before the answer is refused, in
 * degrees.
 *
 * 0.08° ≈ 8.9 km of latitude. The simplified table's own tolerance is 0.05°, so a regional boundary
 * can be that far from where the Standard draws it; the margin is what keeps a point genuinely on
 * one side from being answered the other side.
 *
 * The margin is measured against boundaries **between regions** only. A coast is also a boundary in
 * the data, but an address 3 km inland at Sydney is not "near the A/B line" in any sense an
 * estimator cares about — refusing it would make the feature useless in every coastal city.
 */
export const BOUNDARY_MARGIN_DEG = 0.08;

/** How far outside every polygon a point may sit and still take the nearest ring's letter. */
export const COAST_FALLBACK_DEG = 0.2;

interface Ring {
  region: GuestWindRegion;
  /** Flat `[lng, lat, lng, lat, …]`. */
  points: Float64Array;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Parsed once, on first use, so a page that never asks pays nothing. */
let rings: Ring[] | null = null;

function parsed(): Ring[] {
  if (rings !== null) return rings;
  rings = WIND_REGION_RINGS.map(({ r, p }) => {
    const numbers = p.split(/[\s,]+/).map(Number);
    const points = Float64Array.from(numbers);
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      const lng = points[i]!;
      const lat = points[i + 1]!;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { region: r, points, minLng, minLat, maxLng, maxLat };
  });
  return rings;
}

/** True when `lng,lat` is inside the ring (even-odd rule; rings are closed implicitly). */
function insideRing(ring: Ring, lng: number, lat: number): boolean {
  const pts = ring.points;
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]!;
    const yi = pts[i + 1]!;
    const xj = pts[j]!;
    const yj = pts[j + 1]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Distance in degrees from the point to the ring's **nearest edge**.
 *
 * Edge, not vertex: after the 0.05° simplification a straight run of coast is a handful of long
 * segments, so the nearest vertex can be 20 km away while the boundary itself is 1 km away — and a
 * vertex test would then call a point "far from the boundary" when it is beside it.
 */
function distanceToRing(ring: Ring, lng: number, lat: number): number {
  const pts = ring.points;
  let best = Infinity;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const ax = pts[j]!;
    const ay = pts[j + 1]!;
    const bx = pts[i]!;
    const by = pts[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : ((lng - ax) * dx + (lat - ay) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(lng - px, lat - py);
    if (d < best) best = d;
  }
  return best;
}

/** True when `lng,lat` lies inside the map's own extent. */
export function inWindRegionExtent(lng: number, lat: number): boolean {
  const [west, south, east, north] = WIND_REGION_EXTENT;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/**
 * The estimated wind region for a coordinate, or `null`.
 *
 * `null` means "not in Australia, near a boundary, or off the coast beyond the fallback" — and the
 * page turns every one of those into "confirmed in your quote". A caller must not turn `null` into
 * `'A'`: A is the mildest region, so defaulting to it understates a cyclonic site's frame.
 *
 * Returns `null` for a coordinate that is not a finite number, so a malformed Places response
 * degrades to the disclaimer rather than to a wrong letter.
 */
export function estimateWindRegion(lat: number, lng: number): GuestWindRegion | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inWindRegionExtent(lng, lat)) return null;

  const all = parsed();
  const hits = new Set<GuestWindRegion>();
  /** Nearest ring edge overall, and its letter — what the off-coast fallback uses. */
  let nearestAny = Infinity;
  let nearestAnyRegion: GuestWindRegion | null = null;

  for (const ring of all) {
    const pad = COAST_FALLBACK_DEG;
    if (lng < ring.minLng - pad || lng > ring.maxLng + pad) continue;
    if (lat < ring.minLat - pad || lat > ring.maxLat + pad) continue;

    if (insideRing(ring, lng, lat)) hits.add(ring.region);
    const distance = distanceToRing(ring, lng, lat);
    if (distance < nearestAny) {
      nearestAny = distance;
      nearestAnyRegion = ring.region;
    }
  }

  if (hits.size > 1) return null;
  if (hits.size === 0) {
    // Just off a coastline the simplification pulled the edge past: take the strip's letter when the
    // point is close enough that a person would call it the same place.
    return nearestAny <= COAST_FALLBACK_DEG ? nearestAnyRegion : null;
  }

  const [region] = [...hits] as [GuestWindRegion];
  // Refuse an answer that sits within the margin of a boundary **between two letters**. The coast is
  // a boundary in the data too, but an address a few kilometres inland at Sydney is not near the A/B
  // line, and refusing it would make the feature useless in every coastal city.
  if (distanceToOtherRegion(all, lng, lat, region) < BOUNDARY_MARGIN_DEG) return null;
  return region;
}

/** Distance to the nearest edge of any ring whose letter differs from `region`. */
function distanceToOtherRegion(
  all: readonly Ring[],
  lng: number,
  lat: number,
  region: GuestWindRegion,
): number {
  let best = Infinity;
  for (const ring of all) {
    if (ring.region === region) continue;
    const distance = distanceToRing(ring, lng, lat);
    if (distance < best) {
      best = distance;
      if (best < BOUNDARY_MARGIN_DEG) return best;
    }
  }
  return best;
}
