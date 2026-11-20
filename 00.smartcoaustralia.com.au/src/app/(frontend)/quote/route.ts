import { quoteAppUrl } from '@/lib/quote'

/**
 * The quote form moved to the SmartQuote web app. Links rendered by this site
 * already point there (see `resolveHref`); this keeps old bookmarks and search
 * results working, forwarding their query (UTM tags) to the app.
 *
 * 307, not 308: the app's address is environment config and may change, and a
 * permanent redirect would stay cached in visitors' browsers.
 */
export function GET(request: Request): Response {
  const incoming = new URL(request.url).searchParams
  return Response.redirect(quoteAppUrl(incoming), 307)
}
