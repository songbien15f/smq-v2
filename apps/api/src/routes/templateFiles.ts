/**
 * Template `.sqd` files over HTTP: upload, download, history.
 *
 * ## The four routes, and why there is no fifth
 *
 * | Route | Who | What |
 * |---|---|---|
 * | `POST /admin/templates/:id/file` | `platform:templates` | store one revision |
 * | `GET /admin/templates/:id/file` | `platform:templates` | the active revision, verified |
 * | `GET /admin/templates/:id/files` | `platform:templates` | the revision history |
 * | `GET /templates/:id/file` | `quote:write` | the active revision, for a company |
 *
 * The brief named four and this is four: a route keyed on `fileId` would be a fifth way to say
 * what `?revisionId=` already says, and every extra way to reach a file is another place to get
 * the tenant check wrong. A company downloads the **active** revision or a named one; it never
 * lists another company's history.
 *
 * ## Why the company route reports 404 and not 403
 *
 * A template that exists but is not available to this company must look exactly like one that does
 * not exist. A 403 confirms the id is real, which tells a caller — possibly a competitor — that a
 * template of that name is there. The same rule the quote routes already follow.
 *
 * ## Why an upload is validated as a `.sqd` and not stored blind
 *
 * A template file nobody can open is worse than no file: the catalogue says a building is available
 * and the company's desktop refuses it. The bytes go through `readQuoteFileBytes` before they are
 * written, so a `.zip` renamed to `.sqd` is refused at upload rather than at every future download.
 * The file is stored **exactly as uploaded** — the reader is a check, not a rewrite.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { readQuoteFileBytes } from '@sq/core/quoteFile';
import { requireCompanyCapability, requirePlatformCapability } from '../lib/guard.js';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { readVerified, storeFile } from '../lib/templateFiles.js';

/**
 * The largest template file accepted.
 *
 * Under the server's 1 MB body limit with room for base64's 33 % expansion and the JSON envelope,
 * which leaves about 700 KB for the file itself. The largest real `.sqd` in the desktop's own
 * workspace is 97 KB, so this is roughly seven times the biggest thing that exists.
 */
const MAX_UPLOAD_BYTES = 700 * 1024;

interface FileRow {
  id: string;
  template_id: string;
  version_label: string;
  rel_path: string;
  sha256: string;
  size_bytes: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** What the browser posts: the `.sqd` as base64, because this JSON API has no multipart parser. */
const uploadBody = {
  parse(input: unknown): { bytes: Buffer; versionLabel: string; note: string } | null {
    if (typeof input !== 'object' || input === null) return null;
    const record = input as Record<string, unknown>;
    const data = record.data;
    if (typeof data !== 'string' || data === '') return null;
    const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      return null;
    }
    if (bytes.length === 0) return null;
    const label = typeof record.versionLabel === 'string' ? record.versionLabel.trim() : '';
    const note = typeof record.note === 'string' ? record.note.trim() : '';
    return {
      bytes,
      versionLabel: label === '' ? new Date().toISOString().slice(0, 10) : label.slice(0, 40),
      note: note.slice(0, 500),
    };
  },
};

export function registerTemplateFiles(app: FastifyInstance, db: Db): void {
  /**
   * Store one file revision.
   *
   * **Never replaces.** Every upload is a new row and a new file, which is what makes the history
   * real: rolling a template back means pointing `active_file_revision_id` at an older row, not
   * restoring a backup that may not exist.
   */
  app.post<{ Params: { templateId: string } }>(
    '/admin/templates/:templateId/file',
    // The route needs its own limit: `app.ts` caps every body at 1 MB and the default would refuse
    // a legitimate 700 KB file once base64 has grown it.
    { bodyLimit: MAX_UPLOAD_BYTES * 2 },
    async (request, reply) => {
      const session = requirePlatformCapability(request, reply, 'platform:templates');
      if (session === null) return;

      const template = await db.get<{ id: string }>('SELECT id FROM quote_templates WHERE id = ?', [
        request.params.templateId,
      ]);
      if (template === null) return sendFail(reply, 'not_found', 'Not found.');

      const body = uploadBody.parse(request.body);
      if (body === null) return sendFail(reply, 'validation_failed', 'Attach the .sqd file.');

      if (body.bytes.length > MAX_UPLOAD_BYTES) {
        return sendFail(
          reply,
          'validation_failed',
          `That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB. The largest real quote file is under 100 KB, so check you attached the right file.`,
        );
      }

      /*
       * Prove it is a quote file before it is stored. A `.sqd` that nothing can open would sit in
       * the catalogue looking available and fail on every company's first download instead.
       */
      const parsed = readQuoteFileBytes(body.bytes);
      if (parsed.refusal !== undefined) {
        return sendFail(reply, 'validation_failed', parsed.refusal);
      }
      if (parsed.revisions.length === 0) {
        return sendFail(
          reply,
          'validation_failed',
          'That file contains no revisions, so there is nothing for a template to copy.',
        );
      }

      const fileId = newId();
      const stored = await storeFile({
        templateId: request.params.templateId,
        fileId,
        bytes: body.bytes,
      });
      const at = now();

      await db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO quote_template_files
             (id, template_id, version_label, rel_path, sha256, size_bytes, note, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fileId,
            request.params.templateId,
            body.versionLabel,
            stored.relPath,
            stored.sha256,
            stored.sizeBytes,
            body.note === '' ? null : body.note,
            session.email,
            at,
          ],
        );
        // The newest upload becomes the active one; a template with files and no active pointer is
        // a catalogue entry that cannot be downloaded.
        await tx.run(
          'UPDATE quote_templates SET active_file_revision_id = ?, updated_at = ? WHERE id = ?',
          [fileId, at, request.params.templateId],
        );
      });

      return sendOk(
        reply,
        {
          fileId,
          versionLabel: body.versionLabel,
          sha256: stored.sha256,
          sizeBytes: stored.sizeBytes,
          revisions: parsed.revisions.length,
          createdAt: at,
        },
        201,
      );
    },
  );

  /**
   * The verified bytes of one revision — the active one unless `revisionId` names another.
   *
   * `readVerified` refuses a file whose bytes no longer match the recorded hash, and the answer is
   * 409 rather than a download: a corrupted `.sqd` opens as a plausible quote with the wrong
   * numbers, which is the one failure mode this store exists to prevent.
   */
  async function sendRevision(
    reply: Parameters<typeof sendFail>[0],
    file: FileRow,
    filename: string,
  ) {
    const result = await readVerified(file.rel_path, file.sha256);
    if (!result.ok) {
      const code = result.reason === 'missing' ? 'not_found' : 'conflict';
      return sendFail(reply, code, result.message);
    }
    return reply
      .status(200)
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${filename}"`)
      // So the receiving side can verify independently of anything this response says.
      .header('x-content-sha256', result.sha256)
      .send(result.bytes);
  }

  app.get<{ Params: { templateId: string }; Querystring: { revisionId?: string } }>(
    '/admin/templates/:templateId/file',
    async (request, reply) => {
      const session = requirePlatformCapability(request, reply, 'platform:templates');
      if (session === null) return;

      const template = await db.get<{ id: string; code: string; active_file_revision_id: string | null }>(
        'SELECT id, code, active_file_revision_id FROM quote_templates WHERE id = ?',
        [request.params.templateId],
      );
      if (template === null) return sendFail(reply, 'not_found', 'Not found.');

      const wanted = request.query.revisionId ?? template.active_file_revision_id;
      if (wanted === null) {
        return sendFail(reply, 'not_found', 'This template has no file yet. Upload one first.');
      }

      const file = await db.get<FileRow>(
        'SELECT * FROM quote_template_files WHERE id = ? AND template_id = ?',
        [wanted, request.params.templateId],
      );
      if (file === null) return sendFail(reply, 'not_found', 'Not found.');

      return sendRevision(reply, file, `${template.code}-${file.version_label}.sqd`);
    },
  );

  /** The revision history, newest first. Vendor-only: a company sees the active file, not the list. */
  app.get<{ Params: { templateId: string } }>(
    '/admin/templates/:templateId/files',
    async (request, reply) => {
      const session = requirePlatformCapability(request, reply, 'platform:templates');
      if (session === null) return;

      const template = await db.get<{ id: string; active_file_revision_id: string | null }>(
        'SELECT id, active_file_revision_id FROM quote_templates WHERE id = ?',
        [request.params.templateId],
      );
      if (template === null) return sendFail(reply, 'not_found', 'Not found.');

      const rows = await db.all<FileRow>(
        `SELECT * FROM quote_template_files
          WHERE template_id = ?
          ORDER BY created_at DESC, id DESC`,
        [request.params.templateId],
      );

      return sendOk(reply, {
        activeFileId: template.active_file_revision_id,
        items: rows.map((row) => ({
          id: row.id,
          versionLabel: row.version_label,
          sha256: row.sha256,
          sizeBytes: Number(row.size_bytes),
          note: row.note,
          createdBy: row.created_by,
          createdAt: row.created_at,
          active: row.id === template.active_file_revision_id,
        })),
      });
    },
  );

  /**
   * A company downloads a template file.
   *
   * Two checks, and both answer 404: the template must be **active**, and it must be either global
   * or this company's own. A template that exists but is not offered here must be indistinguishable
   * from one that does not exist, or the id leaks that a competitor's template is there.
   */
  app.get<{ Params: { templateId: string } }>(
    '/templates/:templateId/file',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'quote:write');
      if (session === null) return;

      const tenantId = session.tenantId as string;
      const template = await db.get<{
        id: string;
        code: string;
        active_file_revision_id: string | null;
      }>(
        `SELECT id, code, active_file_revision_id
           FROM quote_templates
          WHERE id = ? AND status = 'active'
            AND (tenant_id IS NULL OR tenant_id = ?)`,
        [request.params.templateId, tenantId],
      );
      // Deliberately the same answer for "not yours", "archived" and "no such id".
      if (template === null || template.active_file_revision_id === null) {
        return sendFail(reply, 'not_found', 'Not found.');
      }

      const file = await db.get<FileRow>(
        'SELECT * FROM quote_template_files WHERE id = ? AND template_id = ?',
        [template.active_file_revision_id, request.params.templateId],
      );
      if (file === null) return sendFail(reply, 'not_found', 'Not found.');

      return sendRevision(reply, file, `${template.code}-${file.version_label}.sqd`);
    },
  );
}
