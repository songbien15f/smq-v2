import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contactSchema,
  checkRateLimit,
  quoteSchema,
  resetRateLimit,
} from '../../src/lib/inquiry'

const valid = {
  type: 'quote',
  name: 'Jane',
  email: 'jane@example.com',
  projectType: 'Warehouse / Industrial',
  tonnage: '20 – 100 t',
  siteLocation: 'Newcastle, NSW',
  message: 'Need a quote',
  consent: true,
  submissionId: '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607',
  startedAt: Date.now() - 5000,
  company_website: '',
  sourcePath: '/quote',
}

const validContact = {
  type: 'contact',
  name: 'Jane',
  email: 'jane@example.com',
  office: 'sydney',
  enquiryType: 'General enquiry',
  message: 'Please send the compliance documents.',
  consent: true,
  submissionId: '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607',
  startedAt: Date.now() - 5000,
  company_website: '',
  sourcePath: '/contact',
}

test('valid quote passes', () => {
  assert.equal(quoteSchema.safeParse(valid).success, true)
})

test('bad email is rejected', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, email: 'nope' }).success, false)
})

test('missing consent is rejected', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, consent: false }).success, false)
})

test('honeypot must be empty', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, company_website: 'spam' }).success, false)
})

test('fast submissions are rejected', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, startedAt: Date.now() - 500 }).success, false)
})

test('submissionId must be a uuid', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, submissionId: 'not-a-uuid' }).success, false)
})

test('name is required and reported under the name path', () => {
  const result = quoteSchema.safeParse({ ...valid, name: '' })
  assert.equal(result.success, false)
  assert.equal(result.error?.issues[0]?.path[0], 'name')
})

test('required quote fields are capped at their template lengths', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, projectType: 'x'.repeat(81) }).success, false)
  assert.equal(quoteSchema.safeParse({ ...valid, tonnage: 'x'.repeat(41) }).success, false)
  assert.equal(quoteSchema.safeParse({ ...valid, siteLocation: 'x'.repeat(161) }).success, false)
  assert.equal(quoteSchema.safeParse({ ...valid, message: 'x'.repeat(4001) }).success, false)
  assert.equal(quoteSchema.safeParse({ ...valid, sourcePath: 'x'.repeat(201) }).success, false)
})

test('optional quote fields may be omitted', () => {
  const { siteLocation: _siteLocation, message: _message, ...rest } = valid
  assert.equal(quoteSchema.safeParse(rest).success, true)
})

test('valid contact passes', () => {
  assert.equal(contactSchema.safeParse(validContact).success, true)
})

test('contact office must be one of the three offices', () => {
  assert.equal(contactSchema.safeParse({ ...validContact, office: 'perth' }).success, false)
})

test('contact message is required', () => {
  assert.equal(contactSchema.safeParse({ ...validContact, message: '' }).success, false)
})

test('rate limit blocks the sixth request in ten minutes', () => {
  resetRateLimit()
  const now = 1_000_000
  for (let i = 0; i < 5; i++) assert.equal(checkRateLimit('ip', now + i), true)
  assert.equal(checkRateLimit('ip', now + 6), false)
  assert.equal(checkRateLimit('ip', now + 10 * 60_000 + 1), true)
})

test('rate limit keeps separate keys apart', () => {
  resetRateLimit()
  const now = 2_000_000
  for (let i = 0; i < 5; i++) assert.equal(checkRateLimit('a', now + i), true)
  assert.equal(checkRateLimit('a', now + 6), false)
  assert.equal(checkRateLimit('b', now + 6), true)
})
