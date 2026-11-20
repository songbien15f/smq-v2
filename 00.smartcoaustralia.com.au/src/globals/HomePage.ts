import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { metaField } from '../fields/meta'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

export const HomePage: GlobalConfig = {
  slug: 'home-page',
  label: 'Home Page',
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
        { name: 'kicker', type: 'text', required: true },
        { name: 'title', type: 'text', required: true },
        { name: 'highlight', type: 'text' },
        { name: 'lede', type: 'textarea', required: true },
        { name: 'primaryLabel', type: 'text', required: true, defaultValue: 'Request a Quote' },
        { name: 'primaryHref', type: 'text', required: true, defaultValue: '/quote' },
        { name: 'secondaryLabel', type: 'text', required: true },
        { name: 'secondaryHref', type: 'text', required: true },
        { name: 'image', type: 'upload', relationTo: 'media' },
      ],
    },
    {
      name: 'stats',
      type: 'array',
      label: 'Hero stats',
      required: true,
      maxRows: 4,
      fields: [
        { name: 'value', type: 'text', required: true },
        { name: 'suffix', type: 'text' },
        { name: 'label', type: 'text', required: true },
      ],
    },
    {
      name: 'certificationsLabel',
      type: 'text',
      defaultValue: 'Certified & compliant',
    },
    {
      name: 'certifications',
      type: 'array',
      label: 'Certifications',
      fields: [{ name: 'label', type: 'text', required: true }],
    },
    {
      type: 'group',
      name: 'officeSplit',
      label: 'Office split',
      fields: [
        { name: 'eyebrow', type: 'text' },
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea' },
        {
          name: 'offices',
          type: 'array',
          label: 'Office cards',
          maxRows: 2,
          fields: [
            { name: 'code', type: 'text', required: true, label: 'Country code (AU/VN)' },
            { name: 'title', type: 'text', required: true },
            { name: 'body', type: 'textarea', required: true },
          ],
        },
        { name: 'image', type: 'upload', relationTo: 'media' },
        { name: 'imageAlt', type: 'text' },
        { name: 'captionLead', type: 'text', label: 'Figure caption lead-in (bold)' },
        { name: 'caption', type: 'textarea', label: 'Figure caption' },
      ],
    },
    {
      type: 'group',
      name: 'exploreIntro',
      label: 'Explore section heading',
      fields: [
        { name: 'eyebrow', type: 'text' },
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea' },
      ],
    },
    {
      name: 'exploreCards',
      type: 'array',
      label: 'Explore cards',
      maxRows: 6,
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'textarea' },
        { name: 'ctaLabel', type: 'text', required: true },
        { name: 'href', type: 'text', required: true },
      ],
    },
    {
      type: 'group',
      name: 'featuredSection',
      label: 'Featured project labels',
      fields: [
        { name: 'eyebrow', type: 'text', defaultValue: 'Featured Project' },
        { name: 'ctaLabel', type: 'text', defaultValue: 'View Project Details' },
      ],
    },
    metaField,
  ]),
}
