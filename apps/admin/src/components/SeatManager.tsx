/**
 * Seats across every company — a read-only view, sorted so the companies that need a person come first.
 *
 * ## Why a cross-company table
 *
 * The company page can change one company's seats. What it cannot answer is the question a vendor
 * actually asks on a Monday: *who is out of seats right now?* A saturated company refuses its own
 * staff at sign-in, and the only way to find that would be to open each company in turn.
 *
 * ## Why nothing is edited here
 *
 * This table used to carry a seat input and a Save button on every row: three companies meant three
 * saves, and nothing showed which rows still held an unsaved number. Seats and the end date are edited
 * in one place — the company page, which also says what lowering a limit does — and every row here
 * links straight to that form.
 *
 * ## Why the "in use" figure is not the seat count
 *
 * A seat belongs to a **device** — one browser profile, for one person (DECISIONS D3) — not to a
 * session. Signing out keeps it; it comes back when the device is freed (by the company under Team →
 * Devices, or by the vendor on the company page), or when it goes unused for `DEVICE_IDLE_DAYS`
 * (14 by default). That is why a
 * company can be at 5 of 5 with three people at their desks, and why this screen shows both numbers
 * rather than a percentage.
 */

import type { CompanyRow } from '@sq/contracts';
import { count, DataTable, date, Panel, StatusPill } from '@sq/ui';
import { companyState } from '@/lib/companyState';

export type SeatFilter = 'all' | 'attention';

function companyHref(company: CompanyRow): string {
  return `/company/${encodeURIComponent(company.id)}`;
}

/** Needs-attention first, then the fullest — the order someone works down the list in. */
function byUrgency(a: CompanyRow, b: CompanyRow): number {
  const attention = Number(companyState(b).needsAttention) - Number(companyState(a).needsAttention);
  if (attention !== 0) return attention;
  const ratio = b.seatsInUse / Math.max(b.seats, 1) - a.seatsInUse / Math.max(a.seats, 1);
  return ratio !== 0 ? ratio : a.name.localeCompare(b.name);
}

export function SeatManager({
  companies,
  filter,
  canEdit,
}: {
  companies: CompanyRow[];
  filter: SeatFilter;
  canEdit: boolean;
}) {
  const attentionCount = companies.filter((company) => companyState(company).needsAttention).length;
  const rows = companies
    .filter((company) => filter === 'all' || companyState(company).needsAttention)
    .sort(byUrgency);

  const chip = (key: SeatFilter, label: string, n: number) => (
    <a
      href={key === 'all' ? '/seats' : '/seats?show=attention'}
      aria-current={filter === key ? 'page' : undefined}
      className={[
        'inline-flex min-h-11 items-center gap-sq-1 rounded-md border px-sq-2 text-sq-body no-underline',
        filter === key
          ? 'border-sq-brand bg-sq-brand text-white'
          : 'border-sq-line bg-sq-surface text-sq-ink hover:bg-sq-ground',
      ].join(' ')}
    >
      {label} <span className="sq-numeric">{count(n)}</span>
    </a>
  );

  return (
    <div className="flex flex-col gap-sq-4">
      <nav aria-label="Filter" className="flex flex-wrap gap-sq-2">
        {chip('attention', 'Needs attention', attentionCount)}
        {chip('all', 'All', companies.length)}
      </nav>

      <Panel
        title={filter === 'attention' ? 'Needs attention' : 'Every company'}
        description="A seat is one browser of one person, so 'in use' counts devices, not people."
        padded={false}
      >
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          caption="Seats for each company, most urgent first"
          empty={
            filter === 'attention' ? (
              <>
                Nothing needs attention: every active company has a free seat and a current subscription.{' '}
                <a href="/seats" className="font-medium text-sq-brand underline underline-offset-2">
                  Show all
                </a>
              </>
            ) : (
              'No companies. This installation has not been provisioned.'
            )
          }
          columns={[
            {
              key: 'company',
              header: 'Company',
              render: (row) => (
                <>
                  <a href={companyHref(row)} className="block font-medium text-sq-ink no-underline hover:underline">
                    {row.name}
                  </a>
                  <span className="block font-mono text-sq-micro text-sq-ink-muted">{row.code ?? row.slug}</span>
                </>
              ),
            },
            { key: 'people', header: 'People', numeric: true, render: (row) => count(row.memberCount) },
            {
              key: 'inUse',
              header: 'In use',
              numeric: true,
              render: (row) => count(row.seatsInUse),
              cellClassName: (row) => (row.seatsInUse >= row.seats ? 'font-semibold text-sq-attention' : ''),
            },
            { key: 'seats', header: 'Seats', numeric: true, render: (row) => count(row.seats) },
            {
              key: 'free',
              header: 'Free',
              numeric: true,
              render: (row) => count(Math.max(row.seats - row.seatsInUse, 0)),
              cellClassName: (row) => (row.seatsInUse >= row.seats ? 'font-semibold text-sq-attention' : ''),
            },
            {
              key: 'subscription',
              header: 'Subscription ends',
              render: (row) => (row.subscriptionEndsAt === null ? 'No end date' : date(row.subscriptionEndsAt)),
              cellClassName: (row) =>
                `whitespace-nowrap ${companyState(row).key === 'ended' ? 'text-sq-attention' : 'text-sq-ink-muted'}`,
            },
            {
              key: 'state',
              header: 'State',
              render: (row) => {
                const state = companyState(row);
                return <StatusPill tone={state.tone} label={state.label} />;
              },
            },
            {
              key: 'change',
              header: 'Change',
              hideHeader: true,
              render: (row) => (
                <a
                  href={`${companyHref(row)}#limits`}
                  className="inline-flex min-h-11 items-center whitespace-nowrap text-sq-body font-medium text-sq-brand underline-offset-2 hover:underline"
                >
                  {canEdit ? 'Change seats' : 'Open'}
                  <span className="sr-only"> for {row.name}</span>
                </a>
              ),
              cellClassName: 'text-right',
            },
          ]}
        />
      </Panel>

      <p className="text-sq-micro text-sq-ink-muted">
        Lowering a seat count never signs anybody out: devices that already hold a seat keep it, and a
        new browser is refused until the company is back under its limit. A seat comes back when a
        device is freed — by the company under Team → Devices, or here on the company&apos;s page — or
        after 14 days unused.
      </p>
    </div>
  );
}
