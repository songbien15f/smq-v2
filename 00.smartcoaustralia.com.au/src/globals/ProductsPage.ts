import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

/**
 * Products page copy. The product groups themselves live in the `product-groups`
 * collection; this global holds the page hero, the section heading and an
 * optional partner note the template has no copy for (so the field stays empty
 * until an editor fills it).
 */
export const ProductsPage: GlobalConfig = {
  slug: 'products-page',
  label: 'Products Page',
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
      type: 'group',
      name: 'partnerNote',
      label: 'Closing partner note',
      admin: {
        description:
          'Optional. Shown below the product groups; the template has no note here, so leave it empty unless you need one.',
      },
      fields: [
        { name: 'title', type: 'text' },
        { name: 'body', type: 'textarea' },
      ],
    },
    metaField,
  ]),
}
