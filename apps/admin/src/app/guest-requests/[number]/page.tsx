import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { SessionView } from '@sq/contracts';
import { dateTime, Panel, StatusPill } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { GuestRequestStatusPanel } from '@/components/GuestRequestStatus';
import {
  CLADDING_LABEL,
  FLAG_LABEL,
  KNEE_LABEL,
  metres,
  OPENING_LABEL,
  ROOF_LABEL,
  SLAB_LABEL,
  type GuestRequestDetail,
} from '@/lib/guestRequests';

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params;
  return { title: decodeURIComponent(number) };
}

/** Label / value pairs, the layout every block on this page uses. */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,max-content)_1fr] gap-x-sq-4 gap-y-sq-1 text-sq-body">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sq-ink-muted">{label}</dt>
          <dd className="text-sq-ink">{value === '' || value === null || value === undefined ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const label = (map: Record<string, string>, code: string | undefined) => (code === undefined ? '' : (map[code] ?? code));

/**
 * One guest request: who sent it, what they designed, and what the server noticed.
 *
 * The estimate and the "check" flags are internal — the guest's own email never carries an
 * unconfirmed wind region — so they are shown here, under their own heading, for the estimator.
 */
export default async function GuestRequestPage({ params }: { params: Promise<{ number: string }> }) {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const { number } = await params;
  const result = await serverFetch<GuestRequestDetail>(`/admin/guest-requests/${encodeURIComponent(decodeURIComponent(number))}`);
  if (!result.ok && result.code === 'not_found') notFound();

  const frame = (children: ReactNode) => (
    <ShellFrame session={session.data} current="/guest-requests">
      <div className="flex max-w-4xl flex-col gap-sq-4">
        <a href="/guest-requests" className="w-fit text-sq-body text-sq-ink-muted no-underline hover:text-sq-ink">
          ‹ Guest requests
        </a>
        {children}
      </div>
    </ShellFrame>
  );

  if (!result.ok) {
    return frame(
      <Panel title="Could not load this request">
        <p className="text-sq-body text-sq-danger">
          {result.code === 'forbidden' ? 'Your role cannot see guest requests.' : result.message}
        </p>
      </Panel>,
    );
  }

  const r = result.data;
  const design = r.design ?? {};
  const building = design.building ?? {};
  const site = design.site ?? {};
  const colours = design.colours ?? {};
  const bays = building.bayWidths ?? [];
  const openings = design.openings ?? [];
  const estimate = r.estimate;
  const source = r.source ?? {};
  const sourceText = Object.entries(source)
    .filter(([, v]) => typeof v === 'string' && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');

  return frame(
    <>
      <div>
        <h1 className="font-mono text-sq-title font-semibold">{r.number}</h1>
        <p className="text-sq-body text-sq-ink-muted">
          Sent {dateTime(r.createdAt)}
          {r.updatedAt !== r.createdAt ? ` · changed ${dateTime(r.updatedAt)}` : ''}
        </p>
      </div>

      <Panel title="Status">
        <GuestRequestStatusPanel number={r.number} initialStatus={r.status} initialReason={r.declineReason} />
        {r.transferredAt !== null && (
          <p className="mt-sq-2 text-sq-micro text-sq-ink-muted">Transferred {dateTime(r.transferredAt)}</p>
        )}
      </Panel>

      <Panel title="Contact">
        <Facts
          rows={[
            ['Name', r.name],
            ['Email', r.email === '' ? '' : (
              <a href={`mailto:${r.email}`} className="text-sq-brand underline underline-offset-2">
                {r.email}
              </a>
            )],
            ['Mobile', r.mobile === '' ? '' : (
              <a href={`tel:${r.mobile}`} className="text-sq-brand underline underline-offset-2">
                {r.mobile}
              </a>
            )],
            ['Site', [site.street, site.suburb, site.state, site.postcode].filter((p) => p !== undefined && p !== '').join(', ')],
          ]}
        />
        {r.notes !== null && r.notes !== '' && (
          <div className="mt-sq-3 flex flex-col gap-1">
            <span className="text-sq-micro text-sq-ink-muted">Additional request</span>
            <p className="whitespace-pre-line text-sq-body text-sq-ink">{r.notes}</p>
          </div>
        )}
      </Panel>

      <Panel title="Building">
        <Facts
          rows={[
            ['Type', r.typeName],
            ['Size', building.span === undefined ? '' : `${metres(building.span)} wide × ${metres(r.lengthMm)} long × ${metres(building.height ?? 0)} high`],
            ['Bays', bays.length === 0 ? '' : `${bays.length} × (${bays.map(metres).join(' + ')})`],
            ['Roof', building.roof === undefined ? '' : `${label(ROOF_LABEL, building.roof)}, ${building.pitchDeg ?? '?'}°`],
            ['Slab', label(SLAB_LABEL, building.slab)],
            ['Bracing', label(KNEE_LABEL, building.kneeBrace)],
            ['Cladding', label(CLADDING_LABEL, building.cladding)],
            ['Walls', colours.walls ?? ''],
            ['Roof colour', colours.roof ?? ''],
            ['Trim', colours.trim === undefined ? '' : `barge ${colours.trim.barge ?? '—'}, gutter ${colours.trim.gutter ?? '—'}, downpipe ${colours.trim.downpipe ?? '—'}`],
          ]}
        />
        <div className="mt-sq-3 flex flex-col gap-1">
          <span className="text-sq-micro text-sq-ink-muted">Openings</span>
          {openings.length === 0 ? (
            <p className="text-sq-body text-sq-ink">None</p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-sq-body text-sq-ink">
              {openings.map((o, i) => (
                <li key={i}>
                  {label(OPENING_LABEL, o.type)}, {metres(o.size.width)} × {metres(o.size.height)}, {o.wall} wall
                  {o.type === 'roller_door' && o.motorised === true ? ', motorised' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel title="For the estimator" description="Not shown to the guest.">
        <Facts
          rows={[
            ['Estimate', estimate === null ? 'None (an enquiry, or the address could not be placed)' : [
              estimate.region === null || estimate.region === undefined ? 'wind region not placed' : `Region ${estimate.region}`,
              `${text(estimate.buildingClass)} ${estimate.enclosure === 'roof_only' ? 'Roof Only' : 'Enclosed'}`,
              `Importance Level ${estimate.importanceLevel ?? '?'}`,
            ].join(' · ')],
            ['Check', r.reviewFlags.length === 0 ? 'Nothing outside the price book' : (
              <span className="flex flex-wrap gap-sq-1">
                {r.reviewFlags.map((f) => (
                  <StatusPill key={f} tone="attention" label={FLAG_LABEL[f] ?? f} />
                ))}
              </span>
            )],
            ['Source', sourceText],
          ]}
        />
      </Panel>

      {r.transcript.length > 0 && (
        <Panel title="Assistant conversation" description="Already redacted when it was stored.">
          <ol className="flex flex-col gap-sq-2">
            {r.transcript.map((turn, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="text-sq-micro font-medium text-sq-ink-muted">
                  {turn.role === 'guest' ? 'Guest' : 'Assistant'}
                </span>
                <p className="whitespace-pre-line text-sq-body text-sq-ink">{turn.text}</p>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </>,
  );
}
