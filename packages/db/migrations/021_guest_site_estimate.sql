-- Guest request: the wind/hazard estimate the page showed, and the flags that say "an estimator
-- should look at this".
--
-- Both are **derived** values, computed by the server at send time (plan G-a2 §3.4). The page may
-- display an estimate, but what is stored is what the server recomputed: a browser that sent a
-- different `siteEstimate` cannot change the record, and a design edited after the estimate was
-- drawn cannot leave the two disagreeing.
--
-- `site_estimate_json`: {region, regionSource, buildingClass, enclosure, importanceLevel, windSpeedMs?}
--   `region` is 'A' | 'B' | 'C' | 'D' | null. Null means "near a boundary, or the address could not be
--   placed" — the honest answer, and the reason the page says "confirmed in your quote".
--   **No coordinates are stored**: Google's Places policy permits keeping the place ID only, and the
--   region is a derived value rather than a Places field (docs/research/places-location-sku.md).
--
-- `review_flags`: a JSON array of 'pitch' | 'bay' | 'span' — the places inside the page's own limits
-- that the price book does not state (Q4: a 5° skillion; Q6: a 5.9 m carport bay). Null when the
-- design is entirely inside the book.
--
-- Both columns are nullable so every row written before this migration still reads.

ALTER TABLE guest_requests ADD COLUMN IF NOT EXISTS site_estimate_json TEXT;
ALTER TABLE guest_requests ADD COLUMN IF NOT EXISTS review_flags TEXT;
