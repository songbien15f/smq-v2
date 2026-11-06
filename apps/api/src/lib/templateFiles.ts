/**
 * Template `.sqd` files, stored once and verified on every read.
 *
 * ## Why a template needs a file at all
 *
 * A template's `config_json` carries the building — dimensions, options, colours — which is enough
 * to *clone* it. It is not enough to **transport** it: a `.sqd` is the desktop's own format, and an
 * operator who wants a template in their old app needs the file, not a JSON blob they cannot open.
 * The licence server held these files; this is the replacement.
 *
 * ## Three rules, and why each one exists
 *
 * **1. The hash is over the bytes, not over a canonical form.** Content-addressed storage — S3's
 * `x-amz-checksum-sha256`, Git's blobs, `npm`'s integrity field — hashes exactly what is stored, so
 * a reader can verify without knowing how the producer serialised it. The desktop-vs-v2 question
 * "did anyone change this file" is answered only by the bytes. (The `Integrity` block *inside* a
 * `.sqd`, which hashes canonical JSON, is a different mechanism for a different question and is not
 * this module.)
 *
 * **2. A read that does not match its hash is refused, not returned.** A corrupted `.sqd` that gets
 * through is a company opening a quote that looks plausible and is wrong. `readVerified` answers
 * `null` with a reason rather than the bytes.
 *
 * **3. A path from the database is not trusted.** `rel_path` is written by this module, but a
 * database is something people edit by hand and restore from backups. Every read resolves the path
 * and then checks the result is still **inside** the template-files directory; a `rel_path` of
 * `../../.env` resolves outside and is refused. This is the same defence `documents.ts` uses for
 * `LOGO_FILE`, and it is checked here rather than at the call site so a future route cannot forget.
 *
 * ## Never overwrite
 *
 * Each upload is a **new file revision**, named by its row id. Replacing a template's bytes in place
 * would silently change every quote already cloned from it, and make the hash column a lie. The
 * active revision is a pointer (`quote_templates.active_file_revision_id`), so rolling back is
 * pointing at an older row rather than restoring a backup.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { resolveFromRoot } from '@sq/db';

/**
 * Where template files live. Relative paths resolve from the workspace root, like every other
 * configured directory, so a deployment can move `data/` without a code change.
 */
export function templateFilesDir(): string {
  return resolveFromRoot(process.env.TEMPLATE_FILES ?? './data/template-files');
}

/** The SHA-256 of a buffer, lowercase hex — the one spelling this codebase stores. */
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A stored file, as a row of `quote_template_files` needs it. */
export interface StoredFile {
  /** Relative to the template-files directory: `<templateId>/<fileId>.sqd`. */
  relPath: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Write one file revision, and report what to record.
 *
 * The directory is created on first write rather than at boot: a deployment that never uses
 * templates should not carry an empty directory, and `mkdir` with `recursive` is idempotent.
 */
export async function storeFile(input: {
  templateId: string;
  fileId: string;
  bytes: Buffer;
}): Promise<StoredFile> {
  const root = templateFilesDir();
  const directory = join(root, input.templateId);
  mkdirSync(directory, { recursive: true });

  const name = `${input.fileId}.sqd`;
  const absolute = join(directory, name);
  await writeFile(absolute, input.bytes);

  return {
    // Stored with forward slashes even on Windows: the column is a portable path, and a row
    // written on one platform has to be readable on another.
    relPath: `${input.templateId}/${name}`,
    sha256: sha256Hex(input.bytes),
    sizeBytes: input.bytes.length,
  };
}

/** What a verified read produced, or why it did not. */
export type VerifiedRead =
  | { ok: true; bytes: Buffer; sha256: string }
  | { ok: false; reason: 'missing' | 'unreadable' | 'mismatch'; message: string };

/**
 * Read a stored file and prove it is the file that was stored.
 *
 * `expectedHash` comes from the database row. A mismatch is answered as `mismatch` with both hashes
 * in the message, because "the file is corrupt" without the two values gives an operator nothing to
 * compare against a backup.
 */
export async function readVerified(relPath: string, expectedHash: string): Promise<VerifiedRead> {
  const root = templateFilesDir();
  // `resolve` collapses `..`, so the containment check below sees the real destination rather than
  // the spelling. Comparing the *resolved* path is what makes `../../.env` fail.
  const absolute = resolve(root, relPath);

  if (!isInside(absolute, root)) {
    return {
      ok: false,
      reason: 'unreadable',
      message: 'That file path points outside the template store, so it was not opened.',
    };
  }

  if (!existsSync(absolute)) {
    return {
      ok: false,
      reason: 'missing',
      message: 'That template file is recorded but no longer on disk. Upload it again.',
    };
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch {
    return {
      ok: false,
      reason: 'unreadable',
      message: 'That template file could not be read from disk.',
    };
  }

  const actual = sha256Hex(bytes);
  if (actual !== expectedHash) {
    return {
      ok: false,
      reason: 'mismatch',
      message: `That template file does not match its recorded checksum, so it was not sent (recorded ${expectedHash.slice(0, 12)}…, found ${actual.slice(0, 12)}…). Upload it again.`,
    };
  }

  return { ok: true, bytes, sha256: actual };
}

/**
 * True when `candidate` is inside `root`.
 *
 * Compares with a trailing separator so a sibling directory whose name merely *starts* with the
 * root's name (`/data/template-files-old`) is not mistaken for a child. And the root itself is
 * allowed, because a path is never legitimately the directory — but refusing it would be a
 * confusing special case later.
 */
function isInside(candidate: string, root: string): boolean {
  const normalRoot = resolve(root);
  const normalCandidate = resolve(candidate);
  if (normalCandidate === normalRoot) return false;
  return normalCandidate.startsWith(normalRoot + sep);
}
