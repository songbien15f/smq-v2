'use client';

/**
 * A company's own prices, version by version.
 *
 * ## Why this screen exists
 *
 * The price list import writes `price_row_overrides`; until this screen, nothing could read it back.
 * A vendor asked "what has this company overridden?" had to open psql. And until the evaluate route
 * was wired, the overrides did not affect a quote at all — so this screen and that wiring are two
 * halves of one feature.
 *
 * ## Why a change makes a new version
 *
 * A saved revision records the override version it was priced under. Editing a version in place would
 * make that record point at prices it was never priced from. So the screen always shows the chain, and
 * an edit appears as a new top row rather than mutating the one below it.
 *
 * ## Why clearing a row is different from deleting a version
 *
 * Clearing one row means "charge the book's price for this material" while keeping every other
 * override. Deleting a version means "undo that whole import". Conflating them is how a single
 * mispriced section loses a company's entire price list.
 */

import { useState } from 'react';
import { Button, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

interface OverrideRow {
  rowKey: string;
  unitCostCents: number;
  codeOverride: string | null;
  updatedAt: string;
}

interface Version {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
  rowCount: number;
  rows: OverrideRow[];
}

export interface PriceOverridesPanelProps {
  /** The company whose prices these are. `null` when the caller's own. */
  tenantId: string | null;
  initial: { versions: Version[]; custom: unknown[] };
}

/** A row key read back into something a person can scan: `cost_frame:code=X&description=Y`. */
function describeKey(rowKey: string): { source: string; fields: string } {
  const [source = rowKey, query = ''] = rowKey.split(':', 2);
  const fields = query
    .split('&')
    .filter((part) => part !== '')
    .map((part) => {
      const [name, value = ''] = part.split('=');
      return `${name}=${decodeURIComponent(value)}`;
    })
    .join(', ');
  return { source, fields };
}

export function PriceOverridesPanel({ tenantId, initial }: PriceOverridesPanelProps) {
  const [versions, setVersions] = useState<Version[]>(initial.versions);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ rowKey: string; dollars: string } | null>(null);

  const base = tenantId === null ? 'prices/overrides' : `admin/companies/${tenantId}/prices/overrides`;

  const reload = async (): Promise<void> => {
    const result = await api<{ versions: Version[]; custom: unknown[] }>(base);
    if (result.ok) setVersions(result.data.versions);
  };

  const setPrice = async (rowKey: string, dollars: string): Promise<void> => {
    setBusy(rowKey);
    setMessage(null);

    // An empty box means "go back to the book's price", which is a deliberate act, not a blank save.
    const value = dollars.trim() === '' ? null : Math.round(Number(dollars) * 100);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setBusy(null);
      setMessage({ tone: 'danger', text: 'Enter a price in dollars, or leave it empty to use the book price.' });
      return;
    }

    const result = await api<{ version: number; rowCount: number }>(base, {
      method: 'PUT',
      body: { rowKey, unitCostCents: value },
    });

    setBusy(null);
    if (result.ok) {
      setMessage({
        tone: 'ok',
        text: value === null ? 'That material now uses the book price.' : `Saved as version ${result.data.version}.`,
      });
      setEditing(null);
      await reload();
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  const deleteVersion = async (version: Version): Promise<void> => {
    setBusy(version.id);
    setMessage(null);

    const result = await api<{ deleted: boolean }>(`${base}/${version.id}`, { method: 'DELETE' });

    setBusy(null);
    if (result.ok) {
      setMessage({ tone: 'ok', text: `Version ${version.version} removed. The prices before it are in force again.` });
      await reload();
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  const latest = versions[0];

  return (
    <div className="flex flex-col gap-sq-4">
      {message !== null && (
        <p
          role={message.tone === 'danger' ? 'alert' : 'status'}
          className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
        >
          {message.text}
        </p>
      )}

      <Panel
        title="Prices in force"
        description="The newest version prices every quote. Older versions are kept because saved revisions name them."
        padded={false}
      >
        {latest === undefined ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            No overrides. Every material is priced from the shared book. Load a price list from the
            company&rsquo;s Settings, or add one row below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Material</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Group</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Your price</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {latest.rows.map((row) => {
                  const key = describeKey(row.rowKey);
                  const isEditing = editing?.rowKey === row.rowKey;

                  return (
                    <tr key={row.rowKey} className="border-b border-sq-line last:border-0">
                      <td className="px-sq-3 py-sq-2">
                        <span className="block sq-numeric text-sq-micro text-sq-ink-muted">{key.fields}</span>
                      </td>
                      <td className="px-sq-3 py-sq-2 text-sq-ink-muted">{key.source}</td>
                      <td className="sq-numeric px-sq-3 py-sq-2 text-right">
                        {isEditing ? (
                          <input
                            aria-label={`Price for ${key.fields}`}
                            type="number"
                            step="0.01"
                            min="0"
                            value={editing.dollars}
                            onChange={(event) => setEditing({ rowKey: row.rowKey, dollars: event.target.value })}
                            className="w-24 rounded-md border border-sq-line bg-sq-surface px-sq-1 py-1 text-right text-sq-body"
                          />
                        ) : (
                          `$${(row.unitCostCents / 100).toFixed(2)}`
                        )}
                      </td>
                      <td className="px-sq-3 py-sq-2">
                        {isEditing ? (
                          <span className="flex flex-wrap gap-sq-1">
                            <Button loading={busy === row.rowKey} onClick={() => void setPrice(row.rowKey, editing.dollars)}>
                              Save
                            </Button>
                            <Button onClick={() => setEditing(null)}>Cancel</Button>
                          </span>
                        ) : (
                          <span className="flex flex-wrap gap-sq-1">
                            <Button
                              onClick={() => setEditing({ rowKey: row.rowKey, dollars: (row.unitCostCents / 100).toFixed(2) })}
                            >
                              Change
                            </Button>
                            <Button loading={busy === row.rowKey} onClick={() => void setPrice(row.rowKey, '')}>
                              Use book price
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {versions.length > 1 && (
        <Panel title="History" description="Each version is what a revision was priced under." padded={false}>
          <ul className="flex flex-col">
            {versions.map((version, index) => (
              <li
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2 last:border-0"
              >
                <span className="flex flex-wrap items-center gap-sq-2">
                  <span className="sq-numeric text-sq-body font-medium text-sq-ink">v{version.version}</span>
                  {index === 0 && <StatusPill tone="ok" label="In force" />}
                  <span className="text-sq-micro text-sq-ink-muted">
                    {version.rowCount} row{version.rowCount === 1 ? '' : 's'} · {version.createdAt.slice(0, 16).replace('T', ' ')}
                  </span>
                  {version.note !== null && version.note !== '' && (
                    <span className="text-sq-micro text-sq-ink-muted">— {version.note}</span>
                  )}
                </span>
                <Button loading={busy === version.id} onClick={() => void deleteVersion(version)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="text-sq-micro text-sq-ink-muted">
        A change always makes a new version, because a saved revision names the version it was priced
        under. Removing a version puts the one before it back in force.
      </p>
    </div>
  );
}
