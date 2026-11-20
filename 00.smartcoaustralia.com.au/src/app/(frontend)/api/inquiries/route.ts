import type { NextRequest } from 'next/server'
import { REST_GET, REST_OPTIONS, REST_POST } from '@payloadcms/next/routes'
import { getPayload } from 'payload'

import config from '@payload-config'
import { sendInquiryEmail } from '@/lib/email'
import {
  fieldErrors,
  quoteSchema,
  contactSchema,
  checkRateLimit,
  type InquiryInput,
} from '@/lib/inquiry'

// Nodemailer and the Postgres driver both need the Node.js runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A static route wins over the catch-all Payload REST route (`/api/[...slug]`),
 * so reading the inbox and any admin-side write must be delegated back to
 * Payload here. Only the exact `/api/inquiries` path is shadowed; single
 * documents (`/api/inquiries/:id`) still reach the catch-all.
 */
const payloadGet = REST_GET(config)
const payloadOptions = REST_OPTIONS(config)
const payloadPost = REST_POST(config)

// Payload resolves the collection from this slug list, exactly as the
// catch-all route would for `/api/inquiries`.
const inquiriesParams = { params: Promise.resolve({ slug: ['inquiries'] }) }

export const GET = (request: NextRequest) => payloadGet(request, inquiriesParams)
export const OPTIONS = (request: NextRequest) => payloadOptions(request, inquiriesParams)

const badRequest = (errors: Record<string, string>) =>
  Response.json({ ok: false, errors }, { status: 400 })

const clientKey = (request: NextRequest) =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'

const isUniqueViolation = (error: unknown) => {
  const candidate = error as { code?: string; cause?: { code?: string } } | null
  return candidate?.code === '23505' || candidate?.cause?.code === '23505'
}

export async function POST(request: NextRequest) {
  const payload = await getPayload({ config })

  // An authenticated editor creating a record from the admin UI is a normal
  // Payload write, not a public form submission: hand it to Payload before the
  // body stream is consumed, so the admin's own validation and access apply.
  const { user } = await payload.auth({ headers: request.headers })
  if (user) {
    return payloadPost(request, inquiriesParams)
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return badRequest({ form: 'Send the form as a JSON object' })
  }

  const type = (body as { type?: unknown } | null)?.type
  if (type !== 'quote' && type !== 'contact') {
    return badRequest({ type: 'Choose a request type' })
  }

  // The schemas also enforce the honeypot (`company_website` max 0) and reject
  // submissions completed in under two seconds (`startedAt`).
  const result = type === 'quote' ? quoteSchema.safeParse(body) : contactSchema.safeParse(body)

  if (!result.success) {
    return badRequest(fieldErrors(result.error))
  }

  const input: InquiryInput = result.data

  if (!checkRateLimit(clientKey(request), Date.now())) {
    return Response.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  try {
    const existing = await payload.find({
      collection: 'inquiries',
      where: { submissionId: { equals: input.submissionId } },
      limit: 1,
      depth: 0,
    })

    if (existing.docs.length > 0) {
      return Response.json({ ok: true, emailSent: false, duplicate: true })
    }

    await payload.create({
      collection: 'inquiries',
      data: {
        type: input.type,
        status: 'new',
        name: input.name,
        company: input.company,
        email: input.email,
        phone: input.phone,
        projectType: input.type === 'quote' ? input.projectType : undefined,
        tonnage: input.type === 'quote' ? input.tonnage : undefined,
        siteLocation: input.type === 'quote' ? input.siteLocation : undefined,
        office: input.type === 'contact' ? input.office : undefined,
        enquiryType: input.type === 'contact' ? input.enquiryType : undefined,
        message: input.message,
        sourcePath: input.sourcePath,
        consent: true,
        submissionId: input.submissionId,
      },
    })
  } catch (error) {
    // A double click can pass the existence check twice; the unique index turns
    // the loser into a duplicate rather than a 500.
    if (isUniqueViolation(error)) {
      return Response.json({ ok: true, emailSent: false, duplicate: true })
    }

    payload.logger.error(`Inquiry could not be saved: ${String(error)}`)
    return Response.json(
      { ok: false, error: 'Could not save the request. Please email us directly.' },
      { status: 500 },
    )
  }

  // Mail is best effort: false simply means "stored, but not emailed".
  const emailSent = await sendInquiryEmail(input)

  return Response.json({ ok: true, emailSent }, { status: 201 })
}
