import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'

export const payloadClient = cache(async () => getPayload({ config }))

export const getGlobal = cache(async <T,>(slug: string): Promise<T> => {
  const payload = await payloadClient()
  return (await payload.findGlobal({ slug: slug as never, depth: 1 })) as T
})
