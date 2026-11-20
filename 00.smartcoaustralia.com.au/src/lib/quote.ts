/**
 * Quotes are taken by the SmartQuote web app (the guest flow at `/quote` on the
 * app's own origin), not by this site. Editors keep writing `/quote` in CMS link
 * fields; `resolveHref` swaps that for the app URL at render time, and the
 * `/quote` route on this site redirects there for anything that slips through
 * (old bookmarks, search results).
 *
 * Read per request, not inlined at build, so one Docker image serves every
 * environment: set `QUOTE_APP_URL` to the app's guest entry point.
 */
const DEFAULT_QUOTE_APP_URL = 'http://localhost:3063/quote?step=start'

/** Tag that tells the app the visitor came from the company site. */
const SOURCE = 'intro'

/**
 * The app's guest quote URL, carrying `src=intro` plus any query the caller
 * passes along (UTM tags, a pre-selected building type).
 */
export function quoteAppUrl(extra?: URLSearchParams): string {
  const url = new URL(process.env.QUOTE_APP_URL?.trim() || DEFAULT_QUOTE_APP_URL)
  extra?.forEach((value, key) => url.searchParams.set(key, value))
  if (!url.searchParams.has('step')) url.searchParams.set('step', 'start')
  if (!url.searchParams.has('src')) url.searchParams.set('src', SOURCE)
  return url.toString()
}

/** `/quote` or `/quote?…` (as stored in CMS link fields) → the app URL; anything else unchanged. */
export function resolveHref(href: string): string
export function resolveHref(href: string | null | undefined): string | null | undefined
export function resolveHref(href: string | null | undefined) {
  if (!href) return href
  const match = /^\/quote\/?(?:\?(.*))?$/.exec(href.trim())
  if (!match) return href
  return quoteAppUrl(new URLSearchParams(match[1] ?? ''))
}
