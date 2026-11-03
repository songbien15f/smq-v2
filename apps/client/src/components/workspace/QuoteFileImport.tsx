'use client';

/**
 * Reading a legacy `.sqd` quote file.
 *
 * ## Why this only reports and does not import
 *
 * A `.sqd` carries a whole building the **desktop** computed, priced from a book this build may not
 * have. Turning it into a quote here would record figures the engine never produced — a revision
 * whose `engine_version` and `price_book_hash` describe a calculation that did not happen. So the
 * screen shows what the file contains and leaves the decision to a person: re-key the building, or
 * keep the file.
 *
 * ## Why the refusal is shown in full
 *
 * Some `.sqd` files are `.NET BinaryFormatter` output, which this build cannot read. A half-parse
 * would produce a plausible wrong price, so the reader refuses and explains. The explanation is the
 * useful part — it tells the operator the file predates the readable format, rather than that
 * something unspecified went wrong.
 */

import { useState } from 'react';
import { Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/sq';

interface ImportedRevision {
  revision: number | null;
  name: string;
  description: string;
  quoteNumber: string;
  companyName: string;
  contractPrice: number | null;
  deposit: number | null;
  progress: number | null;
  balance: number | null;
  lastEdited: string | null;
}

function dollars(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function QuoteFileImport() {
  const [revisions, setRevisions] = useState<ImportedRevision[] | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const choose = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setMessage(null);
    setRevisions(null);
    setFormat(null);
    setFileName(file.name);
    setBusy(true);

    try {
      const data = await readAsBase64(file);
      const result = await api<{ format: string; revisions: ImportedRevision[] }>('quotes/import/sqd', {
        method: 'POST',
        body: { data },
      });

      if (result.ok) {
        setRevisions(result.data.revisions);
        setFormat(result.data.format);
      } else {
        setMessage({ tone: 'danger', text: result.message });
      }
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'The file could not be read.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-sq-4">
      <Panel
        title="Read a .sqd quote file"
        description="The file the desktop app writes. This shows what it contains — it does not create a quote."
      >
        <div className="flex flex-col gap-sq-3">
          <label className="flex flex-col gap-sq-1">
            <span className="text-sq-micro font-medium text-sq-ink">Quote file (.sqd)</span>
            <input
              type="file"
              accept=".sqd"
              onChange={(event) => void choose(event.target.files?.[0])}
              className="min-h-11 cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body"
            />
          </label>

          {busy && (
            <p className="text-sq-body text-sq-ink-muted" role="status">
              Reading {fileName ?? 'the file'}…
            </p>
          )}

          {message !== null && (
            <div role="alert" className="rounded-md border border-sq-danger/30 bg-sq-danger/5 p-sq-3">
              <StatusPill tone="danger" label="Not readable" />
              <p className="mt-sq-2 text-sq-body text-sq-ink">{message.text}</p>
            </div>
          )}
        </div>
      </Panel>

      {revisions !== null && (
        <Panel
          title="What the file contains"
          description={`${revisions.length} revision(s), read as ${format ?? 'unknown'}. Nothing has been created.`}
          padded={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Rev</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Name</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Quote</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Company</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Contract</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Deposit</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Last edited</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((revision, index) => (
                  <tr key={index} className="border-b border-sq-line last:border-0">
                    <td className="sq-numeric px-sq-3 py-sq-2">{revision.revision ?? '—'}</td>
                    <td className="px-sq-3 py-sq-2">
                      {revision.name || '—'}
                      {revision.description !== '' && (
                        <span className="block text-sq-micro text-sq-ink-muted">{revision.description}</span>
                      )}
                    </td>
                    <td className="sq-numeric px-sq-3 py-sq-2">{revision.quoteNumber || '—'}</td>
                    <td className="px-sq-3 py-sq-2">{revision.companyName || '—'}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{dollars(revision.contractPrice)}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{dollars(revision.deposit)}</td>
                    <td className="px-sq-3 py-sq-2 text-sq-ink-muted">
                      {revision.lastEdited === null ? '—' : revision.lastEdited.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-sq-line px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">
            These are the figures the file states, in the file&rsquo;s own units. Re-key the building
            to get a price this engine stands behind.
          </p>
        </Panel>
      )}
    </div>
  );
}
