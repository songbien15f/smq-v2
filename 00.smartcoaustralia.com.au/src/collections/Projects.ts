import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'
import { publishedOrAuthenticated } from '../access/publishedOrAuthenticated'
import { revalidateSite } from '../hooks/revalidate'

/**
 * Only one project may carry the featured flag, and only published state counts.
 *
 * `beforeChange` also runs for autosave and explicit draft saves, which submit the
 * full form (including `featured`). A draft write must never clear the published
 * featured project, so draft writes return early and uniqueness is enforced only
 * when the incoming write is published.
 */
const ensureSingleFeatured: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data?.featured) return data
  if (data._status === 'draft') return data

  const currentId = originalDoc?.id ?? data.id

  // A single adapter-level bulk update: no per-document hooks, no version rows and
  // therefore no N whole-site revalidations from clearing the other projects.
  // Trade-off: the cleared document's latest version row keeps its old `featured`
  // value until it is next saved, but every reader (getProjects, pickFeatured) reads
  // published rows, so the flag is never observed stale on the site.
  await req.payload.db.updateMany({
    collection: 'projects',
    where: {
      featured: { equals: true },
      ...(currentId ? { id: { not_equals: currentId } } : {}),
    },
    data: { featured: false, updatedAt: new Date().toISOString() },
    req,
  })

  return data
}

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'state', 'sector', 'featured', 'order'],
    group: 'Content',
  },
  versions: {
    drafts: { autosave: { interval: 375 } },
    maxPerDoc: 25,
  },
  access: {
    read: publishedOrAuthenticated,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  hooks: {
    beforeChange: [ensureSingleFeatured],
    afterChange: [() => revalidateSite()],
    afterDelete: [() => revalidateSite()],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'location', type: 'text', required: true },
    {
      name: 'state',
      type: 'select',
      options: [
        { label: 'NSW', value: 'NSW' },
        { label: 'QLD', value: 'QLD' },
        { label: 'SA', value: 'SA' },
        { label: 'WA', value: 'WA' },
        { label: 'VIC', value: 'VIC' },
        { label: 'TAS', value: 'TAS' },
        { label: 'NT', value: 'NT' },
        { label: 'ACT', value: 'ACT' },
        { label: 'PNG', value: 'PNG' },
      ],
    },
    {
      name: 'sector',
      type: 'select',
      options: [
        { label: 'Industrial', value: 'industrial' },
        { label: 'Agricultural', value: 'agricultural' },
        { label: 'Community', value: 'community' },
      ],
    },
    { name: 'structure', type: 'text' },
    { name: 'intro', type: 'textarea' },
    {
      name: 'cardSummary',
      type: 'textarea',
      admin: {
        description:
          'Short paragraph shown on this project inside the projects grid. Leave empty to reuse the intro above.',
      },
    },
    {
      name: 'cardTag',
      type: 'text',
      admin: {
        description:
          'Third chip in the projects-grid card meta row, after sector and structure (e.g. "Door-to-door delivery"). Leave empty to show only two chips.',
      },
    },
    { name: 'overview', type: 'richText' },
    {
      name: 'scope',
      type: 'text',
      hasMany: true,
      maxRows: 12,
    },
    {
      name: 'facts',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'value', type: 'text', required: true },
      ],
    },
    { name: 'heroImage', type: 'upload', relationTo: 'media', required: true },
    {
      name: 'gallery',
      type: 'array',
      maxRows: 8,
      fields: [{ name: 'image', type: 'upload', relationTo: 'media', required: true }],
    },
    { name: 'featured', type: 'checkbox', defaultValue: false },
    { name: 'order', type: 'number', defaultValue: 0 },
    {
      name: 'meta',
      type: 'group',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'description', type: 'textarea' },
      ],
    },
  ],
}
