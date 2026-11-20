import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

/**
 * Quote page copy. The form itself posts to `/api/inquiries`, so nothing here
 * holds the submitted data — only the hero, the three steps, the online-tool
 * slot, the fallback phone numbers and the form labels/options an editor may
 * want to adjust.
 */
export const QuotePage: GlobalConfig = {
  slug: 'quote-page',
  label: 'Quote Page',
  admin: {
    group: 'Pages',
    // The quote form moved to the SmartQuote web app (see src/lib/quote.ts). The
    // global stays registered so its tables and copy survive without a migration.
    hidden: true,
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
      name: 'stepsIntro',
      label: 'Steps heading',
      fields: [
        { name: 'eyebrow', type: 'text' },
        { name: 'title', type: 'text', required: true },
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
      name: 'tool',
      label: 'Online quote tool slot',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea', required: true },
        { name: 'label', type: 'text', required: true },
        {
          name: 'href',
          type: 'text',
          required: true,
          admin: {
            description: 'An http(s) URL activates the button; any other value renders it disabled.',
          },
        },
      ],
    },
    {
      type: 'group',
      name: 'fallback',
      label: 'Talk to a person',
      fields: [
        { name: 'lead', type: 'text', required: true },
        { name: 'phoneAU', type: 'text', required: true },
        { name: 'phoneVN', type: 'text', required: true },
      ],
    },
    {
      type: 'group',
      name: 'form',
      label: 'Form copy',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'intro', type: 'textarea', required: true },
        { name: 'formNote', type: 'textarea', required: true },
        { name: 'consentLabel', type: 'text', required: true },
        { name: 'consentHref', type: 'text', required: true },
        { name: 'successHeading', type: 'text', required: true },
        { name: 'successBody', type: 'textarea', required: true },
      ],
    },
    {
      name: 'projectTypes',
      type: 'array',
      label: 'Project type options',
      required: true,
      minRows: 1,
      fields: [{ name: 'label', type: 'text', required: true }],
    },
    {
      name: 'tonnageOptions',
      type: 'array',
      label: 'Tonnage options',
      required: true,
      minRows: 1,
      fields: [{ name: 'label', type: 'text', required: true }],
    },
    metaField,
  ]),
}
