-- The assistant conversation, copied onto the lead when the request is sent.
--
-- Plan G-g ("Hội thoại đi theo lead"): whoever quotes the request should be able to read what the
-- guest asked the assistant for. The conversation lives in its own tables (`022_guest_assistant.sql`)
-- and those rows are pruned 30 days after they expire; a lead can be quoted months later, so the text
-- is **copied here** at send time rather than read through `assistant_session_id`.
--
-- That choice is why `pnpm assistant:prune` may delete a session that a lead points at: the lead's
-- own copy survives, and the prune nulls the dangling id.
--
-- Plain text, already redacted (no email, mobile or street address), and JSON so the renderer can
-- keep the guest/assistant roles: `[{"role":"guest","text":"…"},…]`.

ALTER TABLE guest_requests ADD COLUMN IF NOT EXISTS assistant_transcript_json TEXT;
