import Link from 'next/link';
import { requireVendorSession } from '@/lib/vendorGuard';
import { vendorPassword } from '@/lib/vendorUsage';
import { loadVendorUsage } from '@/lib/vendorUsage';
import { VendorSignOut } from '@/components/vendor/VendorSignOut';

/**
 * `/dashboard` — is anybody using this?
 *
 * ## The two questions this answers
 *
 * **How much is happening**: four kinds of event over three windows. A total alone says the product
 * *has* been used; the 7- and 30-day columns say whether it is used **now**.
 *
 * **Where it is happening**: screen opens by route. For a product whose whole value is a long form,
 * a company that signs in and never opens the editor is a company that will not renew — and the kind
 * counts alone cannot say that.
 *
 * ## Why the figures are read on the server
 *
 * They are one person's oversight page, opened rarely, and there is nothing to filter interactively
 * that a fresh page load does not do better. Server-rendered means one request, no spinner, and no
 * `x-vendor-key` anywhere near a browser.
 *
 * ## Why it does not use the product's shell
 *
 * No rail, no company name, no quote list. Showing a customer workspace's chrome would suggest the
 * operator is inside one company; this page reads across all of them.
 */
export const dynamic = 'force-dynamic';

/** How a kind reads on screen. A kind added later falls through to its id rather than vanishing. */
const KIND_LABEL: Record<string, string> = {
  quote_created: 'Quotes created',
  revision_saved: 'Revisions saved',
  mail_sent: 'Quotes emailed',
  page_view: 'Screens opened',
};

/**
 * A route, shortened so it fits a cell.
 *
 * **No substitution here.** The API already replaced identifiers with `:id` *and grouped on that*, so
 * one screen is one row. Doing the replacement in this function as well was the first version's bug:
 * it labelled three separate `/quotes/<uuid>/edit` groups as `/quotes/:id/edit`, which made 41 + 16 +
 * 16 views look like three rows of the same screen.
 */
function routeLabel(route: string): string {
  return route.length > 48 ? `${route.slice(0, 45)}…` : route;
}

/** `2026-11-09 14:32` local, sortable by eye. */
function when(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '—';
  const d = new Date(parsed);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function num(value: number): string {
  return value === 0 ? '—' : new Intl.NumberFormat('en-AU').format(value);
}

export default async function DashboardPage() {
  await requireVendorSession();
  const configured = vendorPassword() !== null;
  const usage = configured ? await loadVendorUsage() : null;

  const totals = usage === null ? null : usage.kinds.reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      last7: sum.last7 + row.last7,
      last30: sum.last30 + row.last30,
    }),
    { total: 0, last7: 0, last30: 0 },
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-sq-4 px-sq-4 py-sq-6">
      <header className="flex flex-wrap items-start justify-between gap-sq-3">
        <div>
          <h1 className="text-sq-title font-semibold text-sq-ink">Usage dashboard</h1>
          <p className="mt-sq-1 text-sq-body text-sq-ink-muted">
            Every company, every screen. Counts only — no customer name, address or price is recorded.
          </p>
        </div>
        <nav className="flex items-center gap-sq-2">
          <Link
            href="/dashboard/docs"
            className="inline-flex min-h-11 items-center rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-ink no-underline hover:bg-sq-ground"
          >
            How pricing works
          </Link>
          <VendorSignOut />
        </nav>
      </header>

      {usage === null ? (
        <div className="rounded-lg border border-sq-danger/30 bg-sq-danger/5 p-sq-4">
          <p className="text-sq-body font-medium text-sq-danger">Could not read the figures.</p>
          <p className="mt-sq-1 text-sq-body text-sq-ink">
            {configured
              ? 'The API did not answer, or it refused the dashboard password. Check that both processes have the same VENDOR_DASHBOARD_PASSWORD and that the API is running.'
              : 'No VENDOR_DASHBOARD_PASSWORD is configured, so nothing can be read.'}
          </p>
        </div>
      ) : (
        <>
          {/* The headline: one number per window, so "is it being used now" is answered at a glance. */}
          <dl className="grid grid-cols-2 gap-sq-3 sm:grid-cols-5">
            {[
              { label: 'Visitors', value: usage.visitors.length },
              { label: 'Events, all time', value: totals?.total ?? 0 },
              { label: 'Last 7 days', value: totals?.last7 ?? 0 },
              { label: 'Last 30 days', value: totals?.last30 ?? 0 },
              { label: 'Screens tracked', value: usage.routes.length },
            ].map((cell) => (
              <div key={cell.label} className="rounded-lg border border-sq-line bg-sq-surface p-sq-3">
                <dt className="text-sq-micro font-semibold uppercase tracking-wider text-sq-ink-muted">
                  {cell.label}
                </dt>
                <dd className="sq-numeric mt-sq-1 text-sq-display font-semibold tracking-tight text-sq-ink">
                  {num(cell.value)}
                </dd>
              </div>
            ))}
          </dl>

          <section className="rounded-lg border border-sq-line bg-sq-surface">
            <h2 className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-body font-semibold text-sq-ink">
              What is happening
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sq-body">
                <thead>
                  <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Kind</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">All time</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">7 days</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">30 days</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">90 days</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.kinds.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-sq-3 py-sq-4 text-sq-ink-muted">
                        Nothing recorded yet. A screen is recorded the first time somebody opens one.
                      </td>
                    </tr>
                  ) : (
                    usage.kinds.map((row) => (
                      <tr key={row.kind} className="border-b border-sq-line/70 last:border-0">
                        <td className="px-sq-3 py-sq-2">{KIND_LABEL[row.kind] ?? row.kind}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(row.total)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(row.last7)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(row.last30)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(row.last90)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-sq-line bg-sq-surface">
            <h2 className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-body font-semibold text-sq-ink">
              Which screens are opened
            </h2>
            <p className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">
              A customer id in a route is shown as <code>:id</code>, so every quote&rsquo;s editor counts
              together.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sq-body">
                <thead>
                  <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Screen</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">All time</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">7 days</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">30 days</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">90 days</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.routes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-sq-3 py-sq-4 text-sq-ink-muted">
                        No screen has been opened yet.
                      </td>
                    </tr>
                  ) : (
                    usage.routes.map((row) => (
                      <tr key={row.route} className="border-b border-sq-line/70 last:border-0">
                        <td className="px-sq-3 py-sq-2 font-mono text-sq-micro">{routeLabel(row.route)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(row.total)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(row.last7)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(row.last30)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(row.last90)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-sq-line bg-sq-surface">
            <h2 className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-body font-semibold text-sq-ink">
              Who came ({usage.visitors.length})
            </h2>
            <p className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">
              A visitor is a distinct address, stored as a <strong>salted hash</strong> — the first eight
              characters are a handle, and the address itself is not in this database and cannot be
              recovered from it. More than one name under a visitor means a shared machine.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sq-body">
                <thead>
                  <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Visitor</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Signed in as</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">Screens</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">Events</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">First seen</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.visitors.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-sq-3 py-sq-4 text-sq-ink-muted">
                        No address has been recorded yet. Rows written before addresses were captured carry
                        no visitor, so an empty table beside a non-zero event count is normal for old data.
                      </td>
                    </tr>
                  ) : (
                    usage.visitors.map((visitor) => (
                      <tr key={visitor.visitor} className="border-b border-sq-line/70 last:border-0">
                        <td className="px-sq-3 py-sq-2 font-mono text-sq-micro">{visitor.visitor}</td>
                        <td className="px-sq-3 py-sq-2">
                          {visitor.actors.length === 0 ? (
                            <span className="text-sq-ink-muted">—</span>
                          ) : (
                            visitor.actors.join(', ')
                          )}
                          {visitor.actors.length > 1 && (
                            <span className="ml-sq-1 text-sq-micro text-sq-attention">
                              ({visitor.actors.length} people)
                            </span>
                          )}
                        </td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(visitor.screens)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2">{num(visitor.events)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">{when(visitor.firstSeen)}</td>
                        <td className="sq-numeric px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">{when(visitor.lastSeen)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-sq-line bg-sq-surface">
            <h2 className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-body font-semibold text-sq-ink">
              The activity log — who did what ({usage.activity.length})
            </h2>
            <p className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">
              Every recorded action, newest first. A screen open says which screen; a save says which
              quote; a send says which of the four intents. No customer name, address or price is
              recorded, so a quote appears by its number and not by who it was for.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sq-body">
                <thead>
                  <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">When</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Who</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">What</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">On</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Visitor</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.activity.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-sq-3 py-sq-4 text-sq-ink-muted">Nothing recorded yet.</td>
                    </tr>
                  ) : (
                    usage.activity.map((event, index) => (
                      <tr key={`${event.at}-${index}`} className="border-b border-sq-line/70 last:border-0">
                        <td className="sq-numeric px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">{when(event.at)}</td>
                        <td className="px-sq-3 py-sq-2">
                          {event.actor ?? <span className="text-sq-ink-muted">—</span>}
                          {event.tenant !== null && (
                            <span className="block text-sq-micro text-sq-ink-muted">{event.tenant}</span>
                          )}
                        </td>
                        <td className="px-sq-3 py-sq-2">{KIND_LABEL[event.kind] ?? event.kind}</td>
                        <td className="px-sq-3 py-sq-2 font-mono text-sq-micro text-sq-ink-muted">
                          {event.route !== null && routeLabel(event.route)}
                          {event.quoteNumber !== null && event.quoteNumber}
                          {event.revision !== null && ` · rev ${event.revision}`}
                          {event.mode !== null && ` · ${event.mode}`}
                        </td>
                        <td className="px-sq-3 py-sq-2 font-mono text-sq-micro text-sq-ink-muted">
                          {event.visitor ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
