'use client';

/**
 * The template catalogue: the buildings a company can start a quote from, and the form that adds one.
 *
 * ## Why the building's JSON is folded away
 *
 * A template carries a whole `ShedConfig` (openings, options, colours), and a form of thirty number
 * inputs would either drop most of it or be thirty inputs. So the building is JSON — but that is a
 * developer's tool, and the review found it was the first thing on the form and its syntax errors only
 * showed after "Add". It is now an "Advanced" section, closed by default (missing fields take their
 * defaults, so the type alone is enough to start), and it is parsed as it is typed: the error sits
 * under the box and the Add button waits until it is fixed.
 *
 * Starting from an uploaded `.sqd` instead of JSON needs a route that reads a quote file into a
 * building for the vendor; none exists yet (`/quotes/import/sqd` imports into a company's quotes).
 *
 * ## Why every field error is under its field
 *
 * The form used to report everything in one line above the whole page. The company and the code are
 * where mistakes happen, so their errors are placed where the eye is when they are fixed.
 */

import { useId, useState } from 'react';
import { bytes, Button, count, DataTable, date, Field, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  status: string;
  typeName: string;
  tenantName?: string | null;
  cloneCount: number;
  hasConfig: boolean;
  updatedAt: string;
  /** How many `.sqd` file revisions this template has, and which one is served. */
  fileRevisions?: number;
  activeFileLabel?: string | null;
  /** The active file's id, so an older revision can be fetched by id from the history. */
  activeFileId?: string | null;
}

/** One `.sqd` revision of a template, as `/admin/templates/:id/files` reports it. */
interface TemplateFileRow {
  id: string;
  versionLabel: string;
  sha256: string;
  sizeBytes: number;
  note: string;
  createdBy: string | null;
  createdAt: string;
  active: boolean;
}

export interface CompanyOption {
  id: string;
  name: string;
  code: string | null;
}

/** The API's rule for a template code (`routes/platform.ts`), checked here so the error is immediate. */
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const EMPTY_DRAFT = { tenantId: '', code: '', name: '', typeCode: 'gable', description: '', sortOrder: '0', config: '' };

/** Parse the building box. Empty means "all defaults". */
function parseBuilding(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    const value = JSON.parse(text) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: 'The building must be one JSON object: { … }.' };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: `Not valid JSON — ${error instanceof Error ? error.message : 'check the braces and quotes'}.` };
  }
}

/** A labelled native select, styled and wired like `Field`. */
function SelectField({
  id,
  label,
  required,
  hint,
  error,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  const describedBy = error !== undefined ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-sq-1">
      <label htmlFor={id} className="text-sq-micro font-medium text-sq-ink">
        {label}
        {required === true && (
          <span className="ml-1 text-sq-danger" aria-hidden="true">
            *
          </span>
        )}
        {required === true && <span className="sr-only"> (required)</span>}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy}
        aria-required={required === true || undefined}
        className={[
          'min-h-11 w-full cursor-pointer rounded-md border bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink',
          error !== undefined ? 'border-sq-danger' : 'border-sq-line',
        ].join(' ')}
      >
        {children}
      </select>
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-sq-micro text-sq-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={`${id}-hint`} className="text-sq-micro text-sq-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TemplateCatalogue({ initial, companies }: { initial: TemplateRow[]; companies: CompanyOption[] }) {
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const buildingHintId = useId();

  /**
   * The `.sqd` revision history of one template, or `null` when none is open.
   *
   * Loaded on demand: a catalogue of twenty templates would otherwise make twenty requests to draw a
   * table whose interesting column is "which version is active". One at a time, because the question
   * — "what did this template look like before" — is asked about one template at a time.
   */
  const [fileHistory, setFileHistory] = useState<{
    templateId: string;
    rows: TemplateFileRow[];
    error: string | null;
  } | null>(null);

  const building = parseBuilding(draft.config);
  const set = (key: keyof typeof EMPTY_DRAFT, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key] !== undefined) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const reload = async (): Promise<void> => {
    // Re-read, so each row shows what was stored rather than what was typed.
    const refreshed = await api<{ items: TemplateRow[] }>('admin/templates');
    if (refreshed.ok) setRows(refreshed.data.items);
  };

  const createTemplate = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setMessage(null);

    const errors: Record<string, string> = {};
    if (draft.tenantId === '') errors.tenantId = 'Choose the company this template belongs to.';
    if (!CODE_PATTERN.test(draft.code.trim()) || draft.code.trim().length < 2) {
      errors.code = 'At least two characters: lower-case letters, digits and dashes, starting with a letter or digit.';
    }
    if (draft.name.trim() === '') errors.name = 'Give the template a name.';
    if (!building.ok) errors.config = building.message;
    setFieldErrors(errors);
    const first = Object.keys(errors)[0];
    if (first !== undefined) {
      document.getElementById(`template-${first}`)?.focus();
      return;
    }

    setBusy('create');
    const result = await api<{ id: string; name: string }>('admin/templates', {
      method: 'POST',
      body: {
        tenantId: draft.tenantId,
        code: draft.code.trim(),
        name: draft.name.trim(),
        typeCode: draft.typeCode,
        description: draft.description.trim(),
        sortOrder: Number(draft.sortOrder) || 0,
        config: building.ok ? building.value : {},
      },
    });
    setBusy(null);

    if (!result.ok) {
      const details: Record<string, string> = {};
      for (const detail of result.details ?? []) details[detail.path] = detail.message;
      // A duplicate code comes back as a conflict with no field path; it belongs under the code.
      if (result.code === 'conflict') details.code = result.message;
      setFieldErrors(details);
      setMessage({ tone: 'danger', text: result.message });
      return;
    }

    setMessage({ tone: 'ok', text: `${result.data.name} added to the catalogue.` });
    // The company stays chosen: templates are usually added several at a time for one company.
    setDraft({ ...EMPTY_DRAFT, tenantId: draft.tenantId, typeCode: draft.typeCode });
    await reload();
  };

  /** Archive or reactivate a template. Never deleted: a clone that used it still points at it. */
  const setTemplateStatus = async (id: string, status: 'active' | 'archived'): Promise<void> => {
    setBusy(id);
    setMessage(null);
    const result = await api<{ status: string }>(`admin/templates/${id}`, { method: 'PATCH', body: { status } });
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status } : row)));
    setMessage({
      tone: 'ok',
      text: status === 'active' ? 'The template is available again.' : 'The template is archived and hidden from its company.',
    });
  };

  /**
   * Attach a `.sqd` to a template.
   *
   * Posted as base64, because this API has no multipart parser — the same shape the quote import and
   * the price list import use. The server hashes the bytes, proves the file is a quote file, and
   * stores a **new revision**: uploading twice never replaces the first, which is what makes the
   * history real.
   */
  const attachFile = async (templateId: string, file: File): Promise<void> => {
    setBusy(templateId);
    setMessage(null);
    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    const result = await api<{ fileId: string; sha256: string; sizeBytes: number }>(
      `admin/templates/${templateId}/file`,
      { method: 'POST', body: { data: base64, versionLabel: file.name.replace(/\.sqd$/i, '') } },
    );
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    setMessage({
      tone: 'ok',
      text: `Attached ${bytes(result.data.sizeBytes)} — SHA-256 ${result.data.sha256.slice(0, 12)}…`,
    });
    if (fileHistory?.templateId === templateId) setFileHistory(null);
    await reload();
  };

  /** Show or hide one template's `.sqd` history. The hash is listed because it is what proves two rows differ. */
  const toggleHistory = async (templateId: string): Promise<void> => {
    if (fileHistory !== null && fileHistory.templateId === templateId) {
      setFileHistory(null);
      return;
    }
    setBusy(templateId);
    const result = await api<{ activeFileId: string | null; items: TemplateFileRow[] }>(
      `admin/templates/${templateId}/files`,
    );
    setBusy(null);
    setFileHistory({ templateId, rows: result.ok ? result.data.items : [], error: result.ok ? null : result.message });
  };

  return (
    <div className="flex flex-col gap-sq-4">
      {message !== null && (
        <p
          role={message.tone === 'danger' ? 'alert' : 'status'}
          className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
        >
          {message.text}
        </p>
      )}

      <Panel
        title="Catalogue"
        description="A clone copies the structure and options, never a customer or a site."
        padded={false}
      >
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          caption="Templates, with their company, state and .sqd file"
          empty="No templates yet. Add one below, and its company can start a quote from it."
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (row) => (
                <>
                  <span className="block font-medium">{row.name}</span>
                  <span className="block font-mono text-sq-micro text-sq-ink-muted">{row.code}</span>
                </>
              ),
            },
            {
              key: 'company',
              header: 'Company',
              render: (row) => row.tenantName ?? <span className="text-sq-danger">No company — nobody sees it</span>,
            },
            { key: 'type', header: 'Type', render: (row) => row.typeName, cellClassName: 'text-sq-ink-muted' },
            { key: 'cloned', header: 'Cloned', numeric: true, render: (row) => count(row.cloneCount) },
            {
              key: 'state',
              header: 'State',
              render: (row) => (
                <StatusPill
                  tone={row.status === 'active' ? 'ok' : 'neutral'}
                  label={row.status === 'active' ? 'Active' : row.status === 'archived' ? 'Archived' : 'Draft'}
                />
              ),
            },
            {
              key: 'file',
              header: '.sqd file',
              // Uploading again adds a revision — nothing is replaced, so a clone made last month still
              // points at the bytes it was made from. Download goes through this app's bridge, which
              // forwards the attachment unchanged.
              render: (row) => (
                <div className="flex flex-wrap items-center gap-x-sq-2 gap-y-0.5 text-sq-micro">
                  <span className="text-sq-ink-muted">{row.activeFileLabel ?? 'None yet'}</span>
                  {row.activeFileId !== undefined && row.activeFileId !== null && (
                    <a href={`/api/sq/admin/templates/${row.id}/file`} className="text-sq-brand underline underline-offset-2">
                      Download
                    </a>
                  )}
                  <label className="inline-flex cursor-pointer items-center text-sq-brand underline underline-offset-2 focus-within:outline focus-within:outline-2 focus-within:outline-sq-brand">
                    {busy === row.id ? 'Working…' : row.activeFileId ? 'Upload new' : 'Attach .sqd'}
                    <input
                      type="file"
                      accept=".sqd,application/octet-stream"
                      className="sr-only"
                      disabled={busy !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file !== undefined) void attachFile(row.id, file);
                      }}
                    />
                  </label>
                </div>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              hideHeader: true,
              render: (row) => (
                <div className="flex flex-wrap items-center justify-end gap-sq-1">
                  <Button onClick={() => void toggleHistory(row.id)}>
                    {fileHistory !== null && fileHistory.templateId === row.id
                      ? 'Hide history'
                      : `History (${row.fileRevisions ?? 0})`}
                  </Button>
                  <Button
                    disabled={busy !== null && busy !== row.id}
                    onClick={() => void setTemplateStatus(row.id, row.status === 'active' ? 'archived' : 'active')}
                  >
                    {row.status === 'active' ? 'Archive' : 'Reactivate'}
                  </Button>
                </div>
              ),
            },
          ]}
        />

        {/*
          The open history, under the table rather than inside it: a nested table in a cell is
          unreadable at the width this screen is used at, and the question is about one template.
        */}
        {fileHistory !== null && (
          <div className="border-t border-sq-line bg-sq-ground px-sq-3 py-sq-3">
            <h3 className="text-sq-body font-semibold text-sq-ink">
              {rows.find((row) => row.id === fileHistory.templateId)?.name ?? 'Template'} — .sqd revisions
            </h3>
            {fileHistory.error !== null ? (
              <p role="alert" className="mt-sq-1 text-sq-body text-sq-danger">
                {fileHistory.error}
              </p>
            ) : fileHistory.rows.length === 0 ? (
              <p className="mt-sq-1 text-sq-body text-sq-ink-muted">
                No file has been attached yet. An upload adds the first revision.
              </p>
            ) : (
              <div className="mt-sq-2 rounded-md border border-sq-line bg-sq-surface">
                <DataTable
                  rows={fileHistory.rows}
                  rowKey={(file) => file.id}
                  caption=".sqd revisions of this template, newest first"
                  height="none"
                  dense
                  columns={[
                    { key: 'version', header: 'Version', render: (file) => file.versionLabel },
                    {
                      key: 'sha',
                      header: 'SHA-256',
                      render: (file) => <span title={file.sha256}>{file.sha256.slice(0, 12)}…</span>,
                      cellClassName: 'font-mono text-sq-micro text-sq-ink-muted',
                    },
                    {
                      key: 'size',
                      header: 'Size',
                      numeric: true,
                      render: (file) => bytes(file.sizeBytes),
                      cellClassName: 'whitespace-nowrap text-sq-ink-muted',
                    },
                    {
                      key: 'attached',
                      header: 'Attached',
                      render: (file) => `${date(file.createdAt)}${file.createdBy === null ? '' : ` · ${file.createdBy}`}`,
                      cellClassName: 'text-sq-micro text-sq-ink-muted',
                    },
                    {
                      key: 'state',
                      header: 'State',
                      render: (file) =>
                        file.active ? (
                          <StatusPill tone="ok" label="Served" />
                        ) : (
                          <span className="text-sq-micro text-sq-ink-muted">Earlier</span>
                        ),
                    },
                    {
                      key: 'download',
                      header: 'Download',
                      hideHeader: true,
                      render: (file) => (
                        <a
                          href={`/api/sq/admin/templates/${fileHistory.templateId}/file?revisionId=${file.id}`}
                          className="text-sq-micro text-sq-brand underline underline-offset-2"
                        >
                          Download
                        </a>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Add a template"
        description="A template belongs to one company and appears only in that company's catalogue."
      >
        <form onSubmit={(event) => void createTemplate(event)} className="flex flex-col gap-sq-3" noValidate>
          <div className="grid gap-sq-3 sm:grid-cols-2">
            {/*
              The company comes first, because it is the field a mistake hides in. A template
              authored into the wrong company simply never appears where it was expected, and the
              operator concludes the catalogue is broken.
            */}
            <SelectField
              id="template-tenantId"
              label="Company"
              required
              value={draft.tenantId}
              onChange={(value) => set('tenantId', value)}
              hint={
                companies.length === 0
                  ? 'No company to choose: none exists yet, or your role cannot list companies.'
                  : undefined
              }
              error={fieldErrors.tenantId}
            >
              <option value="">Choose a company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                  {company.code === null ? '' : ` (${company.code})`}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="template-typeCode"
              label="Type"
              required
              value={draft.typeCode}
              onChange={(value) => set('typeCode', value)}
              error={fieldErrors.typeCode}
            >
              <option value="gable">Gable shed</option>
              <option value="skillion">Skillion</option>
              <option value="carport">Carport</option>
            </SelectField>
          </div>

          <div className="grid gap-sq-3 sm:grid-cols-2">
            <Field
              id="template-name"
              label="Name"
              required
              value={draft.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="Gable 12 × 24 workshop"
              error={fieldErrors.name}
            />
            <Field
              id="template-code"
              label="Code"
              required
              spellCheck={false}
              value={draft.code}
              onChange={(event) => set('code', event.target.value.toLowerCase())}
              placeholder="gable-12x24"
              hint="Lower-case letters, digits and dashes. Unique."
              error={fieldErrors.code}
            />
          </div>

          <div className="grid gap-sq-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <Field
              id="template-description"
              label="Description"
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
              placeholder="12 × 24 workshop with a roller door and a mezzanine"
              hint="One line, shown in the company's catalogue."
              error={fieldErrors.description}
            />
            <Field
              id="template-sortOrder"
              label="Order"
              type="number"
              value={draft.sortOrder}
              onChange={(event) => set('sortOrder', event.target.value)}
              hint="Lower comes first."
              error={fieldErrors.sortOrder}
            />
          </div>

          <details
            className="group rounded-md border border-sq-line"
            open={fieldErrors.config !== undefined || draft.config !== '' ? true : undefined}
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-sq-2 px-sq-2 text-sq-body font-medium text-sq-ink">
              <span aria-hidden="true" className="inline-block transition-transform duration-sq-fast group-open:rotate-90">
                ›
              </span>
              Building (advanced)
              <span className="font-normal text-sq-ink-muted">— optional; defaults for the type if left empty</span>
            </summary>
            <div className="flex flex-col gap-sq-1 border-t border-sq-line p-sq-2">
              <label htmlFor="template-config" className="text-sq-micro font-medium text-sq-ink">
                Building as JSON
              </label>
              <textarea
                id="template-config"
                rows={6}
                spellCheck={false}
                value={draft.config}
                onChange={(event) => set('config', event.target.value)}
                aria-invalid={!building.ok || undefined}
                aria-describedby={buildingHintId}
                className={[
                  'rounded-md border bg-sq-surface px-sq-2 py-sq-1 font-mono text-sq-micro text-sq-ink',
                  building.ok ? 'border-sq-line' : 'border-sq-danger',
                ].join(' ')}
                placeholder='{"structureType":"gable","span":12000,"length":24000,"height":4200,"bays":4}'
              />
              <p
                id={buildingHintId}
                className={building.ok ? 'text-sq-micro text-sq-ink-muted' : 'text-sq-micro text-sq-danger'}
              >
                {building.ok
                  ? 'Millimetres. Missing fields take their defaults. Nothing about a customer or a site belongs here.'
                  : building.message}
              </p>
            </div>
          </details>

          <div>
            <Button type="submit" variant="primary" loading={busy === 'create'} disabled={!building.ok}>
              Add the template
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
