import { GuestQuote } from './components/GuestQuote';

/**
 * `/quote` — the public Guest quote page (spec docs/specs/quote-tiers-guest.md, plan G-a).
 *
 * No sign-in and no price anywhere: the page imports `@sq/core/domain` only, and its bridge forwards
 * the public Guest routes and nothing else.
 */
export default function QuotePage() {
  return <GuestQuote />;
}
