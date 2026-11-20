import test from 'node:test'
import assert from 'node:assert/strict'

import { formatPolicyDate, lexicalNodeText, policySectionId } from '../../src/lib/privacy'

test('policySectionId maps every Appendix A heading to its stable anchor', () => {
  const expected: Record<string, string> = {
    '1. Who we are': 'who-we-are',
    '2. Scope of this policy': 'scope',
    '3. What personal information we collect': 'what-we-collect',
    '4. How we collect personal information': 'how-we-collect',
    '5. Why we use personal information': 'why-we-use',
    '6. Cookies and website usage': 'cookies',
    '7. Disclosure of personal information': 'disclosure',
    '8. Overseas disclosure': 'overseas',
    '9. Security of personal information': 'security',
    '10. Retention': 'retention',
    '11. Access and correction': 'access-correction',
    '12. Direct marketing': 'direct-marketing',
    '13. Complaints': 'complaints',
    '14. Links to other websites': 'links',
    '15. Changes to this policy': 'changes',
    '16. Contact us': 'contact-us',
  }

  for (const [heading, id] of Object.entries(expected)) {
    assert.equal(policySectionId(heading), id, heading)
  }
})

test('policySectionId keeps the number out of the id and falls back to a slug', () => {
  assert.equal(policySectionId('2. Scope of this policy'), 'scope')
  assert.equal(policySectionId('17. Data breach response'), 'data-breach-response')
  assert.equal(policySectionId('  Retention  '), 'retention')
  assert.equal(policySectionId('Privacy & cookies'), 'privacy-and-cookies')
})

test('formatPolicyDate renders the stored day in UTC', () => {
  assert.equal(formatPolicyDate('2026-11-18'), '18 November 2026')
  assert.equal(formatPolicyDate('2026-11-18T00:00:00.000Z'), '18 November 2026')
  assert.equal(formatPolicyDate(new Date('2026-11-18T00:00:00.000Z')), '18 November 2026')
})

test('formatPolicyDate is empty for missing or invalid values', () => {
  assert.equal(formatPolicyDate(null), '')
  assert.equal(formatPolicyDate(undefined), '')
  assert.equal(formatPolicyDate(''), '')
  assert.equal(formatPolicyDate('not a date'), '')
})

test('lexicalNodeText flattens nested text nodes', () => {
  assert.equal(lexicalNodeText({ type: 'text', text: 'Scope' }), 'Scope')
  assert.equal(
    lexicalNodeText({
      type: 'heading',
      children: [
        { type: 'text', text: '1. ' },
        { type: 'text', text: 'Who we are' },
      ],
    }),
    '1. Who we are',
  )
  assert.equal(lexicalNodeText(null), '')
})
