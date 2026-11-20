import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

export const CapabilitiesPage: GlobalConfig = {
  slug: 'capabilities-page',
  label: 'Capabilities Page',
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
      label: 'Intro',
      fields: [
        { name: 'eyebrow', type: 'text' },
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea' },
      ],
    },
    {
      name: 'capabilities',
      type: 'array',
      label: 'Capabilities',
      required: true,
      minRows: 1,
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea', required: true },
        {
          name: 'features',
          type: 'array',
          label: 'Feature bullets',
          fields: [{ name: 'text', type: 'text', required: true }],
        },
        { name: 'image', type: 'upload', relationTo: 'media' },
      ],
    },
    metaField,
  ]),
}
