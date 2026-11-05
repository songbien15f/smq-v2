'use client';

/**
 * Step 3 — the cost, and the only three figures an operator may type.
 *
 * ## Why exactly three, and why the rest are read-only
 *
 * A salesperson negotiates a total, then agrees a deposit and a stage payment. Everything else —
 * material cost, margin, GST, the kit price — is derived from the building and the price book, and
 * letting it be typed would let a quote be presented at a loss without anybody deciding to. So the
 * three are inputs and the rest are **read-outs**, which is the desktop's rule and a good one.
 *
 * ## Why the derived figures are shown at all
 *
 * Because a salesperson has to be able to answer "why is it that much". The building cost and the
 * margin are not needed to give a quote; they are needed to defend one. They are behind a
 * disclosure so the screen leads with the price rather than with the arithmetic.
 *
 * ## The balance is never typed
 *
 * It is the remainder, so the three stages always sum to the contract. The API enforces this too;
 * the read-only field here is the screen agreeing with the server rather than a separate rule.
 */

import { useState } from 'react';
import type { PriceView } from '@sq/contracts';
import { chargesSubtotalCents, chargeAmountCents } from '@sq/core/domain';
import { DEFAULT_ADDITION_LINES, additionsTotalCents } from '@sq/core/domain';
import type { AdditionLine } from '@sq/core/domain';
import { money, percent, Panel, StatusPill } from '@sq/ui';
import { useDraftStore } from '@/store/useDraftStore';
import { useShedStore } from '@/store/useShedStore';
import { MoneyField } from './MoneyField';
import { deriveStages } from './stages';

export interface CostPanelProps {
  price: PriceView | null;
  /** Set when the price is not current, so the figures on screen are known to be old. */
  stale: boolean;
  /** True while a calculation is in flight. */
  calculating: boolean;
  onRecalculate: () => void;
  /** True for a role that may see the internal cost breakdown. */
  canSeeMargin: boolean;
}

/** The derivation rows the desktop showed only to a SuperAdmin. */
const MARGIN_ONLY_ROWS = new Set([
  'Materials, from the building',
  'Total material cost',
  'Margin applied',
  'Kit price',
  'Quote rate',
  'Additions',
]);

export function CostPanel({ price, stale, calculating, onRecalculate, canSeeMargin }: CostPanelProps) {
  const pricing = useDraftStore((state) => state.pricing);
  const setPricing = useDraftStore((state) => state.setPricing);
  const charges = useShedStore((state) => state.config.charges);
  const addCharge = useShedStore((state) => state.addCharge);
  const patchCharge = useShedStore((state) => state.patchCharge);
  const removeCharge = useShedStore((state) => state.removeCharge);
  const [showDerivation, setShowDerivation] = useState(false);

  /*
   * Additions: the desktop's itemised block. Labour and equipment carry `+GST`; the fees
   * are entered as invoiced. The total is recomputed from the lines on every edit, and
   * the number input under them is the desktop's "Real Addition" override.
   */
  const additionLines = pricing.additionLines ?? DEFAULT_ADDITION_LINES;
  const computedAdditions = additionsTotalCents(additionLines);
  const updateAddition = (id: string, patch: Partial<AdditionLine>): void => {
    const next = additionLines.map((line) => (line.id === id ? { ...line, ...patch } : line));
    setPricing({ additionLines: next, additionsCents: additionsTotalCents(next) });
  };

  if (price === null) {
    return (
      <Panel title="Cost">
        <p className="text-sq-body text-sq-ink-muted">
          No price yet. Fill in the building on the first step, then calculate the price — the
          contract, deposit and progress payment become editable once there is a figure to work
          from.
        </p>
      </Panel>
    );
  }

  // The shared derivation, so the panel and this step cannot disagree.
  const stages = deriveStages(price, pricing);
  const { contractCents, depositCents, progressCents, balanceCents } = stages;


  return (
    <div className="flex flex-col gap-sq-3">
      {stale && (
        <div className="flex flex-wrap items-center gap-sq-2 rounded-md border border-sq-attention/30 bg-sq-attention/5 p-sq-2">
          <StatusPill tone="attention" label="Price out of date" />
          <p className="text-sq-body text-sq-ink">
            The building or the money changed after this price was calculated.
          </p>
          <button
            type="button"
            onClick={onRecalculate}
            className="ml-auto min-h-11 cursor-pointer rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white transition-colors duration-sq-fast hover:bg-sq-brand-hover"
          >
            {calculating ? 'Calculating…' : 'Calculate again'}
          </button>
        </div>
      )}

      <Panel
        title="What the customer pays"
        description="The contract is GST-inclusive. GST is shown separately because an Australian buyer expects to see it."
      >
        <div className="flex flex-col gap-sq-3">
          <MoneyField
            id="cost-contract"
            label="Contract price"
            required
            valueCents={contractCents}
            onChange={(cents) => setPricing({ contractOverrideCents: cents })}
            hint={
              pricing.contractOverrideCents === null
                ? 'Calculated from the building. Type a figure to negotiate it.'
                : 'Your figure. The deposit and progress payment below follow it.'
            }
            overridden={pricing.contractOverrideCents !== null}
            onReset={pricing.contractOverrideCents === null ? undefined : () => setPricing({ contractOverrideCents: null })}
            emphasis
          />

          <div className="grid gap-sq-3 sm:grid-cols-2">
            <MoneyField
              id="cost-deposit"
              label="Deposit required"
              valueCents={depositCents}
              onChange={(cents) => setPricing({ depositOverrideCents: cents })}
              hint={
                pricing.depositOverrideCents === null
                  ? `${percent(pricing.depositPct)} of the contract, on signing.`
                  : 'Your figure.'
              }
              overridden={pricing.depositOverrideCents !== null}
              onReset={pricing.depositOverrideCents === null ? undefined : () => setPricing({ depositOverrideCents: null })}
            />
            <MoneyField
              id="cost-progress"
              label="Progress payment"
              valueCents={progressCents}
              onChange={(cents) => setPricing({ progressOverrideCents: cents })}
              hint={
                pricing.progressOverrideCents === null
                  ? `${percent(pricing.progressPct)} of the contract, at frame stage.`
                  : 'Your figure.'
              }
              overridden={pricing.progressOverrideCents !== null}
              onReset={pricing.progressOverrideCents === null ? undefined : () => setPricing({ progressOverrideCents: null })}
            />
          </div>

          {/*
            Read-only, and labelled as derived. A balance that could be typed would be a fourth
            number that has to agree with the other three, and the moment they disagree the quote
            is wrong in a way nobody notices.
          */}
          <div className="flex items-baseline justify-between border-t border-sq-line pt-sq-2">
            <span className="text-sq-body font-medium text-sq-ink">
              Balance before delivery
              <span className="ml-sq-2 text-sq-micro font-normal text-sq-ink-muted">
                the remainder — always the contract less the two payments above
              </span>
            </span>
            <span className="sq-numeric text-sq-title font-semibold text-sq-ink">
              {money(balanceCents)}
            </span>
          </div>

          {depositCents + progressCents + balanceCents !== contractCents && (
            // A guard rather than a possibility: if this ever shows, the arithmetic and the screen
            // disagree and the quote should not go out.
            <p role="alert" className="text-sq-micro text-sq-danger">
              The payment stages do not add up to the contract. Do not send this quote — report it.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Payment terms">
        <div className="grid gap-sq-3 sm:grid-cols-2">
          <label className="flex flex-col gap-sq-1">
            <span className="text-sq-micro font-medium text-sq-ink">Deposit percentage</span>
            <input
              id="cost-depositPct"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.5}
              value={pricing.depositPct}
              onChange={(event) => setPricing({ depositPct: Number(event.target.value) })}
              className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
            />
            <span className="text-sq-micro text-sq-ink-muted">
              Used when no deposit figure is typed above.
            </span>
          </label>
          <label className="flex flex-col gap-sq-1">
            <span className="text-sq-micro font-medium text-sq-ink">Progress percentage</span>
            <input
              id="cost-progressPct"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.5}
              value={pricing.progressPct}
              onChange={(event) => setPricing({ progressPct: Number(event.target.value) })}
              className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
            />
            <span className="text-sq-micro text-sq-ink-muted">
              {Math.abs(pricing.depositPct + pricing.progressPct - 100) <= 0.5
                ? 'Together they cover the contract, so the balance is nil.'
                : `${percent(100 - pricing.depositPct - pricing.progressPct)} remains as the balance.`}
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="Charges">
        <div className="grid gap-sq-3 sm:grid-cols-2">
          <MoneyField
            id="cost-delivery"
            label="Delivery"
            valueCents={pricing.deliveryCents}
            onChange={(cents) => setPricing({ deliveryCents: cents })}
            hint="Delivery is typed, not looked up: what a truck costs depends on the load and the road."
          />
          <MoneyField
            id="cost-engineering"
            label="Engineering"
            valueCents={pricing.engineeringCents}
            onChange={(cents) => setPricing({ engineeringCents: cents })}
            hint="Engineering review and certification."
          />
          <MoneyField
            id="cost-extra"
            label="Extra charges"
            valueCents={pricing.extraCents}
            onChange={(cents) => setPricing({ extraCents: cents })}
            hint="Anything else the customer agreed to pay."
          />
          <div className="flex flex-col gap-sq-1 rounded-md border border-sq-line p-sq-2">
            <div className="flex items-baseline justify-between gap-sq-2">
              <span className="text-sq-micro font-medium text-sq-ink">
                Additions (after the quote rate)
              </span>
              <span className="sq-numeric text-sq-body text-sq-ink">{money(computedAdditions)}</span>
            </div>
            <ul className="flex flex-col gap-sq-1">
              {additionLines.map((line) => (
                <li key={line.id} className="flex items-center gap-sq-1">
                  <input
                    type="checkbox"
                    checked={line.enabled}
                    onChange={(event) => updateAddition(line.id, { enabled: event.target.checked })}
                    aria-label={`Include ${line.label}`}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-sq-brand)]"
                  />
                  <span className="min-w-0 flex-1 text-sq-micro text-sq-ink">
                    {line.label}
                    {line.taxable ? ' +GST' : ''}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    value={line.quantity}
                    onChange={(event) => updateAddition(line.id, { quantity: Number(event.target.value) })}
                    aria-label={`${line.label} quantity`}
                    className="min-h-8 w-16 rounded border border-sq-line bg-sq-surface px-1 text-right text-sq-micro"
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    value={line.unitPriceCents / 100}
                    onChange={(event) =>
                      updateAddition(line.id, {
                        unitPriceCents: Math.round(Number(event.target.value) * 100),
                      })
                    }
                    aria-label={`${line.label} unit price`}
                    className="min-h-8 w-20 rounded border border-sq-line bg-sq-surface px-1 text-right text-sq-micro"
                  />
                </li>
              ))}
            </ul>
            <label className="flex items-center justify-between gap-sq-2 pt-sq-1">
              <span className="text-sq-micro text-sq-ink-muted">
                Override total (typing here ignores the lines)
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                value={pricing.additionsCents / 100}
                onChange={(event) =>
                  setPricing({ additionsCents: Math.round(Number(event.target.value) * 100) })
                }
                aria-label="Additions override total"
                className="min-h-8 w-24 rounded border border-sq-line bg-sq-surface px-1 text-right text-sq-micro"
              />
            </label>
          </div>
        </div>
      </Panel>

      {/*
        Charges: the lines that are not a physical object — crane hire, a council permit, an
        engineering review. They join the contract **once**, as an addition, and never travel
        through the material margin: a charge is a selling amount the operator typed, already
        inclusive of the margin and tax it should carry. `sellingChargesCents` in core does that
        arithmetic, so this table only edits the lines and shows their total.
      */}
      <Panel
        title="Charges"
        description="Amounts that are not part of the building — added to the contract once, with no material margin on top."
        actions={
          <button
            type="button"
            onClick={addCharge}
            className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-3 text-sq-body font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            Add a charge
          </button>
        }
        padded={false}
      >
        {charges.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            No charges. Delivery, engineering and extras have their own fields above; this table is
            for anything else the customer agreed to pay.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sq-body">
                <thead>
                  <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">What</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">Qty</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">Unit</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">Each</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Amount</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((charge) => (
                    <tr key={charge.id} className="border-b border-sq-line last:border-0">
                      <td className="px-sq-3 py-sq-2">
                        <input
                          value={charge.label}
                          onChange={(event) => patchCharge(charge.id, { label: event.target.value })}
                          aria-label={`What the charge is`}
                          className="min-h-11 w-full min-w-40 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
                        />
                      </td>
                      <td className="px-sq-3 py-sq-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.5}
                          value={charge.quantity}
                          onChange={(event) => patchCharge(charge.id, { quantity: Number(event.target.value) })}
                          aria-label="Quantity"
                          className="min-h-11 w-20 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body sq-numeric"
                        />
                      </td>
                      <td className="px-sq-3 py-sq-2">
                        <input
                          value={charge.unit}
                          onChange={(event) => patchCharge(charge.id, { unit: event.target.value })}
                          aria-label="Unit"
                          className="min-h-11 w-16 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
                        />
                      </td>
                      <td className="px-sq-3 py-sq-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={(charge.unitPriceCents / 100).toFixed(2)}
                          onChange={(event) =>
                            patchCharge(charge.id, {
                              unitPriceCents: Math.max(0, Math.round(Number(event.target.value) * 100)),
                            })
                          }
                          aria-label="Price each"
                          className="min-h-11 w-28 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body sq-numeric"
                        />
                      </td>
                      <td className="sq-numeric px-sq-3 py-sq-2 text-right">
                        {money(chargeAmountCents(charge))}
                      </td>
                      <td className="px-sq-3 py-sq-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeCharge(charge.id)}
                          aria-label={`Remove the charge ${charge.label}`}
                          className="min-h-11 cursor-pointer rounded-md px-sq-2 text-sq-body font-medium text-sq-danger hover:bg-sq-danger/10"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="flex items-baseline justify-between border-t border-sq-line px-sq-3 py-sq-2">
              <span className="text-sq-body font-medium text-sq-ink">
                Charges added to the contract
              </span>
              <span className="sq-numeric text-sq-body font-semibold text-sq-ink">
                {money(chargesSubtotalCents(charges))}
              </span>
            </p>
          </>
        )}
      </Panel>

      {/*
        The derivation, behind a disclosure. A salesperson needs it to answer "why that much" and
        does not need it while quoting, so it is one click away rather than on screen.

        `aria-expanded` + a real button, not a hover reveal: a control whose only affordance is
        hover is unreachable by keyboard and invisible on a touch screen.
      */}
      <Panel>
        <button
          type="button"
          aria-expanded={showDerivation}
          aria-controls="cost-derivation"
          onClick={() => setShowDerivation((value) => !value)}
          className="flex min-h-11 w-full cursor-pointer items-center gap-sq-2 text-left"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
            className={`shrink-0 text-sq-ink-muted transition-transform duration-sq-fast ${showDerivation ? 'rotate-90' : ''}`}
          >
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sq-body font-semibold text-sq-ink">How this price was worked out</span>
        </button>

        {showDerivation && (
          <dl id="cost-derivation" className="mt-sq-2 flex flex-col gap-1 text-sq-body">
            {[
              ['Materials, from the building', price.buildingCostCents, 'Every purlin, sheet, fixing and door, counted from the geometry.'],
              ['Total material cost', price.totalCostCents, 'Materials plus the miscellaneous items, such as the wind rating fee.'],
              ['Margin applied', null, `${(price.margin ?? 0).toFixed(2)}× — this company’s own, or the price book’s.`],
              ['Kit price', price.kitCents, 'Materials at the margin, plus GST.'],
              ['Delivery', price.deliveryCents, null],
              ['Engineering', price.engineeringCents, null],
              ['Extra charges', price.extraCents, null],
              ['Quote rate', null, price.quoteRatePct === 0 ? 'None applied.' : `${percent(price.quoteRatePct)} uplift.`],
              ['Additions', price.additionsCents, null],
              ['GST included', price.gstCents, 'Extracted from the contract, not added to it.'],
            ].map(([label, value, note]) => {
              if (!canSeeMargin && MARGIN_ONLY_ROWS.has(String(label))) return null;
              return (
              <div key={String(label)} className="flex items-baseline justify-between gap-sq-2 border-b border-sq-line/60 pb-1 last:border-0">
                <dt className="text-sq-ink">
                  {String(label)}
                  {note !== null && typeof note === 'string' && (
                    <span className="ml-sq-2 text-sq-micro text-sq-ink-muted">{note}</span>
                  )}
                </dt>
                <dd className="sq-numeric shrink-0 text-sq-ink">
                  {typeof value === 'number' ? money(value) : '—'}
                </dd>
              </div>
              );
            })}
            <div className="flex items-baseline justify-between gap-sq-2 pt-sq-2">
              <dt className="font-semibold text-sq-ink">Contract price, GST inclusive</dt>
              <dd className="sq-numeric font-semibold text-sq-ink">{money(price.contractCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-sq-2">
              <dt className="text-sq-ink-muted">Total mass</dt>
              <dd className="sq-numeric text-sq-ink-muted">{price.totalMassKg.toFixed(1)} kg</dd>
            </div>
          </dl>
        )}
      </Panel>
    </div>
  );
}
