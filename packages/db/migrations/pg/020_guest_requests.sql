-- The Guest request number (`GR-000123`), Postgres-only (plan G-a P2).
--
-- A sequence rather than MAX(number)+1: two guests sending at once must never get the same
-- number, and a sequence hands them out without a lock. Gaps (a rolled-back insert) are fine.
--
-- OWNED BY the column on purpose: the test reset (`dropAllTablesForTests`) drops tables, not
-- sequences, so an owned sequence goes with its table and the next run starts again at 1.
CREATE SEQUENCE IF NOT EXISTS guest_request_seq OWNED BY guest_requests.number;
