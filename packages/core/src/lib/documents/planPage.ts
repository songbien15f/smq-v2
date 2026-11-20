/**
 * The Plan View sheet, drawn the way the desktop prints it (`Print/PlanViewDocument.cs`,
 * `House2D.PrintLayout`, `Elms2D/House2D.cs:263-285`).
 *
 * - The option list in a box on the left (`GetPrintOptionString`), the plan on the right.
 * - **Length runs across the sheet**, the width up it. The desktop's Front wall (v2 `left`, x = 0)
 *   is at the foot, its Right end (v2 `front`, y = 0) on the right:
 *   `X = length − y`, `Y = span − x` (SVG y grows downward).
 * - In the desktop's order: gable roof sheet lines and ridge (`DrawRoof`, gables only), the frame,
 *   wall-sheeting ticks, bay dimensions **only when the bays differ** (`House2D.Frames.cs:266-286`),
 *   roof-fall arrows in the first bay (gable two, skillion one, `:345-367`), the width on the right
 *   at `length + 1000` with any awning depths in the same column (`:379-439`), the overall length
 *   above (`:454-463`) and `H. = {height}mm` beside it (`:465-476`).
 * - Gutters as strips outside the low eaves and "DP" boxes where the 3D model puts its downpipes
 *   (`downpipeStations`), left off a wall an awning covers (`SideWall2D.Print.cs`).
 * - Each opening's symbol (leaf, swing arc, curtain) and its short name in a rhombus.
 *
 * Coordinates come from `@sq/core` (`buildPlanGeometry`, `resolveOptions`, A13); this file maps them
 * onto the sheet. No price, no customer contact.
 */

import { bayWidthsFor, positionsFromWidths } from '@/domain/bays';
import { buildPlanGeometry } from '@/domain/plan';
import { resolveOption } from '@/domain/options';
import { downpipeStations } from '@/domain/structure3d';
import { fallsToBothSides, type WallSide } from '@/domain/types';
import { WALL_SHEET_MM, ROOF_SHEET_MM, GUTTER_MM } from '@/domain/elevation';
import type { CustomerDocument } from './projection';
import { escapeHtml } from './html';
import type { DrawingSections } from './drawingSections';
import {
  SHEET_CSS,
  dimSvg,
  mm,
  optionListHtml,
  r,
  rhombusLabel,
  shortNames,
  titleBlockHtml,
  type Stroke,
} from './drawingSheet';

interface Pt {
  x: number;
  y: number;
}

/** Distance outside the wall of an opening's short name, mm (the desktop's rhombus offset). */
const TAG_OFFSET = 700;
/** Width dimension column, beyond the right end (`DrawVerticalDimension`). */
const WIDTH_DIM_AT = 1000;
/** The DP box, mm. */
const DP_BOX = 260;

export function renderPlanPageHtml(document: CustomerDocument, options: { sections?: DrawingSections | null } = {}): string {
  const shed = document.config;
  const { span, length, height } = shed;
  const gable = fallsToBothSides(shed.structureType);
  const plan = buildPlanGeometry(shed);
  const names = shortNames(shed);

  const T = (x: number, y: number): Pt => ({ x: length - y, y: span - x });
  const rectT = (rc: { x: number; y: number; width: number; height: number }) => {
    const a = T(rc.x, rc.y);
    const b = T(rc.x + rc.width, rc.y + rc.height);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  };

  // --- Extents, for the text size and the viewBox ----------------------------------------------
  const optionRects = plan.options.map((o) => rectT(o.rect));
  let minX = 0;
  let maxX = length;
  let minY = 0;
  let maxY = span;
  for (const rc of optionRects) {
    minX = Math.min(minX, rc.x);
    maxX = Math.max(maxX, rc.x + rc.width);
    minY = Math.min(minY, rc.y);
    maxY = Math.max(maxY, rc.y + rc.height);
  }
  const s: Stroke = { text: Math.max(length, span * 1.6) / 55, line: Math.max(length, span * 1.6) / 1600 };

  const parts: string[] = [];
  const ln = (a: Pt, b: Pt, cls: string) =>
    `<line class="${cls}" x1="${r(a.x)}" y1="${r(a.y)}" x2="${r(b.x)}" y2="${r(b.y)}" />`;
  const rect = (rc: { x: number; y: number; width: number; height: number }, cls: string, extra = '') =>
    `<rect class="${cls}" x="${r(rc.x)}" y="${r(rc.y)}" width="${r(rc.width)}" height="${r(rc.height)}"${extra} />`;

  // 1. Roof: gable only — sheet joints down each slope and the ridge.
  if (gable) {
    for (let X = ROOF_SHEET_MM; X < length - 1; X += ROOF_SHEET_MM) {
      parts.push(ln({ x: X, y: 0 }, { x: X, y: span }, 'joint'));
    }
    parts.push(ln({ x: 0, y: span / 2 }, { x: length, y: span / 2 }, 'ridge'));
  }

  // 2. Frame.
  parts.push(rect({ x: 0, y: 0, width: length, height: span }, 'frame'));
  for (const bay of plan.bayLines) parts.push(ln(T(bay.x1, bay.y1), T(bay.x2, bay.y2), 'bay'));

  // 3. Wall-sheeting ticks along each closed wall.
  const open: Record<WallSide, boolean> = {
    front: shed.endOpening.left,
    back: shed.endOpening.right,
    left: shed.sideOpening.front,
    right: shed.sideOpening.back,
  };
  const tick = s.text * 0.35;
  if (!open.left) for (let X = WALL_SHEET_MM; X < length; X += WALL_SHEET_MM) parts.push(ln({ x: X, y: span }, { x: X, y: span - tick }, 'tick'));
  if (!open.right) for (let X = WALL_SHEET_MM; X < length; X += WALL_SHEET_MM) parts.push(ln({ x: X, y: 0 }, { x: X, y: tick }, 'tick'));
  if (!open.front) for (let Y = WALL_SHEET_MM; Y < span; Y += WALL_SHEET_MM) parts.push(ln({ x: length, y: Y }, { x: length - tick, y: Y }, 'tick'));
  if (!open.back) for (let Y = WALL_SHEET_MM; Y < span; Y += WALL_SHEET_MM) parts.push(ln({ x: 0, y: Y }, { x: tick, y: Y }, 'tick'));
  for (const wall of ['left', 'right', 'front', 'back'] as WallSide[]) {
    if (!open[wall]) continue;
    // An open wall reads as a dashed edge over the frame line.
    const edge: Record<WallSide, [Pt, Pt]> = {
      left: [{ x: 0, y: span }, { x: length, y: span }],
      right: [{ x: 0, y: 0 }, { x: length, y: 0 }],
      front: [{ x: length, y: 0 }, { x: length, y: span }],
      back: [{ x: 0, y: 0 }, { x: 0, y: span }],
    };
    parts.push(ln(edge[wall][0], edge[wall][1], 'open-edge'));
  }

  // Gutters along each low eave, and a DP at each downpipe not under an awning. The desktop draws the
  // gutter the full length whatever hangs off the wall, and leaves out only a DP whose bay has an
  // awning attached at the eaves (`SideWall2D.Print`: `HasAwningInPosition`, `HighHeight` within
  // 200 of the wall height). A v2 awning always meets the wall at the eaves, so the test is its
  // extent along the wall.
  const awningOver = (wall: WallSide, y: number) =>
    shed.options.some((o) => {
      if (o.kind !== 'awning' || o.wall !== wall) return false;
      const { rect: a, zHigh } = resolveOption(o, shed);
      return zHigh >= height - 200 && y >= a.y - 1 && y <= a.y + a.height + 1;
    });
  const lowWalls: ('left' | 'right')[] = gable ? ['left', 'right'] : ['left'];
  for (const wall of lowWalls) {
    const x0 = wall === 'left' ? -GUTTER_MM : span;
    parts.push(rect(rectT({ x: x0, y: 0, width: GUTTER_MM, height: length }), 'gutter'));
  }
  for (const station of downpipeStations(shed)) {
    if (awningOver(station.wall, station.y)) continue;
    const c = T(station.wall === 'left' ? -GUTTER_MM - DP_BOX / 2 : span + GUTTER_MM + DP_BOX / 2, station.y);
    parts.push(
      `<rect class="dp" x="${r(c.x - DP_BOX / 2)}" y="${r(c.y - DP_BOX / 2)}" width="${DP_BOX}" height="${DP_BOX}" rx="${DP_BOX / 4}" />`,
      `<text x="${r(c.x)}" y="${r(c.y)}" font-size="${r(DP_BOX * 0.55)}" text-anchor="middle" dominant-baseline="central">DP</text>`,
    );
    minY = Math.min(minY, c.y - DP_BOX);
    maxY = Math.max(maxY, c.y + DP_BOX);
  }

  // Options, in the plan's own roles.
  plan.options.forEach((o, i) => {
    const cls = o.dashed ? 'option hidden' : 'option';
    parts.push(rect(optionRects[i]!, cls));
    for (const [x1, y1, x2, y2] of o.lines) parts.push(ln(T(x1, y1), T(x2, y2), cls));
    if (o.triangle) parts.push(`<polygon class="${cls}" points="${o.triangle.points.map((p) => T(p.x, p.y)).map((p) => `${r(p.x)},${r(p.y)}`).join(' ')}" />`);
  });

  // Openings: symbol, then the short name outside the wall.
  for (const opening of plan.openings) {
    const { symbol } = opening;
    for (const rc of symbol.rects) {
      parts.push(rect(rectT(rc), rc.role === 'track' ? 'track' : 'symbol', ` fill="${rc.filled ? '#111' : '#fff'}"`));
    }
    for (const [x1, y1, x2, y2] of symbol.lines) parts.push(ln(T(x1, y1), T(x2, y2), 'symbol'));
    if (symbol.arc) {
      const { x, y, radius, rotation, sweep } = symbol.arc;
      const at = (deg: number) => {
        const a = (deg * Math.PI) / 180;
        return T(x + radius * Math.cos(a), y + radius * Math.sin(a));
      };
      const p0 = at(rotation);
      const pm = at(rotation + sweep / 2);
      const p1 = at(rotation + sweep);
      const cross = (pm.x - p0.x) * (p1.y - p0.y) - (pm.y - p0.y) * (p1.x - p0.x);
      parts.push(
        `<path class="swing" d="M ${r(p0.x)} ${r(p0.y)} A ${r(radius)} ${r(radius)} 0 0 ${cross < 0 ? 1 : 0} ${r(p1.x)} ${r(p1.y)}" />`,
      );
    }
    const name = names.get(opening.id);
    if (name !== undefined) {
      const c = { x: opening.rect.x + opening.rect.width / 2, y: opening.rect.y + opening.rect.height / 2 };
      const outward: Record<WallSide, Pt> = {
        front: { x: c.x, y: -TAG_OFFSET },
        back: { x: c.x, y: length + TAG_OFFSET },
        left: { x: -TAG_OFFSET, y: c.y },
        right: { x: span + TAG_OFFSET, y: c.y },
      };
      const p = outward[opening.wall];
      const at = T(p.x, p.y);
      parts.push(rhombusLabel(at.x, at.y, name, s));
      minX = Math.min(minX, at.x - s.text * 2);
      maxX = Math.max(maxX, at.x + s.text * 2);
      minY = Math.min(minY, at.y - s.text);
      maxY = Math.max(maxY, at.y + s.text);
    }
  }

  // 5. Roof-fall arrows, in the middle of the first bay.
  const bayWidths = bayWidthsFor(shed);
  const bayPositions = positionsFromWidths(bayWidths);
  const arrowX = length - (bayPositions[1]! - bayPositions[0]!) / 2;
  const arrow = (from: number, to: number) => {
    const dir = Math.sign(to - from);
    const head = s.text * 0.7;
    return `<g class="arrow">${ln({ x: arrowX, y: from }, { x: arrowX, y: to }, 'arrow-line')}<polygon points="${r(arrowX)},${r(to)} ${r(arrowX - head / 2)},${r(to - dir * head)} ${r(arrowX + head / 2)},${r(to - dir * head)}" /></g>`;
  };
  const inset = span * 0.08;
  if (gable) {
    parts.push(arrow(span / 2 - inset / 2, inset), arrow(span / 2 + inset / 2, span - inset));
  } else {
    // High wall (v2 x = span) at the top of the sheet, low wall at the foot.
    parts.push(arrow(inset, span - inset));
  }
  parts.push(
    `<text x="${r(arrowX + s.text * 0.5)}" y="${r(gable ? span / 4 : span / 2)}" font-size="${r(s.text * 0.8)}" dominant-baseline="central">${shed.roofPitchDeg}°</text>`,
  );

  // 4. Bay dimensions, only when the bays differ.
  const baysDiffer = bayWidths.some((w) => Math.abs(w - bayWidths[0]!) > 0.5);
  const top = minY;
  const step = s.text * 2.4;
  let dimRow = top - step;
  if (baysDiffer) {
    for (let i = 0; i < bayWidths.length; i++) {
      const a = { x: length - bayPositions[i]!, y: 0 };
      const b = { x: length - bayPositions[i + 1]!, y: 0 };
      parts.push(dimSvg(b, a, dimRow, mm(bayWidths[i]!), s));
    }
    dimRow -= step;
  }

  // 8. Overall length above, and 9. "H. = …mm" beside its right end.
  parts.push(dimSvg({ x: length, y: 0 }, { x: 0, y: 0 }, -dimRow, mm(length), s));
  parts.push(
    `<text x="${r(length + s.text)}" y="${r(dimRow)}" font-size="${r(s.text)}" dominant-baseline="central">H. = ${mm(height)}mm</text>`,
  );

  // 6./7. Width on the right, awning depths in the same column.
  const colX = Math.max(length + WIDTH_DIM_AT, maxX + s.text * 1.5);
  parts.push(dimSvg({ x: length, y: span }, { x: length, y: 0 }, colX - length, mm(span), s));
  shed.options.forEach((o) => {
    if (o.kind !== 'awning' || (o.wall !== 'left' && o.wall !== 'right')) return;
    const placed = plan.options.find((p) => p.id === o.id);
    if (placed === undefined) return;
    const rc = optionRects[plan.options.indexOf(placed)]!;
    const [y0, y1] = o.wall === 'left' ? [span, rc.y + rc.height] : [rc.y, 0];
    parts.push(dimSvg({ x: rc.x + rc.width, y: y1 }, { x: rc.x + rc.width, y: y0 }, colX - (rc.x + rc.width), mm(o.depth), s));
  });

  const vMinX = minX - s.text * 3;
  const vMaxX = colX + s.text * 3;
  const vMinY = dimRow - s.text * 2;
  const vMaxY = maxY + s.text * 2;

  const svg = `<svg viewBox="${r(vMinX)} ${r(vMinY)} ${r(vMaxX - vMinX + s.text * 6)} ${r(vMaxY - vMinY)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Plan of the building">
  <style>
    .frame { fill: #f7f7f5; stroke: #111; stroke-width: ${r(s.line * 2.4)}; }
    .bay { stroke: #111; stroke-width: ${r(s.line * 0.8)}; stroke-dasharray: ${r(s.text * 0.9)} ${r(s.text * 0.3)} ${r(s.text * 0.15)} ${r(s.text * 0.3)}; }
    .joint { stroke: #a5a5a0; stroke-width: ${r(s.line * 0.5)}; }
    .ridge { stroke: #111; stroke-width: ${r(s.line * 1.2)}; stroke-dasharray: ${r(s.text * 1.2)} ${r(s.text * 0.4)}; }
    .tick { stroke: #111; stroke-width: ${r(s.line * 0.7)}; }
    .open-edge { stroke: #fff; stroke-width: ${r(s.line * 2.6)}; stroke-dasharray: ${r(s.text * 0.6)} ${r(s.text * 0.6)}; }
    .gutter { fill: #fff; stroke: #111; stroke-width: ${r(s.line)}; }
    .dp { fill: #fff; stroke: #111; stroke-width: ${r(s.line)}; }
    .option { fill: none; stroke: #111; stroke-width: ${r(s.line * 1.2)}; }
    .hidden { stroke-dasharray: ${r(s.text * 0.6)} ${r(s.text * 0.3)}; }
    .symbol, .track { stroke: #111; stroke-width: ${r(s.line)}; }
    .track { fill: #666; }
    .swing { fill: none; stroke: #111; stroke-width: ${r(s.line * 0.7)}; }
    .arrow-line { stroke: #111; stroke-width: ${r(s.line)}; }
    .arrow polygon { fill: #111; }
  </style>
  ${parts.join('\n  ')}
</svg>`;

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Plan — ${escapeHtml(document.quoteNumber)}</title>
<style>
${SHEET_CSS}
</style>
</head>
<body>
<div class="sheet">
  <div class="drawing">
    <div class="side">
      <p class="building">
        ${escapeHtml(document.building.structure)}<br>
        ${mm(span)} × ${mm(length)} mm · ${mm(height)} mm walls<br>
        ${document.building.bays} bays · ${document.building.pitchDeg}° pitch
      </p>
      ${optionListHtml(shed, options.sections)}
    </div>
    <div class="canvas">
      ${svg}
    </div>
  </div>
  <p class="note">Dimensions in millimetres. Indicative only — not for construction.</p>
  ${titleBlockHtml(document, 'Plan View')}
</div>
</body>
</html>`;
}
