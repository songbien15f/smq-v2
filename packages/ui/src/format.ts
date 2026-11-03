/**
 * Formatting. One function per number type, used everywhere.
 *
 * The rule that matters: **a component never formats a number by hand.** Two
 * formatters is how `1,234` and `1234` end up in the same document, and how a
 * customer sees a price in one place and a different-looking price in the PDF.
 */

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const AUD_ROUND = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

const INT = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });

/**
 * Money from **cents**, which is how every amount is stored.
 *
 * Storing dollars as a float is the defect that makes a total disagree with the sum
 * of its parts by a cent; cents are integers and cannot.
 */
export function money(cents: number, options: { round?: boolean } = {}): string {
  if (!Number.isFinite(cents)) return '—';
  const dollars = cents / 100;
  return options.round === true ? AUD_ROUND.format(roundHalfUp(dollars)) : AUD.format(dollars);
}

/** A signed amount, for a difference between two prices. */
export function moneyDelta(cents: number): string {
  if (!Number.isFinite(cents) || cents === 0) return money(0);
  const sign = cents > 0 ? '+' : '−';
  return `${sign}${money(Math.abs(cents))}`;
}

/**
 * Millimetres, as the trade writes them.
 *
 * The building is stored in integer millimetres and shown in millimetres: an
 * Australian shed is "9 metres wide", but a wall sheet is "6173 mm" and the
 * workshop works in millimetres. The input convenience is metres; the record is mm.
 */
export function millimetres(mm: number): string {
  if (!Number.isFinite(mm)) return '—';
  return `${INT.format(Math.round(mm))} mm`;
}

/** Metres, for a dimension read at a glance. */
export function metres(mm: number, fractionDigits = 2): string {
  if (!Number.isFinite(mm)) return '—';
  return `${(mm / 1000).toFixed(fractionDigits)} m`;
}

/** A quantity, which may be fractional (12.5 m of a section). */
export function quantity(value: number, maxFractionDigits = 3): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: maxFractionDigits }).format(value);
}

/** A percentage the operator typed, e.g. `12.5`. */
export function percent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

/** An ISO timestamp as a date a person reads. `undefined` locale avoids a
 *  server/client hydration mismatch, which is a real bug in a Next app. */
export function date(iso: string, locale = 'en-AU'): string {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

/** An ISO timestamp as date and time. */
export function dateTime(iso: string, locale = 'en-AU'): string {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** Round half away from zero, which is what an accountant expects and what
 *  `Math.round` does not do for negative values. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
