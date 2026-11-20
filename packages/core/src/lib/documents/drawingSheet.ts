/**
 * What the Plan and Elevations sheets share: the title block, the option list and the drawing
 * primitives (dimension strings, short names).
 *
 * Both follow the desktop's print path. Paths below are relative to the desktop source
 * (`smq-code-smartquote`); see `docs/drawings-desktop-parity.md`.
 *
 * - Title block: `XDrawingPlanViewService.DrawFrame` (`:140-151`) writes five fields over the
 *   frame template: client name, site address, state (full name), job number and date. No email
 *   and no phone, and v2 adds no price: a drawing is pinned up in a workshop.
 * - Option list: `Quotation.GetPrintOptionString` (`Quotation.cs:1016-1046`) and its helpers, in
 *   the same order and with the same patterns (`_patternCountOption = "{1}{2} x {0}"`, a detail
 *   line `"   - {detail} x {count}"`).
 *
 * Wall names are the desktop's: Front/Back are the long walls (v2 `left`/`right`), Right/Left are
 * the ends (v2 `front`/`back`). See `ELEVATION_ORDER` in `domain/elevation.ts`.
 */

import type { DimensionedShed, Opening, OpeningType, StateCode, WallSide } from '@/domain/types';
import { fallsToBothSides } from '@/domain/types';
import type { CustomerDocument } from './projection';
import { escapeHtml } from './html';
import type { DrawingSections } from './drawingSections';
import { normaliseOption, resolveOption } from '@/domain/options';
import { bayWidthsFor } from '@/domain/bays';

/** `1,234` style millimetres. */
export function mm(value: number): string {
  return Math.round(value).toLocaleString('en-AU');
}

/** `SiteStateFull` on the desktop frame. */
export const STATE_NAMES: Record<StateCode, string> = {
  ACT: 'Australian Capital Territory',
  NSW: 'New South Wales',
  NT: 'Northern Territory',
  QLD: 'Queensland',
  SA: 'South Australia',
  TAS: 'Tasmania',
  VIC: 'Victoria',
  WA: 'Western Australia',
};

export function stateName(code: string): string {
  return (STATE_NAMES as Record<string, string>)[code] ?? code;
}

/** The desktop's face name for a v2 wall. */
export const DESKTOP_FACE: Record<WallSide, 'Front' | 'Back' | 'Right' | 'Left'> = {
  left: 'Front',
  right: 'Back',
  front: 'Right',
  back: 'Left',
};

// --- Short names -------------------------------------------------------------

const SHORT_PREFIX: Record<OpeningType, string> = {
  window: 'W',
  pa_door: 'PA',
  roller_door: 'RD',
  sliding_door: 'SD',
  opening: 'OP',
};

/** What makes two openings "the same" for a short name: type and size, as the desktop groups them. */
function sizeKey(opening: Opening): string {
  return `${opening.type}:${Math.round(opening.height)}x${Math.round(opening.width)}`;
}

/**
 * `<W1>`, `<RD2>` … : one name per distinct type and size, numbered in the order the openings
 * were added. The plan writes the same name in a rhombus beside each opening and the option list
 * uses it in the detail lines, so the two can be read against each other.
 */
export function shortNames(shed: DimensionedShed): Map<string, string> {
  const byKey = new Map<string, string>();
  const counters = new Map<OpeningType, number>();
  const names = new Map<string, string>();
  for (const opening of shed.openings) {
    const key = sizeKey(opening);
    let name = byKey.get(key);
    if (name === undefined) {
      const n = (counters.get(opening.type) ?? 0) + 1;
      counters.set(opening.type, n);
      name = `${SHORT_PREFIX[opening.type]}${n}`;
      byKey.set(key, name);
    }
    names.set(opening.id, name);
  }
  return names;
}

// --- Option list ---------------------------------------------------------------

/** `"{name}{s} x {count}"`, then one `"   - {detail} x {n}"` per distinct detail, sorted. */
function countBlock(name: string, details: string[], printDetail: boolean): string[] {
  if (details.length === 0) return [];
  const lines = [`${name}${details.length > 1 ? 's' : ''} x ${details.length}`];
  if (printDetail) {
    const tally = new Map<string, number>();
    for (const d of details) if (d !== '') tally.set(d, (tally.get(d) ?? 0) + 1);
    for (const d of [...tally.keys()].sort()) lines.push(`   - ${d} x ${tally.get(d)}`);
  }
  return lines;
}

function openingDetail(opening: Opening, short: string | undefined): string {
  const tag = short !== undefined ? `<${short}> ` : '';
  const size = `@H${mm(opening.height)}xW${mm(opening.width)}`;
  const prep = opening.prepOnly ? ' - prep only' : '';
  switch (opening.type) {
    case 'roller_door': {
      const parts = [`${tag}${size}`];
      if (opening.series) parts.push(`${opening.series} Curtain`);
      if (opening.windlock) parts.push('Windlocks');
      if (opening.prepOnly) parts.push('prep');
      return parts.join(' - ');
    }
    case 'pa_door':
      return `${tag}${opening.sku ? opening.sku : size}${prep}`;
    default:
      return `${tag}${size}${prep}`;
  }
}

/** A whole number with no separators, as the desktop's `{0}` formats an int. */
const int = (value: number) => String(Math.round(value));

/** The desktop's `RoundDownTo100` / `RoundUpTo50`. */
const roundDown100 = (value: number) => Math.floor(value / 100) * 100;
const roundUp50 = (value: number) => Math.ceil(value / 50) * 50;

/**
 * The open ends and open side bays, as `printedOpenMainEnd` and `printedOpendMainSideBays` print
 * them, with the clear sizes the desktop's opening methods compute:
 *
 * - `End Opening @H(height − rafter − purlin)xW(span − 2·column depth − 2·girt) x {open ends}`.
 * - `Side Opening  @H(height − eaves purlin)xW(bay − 2·column width − end allowance)`, the end
 *   allowance being the girt rounded up to 50 on the first and last bay only.
 * - `Double Side Opening @H(height − 300)xW(bay + next bay − 2·column width)` for an open bay with
 *   a carry beam (the next open bay is the same hole, so it is not listed again), and for a closed
 *   bay whose carry beam holds a sliding door (`GetListOpeningName`).
 *
 * Sizes round down to 100. Both long walls (desktop Front then Rear = v2 left then right) are
 * grouped by text. Without the design's sections no size can be stated, so the line names the
 * opening and its count only — never a size from invented steel.
 */
function openingLines(shed: DimensionedShed, sections: DrawingSections | null): string[] {
  const lines: string[] = [];
  const openEnds = (shed.endOpening.left ? 1 : 0) + (shed.endOpening.right ? 1 : 0);
  if (openEnds > 0) {
    const size = sections
      ? ` @H${roundDown100(shed.height - sections.internalRafterDepth - sections.purlinDepth)}` +
        `xW${roundDown100(shed.span - 2 * sections.mainColumnDepth - 2 * sections.girtDepth)}`
      : '';
    lines.push(`End Opening${size} x ${openEnds}`);
  }

  const widths = bayWidthsFor(shed);
  const single = new Map<string, number>();
  const double = new Map<string, number>();
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const singleName = (i: number) => {
    if (!sections) return 'Side Opening';
    const delta = i === 0 || i === widths.length - 1 ? roundUp50(sections.girtDepth) : 0;
    const h = roundDown100(shed.height - sections.eavesPurlinDepth);
    const w = roundDown100((widths[i] ?? 0) - 2 * sections.mainColumnWidth - delta);
    return `Side Opening  @H${h}xW${w}`;
  };
  const doubleName = (i: number) => {
    if (!sections) return 'Double Side Opening';
    const h = roundDown100(shed.height - 300);
    const w = roundDown100((widths[i] ?? 0) + (widths[i + 1] ?? 0) - 2 * sections.mainColumnWidth);
    return `Double Side Opening @H${h}xW${w}`;
  };

  for (const [wall, open] of [
    ['left', shed.sideOpening.front],
    ['right', shed.sideOpening.back],
  ] as const) {
    let ofCarryBeam = false;
    for (let i = 0; i < widths.length; i++) {
      const beam = shed.options.find((o) => o.kind === 'carry_beam' && o.wall === wall && o.beginBay === i);
      if (open) {
        if (beam) {
          add(double, doubleName(i));
          ofCarryBeam = true;
        } else if (ofCarryBeam) {
          ofCarryBeam = false;
        } else {
          add(single, singleName(i));
        }
      } else if (beam?.kind === 'carry_beam') {
        const door = shed.openings.find((o) => o.id === beam.openingId);
        if (door?.type === 'sliding_door') add(double, doubleName(i));
      }
    }
  }
  for (const [key, n] of single) lines.push(`${key} x ${n}`);
  for (const [key, n] of double) lines.push(`${key} x ${n}`);
  return lines;
}

/**
 * The option list, line by line, in `GetPrintOptionString` order: awnings, the options by type,
 * dividing walls, open ends, open side bays, horizontal cladding, gable infill, cantilever, misc.
 */
export function optionListLines(shed: DimensionedShed, sections?: DrawingSections | null): string[] {
  const names = shortNames(shed);
  const lines: string[] = [];
  const options = shed.options;

  // Awnings (`printedAwningString` + `GetListAwningName`): "Front Awning x N", then one line per
  // distinct awning, "  - H{high}xL{length}xW{projection} @{pitch}deg - Opened x n". The desktop's
  // front is v2's left. The high edge is where the awning meets the wall (the desktop's
  // `HighHeight`), which is v2's `zHigh`. The desktop calls an awning with an open wall "Opened";
  // a v2 awning is a roof with no walls of its own, so every v2 awning is.
  for (const wall of ['left', 'right', 'front', 'back'] as WallSide[]) {
    const awnings = options.filter((o) => o.kind === 'awning' && o.wall === wall);
    if (awnings.length === 0) continue;
    lines.push(`${wall === 'left' ? 'Front' : wall === 'right' ? 'Rear' : DESKTOP_FACE[wall]} Awning x ${awnings.length}`);
    const tally = new Map<string, number>();
    for (const awning of awnings) {
      const a = normaliseOption(awning, shed);
      if (a.kind !== 'awning') continue;
      const high = resolveOption(a, shed).zHigh;
      const key = `  - H${int(high)}xL${int(a.width)}xW${int(a.depth)} @${a.pitchDeg ?? 5}deg - Opened`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    for (const [key, n] of tally) lines.push(`${key} x ${n}`);
  }

  // Options by type (`printedOptionsString`).
  const of = (type: OpeningType) => shed.openings.filter((o) => o.type === type);
  lines.push(...countBlock('Window', of('window').map((o) => openingDetail(o, names.get(o.id))), true));
  lines.push(...countBlock('PA Door', of('pa_door').map((o) => openingDetail(o, names.get(o.id))), true));
  lines.push(...countBlock('Roller Door', of('roller_door').map((o) => openingDetail(o, names.get(o.id))), true));
  lines.push(
    ...countBlock(
      'Outrigger',
      options.flatMap((o) => (o.kind === 'outrigger' ? [`@H${mm(o.height ?? shed.height)}xW${mm(o.length)}`] : [])),
      true,
    ),
  );
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  const skylightRun = fallsToBothSides(shed.structureType) ? shed.span / 2 : shed.span;
  lines.push(
    ...countBlock(
      'Skylight',
      options.flatMap((o) =>
        o.kind === 'skylight'
          ? [`${o.skylightType ?? 'Corro'} @L${Math.round(skylightRun / Math.cos(pitch) + 80)}`]
          : [],
      ),
      true,
    ),
  );
  lines.push(
    ...countBlock(
      'Carry Beam',
      options.flatMap((o) => {
        if (o.kind !== 'carry_beam') return [];
        const door = shed.openings.find((d) => d.id === o.openingId);
        if (door?.type === 'roller_door') return ['Carry Beam with Rolling Door'];
        if (door?.type === 'sliding_door') return ['Carry Beam with Sliding Door'];
        return ['Carry Beam left open'];
      }),
      true,
    ),
  );
  lines.push(...countBlock('Sliding Door', of('sliding_door').map((o) => openingDetail(o, names.get(o.id))), true));
  // v2 has a plain framed opening the desktop does not; it lists after the doors it resembles.
  lines.push(...countBlock('Opening', of('opening').map((o) => openingDetail(o, names.get(o.id))), true));
  lines.push(
    ...countBlock(
      'Mezzanine',
      options.flatMap((o) =>
        o.kind === 'mezzanine'
          ? [`@H${mm(o.level)}xL${mm(o.depth)}xW${mm(o.width)} @${(o.floorLoad ?? 3).toFixed(1)}kPA`]
          : [],
      ),
      true,
    ),
  );
  lines.push(...countBlock('Stable', options.flatMap((o) => (o.kind === 'stable' ? ['stable'] : [])), false));

  // Dividing walls (`printedDividingWallString`).
  const dividing = options.filter((o) => o.kind === 'dividing_wall').length;
  if (dividing > 0) lines.push(`<DW1> Dividing Wall${dividing > 1 ? 's' : ''} x ${dividing}`);

  // Open ends, then open side bays (`printedOpenMainEnd`, `printedOpendMainSideBays`).
  lines.push(...openingLines(shed, sections ?? null));

  if (options.some((o) => o.kind === 'horizontal_cladding')) lines.push('- Horizontal Cladding');
  if (options.some((o) => o.kind === 'gable_infill')) lines.push('- Gable Infill');

  // Cantilever (`GetPrintOptionString`): only when a long wall has one, "-Cantilever: / -Front: F /
  // -Back: B". The desktop's front and back are v2's left and right. A v2 roof overhang is not a
  // cantilever and the desktop prints none, so it is not listed here.
  const reach = (wall: WallSide) =>
    Math.max(0, ...options.flatMap((o) => (o.kind === 'cantilever' && o.wall === wall ? [o.length] : [])));
  const front = reach('left');
  const back = reach('right');
  if (front > 0 || back > 0) lines.push('', '-Cantilever:', ` -Front: ${mm(front)}`, ` -Back: ${mm(back)}`);

  // Misc options (`printedOptionNotes`): "(F1) {name} x {quantity unit}".
  let f = 0;
  for (const o of options) {
    if (o.kind === 'misc_option') lines.push(`(F${++f}) ${o.name} x ${o.quantity} ${o.unit}`);
  }

  return lines;
}

/** The option box as HTML (one line per desktop line; indentation kept). */
export function optionListHtml(shed: DimensionedShed, sections?: DrawingSections | null): string {
  const lines = optionListLines(shed, sections);
  const body = lines.length === 0 ? '<p class="none">No options.</p>' : `<pre>${lines.map(escapeHtml).join('\n')}</pre>`;
  return `<aside class="options" aria-label="Options">
  <h2>Options</h2>
  ${body}
</aside>`;
}

// --- Title block -------------------------------------------------------------

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Brisbane' });
}

/** The five fields the desktop writes on its frame, plus the company and the sheet's title. */
export function titleBlockHtml(document: CustomerDocument, sheetTitle: string): string {
  const site = document.customer.deliveryAddress ?? document.customer.address ?? '';
  const cell = (label: string, value: string, cls = '') =>
    `<div class="cell ${cls}"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
  return `<footer class="title-block">
  ${cell('Client', document.customer.name, 'client')}
  ${cell('Site address', site, 'address')}
  ${cell('State', stateName(document.building.stateCode))}
  ${cell('Job No.', document.quoteNumber)}
  ${cell('Date', dateLabel(document.issuedAt))}
  ${cell(document.company.name, sheetTitle, 'sheet-title')}
</footer>`;
}

// --- SVG primitives ----------------------------------------------------------

export interface Stroke {
  /** Drawing unit for this sheet, mm per text height. */
  text: number;
  line: number;
}

/**
 * A dimension string between two points (in SVG user units). The dimension line is offset from
 * the measured points by `offset` along the normal, with witness lines and architectural ticks;
 * the label sits outside the line.
 */
export function dimSvg(
  a: { x: number; y: number },
  b: { x: number; y: number },
  offset: number,
  label: string,
  s: Stroke,
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const p = { x: a.x + nx * offset, y: a.y + ny * offset };
  const q = { x: b.x + nx * offset, y: b.y + ny * offset };
  const over = Math.sign(offset || 1) * s.text * 0.4;
  const tick = s.text * 0.45;
  const t = (pt: { x: number; y: number }) =>
    `<line x1="${r(pt.x - (dx / len + nx) * tick)}" y1="${r(pt.y - (dy / len + ny) * tick)}" x2="${r(pt.x + (dx / len + nx) * tick)}" y2="${r(pt.y + (dy / len + ny) * tick)}" />`;
  const mid = { x: (p.x + q.x) / 2 + nx * Math.sign(offset || 1) * s.text * 0.6, y: (p.y + q.y) / 2 + ny * Math.sign(offset || 1) * s.text * 0.6 };
  const vertical = Math.abs(dx) < Math.abs(dy);
  const rotate = vertical ? ` transform="rotate(-90 ${r(mid.x)} ${r(mid.y)})"` : '';
  return `<g class="dim" stroke-width="${r(s.line)}">
  <line x1="${r(a.x + nx * Math.sign(offset) * s.text * 0.2)}" y1="${r(a.y + ny * Math.sign(offset) * s.text * 0.2)}" x2="${r(p.x + nx * over)}" y2="${r(p.y + ny * over)}" />
  <line x1="${r(b.x + nx * Math.sign(offset) * s.text * 0.2)}" y1="${r(b.y + ny * Math.sign(offset) * s.text * 0.2)}" x2="${r(q.x + nx * over)}" y2="${r(q.y + ny * over)}" />
  <line x1="${r(p.x)}" y1="${r(p.y)}" x2="${r(q.x)}" y2="${r(q.y)}" />
  ${t(p)}${t(q)}
  <text x="${r(mid.x)}" y="${r(mid.y)}" font-size="${r(s.text)}" text-anchor="middle" dominant-baseline="middle" stroke="none"${rotate}>${escapeHtml(label)}</text>
</g>`;
}

/** A short name in a rhombus, centred on a point (the desktop's `DrawShortName`). */
export function rhombusLabel(x: number, y: number, name: string, s: Stroke): string {
  const w = s.text * (0.55 * name.length + 1.4);
  const h = s.text * 1.5;
  return `<g class="tag" stroke-width="${r(s.line)}">
  <polygon points="${r(x - w / 2)},${r(y)} ${r(x)},${r(y - h / 2)} ${r(x + w / 2)},${r(y)} ${r(x)},${r(y + h / 2)}" fill="#fff" />
  <text x="${r(x)}" y="${r(y)}" font-size="${r(s.text * 0.8)}" text-anchor="middle" dominant-baseline="central" stroke="none">${escapeHtml(name)}</text>
</g>`;
}

/** Coordinates to two decimals, so the markup stays readable. */
export function r(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The sheet CSS both drawings use: A4 landscape, a border, a title block along the foot. */
export const SHEET_CSS = `
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: "Arial Narrow", Arial, Helvetica, sans-serif; color: #111; }
  .sheet { border: 0.6mm solid #111; width: 281mm; height: 194mm; display: flex; flex-direction: column; overflow: hidden; }
  .drawing { flex: 1; display: flex; min-height: 0; }
  .side { width: 22%; display: flex; flex-direction: column; border-right: 0.3mm solid #111; min-height: 0; }
  .building { font-size: 7.5pt; margin: 0; padding: 3mm 3mm 0; line-height: 1.4; }
  .options { padding: 3mm; font-size: 7.5pt; overflow: hidden; }
  .options h2 { font-size: 9pt; margin: 0 0 2mm; text-transform: uppercase; letter-spacing: 0.04em; }
  .options pre { font: inherit; white-space: pre-wrap; margin: 0; line-height: 1.35; }
  .options .none { margin: 0; color: #444; }
  .canvas { flex: 1; min-width: 0; padding: 3mm; display: flex; }
  .canvas svg { width: 100%; height: 100%; }
  svg .dim, svg .tag { stroke: #111; fill: none; }
  svg text { fill: #111; font-family: "Arial Narrow", Arial, Helvetica, sans-serif; }
  .title-block { display: grid; grid-template-columns: 2.2fr 2.6fr 1.4fr 1fr 1fr 1.8fr; border-top: 0.6mm solid #111; }
  .title-block .cell { border-left: 0.3mm solid #111; padding: 1.2mm 2mm; display: flex; flex-direction: column; min-width: 0; }
  .title-block .cell:first-child { border-left: 0; }
  .title-block .label { font-size: 6pt; text-transform: uppercase; color: #333; letter-spacing: 0.04em; }
  .title-block .value { font-size: 9pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title-block .client .value { font-size: 12pt; font-weight: 700; }
  .title-block .sheet-title .value { font-weight: 700; text-transform: uppercase; }
  .note { font-size: 6.5pt; color: #333; padding: 0 3mm 1mm; }
`;
