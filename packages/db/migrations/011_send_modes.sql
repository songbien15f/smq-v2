-- 011 — the four send modes.
--
-- The desktop's "Send Request by Email" has four intents: for a Quote, for Engineering, for
-- Manufacturing, or for both. Each keeps its own counter on the quote, so an operator can see
-- whether a drawing went to the factory and whether engineering ever saw it.
--
-- The counters live on `quotes` because they describe the quote's life, not one email. They are
-- incremented by the send route, in the same transaction as the job, so a failed insert cannot
-- leave a counter claiming a mail that was never queued.
--
-- Portable file: `ALTER TABLE ... ADD COLUMN` is valid in both dialects. The dialect folders
-- carry an index each, because `IF NOT EXISTS` on an index is spelled differently.

ALTER TABLE quotes ADD COLUMN quote_send_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN engineering_send_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN manufacturing_send_count INTEGER NOT NULL DEFAULT 0;
