-- 018 — the price book's bytes live in Postgres; the file on disk is a cache.
--
-- ## Why
--
-- A book is a content-addressed SQLite file in `data/price-books/<hash>.db` (DECISIONS A4). It was
-- the only copy: `pg_dump` did not contain it, so losing the volume — or starting a second instance
-- against the same database — left `openBook` throwing `BookMissingError` and **every evaluation
-- failing**. The book is an immutable artefact of about 3 MB, small enough to keep whole, and keeping
-- it whole means nothing in the engine has to change.
--
-- ## Two hashes, and why they are not the same
--
-- `hash` is the book's **identity**: the SHA-256 of the dump the book was built from, which is what
-- `price_books.hash` and every saved revision's `price_book_hash` already mean. `file_sha256` is the
-- digest of the **`.db` bytes stored here**, and it is what `ensureBookOnDisk` checks before writing
-- the file back out. They differ because the same dump can produce a different SQLite file (page
-- ordering, padding), and a revision names the former while integrity needs the latter.

CREATE TABLE IF NOT EXISTS price_book_files (
  hash         TEXT PRIMARY KEY,
  file_sha256  TEXT NOT NULL,
  bytes        BYTEA NOT NULL,
  size_bytes   INTEGER NOT NULL,
  stored_at    TEXT NOT NULL
);
