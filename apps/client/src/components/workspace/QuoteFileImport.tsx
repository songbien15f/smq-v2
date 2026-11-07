'use client';

/**
 * Reading a legacy `.sqd` quote file.
 *
 * ## What this screen is for
 *
 * An operator arrives holding a file from the desktop app. Two questions, in order: *what is in it*,
 * and *can I carry on working?* The first is the file's own claims — its revisions and the money it
 * states. The second is the building, converted by `readLegacyPlan` into the vocabulary this editor
 * speaks, which opens in a new quote with the plan, the 2D drawing and the 3D view already up.
 *
 * ## Why the gaps are shown before the button, not after
 *
 * The conversion carries the shell, the site conditions, the colours, the catalogue lines and the
 * openings. It does **not** carry skylights, mezzanines, awnings, stables, outriggers, carry beams,
 * tracks or dividing walls: each is a shape with its own place on the old plan, and converting one
 * without the old drawing to check against would put an object in the wrong spot and quote it. Those
 * groups are listed by name and count **above** the button, because a shed quoted without its
 * skylights is a wrong price that looks right.
 *
 * ## Why the file's price is shown but never used
 *
 * `ContractPrice` came from a price book and a margin nobody recorded. Opening the building re-prices
 * it from this build's book, and that figure is the one to quote. Both numbers are shown side by side
 * so the difference is visible rather than surprising.
 *
 * ## Why the refusal is shown in full
 *
 * Some `.sqd` files are `.NET BinaryFormatter` output, which this build cannot read. A half-parse
 * would produce a plausible wrong price, so the reader refuses and explains. The explanation is the
 * useful part — it tells the operator the file predates the readable format, rather than that
 * something unspecified went wrong.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Panel, StatusPill } from '@sq/ui';
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

/** A field the conversion left behind, as the API reports it. */
interface LegacyNote {
  what: string;
  detail: string;
  count?: number;
}

/** What the API says about the building inside the file. */
interface LegacyBuilding {
  config: Record<string, unknown>;
  carried: string[];
  dropped: LegacyNote[];
  assumed: LegacyNote[];
  customer: Record<string, string>;
  site: Record<string, string>;
  claimed: { revisionName: string; quoteNumber: string; contractDollars: number | null };
}

type ReadResult = {
  format: string;
  integrity?: string;
  revisions: ImportedRevision[];
  building: LegacyBuilding | null;
};

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

/** A size, in the unit the old plan used: millimetres. */
function mm(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} mm` : '—';
}

export function QuoteFileImport() {
  const router = useRouter();
  const [result, setResult] = useState<ReadResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const choose = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setMessage(null);
    setResult(null);
    setFileName(file.name);
    setBusy(true);

    try {
      const data = await readAsBase64(file);
      const answer = await api<ReadResult>('quotes/import/sqd', { method: 'POST', body: { data } });
      if (answer.ok) {
        setResult(answer.data);
      } else {
        setMessage(answer.message);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hand the building to a new quote.
   *
   * Through the URL **fragment**, which is never sent to a server or written to a proxy log — the same
   * route a template link takes, and the reason the editor already knows how to read one. The editor
   * prices the building on open, so the operator sees this build's number rather than the file's.
   */
  const openInEditor = (building: LegacyBuilding): void => {
    const fragment = new URLSearchParams({
      template: JSON.stringify(building.config),
      customer: JSON.stringify({ customer: building.customer, site: building.site }),
    });
    router.push(`/quotes/new#${fragment.toString()}`);
  };

  const building = result?.building ?? null;

  return (
    <div className="flex flex-col gap-sq-4">
      <Panel
        title="Read a .sqd quote file"
        description="The file the desktop app writes. Nothing is saved until you open the building and save it here."
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
              <p className="mt-sq-2 text-sq-body text-sq-ink">{message}</p>
            </div>
          )}
        </div>
      </Panel>

      {result !== null && (
        <Panel
          title="What the file contains"
          description={`${result.revisions.length} revision(s), read as ${result.format}. Nothing has been created.`}
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
                {result.revisions.map((revision, index) => (
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
            These are the figures the file states, in the file&rsquo;s own units. They were priced on an
            older book, so they are not the figures to quote.
          </p>
        </Panel>
      )}

      {result !== null && building === null && (
        <Panel title="No building in this file">
          <p className="text-sq-body text-sq-ink">
            This revision carries a price but not the building it was priced from — the old app could
            save a quote without its plan. There is nothing to open here, so the quote has to be
            re-keyed.
          </p>
        </Panel>
      )}

      {building !== null && (
        <Panel
          title="Open it in the editor"
          description="The building is converted and re-priced from this build's book. Nothing is saved until you save the quote."
          actions={
            <Button variant="primary" onClick={() => openInEditor(building)}>
              Open in the editor
            </Button>
          }
        >
          <div className="flex flex-col gap-sq-3">
            <dl className="grid grid-cols-2 gap-x-sq-4 gap-y-sq-1 text-sq-body sm:grid-cols-4">
              <div>
                <dt className="text-sq-micro text-sq-ink-muted">Span</dt>
                <dd className="sq-numeric">{mm(building.config.span)}</dd>
              </div>
              <div>
                <dt className="text-sq-micro text-sq-ink-muted">Length</dt>
                <dd className="sq-numeric">{mm(building.config.length)}</dd>
              </div>
              <div>
                <dt className="text-sq-micro text-sq-ink-muted">Wall height</dt>
                <dd className="sq-numeric">{mm(building.config.height)}</dd>
              </div>
              <div>
                <dt className="text-sq-micro text-sq-ink-muted">Bays</dt>
                <dd className="sq-numeric">
                  {typeof building.config.bays === 'number' ? building.config.bays : '—'}
                </dd>
              </div>
            </dl>

            {building.carried.length > 0 && (
              <div>
                <h3 className="text-sq-micro font-semibold uppercase tracking-wide text-sq-ink-muted">
                  Carried across
                </h3>
                <ul className="mt-sq-1 flex flex-wrap gap-x-sq-3 gap-y-sq-1 text-sq-body text-sq-ink">
                  {building.carried.map((entry) => (
                    <li key={entry} className="text-sq-ink-muted">
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {building.dropped.length > 0 && (
              <div className="rounded-md border border-sq-attention/30 bg-sq-attention/5 p-sq-3">
                <h3 className="flex items-center gap-sq-2 text-sq-body font-semibold text-sq-ink">
                  <StatusPill tone="attention" label="Not carried over" />
                </h3>
                <ul className="mt-sq-2 flex flex-col gap-sq-2 text-sq-body">
                  {building.dropped.map((note) => (
                    <li key={note.what}>
                      <span className="font-medium text-sq-ink">
                        {note.count === undefined ? note.what : `${note.count} × ${note.what}`}
                      </span>
                      <span className="block text-sq-ink-muted">{note.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {building.assumed.length > 0 && (
              <div>
                <h3 className="text-sq-micro font-semibold uppercase tracking-wide text-sq-ink-muted">
                  Check these before you save
                </h3>
                <ul className="mt-sq-1 flex flex-col gap-sq-2 text-sq-body">
                  {building.assumed.map((note) => (
                    <li key={note.what}>
                      <span className="font-medium text-sq-ink">{note.what}</span>
                      <span className="block text-sq-ink-muted">{note.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-sq-micro text-sq-ink-muted">
              The file states {dollars(building.claimed.contractDollars)} for{' '}
              {building.claimed.quoteNumber || building.claimed.revisionName}. Opening it re-prices the
              building, so the figure on screen will be this build&rsquo;s.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
