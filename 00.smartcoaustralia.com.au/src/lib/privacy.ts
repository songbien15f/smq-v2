/**
 * Heading ids that the privacy policy's sections are published under.
 *
 * The policy text is CMS copy, so the ids cannot live in the seed: an editor may
 * rewrite a heading. The page derives an id from the heading text and this table
 * shortens the verbose ones to the clauses that links and complaints quote
 * (`#scope`, `#cookies`, `#complaints`). Any heading not in the table keeps its
 * full slug, so a newly added section still gets a stable, readable anchor.
 */
const SECTION_IDS: Record<string, string> = {
  'scope-of-this-policy': 'scope',
  'what-personal-information-we-collect': 'what-we-collect',
  'how-we-collect-personal-information': 'how-we-collect',
  'why-we-use-personal-information': 'why-we-use',
  'cookies-and-website-usage': 'cookies',
  'disclosure-of-personal-information': 'disclosure',
  'overseas-disclosure': 'overseas',
  'security-of-personal-information': 'security',
  'access-and-correction': 'access-correction',
  'links-to-other-websites': 'links',
  'changes-to-this-policy': 'changes',
}

/**
 * Stable anchor id for a policy section heading.
 *
 * The section number is stripped first, so "2. Scope of this policy" and the
 * same heading without its number share one id.
 */
export function policySectionId(text: string): string {
  const slug = text
    .trim()
    .replace(/^\d+[.)]?\s*/, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return SECTION_IDS[slug] ?? slug
}

/**
 * "18 November 2026" for a date stored by Payload.
 *
 * Formatted in UTC: the seed stores midnight UTC, and a local formatter would
 * render the previous day for readers west of Greenwich.
 */
export function formatPolicyDate(value: string | Date | null | undefined): string {
  if (!value) return ''

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** Plain text of a Lexical node, used to derive a heading's anchor id. */
export function lexicalNodeText(node: unknown): string {
  const record = node as { type?: string; text?: string; children?: unknown[] } | null
  if (!record) return ''
  if (record.type === 'text' && typeof record.text === 'string') return record.text
  return (record.children ?? []).map(lexicalNodeText).join('')
}
