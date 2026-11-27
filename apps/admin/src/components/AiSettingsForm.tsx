'use client';

/**
 * The AI assistant's provider settings: which model answers, and which one catches a failure.
 *
 * ## No key on this screen
 *
 * `GEMINI_API_KEY` and `VILAO_API_KEY` live in `.env` and nowhere else — the API reads them, and this
 * form only ever learns `geminiKeySet` / `vilaoKeySet`. The badges say whether a provider *can* answer;
 * they never show what the key is, and nothing here can change it. Rotating a key is editing `.env` and
 * restarting the API (`docs/OPERATIONS.md`).
 *
 * ## Why the fallback select has "None"
 *
 * A single provider is a legitimate choice — it is what a shop with one account runs. "None" means a
 * failure is a failure; the page's existing "assistant is unavailable" strip already covers it.
 *
 * ## Why Save is the only write
 *
 * There is one row for the whole platform, and changing it changes what every visitor receives. The
 * server refuses a fallback equal to the primary and writes an audit row with the save; this form adds
 * nothing to that, so the two cannot disagree.
 */

import { useState } from 'react';
import type { AiSettingsView } from '@sq/contracts';
import { Button, Field, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

const PROVIDER_LABEL: Record<string, string> = { gemini: 'Google Gemini', vilao: 'vilao gateway' };

type Editable = Pick<
  AiSettingsView,
  | 'primary'
  | 'fallback'
  | 'geminiModel'
  | 'geminiSttModel'
  | 'geminiThinking'
  | 'vilaoModel'
  | 'vilaoSttModel'
>;

function editableOf(view: AiSettingsView): Editable {
  return {
    primary: view.primary,
    fallback: view.fallback,
    geminiModel: view.geminiModel,
    geminiSttModel: view.geminiSttModel,
    geminiThinking: view.geminiThinking,
    vilaoModel: view.vilaoModel,
    vilaoSttModel: view.vilaoSttModel,
  };
}

export function AiSettingsForm({ initial }: { initial: AiSettingsView }) {
  const [view, setView] = useState<AiSettingsView>(initial);
  const [draft, setDraft] = useState<Editable>(editableOf(initial));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const select = (label: string, value: string, options: { value: string; label: string }[], onChange: (v: string) => void, hint?: string) => (
    <div className="flex flex-col gap-sq-1">
      <label className="text-sq-micro font-medium text-sq-ink" htmlFor={`ai-${label.replace(/\s+/g, '-').toLowerCase()}`}>
        {label}
      </label>
      <select
        id={`ai-${label.replace(/\s+/g, '-').toLowerCase()}`}
        className="rounded-md border border-sq-line bg-sq-surface px-3 py-2 text-sq-body text-sq-ink"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint === undefined ? null : <p className="text-sq-micro text-sq-ink-muted">{hint}</p>}
    </div>
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await api<AiSettingsView>('admin/ai-settings', { method: 'PUT', body: draft });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setView(result.data);
    setDraft(editableOf(result.data));
    setSaved(true);
  };

  const keyBadge = (label: string, present: boolean) => (
    <div className="flex items-center justify-between gap-sq-2 rounded-md border border-sq-line px-3 py-2">
      <span className="text-sq-body text-sq-ink">{label}</span>
      <StatusPill tone={present ? 'ok' : 'attention'} label={present ? 'Key set' : 'No key'} />
    </div>
  );

  return (
    <div className="flex flex-col gap-sq-4">
      <Panel title="Providers">
        <div className="grid gap-sq-4 md:grid-cols-2">
          {select(
            'Primary provider',
            draft.primary,
            [
              { value: 'gemini', label: PROVIDER_LABEL['gemini'] ?? 'gemini' },
              { value: 'vilao', label: PROVIDER_LABEL['vilao'] ?? 'vilao' },
            ],
            (value) => set('primary', value as Editable['primary']),
            'Answers every turn, transcript repair and transcription.',
          )}
          {select(
            'Fallback provider',
            draft.fallback,
            [
              { value: 'vilao', label: PROVIDER_LABEL['vilao'] ?? 'vilao' },
              { value: 'gemini', label: PROVIDER_LABEL['gemini'] ?? 'gemini' },
              { value: 'none', label: 'None — do not fall back' },
            ],
            (value) => set('fallback', value as Editable['fallback']),
            'Used when the primary times out, is rate-limited, refuses the key or answers badly. Never when the content was blocked.',
          )}
        </div>

        <div className="mt-sq-4 grid gap-sq-2 md:grid-cols-2">
          {keyBadge('Google Gemini key', view.geminiKeySet)}
          {keyBadge('vilao key', view.vilaoKeySet)}
        </div>
        <p className="mt-sq-2 text-sq-micro text-sq-ink-muted">
          Keys live in <code>.env</code> only — never in this database and never on this screen. To rotate one, edit{' '}
          <code>.env</code> and restart the API.
        </p>
      </Panel>

      <Panel title="Models">
        <div className="grid gap-sq-4 md:grid-cols-2">
          <Field
            label="Gemini model"
            value={draft.geminiModel}
            onChange={(event) => set('geminiModel', event.target.value)}
            hint="Default gemini-3.5-flash-lite."
          />
          <Field
            label="Gemini transcription model"
            value={draft.geminiSttModel}
            onChange={(event) => set('geminiSttModel', event.target.value)}
            hint="Usually the same model, which accepts audio."
          />
          {select(
            'Gemini thinking level',
            draft.geminiThinking,
            [
              { value: 'minimal', label: 'minimal (default)' },
              { value: 'low', label: 'low' },
              { value: 'medium', label: 'medium' },
              { value: 'high', label: 'high' },
            ],
            (value) => set('geminiThinking', value as Editable['geminiThinking']),
            'Thinking tokens are billed as output; minimal is the model default.',
          )}
          <div className="hidden md:block" />
          <Field
            label="vilao model"
            value={draft.vilaoModel}
            onChange={(event) => set('vilaoModel', event.target.value)}
          />
          <Field
            label="vilao transcription model"
            value={draft.vilaoSttModel}
            onChange={(event) => set('vilaoSttModel', event.target.value)}
          />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-sq-3">
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Save
        </Button>
        {saved ? (
          <p role="status" className="text-sq-body text-sq-ink-muted">
            Saved. The next turn uses these settings.
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sq-body text-sq-danger">
            {error}
          </p>
        )}
      </div>

      <p className="text-sq-micro text-sq-ink-muted">
        {view.source === 'db'
          ? `Saved${view.updatedAt === null ? '' : ` ${view.updatedAt}`}${view.updatedBy === null ? '' : ` by ${view.updatedBy}`}.`
          : 'Running the defaults from .env — nothing has been saved on this screen yet.'}
      </p>
    </div>
  );
}
