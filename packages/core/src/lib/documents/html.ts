/**
 * The customer's quote, as HTML.
 *
 * This is the module a customer actually reads, so two things are non-negotiable:
 *
 * 1. **Every value is escaped.** A customer's name is free text and may contain `<script>`; a
 *    company's terms are typed by an operator. A quote is an injection surface if any of it reaches
 *    the markup unescaped.
 * 2. **It renders from the projection, not from the config.** The projection has already removed
 *    costs and margins, so this module cannot leak one by accident — it never sees them.
 *
 * The layout is print-first: A4, black on white, page breaks where a reader expects them. The
 * "(indicative)" mark is CSS `position: fixed` so it repeats on each printed page without JavaScript.
 *
 * ## What is deliberately absent
 *
 * No watermark, no demo band, no "ask us to build this for you" footer. The upstream project carried
 * all three because it was a demo looking for customers. **This build is the product itself**, and a
 * shed company sending its customer a quote with somebody else's advertising across the page would
 * be indefensible.
 */

import type { CustomerDocument } from './projection';
import { logoDataUri, type LogoImage } from '@/lib/branding/logo';

/**
 * What the renderer may take beyond the document itself.
 *
 * One member, because the only thing a document needs that is not frozen in it is the **image** the
 * frozen hash points at. The value is looked up and passed in rather than read here, so this module
 * stays a pure function of its inputs and `packages/core` keeps its no-filesystem rule at the render
 * boundary.
 */
/**
 * Which document this is.
 *
 * The desktop printed seven kinds from one template, and every one of them showed the client's
 * price — including the order a supplier receives. That is a commercial leak: a supplier who
 * knows the sell price knows the margin. The customer-facing kinds keep the money block; the
 * supplier-facing ones do not.
 */
export type PrintKind =
  | 'quotation'
  | 'contract'
  | 'order'
  | 'supplier-quotation'
  | 'supplier-contract';

/** True for a document that goes to a supplier rather than to the buyer. */
export function isSupplierPrint(kind: PrintKind): boolean {
  return kind === 'order' || kind === 'supplier-quotation' || kind === 'supplier-contract';
}

/** The heading each kind carries, so a reader knows what they are holding. */
const PRINT_TITLE: Record<PrintKind, string> = {
  quotation: 'Quotation',
  contract: 'Contract',
  order: 'Order',
  'supplier-quotation': 'Quotation (supplier copy)',
  'supplier-contract': 'Contract (supplier copy)',
};

export interface QuoteHtmlOptions {
  /** The platform logo, or `null`/absent when there is none. */
  logo?: LogoImage | null;
  /** Defaults to `quotation`, the document a customer receives. */
  printKind?: PrintKind;
}

/**
 * Escape text for an HTML text node or an attribute value.
 *
 * A missing value renders as empty rather than throwing. A revision is a **frozen snapshot** and the
 * company's shape has grown over time: a quote saved before the ABN field existed has no `abn`. That
 * is legitimate history, and a customer holding last month's PDF must still be able to download it —
 * so an absent field prints blank instead of failing the whole document.
 */
function escapeHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Dollars from whole cents, as a customer reads them. */
function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Metres, to two places. */
function metres(mm: number): string {
  return `${(mm / 1000).toFixed(2)} m`;
}

/** A labelled row in a definition list. */
function row(label: string, value: string | null): string {
  return value === null || value === '' ? '' : `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

/**
 * The image, or the company's name as text.
 *
 * The image is used **only when the logo on hand is the one the revision recorded** — `logoHash`
 * against the supplied file's `sha256`. A revision that froze nothing, or froze a file the platform
 * no longer has, prints the text. That is the whole reason the hash travels in the revision: a
 * quote re-opened next year must not silently acquire a mark it was never sent with.
 *
 * The `alt` is the company's name, so the header still reads correctly where images are off — which
 * matters in a mail client more than in a browser.
 */
function logoMarkup(
  logoText: string,
  companyName: string,
  logoHash: string | null,
  logo: LogoImage | null,
): string {
  if (logo === null || logoHash === null || logoHash !== logo.sha256) return escapeHtml(logoText);
  return `<img src="${logoDataUri(logo)}" alt="${escapeHtml(companyName)}" class="logo-img">`;
}

/** An ISO date as a person reads it. Formatting is fixed so a server's locale cannot change it. */
function readableDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = new Date(parsed);
  return `${String(date.getUTCDate()).padStart(2, '0')} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Render the document.
 *
 * The SVG plan is generated from the revision's own dimensions, so it is the building that was
 * quoted rather than a picture of whatever is on a screen now.
 */
export function renderQuoteHtml(document: CustomerDocument, options: QuoteHtmlOptions = {}): string {
  const { company, customer, building, price, plan } = document;
  const indicative = document.status !== 'priced';
  const supplier = isSupplierPrint(options.printKind ?? 'quotation');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quote ${escapeHtml(document.quoteNumber)} — ${escapeHtml(company.name)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #111; font-size: 11pt; line-height: 1.45; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; border-bottom: 2px solid #111; padding-bottom: 8mm; }
  .logo { font-size: 20pt; font-weight: 700; letter-spacing: 1px; }
  .logo-img { max-height: 16mm; max-width: 55mm; object-fit: contain; }
  .company { font-size: 9pt; color: #333; }
  /* Figures in a column, the way a ledger sets them: every amount occupies one width. */
  .mono { font-family: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace; font-variant-numeric: tabular-nums; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 20pt; font-weight: 600; letter-spacing: -.01em; margin: 7mm 0 3mm; padding-bottom: 2.5mm; border-bottom: 1px solid #c9a227; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .5px; margin: 6mm 0 2mm; border-bottom: 1px solid #ccc; padding-bottom: 1mm; }
  .row { display: flex; gap: 4mm; }
  .row dt { width: 45mm; color: #555; flex-shrink: 0; }
  .row dd { margin: 0; flex: 1; }
  ul { margin: 0; padding-left: 5mm; }
  li { margin-bottom: 1mm; }
  table.price { width: 100%; border-collapse: collapse; margin-top: 2mm; }
  table.price th, table.price td { text-align: left; padding: 1.5mm 0; border-bottom: 1px dotted #c9c9c4; }
  table.price td.amount { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; font-size: 15pt; }
  .note { font-size: 9pt; color: #555; }
  .status { display: inline-block; border: 1px solid #b45309; color: #b45309; padding: .5mm 2mm; font-size: 9pt; border-radius: 1mm; }
  /* Fixed positioning so the mark repeats on every printed page without JavaScript. */
  .watermark { position: fixed; top: 45%; left: 0; right: 0; text-align: center; font-size: 26pt;
    color: rgba(180, 30, 30, .14); transform: rotate(-22deg); pointer-events: none; z-index: 99; }
  .plan { border: 1px solid #999; padding: 2mm; }
  .plan svg { width: 100%; height: auto; max-height: 120mm; }
  footer { margin-top: 8mm; border-top: 1px solid #ccc; padding-top: 2mm; font-size: 8pt; color: #666; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
${indicative ? `<div class="watermark">INDICATIVE — ALLOWANCES APPLY</div>` : ''}

<header>
  <div>
    <div class="logo">${logoMarkup(company.logoText, company.name, company.logoHash, options.logo ?? null)}</div>
    <div class="company">
      ${escapeHtml(company.name)}${company.address === '' ? '' : `<br>${escapeHtml(company.address)}`}${company.phone === '' && company.email === '' ? '' : `<br>${escapeHtml([company.phone, company.email].filter((part) => part !== '').join(' · '))}`}${company.abn === '' ? '' : `<br>ABN ${escapeHtml(company.abn)}`}
    </div>
  </div>
  <div class="company" style="text-align:right">
    <strong>Quote <span class="mono">${escapeHtml(document.quoteNumber)}</span></strong><br>
    Revision ${document.revision}<br>
    Issued ${escapeHtml(readableDate(document.issuedAt))}<br>
    Valid until ${escapeHtml(readableDate(document.validUntil))}
  </div>
</header>

<h1>${escapeHtml(PRINT_TITLE[options.printKind ?? 'quotation'])}</h1>
${indicative ? `<p><span class="status">${escapeHtml(document.estimateLabel)}</span></p>` : ''}

<h2>Prepared for</h2>
${row('Name', customer.name)}
${row('Email', customer.email)}
${row('Phone', customer.phone)}
${row('Address', customer.address)}
${row('Delivery address', customer.deliveryAddress)}

<h2>Site conditions</h2>
${row('Wind region', building.windRegion)}
${row('Terrain category', String(building.terrainCategory))}
${row('Importance level', String(building.importanceLevel))}
${row('State', building.stateCode)}
<p class="note">These are the conditions this quotation was priced under. A change of site, or a site in a different classification, requires the quote to be reassessed.</p>

<h2>Building</h2>
${row('Structure', building.structure)}
${row('Span', metres(building.spanMm))}
${row('Length', metres(building.lengthMm))}
${row('Wall height', metres(building.heightMm))}
${row('Roof pitch', `${building.pitchDeg}°`)}
${row('Bays', String(building.bays))}
${row('Colours', `Walls ${building.colours.wall}, roof ${building.colours.roof}, trim ${building.colours.trim}, doors ${building.colours.door}`)}

<h2>Inclusions</h2>
<ul>
${document.inclusions.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')}
</ul>

<h2>Plan</h2>
<div class="plan">
  <svg viewBox="0 0 ${plan.widthMm + 600} ${plan.lengthMm + 600}" role="img" aria-label="Plan of the building">
    <g transform="translate(300,300)">
      <path d="${escapeHtml(plan.outline)}" fill="#f7f7f5" stroke="#111" stroke-width="40" />
      ${
        // Doors and windows, from the same primitives the editor's 2D view draws. An empty rectangle
        // reads as unfinished, and this is the part of the document a customer checks against what
        // they asked for.
        plan.openings
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
          .join('\n      ')
      }
    </g>
  </svg>
  <p class="note">Plan, ${metres(plan.widthMm)} × ${metres(plan.lengthMm)}.${
    plan.openings.length > 0
      ? ` Openings: ${plan.openings.map((opening) => escapeHtml(opening.label)).join(', ')}.`
      : ''
  } Indicative only — not for construction.</p>
</div>

${
  supplier
    ? ''
    : `<h2>Price</h2>
<table class="price">
  <tr class="total"><td>Contract price</td><td class="amount mono">${money(price.contractCents)}</td></tr>
  <tr><td>Includes GST</td><td class="amount mono">${money(price.gstCents)}</td></tr>
</table>

<h2>Payment</h2>
<table class="price">
  <tr><td>Deposit on signing</td><td class="amount mono">${money(price.depositCents)}</td></tr>
  <tr><td>Progress payment at frame stage</td><td class="amount mono">${money(price.progressCents)}</td></tr>
  <tr><td>Balance before delivery</td><td class="amount mono">${money(price.balanceCents)}</td></tr>
</table>`
}

<h2>What this estimate covers</h2>
${document.assumptions
  .map(
    (note) =>
      `<div class="row"><dt>${escapeHtml(note.title)}</dt><dd>${escapeHtml(note.body)}</dd></div>`,
  )
  .join('\n')}
${
  document.caveats.length === 0
    ? ''
    : `<h2>Notes for this building</h2>
<ul>
${document.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')}
</ul>`
}

${
  document.terms.length === 0
    ? ''
    : `<h2>Terms</h2>
<ul>
${document.terms.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')}
</ul>`
}

<h2>Validity</h2>
<p>This quotation is valid until ${escapeHtml(readableDate(document.validUntil))}.</p>

<footer>
  ${escapeHtml(company.name)} · Quote <span class="mono">${escapeHtml(document.quoteNumber)}</span> revision <span class="mono">${document.revision}</span> ·
  Prices in Australian dollars and include GST.<br>
  Engineering review applies to every quotation.
</footer>
</body>
</html>`;
}
