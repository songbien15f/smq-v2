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
import { api } from '@/lib/sq';

interface Assumption {
  title: string;
  body: string;
}

interface SettingsForm {
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
}

const EMPTY: SettingsForm = {
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

  const save = async (): Promise<void> => {
    setState({ kind: 'saving' });
    const result = await api<{ version: number }>('settings', {
      method: 'PATCH',
      body: form,
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