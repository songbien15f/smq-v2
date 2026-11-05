/**
 * Reading a frozen revision back for a document.
 *
 * One function, three callers: the HTML download, the PDF render, and the customer's share link.
 * They must produce the same page from the same row, so the assembly lives here rather than in each
 * route — a second copy would be a second answer about what a customer was sent.
 *
 * ## Why the row is parsed rather than trusted
 *
 * `config_json`, `price_json` and the rest are text columns written by an older version of this
 * program. A revision saved a year ago was written by a different shape, and a document that throws
 * on a missing field takes down the download, the email and the share link at once. So every parse
 * has a fallback, and a missing value prints blank rather than failing.
 */

import type { Db } from '@sq/db';
import { resolveFromRoot } from '@sq/db';
import type { FrozenIssue, FrozenPrice, FrozenRevision, PrintKind } from '@sq/core/documents';
import { renderPlanPageHtml, renderQuoteHtml, toCustomerDocument } from '@sq/core/documents';
import { normaliseShedConfig } from '@sq/core/domain';
import { loadLogo } from '@sq/core/branding';

/**
 * The platform logo, or `null` when none is configured.
 *
 * `LOGO_FILE` goes through `resolveFromRoot` for the reason every other configured path does: a
 * relative path means "from the workspace root", not "from whichever package happened to start the
 * process". Resolving it here rather than at each call site is what stops the document route and
 * the save route disagreeing about which file they mean.
 */
export function loadPlatformLogo(): ReturnType<typeof loadLogo> {
  const configured = process.env.LOGO_FILE;
  return loadLogo(configured === undefined || configured.trim() === '' ? undefined : resolveFromRoot(configured));
}

/**
 * The revision as the customer's page.
 *
 * The logo is loaded here, once, and handed to the renderer as an option rather than read inside it:
 * `packages/core` does not touch the filesystem at render time, and a route that read the file
 * itself would be a second place that decides what a document looks like.
 *
 * `LOGO_FILE` is read on each call. The file is at most a megabyte and a document is rendered once
 * per download, so the read is not worth caching — and not caching is what lets an operator replace
 * the logo without restarting the API.
 */
export async function renderFrozenHtml(frozen: FrozenRevision): Promise<string> {
  return (await renderFrozenDocument(frozen)).html;
}

/**
 * The same render, with the identity of the logo it actually used.
 *
 * `logoKey` exists for one reason: the PDF cache is keyed on a hash of the revision, and the page
 * now also depends on `LOGO_FILE`. Two renders of one revision under two different logos produce
 * different pages, so they must not share a cache entry — and the only way to guarantee the key
 * matches the bytes is to take it from the render itself rather than recompute it at the call site.
 *
 * The value is the logo's sha256 when the image was used, and the literal `'text'` when the text
 * fallback was — so replacing a logo, removing it, or restoring the same one each move the key.
 */
export async function renderFrozenDocument(
  frozen: FrozenRevision,
  printKind: PrintKind = 'quotation',
): Promise<{ html: string; logoKey: string }> {
  const logo = await loadPlatformLogo();
  const used = logo !== null && frozen.company.logoHash === logo.sha256 ? logo.sha256 : 'text';
  return {
    html: renderQuoteHtml(toCustomerDocument(frozen), { logo, printKind }),
    logoKey: used,
  };
}

/** The plan as a drawing sheet: no price, no customer block. */
export async function renderFrozenPlan(frozen: FrozenRevision): Promise<string> {
  return renderPlanPageHtml(toCustomerDocument(frozen));
}

/** Raised when the revision does not exist, or belongs to another company. */
export class RevisionNotFound extends Error {
  constructor() {
    super('Not found.');
    this.name = 'RevisionNotFound';
  }
}

/** Parse a JSON column, returning `fallback` for anything unreadable. */
function parse<T>(json: string, fallback: T): T {
  try {
    const value = JSON.parse(json) as unknown;
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Read one revision of one quote, ready to render. */
export async function loadFrozenRevision(
  db: Db,
  input: { tenantId: string; quoteId: string; revision: number },
): Promise<FrozenRevision> {
  const row = await db.get<{
    revision: number;
    created_at: string;
    config_json: string;
    price_json: string;
    issues_json: string;
    customer_json: string;
    company_json: string;
    quote_number: string;
    site_json: string;
  }>(
    `SELECT r.revision, r.created_at, r.config_json, r.price_json, r.issues_json,
            r.customer_json, r.company_json,
            q.number AS quote_number, q.site_json
       FROM quote_revisions r
       JOIN quotes q ON q.id = r.quote_id
      WHERE r.quote_id = ? AND r.tenant_id = ? AND r.revision = ?`,
    [input.quoteId, input.tenantId, input.revision],
  );

  // A revision that belongs to another company is reported as missing rather than forbidden: a
  // different answer would confirm the quote exists.
  if (row === null) throw new RevisionNotFound();

  const price = parse<Partial<FrozenPrice>>(row.price_json, {});
  const customer = parse<Record<string, string | null>>(row.customer_json, {});
  const company = parse<Record<string, unknown>>(row.company_json, {});
  const site = parse<Record<string, string | null>>(row.site_json, {});
  const issues = parse<FrozenIssue[]>(row.issues_json, []);

  /*
   * The validity window: thirty days from the revision's own creation, not "now + 30".
   *
   * A quote read back next year must still say the date it was valid to. Computing it at read time
   * would quietly extend the offer every time somebody opened it.
   */
  const created = Date.parse(row.created_at);
  const validUntil = Number.isFinite(created)
    ? new Date(created + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : row.created_at.slice(0, 10);

  return {
    quoteNumber: row.quote_number,
    revision: Number(row.revision),
    createdAt: row.created_at,
    validUntil,
    config: normaliseShedConfig(parse<unknown>(row.config_json, {})),
    price: {
      contractCents: Number(price.contractCents ?? 0),
      gstCents: Number(price.gstCents ?? 0),
      depositCents: Number(price.depositCents ?? 0),
      progressCents: Number(price.progressCents ?? 0),
      balanceCents: Number(price.balanceCents ?? 0),
      depositPct: Number(price.depositPct ?? 10),
      progressPct: Number(price.progressPct ?? 70),
    },
    issues,
    company: {
      name: String(company.name ?? ''),
      abn: company.abn === undefined ? null : (company.abn as string | null),
      address: (company.address as string | null) ?? null,
      phone: (company.phone as string | null) ?? null,
      email: (company.email as string | null) ?? null,
      /*
       * A revision frozen before the contact block existed has no `logoText` and no `terms`, and a
       * revision frozen between the two has one but not the other. Each falls back rather than
       * becoming a blank or a crash: the name where there is no logo, and no terms section where
       * there are no terms.
       */
      logoText: typeof company.logoText === 'string' && company.logoText !== '' ? company.logoText : String(company.name ?? ''),
      // Which logo this revision may use. A revision saved before the field existed has none, which
      // is why the fallback is `null` and the document prints the text logo rather than guessing.
      logoHash: typeof company.logoHash === 'string' && company.logoHash !== '' ? company.logoHash : null,
      terms: Array.isArray(company.terms) ? (company.terms as string[]) : [],
      assumptions: Array.isArray(company.assumptions)
        ? (company.assumptions as { title: string; body: string }[])
        : null,
    },
    customer: {
      firstName: String(customer.firstName ?? ''),
      lastName: String(customer.lastName ?? ''),
      email: (customer.email as string | null) ?? null,
      phone: (customer.phone as string | null) ?? null,
      mobile: (customer.mobile as string | null) ?? null,
      address: (customer.address as string | null) ?? null,
      suburb: (customer.suburb as string | null) ?? null,
      state: (customer.state as string | null) ?? null,
      postcode: (customer.postcode as string | null) ?? null,
      // The delivery address lives on the site record, not the customer: a dealer quotes one
      // customer's shed on a different block often enough that the two are separate fields.
      deliveryAddress:
        (site.deliveryAddress as string | null) ?? (site.address as string | null) ?? null,
    },
  };
}

/**
 * The content hash a PDF cache is keyed on: the revision, the document layout version, and the
 * identity of the logo in force.
 *
 * The logo is here because the page now depends on it: the same revision rendered under two
 * different logos is two different documents. Left out, a PDF rendered before a rebrand would be
 * served for that revision forever, while the HTML of the same revision had already switched to the
 * new mark — the two doors showing a customer different pages.
 *
 * `logoKey` comes from `renderFrozenDocument`, so it describes the bytes that were actually
 * rendered rather than a second guess at what they should have been.
 */
export function revisionDocumentKey(revision: FrozenRevision, logoKey = 'text'): string {
  // Everything a rendered page depends on, so a revision whose stored JSON was edited (which the
  // database refuses) cannot serve a stale PDF.
  return [
    revision.quoteNumber,
    revision.revision,
    revision.createdAt,
    JSON.stringify(revision.config),
    JSON.stringify(revision.price),
    JSON.stringify(revision.company),
    JSON.stringify(revision.customer),
    logoKey,
  ].join('|');
}
