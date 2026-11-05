/**
 * The plan view as a page of its own.
 *
 * The desktop's Print > Plan View produced a drawing, not the quotation with a drawing in it:
 * a workshop pins it up, and a page of terms beside it is in the way. This renders the same
 * primitives the customer document uses — one `PlanGeometry`, so the two cannot disagree.
 *
 * No price, no customer block, no company marketing: a drawing sheet.
 */

import type { CustomerDocument } from './projection';
import { escapeHtml } from './html';

/** `1,234` style millimetres, as a drawing dimensions. */
function mm(value: number): string {
  return Math.round(value).toLocaleString('en-AU');
}

export function renderPlanPageHtml(document: CustomerDocument): string {
  const { plan } = document;
  const openings = plan.openings
    .map((opening) =>
      [
        ...opening.rects.map(
          (rect) =>
            `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${rect.filled ? '#111' : 'none'}" stroke="#111" stroke-width="20" />`,
        ),
        ...opening.lines.map(
          ([x1, y1, x2, y2]) =>
            `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="20" />`,
        ),
      ].join('\n      '),
    )
    .join('\n      ');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Plan — ${escapeHtml(document.quoteNumber)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 14pt; margin: 0 0 2mm; }
  .meta { font-size: 9pt; color: #333; margin-bottom: 4mm; }
  .sheet { border: 1px solid #111; padding: 6mm; }
  svg { width: 100%; height: auto; }
  .note { font-size: 8pt; color: #333; margin-top: 3mm; }
</style>
</head>
<body>
<div class="sheet">
  <h1>Plan — ${escapeHtml(document.quoteNumber)}</h1>
  <p class="meta">
    ${escapeHtml(document.building.structure)} · ${mm(plan.widthMm)} × ${mm(plan.lengthMm)} mm ·
    ${mm(document.building.heightMm)} mm walls · ${document.building.bays} bays ·
    ${document.building.pitchDeg}° pitch
  </p>
  <svg viewBox="0 0 ${plan.widthMm + 600} ${plan.lengthMm + 600}" role="img" aria-label="Plan of the building">
    <g transform="translate(300,300)">
      <path d="${escapeHtml(plan.outline)}" fill="#f7f7f5" stroke="#111" stroke-width="40" />
      ${openings}
    </g>
  </svg>
  <p class="note">Indicative only — not for construction.</p>
</div>
</body>
</html>`;
}
