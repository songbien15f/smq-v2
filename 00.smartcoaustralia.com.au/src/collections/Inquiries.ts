import type { CollectionConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'

/**
 * Every quote request and contact message, stored before the email attempt.
 *
 * The public form only ever creates; reading and correcting an inquiry is an
 * authenticated admin action. `submissionId` is the client-generated idempotency
 * key: a double-click or a retried request resolves to the same row instead of
 * a second one.
 */
export const Inquiries: CollectionConfig = {
  slug: 'inquiries',
  labels: {
    singular: 'Inquiry',
    plural: 'Inquiries',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['type', 'name', 'email', 'status', 'createdAt'],
    group: 'Inbox',
    description: 'Quote requests and contact messages received from the website.',
  },
  access: {
    create: anyone,
    read: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  fields: [
    {
      name: 'type',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Quote request', value: 'quote' },
        { label: 'Contact message', value: 'contact' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'new',
      index: true,
      options: [
        { label: 'New', value: 'new' },
        { label: 'Read', value: 'read' },
        { label: 'Replied', value: 'replied' },
        { label: 'Archived', value: 'archived' },
      ],
    },
    { name: 'name', type: 'text', required: true },
    { name: 'company', type: 'text' },
    { name: 'email', type: 'email', required: true },
    { name: 'phone', type: 'text' },
    {
      type: 'collapsible',
      label: 'Quote details',
      admin: {
        condition: (data) => data?.type === 'quote',
      },
      fields: [
        { name: 'projectType', type: 'text' },
        { name: 'tonnage', type: 'text' },
        { name: 'siteLocation', type: 'text' },
      ],
    },
    {
      type: 'collapsible',
      label: 'Contact details',
      admin: {
        condition: (data) => data?.type === 'contact',
      },
      fields: [
        {
          name: 'office',
          type: 'select',
          options: [
            { label: 'Sydney — Head Office', value: 'sydney' },
            { label: 'Western Australia — Enquiries', value: 'wa' },
            { label: 'Ho Chi Minh City — Vietnam Office', value: 'hcmc' },
          ],
        },
        { name: 'enquiryType', type: 'text' },
      ],
    },
    { name: 'message', type: 'textarea' },
    { name: 'sourcePath', type: 'text' },
    {
      name: 'consent',
      type: 'checkbox',
      required: true,
      defaultValue: true,
    },
    {
      name: 'submissionId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'Client-generated idempotency key for this submission.',
      },
    },
  ],
}
