'use client';

/**
 * Usage, releases and the template catalogue — the last three vendor screens.
 *
 * ## Why usage is shown as three columns
 *
 * A total alone says the product has been used; it does not say whether it is being used **now**. A
 * company that wrote forty quotes last year and none this month is a renewal conversation, and the
 * 7- and 30-day columns are what make that visible without a chart nobody reads.
 *
 * ## Why a release is a record and not a distribution
 *
 * The licence server published a desktop installer with a force-update flag. A web product has no
 * installer — everyone is on the deployed build the moment it ships. What a support call needs is
 * "what is this running, and what changed", and that is a row.
 */

import { useState } from 'react';
import { Button, Field, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

interface UsageRow {
  kind: string;
  total: number;
  last7: number;
  last30: number;
}

interface ReleaseRow {
  id: string;
  label: string;
  engineVersion: number;
  priceBookHash: string | null;
  note: string;
  current: boolean;
  createdAt: string;
  createdBy: string | null;
}

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  status: string;
  typeName: string;
  cloneCount: number;
  hasConfig: boolean;
  updatedAt: string;
  /** How many `.sqd` file revisions this template has, and which one is served. */
  fileRevisions?: number;
  activeFileLabel?: string | null;
}

/** How a usage kind reads. */
const KIND_LABEL: Record<string, string> = {
  quote_created: 'Quotes created',
  revision_saved: 'Revisions saved',
  mail_sent: 'Quotes emailed',
  page_view: 'Screens opened',
};

export function PlatformPage({
  usage,
  releases,
  templates,
  companies,
}: {
  usage: UsageRow[];
  releases: ReleaseRow[];
  templates: TemplateRow[];
  /** The companies a template can belong to. */
  companies: { id: string; name: string; code: string | null }[];
}) {
  const [rows, setRows] = useState(releases);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  /*
   * The template author's state. `config` is JSON text rather than a form of dimension fields: a
   * template carries a whole `ShedConfig` (openings, options, colours), and a handful of number
   * inputs would either drop everything else or need thirty of them. The screen says so, and missing
   * fields take their defaults.
   */
  /**
   * The author form.
   *
   * `tenantId` is first because it is the field a mistake hides in: a template belongs to **one**
   * company, and one authored without an owner is invisible to everybody — which looks like "the
   * catalogue is empty" rather than "this row is wrong".
   */
  const [draft, setDraft] = useState({
    tenantId: '',
    code: '',
    name: '',
    typeCode: 'gable',
    description: '',
    sortOrder: 0,
    config: '',
  });
  const [templateRows, setTemplateRows] = useState(templates);
  const [templateBusy, setTemplateBusy] = useState<string | null>(null);
  /**
   * The `.sqd` being attached to a template, per template id.
   *
   * Held as one record rather than per-row state because only one upload runs at a time — the
   * button that starts it is the same button for every row.
   */
  const [upload, setUpload] = useState<{ templateId: string; name: string; base64: string } | null>(
    null,
  );

  const publish = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);

    const result = await api<{ id: string; label: string }>('admin/releases', {
      method: 'POST',
      body: { label, note, makeCurrent: true },
    });

    setBusy(false);
    if (result.ok) {
      setMessage({ tone: 'ok', text: `Release ${result.data.label} recorded and marked current.` });
      setLabel('');
      setNote('');
      // Re-read rather than splice: the new row cleared every other `current`, and a local edit would
      // leave two rows looking current.
      const refreshed = await api<{ items: ReleaseRow[] }>('admin/releases');
      if (refreshed.ok) setRows(refreshed.data.items);
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  /** Create a template from the JSON in the form. */
  const createTemplate = async (): Promise<void> => {
    setTemplateBusy('create');
    setMessage(null);

    let config: unknown;
    try {
      config = draft.config.trim() === '' ? {} : (JSON.parse(draft.config) as unknown);
    } catch {
      setTemplateBusy(null);
      setMessage({ tone: 'danger', text: 'The building is not valid JSON. Check the braces and quotes.' });
      return;
    }

    if (draft.tenantId === '') {
      setTemplateBusy(null);
      setMessage({ tone: 'danger', text: 'Choose the company this template belongs to.' });
      return;
    }

    const result = await api<{ id: string; name: string }>('admin/templates', {
      method: 'POST',
      body: {
        tenantId: draft.tenantId,
        code: draft.code.trim(),
        name: draft.name.trim(),
        typeCode: draft.typeCode,
        description: draft.description.trim(),
        sortOrder: Number(draft.sortOrder) || 0,
        config,
      },
    });

    setTemplateBusy(null);
    if (result.ok) {
      setMessage({ tone: 'ok', text: `${result.data.name} added to the catalogue.` });
      setDraft({ ...draft, code: '', name: '', description: '', sortOrder: 0, config: '' });
      // Re-read, so the row shows exactly what was stored rather than what was typed.
      const refreshed = await api<{ items: TemplateRow[] }>('admin/templates');
      if (refreshed.ok) setTemplateRows(refreshed.data.items);
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  /** Archive or reactivate a template. Never deleted: a clone that used it still points at it. */
  const setTemplateStatus = async (id: string, status: 'active' | 'archived'): Promise<void> => {
    setTemplateBusy(id);
    setMessage(null);

    const result = await api<{ status: string }>(`admin/templates/${id}`, {
      method: 'PATCH',
      body: { status },
    });

    setTemplateBusy(null);
    if (result.ok) {
      setTemplateRows((current) => current.map((row) => (row.id === id ? { ...row, status } : row)));
      setMessage({
        tone: 'ok',
        text: status === 'active' ? 'The template is available again.' : 'The template is archived and hidden from companies.',
      });
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  /**
   * Attach a `.sqd` to a template.
   *
   * The browser reads the file and posts it as base64, because this API has no multipart parser —
   * the same shape the quote import and the price list import use. The server hashes the bytes,
   * proves the file is a quote file, and stores a **new revision**: uploading twice never replaces
   * the first, which is what makes the history real.
   */
  const attachFile = async (templateId: string, file: File): Promise<void> => {
    setTemplateBusy(templateId);
    setMessage(null);

    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    const result = await api<{ fileId: string; sha256: string; sizeBytes: number }>(
      `admin/templates/${templateId}/file`,
      { method: 'POST', body: { data: base64, versionLabel: file.name.replace(/\.sqd$/i, '') } },
    );

    setTemplateBusy(null);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    setMessage({
      tone: 'ok',
      text: `Attached ${(result.data.sizeBytes / 1024).toFixed(1)} KB — SHA-256 ${result.data.sha256.slice(0, 12)}…`,
    });
    const refreshed = await api<{ items: TemplateRow[] }>('admin/templates');
    if (refreshed.ok) setTemplateRows(refreshed.data.items);
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

      <Panel title="Usage" description="What the product is being used for, across every company." padded={false}>
        {usage.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            Nothing recorded yet. A quote saved or emailed will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">What</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">All time</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Last 30 days</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Last 7 days</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={row.kind} className="border-b border-sq-line last:border-0">
                    <td className="px-sq-3 py-sq-2">{KIND_LABEL[row.kind] ?? row.kind}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{row.total}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{row.last30}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{row.last7}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Releases" description="What this deployment is running, and what changed." padded={false}>
        <div className="flex flex-col gap-sq-3 px-sq-3 py-sq-3">
          <div className="grid gap-sq-3 sm:grid-cols-2">
            <Field
              id="release-label"
              label="Label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="2026.11.1"
              hint="What a person calls this release."
            />
            <Field
              id="release-note"
              label="What changed"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              hint="One line a support call can read."
            />
          </div>
          <div>
            <Button variant="primary" loading={busy} disabled={label.trim() === ''} onClick={() => void publish()}>
              Record this release
            </Button>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto border-t border-sq-line">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Label</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Engine</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">What changed</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Recorded</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-sq-line last:border-0">
                    <td className="sq-numeric px-sq-3 py-sq-2">{row.label}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-sq-ink-muted">v{row.engineVersion}</td>
                    <td className="px-sq-3 py-sq-2">{row.note || '—'}</td>
                    <td className="px-sq-3 py-sq-2 text-sq-ink-muted">{row.createdAt.slice(0, 10)}</td>
                    <td className="px-sq-3 py-sq-2">
                      {row.current ? <StatusPill tone="ok" label="Current" /> : <span className="text-sq-ink-muted">Earlier</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Template catalogue"
        description="Buildings a company can start from. A clone copies the structure and options, never a customer."
        padded={false}
      >
        {/*
          The author form. The API has had `POST /admin/templates` since the catalogue shipped; this
          is the control that calls it, so a template can be created from the app rather than by
          finding a saved quote and posting JSON by hand.
        */}
        <div className="flex flex-col gap-sq-3 border-b border-sq-line px-sq-3 py-sq-3">
          {/*
            The company comes first, because it is the field a mistake hides in. Every other field
            is visible in the list below if it is wrong; a template authored into the wrong company
            (or into none) simply never appears, and the operator concludes the catalogue is broken.
          */}
          <div className="grid gap-sq-3 sm:grid-cols-2">
            <label htmlFor="template-tenant" className="flex flex-col gap-sq-1">
              <span className="text-sq-micro font-medium text-sq-ink">
                Company <span className="text-sq-danger">*</span>
              </span>
              <select
                id="template-tenant"
                value={draft.tenantId}
                onChange={(event) => setDraft({ ...draft, tenantId: event.target.value })}
                className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink"
              >
                <option value="">Choose a company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                    {company.code === null ? '' : ` (${company.code})`}
                  </option>
                ))}
              </select>
              <span className="text-sq-micro text-sq-ink-muted">
                A template belongs to one company. There is no shared catalogue: a company sees its
                own templates and nobody else&rsquo;s.
              </span>
            </label>
            <Field
              id="template-description"
              label="Description"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="12 × 24 workshop with a roller door and a mezzanine"
              hint="One line, shown in the company's catalogue."
            />
          </div>

          <div className="grid gap-sq-3 sm:grid-cols-4">
            <Field
              id="template-code"
              label="Code"
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
              placeholder="gable-12x24"
              hint="Lower-case, no spaces. A clone names it."
            />
            <Field
              id="template-name"
              label="Name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Gable 12 × 24 workshop"
            />
            <label htmlFor="template-type" className="flex flex-col gap-sq-1">
              <span className="text-sq-micro font-medium text-sq-ink">Type</span>
              <select
                id="template-type"
                value={draft.typeCode}
                onChange={(event) => setDraft({ ...draft, typeCode: event.target.value })}
                className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink"
              >
                <option value="gable">Gable shed</option>
                <option value="skillion">Skillion</option>
                <option value="carport">Carport</option>
              </select>
            </label>
            <Field
              id="template-sort"
              label="Order"
              type="number"
              value={String(draft.sortOrder)}
              onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) || 0 })}
              hint="Lower comes first in the catalogue."
            />
          </div>

          <label htmlFor="template-config" className="flex flex-col gap-sq-1">
            <span className="text-sq-micro font-medium text-sq-ink">Building</span>
            <textarea
              id="template-config"
              rows={4}
              value={draft.config}
              onChange={(event) => setDraft({ ...draft, config: event.target.value })}
              className="rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 font-mono text-sq-micro text-sq-ink"
              placeholder='{"structureType":"gable","span":12000,"length":24000,"height":4200,"bays":4}'
            />
            <span className="text-sq-micro text-sq-ink-muted">
              The building as JSON. Missing fields take their defaults, so the four above are enough to
              start. Nothing about a customer or a site belongs here.
            </span>
          </label>

          <div>
            <Button variant="primary" loading={templateBusy === 'create'} onClick={() => void createTemplate()}>
              Add the template
            </Button>
          </div>
        </div>

        {templateRows.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            No templates yet. Add one above, and a company can start a quote from it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Name</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Code</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Type</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Cloned</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">State</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">.sqd file</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {templateRows.map((row) => (
                  <tr key={row.id} className="border-b border-sq-line last:border-0">
                    <td className="px-sq-3 py-sq-2">{row.name}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-sq-ink-muted">{row.code}</td>
                    <td className="px-sq-3 py-sq-2 text-sq-ink-muted">{row.typeName}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{row.cloneCount}</td>
                    <td className="px-sq-3 py-sq-2">
                      <StatusPill
                        tone={row.status === 'active' ? 'ok' : 'neutral'}
                        label={row.status === 'active' ? 'Active' : row.status}
                      />
                    </td>
                    <td className="px-sq-3 py-sq-2">
                      {/*
                        One file per template, uploaded here. A template's `config_json` can be cloned
                        but not transported: an operator who wants the building in the desktop app
                        needs the `.sqd` itself. Uploading again adds a revision — nothing is
                        replaced, so a clone made last month still points at the bytes it was made
                        from.
                      */}
                      <label className="inline-flex cursor-pointer items-center gap-sq-1 text-sq-micro text-sq-brand">
                        <span className="underline underline-offset-2">
                          {templateBusy === row.id ? 'Uploading…' : 'Attach .sqd'}
                        </span>
                        <input
                          type="file"
                          accept=".sqd,application/octet-stream"
                          className="sr-only"
                          disabled={templateBusy !== null}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file !== undefined) void attachFile(row.id, file);
                          }}
                        />
                      </label>
                      <span className="ml-sq-2 text-sq-micro text-sq-ink-muted">
                        {row.activeFileLabel ?? 'none yet'}
                      </span>
                    </td>
                    <td className="px-sq-3 py-sq-2">
                      <Button
                        loading={templateBusy === row.id}
                        onClick={() => void setTemplateStatus(row.id, row.status === 'active' ? 'archived' : 'active')}
                      >
                        {row.status === 'active' ? 'Archive' : 'Reactivate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
