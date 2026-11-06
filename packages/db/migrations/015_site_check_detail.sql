-- 015 — the site's geographic readings, beside the six that drive the design.
--
-- ShedSafe answers with more than the six fields the wind rating needs: shielding, the topographic
-- factor, the snow-load region, the earthquake hazard factor, the elevation, the coordinates, and
-- the rainfall intensities with the town they were read for. None of them prices a shed, so they do
-- not belong in columns the engine reads — but a quote shown next to its certificate has to be
-- checkable against the site it was issued for, and that is what an engineer asks.
--
-- One JSON column rather than nine of them: a rating body that adds a tenth reading next year must
-- not require a migration, and a query never filters on these.
--
-- Column reference: today's six are wide; a revision saved before this has `NULL` here and reads
-- back with no geographic detail, which is honest — the values were never fetched.

ALTER TABLE site_checks ADD COLUMN detail_json TEXT;
