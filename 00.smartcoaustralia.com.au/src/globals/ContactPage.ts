import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

/**
 * Contact page copy. The offices themselves (addresses, phones, hours and map
 * coordinates) live in the `offices` collection; this global holds the hero,
 * the quick-contact cards, the "what happens next" steps, the quote prompt and
 * the enquiry form's labels.
 *
 * The form posts to `/api/inquiries` with `type: 'contact'`. The office select
 * is fixed (its values are stored in the inquiries collection), so
 * `enquiryTypes` is the only select whose options an editor can change.
 */
export const ContactPage: GlobalConfig = {
  slug: 'contact-page',
  label: 'Contact Page',
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
        {
          name: 'linkLabel',
          type: 'text',
          admin: {
            description:
              'A phrase inside the body that should become a link. Leave empty to render the body as plain text.',
          },
        },
        { name: 'linkHref', type: 'text' },
      ],
    },
    {
      name: 'quickLinks',
      type: 'array',
      label: 'Quick contact cards',
      required: true,
      minRows: 1,
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'value', type: 'text', required: true },
        { name: 'href', type: 'text', required: true },
        { name: 'body', type: 'textarea' },
      ],
    },
    {
      type: 'group',
      name: 'whatsNextIntro',
      label: 'What happens next heading',
      fields: [
        { name: 'eyebrow', type: 'text' },
        { name: 'title', type: 'text', required: true },
      ],
    },
    {
      name: 'whatsNext',
      type: 'array',
      label: 'What happens next steps',
      required: true,
      minRows: 1,
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea', required: true },
      ],
    },
    {
      type: 'group',
      name: 'quotePrompt',
      label: 'Quote form prompt',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'body', type: 'textarea' },
        { name: 'label', type: 'text' },
        { name: 'href', type: 'text' },
      ],
    },
    { name: 'formTitle', type: 'text', label: 'Form heading', required: true },
    { name: 'formIntro', type: 'textarea', label: 'Form introduction', required: true },
    { name: 'formNote', type: 'textarea', label: 'Form note (under the button)', required: true },
    { name: 'consentLabel', type: 'text', label: 'Consent label', required: true },
    { name: 'consentHref', type: 'text', label: 'Consent link', required: true },
    { name: 'successHeading', type: 'text', label: 'Success heading', required: true },
    { name: 'successBody', type: 'textarea', label: 'Success body', required: true },
    {
      name: 'enquiryTypes',
      type: 'array',
      label: 'Enquiry type options',
      required: true,
      minRows: 1,
      fields: [{ name: 'label', type: 'text', required: true }],
    },
    metaField,
  ]),
}
