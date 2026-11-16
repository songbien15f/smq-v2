import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Page, SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { AuditLog, type AuditRow } from '@/components/AuditLog';

export const metadata: Metadata = { title: 'Audit' };

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

const LIMIT = 200;

export default async function AuditPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const audit = await serverFetch<Page<AuditRow>>(`/admin/audit?limit=${LIMIT}`);

  return (
    <ShellFrame session={session.data} current="/audit">
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
          <Panel padded={false}>
            <AuditLog rows={audit.data.items} limit={LIMIT} />
          </Panel>
        )}
      </div>
    </ShellFrame>
  );
}
