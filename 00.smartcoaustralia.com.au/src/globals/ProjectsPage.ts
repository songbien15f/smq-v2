import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

/**
 * Projects page copy. The projects themselves live in the projects collection;
 * filter labels and option values are constants in `src/lib/labels.ts`, so this
 * global holds only the page hero (including its section heading) and the
 * closing note.
 */
export const ProjectsPage: GlobalConfig = {
  slug: 'projects-page',
  label: 'Projects Page',
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
        { name: 'secondaryLabel', type: 'text', required: true },
        { name: 'secondaryHref', type: 'text', required: true },
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
      ],
    },
    {
      type: 'group',
      name: 'note',
      label: 'Closing note',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea', required: true },
        { name: 'linkLabel', type: 'text' },
        { name: 'linkHref', type: 'text' },
      ],
    },
    metaField,
  ]),
}
