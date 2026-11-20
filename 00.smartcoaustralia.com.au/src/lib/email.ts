import nodemailer, { type Transporter } from 'nodemailer'

import type { InquiryInput } from './inquiry'

/**
 * Optional SMTP notification for a saved inquiry.
 *
 * Mail is deliberately best-effort: when it is disabled or misconfigured we
 * return false and the inquiry stays stored. A mail failure must never make the
 * form submission look like a failure, so `sendInquiryEmail` never throws.
 */

let warnedDisabled = false
let transport: Transporter | null = null
let transportFailed = false

const isMailEnabled = () =>
  process.env.MAIL_ENABLED === 'true' && Boolean(process.env.SMTP_HOST?.trim())

function getTransport(): Transporter | null {
  if (transport) return transport
  if (transportFailed) return null

  try {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
    return transport
  } catch (error) {
    transportFailed = true
    console.warn('[email] could not create the SMTP transport:', error)
    return null
  }
}

const OFFICE_LABELS: Record<string, string> = {
  sydney: 'Sydney — Head Office',
  wa: 'Western Australia — Enquiries',
  hcmc: 'Ho Chi Minh City — Vietnam Office',
}

function subjectFor(input: InquiryInput): string {
  if (input.type === 'quote') {
    const site = input.siteLocation ? ` — ${input.siteLocation}` : ''
    return `[Quote] ${input.name} — ${input.projectType}${site}`
  }

  const office = OFFICE_LABELS[input.office] ?? input.office
  return `[Contact] ${input.name} — ${office}`
}

function recipientFor(input: InquiryInput): string {
  if (input.type === 'quote') {
    return process.env.MAIL_TO_QUOTE ?? 'info@smartsolutionsaustralia.com.au'
  }

  return process.env.MAIL_TO_CONTACT ?? 'info@smartsolutionsaustralia.com.au'
}

type Row = [label: string, value: string | undefined]

function rowsFor(input: InquiryInput): Row[] {
  const base: Row[] = [
    ['Name', input.name],
    ['Company', input.company],
    ['Email', input.email],
    ['Phone', input.phone],
  ]

  if (input.type === 'quote') {
    return [
      ...base,
      ['Project type', input.projectType],
      ['Approx. tonnage', input.tonnage],
      ['Site location', input.siteLocation],
      ['About the project', input.message],
    ]
  }

  return [
    ...base,
    ['Office', OFFICE_LABELS[input.office] ?? input.office],
    ['Enquiry type', input.enquiryType],
    ['Message', input.message],
  ]
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function renderText(input: InquiryInput): string {
  const lines = rowsFor(input)
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}: ${value}`)

  lines.push('', `Source path: ${input.sourcePath ?? '/'}`)
  return lines.join('\n')
}

function renderHtml(input: InquiryInput): string {
  const rows = rowsFor(input)
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:4px 12px 4px 0">${escapeHtml(label)}</th>` +
        `<td style="padding:4px 0">${escapeHtml(String(value)).replace(/\n/g, '<br />')}</td></tr>`,
    )
    .join('')

  return (
    `<h2>${escapeHtml(subjectFor(input))}</h2>` +
    `<table>${rows}</table>` +
    `<p style="color:#666;font-size:12px">Source path: ${escapeHtml(input.sourcePath ?? '/')}</p>`
  )
}

/**
 * Send the inquiry notification. Returns true only when SMTP accepted the
 * message; false when mail is disabled, misconfigured or the send failed.
 */
export async function sendInquiryEmail(input: InquiryInput): Promise<boolean> {
  if (!isMailEnabled()) {
    if (!warnedDisabled) {
      warnedDisabled = true
      console.warn('[email] mail disabled: inquiry saved without notification')
    }
    return false
  }

  const mailer = getTransport()
  if (!mailer) return false

  try {
    await mailer.sendMail({
      from: process.env.MAIL_FROM ?? 'Smart Solutions Australia <no-reply@smartsolutionsaustralia.com.au>',
      to: recipientFor(input),
      replyTo: input.email,
      subject: subjectFor(input),
      text: renderText(input),
      html: renderHtml(input),
    })
    return true
  } catch (error) {
    console.warn('[email] sending the inquiry notification failed:', error)
    return false
  }
}
