import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { revalidateSite } from '../hooks/revalidate'
import { withSectionVisibility } from '../fields/visible'

/**
 * The project detail template.
 *
 * Everything on a project page that is not the project itself. The template
 * renders the same three delivery stages, the same QA pack, and the same three
 * fabrication/standards/delivery facts on every project, so those live here
 * rather than being duplicated into each project document. Location, sector and
 * structure stay on the project.
 */
export const ProjectDetailSettings: GlobalConfig = {
  slug: 'project-detail-settings',
  label: 'Project detail',
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
      name: 'stagesIntro',
      type: 'textarea',
      label: 'How it was delivered — intro',
    },
    {
      name: 'stages',
      type: 'array',
      label: 'Delivery stages',
      minRows: 3,
      maxRows: 6,
      labels: { singular: 'Stage', plural: 'Stages' },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'text', type: 'textarea', required: true },
        { name: 'image', type: 'upload', relationTo: 'media' },
      ],
    },
    {
      name: 'qaIntro',
      type: 'textarea',
      label: 'QA documentation supplied — intro',
    },
    {
      name: 'qaDocs',
      type: 'array',
      label: 'QA documents',
      labels: { singular: 'QA document', plural: 'QA documents' },
      fields: [{ name: 'label', type: 'text', required: true }],
    },
    {
      name: 'facts',
      type: 'array',
      label: 'Project-independent facts',
      admin: {
        description:
          'Added to every project’s facts card after Location, Sector and Structure.',
      },
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'value', type: 'text', required: true },
      ],
    },
    {
      name: 'priceCta',
      type: 'text',
      label: 'Price call-to-action',
      defaultValue: 'Price a Similar Project',
    },
    {
      name: 'contactPromptLead',
      type: 'text',
      label: 'Contact prompt — question',
    },
    {
      name: 'contactPromptLabel',
      type: 'text',
      label: 'Contact prompt — link label',
    },
  ]),
}
