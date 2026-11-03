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
 * ## Inviting is a mail
 *
 * Adding a person creates a `pending` membership and sends a link that activates it. The person
 * cannot sign in and holds no seat until they accept, so the roster stays honest about who can
 * actually reach the company.
 */

import { useEffect, useState } from 'react';
import { Button, Field, Panel, StatusPill } from '@sq/ui';
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

  /** The invite form, folded away until asked for — it is not the reason anyone opens this page. */
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({
    email: '',
    displayName: '',
    username: '',
    role: 'estimator',
  });
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});

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

  const inviteMember = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setInviteErrors({});

    const result = await api<{ invited: boolean }>('team/invite', {
      method: 'POST',
      body: invite,
    });
    setBusy(false);

    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      const details: Record<string, string> = {};
      for (const detail of result.details ?? []) details[detail.path] = detail.message;
      setInviteErrors(details);
      return;
    }

    setMessage({
      tone: 'ok',
      text: `Invited ${invite.email}. They have a link that expires in seven days.`,
    });
    setInvite({ email: '', displayName: '', username: '', role: 'estimator' });
    setInviting(false);
    await load();
  };

  const resetMember = async (email: string): Promise<void> => {
    setMessage(null);
    const result = await api<{ sent: true }>(`team/${encodeURIComponent(email)}/reset`, {
      method: 'POST',
    });
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    setMessage({ tone: 'ok', text: `A reset link was sent to ${email}.` });
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

      {canManage && (
        <Panel
          title="Add a person"
          description="They get a link to choose a password. Until they accept, they cannot sign in and hold no seat."
          actions={
            !inviting ? (
              <Button variant="primary" onClick={() => setInviting(true)}>
                Invite
              </Button>
            ) : undefined
          }
        >
          {!inviting ? (
            <p className="text-sq-body text-sq-ink-muted">
              Use Invite to add somebody to this company. They will be able to sign in with the
              company code, the username you choose, and the password they set.
            </p>
          ) : (
            <form onSubmit={(event) => void inviteMember(event)} className="flex flex-col gap-sq-3" noValidate>
              <Field
                id="inviteEmail"
                label="Email"
                type="email"
                required
                value={invite.email}
                onChange={(event) => setInvite({ ...invite, email: event.target.value })}
                error={inviteErrors.email}
              />
              <Field
                id="inviteDisplayName"
                label="Name"
                required
                value={invite.displayName}
                onChange={(event) => setInvite({ ...invite, displayName: event.target.value })}
                error={inviteErrors.displayName}
              />
              <Field
                id="inviteUsername"
                label="Username"
                required
                hint="What they type at sign-in. Unique inside this company."
                autoCapitalize="none"
                spellCheck={false}
                value={invite.username}
                onChange={(event) => setInvite({ ...invite, username: event.target.value })}
                error={inviteErrors.username}
              />
              <label className="flex flex-col gap-sq-1">
                <span className="text-sq-micro font-medium text-sq-ink">Role</span>
                <select
                  value={invite.role}
                  onChange={(event) => setInvite({ ...invite, role: event.target.value })}
                  className="min-h-11 cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
                >
                  {Object.entries(ROLE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="text-sq-micro text-sq-ink-muted">{ROLE_HINT[invite.role]}</span>
              </label>

              <div className="flex gap-sq-2">
                <Button type="submit" variant="primary" loading={busy}>
                  Send the invitation
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setInviting(false);
                    setInvite({ email: '', displayName: '', username: '', role: 'estimator' });
                    setInviteErrors({});
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </Panel>
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
                    <div className="flex flex-wrap gap-sq-1">
                      <Button
                        variant="ghost"
                        onClick={() => void resetMember(member.email)}
                        aria-label={`Send ${member.displayName} a reset link`}
                      >
                        Reset password
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void remove(member.email)}
                        aria-label={`Remove ${member.displayName}`}
                        className="text-sq-danger hover:bg-sq-danger/10"
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <p className="text-sq-micro text-sq-ink-muted">
        An invitation is a link that expires in seven days. A reset link expires in an hour and ends
        every session that account already had.
      </p>
    </div>
  );
}