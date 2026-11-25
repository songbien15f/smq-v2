'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { guestContactSchema, type GuestRequestAccepted, type GuestRequestBody } from '@sq/contracts';
import { formatAuMobile, mobileE164 } from '../mobile';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import { guestApi } from '../api';
import { GUEST_CONTENT } from '../content';
import { cancelDraftSave } from '../account';
import { editAt, goTo, keepDesigning, markSent, startOver, updateContact, useGuest, type ContactDraft } from '../store';
import { recordSent } from '../sentHistory';
import { addressLines, missingSteps, summaryRows, type MissingStep } from '../summary';
import { STEP_LABELS } from './StepTabs';
import { IconCheck } from './icons';

type Field = 'firstName' | 'lastName' | 'mobile' | 'email' | 'consent';
const FIELDS: readonly Field[] = ['firstName', 'lastName', 'mobile', 'email', 'consent'];
const FIELD_ID: Record<Field, string> = {
  firstName: 'g-first-name',
  lastName: 'g-last-name',
  mobile: 'g-mobile',
  email: 'g-email',
  consent: 'g-send-consent',
};
const REQUEST_ID = 'g-additional-request';
/** The API caps the free text at 4000; the revision line goes in front of what the guest typed. */
const REQUEST_MAX = 3900;

function fieldError(field: Field, c: ContactDraft): string | null {
  switch (field) {
    case 'firstName':
      return c.firstName.trim() === '' ? 'Enter your first name' : null;
    case 'lastName':
      return c.lastName.trim() === '' ? 'Enter your last name' : null;
    case 'mobile':
      if (c.mobile.trim() === '') return 'Enter your mobile number';
      return mobileE164(c.mobile) === null ? 'Enter an Australian mobile, e.g. 0412 345 678' : null;
    case 'email':
      if (c.email.trim() === '') return 'Enter your email address';
      return guestContactSchema.shape.email.safeParse(c.email.trim()).success
        ? null
        : 'Enter an email address like name@example.com';
    case 'consent':
      return c.consent ? null : 'Tick the box so we can contact you about this quote';
  }
}

function allErrors(c: ContactDraft): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (const f of FIELDS) {
    const e = fieldError(f, c);
    if (e !== null) out[f] = e;
  }
  return out;
}

type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'failed'; message: string; designProblem: boolean };

/**
 * Step ③ (plan G-a2 S6): what is being sent, what happens next, the consent box and the button.
 *
 * The contact form has moved to ① (Q2), so this panel shows the details **read-only** with an Edit
 * link that takes the guest back to ① and focuses the field. The free-text request is edited here as
 * well as at ① — one state, two views (Q2).
 *
 * The page never shows or asks for a price (D-T3): the answer to a request is its number.
 */
export function SendPanel({ type }: { type: GuestBuildingTypeSpec | undefined }) {
  const design = useGuest((s) => s.design);
  const sent = useGuest((s) => s.sent);
  if (design === null) return null;
  return sent === null ? <SendForm design={design} type={type} /> : <Confirmation number={sent.number} type={type} />;
}

function SendForm({ design, type }: { design: GuestDesignInput; type: GuestBuildingTypeSpec | undefined }) {
  const contact = useGuest((s) => s.contact);
  const source = useGuest((s) => s.source);
  const revisionOf = useGuest((s) => s.revisionOf);
  const draftId = useGuest((s) => s.draftId);
  const [submitted, setSubmitted] = useState(false);
  const [send, setSend] = useState<SendState>({ status: 'idle' });
  const [server, setServer] = useState<Partial<Record<Field, string>>>({});
  const errorRef = useRef<HTMLDivElement>(null);

  const missing = missingSteps(design, type, contact);
  const errors = allErrors(contact);
  const shown = (f: Field): string | undefined => server[f] ?? (submitted ? errors[f] : undefined);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (send.status === 'sending') return;
    // A step still missing something: Send takes the guest there.
    if (missing.length > 0) {
      goTo(missing[0]!.step, type);
      return;
    }
    setSubmitted(true);
    setServer({});
    if (Object.keys(errors).length > 0) {
      setSend({ status: 'idle' });
      setTimeout(() => errorRef.current?.focus(), 0);
      return;
    }
    const mobile = mobileE164(contact.mobile);
    if (mobile === null || design.site === undefined) return;

    const typed = contact.additionalRequest.trim();
    const request =
      revisionOf === null ? typed : `Revised design of ${revisionOf}.${typed === '' ? '' : `\n\n${typed}`}`;
    const body: GuestRequestBody = {
      design: { ...design, site: design.site },
      contact: {
        firstName: contact.firstName.trim(),
        lastName: contact.lastName.trim(),
        email: contact.email.trim(),
        mobile,
      },
      consent: true,
      ...(request === '' ? {} : { additionalRequest: request }),
      ...(Object.keys(source).length === 0 ? {} : { source }),
      ...(contact.website === '' ? {} : { website: contact.website }),
      // Signed in: the server deletes this account's draft of the design in the same transaction.
      ...(draftId === null ? {} : { draftId }),
    };

    setSend({ status: 'sending' });
    cancelDraftSave();
    const result = await guestApi<GuestRequestAccepted>('public/guest-requests', { method: 'POST', body });
    if (result.ok) {
      recordSent({ number: result.data.number, typeName: type?.name ?? '', design: body.design });
      markSent(result.data.number);
      return;
    }
    const fieldErrors: Partial<Record<Field, string>> = {};
    let designProblem = false;
    for (const d of result.details ?? []) {
      const f = d.path.replace(/^contact\./, '') as Field;
      if ((FIELDS as readonly string[]).includes(f)) fieldErrors[f] ??= d.message;
      else if (d.path.startsWith('design')) designProblem = true;
    }
    setServer(fieldErrors);
    setSend({ status: 'failed', message: result.message, designProblem });
  }

  const address = addressLines(design);
  const rows = summaryRows(design, type, contact);
  const sending = send.status === 'sending';
  /** Consent is the one thing the visitor can fix right here; a missing earlier step is a link away. */
  const notReady = !contact.consent || missing.length > 0;
  const summaryErrors = submitted ? FIELDS.filter((f) => shown(f) !== undefined) : [];

  return (
    <div className="g-send">
      <p className="g-panel-lead">Check what you are sending, then press Send.</p>

      {missing.length === 0 ? null : <MissingNotice missing={missing} type={type} />}

      <div className="g-send-grid">
        <section className="g-card g-sending" aria-labelledby="g-sending-title">
          <h3 id="g-sending-title" className="g-card-title">
            What you&rsquo;re sending
          </h3>
          {revisionOf === null ? null : <p className="g-hint g-revision">A revised design of request {revisionOf}.</p>}
          <dl className="g-sum">
            {rows.map((row) => (
              <div key={row.key} className={`g-sum-row${row.missing === true ? ' g-sum-missing' : ''}`}>
                <dt>{row.label}</dt>
                <dd>
                  {row.value.length === 0 ? (
                    <span className="g-sum-none">None</span>
                  ) : (
                    row.value.map((line) => <span key={line}>{line}</span>)
                  )}
                </dd>
                <dd className="g-sum-edit">
                  <button
                    type="button"
                    className="g-link-btn"
                    onClick={() => editAt(row.step, row.focus, type)}
                  >
                    {row.missing === true ? 'Add' : 'Edit'}
                    <span className="g-sr-only"> {row.label.toLowerCase()}</span>
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="g-card g-next" aria-labelledby="g-next-title">
          <h3 id="g-next-title" className="g-card-title">
            What happens next
          </h3>
          <ol className="g-next-list">
            {GUEST_CONTENT.nextSteps.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>You get the quote by email &mdash; {GUEST_CONTENT.replyTime}.</li>
          </ol>
        </section>
      </div>

      <form className="g-card g-send-form" noValidate onSubmit={onSubmit} aria-labelledby="g-details-title" aria-busy={sending}>
        <h3 id="g-details-title" className="g-card-title">
          Your details
        </h3>

        {summaryErrors.length === 0 ? null : (
          <div ref={errorRef} className="g-error-summary" role="alert" tabIndex={-1} aria-labelledby="g-errsum-title">
            <p id="g-errsum-title" className="g-error-summary-title">
              {summaryErrors.length === 1 ? 'There is 1 problem' : `There are ${summaryErrors.length} problems`}
            </p>
            <ul>
              {summaryErrors.map((f) => (
                <li key={f}>
                  <button
                    type="button"
                    className="g-link-btn"
                    onClick={() => editAt('start', `#${FIELD_ID[f]}`, type)}
                  >
                    {shown(f)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {send.status === 'failed' ? (
          <div className="g-error" role="alert">
            <span>{send.message}</span>
            {send.designProblem ? (
              <button type="button" className="g-btn g-btn-outline" onClick={() => goTo('design', type)}>
                Check my design
              </button>
            ) : null}
          </div>
        ) : null}

        {/* The contact details live on ①; shown here to read, with one Edit link back to it. */}
        <dl className="g-sum g-sum-compact">
          <ReadOnlyRow label="Name" value={`${contact.firstName} ${contact.lastName}`.trim()} step="start" focus="#g-first-name" type={type} />
          <ReadOnlyRow label="Email" value={contact.email} step="start" focus="#g-email" type={type} />
          <ReadOnlyRow
            label="Mobile"
            value={contact.mobile === '' ? '' : (formatAuMobile(contact.mobile) ?? contact.mobile)}
            step="start"
            focus="#g-mobile"
            type={type}
          />
          <div className="g-sum-row">
            <dt>Site address</dt>
            <dd>
              {address === null ? <span className="g-sum-none">Not added yet</span> : <span>{address}</span>}
            </dd>
            <dd className="g-sum-edit">
              <button type="button" className="g-link-btn" onClick={() => editAt('start', '#g-address-search, #g-suburb-search', type)}>
                {address === null ? 'Add' : 'Edit'}
                <span className="g-sr-only"> site address</span>
              </button>
            </dd>
          </div>
        </dl>

        <div className="g-field g-field-wide">
          <label className="g-label" htmlFor={REQUEST_ID}>
            Additional Request <span className="g-optional">(optional)</span>
          </label>
          <textarea
            id={REQUEST_ID}
            className="g-input g-textarea"
            rows={6}
            maxLength={REQUEST_MAX}
            value={contact.additionalRequest}
            aria-describedby="g-additional-request-hint"
            onChange={(e) => updateContact({ additionalRequest: e.target.value }, type)}
          />
          <p id="g-additional-request-hint" className="g-hint">
            Anything we should know — site access, slope, timing.
          </p>
        </div>

        {/* Honeypot: off-screen and out of the Tab order. A person never fills it. */}
        <div className="g-hp" aria-hidden="true">
          <label htmlFor="g-send-website">Website</label>
          <input
            id="g-send-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={contact.website}
            onChange={(e) => updateContact({ website: e.target.value }, type)}
          />
        </div>

        <div className="g-field g-field-wide">
          <label className="g-check" htmlFor={FIELD_ID.consent}>
            <input
              id={FIELD_ID.consent}
              type="checkbox"
              checked={contact.consent}
              aria-invalid={shown('consent') !== undefined}
              onChange={(e) => updateContact({ consent: e.target.checked }, type)}
            />
            <span>{GUEST_CONTENT.consent}</span>
          </label>
          {shown('consent') === undefined ? null : <p className="g-field-error">{shown('consent')}</p>}
        </div>

        <div className="g-send-actions">
          {/*
            Why the Send is not ready, said before it is pressed.

            The button stays pressable on purpose: a keyboard or screen-reader visitor still reaches the
            error summary that `onSubmit` builds, which is where the checkbox error is announced. What
            changes is that it *looks* not-ready and says what is missing, instead of looking ready and
            refusing.
          */}
          {notReady ? (
            <p id="g-send-reason" className="g-hint g-send-reason">
              {contact.consent ? `Pressing Send takes you to ${STEP_LABELS[missing[0]!.step].long.toLowerCase()} first.` : 'Tick the box above so we can send your request.'}
            </p>
          ) : null}
          <button
            type="submit"
            className={`g-btn g-btn-primary g-send-btn${notReady ? ' g-send-btn-wait' : ''}`}
            disabled={sending}
            {...(notReady ? { 'aria-disabled': true, 'aria-describedby': 'g-send-reason' } : {})}
          >
            {sending ? <span className="g-spinner" aria-hidden="true" /> : null}
            {sending ? 'Sending…' : 'Send quote request'}
          </button>
          {missing.length > 0 ? (
            <p className="g-hint">Pressing Send takes you to {STEP_LABELS[missing[0]!.step].long.toLowerCase()} first.</p>
          ) : (
            <p className="g-hint">
              No payment, no account. After you send you&rsquo;ll see a reference number, and we&rsquo;ll email a copy
              to {contact.email.trim() === '' ? 'you' : contact.email.trim()}.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  step,
  focus,
  type,
}: {
  label: string;
  value: string;
  step: 'start' | 'design' | 'send';
  focus: string;
  type: GuestBuildingTypeSpec | undefined;
}) {
  return (
    <div className="g-sum-row">
      <dt>{label}</dt>
      <dd>{value === '' ? <span className="g-sum-none">Not added yet</span> : <span>{value}</span>}</dd>
      <dd className="g-sum-edit">
        <button type="button" className="g-link-btn" onClick={() => editAt(step, focus, type)}>
          Edit<span className="g-sr-only"> {label.toLowerCase()}</span>
        </button>
      </dd>
    </div>
  );
}

function MissingNotice({ missing, type }: { missing: readonly MissingStep[]; type: GuestBuildingTypeSpec | undefined }) {
  return (
    <div className="g-notice g-send-missing" role="status">
      <p>Before you send:</p>
      <ul>
        {missing.map((m) => (
          <li key={m.step}>
            <button type="button" className="g-link-btn" onClick={() => goTo(m.step, type)}>
              {m.step === 'start'
                ? m.reason === 'needs your address'
                  ? 'Add your site address'
                  : m.reason === 'needs your contact details'
                    ? 'Add your contact details'
                    : 'Choose your building type'
                : 'Check your design — something needs attention'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Replaces the form once the request is stored (spec ③ "Màn xác nhận"); no page change. */
function Confirmation({ number, type }: { number: string; type: GuestBuildingTypeSpec | undefined }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="g-card g-confirm">
      <span className="g-confirm-tick" aria-hidden="true">
        <IconCheck />
      </span>
      <h3 ref={heading} tabIndex={-1} className="g-confirm-title">
        Request received
      </h3>
      <p className="g-confirm-number">
        Your request number is <strong>{number}</strong>
      </p>
      <p>Check your email to see all your requests.</p>
      <p className="g-hint">
        You get the quote by email &mdash; {GUEST_CONTENT.replyTime}. Quote your request number if you call us.
      </p>
      <div className="g-confirm-actions">
        <button type="button" className="g-btn g-btn-outline" onClick={() => keepDesigning(type)}>
          Keep designing
        </button>
        <button type="button" className="g-btn g-btn-ghost" onClick={startOver}>
          Start a new design
        </button>
      </div>
    </div>
  );
}
