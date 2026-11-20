import type { CollectionConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { revalidateSite } from '../hooks/revalidate'

export const Offices: CollectionConfig = {
  slug: 'offices',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'role', 'phone', 'order'],
    group: 'Content',
  },
  access: {
    read: anyone,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  hooks: {
    afterChange: [() => revalidateSite()],
    afterDelete: [() => revalidateSite()],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'countryCode',
      type: 'select',
      required: true,
      options: [
        { label: 'Australia', value: 'AU' },
        { label: 'Vietnam', value: 'VN' },
      ],
    },
    { name: 'role', type: 'text' },
    {
      name: 'addressLines',
      type: 'text',
      hasMany: true,
    },
    { name: 'phone', type: 'text' },
    { name: 'email', type: 'email' },
    {
      name: 'hours',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'value', type: 'text', required: true },
      ],
    },
    { name: 'lat', type: 'number' },
    { name: 'lng', type: 'number' },
    { name: 'directionsUrl', type: 'text' },
    { name: 'order', type: 'number', defaultValue: 0 },
  ],
}
