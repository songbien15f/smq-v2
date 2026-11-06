-- 015 — no dialect difference: the column is TEXT in both, and there is no index to create.
--
-- This file exists because the runner records dialect extras under `<prefix>@dialect`; an empty
-- portable file with no dialect half would be applied but leave no trace of the dialect pass.
SELECT 1;
