import { revalidatePath } from 'next/cache'

/**
 * Revalidate the whole site after content changes.
 *
 * `revalidatePath` only works inside a Next.js request. The same hooks also run
 * from seed scripts and Payload CLI commands, where no request store exists, so
 * the call is allowed to be a no-op there.
 */
export function revalidateSite() {
  try {
    revalidatePath('/', 'layout')
  } catch {
    // Outside a Next.js request: nothing to revalidate.
  }
}
