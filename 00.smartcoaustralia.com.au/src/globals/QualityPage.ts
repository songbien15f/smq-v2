import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

export const QualityPage: GlobalConfig = {
  slug: 'quality-page',
  label: 'Quality Page',
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
      name: 'photoVisible',
      type: 'checkbox',
      label: 'Show this section',
      defaultValue: true,
      admin: {
        description:
          'Turn off to hide the photo and its caption on the public website. The image stays uploaded.',
      },
    },
    {
      name: 'image',
      type: 'upload',
      label: 'Quality photo',
      relationTo: 'media',
    },
    {
      name: 'imageCaption',
      type: 'textarea',
      label: 'Photo caption',
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
      name: 'qaItems',
      type: 'array',
      label: 'QA documents',
      required: true,
      minRows: 1,
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'description', type: 'text', required: true },
      ],
    },
    {
      type: 'group',
      name: 'managementSystems',
      label: 'Management systems note',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea', required: true },
      ],
    },
    metaField,
  ]),
}
