import type { GlobalConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { revalidateSite } from '../hooks/revalidate'

export const Header: GlobalConfig = {
  slug: 'header',
  label: 'Header',
  admin: {
    group: 'Configuration',
  },
  versions: true,
  access: {
    read: anyone,
    update: authenticated,
  },
  hooks: {
    afterChange: [() => revalidateSite()],
  },
  fields: [
    {
      type: 'group',
      name: 'labels',
      label: 'Navigation labels',
      fields: [
        { name: 'home', type: 'text', required: true, defaultValue: 'Home' },
        { name: 'capabilities', type: 'text', required: true, defaultValue: 'Capabilities' },
        { name: 'process', type: 'text', required: true, defaultValue: 'Process' },
        { name: 'quality', type: 'text', required: true, defaultValue: 'Quality' },
        { name: 'projects', type: 'text', required: true, defaultValue: 'Projects' },
        { name: 'products', type: 'text', required: true, defaultValue: 'Products' },
        { name: 'team', type: 'text', required: true, defaultValue: 'Team' },
        { name: 'contact', type: 'text', required: true, defaultValue: 'Contact' },
      ],
    },
    {
      name: 'ctaLabel',
      type: 'text',
      required: true,
      defaultValue: 'Request a Quote',
    },
    {
      name: 'ctaHref',
      type: 'text',
      required: true,
      defaultValue: '/quote',
    },
    {
      type: 'group',
      label: 'Top strip',
      admin: {
        description:
          'The slim bar above the header. Turn it off to hide the bar entirely; the phone number and email are reused from Site Settings → Contact.',
      },
      fields: [
        {
          name: 'showTopStrip',
          type: 'checkbox',
          defaultValue: true,
          admin: {
            description: 'Show the location and contact strip above the header.',
          },
        },
        {
          name: 'topStripLocations',
          type: 'array',
          label: 'Locations',
          maxRows: 4,
          admin: {
            description:
              'Office locations shown on the left of the strip, e.g. "Sydney, Australia". Leave empty to show no locations.',
            initCollapsed: true,
          },
          fields: [
            {
              name: 'label',
              type: 'text',
              required: true,
            },
          ],
        },
      ],
    },
  ],
}
