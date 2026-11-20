import { cache } from 'react'

import type { Office, ProductGroup, Project, TeamMember } from '../payload-types'
import { payloadClient } from './payload'

const publishedOnly = { _status: { equals: 'published' } } as const

export const getProjects = cache(async (): Promise<Project[]> => {
  const payload = await payloadClient()
  const { docs } = await payload.find({
    collection: 'projects',
    where: publishedOnly,
    sort: 'order',
    limit: 100,
    depth: 2,
    draft: false,
  })

  return docs as Project[]
})

export const getProjectBySlug = cache(async (slug: string): Promise<Project | null> => {
  const payload = await payloadClient()
  const { docs } = await payload.find({
    collection: 'projects',
    where: { slug: { equals: slug }, _status: { equals: 'published' } },
    limit: 1,
    depth: 2,
  })

  return (docs[0] as Project | undefined) ?? null
})

export const getOffices = cache(async (): Promise<Office[]> => {
  const payload = await payloadClient()
  const { docs } = await payload.find({
    collection: 'offices',
    sort: 'order',
    limit: 100,
    depth: 0,
  })

  return docs as Office[]
})

export const getTeamMembers = cache(async (): Promise<TeamMember[]> => {
  const payload = await payloadClient()
  const { docs } = await payload.find({
    collection: 'team-members',
    where: publishedOnly,
    sort: 'order',
    limit: 100,
    depth: 1,
    draft: false,
  })

  return docs as TeamMember[]
})

export const getProductGroups = cache(async (): Promise<ProductGroup[]> => {
  const payload = await payloadClient()
  const { docs } = await payload.find({
    collection: 'product-groups',
    where: publishedOnly,
    sort: 'order',
    limit: 100,
    depth: 1,
    draft: false,
  })

  return docs as ProductGroup[]
})
