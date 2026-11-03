'use client';

/**
 * The document actions for one revision: download, print, share, and the links already out there.
 *
 * ## Why the downloads are plain links and not fetches
 *
 * A PDF is a file. Fetching it into JavaScript, making a blob and triggering an `<a download>` is three
 * steps that can each fail, and on a phone the result is often a tab instead of a download. A real
 * `href` to the API route with `download` on it is one step, and the browser already knows what to do
 * with `content-disposition`.
 *
 * The cookie travels with a top-level navigation, so the link works from a signed-in tab without any
 * code at all.
 *
 * ## Why the share link is a dialog and not a copy button
 *
 * The token is returned **once** and cannot be recovered. An operator who copies it and loses it must
 * mint a new link, so the dialog has to say that plainly rather than presenting a value that looks
 * permanent.
 *
 * ## Why the issued links are listed
 *
 * Minting a link used to be a one-way door: the token was shown once and nothing ever listed what had
 * been handed out, so a link sent to the wrong customer could not be found, let alone revoked. The
 * list carries metadata only — never the token, which the server cannot recover either — and each
 * row can be revoked.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@sq/ui';
import { api } from '@/lib/sq';

export interface DocumentActionsProps {
  quoteId: string;
  revisionId: string;
  revision: number;
  /** Whether the operator may send — minting a link is the act of sending. */
  canSend: boolean;
  /** Opens the email dialog. Absent when the role cannot send. */
  onSend?: () => void;
}

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3060/api/v1';

type ShareState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'minted'; url: string; expiresAt: string }
  | { kind: 'error'; message: string };

/** One issued link, as the API reports it. The token itself is never in this shape. */
interface IssuedLink {
  id: string;
  revision: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
}

/** A date, or a dash. Deliberately short: this is a table cell, not a sentence. */
function day(value: string | null): string {
  return value === null || value === '' ? '—' : value.slice(0, 10);
}

export function DocumentActions({ quoteId, revisionId, revision, canSend, onSend }: DocumentActionsProps) {
  const [share, setShare] = useState<ShareState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<IssuedLink[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const htmlHref = `${API}/quotes/${quoteId}/revisions/${revision}/html`;
  const pdfHref = `${API}/quotes/${quoteId}/revisions/${revision}/pdf`;
  const bomHref = `${API}/quotes/${quoteId}/revisions/${revision}/bom`;

  /**
   * Load the links already issued for this quote.
   *
   * Called on mount and after a mint or a revoke, so the list is never a stale claim about what is
   * out there. A failure is shown rather than swallowed: an empty list that is really a 403 reads as
   * "nothing was ever sent", which is the opposite of the truth.
   */
  const loadLinks = useCallback(async (): Promise<void> => {
    const result = await api<{ items: IssuedLink[] }>(`quotes/${quoteId}/shares`);
    if (result.ok) {
      setLinks(result.data.items);
      setLinksError(null);
    } else {
      setLinksError(result.message);
    }
  }, [quoteId]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const mint = async (): Promise<void> => {
    setShare({ kind: 'working' });
    setCopied(false);

    const result = await api<{ url: string; expiresAt: string }>(
      `quotes/${quoteId}/shares`,
      { method: 'POST', body: { revisionId, expiresInDays: 30 } },
    );

    if (result.ok) {
      setShare({ kind: 'minted', url: result.data.url, expiresAt: result.data.expiresAt });
      await loadLinks();
    } else {
      setShare({ kind: 'error', message: result.message });
    }
  };

  const revoke = async (id: string): Promise<void> => {
    setRevoking(id);
    const result = await api(`quotes/${quoteId}/shares/${id}`, { method: 'DELETE' });
    setRevoking(null);
    if (result.ok) await loadLinks();
    else setLinksError(result.message);
  };

  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access is refused outside a secure context and in some browsers. Selecting the
      // text is the fallback, and the field is read-only so it is easy to copy by hand.
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-sq-2">
      <div className="flex flex-wrap items-center gap-sq-2">
        <a
          href={pdfHref}
          className="inline-flex min-h-11 items-center rounded-md border border-sq-line bg-sq-surface px-sq-3 text-sq-body font-medium text-sq-ink no-underline transition-colors duration-sq-fast hover:bg-sq-ground"
        >
          Download PDF
        </a>
        <a
          href={htmlHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-md border border-sq-line bg-sq-surface px-sq-3 text-sq-body font-medium text-sq-ink no-underline transition-colors duration-sq-fast hover:bg-sq-ground"
        >
          Open in a tab
        </a>
        {/*
          The materials workbook. It is not the customer's document — it carries unit costs and group
          subtotals — so it sits beside the downloads rather than inside the send flow, and the
          server refuses it to a role without `cost:read`.
        */}
        <a
          href={bomHref}
          className="inline-flex min-h-11 items-center rounded-md border border-sq-line bg-sq-surface px-sq-3 text-sq-body font-medium text-sq-ink no-underline transition-colors duration-sq-fast hover:bg-sq-ground"
        >
          Download materials list
        </a>
        {/*
          The legacy `.sqd` file. It exists so a quote is not trapped in this product: the desktop
          app opens it, and so does any future export. Plain JSON, which is the one shape both
          readers accept without sharing a hardcoded key.
        */}
        <a
          href={`${API}/quotes/${quoteId}/export/sqd`}
          className="inline-flex min-h-11 items-center rounded-md border border-sq-line bg-sq-surface px-sq-3 text-sq-body font-medium text-sq-ink no-underline transition-colors duration-sq-fast hover:bg-sq-ground"
        >
          Export .sqd
        </a>
        {onSend !== undefined && (
          <Button variant="primary" onClick={onSend}>
            Email the customer
          </Button>
        )}
        {canSend && (
          <Button loading={share.kind === 'working'} onClick={() => void mint()}>
            Create a link
          </Button>
        )}
      </div>

      <p className="text-sq-micro text-sq-ink-muted">
        Every download shows revision {revision} exactly as it was saved. A later revision does not
        change this one.
      </p>

      {share.kind === 'error' && (
        <p role="alert" className="text-sq-body text-sq-danger">
          {share.message}
        </p>
      )}

      {share.kind === 'minted' && (
        <div className="rounded-lg border border-sq-info/30 bg-sq-info/5 p-sq-3">
          <h3 className="text-sq-body font-semibold text-sq-ink">The link is ready</h3>
          <p className="mt-sq-1 text-sq-body text-sq-ink-muted">
            <strong className="text-sq-ink">Copy it now.</strong> It cannot be shown again — if it is
            lost, create a new one. The link works until {share.expiresAt.slice(0, 10)} and shows only
            this revision.
          </p>
          <div className="mt-sq-2 flex flex-wrap items-center gap-sq-2">
            <input
              readOnly
              value={share.url}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Customer link"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body sq-numeric"
            />
            <Button onClick={() => void copy(share.url)}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ issued links */}
      {linksError !== null && (
        <p role="alert" className="text-sq-body text-sq-danger">
          {linksError}
        </p>
      )}

      {links.length > 0 && (
        <div className="mt-sq-1">
          <h3 className="text-sq-body font-semibold text-sq-ink">Links issued</h3>
          <p className="mt-sq-1 text-sq-micro text-sq-ink-muted">
            The token cannot be recovered from here — only revoked. A revoked link stops working
            immediately.
          </p>
          <div className="mt-sq-2 overflow-x-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Rev</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Created</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Expires</th>
                  <th scope="col" className="px-sq-2 py-sq-2 text-right font-medium">Views</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Last opened</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">State</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {links.map((link) => {
                  const revoked = link.revoked_at !== null;
                  return (
                    <tr key={link.id} className="border-b border-sq-line last:border-0">
                      <td className="sq-numeric px-sq-2 py-sq-2">{link.revision}</td>
                      <td className="px-sq-2 py-sq-2 text-sq-ink-muted">{day(link.created_at)}</td>
                      <td className="px-sq-2 py-sq-2 text-sq-ink-muted">{day(link.expires_at)}</td>
                      <td className="sq-numeric px-sq-2 py-sq-2 text-right">{link.view_count}</td>
                      <td className="px-sq-2 py-sq-2 text-sq-ink-muted">{day(link.last_viewed_at)}</td>
                      <td className="px-sq-2 py-sq-2">
                        {revoked ? (
                          <span className="text-sq-danger">Revoked</span>
                        ) : (
                          <span className="text-sq-ink">Active</span>
                        )}
                      </td>
                      <td className="px-sq-2 py-sq-2 text-right">
                        {!revoked && canSend && (
                          <Button
                            variant="destructive"
                            loading={revoking === link.id}
                            onClick={() => void revoke(link.id)}
                            aria-label={`Revoke the link created ${day(link.created_at)}`}
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
