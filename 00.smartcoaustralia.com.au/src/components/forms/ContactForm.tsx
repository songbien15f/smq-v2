'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  ConsentField,
  FieldError,
  HoneypotField,
  postInquiry,
  waitForHumanThreshold,
} from '@/components/forms/form-shared'
import {
  contactFormSchema,
  fieldErrors,
  type ContactFormValues,
} from '@/lib/inquiry'
import { CONTACT_OFFICE_HINT, CONTACT_OFFICES, contactOfficeLabel } from '@/lib/labels'

type ContactFormProps = {
  form: {
    formTitle: string
    formIntro: string
    formNote: string
    consentLabel: string
    consentHref: string
    successHeading: string
    successBody: string
  }
  enquiryTypes: string[]
  sourcePath: string
}

const EMPTY: ContactFormValues = {
  name: '',
  company: '',
  email: '',
  phone: '',
  office: '',
  enquiryType: '',
  message: '',
  consent: false,
}

const errorId = (field: string) => `contact-${field}-error`

/**
 * Contact form.
 *
 * Same conventions as `QuoteForm`: `noValidate` with Zod messages, a honeypot,
 * a mount-time submission id and start timestamp, and a required consent
 * checkbox. Fields differ, the submission rules do not — both post to the
 * shared `/api/inquiries` endpoint with `type: 'contact'`.
 *
 * The Office select lists the three real offices; the chosen label is echoed
 * under the select so the sender can see which team will answer.
 */
export function ContactForm({ form, enquiryTypes, sourcePath }: ContactFormProps) {
  // Selects start on their first option, as the template does. Initialising from
  // props (rather than in an effect) keeps the server and client markup identical.
  const [values, setValues] = useState<ContactFormValues>(() => ({
    ...EMPTY,
    office: CONTACT_OFFICES[0].value,
    enquiryType: enquiryTypes[0] ?? '',
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submissionId, setSubmissionId] = useState('')
  const [startedAt, setStartedAt] = useState(0)
  const honeypotRef = useRef<HTMLInputElement>(null)

  // Generated after mount: a random id during SSR would differ from the client's
  // and React would flag the mismatch.
  useEffect(() => {
    setSubmissionId(crypto.randomUUID())
    setStartedAt(Date.now())
  }, [])

  const setField = <K extends keyof ContactFormValues>(field: K, value: ContactFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field as string]) return current
      const next = { ...current }
      delete next[field as string]
      return next
    })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    // A filled honeypot never reaches the API; show the normal success panel so
    // the bot gets no signal that it was detected.
    if (honeypotRef.current?.value) {
      setSubmitted(true)
      return
    }

    const parsed = contactFormSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }

    setIsSubmitting(true)
    setErrors({})

    try {
      await waitForHumanThreshold(startedAt)

      const result = await postInquiry({
        type: 'contact',
        ...parsed.data,
        consent: true,
        submissionId,
        startedAt,
        company_website: honeypotRef.current?.value ?? '',
        sourcePath,
      })

      if (result.ok) {
        setSubmitted(true)
        return
      }

      setErrors(result.errors)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="quote-form contact-form">
        <div className="form-done show" role="status" data-testid="contact-success">
          <h3>{form.successHeading}</h3>
          <p>{form.successBody}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="quote-form contact-form">
      <h3 id="contact-form-h">{form.formTitle}</h3>
      <p>{form.formIntro}</p>

      <form noValidate onSubmit={handleSubmit} aria-labelledby="contact-form-h">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="contact-name">
              Full name <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="contact-name"
              name="name"
              type="text"
              autoComplete="name"
              value={values.name}
              onChange={(event) => setField('name', event.target.value)}
              aria-required="true"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? errorId('name') : undefined}
            />
            <FieldError id={errorId('name')} message={errors.name} />
          </div>

          <div className="field">
            <label htmlFor="contact-company">Company</label>
            <input
              id="contact-company"
              name="company"
              type="text"
              autoComplete="organization"
              value={values.company}
              onChange={(event) => setField('company', event.target.value)}
              aria-invalid={errors.company ? true : undefined}
              aria-describedby={errors.company ? errorId('company') : undefined}
            />
            <FieldError id={errorId('company')} message={errors.company} />
          </div>

          <div className="field">
            <label htmlFor="contact-email">
              Email <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={(event) => setField('email', event.target.value)}
              aria-required="true"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? errorId('email') : undefined}
            />
            <FieldError id={errorId('email')} message={errors.email} />
          </div>

          <div className="field">
            <label htmlFor="contact-phone">Phone</label>
            <input
              id="contact-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              value={values.phone}
              onChange={(event) => setField('phone', event.target.value)}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? errorId('phone') : undefined}
            />
            <FieldError id={errorId('phone')} message={errors.phone} />
          </div>

          <div className="field">
            <label htmlFor="contact-office">Office</label>
            <select
              id="contact-office"
              name="office"
              value={values.office}
              onChange={(event) => setField('office', event.target.value as ContactFormValues['office'])}
              aria-invalid={errors.office ? true : undefined}
              aria-describedby={errors.office ? errorId('office') : undefined}
            >
              {CONTACT_OFFICES.map((office) => (
                <option key={office.value} value={office.value}>
                  {office.label}
                </option>
              ))}
            </select>
            <FieldError id={errorId('office')} message={errors.office} />
            {values.office ? (
              <p className="field-hint">
                {CONTACT_OFFICE_HINT} {contactOfficeLabel(values.office)}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="contact-enquiry-type">Enquiry type</label>
            <select
              id="contact-enquiry-type"
              name="enquiryType"
              value={values.enquiryType}
              onChange={(event) => setField('enquiryType', event.target.value)}
              aria-invalid={errors.enquiryType ? true : undefined}
              aria-describedby={errors.enquiryType ? errorId('enquiryType') : undefined}
            >
              {enquiryTypes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <FieldError id={errorId('enquiryType')} message={errors.enquiryType} />
          </div>

          <div className="field full">
            <label htmlFor="contact-message">
              Message <span className="req" aria-hidden="true">*</span>
            </label>
            <textarea
              id="contact-message"
              name="message"
              placeholder="How can we help?"
              value={values.message}
              onChange={(event) => setField('message', event.target.value)}
              aria-required="true"
              aria-invalid={errors.message ? true : undefined}
              aria-describedby={errors.message ? errorId('message') : undefined}
            />
            <FieldError id={errorId('message')} message={errors.message} />
          </div>

          <ConsentField
            id="contact-consent"
            label={form.consentLabel}
            href={form.consentHref}
            checked={values.consent}
            onChange={(checked) => setField('consent', checked)}
            error={errors.consent}
          />

          <HoneypotField id="contact-company-website" inputRef={honeypotRef} />
        </div>

        {errors.form ? (
          <p className="form-status" role="alert">
            {errors.form}
          </p>
        ) : null}

        <button className="btn btn-accent" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send Message'}
        </button>

        <p className="form-note">{form.formNote}</p>
      </form>
    </div>
  )
}
