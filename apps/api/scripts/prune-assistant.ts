/**
 * Delete the Guest assistant's sessions once they have expired.
 *
 * ```
 * pnpm assistant:prune
 * ```
 *
 * ## Why expired sessions are deletable even when a lead points at them
 *
 * A lead carries its **own copy** of the conversation (`guest_requests.assistant_transcript_json`,
 * migration 023), written at send time. So deleting the session loses nothing a quotation needs; the
 * only thing left to fix is the dangling `assistant_session_id`, which this nulls first.
 *
 * Choosing this over "never delete a session a lead points at" keeps the assistant's tables bounded
 * without keeping an unbounded amount of chat forever: a session that was never sent is a visitor who
 * left, and a session that was sent is already copied.
 *
 * The turns go with their session by `ON DELETE CASCADE`; nothing else references them.
 *
 * Safe to run at any time, including while the API serves requests: `resolveAssistantSession` treats
 * an expired row as absent already, so deleting it changes no behaviour.
 */

import { dbConfigFromEnv, openDb } from '@sq/db';

async function main(): Promise<void> {
  const db = openDb(dbConfigFromEnv());
  try {
    const at = new Date().toISOString();

    /*
     * Null the reference first, in one statement. Doing it after the delete would need the id list,
     * and doing it never would leave a lead pointing at a row that will not come back.
     */
    const unlinked = await db.run(
      `UPDATE guest_requests
          SET assistant_session_id = NULL
        WHERE assistant_session_id IS NOT NULL
          AND assistant_session_id IN (SELECT id FROM guest_assistant_sessions WHERE expires_at < ?)`,
      [at],
    );

    const before = await db.get<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM guest_assistant_turns',
    );
    const sessions = await db.run('DELETE FROM guest_assistant_sessions WHERE expires_at < ?', [at]);
    const after = await db.get<{ n: number | string }>('SELECT COUNT(*) AS n FROM guest_assistant_turns');

    process.stdout.write(
      `guest assistant: removed ${sessions.changes} expired session(s) and ` +
        `${Number(before?.n ?? 0) - Number(after?.n ?? 0)} turn(s); ` +
        `${unlinked.changes} lead(s) kept their own transcript and lost the session link.\n`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
