/**
 * Company settings: one versioned JSON row.
 *
 * ## The trap this module exists to close
 *
 * `settings_json` is a blob. A row written before a field existed **has no such key**, and
 * reading it as `undefined` is not the same as reading `null`. In the upstream project this
 * exact shape took every quote in the product down with a 500 after a new field was added,
 * while the whole test suite passed — because the tests built their company from the defaults,
 * which have the key.
 *
 * So every read goes through `normaliseSettings`, which fills each field explicitly. A test that
 * writes the *old* blob shape is part of the suite for that reason.
 */

import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';

/** The company's own rates, from the desktop's Administration screen. Cents. */
export interface CompanyRates {
  labour: { concreter: number; electrician: number; labourer1: number; labourer2: number };
  defaultCosts: { council: number; engineering: number; rubbish: number; delivery: number; concrete: number };
}

/** Everything a company may configure. */
export interface CompanySettings {
  /** The settings row's version; a revision records the version it was priced under. */
  version: number;
  name: string;
  abn: string | null;
  /**
   * The company's own rate table.
   *
   * `null` until written. Additions uses the labour rates to turn hours into money; with no
   * table the operator types every line by hand.
   */
  rates: CompanyRates | null;
  /** The company's own margin, overriding the book's table for **every** building family. */
  margin: number | null;
  /** Deposit and progress as percentages. GST is not here: it is 10% by law. */
  depositPct: number;
  progressPct: number;
  /** The factory method, when the company chose one. */
  bomProfileId: string | null;
  /**
   * The scope notes printed on every quote, in the company's own voice.
   *
   * `AssumptionNote[]` rather than plain strings, because each one is a heading **and** a paragraph on
   * the page. An earlier version stored strings and the document had to invent headings.
   */
  assumptions: { title: string; body: string }[];
  /** Bank / payment details, printed under the payment schedule. */
  paymentDetails: string | null;

  /*
   * The company's contact block, printed at the top of every document and in the email footer.
   *
   * Every field is `null` until written, and that is deliberate: a revision freezes whatever the
   * company had at save time, so printing nothing is honest while inventing a value is not. A quote
   * saved before this block existed carries no key at all and reads as all nulls.
   */
  address: string | null;
  phone: string | null;
  email: string | null;
  /** What to print where a logo would go, when no image is configured. */
  logoText: string;
  /** The terms, one item each, printed under "Terms" on the document. */
  terms: string[];
}

/**
 * Read a settings blob, filling every field.
 *
 * `null` means "not set" and is deliberate for the margin: a company that has never chosen one
 * follows the book, which is a different statement from choosing 1.0 (sell at cost). Coercing
 * `null` to a number here would silently pick one of them.
 */
export function normaliseSettings(
  raw: Record<string, unknown> | null,
  version: number,
  fallbackName: string,
): CompanySettings {
  const value = raw ?? {};
  const text = (key: string, fallback: string): string =>
    typeof value[key] === 'string' && (value[key] as string).trim() !== ''
      ? (value[key] as string)
      : fallback;
  const orNull = (key: string): string | null =>
    typeof value[key] === 'string' && (value[key] as string).trim() !== '' ? (value[key] as string) : null;
  const number = (key: string, fallback: number): number => {
    const candidate = value[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
  };

  const margin = typeof value.margin === 'number' && Number.isFinite(value.margin) ? value.margin : null;

  /**
   * Scope notes, accepting the shape that was written and degrading the rest.
   *
   * Three shapes exist: `{ title, body }[]` (what the document wants), `string[]` (an earlier
   * setting that stored only the sentence), and nothing at all (a blob written before the field).
   * A string becomes a note whose title is its first sentence, which keeps an old value readable
   * instead of silently discarding what the company wrote.
   */
  const assumptions = Array.isArray(value.assumptions)
    ? value.assumptions.flatMap((item): { title: string; body: string }[] => {
        if (typeof item === 'string' && item.trim() !== '') {
          const firstBreak = item.search(/[.!?]\s/);
          const title = (firstBreak > 0 ? item.slice(0, firstBreak + 1) : item.slice(0, 60)).trim();
          return [{ title, body: item.trim() }];
        }
        if (
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { title?: unknown }).title === 'string' &&
          typeof (item as { body?: unknown }).body === 'string'
        ) {
          return [
            {
              title: (item as { title: string }).title.trim(),
              body: (item as { body: string }).body.trim(),
            },
          ];
        }
        return [];
      })
    : [];

  /** A term is a sentence, not a heading: the document prints the list as written. */
  const terms = Array.isArray(value.terms)
    ? value.terms.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];

  /** What to print where a logo would go, or the company's name when nothing is set. */
  const logoText = orNull('logoText') ?? fallbackName;

  return {
    version,
    name: text('name', fallbackName),
    abn: orNull('abn'),
    rates: readRates(raw),
    // A margin outside 1–10 is a typo, not a strategy. Refused by becoming the default rather
    // than by throwing: a company with a bad stored value should still be able to open a quote.
    margin: margin !== null && margin >= 1 && margin <= 10 ? margin : null,
    depositPct: clampPct(number('depositPct', 10)),
    progressPct: clampPct(number('progressPct', 70)),
    bomProfileId: orNull('bomProfileId'),
    assumptions,
    paymentDetails: orNull('paymentDetails'),
    address: orNull('address'),
    phone: orNull('phone'),
    email: orNull('email'),
    logoText,
    terms,
  };
}

/**
 * Read the stored rate table, or `null`.
 *
 * A partially readable table is treated as absent rather than half-used: nine rates where seven
 * loaded would price some hours and not others, and nobody would notice which.
 */
function readRates(input: Record<string, unknown> | null): CompanyRates | null {
  if (input === null) return null;
  const raw = input.rates;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const table = raw as { labour?: unknown; defaultCosts?: unknown };
  const labour = (table.labour ?? {}) as Record<string, unknown>;
  const costs = (table.defaultCosts ?? {}) as Record<string, unknown>;
  const cents = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

  const read = {
    labour: {
      concreter: cents(labour.concreter),
      electrician: cents(labour.electrician),
      labourer1: cents(labour.labourer1),
      labourer2: cents(labour.labourer2),
    },
    defaultCosts: {
      council: cents(costs.council),
      engineering: cents(costs.engineering),
      rubbish: cents(costs.rubbish),
      delivery: cents(costs.delivery),
      concrete: cents(costs.concrete),
    },
  };

  const values = [...Object.values(read.labour), ...Object.values(read.defaultCosts)];
  if (values.some((value) => value === null)) return null;

  return read as CompanyRates;
}

/** A percentage inside 0–100, or the fallback when the stored value is nonsense. */
function clampPct(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) return 0;
  return value;
}

/** Load a company's current settings, creating a default row when none exists. */
export async function loadSettings(db: Db, tenantId: string): Promise<CompanySettings> {
  const row = await db.get<{ version: number; settings_json: string }>(
    'SELECT version, settings_json FROM company_settings WHERE tenant_id = ? ORDER BY version DESC LIMIT 1',
    [tenantId],
  );

  const tenant = await db.get<{ name: string }>('SELECT name FROM tenants WHERE id = ?', [tenantId]);
  const fallbackName = tenant?.name ?? 'Company';

  if (row === null) {
    return normaliseSettings(null, 0, fallbackName);
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(row.settings_json) as unknown;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // A corrupt blob is not a reason to refuse to open a quote: the defaults are a safer answer
    // than a 500, and the version number still identifies which row was unreadable.
    parsed = null;
  }

  return normaliseSettings(parsed, Number(row.version), fallbackName);
}

/**
 * Write a new settings version.
 *
 * A new row rather than an update, because a revision records the settings version it was priced
 * under. Overwriting in place would make "this quote used a 15% margin" unanswerable the moment
 * somebody changed the margin.
 */
export async function saveSettings(
  db: Db,
  tenantId: string,
  userId: string,
  input: Partial<CompanySettings>,
): Promise<CompanySettings> {
  const current = await loadSettings(db, tenantId);
  const next: CompanySettings = {
    ...current,
    ...input,
    version: current.version + 1,
  };

    await db.run(
      `INSERT INTO company_settings (id, tenant_id, version, settings_json, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        tenantId,
        next.version,
        JSON.stringify({
          name: next.name,
          abn: next.abn,
          rates: next.rates,
          margin: next.margin,
          depositPct: next.depositPct,
          progressPct: next.progressPct,
          bomProfileId: next.bomProfileId,
          assumptions: next.assumptions,
          paymentDetails: next.paymentDetails,
          address: next.address,
          phone: next.phone,
          email: next.email,
          logoText: next.logoText,
          terms: next.terms,
        }),
        now(),
        userId,
      ],
    );

  return next;
}
