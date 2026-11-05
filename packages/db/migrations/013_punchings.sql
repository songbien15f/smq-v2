-- 013 — the punching detail, frozen with the revision.
--
-- The desktop prints a Punching Detail: for each frame member, where the holes for the knee, the
-- haunch and the apex sit, in millimetres from each end, with the hole size and the punch centre.
--
-- Every offset comes from the price book's connector tables (`kneeedge`, `cost_apex`,
-- `cost_haunch`) keyed by the section's web. That means a book revision can move a hole, and a
-- sheet that followed it would no longer match the member already cut from the previous one. So it
-- is stored beside the BOM, for the same reason the BOM is.
--
-- Empty array means "this book cannot name the connectors", which is a sheet that is not printed —
-- not a sheet with guessed offsets.
--
-- The dialect files re-create the append-only trigger so this column is frozen too.

ALTER TABLE quote_revisions ADD COLUMN punchings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE evaluations ADD COLUMN punchings_json TEXT NOT NULL DEFAULT '[]';
