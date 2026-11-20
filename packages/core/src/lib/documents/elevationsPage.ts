/**
 * The Elevations sheet, laid out the way the desktop prints it (`Print/ElevationDocument.cs`
 * `PrintPlanNewDesign`).
 *
 * - A 2×2 grid: Front top-left, Right top-right, Back bottom-left, Left bottom-right. Front/Back
 *   are the long walls (v2 `left`/`right`), Right/Left the ends (v2 `front`/`back`).
 * - Front and Back share one scale, Right and Left another, so a pair can be compared by eye.
 * - Text height is a fiftieth of the view's width (the desktop's `paintBox.Width / 50`).
 * - The title block along the foot carries the desktop frame's five fields.
 *
 * Every coordinate comes from `buildElevations` in `@sq/core`'s domain (A13): this file only maps
 * it to SVG. No price, no customer contact: this is a drawing.
 */

import { buildElevations, type ElevationLine, type ElevationPoint, type ElevationView } from '@/domain/elevation';
import type { CustomerDocument } from './projection';
import { escapeHtml } from './html';
import { SHEET_CSS, dimSvg, r, shortNames, titleBlockHtml, type Stroke } from './drawingSheet';

/** Model point → SVG point (z up becomes y down). */
function pts(points: ElevationPoint[]): string {
  return points.map((p) => `${r(p.x)},${r(-p.z)}`).join(' ');
}

function line(l: ElevationLine, cls: string): string {
  return `<line class="${cls}" x1="${r(l.x1)}" y1="${r(-l.z1)}" x2="${r(l.x2)}" y2="${r(-l.z2)}" />`;
}

/** The marks inside an opening that say what it is (curtain slats, a glazing frame, a leaf). */
function openingMarks(view: ElevationView, i: number): string {
  const o = view.openings[i]!;
  const x0 = o.x;
  const x1 = o.x + o.width;
  const z0 = o.sill;
  const z1 = o.sill + o.height;
  const marks: string[] = [];
  switch (o.type) {
    case 'roller_door':
      for (let z = z0 + 300; z < z1 - 50; z += 300) marks.push(line({ x1: x0, z1: z, x2: x1, z2: z }, 'mark'));
      break;
    case 'window': {
      const inset = Math.min(60, o.width / 8, o.height / 8);
      marks.push(`<rect class="mark" x="${r(x0 + inset)}" y="${r(-(z1 - inset))}" width="${r(o.width - 2 * inset)}" height="${r(o.height - 2 * inset)}" fill="none" />`);
      marks.push(line({ x1: (x0 + x1) / 2, z1: z0 + inset, x2: (x0 + x1) / 2, z2: z1 - inset }, 'mark'));
      break;
    }
    case 'pa_door':
      marks.push(line({ x1: x0, z1: z0, x2: x1, z2: (z0 + z1) / 2 }, 'mark hidden'));
      marks.push(line({ x1: x0, z1: z1, x2: x1, z2: (z0 + z1) / 2 }, 'mark hidden'));
      break;
    case 'sliding_door':
      marks.push(line({ x1: (x0 + x1) / 2, z1: z0, x2: (x0 + x1) / 2, z2: z1 }, 'mark'));
      break;
    case 'opening':
    default:
      marks.push(line({ x1: x0, z1: z0, x2: x1, z2: z1 }, 'mark hidden'));
      marks.push(line({ x1: x0, z1: z1, x2: x1, z2: z0 }, 'mark hidden'));
      break;
  }
  return marks.join('');
}

/** One view as SVG, in a viewBox the caller sizes so a pair shares a scale. */
function viewSvg(view: ElevationView, box: { w: number; h: number }, names: Map<string, string>): string {
  const s: Stroke = { text: box.w / 50, line: box.w / 1400 };
  const cx = (view.minX + view.maxX) / 2;
  const cz = (view.minZ + view.maxZ) / 2;
  const vx = cx - box.w / 2;
  const vy = -cz - box.h / 2;

  const parts: string[] = [];
  if (view.roofBand) parts.push(`<polygon class="roof" points="${pts(view.roofBand)}" />`);
  for (const l of view.roofSheeting) parts.push(line(l, 'joint'));
  parts.push(`<polygon class="${view.open ? 'wall open' : 'wall'}" points="${pts(view.outline)}" />`);
  if (view.gableInfill) parts.push(`<polygon class="infill" points="${pts(view.gableInfill)}" />`);
  for (const l of view.sheeting) parts.push(line(l, 'joint'));
  for (const l of view.cladding) parts.push(line(l, 'joint'));
  view.openings.forEach((o, i) => {
    parts.push(`<rect class="hole" x="${r(o.x)}" y="${r(-(o.sill + o.height))}" width="${r(o.width)}" height="${r(o.height)}" fill="#fff" />`);
    parts.push(openingMarks(view, i));
    const name = names.get(o.id);
    if (name !== undefined) {
      parts.push(
        `<text x="${r(o.x + o.width / 2)}" y="${r(-(o.sill + o.height) + s.text * 1.1)}" font-size="${r(s.text * 0.8)}" text-anchor="middle">${escapeHtml(name)}</text>`,
      );
    }
  });
  for (const g of view.gutters) parts.push(`<polygon class="gutter" points="${pts(g)}" />`);
  for (const d of view.downpipes) parts.push(`<polygon class="pipe" points="${pts(d)}" />`);
  for (const o of view.options) {
    const cls = o.dashed ? 'option hidden' : 'option';
    for (const poly of o.polygons) parts.push(`<polygon class="${cls}" points="${pts(poly)}" />`);
    for (const l of o.lines) parts.push(line(l, cls));
  }
  // Ground line, a little past the extents.
  parts.push(line({ x1: view.minX - s.text, z1: 0, x2: view.maxX + s.text, z2: 0 }, 'ground'));

  for (const d of view.dims) {
    const [from, to] = d.from <= d.to ? [d.from, d.to] : [d.to, d.from];
    if (d.orient === 'h') {
      parts.push(dimSvg({ x: from, y: -d.base }, { x: to, y: -d.base }, d.base - d.at, d.label, s));
    } else {
      parts.push(dimSvg({ x: d.base, y: -from }, { x: d.base, y: -to }, d.at - d.base, d.label, s));
    }
  }

  return `<svg viewBox="${r(vx)} ${r(vy)} ${r(box.w)} ${r(box.h)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(view.title)}" style="--line:${r(s.line)}">
  <style>
    .wall { fill: #f4f4f2; stroke: #111; stroke-width: ${r(s.line * 2.2)}; }
    .wall.open { fill: none; stroke-dasharray: ${r(s.text * 0.8)} ${r(s.text * 0.4)}; }
    .roof { fill: #e6e6e2; stroke: #111; stroke-width: ${r(s.line * 1.6)}; }
    .infill { fill: #dcdcd6; stroke: #111; stroke-width: ${r(s.line)}; }
    .joint { stroke: #8a8a86; stroke-width: ${r(s.line * 0.6)}; }
    .hole { stroke: #111; stroke-width: ${r(s.line * 1.6)}; }
    .mark { stroke: #555; stroke-width: ${r(s.line * 0.7)}; }
    .gutter, .pipe { fill: #fff; stroke: #111; stroke-width: ${r(s.line)}; }
    .option { fill: none; stroke: #111; stroke-width: ${r(s.line * 1.4)}; }
    .hidden { stroke-dasharray: ${r(s.text * 0.6)} ${r(s.text * 0.3)}; }
    .ground { stroke: #111; stroke-width: ${r(s.line * 2.6)}; }
  </style>
  ${parts.join('\n  ')}
</svg>`;
}

export function renderElevationsPageHtml(document: CustomerDocument): string {
  const views = buildElevations(document.config);
  const names = shortNames(document.config);

  // Front/Back (indices 0 and 2) share one box, Right/Left (1 and 3) another. Each box is the
  // union of its pair's extents plus a margin of two text heights.
  const boxFor = (a: ElevationView, b: ElevationView) => {
    const w0 = Math.max(a.maxX - a.minX, b.maxX - b.minX);
    const h0 = Math.max(a.maxZ - a.minZ, b.maxZ - b.minZ);
    const margin = (w0 / 50) * 2.5;
    return { w: w0 + 2 * margin, h: h0 + 2 * margin };
  };
  const longBox = boxFor(views[0]!, views[2]!);
  const endBox = boxFor(views[1]!, views[3]!);

  const figures = views
    .map((view, i) => {
      const box = i % 2 === 0 ? longBox : endBox;
      return `<figure>
    <figcaption>${escapeHtml(view.title)} <span>(${escapeHtml(view.editorWall)})</span></figcaption>
    ${viewSvg(view, box, names)}
  </figure>`;
    })
    .join('\n  ');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Elevations — ${escapeHtml(document.quoteNumber)}</title>
<style>
${SHEET_CSS}
  .grid { flex: 1; display: grid; grid-template-columns: 1.35fr 1fr; grid-template-rows: 1fr 1fr; min-height: 0; }
  figure { margin: 0; padding: 2mm 3mm; display: flex; flex-direction: column; min-height: 0; min-width: 0; border-left: 0.3mm solid #bbb; border-top: 0.3mm solid #bbb; }
  figure:nth-child(odd) { border-left: 0; }
  figure:nth-child(-n+2) { border-top: 0; }
  figcaption { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  figcaption span { font-weight: 400; text-transform: none; color: #555; font-size: 7pt; }
  figure svg { flex: 1; width: 100%; min-height: 0; }
</style>
</head>
<body>
<div class="sheet">
  <div class="grid">
  ${figures}
  </div>
  <p class="note">Dimensions in millimetres. Indicative only — not for construction.</p>
  ${titleBlockHtml(document, 'Elevations')}
</div>
</body>
</html>`;
}
