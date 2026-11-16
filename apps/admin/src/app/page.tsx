import type { Metadata } from 'next';
import type { CompanyRow, Page, SessionView } from '@sq/contracts';
import { count, DataTable, date, dateTime, Panel, Stat, StatusPill, type StatusTone } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { companyState } from '@/lib/companyState';
import { ShellFrame } from '@/components/ShellFrame';
import { SignInForm } from '@/components/SignInForm';
import type { Enquiry } from '@/components/EnquiryList';
import type { BookSummary } from '@/components/PriceBookManager';

/**
 * The admin landing route: the sign-in form, or — for platform staff — the overview.
 *
 * ## Why an overview instead of a redirect to the companies
 *
 * Signing in used to land on the company directory, so "is anything wrong today?" meant visiting four
 * screens: companies for seats and end dates, enquiries for who is waiting, price books for which book
 * is live, audit for what changed. This page asks those four once and lists only what needs a person —
 * every row links to the screen that fixes it.
 *
 * ## Why each section depends on a capability
 *
 * Each figure comes from an API route behind its own capability. A support account cannot read price
 * books, so it is not asked for them: a section the role cannot see is left out, never shown as an
 * error the person can do nothing about.
 *
 * The sign-in redirect runs on the server, so a signed-in person never sees the form flash past.
 */

/** Days ahead that an end date counts as "soon". */
const ENDING_SOON_DAYS = 30;
/** An enquiry unanswered for longer than this is a customer kept waiting. */
const ENQUIRY_STALE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

interface AuditRow {
  id: string;
  at: string;
  actorEmail: string;
  action: string;
  summary: string;
}

interface AttentionItem {
  key: string;
  tone: StatusTone;
  label: string;
  text: string;
  href: string;
}

export async function generateMetadata(): Promise<Metadata> {
  const session = await serverFetch<SessionView>('/auth/session');
  // `absolute`, because the layout's "%s · SmartQuote admin" template applies only to child segments,
  // and this page shares the layout's segment.
  return session.ok && session.data.platformRole !== null
    ? { title: { absolute: 'Overview · SmartQuote admin' } }
    : {};
}

function daysBetween(fromIso: string, to: number): number {
  return Math.floor((to - new Date(fromIso).getTime()) / DAY_MS);
}

export default async function AdminHomePage() {
  const session = await serverFetch<SessionView>('/auth/session');

  // Only a platform role sees the overview. A company administrator who happens to hold no platform
  // role would otherwise get a page of sections the API refuses, which reads as broken rather than as
  // "not your screen".
  if (!session.ok || session.data.platformRole === null) {
    return (
      <ShellFrame>
        <div className="mx-auto flex max-w-sm flex-col gap-sq-4 py-sq-8">
          <div>
            <h1 className="text-sq-title font-semibold">Administration</h1>
            <p className="mt-1 text-sq-body text-sq-ink-muted">
              For the vendor&apos;s own staff: the companies, their seats, price books and templates.
            </p>
          </div>
          <SignInForm next="/" />
        </div>
      </ShellFrame>
    );
  }

  const can = (capability: string) => session.data.capabilities.includes(capability);
  const [companies, enquiries, books, audit] = await Promise.all([
    can('platform:companies') ? serverFetch<Page<CompanyRow>>('/admin/companies?limit=200') : null,
    can('platform:enquiries') ? serverFetch<Page<Enquiry>>('/admin/enquiries?limit=200') : null,
    can('platform:pricebooks')
      ? serverFetch<{ books: BookSummary[]; activeHash: string | null }>('/admin/price-books')
      : null,
    can('platform:audit') ? serverFetch<Page<AuditRow>>('/admin/audit?limit=10') : null,
  ]);

  const now = Date.now();
  const attention: AttentionItem[] = [];
  const failed: string[] = [];

  // ── Companies ──
  let companyStats: { active: number; total: number; inUse: number; seats: number } | null = null;
  if (companies !== null) {
    if (!companies.ok) failed.push('companies');
    else {
      const rows = companies.data.items;
      companyStats = {
        active: rows.filter((row) => row.status !== 'suspended').length,
        total: rows.length,
        inUse: rows.reduce((sum, row) => sum + row.seatsInUse, 0),
        seats: rows.reduce((sum, row) => sum + row.seats, 0),
      };
      for (const row of rows) {
        const state = companyState(row, now);
        const href = `/company/${encodeURIComponent(row.id)}`;
        if (state.needsAttention) {
          attention.push({
            key: `company-${row.id}`,
            tone: state.tone,
            label: state.label,
            text:
              state.key === 'full'
                ? `${row.name} has all ${row.seats} seats in use. The next new device is refused.`
                : `${row.name}'s subscription ended ${row.subscriptionEndsAt === null ? '' : date(row.subscriptionEndsAt)}.`,
            href,
          });
        } else if (state.key === 'active' && row.subscriptionEndsAt !== null) {
          const left = -daysBetween(row.subscriptionEndsAt, now);
          if (left <= ENDING_SOON_DAYS) {
            attention.push({
              key: `ending-${row.id}`,
              tone: 'neutral',
              label: 'Ending soon',
              text: `${row.name}'s subscription ends ${date(row.subscriptionEndsAt)} — ${left === 1 ? 'one day' : `${left} days`} from now.`,
              href,
            });
          }
        }
      }
    }
  }

  // ── Enquiries ──
  let openEnquiries: number | null = null;
  if (enquiries !== null) {
    if (!enquiries.ok) failed.push('enquiries');
    else {
      const open = enquiries.data.items.filter((row) => !row.handled);
      openEnquiries = open.length;
      const stale = open.filter((row) => daysBetween(row.createdAt, now) > ENQUIRY_STALE_DAYS);
      if (stale.length > 0) {
        const oldest = Math.max(...stale.map((row) => daysBetween(row.createdAt, now)));
        attention.push({
          key: 'enquiries-stale',
          tone: 'attention',
          label: 'Waiting',
          text: `${stale.length === 1 ? 'One enquiry has' : `${stale.length} enquiries have`} waited more than ${ENQUIRY_STALE_DAYS} days for a reply — the oldest ${oldest} days.`,
          href: '/enquiries',
        });
      }
    }
  }

  // ── Price book ──
  let activeBook: BookSummary | null | undefined;
  if (books !== null) {
    if (!books.ok) failed.push('price books');
    else {
      activeBook = books.data.books.find((book) => book.hash === books.data.activeHash) ?? null;
      if (activeBook === null) {
        attention.push({
          key: 'no-book',
          tone: 'danger',
          label: 'No price book',
          text: 'No price book is active, so no quote can be priced.',
          href: '/price-books',
        });
      }
    }
  }

  if (audit !== null && !audit.ok) failed.push('audit');

  // Most severe first, so the top of the list is the thing to do first.
  const severity: Record<StatusTone, number> = { danger: 0, attention: 1, info: 2, neutral: 3, ok: 4 };
  attention.sort((a, b) => severity[a.tone] - severity[b.tone]);

  return (
    <ShellFrame session={session.data} current="/">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Overview</h1>
          <p className="text-sq-body text-sq-ink-muted">What needs attention on this installation today.</p>
        </div>

        {failed.length > 0 && (
          <p role="alert" className="text-sq-body text-sq-danger">
            Could not load the {failed.join(', ')}. The figures below leave {failed.length === 1 ? 'it' : 'them'} out.
          </p>
        )}

        <Panel>
          <div className="grid gap-sq-4 sm:grid-cols-2 lg:grid-cols-4">
            {companyStats !== null && (
              <>
                <Stat
                  label="Active companies"
                  value={count(companyStats.active)}
                  hint={`of ${companyStats.total} on this installation`}
                />
                <Stat
                  label="Seats in use"
                  value={`${count(companyStats.inUse)} / ${count(companyStats.seats)}`}
                  hint="Devices holding a seat, across every company"
                />
              </>
            )}
            {openEnquiries !== null && (
              <Stat
                label="Open enquiries"
                value={count(openEnquiries)}
                hint={openEnquiries === 0 ? 'Nobody is waiting' : 'Not yet marked handled'}
                tone={openEnquiries > 0 ? 'attention' : 'neutral'}
              />
            )}
            {activeBook !== undefined && (
              <Stat
                label="Active price book"
                value={
                  activeBook === null ? 'None' : <span className="font-mono">{activeBook.hash.slice(0, 8)}</span>
                }
                hint={
                  activeBook === null
                    ? 'Quotes cannot be priced'
                    : `${activeBook.kind === 'licensed' ? 'Licensed' : 'Sample'}${
                        activeBook.publishedAt === null ? '' : `, published ${date(activeBook.publishedAt)}`
                      }`
                }
                tone={activeBook === null ? 'danger' : 'neutral'}
              />
            )}
          </div>
        </Panel>

        <Panel
          title="Needs attention"
          description={
            attention.length === 0
              ? undefined
              : `Seats full, subscriptions ended or ending within ${ENDING_SOON_DAYS} days, enquiries left waiting.`
          }
        >
          {attention.length === 0 ? (
            <p className="text-sq-body text-sq-ink-muted">
              Nothing. No company is out of seats or near its end date, and no enquiry is waiting.
            </p>
          ) : (
            <ul className="-my-sq-1 divide-y divide-sq-line">
              {attention.map((item) => (
                <li key={item.key}>
                  <a
                    href={item.href}
                    className="flex min-h-11 items-center gap-sq-3 py-sq-1 text-sq-body text-sq-ink no-underline hover:bg-sq-ground/60"
                  >
                    <span className="w-36 shrink-0">
                      <StatusPill tone={item.tone} label={item.label} />
                    </span>
                    <span className="min-w-0 flex-1">{item.text}</span>
                    <span aria-hidden="true" className="text-sq-ink-muted">
                      ›
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {audit !== null && audit.ok && (
          <Panel
            title="Recent changes"
            padded={false}
            actions={
              <a href="/audit" className="text-sq-body font-medium text-sq-brand no-underline hover:underline">
                The whole audit ›
              </a>
            }
          >
            <DataTable
              rows={audit.data.items}
              rowKey={(row) => row.id}
              caption="The ten most recent audited changes"
              empty="Nothing has been changed yet."
              height="none"
              columns={[
                {
                  key: 'at',
                  header: 'When',
                  render: (row) => dateTime(row.at),
                  cellClassName: 'whitespace-nowrap text-sq-ink-muted',
                },
                { key: 'who', header: 'Who', render: (row) => row.actorEmail, cellClassName: 'max-w-48 truncate' },
                { key: 'what', header: 'What', render: (row) => row.summary || row.action },
              ]}
            />
          </Panel>
        )}
      </div>
    </ShellFrame>
  );
}
