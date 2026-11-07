'use client';

/**
 * Company settings: the document header, the company's own numbers, and the payment details.
 *
 * Every field here ends up on a customer-facing PDF, so the form is careful about what it shows and
 * what it saves. A save writes a new versioned row rather than overwriting — "this quote used a 15%
 * margin" must remain true even after the margin moves, and the only way to keep that true is to
 * never overwrite.
 *
 * The form is one panel per concern rather than one long scroll: an operator changing the deposit
 * percentage should not have to wade through the terms editor, and the terms editor should not sit
 * beside a number field where a stray keystroke could change a margin.
 */

import { useEffect, useState } from 'react';
import { Button, Field, Panel } from '@sq/ui';
import { DEFAULT_PROFILE_ID, FACTORY_PROFILES } from '@sq/core/bom';
import { NO_MINIMUMS, type FreightMinimums } from '@sq/core/domain';
import { api } from '@/lib/sq';

interface Assumption {
  title: string;
  body: string;
}

interface SettingsForm {
  /**
   * The version the server last wrote.
   *
   * Carried because the GET answers it and the screen shows "Saved as version N" — but it is the
   * **server's** to assign, so it is stripped from the patch. It used to travel back inside the body,
   * and the API's schema is `.strict()`: every save answered 422 "Unrecognized key: version" with the
   * error pinned to `(root)` — which is no field at all, so the screen reported a failure and
   * highlighted nothing. Settings could not be saved at all.
   */
  version: number;
  name: string;
  abn: string | null;
  margin: number | null;
  depositPct: number;
  progressPct: number;
  bomProfileId: string | null;
  assumptions: Assumption[];
  paymentDetails: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoText: string | null;
  terms: string[];
  /**
   * The company's own rates, in cents. `null` until written.
   *
   * Additions uses the labour rates to turn hours into money; the default costs fill the fee
   * lines. Entered in dollars on this screen, stored in cents like every other money figure.
   */
  rates: {
    labour: { concreter: number; electrician: number; labourer1: number; labourer2: number };
    defaultCosts: { council: number; engineering: number; rubbish: number; delivery: number; concrete: number };
  } | null;
  /**
   * The freight minimums agreed with the distributor and the nominated carrier.
   *
   * Cents and percent; the larger of the two applies to a quote whose delivery scope is one of those
   * two. Zero means nothing was agreed, which is the desktop's own default.
   */
  minimumFees: FreightMinimums;
}

/** The rates, with zeros where nothing has been stored yet. */
function ratesOrZero(form: SettingsForm): NonNullable<SettingsForm['rates']> {
  return (
    form.rates ?? {
      labour: { concreter: 0, electrician: 0, labourer1: 0, labourer2: 0 },
      defaultCosts: { council: 0, engineering: 0, rubbish: 0, delivery: 0, concrete: 0 },
    }
  );
}

const EMPTY: SettingsForm = {
  version: 0,
  name: '',
  abn: null,
  margin: null,
  depositPct: 0,
  progressPct: 0,
  bomProfileId: null,
  assumptions: [],
  paymentDetails: null,
  address: null,
  phone: null,
  email: null,
  logoText: null,
  terms: [],
  rates: null,
  minimumFees: NO_MINIMUMS,
};

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; version: number } | { kind: 'failed'; message: string };

export function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>(EMPTY);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await api<SettingsForm>('settings');
      if (cancelled) return;
      if (result.ok) {
        setForm(result.data);
        setLoading(false);
      } else {
        setState({ kind: 'failed', message: result.message });
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Set one rate: entered in dollars, stored in cents. */
  const setRate = (group: 'labour' | 'defaultCosts', key: string, dollars: number): void => {
    const base = ratesOrZero(form);
    const next = { ...base, [group]: { ...base[group], [key]: Math.round(dollars * 100) } };
    setForm({ ...form, rates: next as SettingsForm['rates'] });
  };

  /** Set one freight minimum. Dollars arrive from the input; cents are stored. */
  const setMinimumFees = (next: FreightMinimums): void => {
    setForm({ ...form, minimumFees: next });
  };

  const save = async (): Promise<void> => {
    setState({ kind: 'saving' });
    /*
     * `version` stays behind: the server assigns it, and the API's schema refuses a body that carries
     * a key it does not own. Sending the whole form back is what made every save a 422.
     */
    const { version: _version, ...patch } = form;
    const result = await api<{ version: number }>('settings', {
      method: 'PATCH',
      body: patch,
    });
    if (result.ok) {
      setState({ kind: 'saved', version: result.data.version });
    } else {
      setState({ kind: 'failed', message: result.message });
    }
  };

  if (loading) {
    return <p className="text-sq-body text-sq-ink-muted">Loading settings…</p>;
  }

  return (
    <div className="flex flex-col gap-sq-4">
      <Panel title="Company identity" description="What appears on every document header.">
        <div className="grid gap-sq-3 sm:grid-cols-2">
          <Field
            id="settings-name"
            label="Company name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Field
            id="settings-abn"
            label="ABN / registration number"
            value={form.abn ?? ''}
            onChange={(e) => setForm({ ...form, abn: e.target.value || null })}
          />
          <Field
            id="settings-address"
            label="Address"
            value={form.address ?? ''}
            onChange={(e) => setForm({ ...form, address: e.target.value || null })}
          />
          <Field
            id="settings-phone"
            label="Phone"
            value={form.phone ?? ''}
            onChange={(e) => setForm({ ...form, phone: e.target.value || null })}
          />
          <Field
            id="settings-email"
            label="Reply-to email"
            type="email"
            value={form.email ?? ''}
            onChange={(e) => setForm({ ...form, email: e.target.value || null })}
          />
          <Field
            id="settings-logo"
            label="Logo text (fallback when no image)"
            value={form.logoText ?? ''}
            onChange={(e) => setForm({ ...form, logoText: e.target.value || null })}
          />
        </div>
      </Panel>

      <Panel
        title="Pricing defaults"
        description="Applied to new quotes; saved revisions keep their original values."
        actions={
          <a
            href="/settings/prices"
            className="inline-flex min-h-11 items-center rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-ink no-underline transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            Load your price list
          </a>
        }
      >
        <div className="grid gap-sq-3 sm:grid-cols-3">
          <Field
            id="settings-margin"
            label="Margin (%)"
            type="number"
            inputMode="decimal"
            min={1}
            max={10}
            step={0.1}
            value={form.margin === null ? '' : String(form.margin)}
            onChange={(e) =>
              setForm({ ...form, margin: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
          <Field
            id="settings-deposit"
            label="Deposit (%)"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={String(form.depositPct)}
            onChange={(e) => setForm({ ...form, depositPct: Number(e.target.value) })}
          />
          <Field
            id="settings-progress"
            label="Progress payment (%)"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={String(form.progressPct)}
            onChange={(e) => setForm({ ...form, progressPct: Number(e.target.value) })}
          />
        </div>

        {/*
          The factory method. This control was missing while the field was stored and unread, so a
          company could not choose one and every quote used the build's defaults. The summary under
          the select says **what changes**, because "factory profile" means nothing to a person who
          has not read the BOM.
        */}
        <div className="mt-sq-3 flex flex-col gap-sq-1">
          <label htmlFor="settings-bom-profile" className="text-sq-micro font-medium text-sq-ink">
            Factory method
          </label>
          <select
            id="settings-bom-profile"
            value={form.bomProfileId ?? DEFAULT_PROFILE_ID}
            onChange={(e) => setForm({ ...form, bomProfileId: e.target.value })}
            className="min-h-[38px] max-w-md rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body text-sq-ink"
          >
            {FACTORY_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <p className="text-sq-micro text-sq-ink-muted">
            {FACTORY_PROFILES.find((profile) => profile.id === (form.bomProfileId ?? DEFAULT_PROFILE_ID))
              ?.summary ?? ''}
          </p>
          <p className="text-sq-micro text-sq-ink-muted">
            Changes the quantities every new quote is built from. Saved revisions keep the method they
            were priced under.
          </p>
        </div>
      </Panel>

      <Panel
        title="Rates"
        description="Used by Additions to turn hours and fees into money. Entered per hour, in dollars."
      >
        <div className="grid gap-sq-3 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-sq-2">
            <legend className="text-sq-micro font-medium text-sq-ink">Labour</legend>
            {(
              [
                ['concreter', 'Concreter'],
                ['electrician', 'Electrician'],
                ['labourer1', 'Labourer 1'],
                ['labourer2', 'Labourer 2'],
              ] as const
            ).map(([key, label]) => {
              const rates = ratesOrZero(form);
              return (
                <label key={key} className="flex items-center justify-between gap-sq-2 text-sq-body">
                  <span>{label}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={rates.labour[key] / 100}
                    onChange={(e) => setRate('labour', key, Number(e.target.value))}
                    aria-label={`${label} rate per hour`}
                    className="min-h-9 w-28 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-right text-sq-body"
                  />
                </label>
              );
            })}
          </fieldset>
          <fieldset className="flex flex-col gap-sq-2">
            <legend className="text-sq-micro font-medium text-sq-ink">Default job costs</legend>
            {(
              [
                ['council', 'Council fee'],
                ['engineering', 'Engineering'],
                ['rubbish', 'Rubbish removal'],
                ['delivery', 'Delivery fee'],
                ['concrete', 'Concrete footings'],
              ] as const
            ).map(([key, label]) => {
              const rates = ratesOrZero(form);
              return (
                <label key={key} className="flex items-center justify-between gap-sq-2 text-sq-body">
                  <span>{label}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={rates.defaultCosts[key] / 100}
                    onChange={(e) => setRate('defaultCosts', key, Number(e.target.value))}
                    aria-label={`${label} default cost`}
                    className="min-h-9 w-28 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-right text-sq-body"
                  />
                </label>
              );
            })}
          </fieldset>
        </div>
      </Panel>

      <Panel
        title="Freight minimums"
        description="The floor your distributor and nominated carrier charge. Used when a quote's delivery scope is one of those two."
      >
        <div className="grid gap-sq-3 sm:grid-cols-2">
          {(
            [
              ['distributor', 'Distributor'],
              ['carrier', 'Nominated carrier'],
            ] as const
          ).map(([who, label]) => {
            const dollarKey = who === 'distributor' ? 'distributorDollarCents' : 'carrierDollarCents';
            const percentKey = who === 'distributor' ? 'distributorPercent' : 'carrierPercent';
            return (
              <fieldset key={who} className="flex flex-col gap-sq-2">
                <legend className="text-sq-micro font-medium text-sq-ink">{label}</legend>
                <label className="flex items-center justify-between gap-sq-2 text-sq-body">
                  <span>Minimum</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={form.minimumFees[dollarKey] / 100}
                    onChange={(e) =>
                      setMinimumFees({
                        ...form.minimumFees,
                        [dollarKey]: Math.round(Math.max(0, Number(e.target.value)) * 100),
                      })
                    }
                    aria-label={`${label} minimum in dollars`}
                    className="min-h-9 w-28 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-right text-sq-body"
                  />
                </label>
                <label className="flex items-center justify-between gap-sq-2 text-sq-body">
                  <span>or % of the job</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={form.minimumFees[percentKey]}
                    onChange={(e) =>
                      setMinimumFees({
                        ...form.minimumFees,
                        [percentKey]: Math.min(100, Math.max(0, Number(e.target.value))),
                      })
                    }
                    aria-label={`${label} minimum as a percentage`}
                    className="min-h-9 w-28 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-right text-sq-body"
                  />
                </label>
              </fieldset>
            );
          })}
        </div>
        <p className="mt-sq-2 text-sq-micro text-sq-ink-muted">
          The larger of the two is what a quote is held to, rounded to the nearest $50. Zero means nothing
          was agreed — the freight stays whatever the operator types.
        </p>
      </Panel>

      <Panel title="Payment details" description="Printed on the quote's payment schedule.">
        <label className="flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink">Bank / payment instructions</span>
          <textarea
            rows={4}
            value={form.paymentDetails ?? ''}
            onChange={(e) => setForm({ ...form, paymentDetails: e.target.value || null })}
            className="min-h-24 rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink"
          />
        </label>
      </Panel>

      <Panel title="Terms" description="Each entry becomes one numbered term on the document.">
        <div className="flex flex-col gap-sq-2">
          {form.terms.map((term, index) => (
            <div key={index} className="flex items-start gap-sq-2">
              <span className="mt-sq-1 w-6 shrink-0 text-right text-sq-micro text-sq-ink-muted">{index + 1}.</span>
              <textarea
                rows={2}
                value={term}
                onChange={(e) => {
                  const next = [...form.terms];
                  next[index] = e.target.value;
                  setForm({ ...form, terms: next });
                }}
                className="min-h-16 flex-1 rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink"
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, terms: form.terms.filter((_, i) => i !== index) })}
                className="mt-sq-1 cursor-pointer rounded-md border border-sq-line px-sq-2 py-sq-1 text-sq-micro text-sq-danger hover:bg-sq-danger/10"
              >
                Remove
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            onClick={() => setForm({ ...form, terms: [...form.terms, ''] })}
            disabled={form.terms.length >= 40}
          >
            Add a term
          </Button>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-sq-3">
        <Button variant="primary" loading={state.kind === 'saving'} onClick={() => void save()}>
          Save settings
        </Button>
        {state.kind === 'saved' && (
          <span role="status" className="text-sq-body text-sq-ok">
            Saved as version {state.version}. New quotes will use these values.
          </span>
        )}
        {state.kind === 'failed' && (
          <span role="alert" className="text-sq-body text-sq-danger">
            {state.message}
          </span>
        )}
      </div>
    </div>
  );
}