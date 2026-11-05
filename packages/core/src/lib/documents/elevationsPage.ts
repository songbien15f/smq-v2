/**
 * Elevations: the four walls, drawn as a workshop sheet.
 *
 * Each panel is one wall in its own plane: the wall rectangle, every opening cut into it at its
 * real offset, sill and size, and the roof line above. This is a **schematic** — it reads the same
 * `buildWallGeometries` the 3D model uses, so the openings cannot disagree with the building, but
 * the roof outline is a single line rather than the purlin-and-sheeting profile a detail drawing
 * would show. The sheet says so.
 *
 * No price, no customer contact: this is a drawing.
 */

import { buildWallGeometries } from '@/domain/walls';
import type { CustomerDocument } from './projection';
import { escapeHtml } from './html';

const RISE_MM = 220; // room above the eave for the roof line
const PANEL_GAP = 600;

function panel(label: string, wallWidth: number, wallHeight: number, holes: string[]): string {
  const height = wallHeight + RISE_MM;
  return `<figure>
  <svg viewBox="0 0 ${wallWidth} ${height}" role="img" aria-label="${escapeHtml(label)} elevation">
    <rect x="0" y="${RISE_MM}" width="${wallWidth}" height="${wallHeight}" fill="#f7f7f5" stroke="#111" stroke-width="30" />
    <line x1="0" y1="${RISE_MM}" x2="${wallWidth}" y2="${RISE_MM}" stroke="#111" stroke-width="60" />
    ${holes.join('\n    ')}
  </svg>
  <figcaption>${escapeHtml(label)} · ${Math.round(wallWidth)} mm</figcaption>
</figure>`;
}

export function renderElevationsPageHtml(document: CustomerDocument): string {
  const walls = buildWallGeometries(document.config);
  const labels: Record<string, string> = {
    front: 'Front',
    back: 'Back',
    left: 'Left end',
    right: 'Right end',
  };

  const figures = walls.map((wall) => {
    const holes = wall.holes.map((hole) => {
      const x = hole.u;
      // SVG y grows downward: the opening's top is the wall height less sill and height.
      const y = RISE_MM + (wall.height - hole.sill - hole.height);
      return `<rect x="${x}" y="${y}" width="${hole.width}" height="${hole.height}" fill="#fff" stroke="#111" stroke-width="20" />`;
    });
    return panel(labels[wall.side] ?? wall.side, wall.width, wall.height, holes);
  });

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Elevations — ${escapeHtml(document.quoteNumber)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 14pt; margin: 0 0 2mm; }
  .meta { font-size: 9pt; color: #333; margin-bottom: 4mm; }
  .sheet { border: 1px solid #111; padding: 6mm; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: ${PANEL_GAP / 100}mm; }
  figure { margin: 0; }
  svg { width: 100%; height: auto; display: block; }
  figcaption { font-size: 8pt; color: #333; margin-top: 1mm; }
  .note { font-size: 8pt; color: #333; margin-top: 3mm; }
</style>
</head>
<body>
<div class="sheet">
  <h1>Elevations — ${escapeHtml(document.quoteNumber)}</h1>
  <p class="meta">
    ${escapeHtml(document.building.structure)} · ${Math.round(document.building.spanMm)} mm span ·
    ${Math.round(document.building.lengthMm)} mm long · ${Math.round(document.building.heightMm)} mm walls ·
    ${document.building.pitchDeg}° pitch
  </p>
  <div class="grid">
    ${figures.join('\n    ')}
  </div>
  <p class="note">
    Openings are drawn at their real position and size. The roofline is schematic.
    Indicative only — not for construction.
  </p>
</div>
</body>
</html>`;
}
