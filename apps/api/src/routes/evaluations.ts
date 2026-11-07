/**
 * Pricing a building, and saving the result as an immutable revision.
 *
 * Two routes that exist as a pair, and the pairing is the design:
 *
 * - `POST /evaluate` prices a config and **stores** the answer with a hash of the config it
 *   priced. It is the only place a price is ever computed for a quote.
 * - `POST /quotes` saves, and **re-reads** that stored answer. It never recomputes. If the book,
 *   an override or the config moved in between, it refuses rather than saving a number the
 *   operator did not see.
 *
 * Splitting them is what makes "the price on screen is the price that was saved" a property of
 * the system rather than a hope.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import {
  companyCan,
  evaluateRequest,
  saveQuoteRequest,
  type BomLineView,
  type EvaluationView,
  type IssueView,
  type PriceView,
  type PricingInput,
} from '@sq/contracts';
import { evaluateQuote, ENGINE_VERSION } from '@sq/core/estimating';
import type { Evaluation } from '@sq/core/estimating';
import { profileById } from '@sq/core/bom';
import type { PriceInput } from '@sq/core/pricing';
import { isEmptyOverrideSet, withOverrides } from '@sq/core/pricing';
import { normaliseShedConfig } from '@sq/core/domain';
import { freightScope, minimumFreightCents, type FreightMinimums } from '@sq/core/domain';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { recordUsage } from '../lib/usage.js';
import { loadOverrides } from '../lib/priceOverrides.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { BookMissingError, activeBookHash, canonicalHash, openBook } from '../lib/priceBook.js';
import {
  SaveRefused,
  consumeEvaluation,
  loadEvaluationForSave,
  nextQuoteNumber,
  storeEvaluation,
} from '../lib/evaluations.js';
import { loadSettings } from '../lib/settings.js';
import { loadPlatformLogo } from '../lib/documents.js';

/**
 * `ENGINE_VERSION` is the string `'1'` — deliberately, so that two builds of the same engine
 * report one version rather than a timestamp. The revision column is an INTEGER, so it is
 * converted once, here, at the boundary between the engine and the database.
 */
const ENGINE_VERSION_INT = Number(ENGINE_VERSION);

/**
 * The pricing policy version.
 *
 * Bumped when the *source* of a number changes rather than the number: 1 is a literal margin,
 * 2 the book's own per-family table, 3 the company's own margin. A revision records it, so
 * "why is this quote at 1.48" stays answerable after the policy moves on.
 */
const POLICY_VERSION = 3;

/**
 * A hash of everything that was priced: the building **and** the money.
 *
 * Not the config alone. Hashing only the building was a real hole: an operator could take a
 * preview, re-negotiate the total, and save — the config had not moved, so the check passed and
 * a figure nobody had seen was written into the revision. The inputs that decide a price are the
 * building and the operator's three figures, so both go in.
 */
function pricedInputsHash(config: unknown, pricing: PricingInput): string {
  return canonicalHash({ config, pricing });
}

/** A stable hash of a priced result, so Save can prove it is the same answer. */
function resultHashOf(evaluation: Evaluation, pricing: PricingInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        // The operator's own figures are part of the identity: a preview at a negotiated total
        // is a different answer from the same building priced at list.
        contract: pricing.contractOverrideCents ?? evaluation.price.contractCents,
        deposit: pricing.depositOverrideCents ?? evaluation.price.depositCents,
        progress: pricing.progressOverrideCents ?? evaluation.price.progressCents,
        total: evaluation.price.totalCents,
        kit: evaluation.price.kitCents,
        mass: evaluation.bom.totalMassKg,
        mocked: evaluation.bom.mockedLines,
        lines: evaluation.bom.groups.flatMap((group) =>
          group.lines.map((line) => [line.code, line.unit, line.quantity, line.unitCost]),
        ),
      }),
    )
    .digest('hex');
}

/** Flatten the BOM groups into the line list a screen renders. */
function toLineViews(evaluation: Evaluation): BomLineView[] {
  return evaluation.bom.groups.flatMap((group) =>
    group.lines.map((line) => ({
      group: group.id,
      code: line.code,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      lengthMm: null,
      unitCostCents: line.unitCost,
      amountCents: line.amount,
      massKg: line.massKg,
      mocked: line.mocked === true,
    })),
  );
}

/**
 * The price chain, every step named so a salesperson can explain the total.
 *
 * The three figures an operator may type — contract, deposit, progress — are applied **here**,
 * on the computed chain, rather than by the engine. That ordering matters: the engine's job is
 * the material cost and the margin, and a negotiated total must not change either. Applying the
 * override afterwards means a quote discounted by hand still reports the same building cost, so
 * "why did we sell that at a loss" is answerable from the revision.
 *
 * The balance is always the remainder, never a typed figure or a fourth rounding, so the three
 * stages sum to the contract exactly. Fifty percent of an odd number of cents would otherwise
 * produce a −1 cent balance.
 */
function toPriceView(evaluation: Evaluation, pricing: PricingInput): PriceView {
  const { price, bom } = evaluation;

  const contractOverridden = pricing.contractOverrideCents !== null;
  const contractCents = pricing.contractOverrideCents ?? price.contractCents;

  /**
   * Changing the contract **re-derives the stages**, which is the desktop's behaviour and the
   * only one that makes sense: a deposit is "10% of what we agreed", so agreeing a different
   * total must move it. Reading the computed deposit back verbatim instead leaves a quote whose
   * deposit is 10% of a number nobody agreed — and the three stages then do not sum to the
   * contract, which is the defect this replaced.
   *
   * The stage rule mirrors `priceQuote`'s: a pair of percentages that means to cover the contract
   * leaves no balance, so the progress payment absorbs the rounding.
   */
  const stagesAreWhole = Math.abs(pricing.depositPct + pricing.progressPct - 100) <= 0.5;

  const depositCents =
    pricing.depositOverrideCents ??
    (contractOverridden
      ? Math.round((contractCents * pricing.depositPct) / 100)
      : price.depositCents);

  const progressCents =
    pricing.progressOverrideCents ??
    (contractOverridden
      ? stagesAreWhole
        ? contractCents - depositCents
        : Math.round((contractCents * pricing.progressPct) / 100)
      : price.progressCents);

  // Always the remainder — never typed, never a fourth rounding — so the three stages sum to the
  // contract exactly.
  const balanceCents = contractCents - depositCents - progressCents;

  return {
    buildingCostCents: bom.buildingCost,
    totalCostCents: bom.totalCost,
    margin: price.margin,
    kitCents: price.kitCents,
    deliveryCents: price.deliveryCents,
    engineeringCents: price.engineeringCents,
    extraCents: price.extraCents,
    totalCents: price.totalCents,
    quoteRatePct: price.quoteRatePct,
    additionsCents: price.additionsCents,
    contractCents,
    // GST is extracted from the contract, not added to it. When the contract was overridden the
    // GST moves with it, because the figure an Australian buyer reads is GST-inclusive.
    gstCents: contractCents - Math.round(contractCents / (1 + price.gstRate)),
    depositCents,
    progressCents,
    balanceCents,
    totalMassKg: bom.totalMassKg,
    overridden: {
      contract: contractOverridden,
      deposit: pricing.depositOverrideCents !== null,
      progress: pricing.progressOverrideCents !== null,
    },
  };
}

/**
 * The price a caller without `cost:margin` may see.
 *
 * The four internal figures — material cost, the two totals they produce, and the kit
 * price — are removed rather than zeroed: a zero margin reads as "no profit", which is a
 * worse answer than "not shown".
 */
function withoutInternalPrice(price: PriceView): PriceView {
  const copy: PriceView = { ...price };
  delete copy.buildingCostCents;
  delete copy.totalCostCents;
  delete copy.margin;
  delete copy.kitCents;
  return copy;
}

/**
 * How many BOM lines carry no price at all.
 *
 * Read from the stored lines rather than inferred from the estimate status: `indicative` means an
 * allowance, `blocked` means the quantities could not be built, and only a line marked `mocked`
 * means a figure is genuinely missing.
 */
function countMockedLines(linesJson: string): number {
  try {
    const lines = JSON.parse(linesJson) as { mocked?: boolean }[];
    return Array.isArray(lines) ? lines.filter((line) => line.mocked === true).length : 0;
  } catch {
    return 0;
  }
}

/** The issues, with the customer-visibility flag the document renderer will read. */
function toIssueViews(evaluation: Evaluation): IssueView[] {
  return evaluation.issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    ...(issue.field === undefined ? {} : { group: issue.field }),
    customerVisible: issue.severity === 'assumption' || issue.severity === 'warning',
  }));
}

export function registerEvaluations(app: FastifyInstance, db: Db): void {
  app.post('/evaluate', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const body = parseBody(evaluateRequest, request.body, reply);
    if (body === null) return;

    const tenantId = session.tenantId as string;
    const hash = await activeBookHash(db);
    if (hash === null) {
      // A distinct code, because this is a deployment step, not a bad request.
      return sendFail(
        reply,
        'not_configured',
        'No price book has been published yet, so nothing can be priced. An administrator has to publish one.',
      );
    }

    let lookup: ReturnType<typeof openBook>['lookup'];
    try {
      lookup = openBook(hash).lookup;
    } catch (error) {
      if (error instanceof BookMissingError) {
        return sendFail(reply, 'not_configured', error.message);
      }
      throw error;
    }

    /*
     * The company's own prices, applied over the book.
     *
     * This was missing: `price_row_overrides` and `company_catalogue_rows` were **written** by the
     * price list import and read by nothing, so a company could load its supplier's list, watch it be
     * accepted, and still have every quote priced from the shared book. The version below travels
     * into the evaluation record, so a revision can name the price set it was built from.
     */
    const overrides = await loadOverrides(db, tenantId);
    if (!isEmptyOverrideSet(overrides)) {
      lookup = withOverrides(lookup, overrides);
    }

    const settings = await loadSettings(db, tenantId);

    /*
     * The factory method, from the company's settings.
     *
     * `FACTORY_PROFILES` and `profileById` were written and never called from a route: the policy
     * below passed no `bom`, so every quote in the product was priced with `DEFAULT_BOM_RULES` and
     * the `bomProfileId` field on the settings screen was inert — a control that stored a value
     * nothing read. A company that chose "heavy fixing" got the default bolts per column.
     *
     * The rules travel into the evaluation, and the revision records the profile id beside them, so
     * a quote can still answer "which factory method produced these quantities".
     */
    const profile = profileById(settings.bomProfileId);
    const bom = { rules: profile.rules, profile: profile.id };

    // The margin: the company's own when it set one, otherwise the book's own table. The
    // `marginFor` hook lets the book price families apart (a carport carries a higher
    // multiplier than a shed of the same size).
    const evaluation = evaluateQuote(
      body.config,
      { ...body.pricing } satisfies Omit<PriceInput, 'margin'>,
      {
        lookup,
        provenance: {
          baseBookHash: hash,
          engineVersion: ENGINE_VERSION,
          policyVersion: POLICY_VERSION,
          overrideVersion: overrides.version,
        },
        policy: {
          margin: settings.margin ?? 1.48,
          currency: 'AUD',
          chargeBasis: 'selling-gst-inclusive',
          bom,
        },
      },
    );

    const normalised = normaliseShedConfig(body.config);
    // The same expression the save route uses. Two spellings of "what was priced" is exactly how
    // a check passes on one side and fails on the other.
    const configHash = pricedInputsHash(normalised, body.pricing);
    const resultHash = resultHashOf(evaluation, body.pricing);
    const lines = toLineViews(evaluation);
    const price = toPriceView(evaluation, body.pricing);

    const stored = await storeEvaluation(db, {
      tenantId,
      userId: session.userId,
      configHash,
      resultHash,
      priceBookHash: hash,
      overrideVersion: overrides.version,
      settingsVersion: settings.version,
      engineVersion: ENGINE_VERSION_INT,
      status: evaluation.status,
      price,
      lines,
      members: evaluation.members,
      punchings: evaluation.punchings,
      issues: toIssueViews(evaluation),
    });

    /*
     * The internal breakdown leaves the server only for `cost:margin`.
     *
     * The revision is stored in full (audit needs it), but the answer to this caller is
     * filtered: an estimator holds `cost:read` because they quote from the sell price,
     * and the material cost, margin and kit price are not theirs to see. Filtering here
     * rather than only in the screen is what makes the capability a rule.
     */
    const canSeeMargin = session.role !== null && companyCan(session.role, 'cost:margin');
    // The frame design is a workshop fact, not a cost: `cost:read` gates it, the same capability
    // the saved schedule route asks for.
    const canSeeDesign = session.role !== null && companyCan(session.role, 'cost:read');
    const view: EvaluationView = {
      evaluationId: stored.id,
      configHash,
      resultHash,
      status: evaluation.status,
      price: canSeeMargin ? price : withoutInternalPrice(price),
      lines: canSeeMargin ? lines : [],
      // The section sizes are the supplier's engineering, so they travel with the cost view
      // rather than the sell view: an estimator quoting from the sell price does not need the
      // factory's framing to answer the customer.
      members: canSeeDesign
        ? evaluation.members.map((member) => ({
            item: member.item,
            label: member.label,
            section: member.section,
            assumed: member.assumed,
            lengthMm: member.lengthMm,
            quantity: member.quantity,
          }))
        : [],
      // Same capability as the members: hole positions are the factory's workshop data,
      // and a viewer reads the quote, not how it is fabricated.
      punchings: canSeeDesign ? evaluation.punchings : [],
      issues: toIssueViews(evaluation),
      priceBookHash: hash,
      overrideVersion: overrides.version,
      engineVersion: ENGINE_VERSION_INT,
      expiresAt: stored.expiresAt,
    };

    return sendOk(reply, view);
  });

  /**
   * Save. Creates a quote, or appends a revision to one.
   *
   * The whole thing is one transaction: the revision, the quote header, the counter and the
   * evaluation's consumption either all happen or none do. A revision written without the header
   * moving is a quote whose list row lies about its own price.
   */
  app.post('/quotes', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const body = parseBody(saveQuoteRequest, request.body, reply);
    if (body === null) return;

    const tenantId = session.tenantId as string;

    /**
     * Idempotency **first**, before the evaluation is touched.
     *
     * A double-click is two requests with one key, and the second must return the first's
     * revision rather than an error. Checking the evaluation first looked equivalent and was not:
     * the first save consumes the preview, so the replay met "this preview has already been
     * saved" and answered 409 — the operator's second click reported a conflict for something
     * that had worked. The order is the fix.
     *
     * It is also cheaper: a replay recomputes nothing.
     */
    const replayed = await db.get<{ id: string; quote_id: string; revision: number; contract_cents: number }>(
      'SELECT id, quote_id, revision, contract_cents FROM quote_revisions WHERE tenant_id = ? AND idempotency_key = ?',
      [tenantId, body.idempotencyKey],
    );
    if (replayed !== null) {
      const quote = await db.get<{ number: string }>('SELECT number FROM quotes WHERE id = ?', [
        replayed.quote_id,
      ]);
      return sendOk(reply, {
        quoteId: replayed.quote_id,
        quoteNumber: quote?.number ?? '',
        revision: Number(replayed.revision),
        revisionId: replayed.id,
        contractCents: Number(replayed.contract_cents),
        replayed: true,
      });
    }

    const configHash = pricedInputsHash(normaliseShedConfig(body.config), body.pricing);

    let evaluation;
    try {
      evaluation = await loadEvaluationForSave(db, {
        tenantId,
        userId: session.userId,
        evaluationId: body.evaluationId,
        configHash,
      });
    } catch (error) {
      if (error instanceof SaveRefused) {
        const code = error.code === 'not_yours' ? 'not_found' : 'conflict';
        return sendFail(reply, code, error.message);
      }
      throw error;
    }

    const settings = await loadSettings(db, tenantId);
    // Read once at save so the revision records the logo it was sent under; the render routes read
    // the file again and compare hashes.
    const logo = await loadPlatformLogo();
    const price = JSON.parse(evaluation.priceJson) as PriceView;

    /*
     * Refuse a save whose price set moved after the preview.
     *
     * The preview recorded the override version it was priced under. If a company imports a new price
     * list between preview and save, the figure on screen is no longer what this engine would now
     * produce — and saving it would freeze a price nobody can reproduce. The building is checked the
     * same way a few lines above; this closes the other moving part.
     */
    const currentOverrides = await loadOverrides(db, tenantId);
    if (currentOverrides.version !== evaluation.overrideVersion) {
      return sendFail(
        reply,
        'conflict',
        'The company prices changed after this price was calculated. Calculate the price again before saving.',
      );
    }

    /*
     * Refuse a delivery below the freight minimum the chosen scope is held to.
     *
     * The Cost step already says this, in red, beside the figure — and a warning on a screen is not a
     * rule: the same request can come from anything that speaks to the API, and an operator who clicks
     * past the sentence issues a quote whose freight the company pays out of its margin. The minimum is
     * a term of trade with the distributor, so it is enforced where the money is frozen.
     *
     * The base is `total − delivery`, the GST-inclusive value of the job without freight, taken from
     * the **evaluation** rather than from the request so that what is checked is what is about to be
     * saved.
     */
    const freightMinimum = minimumFreightFor(settings.minimumFees, body.site.deliveryScope, price);
    if (freightMinimum !== null && price.deliveryCents < freightMinimum) {
      return sendFail(
        reply,
        'validation_failed',
        `“${body.site.deliveryScope}” is held to a minimum freight of ${dollars(freightMinimum)}. This quote carries ${dollars(price.deliveryCents)} — the difference is freight the company would pay. Raise the delivery figure, or choose a different delivery scope.`,
        [{ path: 'cost-delivery', message: `Minimum for this scope is ${dollars(freightMinimum)}.` }],
      );
    }

    try {
      const result = await db.transaction(async (tx) => {
        let quoteId = body.quoteId;
        let quoteNumber: string;
        let revisionNumber: number;

        if (quoteId === undefined) {
          quoteNumber = await nextQuoteNumber(tx, tenantId);
          revisionNumber = 1;
        } else {
          const quote = await tx.get<{ number: string; current_revision: number }>(
            'SELECT number, current_revision FROM quotes WHERE id = ? AND tenant_id = ?',
            [quoteId, tenantId],
          );
          if (quote === null) throw new SaveRefused('not_yours', 'That quote is not available.');

          // Two tabs that both thought they were appending after revision N must not both
          // succeed. The expected number comes from the client, so a stale tab is refused
          // rather than silently overwriting the other one's revision number.
          if (Number(quote.current_revision) !== body.expectedRev) {
            throw new SaveRefused(
              'conflict',
              `This quote is on revision ${quote.current_revision}, not ${body.expectedRev}. Reload it before saving, so you are not overwriting somebody else's revision.`,
            );
          }
          quoteNumber = quote.number;
          revisionNumber = body.expectedRev + 1;
        }

        // The customer: upserted by email within the company, so the same person quoted twice is
        // one customer record rather than two that each look complete.
        const customerId = await upsertCustomer(tx, tenantId, {
          firstName: body.customer.firstName,
          lastName: body.customer.lastName,
          email: body.customer.email,
          phone: body.customer.phone ?? null,
          mobile: body.customer.mobile ?? null,
          address: body.customer.address,
          suburb: body.customer.suburb ?? null,
          state: body.customer.state ?? null,
          postcode: body.customer.postcode ?? null,
        });

        const at = now();
        const revisionId = newId();

        /*
         * Two different facts, and conflating them made the screen lie.
         *
         * `incomplete` means **a BOM line has no price**, so the total is not a total and the quote
         * must not be sent. It is `mockedLines > 0`.
         *
         * `indicative` — the third estimate status — means every line is priced but at least one
         * figure is an *allowance*: girts priced from the purlin section, a skylight priced as a
         * steel sheet. That quote is perfectly sendable; the customer just sees the caveat.
         *
         * The row used `status !== 'priced'`, so a fully priced quote with one allowance was listed
         * as "unpriced lines" — visible on the $27,500 quote in the browser, which had no unpriced
         * line at all. A warning that fires on a correct quote teaches people to ignore warnings.
         */
        const mockedLines = evaluation.linesJson === '' ? 0 : countMockedLines(evaluation.linesJson);
        const incomplete = mockedLines > 0;

        if (quoteId === undefined) {
          quoteId = newId();
          await tx.run(
            `INSERT INTO quotes (id, tenant_id, number, customer_id, status, current_revision, contract_cents, incomplete, site_json, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
            [
              quoteId,
              tenantId,
              quoteNumber,
              customerId,
              revisionNumber,
              price.contractCents,
              incomplete ? 1 : 0,
              JSON.stringify(body.site),
              session.userId,
              at,
              at,
            ],
          );

          /*
           * Link a site check that was pinned before this quote existed.
           *
           * Checked against the tenant: a check id from another company is ignored rather
           * than refused, because the link is a convenience and refusing the save would
           * lose the operator's work over a stale tab.
           */
          if (body.siteCheckId !== undefined) {
            const check = await tx.get<{ id: string }>(
              'SELECT id FROM site_checks WHERE id = ? AND tenant_id = ?',
              [body.siteCheckId, tenantId],
            );
            if (check !== null) {
              await tx.run('UPDATE quotes SET site_check_id = ?, updated_at = ? WHERE id = ?', [
                check.id,
                at,
                quoteId,
              ]);
            }
          }
        } else {
          await tx.run(
            'UPDATE quotes SET current_revision = ?, contract_cents = ?, incomplete = ?, site_json = ?, updated_at = ? WHERE id = ?',
            [revisionNumber, price.contractCents, incomplete ? 1 : 0, JSON.stringify(body.site), at, quoteId],
          );
        }

        await tx.run(
          `INSERT INTO quote_revisions (
             id, quote_id, tenant_id, revision, name, description,
             config_json, bom_json, members_json, punchings_json, price_json, issues_json, customer_json,
             company_json, provenance_json, config_hash, result_hash, bom_hash, price_book_hash,
             override_version, settings_version, engine_version, contract_cents, total_cost_cents,
             total_mass_kg, mocked_lines, idempotency_key, created_by, created_by_email, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            revisionId,
            quoteId,
            tenantId,
            revisionNumber,
            body.revisionName ?? (revisionNumber === 1 ? 'Initial version' : `Revision ${revisionNumber}`),
            body.revisionDescription ?? '',
            // The frozen inputs and outputs. A price-book update next month must not move these.
            JSON.stringify(normaliseShedConfig(body.config)),
            evaluation.linesJson,
            // The cut list, frozen beside the BOM it prices. A workshop builds from it, so it must
            // be the steel this revision was quoted on, not what a later profile would choose.
            evaluation.membersJson,
            // The punch sheet, frozen beside the members it punches. A later book revision could
            // move a connector; a sheet that followed it would not match the member already cut.
            evaluation.punchingsJson,
            evaluation.priceJson,
            evaluation.issuesJson,
            JSON.stringify(body.customer),
            /*
             * The whole company block, frozen.
             *
             * An earlier version stored `{ name, version }` and the customer's document then printed
             * the company name and nothing else — no ABN, no address, no terms, no scope notes — while
             * the verification run read right past it. The document renders from this snapshot, so the
             * snapshot must carry everything the document prints.
             */
            JSON.stringify({
              version: settings.version,
              name: settings.name,
              abn: settings.abn,
              address: settings.address,
              phone: settings.phone,
              email: settings.email,
              logoText: settings.logoText,
              // Which logo this quote was sent under, so the document keeps it even if the
              // platform rebrands. `null` when the installation has no logo configured.
              logoHash: logo?.sha256 ?? null,
              terms: settings.terms,
              assumptions: settings.assumptions,
              depositPct: settings.depositPct,
              progressPct: settings.progressPct,
            }),
            JSON.stringify({
              priceBookHash: evaluation.priceBookHash,
              overrideVersion: evaluation.overrideVersion,
              settingsVersion: settings.version,
              engineVersion: evaluation.engineVersion,
            }),
            evaluation.configHash,
            evaluation.resultHash,
            canonicalHash(JSON.parse(evaluation.linesJson)),
            evaluation.priceBookHash,
            evaluation.overrideVersion,
            settings.version,
            evaluation.engineVersion,
            price.contractCents,
            // The stored evaluation always carries the full price — the filter is applied
            // to the response, never to what was written for audit.
            price.totalCostCents ?? 0,
            price.totalMassKg,
            mockedLines,
            body.idempotencyKey,
            session.userId,
            session.email,
            at,
          ],
        );

        await consumeEvaluation(tx, evaluation.id);

        return {
          quoteId,
          quoteNumber,
          revision: revisionNumber,
          revisionId,
          contractCents: price.contractCents,
          replayed: false,
        };
      });

      /*
       * Record the save, once per real write.
       *
       * A replay is not a second quote: the same idempotency key means the operator double-clicked,
       * and counting it twice would make the usage figures wrong in exactly the direction a vendor
       * would notice. The distinction is `replayed`, which the route already computes.
       */
      if (!result.replayed) {
        await recordUsage(db, {
          kind: result.revision === 1 ? 'quote_created' : 'revision_saved',
          tenantId,
          userId: session.userId,
          detail: { quoteId: result.quoteId, revision: result.revision },
        });
      }

      return sendOk(reply, result, result.replayed ? 200 : 201);
    } catch (error) {
      if (error instanceof SaveRefused) {
        return sendFail(reply, error.code === 'conflict' ? 'conflict' : 'not_found', error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      // The idempotency index and the revision index are the two constraints a second writer can
      // hit; anything else is a bug and should not be reported as a conflict.
      if (/UNIQUE|duplicate key/i.test(message)) {
        return sendFail(reply, 'conflict', 'That revision was saved by another request. Reload the quote.');
      }
      throw error;
    }
  });
}

/** Add or update a customer inside one company, by email. */
async function upsertCustomer(
  tx: Db,
  tenantId: string,
  input: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    mobile: string | null;
    address: string;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
  },
): Promise<string> {
  const existing = await tx.get<{ id: string }>(
    'SELECT id FROM customers WHERE tenant_id = ? AND email = ?',
    [tenantId, input.email],
  );

  const at = now();

  if (existing !== null) {
    await tx.run(
      `UPDATE customers SET first_name = ?, last_name = ?, phone = ?, mobile = ?, address = ?,
              suburb = ?, state = ?, postcode = ?, updated_at = ? WHERE id = ?`,
      [
        input.firstName,
        input.lastName,
        input.phone,
        input.mobile,
        input.address,
        input.suburb,
        input.state,
        input.postcode,
        at,
        existing.id,
      ],
    );
    return existing.id;
  }

  const id = newId();
  await tx.run(
    `INSERT INTO customers (id, tenant_id, first_name, last_name, email, phone, mobile, address, suburb, state, postcode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tenantId,
      input.firstName,
      input.lastName,
      input.email,
      input.phone,
      input.mobile,
      input.address,
      input.suburb,
      input.state,
      input.postcode,
      at,
      at,
    ],
  );
  return id;
}

/** `$1,234.56`, for a message a person reads. */
function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The freight minimum the quote's delivery scope is held to, or `null` when it is held to none.
 *
 * Three ways to answer `null`, and they mean different things: the scope is an ordinary distance
 * band (the book states a figure, which the operator typed), no minimum has been agreed with the
 * distributor, or the scope is empty. In every one of them the delivery figure is the operator's to
 * set, so the save is not the place to argue about it.
 */
function minimumFreightFor(
  minimums: FreightMinimums,
  scope: string | undefined,
  price: PriceView,
): number | null {
  const kind = freightScope(scope ?? '');
  if (kind === null) return null;

  const minimum = minimumFreightCents({
    scope: kind,
    minimums,
    baseCents: Math.max(0, price.totalCents - price.deliveryCents),
    quoteRatePct: price.quoteRatePct,
  });
  return minimum > 0 ? minimum : null;
}
