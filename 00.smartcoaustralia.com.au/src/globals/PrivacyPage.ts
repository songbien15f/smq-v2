import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

/**
 * The privacy policy is a single legal document rather than a set of sections:
 * one rich-text body (seeded verbatim from Appendix A of the design spec) and
 * the date the policy was last revised. Each numbered heading in the body is an
 * `h2`; the page turns its heading text into a stable anchor id so a complaint
 * or a consent link can deep-link a clause.
 *
 * The body is rich text so an editor can add a section, a bullet or a link
 * without a developer. `meta` is optional SEO copy; the page falls back to its
 * own title and description when it is empty.
 */
export const PrivacyPage: GlobalConfig = {
  slug: 'privacy-page',
  label: 'Privacy Page',
  admin: {
    group: 'Pages',
  },
  versions: true,
  access: {
    read: anyone,
    update: authenticated,
  },
  hooks: {
    afterChange: [() => revalidateSite()],
  },
  fields: withSectionVisibility([
    {
      type: 'group',
      name: 'hero',
      label: 'Hero',
      fields: [
        { name: 'eyebrow', type: 'text', defaultValue: 'Privacy' },
        { name: 'title', type: 'text', defaultValue: 'Privacy Policy', required: true },
      ],
    },
    {
      name: 'lastUpdated',
      type: 'date',
      label: 'Last updated',
      required: true,
      admin: {
        description: 'Shown under the page title, e.g. "Last updated: 18 November 2026".',
        date: {
          pickerAppearance: 'dayOnly',
          displayFormat: 'd MMM yyyy',
        },
      },
    },
    {
      name: 'body',
      type: 'richText',
      label: 'Policy text',
      required: true,
      admin: {
        description:
          'One h2 per numbered section. The page derives each section anchor from the heading, so numbering and order come from this text.',
      },
    },
    {
      name: 'meta',
      type: 'group',
      label: 'SEO',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'description', type: 'textarea' },
      ],
    },
  ]),
}
