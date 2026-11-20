import { z } from 'zod'

/**
 * Inquiry validation shared by the API route, the unit tests and the forms.
 *
 * Both submitted schemas are strict about the anti-spam trio:
 * - `company_website` is a honeypot that must stay empty (max length 0);
 * - `startedAt` is stamped when the form mounts, so a submit faster than two
 *   seconds is treated as a bot;
 * - `submissionId` is a client-generated UUID, used for idempotent retries and
 *   as the collection's unique key.
 *
 * The `*FormSchema` variants hold only the fields a person edits, so the forms
 * can validate on the client without applying the timestamp or honeypot rules
 * (the server enforces those on submit).
 */
const identityFields = {
  name: z.string().trim().min(1, 'Full name is required').max(120, 'Full name is too long'),
  email: z.string().trim().email('Enter a valid email address').max(200, 'Email is too long'),
  phone: z.string().trim().max(60, 'Phone is too long').optional(),
  company: z.string().trim().max(160, 'Company is too long').optional(),
}

const consentField = {
  consent: z.literal(true, {
    errorMap: () => ({ message: 'Please consent to the Privacy Policy' }),
  }),
}

export const quoteFormSchema = z.object({
  ...identityFields,
  ...consentField,
  projectType: z.string().trim().min(1, 'Select a project type').max(80, 'Project type is too long'),
  tonnage: z.string().trim().min(1, 'Select an approximate tonnage').max(40, 'Tonnage is too long'),
  siteLocation: z.string().trim().max(160, 'Site location is too long').optional(),
  message: z.string().trim().max(4000, 'Message is too long').optional(),
})

export const contactFormSchema = z.object({
  ...identityFields,
  ...consentField,
  office: z.enum(['sydney', 'wa', 'hcmc'], {
    errorMap: () => ({ message: 'Select an office' }),
  }),
  enquiryType: z.string().trim().min(1, 'Select an enquiry type').max(80, 'Enquiry type is too long'),
  message: z
    .string()
    .trim()
    .min(1, 'Message is required')
    .max(4000, 'Message is too long'),
})

const submissionFields = {
  consent: consentField.consent,
  submissionId: z.string().uuid('Invalid submission id'),
  startedAt: z
    .number()
    .refine((value) => Number.isFinite(value) && Date.now() - value >= 2000, {
      message: 'Submission was too quick',
    }),
  company_website: z.string().max(0, 'Unexpected value'),
  sourcePath: z.string().max(200, 'Source path is too long').optional(),
}

export const quoteSchema = quoteFormSchema.extend({
  ...submissionFields,
  type: z.literal('quote'),
})

export const contactSchema = contactFormSchema.extend({
  ...submissionFields,
  type: z.literal('contact'),
})

export type QuoteInput = z.infer<typeof quoteSchema>
export type ContactInput = z.infer<typeof contactSchema>
export type InquiryInput = QuoteInput | ContactInput

/** The editable fields of the quote form (no submission metadata). */
export type QuoteFormValues = {
  name: string
  company: string
  email: string
  phone: string
  projectType: string
  tonnage: string
  siteLocation: string
  message: string
  consent: boolean
}

/** The editable fields of the contact form (no submission metadata). */
export type ContactFormValues = {
  name: string
  company: string
  email: string
  phone: string
  office: ContactInput['office'] | ''
  enquiryType: string
  message: string
  consent: boolean
}

/** Flatten a Zod error to the first message per field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    if (!errors[key]) errors[key] = issue.message
  }

  return errors
}

const RATE_LIMIT_WINDOW_MS = 10 * 60_000
const RATE_LIMIT_MAX = 5

const rateLimitHits = new Map<string, number[]>()

/**
 * Sliding-window rate limit: at most five requests per key in ten minutes.
 * Returns false when the request should be rejected (429).
 */
export function checkRateLimit(key: string, now: number): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const recent = (rateLimitHits.get(key) ?? []).filter((stamp) => stamp > cutoff)

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitHits.set(key, recent)
    return false
  }

  recent.push(now)
  rateLimitHits.set(key, recent)
  return true
}

/** Drop all recorded hits. Test-only seam; the route never calls this. */
export function resetRateLimit(): void {
  rateLimitHits.clear()
}
