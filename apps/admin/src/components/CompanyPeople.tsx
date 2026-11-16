'use client';

/**
 * One company's people, as the vendor sees them: its members, the browsers that hold its seats, and
 * who signed in lately.
 *
 * ## Why the vendor needs this
 *
 * The desktop licence server listed every key a company held (machine, user, last authentication) and
 * let the vendor remove one. Without the same here, a customer ringing to say "we are out of seats"
 * could only be told to ask their own administrator — who may be the person on holiday. A seat belongs
 * to a device (DECISIONS D3), so the vendor's "remove key" is "free this device's seat".
 *
 * ## Why freeing a seat asks twice
 *
 * It ends that browser's session on its next request: whoever is using it is signed out mid-quote.
 * The second click names the person and the browser, so the right row is the one freed.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminCompanyPeopleView } from '@sq/contracts';
import { Button, count, DataTable, date, dateTime, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

const ROLE_LABEL: Record<string, string> = {
  company_admin: 'Administrator',
  estimator: 'Estimator',
  viewer: 'Viewer',
};

const STATUS_PILL: Record<string, { tone: 'ok' | 'neutral' | 'attention'; label: string }> = {
  active: { tone: 'ok', label: 'Active' },
  pending: { tone: 'attention', label: 'Invited' },
  removed: { tone: 'neutral', label: 'Removed' },
  suspended: { tone: 'attention', label: 'Suspended' },
};

export function CompanyPeople({
  tenantId,
  view,
  canFreeSeats,
}: {
  tenantId: string;
  view: AdminCompanyPeopleView;
  canFreeSeats: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const free = async (deviceId: string, who: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    const result = await api<{ revoked: string }>(
      `admin/companies/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}`,
      { method: 'DELETE' },
    );
    setBusy(false);
    setConfirming(null);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    setMessage({ tone: 'ok', text: `Freed ${who}'s seat. That browser is signed out on its next request.` });
    router.refresh();
  };

  return (
    <>
      <Panel
        title="Devices"
        description={`${count(view.seatsInUse)} of ${count(view.seats)} seats held. A seat is one browser of one person; it comes back after 14 days unused, or when it is freed here or by the company.`}
        padded={false}
      >
        {message !== null && (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={`px-sq-3 pt-sq-2 text-sq-body ${message.tone === 'danger' ? 'text-sq-danger' : 'text-sq-ink'}`}
          >
            {message.text}
          </p>
        )}
        <DataTable
          rows={view.devices}
          rowKey={(row) => row.id}
          caption="Browsers signed in to this company"
          empty="No browser is signed in to this company."
          height="none"
          columns={[
            {
              key: 'who',
              header: 'Person',
              render: (row) => (
                <>
                  <span className="block font-medium">{row.userDisplayName}</span>
                  <span className="block font-mono text-sq-micro text-sq-ink-muted">{row.username}</span>
                </>
              ),
            },
            { key: 'label', header: 'Browser', render: (row) => row.label },
            {
              key: 'first',
              header: 'First signed in',
              render: (row) => date(row.createdAt),
              cellClassName: 'whitespace-nowrap text-sq-ink-muted',
            },
            {
              key: 'last',
              header: 'Last used',
              render: (row) => dateTime(row.lastSeenAt),
              cellClassName: 'whitespace-nowrap text-sq-ink-muted',
            },
            {
              key: 'seat',
              header: 'Seat',
              render: (row) =>
                row.holdsSeat ? <StatusPill tone="ok" label="Holds a seat" /> : <StatusPill tone="attention" label="Waiting" />,
            },
            ...(canFreeSeats
              ? [
                  {
                    key: 'free',
                    header: 'Free seat',
                    hideHeader: true,
                    cellClassName: 'text-right whitespace-nowrap',
                    render: (row: AdminCompanyPeopleView['devices'][number]) =>
                      confirming === row.id ? (
                        <span className="inline-flex items-center gap-sq-1">
                          <Button
                            variant="destructive"
                            loading={busy}
                            onClick={() => void free(row.id, row.userDisplayName)}
                          >
                            Sign out and free
                          </Button>
                          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button variant="secondary" disabled={busy} onClick={() => setConfirming(row.id)}>
                          Free seat<span className="sr-only"> of {row.userDisplayName}, {row.label}</span>
                        </Button>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      <Panel title="People" description="Everyone with an account in this company." padded={false}>
        <DataTable
          rows={view.members}
          rowKey={(row) => row.userId}
          caption="Members of this company"
          empty="This company has nobody yet."
          height="none"
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (row) => (
                <>
                  <span className="block font-medium">{row.displayName}</span>
                  <span className="block text-sq-micro text-sq-ink-muted">{row.email}</span>
                </>
              ),
            },
            {
              key: 'username',
              header: 'Username',
              render: (row) => row.username,
              cellClassName: 'font-mono text-sq-micro',
            },
            { key: 'role', header: 'Role', render: (row) => ROLE_LABEL[row.role] ?? row.role },
            {
              key: 'status',
              header: 'Status',
              render: (row) => {
                const pill = STATUS_PILL[row.status] ?? { tone: 'neutral' as const, label: row.status };
                return <StatusPill tone={pill.tone} label={pill.label} />;
              },
            },
            {
              key: 'last',
              header: 'Last signed in',
              render: (row) => (row.lastSignInAt === null ? 'Never' : dateTime(row.lastSignInAt)),
              cellClassName: 'whitespace-nowrap text-sq-ink-muted',
            },
          ]}
        />
      </Panel>

      <Panel
        title="Recent sign-ins"
        description="The last 25 sign-ins to this company, newest first."
        padded={false}
      >
        <DataTable
          rows={view.recentSignIns}
          rowKey={(row) => row.id}
          caption="Recent sign-ins to this company"
          empty="Nobody has signed in yet."
          height="none"
          columns={[
            {
              key: 'at',
              header: 'When',
              render: (row) => dateTime(row.at),
              cellClassName: 'whitespace-nowrap text-sq-ink-muted',
            },
            {
              key: 'who',
              header: 'Who',
              render: (row) => (
                <>
                  {row.userDisplayName}{' '}
                  <span className="font-mono text-sq-micro text-sq-ink-muted">{row.username}</span>
                </>
              ),
            },
            { key: 'label', header: 'Browser', render: (row) => row.label },
            {
              key: 'state',
              header: 'Session',
              render: (row) =>
                row.state === 'active' ? <StatusPill tone="ok" label="Open" /> : <StatusPill tone="neutral" label="Ended" />,
            },
          ]}
        />
      </Panel>
    </>
  );
}
