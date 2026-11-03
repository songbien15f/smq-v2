'use client';

/**
 * The team: who is in the company, what they may do, and who currently holds a seat.
 *
 * ## Two things this screen is honest about
 *
 * 1. **A seat is a live session, not a person.** One person signed in on a laptop and a phone holds
 *    two seats, and an operator who does not know that will read the count as wrong. So the seat
 *    column says "in the workspace now", not "enabled", and the header says what the number means.
 * 2. **Your own role cannot leave the company unadministrable.** A change that would remove the last
 *    administrator is refused by the API, and this screen shows why rather than failing silently.
 *
 * Nobody is invited from here yet: an invitation needs a mail the product can send, and it can now,
 * so the button is where the next slice plugs in rather than a dead control today.
 */

import { useEffect, useState } from 'react';
import { Button, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/sq';

interface Member {
  id: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  company_admin: 'Company administrator',
  estimator: 'Estimator',
  viewer: 'Viewer',
};

const ROLE_HINT: Record<string, string> = {
  company_admin: 'Everything: quotes, prices, people and settings.',
  estimator: 'Writes and sends quotes, manages prices. Cannot change people or the company.',
  viewer: 'Reads quotes only — no cost, no margin, no internal materials list.',
};

export function TeamPage({ canManage }: { canManage: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const load = async (): Promise<void> => {
    const result = await api<{ items: Member[] }>('team');
    if (result.ok) setMembers(result.data.items);
    else setMessage({ tone: 'danger', text: result.message });
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const changeRole = async (email: string, role: string): Promise<void> => {
    setMessage(null);
    const result = await api(`team/${encodeURIComponent(email)}/role`, {
      method: 'PATCH',
      body: { role },
    });
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    setMessage({ tone: 'ok', text: `${email} is now a ${ROLE_LABEL[role] ?? role}.` });
    await load();
  };

  const remove = async (email: string): Promise<void> => {
    setMessage(null);
    const result = await api(`team/${encodeURIComponent(email)}`, { method: 'DELETE' });
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    setMessage({ tone: 'ok', text: `${email} has been removed and their sessions ended.` });
    await load();
  };

  if (loading) return <p className="text-sq-body text-sq-ink-muted">Loading the team…</p>;

  return (
    <div className="flex flex-col gap-sq-4">
      {message !== null && (
        <p
          role={message.tone === 'danger' ? 'alert' : 'status'}
          className={[
            'rounded-md border p-sq-2 text-sq-body',
            message.tone === 'danger'
              ? 'border-sq-danger/30 bg-sq-danger/10 text-sq-danger'
              : 'border-sq-ok/30 bg-sq-ok/10 text-sq-ok',
          ].join(' ')}
        >
          {message.text}
        </p>
      )}

      <Panel
        title="People"
        description="A seat is a live session, so one person on two devices holds two of them."
        padded={false}
      >
        <table className="w-full border-collapse text-sq-body">
          <thead>
            <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
              <th scope="col" className="px-sq-3 py-sq-2 font-medium">Person</th>
              <th scope="col" className="px-sq-2 py-sq-2 font-medium">Role</th>
              <th scope="col" className="px-sq-2 py-sq-2 font-medium">In the workspace now</th>
              {canManage && <th scope="col" className="px-sq-2 py-sq-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="border-b border-sq-line last:border-0">
                <td className="px-sq-3 py-sq-2">
                  <span className="font-medium text-sq-ink">{member.displayName}</span>
                  <span className="block text-sq-micro text-sq-ink-muted">{member.email}</span>
                </td>
                <td className="px-sq-2 py-sq-2">
                  {canManage ? (
                    <label className="flex flex-col gap-sq-1">
                      <span className="sr-only">Role for {member.displayName}</span>
                      <select
                        value={member.role}
                        onChange={(event) => void changeRole(member.email, event.target.value)}
                        className="min-h-11 cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
                      >
                        {Object.entries(ROLE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <span className="text-sq-micro text-sq-ink-muted">{ROLE_HINT[member.role]}</span>
                    </label>
                  ) : (
                    <StatusPill tone="neutral" label={ROLE_LABEL[member.role] ?? member.role} />
                  )}
                </td>
                <td className="px-sq-2 py-sq-2">
                  {member.active ? (
                    <StatusPill tone="ok" label="holding a seat" />
                  ) : (
                    <StatusPill tone="neutral" label="signed out" />
                  )}
                </td>
                {canManage && (
                  <td className="px-sq-2 py-sq-2">
                    <Button
                      variant="ghost"
                      onClick={() => void remove(member.email)}
                      aria-label={`Remove ${member.displayName}`}
                      className="text-sq-danger hover:bg-sq-danger/10"
                    >
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <p className="text-sq-micro text-sq-ink-muted">
        Inviting somebody from this screen needs an invitation email, which is the next piece of work.
        Until then a person is added by the installer or by the administrator running the deployment.
      </p>
    </div>
  );
}