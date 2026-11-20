/**
 * Image source guards shared by server and client components.
 *
 * Payload media documents expose a `url`, but globals and relations can also be
 * missing, still uploading, or hand-edited. Anything that is not a non-empty
 * string rooted at `/` or `http` cannot be rendered by next/image.
 */

export function hasUsableImage(src: unknown): src is string {
  if (typeof src !== 'string') return false
  const value = src.trim()
  return value.startsWith('/') || value.startsWith('http')
}

/** The public URL of a media document, or null when it has none. */
export function mediaUrl(media: unknown): string | null {
  if (!media || typeof media !== 'object') return null
  const url = (media as { url?: unknown }).url
  return hasUsableImage(url) ? url : null
}
