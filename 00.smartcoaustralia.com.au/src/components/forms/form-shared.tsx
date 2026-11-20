'use client'

import type { RefObject } from 'react'

import { InlineLinkText } from '@/components/ui/InlineLinkText'
import { PRIVACY_LINK_LABEL } from '@/lib/labels'

/**
 * Pieces shared by the quote and contact forms.
 *
 * Both forms submit to `POST /api/inquiries` and must behave identically around
 * the anti-spam trio (honeypot, mount timestamp, idempotency id), consent and
 * error reporting. Keeping the transport and the small UI atoms here means the
 * two components differ only in their fields, not in their submission rules.
 */

/** The server rejects a submit faster than two seconds; wait it out client-side. */
export const INQUIRY_MIN_FILL_MS = 2000
export const INQUIRY_EMAIL = 'info@smartsolutionsaustralia.com.au'

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null

  return (
    <p className="field-error" id={id} role="alert">
      {message}
    </p>
  )
}

/**
 * Honeypot: off-screen, untabbable and hidden from assistive tech. Bots that
 * fill every input are rejected by the server's `company_website` max(0) rule.
 */
export function HoneypotField({
  id,
  inputRef,
}: {
  id: string
  inputRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="field hp-field" aria-hidden="true">
      <label htmlFor={id}>Company website</label>
      <input
        ref={inputRef}
        id={id}
        name="company_website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
      />
    </div>
  )
}

type ConsentFieldProps = {
  id: string
  label: string
  href: string
  checked: boolean
  onChange: (checked: boolean) => void
  error?: string
}

/** Required consent checkbox whose label links "Privacy Policy" to the policy page. */
export function ConsentField({ id, label, href, checked, onChange, error }: ConsentFieldProps) {
  const errorId = `${id}-error`

  return (
    <div className="field full consent-field">
      <span className="consent-row">
        <input
          id={id}
          name="consent"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <label htmlFor={id}>
          <InlineLinkText text={label} label={PRIVACY_LINK_LABEL} href={href} />
        </label>
      </span>
      <FieldError id={errorId} message={error} />
    </div>
  )
}

/**
 * `startedAt` is the anti-bot clock, so it must be at least two seconds old by
 * the time the request leaves. A person filling the form normally is well past
 * that; automation (including this project's e2e suite) is not. Wait out the
 * remainder rather than have a genuine request rejected as "too quick".
 */
export async function waitForHumanThreshold(startedAt: number): Promise<void> {
  const elapsed = startedAt > 0 ? Date.now() - startedAt : 0
  const remaining = INQUIRY_MIN_FILL_MS - elapsed
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
}

export type InquirySubmitResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> }

/** Post an inquiry and map every failure into form-level or per-field errors. */
export async function postInquiry(body: Record<string, unknown>): Promise<InquirySubmitResult> {
  try {
    const response = await fetch('/api/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (response.status === 201 || response.status === 200) return { ok: true }

    if (response.status === 400) {
      const payload = (await response.json().catch(() => null)) as {
        errors?: Record<string, string>
      } | null

      return {
        ok: false,
        errors: payload?.errors ?? { form: 'Please check the highlighted fields.' },
      }
    }

    if (response.status === 429) {
      return {
        ok: false,
        errors: { form: 'Too many requests from this connection. Please try again in a few minutes.' },
      }
    }

    return { ok: false, errors: { form: `We could not send your request. Please email ${INQUIRY_EMAIL}.` } }
  } catch {
    return {
      ok: false,
      errors: { form: 'We could not send your request. Check your connection and try again.' },
    }
  }
}
