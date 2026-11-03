'use client';

/**
 * The shared quote, as a customer sees it.
 *
 * ## Why the token is read from the fragment
 *
 * `/s#<token>` — the token arrives in the URL **fragment**, which a browser never sends to a server.
 * So it does not appear in a proxy log, an analytics tool, or a `Referer` header when the customer
 * clicks a link on the page. The fragment is read once here, exchanged for a cookie, and then removed
 * from the address bar with `history.replaceState` so it does not sit in the customer's history on a
 * shared machine.
 *
 * ## Why the document is an iframe
 *
 * The quote has its own print stylesheet, its own fonts and its own page size. Re-rendering it inside
 * this app would put this app's CSS around it and the customer's copy would look different from the
 * one the operator printed. An iframe with `src` pointing at the API's document route keeps the two
 * separate — and the API has already set the share cookie, so the iframe carries it.
 *
 * ## What this page never shows
 *
 * No sign-in, no navigation, no company workspace. A customer who receives a link sees a quote and
 * nothing else about the business that sent it.
 */

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3060/api/v1';

type State =
  | { kind: 'reading' }
  | { kind: 'ready' }
  | { kind: 'unavailable'; message: string };

export default function SharedQuotePage() {
  const [state, setState] = useState<State>({ kind: 'reading' });

  useEffect(() => {
    let cancelled = false;

    const redeem = async (): Promise<void> => {
      const token = window.location.hash.replace(/^#/, '');

      if (token === '') {
        // A reload after the token was cleared: the cookie may still be valid, so try the document
        // before refusing.
        const existing = await fetch(`${API}/share/document`, { credentials: 'include' });
        if (cancelled) return;
        setState(
          existing.ok
            ? { kind: 'ready' }
            : {
                kind: 'unavailable',
                message: 'This link is incomplete. Ask the company to send it again.',
              },
        );
        return;
      }

      const response = await fetch(`${API}/share/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });

      if (cancelled) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setState({
          kind: 'unavailable',
          message: body?.message ?? 'This link is no longer available. Ask for a new one.',
        });
        return;
      }

      // The cookie is set. Drop the token from the address bar and from history: on a shared
      // machine, a quote link in the back button is somebody else's business.
      window.history.replaceState(null, '', window.location.pathname);
      setState({ kind: 'ready' });
    };

    void redeem();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-sq-ground">
      <header className="bg-sq-brand text-white">
        <div className="mx-auto flex min-h-12 max-w-[1000px] items-center justify-between px-sq-4">
          <span className="text-sq-body font-semibold">Your quotation</span>
          <span className="text-sq-micro text-white/70">Read only</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1000px] flex-1 px-sq-4 py-sq-4">
        {state.kind === 'reading' && (
          <div className="flex min-h-[60dvh] items-center justify-center">
            <p className="text-sq-body-lg text-sq-ink-muted" role="status">
              Opening your quotation…
            </p>
          </div>
        )}

        {state.kind === 'unavailable' && (
          <div className="mx-auto mt-sq-8 max-w-md rounded-lg border border-sq-line bg-sq-surface p-sq-4">
            <h1 className="text-sq-title font-semibold text-sq-ink">This link is not available</h1>
            <p className="mt-sq-2 text-sq-body text-sq-ink-muted" role="alert">
              {state.message}
            </p>
          </div>
        )}

        {state.kind === 'ready' && (
          <iframe
            src={`${API}/share/document`}
            title="Quotation"
            className="h-[calc(100dvh-8rem)] w-full rounded-lg border border-sq-line bg-white"
          />
        )}
      </main>

      <footer className="mx-auto w-full max-w-[1000px] px-sq-4 pb-sq-4 text-sq-micro text-sq-ink-muted">
        This page shows the quotation exactly as it was issued. Prices are in Australian dollars and
        include GST.
      </footer>
    </div>
  );
}
