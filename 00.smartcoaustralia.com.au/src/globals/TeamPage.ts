import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

/**
 * Team page copy. The people themselves live in the `team-members` collection;
 * this global holds the page hero, the section heading and the closing quote
 * band (photo, caption and an optional attribution).
 */
export const TeamPage: GlobalConfig = {
  slug: 'team-page',
  label: 'Team Page',
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
        { name: 'eyebrow', type: 'text', required: true },
        { name: 'title', type: 'text', required: true },
        { name: 'lede', type: 'textarea', required: true },
        { name: 'primaryLabel', type: 'text', required: true },
        { name: 'primaryHref', type: 'text', required: true },
      ],
    },
    {
      type: 'group',
      name: 'intro',
      label: 'Section heading',
      fields: [
        { name: 'eyebrow', type: 'text' },
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea' },
      ],
    },
    {
      type: 'group',
      name: 'quote',
      label: 'Quote band',
      fields: [
        { name: 'text', type: 'textarea', required: true },
        { name: 'attribution', type: 'text' },
        { name: 'image', type: 'upload', relationTo: 'media' },
        { name: 'imageAlt', type: 'text', label: 'Photo alt text' },
      ],
    },
    metaField,
  ]),
}
