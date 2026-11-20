import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

export const ProcessPage: GlobalConfig = {
  slug: 'process-page',
  label: 'Process Page',
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
      name: 'steps',
      type: 'array',
      label: 'Steps',
      required: true,
      minRows: 1,
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea', required: true },
      ],
    },
    {
      type: 'group',
      name: 'cta',
      label: 'Hero actions',
      fields: [
        { name: 'primaryLabel', type: 'text', required: true },
        { name: 'primaryHref', type: 'text', required: true },
        { name: 'secondaryLabel', type: 'text', required: true },
        { name: 'secondaryHref', type: 'text', required: true },
      ],
    },
    metaField,
  ]),
}
