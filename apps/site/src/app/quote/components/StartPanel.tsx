'use client';

import { useRef, useState } from 'react';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import { nationalMobile } from '../mobile';
import { contactStarted, contactValid, updateContact, chooseType, useGuest, type ContactDraft, type GuestStep } from '../store';
import { needsDesign } from '../summary';
import { guestDesignFromType } from '@sq/core/domain';
import { AddressPanel } from './AddressPanel';
import { SentRequests } from './SentRequests';
import { TypeCard } from './TypeCard';
import { IconChevronRight } from './icons';

type TypesState =
  | { status: 'loading' }
  | { status: 'ready'; types: readonly GuestBuildingTypeSpec[] }
  | { status: 'failed'; message: string };

/**
 * Step ① "Start" (plan G-a2 S4): building type, address, contact details and the free-text request,
 * all in one place.
 *
 * The customer asked for this order — type, then address, then who they are (Q2, reversing D-T4).
 * The advantage is on their side: the company can ring a visitor back even if they never finish the
 * design, and the contact details are already there when they do.
 *
 * ## What is locked, and why
 *
 * ②③ unlock when the type, the address and enough of the contact details are present. The address
 * must come from the suggestions (`AddressPanel`), because a wind region cannot be estimated from a
 * typed suburb — the suburb list is the fallback and the manual fields are the last resort.
 *
 * ## The contact details stay on the page
 *
 * `store.ts` never writes them to `localStorage`: a name, mobile and email left in a shared browser
 * is a leak, and the sentence under the form says so. A reload loses them and keeps the design.
 */

const MOBILE_HINT = '0412 345 678';

export function StartPanel({
  types,
  design,
  contact,
  onRetry,
  onChooseType,
  nextStep,
  onNext,
}: {
  types: TypesState;
  design: GuestDesignInput | null;
  contact: ContactDraft;
  onRetry: () => void;
  onChooseType: (type: GuestBuildingTypeSpec) => void;
  nextStep: GuestStep;
  onNext: (step: GuestStep) => void;
}) {
  const type = types.status === 'ready' ? types.types.find((t) => t.id === design?.typeId) : undefined;
  /*
   * Set by `hydrate` when a saved draft pointed at a type the vendor has since switched off. The draft
   * was dropped (the address kept); this says so once, in plain words, rather than leaving a summary
   * bar naming a type that does not exist.
   */
  const droppedType = useGuest((s) => s.droppedType);
  const [touched, setTouched] = useState<Partial<Record<keyof ContactDraft, boolean>>>({});
  /*
   * A refused step (§ Phase A) points at one box. Focusing it cannot produce a blur, so the inline
   * error would never appear on its own; this is what makes it appear.
   */
  const startProblem = useGuest((s) => s.startProblem);
  const shown = {
    ...touched,
    ...(startProblem === null ? {} : { [startProblem]: true }),
  } as Partial<Record<keyof ContactDraft, boolean>>;

  const ready = design !== null && design.site !== undefined && contactStarted(contact);
  const canContinue = ready && contactValid(contact);

  return (
    <div className="g-start">
      {droppedType === null ? null : (
        <p className="g-notice" role="status">
          The building you were designing is no longer available, so its design was cleared. Pick a building
          below to start again.
        </p>
      )}

      <SentRequests types={types.status === 'ready' ? types.types : null} />

      <section className="g-start-section" aria-labelledby="g-start-type">
        <h3 id="g-start-type" className="g-section-title">
          1. What are you building?
        </h3>
        <TypePanel types={types} design={design} onRetry={onRetry} onPick={onChooseType} />
      </section>

      {design === null ? null : (
        <section className="g-start-section" aria-labelledby="g-start-address">
          <h3 id="g-start-address" className="g-section-title">
            2. Where will it be built?
          </h3>
          {/* The estimate now renders inside AddressPanel, beside the address it describes. */}
          <AddressPanel
            enclosure={type?.config.enclosure ?? 'enclosed'}
            mode={type?.config.mode ?? 'design'}
          />
        </section>
      )}

      <section className="g-start-section" aria-labelledby="g-start-contact">
        <h3 id="g-start-contact" className="g-section-title">
          3. How can we reach you?
        </h3>
        <p className="g-required-note">
          <span className="g-required" aria-hidden="true">*</span> required
        </p>
        <div className="g-contact-grid">
          <div className="g-field">
            <label className="g-label" htmlFor="g-first-name">
              First name<span className="g-required" aria-hidden="true">*</span>
            </label>
            <input
              id="g-first-name"
              className="g-input"
              type="text"
              autoComplete="given-name"
              maxLength={60}
              required
              aria-required="true"
              value={contact.firstName}
              onChange={(e) => updateContact({ firstName: e.target.value }, type)}
              onBlur={() => setTouched((t) => ({ ...t, firstName: true }))}
              aria-invalid={shown.firstName === true && contact.firstName.trim() === ''}
            />
            {shown.firstName === true && contact.firstName.trim() === '' ? (
              <p className="g-field-error">Enter your first name.</p>
            ) : null}
          </div>
          <div className="g-field">
            <label className="g-label" htmlFor="g-last-name">
              Last name<span className="g-required" aria-hidden="true">*</span>
            </label>
            <input
              id="g-last-name"
              className="g-input"
              type="text"
              autoComplete="family-name"
              maxLength={60}
              required
              aria-required="true"
              value={contact.lastName}
              onChange={(e) => updateContact({ lastName: e.target.value }, type)}
              onBlur={() => setTouched((t) => ({ ...t, lastName: true }))}
              aria-invalid={shown.lastName === true && contact.lastName.trim() === ''}
            />
            {shown.lastName === true && contact.lastName.trim() === '' ? (
              <p className="g-field-error">Enter your last name.</p>
            ) : null}
          </div>
          <div className="g-field">
            <label className="g-label" htmlFor="g-email">
              Email address<span className="g-required" aria-hidden="true">*</span>
            </label>
            <input
              id="g-email"
              className="g-input"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              aria-required="true"
              value={contact.email}
              onChange={(e) => updateContact({ email: e.target.value }, type)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              aria-invalid={
                shown.email === true && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact.email.trim())
              }
            />
            {shown.email === true && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact.email.trim()) ? (
              <p className="g-field-error">Enter an email address we can reply to.</p>
            ) : null}
          </div>
          <div className="g-field">
            <label className="g-label" htmlFor="g-mobile">
              Mobile<span className="g-required" aria-hidden="true">*</span>
            </label>
            <div className="g-input-with-prefix">
              <span className="g-input-prefix" aria-hidden="true">
                +61
              </span>
              <input
                id="g-mobile"
                className="g-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                maxLength={15}
                required
                aria-required="true"
                placeholder={MOBILE_HINT}
                value={contact.mobile}
                onChange={(e) => updateContact({ mobile: e.target.value }, type)}
                onBlur={() => {
                  setTouched((t) => ({ ...t, mobile: true }));
                  const pretty = nationalMobile(contact.mobile);
                  if (pretty !== null && pretty !== contact.mobile) updateContact({ mobile: pretty }, type);
                }}
                aria-invalid={shown.mobile === true && !contactValid({ ...contact, firstName: 'x', lastName: 'x', email: 'a@b.co' })}
              />
            </div>
            {shown.mobile === true && !contactValid({ ...contact, firstName: 'x', lastName: 'x', email: 'a@b.co' }) ? (
              <p className="g-field-error">Enter an Australian mobile, e.g. 0412 345 678.</p>
            ) : null}
          </div>
        </div>
        <p className="g-contact-note">
          Reloading keeps your design and address, but clears your name, mobile and email.
        </p>
      </section>

      <section className="g-start-section" aria-labelledby="g-start-request">
        <h3 id="g-start-request" className="g-section-title">
          4. Anything else we should know?
        </h3>
        <div className="g-field">
          <label className="g-label" htmlFor="g-additional-request">
            Additional Request <span className="g-optional">(optional)</span>
          </label>
          <textarea
            id="g-additional-request"
            className="g-input g-textarea"
            rows={6}
            maxLength={4000}
            placeholder="Tell us about your site, approvals, access, or anything else that matters."
            value={contact.additionalRequest}
            onChange={(e) => updateContact({ additionalRequest: e.target.value }, type)}
          />
        </div>
      </section>

      {type !== undefined && !needsDesign(type) ? (
        <p className="g-panel-lead">
          We&rsquo;ll be in touch to discuss your house. You can send your details now — there&rsquo;s nothing to design
          here.
        </p>
      ) : null}

      <div className="g-start-next">
        <button
          type="button"
          className="g-btn g-btn-primary"
          disabled={!canContinue}
          onClick={() => onNext(nextStep)}
        >
          <span>
            Continue to <span className="g-wide-only">{nextStep === 'send' ? 'Send request' : 'Building'}</span>
            <span className="g-narrow-only">{nextStep === 'send' ? 'Send' : 'Build'}</span>
          </span>
          <IconChevronRight />
        </button>
        {canContinue || !ready ? null : (
          <p className="g-hint">Fill in your contact details to continue.</p>
        )}
      </div>
    </div>
  );
}

/**
 * The six type cards (override §5 `TypeCard`).
 *
 * Picking a card unlocks the rest of the page and starts the design from that type's defaults,
 * keeping an address already entered. Switching type after the design has changed asks first, since
 * the new type starts from its own defaults.
 */
function TypePanel({
  types,
  design,
  onRetry,
  onPick,
}: {
  types: TypesState;
  design: GuestDesignInput | null;
  onRetry: () => void;
  onPick: (type: GuestBuildingTypeSpec) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<GuestBuildingTypeSpec | null>(null);
  const selectedId = design?.typeId ?? null;

  const pick = (type: GuestBuildingTypeSpec) => {
    if (design === null || design.typeId === type.id || types.status !== 'ready') {
      chooseType(type);
      return;
    }
    const current = types.types.find((t) => t.id === design.typeId);
    if (current === undefined || !isChanged(design, current)) {
      chooseType(type);
      return;
    }
    setPending(type);
    dialog.current?.showModal();
  };

  if (types.status === 'loading') {
    return <p className="g-panel-lead">Loading building types…</p>;
  }
  if (types.status === 'failed') {
    return (
      <div className="g-error" role="alert">
        <span>{types.message}</span>
        <button type="button" className="g-btn g-btn-outline" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (types.types.length === 0) {
    return (
      <div className="g-card">
        <p className="g-type-none">Online design is unavailable right now.</p>
        <p className="g-panel-lead">
          Please <a href="/#enquire">send us a message</a> and our team will help you with your building.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="g-type-grid">
        {types.types.map((type) => (
          <TypeCard key={type.id} type={type} selected={type.id === selectedId} onPick={pick} />
        ))}
      </div>

      <dialog ref={dialog} className="g-dialog" aria-labelledby="g-switch-title" onClose={() => setPending(null)}>
        <h2 id="g-switch-title">Switch to {pending?.name ?? 'another building'}?</h2>
        <p>Your size, doors and colours go back to the new building&rsquo;s starting design. Your address is kept.</p>
        <form method="dialog" className="g-dialog-actions">
          <button type="submit" className="g-btn g-btn-outline" autoFocus>
            Keep my design
          </button>
          <button
            type="submit"
            className="g-btn g-btn-danger"
            onClick={() => {
              if (pending !== null) onPick(pending);
            }}
          >
            Switch building
          </button>
        </form>
      </dialog>
    </>
  );
}

/** Whether the guest has changed the design away from its type's starting point. */
function isChanged(design: GuestDesignInput, type: GuestBuildingTypeSpec): boolean {
  const start = guestDesignFromType(type, design.site);
  const shape = (d: GuestDesignInput) => JSON.stringify([d.building, d.openings, d.colours]);
  return shape(design) !== shape(start);
}
