'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import type {
  GuestAccountRequestView,
  GuestAccountRequestsResponse,
  GuestBuildingTypesResponse,
  GuestDraftView,
  GuestDraftsResponse,
  GuestRequestPublicStatus,
} from '@sq/contracts';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import {
  accountGet,
  changePassword,
  deleteDraft,
  openOnQuotePage,
  updateProfile,
  useGuestAccount,
} from '../account';
import { guestApi } from '../api';
import { nationalMobile } from '../store';
import { AccountDialog } from './AccountDialog';
import { GuestHeader } from './GuestHeader';

type Tab = 'details' | 'requests' | 'drafts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'My details' },
  { id: 'requests', label: 'Sent requests' },
  { id: 'drafts', label: 'Unfinished designs' },
];

const STATUS_LABEL: Record<GuestRequestPublicStatus, string> = {
  received: 'Received',
  being_quoted: 'Being quoted',
  closed: 'Closed',
};

const metres = (mm: number) => `${(mm / 1000).toLocaleString('en-AU', { maximumFractionDigits: 2 })} m`;
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

function sizeOf(design: GuestAccountRequestView['design']): string {
  const b = design.building;
  return `${metres(b.span)} × ${metres(b.bayWidths.reduce((sum, w) => sum + w, 0))} × ${metres(b.height)} high`;
}

/**
 * The profile: details that fill step ①, the requests sent while signed in, and unfinished designs.
 * Signed out, it offers the sign-in dialog and a way back to the quote page — no account is needed
 * to ask for a quote.
 */
export function AccountPage() {
  const status = useGuestAccount((s) => s.status);
  const [tab, setTab] = useState<Tab>('details');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [types, setTypes] = useState<readonly GuestBuildingTypeSpec[] | null>(null);

  useEffect(() => {
    void guestApi<GuestBuildingTypesResponse>('public/guest/building-types').then((r) => {
      if (r.ok) setTypes(r.data.types);
    });
  }, []);

  return (
    <>
      <GuestHeader />
      <main className="g-main">
        <div className="g-container g-account-page">
          <p>
            <a className="g-link-btn" href="/quote">
              ← Back to your quote
            </a>
          </p>
          <h1 className="g-panel-title">Your account</h1>

          {status === 'unknown' ? (
            <p className="g-hint">Loading…</p>
          ) : status === 'signed-out' ? (
            <section className="g-card">
              <p>Sign in to see your details, the requests you sent and your unfinished designs.</p>
              <p className="g-hint">You don&apos;t need an account to ask for a quote.</p>
              <div className="g-dialog-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
                <button type="button" className="g-btn g-btn-outline" onClick={() => setDialogOpen(true)}>
                  Sign in or create an account
                </button>
              </div>
              <AccountDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
            </section>
          ) : (
            <>
              <div className="g-account-tabs" role="tablist" aria-label="Your account">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    id={`g-acct-tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    aria-controls={`g-acct-panel-${t.id}`}
                    className="g-account-tab"
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <section id={`g-acct-panel-${tab}`} role="tabpanel" aria-labelledby={`g-acct-tab-${tab}`}>
                {tab === 'details' ? <DetailsTab /> : tab === 'requests' ? <RequestsTab types={types} /> : <DraftsTab types={types} />}
              </section>
            </>
          )}
        </div>
      </main>
    </>
  );
}

// ---------------------------------------------------------------- My details

function DetailsTab() {
  const profile = useGuestAccount((s) => s.profile);
  const id = useId();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (profile === null) return null;

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const result = await updateProfile({
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      mobile: String(form.get('mobile') ?? ''),
    });
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: 'Saved. New quotes start with these details.' } : { ok: false, text: result.message });
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    const result = await changePassword({
      current: String(form.get('current') ?? ''),
      next: String(form.get('next') ?? ''),
    });
    setBusy(false);
    if (result.ok) formEl.reset();
    setPwMessage(
      result.ok
        ? { ok: true, text: 'Password changed. Other devices have been signed out.' }
        : { ok: false, text: result.message },
    );
  };

  const input = (name: string, label: string, value: string, extra: object = {}) => (
    <div className="g-field">
      <label className="g-label" htmlFor={`${id}-${name}`}>
        {label}
      </label>
      <input id={`${id}-${name}`} name={name} defaultValue={value} className="g-input" required {...extra} />
    </div>
  );

  return (
    <div className="g-account-sections">
      <form className="g-card g-account-form" onSubmit={(e) => void saveDetails(e)}>
        <h2 className="g-card-title">Contact details</h2>
        <p className="g-hint">These fill step ① of a new quote. You can still change them there before you send.</p>
        <div className="g-account-row">
          {input('firstName', 'First name', profile.firstName, { autoComplete: 'given-name', maxLength: 60 })}
          {input('lastName', 'Last name', profile.lastName, { autoComplete: 'family-name', maxLength: 60 })}
        </div>
        {input('mobile', 'Mobile', nationalMobile(profile.mobile), { type: 'tel', autoComplete: 'tel', maxLength: 30 })}
        <div className="g-field">
          <label className="g-label" htmlFor={`${id}-email`}>
            Email
          </label>
          <input id={`${id}-email`} className="g-input" value={profile.email} readOnly aria-describedby={`${id}-email-hint`} />
          <p id={`${id}-email-hint`} className="g-hint">
            Your sign-in. It can&apos;t be changed here.
          </p>
        </div>
        {message === null ? null : (
          <p className={message.ok ? 'g-account-saved' : 'g-field-error'} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </p>
        )}
        <div className="g-dialog-actions">
          <button type="submit" className="g-btn g-btn-outline" disabled={busy}>
            Save details
          </button>
        </div>
      </form>

      <form className="g-card g-account-form" onSubmit={(e) => void savePassword(e)}>
        <h2 className="g-card-title">Change password</h2>
        {input('current', 'Current password', '', { type: 'password', autoComplete: 'current-password', maxLength: 200 })}
        {input('next', 'New password', '', { type: 'password', autoComplete: 'new-password', minLength: 8, maxLength: 200 })}
        <p className="g-hint">At least 8 characters.</p>
        {pwMessage === null ? null : (
          <p className={pwMessage.ok ? 'g-account-saved' : 'g-field-error'} role={pwMessage.ok ? 'status' : 'alert'}>
            {pwMessage.text}
          </p>
        )}
        <div className="g-dialog-actions">
          <button type="submit" className="g-btn g-btn-outline" disabled={busy}>
            Change password
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- lists

function useAccountList<T>(path: string) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; items: T[] } | { status: 'failed'; message: string }>({
    status: 'loading',
  });
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const result = await accountGet<{ items: T[] }>(path);
    setState(result.ok ? { status: 'ready', items: result.data.items } : { status: 'failed', message: result.message });
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { state, reload: load, setState };
}

function ListState({ status, message, onRetry }: { status: 'loading' | 'failed'; message?: string; onRetry: () => void }) {
  if (status === 'loading') return <p className="g-hint">Loading…</p>;
  return (
    <p className="g-notice" role="alert">
      {message}{' '}
      <button type="button" className="g-link-btn" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

function typeName(types: readonly GuestBuildingTypeSpec[] | null, typeId: string): string {
  return types?.find((t) => t.id === typeId)?.name ?? 'Building';
}

function RequestsTab({ types }: { types: readonly GuestBuildingTypeSpec[] | null }) {
  const { state, reload } = useAccountList<GuestAccountRequestView>('requests');
  if (state.status !== 'ready') return <ListState status={state.status} message={state.status === 'failed' ? state.message : undefined} onRetry={() => void reload()} />;
  if (state.items.length === 0) {
    return (
      <p className="g-hint">
        No requests yet. Requests you send while signed in appear here. (Requests sent without signing in are not
        added to an account.)
      </p>
    );
  }
  return (
    <ul className="g-recent-list g-card">
      {state.items.map((r) => {
        const available = types?.some((t) => t.id === r.design.typeId) ?? false;
        return (
          <li key={r.number} className="g-recent-row">
            <div className="g-recent-text">
              <span className="g-recent-number">{r.number}</span>
              <span>
                {typeName(types, r.design.typeId)} · {sizeOf(r.design)}
              </span>
              <span className="g-recent-meta">
                {r.design.site === undefined ? '' : `${r.design.site.suburb} ${r.design.site.state} · `}Sent {dateOf(r.createdAt)} ·{' '}
                {STATUS_LABEL[r.status]}
              </span>
            </div>
            <div className="g-recent-actions">
              {available ? (
                <button
                  type="button"
                  className="g-link-btn"
                  onClick={() => openOnQuotePage({ kind: 'sent', number: r.number, design: r.design as GuestDesignInput })}
                >
                  Open<span className="g-sr-only"> request {r.number}</span>
                </button>
              ) : (
                <span className="g-recent-meta">{types === null ? '' : 'No longer available'}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DraftsTab({ types }: { types: readonly GuestBuildingTypeSpec[] | null }) {
  const { state, reload, setState } = useAccountList<GuestDraftView>('drafts');
  const [error, setError] = useState<string | null>(null);
  if (state.status !== 'ready') return <ListState status={state.status} message={state.status === 'failed' ? state.message : undefined} onRetry={() => void reload()} />;
  if (state.items.length === 0) {
    return <p className="g-hint">No unfinished designs. While you are signed in, a design you have not sent is saved here.</p>;
  }

  const remove = async (draft: GuestDraftView) => {
    setError(null);
    const result = await deleteDraft(draft.id);
    if (result.ok) setState({ status: 'ready', items: state.items.filter((d) => d.id !== draft.id) });
    else setError(result.message);
  };

  return (
    <>
      {error === null ? null : (
        <p className="g-field-error" role="alert">
          {error}
        </p>
      )}
      <ul className="g-recent-list g-card">
        {state.items.map((d) => {
          const available = types?.some((t) => t.id === d.design.typeId) ?? false;
          const label = `${typeName(types, d.design.typeId)} · ${sizeOf(d.design)}`;
          return (
            <li key={d.id} className="g-recent-row">
              <div className="g-recent-text">
                <span>{label}</span>
                <span className="g-recent-meta">
                  {d.design.site === undefined ? '' : `${d.design.site.suburb} ${d.design.site.state} · `}Saved {dateOf(d.updatedAt)}
                  {d.revisionOf === null ? '' : ` · Revision of ${d.revisionOf}`}
                </span>
              </div>
              <div className="g-recent-actions">
                {available ? (
                  <button type="button" className="g-link-btn" onClick={() => openOnQuotePage({ kind: 'draft', draft: d })}>
                    Continue<span className="g-sr-only"> {label}</span>
                  </button>
                ) : (
                  <span className="g-recent-meta">{types === null ? '' : 'No longer available'}</span>
                )}
                <button type="button" className="g-link-btn" onClick={() => void remove(d)}>
                  Delete<span className="g-sr-only"> {label}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
