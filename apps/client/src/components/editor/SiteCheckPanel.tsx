'use client';

/**
 * The ShedSafe site check, on the design step.
 *
 * ## What this screen is honest about
 *
 * A ShedSafe **certificate** is issued by the manufacturer through their own ShedSafe account. This
 * product cannot issue one and does not pretend to. What it does is what the desktop did: create the
 * building at ShedSafe, hand the operator a link to finish the check there, then read the six
 * certified numbers back so the quote is priced against a real rating.
 *
 * That is why the button says "Open ShedSafe" and not "Get certified", and why the panel says the
 * certificate is theirs.
 *
 * ## Why the six fields are shown even when empty
 *
 * An empty field is information: it says the check has not been calculated yet. Hiding the panel
 * until it has values would make a pinned-but-uncalculated site look like a site with no check at
 * all, and the operator would pin a second building.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/sq';
import { useDraftStore } from '@/store/useDraftStore';

/** The six certified fields, as ShedSafe names them. */
interface SiteCheckValues {
  importanceLevel: number | null;
  windRegion: string | null;
  terrainCategory: number | null;
  buildingClass: string | null;
  snowLoad: number | null;
  designWindSpeed: number | null;
}

interface SiteCheck {
  id: string;
  buildingId: string | null;
  reference: string;
  siteLink: string | null;
  status: string;
  lastError: string | null;
  pinnedAt: string;
  importedAt: string | null;
  values: SiteCheckValues;
}

export interface SiteCheckPanelProps {
  quoteId: string | null;
  /** What to pin. Absent when the quote has not been saved — a check belongs to a quote. */
  site: { address: string; suburb: string; state: string; postcode: string };
  client: { firstName: string; lastName: string; email: string };
  heightMm: number;
  spanMm: number;
  lengthMm: number;
  importanceLevel: number;
  canWrite: boolean;
  /** Called when a rating is imported, so the design fields can take the certified values. */
  onImported?: (values: SiteCheckValues) => void;
}

/** How one of the six fields reads. A null is "not calculated", never a zero. */
function value(value: number | string | null, suffix = ''): string {
  if (value === null) return 'Not calculated yet';
  return `${value}${suffix}`;
}

export function SiteCheckPanel({
  quoteId,
  site,
  client,
  heightMm,
  spanMm,
  lengthMm,
  importanceLevel,
  canWrite,
  onImported,
}: SiteCheckPanelProps) {
  const [check, setCheck] = useState<SiteCheck | null>(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState<'pinning' | 'importing' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const setSiteCheckId = useDraftStore((state) => state.setSiteCheckId);

  const load = useCallback(async (): Promise<void> => {
    if (quoteId === null) return;
    const result = await api<{ configured: boolean; check: SiteCheck | null }>(`quotes/${quoteId}/site-check`);
    if (result.ok) {
      setConfigured(result.data.configured);
      setCheck(result.data.check);
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pin = async (): Promise<void> => {
    setBusy('pinning');
    setMessage(null);

    /*
     * Before the quote exists the check is pinned against the company and linked on the
     * first save. That is the desktop's order, and it is the only one that lets a
     * salesperson finish Step 1 without saving a throwaway revision first.
     */
    const path = quoteId === null ? 'site-checks/pin' : `quotes/${quoteId}/site-check/pin`;
    const result = await api<{ check: SiteCheck | null; locked: boolean }>(path, {
      method: 'POST',
      body: {
        siteAddress: {
          addressLine1: site.address,
          suburb: site.suburb,
          state: site.state,
          postcode: site.postcode,
        },
        client,
        heightMm,
        spanMm,
        lengthMm,
        importanceLevel,
      },
    });

    setBusy(null);
    if (result.ok) {
      setCheck(result.data.check);
      if (quoteId === null && result.data.check !== null) {
        setSiteCheckId(result.data.check.id);
      }
      setMessage({
        tone: 'ok',
        text: 'Pinned. Open ShedSafe to finish the check, then import the rating.',
      });
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  const importRating = async (): Promise<void> => {
    const path =
      quoteId === null
        ? check === null
          ? null
          : `site-checks/${check.id}/import`
        : `quotes/${quoteId}/site-check/import`;
    if (path === null) return;

    setBusy('importing');
    setMessage(null);

    const result = await api<{ check: SiteCheck }>(path, { method: 'POST' });

    setBusy(null);
    if (result.ok) {
      setCheck(result.data.check);
      setMessage({ tone: 'ok', text: 'The certified rating was imported.' });
      onImported?.(result.data.check.values);
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  const stale = check !== null && check.status === 'failed';

  return (
    <Panel
      title="ShedSafe site check"
      description="The wind rating this quote is priced against. The certificate is issued in your own ShedSafe account."
    >
      <div className="flex flex-col gap-sq-3">
        {!configured && (
          <p className="text-sq-body text-sq-ink-muted">
            ShedSafe is not configured on this server, so the wind fields below are typed by hand.
            Set <code>SHEDSAFE_USERNAME</code> and <code>SHEDSAFE_PASSWORD</code> to enable the check.
          </p>
        )}

        {check !== null && (
          <div className="flex flex-wrap items-center gap-sq-2">
            <StatusPill
              tone={check.status === 'imported' ? 'ok' : stale ? 'danger' : 'attention'}
              label={
                check.status === 'imported' ? 'Imported' : stale ? 'Last attempt failed' : 'Pinned, not calculated'
              }
            />
            <span className="text-sq-micro text-sq-ink-muted">Reference {check.reference}</span>
            {check.siteLink !== null && check.siteLink !== '' && (
              <a
                href={check.siteLink}
                target="_blank"
                rel="noreferrer"
                className="text-sq-micro font-medium text-sq-brand underline underline-offset-2"
              >
                Open ShedSafe
              </a>
            )}
          </div>
        )}

        {check !== null && check.lastError !== null && (
          <p role="alert" className="text-sq-body text-sq-danger">
            {check.lastError}
          </p>
        )}

        {check !== null && (
          <dl className="grid gap-sq-2 sm:grid-cols-2">
            {[
              ['Importance level', value(check.values.importanceLevel)],
              ['Wind region', value(check.values.windRegion)],
              ['Terrain category', value(check.values.terrainCategory)],
              ['Building class', value(check.values.buildingClass)],
              ['Ground snow load', value(check.values.snowLoad, ' kPa')],
              ['Design wind speed', value(check.values.designWindSpeed, ' m/s')],
            ].map(([label, shown]) => (
              <div key={String(label)} className="flex items-baseline justify-between gap-sq-2 border-b border-sq-line/60 pb-1">
                <dt className="text-sq-body text-sq-ink">{String(label)}</dt>
                <dd className="sq-numeric text-sq-body text-sq-ink">{String(shown)}</dd>
              </div>
            ))}
          </dl>
        )}

        {message !== null && (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
          >
            {message.text}
          </p>
        )}

        {configured && canWrite && (
          <div className="flex flex-wrap items-center gap-sq-2">
            <Button loading={busy === 'pinning'} onClick={() => void pin()}>
              {check === null ? 'Pin the site' : 'Pin again'}
            </Button>
            {check !== null && (
              <Button variant="primary" loading={busy === 'importing'} onClick={() => void importRating()}>
                Import the rating
              </Button>
            )}
          </div>
        )}

        <p className="text-sq-micro text-sq-ink-muted">
          A ShedSafe certificate is issued by the manufacturer through their own ShedSafe account.
          This panel reads the certified numbers back; it does not issue a certificate.
        </p>
      </div>
    </Panel>
  );
}
