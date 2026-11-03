import { redirect } from 'next/navigation';
import type { Page, SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';

/**
 * The audit log.
 *
 * Every write in this product records one row: a suspension, a settings version, a status change, a
 * price publication. The route existed and nothing read it, which made the log a claim rather than
 * a record — "we audit everything" is only true if somebody can look.
 *
 * Read-only by construction: the table has no update or delete path, so there is nothing to offer
 * here but the rows.
 */

interface AuditRow {
  id: string;
  at: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}

function when(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return parsed.toISOString().slice(0, 16).replace('T', ' ');
}

export default async function AuditPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const audit = await serverFetch<Page<AuditRow>>('/admin/audit?limit=200');

  return (
    <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/audit">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Audit log</h1>
          <p className="text-sq-body text-sq-ink-muted">
            Every change, newest first. These rows cannot be edited or deleted.
          </p>
        </div>

        {!audit.ok ? (
          <Panel title="Could not load the audit log">
            <p className="text-sq-body text-sq-danger">
              {audit.code === 'forbidden' ? 'Your role cannot read the audit log.' : audit.message}
            </p>
          </Panel>
        ) : audit.data.items.length === 0 ? (
          <Panel title="Nothing recorded yet">
            <p className="text-sq-body text-sq-ink-muted">
              A change made through this product will appear here.
            </p>
          </Panel>
        ) : (
          <Panel title={`${audit.data.items.length} entries`} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sq-body">
                <thead>
                  <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">When</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">Who</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">Action</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-medium">What</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.items.map((row) => (
                    <tr key={row.id} className="border-b border-sq-line last:border-0">
                      <td className="px-sq-3 py-sq-2 text-sq-ink-muted">{when(row.at)}</td>
                      <td className="px-sq-3 py-sq-2">{row.actorEmail}</td>
                      <td className="sq-numeric px-sq-3 py-sq-2 text-sq-ink-muted">{row.action}</td>
                      <td className="px-sq-3 py-sq-2">
                        {row.summary}
                        <span className="block text-sq-micro text-sq-ink-muted">
                          {row.targetType} · {row.targetId.slice(0, 12)}…
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </ShellFrame>
  );
}
