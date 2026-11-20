import type { Field } from 'payload'

/**
 * The SEO copy every page global carries: an optional title and description.
 *
 * Empty values are not an error — each page falls back to its own hard-coded
 * copy — but the fallbacks live in code, so the group stays optional and an
 * editor only fills in what differs from the defaults.
 */
export const metaField: Field = {
  name: 'meta',
  type: 'group',
  label: 'SEO',
  admin: {
    description:
      'Optional. Leave a field empty to use the page default. The site name is added to the title automatically.',
  },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'description', type: 'textarea' },
  ],
}
