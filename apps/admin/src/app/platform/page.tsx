import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { PlatformPage } from '@/components/PlatformPage';

/**
 * Usage, releases and the template catalogue.
 *
 * One page rather than three: they answer the same question — how is this deployment doing, and what
 * is in it — and a vendor on a support call wants them together. Each section degrades on its own, so
 * a role without one capability still sees the rest.
 */

interface UsageRow {
  kind: string;
  total: number;
  last7: number;
  last30: number;
}

interface ReleaseRow {
  id: string;
  label: string;
  engineVersion: number;
  priceBookHash: string | null;
  note: string;
  current: boolean;
  createdAt: string;
  createdBy: string | null;
}

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  status: string;
  typeName: string;
  cloneCount: number;
  hasConfig: boolean;
  updatedAt: string;
}

export default async function PlatformRoute() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  // Each section is fetched independently: a role that may read usage but not publish releases should
  // still see the usage numbers rather than an error page.
  const [usage, releases, templates, companies] = await Promise.all([
    /*
     * `summary`, not `items` — the route answers `{ scope, summary, recent }` and this read
     * `.items`, which is `undefined`. The page then called `usage.length` and crashed with
     * "Cannot read properties of undefined (reading 'length')" for **every** platform admin,
     * because no platform role could reach the usage panel anyway: `/admin/usage` asks for
     * `platform:audit` and `platform_admin` holds it, so the answer was a 200 with no `items`.
     * Found in a browser on 2026-11-06; the type annotation said `items` and nothing checked it.
     */
    serverFetch<{ scope: string; summary: UsageRow[] }>('/admin/usage'),
    serverFetch<{ items: ReleaseRow[] }>('/admin/releases'),
    serverFetch<{ items: TemplateRow[] }>('/admin/templates'),
    // A template belongs to one company, so the author form has to be able to name it.
    serverFetch<{ items: { id: string; name: string; code: string | null }[] }>('/admin/companies'),
  ]);

  const forbidden = [usage, releases, templates].every((result) => !result.ok && result.code === 'forbidden');
  if (forbidden) {
    return (
      <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/platform">
        <Panel title="Not available to your role">
          <p className="text-sq-body text-sq-ink-muted">
            Usage, releases and templates need a platform role with audit or template access.
          </p>
        </Panel>
      </ShellFrame>
    );
  }

  return (
    <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/platform">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Usage and releases</h1>
          <p className="text-sq-body text-sq-ink-muted">
            How the product is being used, what this deployment is running, and the buildings a company
            can start from.
          </p>
        </div>

        <PlatformPage
          usage={usage.ok ? usage.data.summary : []}
          releases={releases.ok ? releases.data.items : []}
          templates={templates.ok ? templates.data.items : []}
          companies={companies.ok ? companies.data.items : []}
        />
      </div>
    </ShellFrame>
  );
}
