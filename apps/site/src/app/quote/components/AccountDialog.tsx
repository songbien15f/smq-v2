'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { signIn, signUp } from '../account';

export type AccountTab = 'sign-in' | 'sign-up';

/**
 * Sign in / Create account (spec docs/specs/guest-accounts.md "Đăng nhập"). A native `<dialog>`
 * like Start over's, so focus is trapped and Esc closes it. An account is optional: the page says
 * so, and closing the dialog leaves the guest exactly where they were.
 */
export function AccountDialog({
  open,
  tab: initialTab = 'sign-in',
  onClose,
}: {
  open: boolean;
  tab?: AccountTab;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (open && !d.open) {
      setTab(initialTab);
      setError(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, initialTab]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    setBusy(true);
    setError(null);
    const result =
      tab === 'sign-in'
        ? await signIn({ email: value('email'), password: value('password') })
        : await signUp({
            firstName: value('firstName'),
            lastName: value('lastName'),
            email: value('email'),
            mobile: value('mobile'),
            password: value('password'),
          });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.message);
  };

  const field = (name: string, label: string, type: string, autoComplete: string, extra: object = {}) => (
    <div className="g-field">
      <label className="g-label" htmlFor={`${id}-${name}`}>
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        className="g-input"
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? undefined : `${id}-error`}
        {...extra}
      />
    </div>
  );

  return (
    <dialog ref={dialog} className="g-dialog g-account-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
      <h2 id={`${id}-title`}>{tab === 'sign-in' ? 'Sign in' : 'Create an account'}</h2>
      <p>
        Optional — you can still send a request without one. An account keeps your details, your sent
        requests and unfinished designs.
      </p>
      <div className="g-account-tabs" role="tablist" aria-label="Account">
        {(['sign-in', 'sign-up'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="g-account-tab"
            onClick={() => {
              setTab(t);
              setError(null);
            }}
          >
            {t === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <form key={tab} className="g-account-form" onSubmit={(e) => void submit(e)} noValidate={false}>
        {tab === 'sign-up' ? (
          <div className="g-account-row">
            {field('firstName', 'First name', 'text', 'given-name', { maxLength: 60 })}
            {field('lastName', 'Last name', 'text', 'family-name', { maxLength: 60 })}
          </div>
        ) : null}
        {field('email', 'Email', 'email', 'email', { maxLength: 254 })}
        {tab === 'sign-up'
          ? field('mobile', 'Mobile', 'tel', 'tel', { maxLength: 30, placeholder: '0412 345 678', inputMode: 'tel' })
          : null}
        {field('password', 'Password', 'password', tab === 'sign-in' ? 'current-password' : 'new-password', {
          minLength: tab === 'sign-up' ? 8 : undefined,
          maxLength: 200,
        })}
        {tab === 'sign-up' ? <p className="g-hint">At least 8 characters.</p> : null}
        {error === null ? null : (
          <p id={`${id}-error`} className="g-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="g-dialog-actions">
          <button type="button" className="g-btn g-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="g-btn g-btn-outline" disabled={busy}>
            {busy ? 'Please wait…' : tab === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
