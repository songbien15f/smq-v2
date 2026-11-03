'use client';

/**
 * Loading a supplier's price list.
 *
 * ## Why this is its own page and not a panel inside Settings
 *
 * Settings is a form you fill in and save. This is a **two-step operation over a file**: choose it,
 * read what it would do, then confirm. Mixing the two would put a destructive, file-shaped action
 * among text fields whose Save button means something else — and an operator who pressed the wrong
 * Save would have replaced their prices.
 *
 * ## Why the preview is not optional
 *
 * An import writes prices every future quote is built from, and the file comes from outside the
 * product. Applying it blind is how a company discovers a month later that a column was mis-mapped.
 * So the upload writes nothing; it answers with every row and what would happen to it, and the
 * operator confirms with the fingerprint that preview produced. If anything moved in between, the
 * server refuses the apply rather than writing figures nobody reviewed.
 *
 * ## Why the four outcomes are named
 *
 * "Matched", "ambiguous", "unmatched" and "invalid" are four different pieces of news. An ambiguous
 * row means two book rows could be meant and the importer refused to guess; an unmatched row is a
 * material the shared book does not have; an invalid row names the reason. Collapsing them into
 * "some rows failed" would hide the one the operator can actually fix.
 */

import { useState } from 'react';
import { Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/sq';

/** One row of the preview, as the API reports it. */
interface PreviewRow {
  sheetRow: number;
  source: string;
  code: string;
  description: string;
  priceCents: number | null;
  outcome:
    | { kind: 'matched'; rowKey: string; how: string }
    | { kind: 'ambiguous'; candidates: string[] }
    | { kind: 'unmatched' }
    | { kind: 'created'; source: string; code: string; mine: boolean }
    | { kind: 'removed'; source: string; name: string }
    | { kind: 'invalid'; reason: string }
    | { kind: 'blank' };
}

interface Preview {
  fingerprint: string;
  counts: {
    total: number;
    applied: number;
    blank: number;
    ambiguous: number;
    invalid: number;
    created: number;
    updated: number;
    removed: number;
  };
  rows: PreviewRow[];
}

/** How one outcome reads, and how it should be coloured. */
function outcomeOf(row: PreviewRow): { label: string; tone: 'ok' | 'danger' | 'attention' | 'info' | 'neutral'; note: string } {
  switch (row.outcome.kind) {
    case 'matched':
      return { label: 'Will apply', tone: 'ok', note: `Matched by ${row.outcome.how.replace('+', ' + ')}.` };
    case 'created':
      return {
        label: row.outcome.mine ? 'Re-price your item' : 'Add your item',
        tone: 'info',
        note: row.outcome.mine
          ? 'An item you already had; its price will change.'
          : 'Not in the shared book — kept as an item this company buys.',
      };
    case 'removed':
      return { label: 'Remove', tone: 'attention', note: 'Your item, with its price left blank.' };
    case 'ambiguous':
      return {
        label: 'Ambiguous',
        tone: 'attention',
        note: `${row.outcome.candidates.length} book rows could be meant. Nothing was guessed — add a Code to the row.`,
      };
    case 'unmatched':
      return { label: 'Not in the book', tone: 'attention', note: 'No book row matches this code or description.' };
    case 'invalid':
      return { label: 'Invalid', tone: 'danger', note: row.outcome.reason };
    case 'blank':
      return { label: 'No price', tone: 'neutral', note: 'Nothing typed, nothing to do.' };
  }
}

/** Read a file into base64, which is what the JSON API accepts. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function PriceImportPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileData, setFileData] = useState<string | null>(null);
  const [busy, setBusy] = useState<'reading' | 'applying' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const choose = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setMessage(null);
    setPreview(null);
    setBusy('reading');
    setFileName(file.name);

    try {
      const data = await readAsBase64(file);
      setFileData(data);

      const result = await api<Preview>('admin/prices/preview', { method: 'POST', body: { data } });
      if (result.ok) setPreview(result.data);
      else setMessage({ tone: 'danger', text: result.message });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'The file could not be read.' });
    } finally {
      setBusy(null);
    }
  };

  const apply = async (): Promise<void> => {
    if (preview === null || fileData === null) return;
    setBusy('applying');
    setMessage(null);

    const result = await api<{ version: number; counts: Preview['counts'] }>('admin/prices/apply', {
      method: 'POST',
      body: { data: fileData, fingerprint: preview.fingerprint },
    });

    setBusy(null);
    if (result.ok) {
      setMessage({
        tone: 'ok',
        text: `Applied. ${result.data.counts.applied} price(s) set, ${result.data.counts.created} item(s) added, ${result.data.counts.removed} removed. Price set version ${result.data.version}.`,
      });
      setPreview(null);
      setFileData(null);
      setFileName(null);
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  const nothingToApply =
    preview !== null &&
    preview.counts.applied === 0 &&
    preview.counts.created === 0 &&
    preview.counts.updated === 0 &&
    preview.counts.removed === 0;

  return (
    <div className="flex flex-col gap-sq-4">
      <Panel
        title="Load a price list"
        description="A spreadsheet of your supplier's prices. Nothing is written until you confirm the preview."
      >
        <div className="flex flex-col gap-sq-3">
          <div className="flex flex-wrap items-center gap-sq-2">
            <a
              href={`${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3060/api/v1'}/admin/prices/template`}
              className="inline-flex min-h-11 items-center rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-ink no-underline transition-colors duration-sq-fast hover:bg-sq-ground"
            >
              Download the template
            </a>
            <span className="text-sq-micro text-sq-ink-muted">
              Starts from the prices the engine already knows, so a blank cell means “no change”.
            </span>
          </div>

          <label className="flex flex-col gap-sq-1">
            <span className="text-sq-micro font-medium text-sq-ink">Spreadsheet (.xlsx)</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => void choose(event.target.files?.[0])}
              className="min-h-11 cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body"
            />
            <span className="text-sq-micro text-sq-ink-muted">
              Columns are matched by name, not position. “Your price” or “Price” both work.
            </span>
          </label>

          {busy === 'reading' && (
            <p className="text-sq-body text-sq-ink-muted" role="status">
              Reading {fileName ?? 'the file'}…
            </p>
          )}

          {message !== null && (
            <p
              role={message.tone === 'danger' ? 'alert' : 'status'}
              className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
            >
              {message.text}
            </p>
          )}
        </div>
      </Panel>

      {preview !== null && (
        <Panel
          title="What this file would do"
          description={`${preview.counts.total} row(s) read from ${fileName ?? 'the sheet'}. Nothing has been written yet.`}
          padded={false}
        >
          {/* The counts, as four separate pieces of news. */}
          <dl className="grid grid-cols-2 gap-sq-2 border-b border-sq-line px-sq-3 py-sq-3 sm:grid-cols-4">
            {[
              ['Prices to set', preview.counts.applied + preview.counts.updated],
              ['Items to add', preview.counts.created],
              ['Ambiguous', preview.counts.ambiguous],
              ['Invalid', preview.counts.invalid],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-sq-micro text-sq-ink-muted">{String(label)}</dt>
                <dd className="sq-numeric text-sq-title font-semibold text-sq-ink">{String(value)}</dd>
              </div>
            ))}
          </dl>

          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead className="sticky top-0 bg-sq-surface">
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Row</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Code</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Description</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Price</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const outcome = outcomeOf(row);
                  return (
                    <tr key={row.sheetRow} className="border-b border-sq-line last:border-0">
                      <td className="sq-numeric px-sq-3 py-sq-2 text-sq-ink-muted">{row.sheetRow}</td>
                      <td className="sq-numeric px-sq-3 py-sq-2">{row.code || '—'}</td>
                      <td className="px-sq-3 py-sq-2">{row.description || '—'}</td>
                      <td className="sq-numeric px-sq-3 py-sq-2 text-right">
                        {row.priceCents === null ? '—' : `$${(row.priceCents / 100).toFixed(2)}`}
                      </td>
                      <td className="px-sq-3 py-sq-2">
                        <StatusPill tone={outcome.tone} label={outcome.label} />
                        <span className="mt-1 block text-sq-micro text-sq-ink-muted">{outcome.note}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-sq-2 border-t border-sq-line px-sq-3 py-sq-3">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={busy === 'applying' || nothingToApply}
              className="min-h-11 cursor-pointer rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white transition-colors duration-sq-fast hover:bg-sq-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
            >
              {busy === 'applying' ? 'Applying…' : 'Apply these prices'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setFileData(null);
                setFileName(null);
              }}
              className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-3 text-sq-body font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
            >
              Cancel
            </button>
            {nothingToApply && (
              <span className="text-sq-micro text-sq-ink-muted">
                There is nothing to change in this file.
              </span>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
