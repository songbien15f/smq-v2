-- 012 — the frame cut list, frozen with the revision.
--
-- The desktop prints a Steelwork Schedule: one row per member (main column, end-wall column,
-- main rafter, end-wall rafter, knee brace) with the section the design chose, the cut length
-- and how many the building has. It is the sheet a workshop builds from, so it has to be the
-- steel *this* revision was quoted on — not what today's price book or today's factory profile
-- would choose.
--
-- It is stored rather than recomputed for the same reason the BOM is: `price_book_hash` and
-- `settings_version` record what the quote rested on, and the profile that picked the sections
-- can change next month. A cut list that silently follows the new profile would disagree with the
-- order it sits beside.
--
-- The dialect files re-create the append-only trigger so this column is frozen too.

ALTER TABLE quote_revisions ADD COLUMN members_json TEXT NOT NULL DEFAULT '[]';

-- The preview carries the same list, so a save copies the cut list the operator was looking at
-- rather than rebuilding it under a factory profile that may have moved in the last half hour.
ALTER TABLE evaluations ADD COLUMN members_json TEXT NOT NULL DEFAULT '[]';
