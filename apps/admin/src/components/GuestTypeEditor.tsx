'use client';

/**
 * The editor for one Guest building type.
 *
 * ## Why the checks run here *and* on the server
 *
 * `checkGuestBuildingType` and `bookWarnings` come from `@sq/core/domain`, the same functions the API
 * runs on save. Running them on every keystroke means the operator sees "the starting pitch is not one
 * of this roof's pitches" beside the field rather than after a round trip — and the API still runs
 * them, because a browser is not where a rule is enforced.
 *
 * ## Why limits are typed in metres and stored in millimetres
 *
 * Every number in the domain is millimetres, and every number a person says out loud is metres. The
 * form shows `6.00` and stores `6000`; `mmToMetres`/`metresToMm` are the only two places that cross
 * over, so a rounding mistake has one home.
 *
 * ## Why an enquiry type hides sections 2–6
 *
 * A Class 1 House takes a request and no design (Q1). Its stored config is still a complete, valid
 * one — the sections are hidden, not emptied — so switching the mode back restores what was there.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BOOK_BAY_MM,
  BOOK_HEIGHT_MM,
  BOOK_MIN_SKILLION_PITCH_DEG,
  BOOK_SPAN_MM,
  COLORBOND,
  PRESET_IDS,
  bookWarnings,
  checkGuestBuildingType,
  type GuestBuildingSpec,
  type GuestBuildingTypeConfigSpec,
  type GuestColourChoice,
  type GuestIcon,
  type GuestOpeningKind,
  type GuestOpeningRuleSpec,
  type GuestOpeningSpec,
  type GuestRange,
  type GuestRoof,
  type PresetId,
  type WallSide,
} from '@sq/core/domain';
import type { GuestBuildingTypeAdminDetail, GuestBuildingTypeAdminRow } from '@sq/contracts';
import { Button, Field, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

const ICONS: GuestIcon[] = ['shed', 'garage', 'carport', 'skillion', 'industrial', 'arena', 'hangar', 'house'];
const WALLS: WallSide[] = ['front', 'back', 'left', 'right'];
const KINDS: GuestOpeningKind[] = ['roller_door', 'pa_door', 'sliding_door', 'window'];
const KIND_LABEL: Record<GuestOpeningKind, string> = {
  roller_door: 'Roller door',
  pa_door: 'PA door',
  sliding_door: 'Sliding door',
  window: 'Window',
};
const COLOUR_NAMES = Object.keys(COLORBOND);

/** `6000` → `6.00`; `2950` → `2.95`. */
function mmToMetres(mm: number): string {
  return (mm / 1000).toFixed(2);
}

/** `"6"` → `6000`; `"2.95"` → `2950`; anything unreadable → `null`. */
function metresToMm(text: string): number | null {
  const value = Number(text.replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  return Math.round(value * 1000);
}

interface Draft {
  name: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  config: GuestBuildingTypeConfigSpec;
}

function draftFrom(row: GuestBuildingTypeAdminRow): Draft {
  return {
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
    // Deep copy: the form mutates nested arrays, and `initial` is a prop from the server render.
    config: JSON.parse(JSON.stringify(row.config)) as GuestBuildingTypeConfigSpec,
  };
}

export function GuestTypeEditor({
  mode,
  detail,
  siteOrigin,
}: {
  mode: 'create' | 'edit';
  detail: GuestBuildingTypeAdminDetail;
  siteOrigin: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(detail.item));
  const [id, setId] = useState(mode === 'create' ? '' : detail.item.id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger' | 'stale'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const enquiry = draft.config.mode === 'enquiry';

  /** What the API would check, run here so the errors are immediate. */
  const checks = useMemo(() => {
    const spec = {
      id: id === '' ? 'draft' : id,
      name: draft.name,
      description: draft.description,
      version: 0,
      sortOrder: draft.sortOrder,
      config: draft.config,
    };
    return { issues: checkGuestBuildingType(spec), warnings: bookWarnings(spec) };
  }, [draft, id]);

  const patchConfig = (patch: Partial<GuestBuildingTypeConfigSpec>) =>
    setDraft((current) => ({ ...current, config: { ...current.config, ...patch } }));

  const patchLimits = (patch: Partial<GuestBuildingTypeConfigSpec['limits']>) =>
    patchConfig({ limits: { ...draft.config.limits, ...patch } });

  const patchStart = (patch: Partial<GuestBuildingSpec>) =>
    patchConfig({ start: { ...draft.config.start, ...patch } });

  const patchColours = (patch: Partial<GuestBuildingTypeConfigSpec['colours']>) =>
    patchConfig({ colours: { ...draft.config.colours, ...patch } });

  const save = async () => {
    const errors: Record<string, string> = {};
    if (draft.name.trim() === '') errors.name = 'Give the type a name.';
    if (mode === 'create' && !/^[a-z][a-z0-9_]{1,63}$/.test(id)) {
      errors.id = 'Lowercase letters, digits and _, starting with a letter. It cannot be changed later.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      document.getElementById(`guest-type-${Object.keys(errors)[0]}`)?.focus();
      return;
    }

    setBusy(true);
    setMessage(null);
    const body = {
      ...(mode === 'create' ? { id } : {}),
      name: draft.name.trim(),
      description: draft.description.trim(),
      sortOrder: draft.sortOrder,
      enabled: draft.enabled,
      config: draft.config,
      ...(mode === 'edit' ? { expectedVersion: detail.item.version } : {}),
    };
    const result =
      mode === 'create'
        ? await api<{ id: string }>('admin/guest-types', { method: 'POST', body })
        : await api<{ version: number }>(`admin/guest-types/${detail.item.id}`, { method: 'PUT', body });
    setBusy(false);

    if (!result.ok) {
      if (result.code === 'conflict') {
        setMessage({ tone: 'stale', text: result.message });
        return;
      }
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    if (mode === 'create') router.push(`/guest-types/${id}`);
    else router.refresh();
    setMessage({ tone: 'ok', text: 'Saved.' });
  };

  return (
    <div className="flex flex-col gap-sq-4">
      <div className="flex flex-wrap items-start justify-between gap-sq-3">
        <div>
          <h1 className="text-sq-title font-semibold">
            {mode === 'create' ? 'New building type' : detail.item.name}
          </h1>
          <p className="text-sq-body text-sq-ink-muted">
            {mode === 'create'
              ? 'It appears on the Guest page once it is saved and switched on.'
              : `Id ${detail.item.id} · version ${detail.item.version}${
                  detail.item.updatedBy === null ? ' · never saved' : ` · last saved by ${detail.item.updatedBy}`
                }`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-sq-2">
          {mode === 'create' ? null : (
            <a
              href={`${siteOrigin}/quote?type=${encodeURIComponent(detail.item.id)}`}
              target="_blank"
              rel="noreferrer"
              className="text-sq-body text-sq-ink underline-offset-2 hover:underline"
            >
              Open on Guest page
            </a>
          )}
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>

      {message === null ? null : (
        <div
          role="status"
          className={[
            'rounded-md border px-sq-3 py-sq-2 text-sq-body',
            message.tone === 'ok'
              ? 'border-sq-line text-sq-ink'
              : message.tone === 'stale'
                ? 'border-sq-attention text-sq-ink'
                : 'border-sq-danger text-sq-danger',
          ].join(' ')}
        >
          <p>{message.text}</p>
          {message.tone === 'stale' ? (
            <Button variant="secondary" className="mt-sq-2" onClick={() => router.refresh()}>
              Reload the saved version
            </Button>
          ) : null}
        </div>
      )}

      {checks.issues.length > 0 ? (
        <div role="alert" className="rounded-md border border-sq-danger px-sq-3 py-sq-2">
          <p className="text-sq-body font-medium text-sq-danger">This type would not work on the Guest page:</p>
          <ul className="mt-sq-1 list-disc pl-sq-4 text-sq-body text-sq-danger">
            {checks.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {checks.warnings.length > 0 ? (
        <div role="status" className="rounded-md border border-sq-attention px-sq-3 py-sq-2">
          <p className="text-sq-body font-medium text-sq-ink">Beyond the price book (allowed, flagged for the estimator):</p>
          <ul className="mt-sq-1 list-disc pl-sq-4 text-sq-body text-sq-ink-muted">
            {checks.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- 1. general */}
      <Panel title="1. General">
        <div className="grid gap-sq-3 sm:grid-cols-2">
          <Field
            id="guest-type-name"
            label="Name"
            required
            maxLength={40}
            value={draft.name}
            error={fieldErrors.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          {mode === 'create' ? (
            <Field
              id="guest-type-id"
              label="Id"
              required
              value={id}
              error={fieldErrors.id}
              hint="In the deep link and saved drafts. Cannot be changed later."
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            />
          ) : (
            <Field id="guest-type-id-ro" label="Id" value={detail.item.id} readOnly hint="Fixed once created." />
          )}
          <div className="sm:col-span-2">
            <Field
              id="guest-type-description"
              label="Description"
              maxLength={120}
              value={draft.description}
              hint={`${draft.description.length}/120 — one line under the name on the card.`}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <SelectField
            id="guest-type-icon"
            label="Icon"
            value={draft.config.icon}
            onChange={(value) => patchConfig({ icon: value as GuestIcon })}
            options={ICONS.map((icon) => ({ value: icon, label: icon }))}
          />
          <SelectField
            id="guest-type-mode"
            label="Kind"
            value={draft.config.mode}
            hint="Enquiry only: no designer, the visitor just sends a request."
            onChange={(value) => patchConfig({ mode: value as 'design' | 'enquiry' })}
            options={[
              { value: 'design', label: 'Design' },
              { value: 'enquiry', label: 'Enquiry only' },
            ]}
          />
          <SelectField
            id="guest-type-enclosure"
            label="Frame"
            value={draft.config.enclosure}
            hint="Roof only drives the internal pressure the estimator sees."
            onChange={(value) => patchConfig({ enclosure: value as 'enclosed' | 'roof_only' })}
            options={[
              { value: 'enclosed', label: 'Enclosed' },
              { value: 'roof_only', label: 'Roof only' },
            ]}
          />
          <SelectField
            id="guest-type-preset"
            label="Base preset"
            value={draft.config.basePreset}
            onChange={(value) => patchConfig({ basePreset: value as PresetId })}
            options={PRESET_IDS.map((preset) => ({ value: preset, label: preset }))}
          />
          <Field
            id="guest-type-sort"
            label="Order"
            type="number"
            value={String(draft.sortOrder)}
            hint="Lower comes first. The list screen can also reorder."
            onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
          />
          <label className="flex items-center gap-sq-2 text-sq-body text-sq-ink">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              className="h-5 w-5"
            />
            Shown on the Guest page
          </label>
        </div>
      </Panel>

      {enquiry ? (
        <Panel title="No design sections">
          <p className="text-sq-body text-sq-ink-muted">
            An enquiry-only type takes a request and no design, so roofs, limits, doors and colours are not
            offered. The stored configuration is kept as it is, so switching the kind back restores it.
          </p>
        </Panel>
      ) : (
        <>
          {/* ---------------------------------------------------------------- 2. roof */}
          <Panel title="2. Roof">
            <div className="flex flex-col gap-sq-3">
              <fieldset className="flex flex-col gap-sq-1">
                <legend className="text-sq-micro font-medium text-sq-ink">Roofs offered</legend>
                <div className="flex gap-sq-3">
                  {(['gable', 'skillion'] as GuestRoof[]).map((roof) => (
                    <label key={roof} className="flex items-center gap-sq-2 text-sq-body text-sq-ink">
                      <input
                        type="checkbox"
                        checked={draft.config.roofs.includes(roof)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...draft.config.roofs, roof]
                            : draft.config.roofs.filter((r) => r !== roof);
                          if (next.length === 0) return;
                          patchConfig({
                            roofs: next,
                            // The start roof has to remain one the type offers.
                            start: next.includes(draft.config.start.roof)
                              ? draft.config.start
                              : { ...draft.config.start, roof: next[0]! },
                          });
                        }}
                        className="h-5 w-5"
                      />
                      {roof === 'gable' ? 'Gable' : 'Skillion'}
                    </label>
                  ))}
                </div>
              </fieldset>

              {draft.config.roofs.map((roof) => (
                <PitchChips
                  key={roof}
                  roof={roof}
                  pitches={draft.config.limits.pitchesByRoof[roof] ?? []}
                  startPitch={draft.config.start.pitchDeg}
                  onChange={(pitches) =>
                    patchLimits({
                      pitchesByRoof: { ...draft.config.limits.pitchesByRoof, [roof]: pitches },
                    })
                  }
                  onPickStart={(pitchDeg) => patchStart({ pitchDeg })}
                />
              ))}

              <SelectField
                id="guest-type-start-roof"
                label="Starting roof"
                value={draft.config.start.roof}
                onChange={(value) => {
                  const roof = value as GuestRoof;
                  const pitches = draft.config.limits.pitchesByRoof[roof] ?? [];
                  patchStart({
                    roof,
                    pitchDeg: pitches.includes(draft.config.start.pitchDeg)
                      ? draft.config.start.pitchDeg
                      : (pitches[0] ?? draft.config.start.pitchDeg),
                  });
                }}
                options={draft.config.roofs.map((roof) => ({ value: roof, label: roof }))}
              />
            </div>
          </Panel>

          {/* ---------------------------------------------------------------- 3. limits */}
          <Panel title="3. Limits">
            <div className="grid gap-sq-3 sm:grid-cols-2">
              <MetreRange
                label="Width"
                idPrefix="guest-type-span"
                range={draft.config.limits.span}
                book={BOOK_SPAN_MM}
                onChange={(span) => patchLimits({ span })}
              />
              <MetreRange
                label="Height"
                idPrefix="guest-type-height"
                range={draft.config.limits.height}
                book={BOOK_HEIGHT_MM}
                onChange={(height) => patchLimits({ height })}
              />
              <MetreRange
                label="Bay width"
                idPrefix="guest-type-bay"
                range={draft.config.limits.bayWidth}
                book={BOOK_BAY_MM}
                onChange={(bayWidth) => patchLimits({ bayWidth })}
              />
              <div className="grid grid-cols-2 gap-sq-2">
                <Field
                  id="guest-type-bays-min"
                  label="Fewest bays"
                  type="number"
                  min={1}
                  max={30}
                  value={String(draft.config.limits.bays.min)}
                  onChange={(e) =>
                    patchLimits({ bays: { ...draft.config.limits.bays, min: Number(e.target.value) || 1 } })
                  }
                />
                <Field
                  id="guest-type-bays-max"
                  label="Most bays"
                  type="number"
                  min={1}
                  max={30}
                  value={String(draft.config.limits.bays.max)}
                  onChange={(e) =>
                    patchLimits({ bays: { ...draft.config.limits.bays, max: Number(e.target.value) || 1 } })
                  }
                />
              </div>
            </div>
          </Panel>

          {/* ---------------------------------------------------------------- 4. start */}
          <Panel title="4. Starting design">
            <div className="grid gap-sq-3 sm:grid-cols-2">
              <MetreField
                id="guest-type-start-span"
                label="Width"
                mm={draft.config.start.span}
                onChange={(span) => patchStart({ span })}
              />
              <MetreField
                id="guest-type-start-height"
                label="Height"
                mm={draft.config.start.height}
                onChange={(height) => patchStart({ height })}
              />
              <Field
                id="guest-type-start-pitch"
                label="Roof pitch"
                type="number"
                step="0.5"
                value={String(draft.config.start.pitchDeg)}
                hint="Must be one of the starting roof's pitches above."
                onChange={(e) => patchStart({ pitchDeg: Number(e.target.value) })}
              />
              <SelectField
                id="guest-type-start-slab"
                label="Slab"
                value={draft.config.start.slab}
                onChange={(value) => patchStart({ slab: value as GuestBuildingSpec['slab'] })}
                options={[
                  { value: 'in_slab', label: 'In slab' },
                  { value: 'on_slab', label: 'On slab' },
                  { value: 'footing_only', label: 'Footing only' },
                ]}
              />
              <SelectField
                id="guest-type-start-knee"
                label="Knee brace"
                value={draft.config.start.kneeBrace}
                onChange={(value) => patchStart({ kneeBrace: value as GuestBuildingSpec['kneeBrace'] })}
                options={[
                  { value: 'standard', label: 'Knee brace' },
                  { value: 'none_if_possible', label: 'None if possible' },
                ]}
              />
              <SelectField
                id="guest-type-start-cladding"
                label="Cladding"
                value={draft.config.start.cladding}
                onChange={(value) => patchStart({ cladding: value as GuestBuildingSpec['cladding'] })}
                options={[
                  { value: 'vertical', label: 'Vertical' },
                  { value: 'horizontal', label: 'Horizontal' },
                ]}
              />
              <div className="sm:col-span-2">
                <span className="text-sq-micro font-medium text-sq-ink">Bays</span>
                <ul className="mt-sq-1 flex flex-col gap-sq-1">
                  {draft.config.start.bayWidths.map((width, index) => (
                    <li key={index} className="flex items-center gap-sq-2">
                      <span className="w-16 text-sq-micro text-sq-ink-muted">Bay {index + 1}</span>
                      <MetreInput
                        id={`guest-type-bay-${index}`}
                        label={`Bay ${index + 1} width`}
                        mm={width}
                        onChange={(mm) => {
                          const next = [...draft.config.start.bayWidths];
                          next[index] = mm;
                          patchStart({ bayWidths: next });
                        }}
                      />
                      <Button
                        variant="ghost"
                        aria-label={`Remove bay ${index + 1}`}
                        disabled={draft.config.start.bayWidths.length <= 1}
                        onClick={() =>
                          patchStart({ bayWidths: draft.config.start.bayWidths.filter((_, i) => i !== index) })
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  className="mt-sq-2"
                  onClick={() => {
                    const widths = draft.config.start.bayWidths;
                    patchStart({ bayWidths: [...widths, widths[widths.length - 1] ?? 3000] });
                  }}
                >
                  Add a bay
                </Button>
              </div>
            </div>
          </Panel>

          {/* ---------------------------------------------------------------- 5. openings */}
          <Panel title="5. Doors and windows">
            <OpeningRules
              rules={draft.config.openings.rules}
              lockedReason={draft.config.openings.lockedReason ?? ''}
              onChange={(rules) =>
                patchConfig({ openings: { ...draft.config.openings, rules } })
              }
              onLockedReason={(lockedReason) =>
                patchConfig({
                  openings: { ...draft.config.openings, ...(lockedReason === '' ? {} : { lockedReason }) },
                })
              }
            />
            <div className="mt-sq-4">
              <OpeningDefaults
                defaults={draft.config.openings.defaults}
                rules={draft.config.openings.rules}
                onChange={(defaults) => patchConfig({ openings: { ...draft.config.openings, defaults } })}
              />
            </div>
          </Panel>

          {/* ---------------------------------------------------------------- 6. colours */}
          <Panel title="6. Colours">
            <ColoursEditor colours={draft.config.colours} onChange={patchColours} />
          </Panel>
        </>
      )}

      <div className="flex justify-end">
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- small controls

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-sq-1">
      <label htmlFor={id} className="text-sq-micro font-medium text-sq-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body text-sq-ink"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint === undefined ? null : <p className="text-sq-micro text-sq-ink-muted">{hint}</p>}
    </div>
  );
}

/** A metres box with no visible label of its own, for use inside a row that names it. */
function MetreInput({
  id,
  label,
  mm,
  onChange,
}: {
  id: string;
  label: string;
  mm: number;
  onChange: (mm: number) => void;
}) {
  const [text, setText] = useState(mmToMetres(mm));
  // The stored value changed from elsewhere (a preset, a reload): show it.
  const shown = mmToMetres(mm);
  const value = text === shown ? text : shown;
  return (
    <span className="flex items-center gap-sq-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        value={value}
        inputMode="decimal"
        onChange={(e) => {
          setText(e.target.value);
          const next = metresToMm(e.target.value);
          if (next !== null) onChange(next);
        }}
        onBlur={() => setText(mmToMetres(mm))}
        className="min-h-11 w-28 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body text-sq-ink tabular-nums"
      />
      <span className="text-sq-micro text-sq-ink-muted">m</span>
    </span>
  );
}

function MetreField({
  id,
  label,
  mm,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  mm: number;
  onChange: (mm: number) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-sq-1">
      <label htmlFor={id} className="text-sq-micro font-medium text-sq-ink">
        {label}
      </label>
      <MetreInput id={id} label={label} mm={mm} onChange={onChange} />
      {hint === undefined ? null : <p className="text-sq-micro text-sq-ink-muted">{hint}</p>}
    </div>
  );
}

/** A min–max pair in metres, with an amber note when it leaves the price book (Q2). */
function MetreRange({
  label,
  idPrefix,
  range,
  book,
  onChange,
}: {
  label: string;
  idPrefix: string;
  range: GuestRange;
  book: GuestRange;
  onChange: (range: GuestRange) => void;
}) {
  const outside = range.min < book.min || range.max > book.max;
  return (
    <div className="flex flex-col gap-sq-1">
      <span className="text-sq-micro font-medium text-sq-ink">{label}</span>
      <div className="flex items-center gap-sq-2">
        <MetreInput id={`${idPrefix}-min`} label={`${label} minimum`} mm={range.min} onChange={(min) => onChange({ ...range, min })} />
        <span className="text-sq-micro text-sq-ink-muted">to</span>
        <MetreInput id={`${idPrefix}-max`} label={`${label} maximum`} mm={range.max} onChange={(max) => onChange({ ...range, max })} />
      </div>
      <p className={`text-sq-micro ${outside ? 'text-sq-attention' : 'text-sq-ink-muted'}`}>
        {outside
          ? `Beyond the price book (${mmToMetres(book.min)}–${mmToMetres(book.max)} m). Requests outside it are flagged for the estimator.`
          : `Price book: ${mmToMetres(book.min)}–${mmToMetres(book.max)} m.`}
      </p>
    </div>
  );
}

/** The pitch chips of one roof, plus which one the starting design uses. */
function PitchChips({
  roof,
  pitches,
  startPitch,
  onChange,
  onPickStart,
}: {
  roof: GuestRoof;
  pitches: number[];
  startPitch: number;
  onChange: (pitches: number[]) => void;
  onPickStart: (pitch: number) => void;
}) {
  const [adding, setAdding] = useState('');
  const low = roof === 'skillion' ? pitches.filter((p) => p < BOOK_MIN_SKILLION_PITCH_DEG) : [];
  return (
    <fieldset className="flex flex-col gap-sq-1">
      <legend className="text-sq-micro font-medium text-sq-ink">
        {roof === 'gable' ? 'Gable' : 'Skillion'} pitches
      </legend>
      <ul className="flex flex-wrap items-center gap-sq-1">
        {pitches.map((pitch) => (
          <li key={pitch} className="inline-flex items-center gap-1 rounded-full border border-sq-line px-sq-2 py-1 text-sq-micro">
            <button
              type="button"
              aria-pressed={Math.abs(startPitch - pitch) < 1e-6}
              onClick={() => onPickStart(pitch)}
              className={Math.abs(startPitch - pitch) < 1e-6 ? 'font-semibold text-sq-ink' : 'text-sq-ink-muted'}
            >
              {pitch}°
            </button>
            <button
              type="button"
              aria-label={`Remove the ${pitch}° ${roof} pitch`}
              disabled={pitches.length <= 1}
              onClick={() => onChange(pitches.filter((p) => p !== pitch))}
              className="text-sq-ink-muted disabled:opacity-40"
            >
              ×
            </button>
          </li>
        ))}
        <li className="inline-flex items-center gap-1">
          <input
            aria-label={`Add a ${roof} pitch`}
            value={adding}
            inputMode="decimal"
            onChange={(e) => setAdding(e.target.value)}
            className="min-h-8 w-16 rounded-md border border-sq-line bg-sq-surface px-1 text-sq-micro tabular-nums"
          />
          <Button
            variant="ghost"
            onClick={() => {
              const value = Number(adding.replace(',', '.'));
              if (!Number.isFinite(value) || value <= 0 || value > 45) return;
              if (pitches.includes(value)) return;
              onChange([...pitches, value].sort((a, b) => a - b));
              setAdding('');
            }}
          >
            Add
          </Button>
        </li>
      </ul>
      <p className="text-sq-micro text-sq-ink-muted">
        Click a pitch to make it the starting one. The book states{' '}
        {roof === 'skillion' ? `${BOOK_MIN_SKILLION_PITCH_DEG}° minimum for a skillion` : '7.5–30°'}.
      </p>
      {low.length > 0 ? (
        <p className="text-sq-micro text-sq-attention">
          {low.join(', ')}° is below the book&rsquo;s minimum; such a design is flagged for the estimator.
        </p>
      ) : null}
    </fieldset>
  );
}

/** The opening rules: which kinds the type offers, how many, at what sizes. */
function OpeningRules({
  rules,
  lockedReason,
  onChange,
  onLockedReason,
}: {
  rules: GuestOpeningRuleSpec[];
  lockedReason: string;
  onChange: (rules: GuestOpeningRuleSpec[]) => void;
  onLockedReason: (reason: string) => void;
}) {
  const patch = (index: number, next: Partial<GuestOpeningRuleSpec>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));

  return (
    <div className="flex flex-col gap-sq-3">
      {rules.length === 0 ? (
        <Field
          id="guest-type-locked-reason"
          label="Why there are no doors or windows"
          maxLength={120}
          value={lockedReason}
          hint="Shown to the visitor instead of the door controls."
          onChange={(e) => onLockedReason(e.target.value)}
        />
      ) : null}

      {rules.map((rule, index) => (
        <div key={rule.type} className="rounded-md border border-sq-line p-sq-2">
          <div className="flex flex-wrap items-center gap-sq-2">
            <SelectField
              id={`guest-type-rule-${index}-type`}
              label="Kind"
              value={rule.type}
              onChange={(value) => patch(index, { type: value as GuestOpeningKind })}
              options={KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))}
            />
            <Field
              id={`guest-type-rule-${index}-max`}
              label="Most"
              type="number"
              min={0}
              max={10}
              value={String(rule.max)}
              onChange={(e) => patch(index, { max: Number(e.target.value) || 0 })}
            />
            <SelectField
              id={`guest-type-rule-${index}-wall`}
              label="Default wall"
              value={rule.defaultWall}
              onChange={(value) => patch(index, { defaultWall: value as WallSide })}
              options={WALLS.map((wall) => ({ value: wall, label: wall }))}
            />
            <Button
              variant="ghost"
              aria-label={`Remove the ${KIND_LABEL[rule.type]} rule`}
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>

          <span className="mt-sq-2 block text-sq-micro font-medium text-sq-ink">Sizes offered</span>
          <ul className="mt-sq-1 flex flex-col gap-sq-1">
            {rule.sizes.map((size, sizeIndex) => (
              <li key={sizeIndex} className="flex items-center gap-sq-2">
                <MetreInput
                  id={`guest-type-rule-${index}-size-${sizeIndex}-w`}
                  label={`${KIND_LABEL[rule.type]} width`}
                  mm={size.width}
                  onChange={(width) =>
                    patch(index, {
                      sizes: rule.sizes.map((s, i) => (i === sizeIndex ? { ...s, width } : s)),
                    })
                  }
                />
                <span className="text-sq-micro text-sq-ink-muted">×</span>
                <MetreInput
                  id={`guest-type-rule-${index}-size-${sizeIndex}-h`}
                  label={`${KIND_LABEL[rule.type]} height`}
                  mm={size.height}
                  onChange={(height) =>
                    patch(index, {
                      sizes: rule.sizes.map((s, i) => (i === sizeIndex ? { ...s, height } : s)),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  aria-label={`Remove size ${sizeIndex + 1} of the ${KIND_LABEL[rule.type]}`}
                  disabled={rule.sizes.length <= 1}
                  onClick={() => patch(index, { sizes: rule.sizes.filter((_, i) => i !== sizeIndex) })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            className="mt-sq-1"
            onClick={() => {
              const last = rule.sizes[rule.sizes.length - 1] ?? { width: 900, height: 2100 };
              patch(index, { sizes: [...rule.sizes, { ...last }] });
            }}
          >
            Add a size
          </Button>
        </div>
      ))}

      <div>
        <Button
          variant="secondary"
          disabled={rules.length >= 4}
          onClick={() => {
            const used = new Set(rules.map((r) => r.type));
            const next = KINDS.find((kind) => !used.has(kind)) ?? 'window';
            onChange([...rules, { type: next, max: 1, sizes: [{ width: 900, height: 2100 }], defaultWall: 'front' }]);
          }}
        >
          Add an opening kind
        </Button>
        <p className="mt-sq-1 text-sq-micro text-sq-ink-muted">
          No kinds at all means the type takes no doors or windows (a carport), and the reason above is what the
          visitor reads.
        </p>
      </div>
    </div>
  );
}

/** The doors a design starts with. */
function OpeningDefaults({
  defaults,
  rules,
  onChange,
}: {
  defaults: GuestOpeningSpec[];
  rules: GuestOpeningRuleSpec[];
  onChange: (defaults: GuestOpeningSpec[]) => void;
}) {
  const patch = (index: number, next: Partial<GuestOpeningSpec>) =>
    onChange(defaults.map((opening, i) => (i === index ? { ...opening, ...next } : opening)));

  return (
    <div className="flex flex-col gap-sq-2">
      <span className="text-sq-micro font-medium text-sq-ink">Doors the design starts with</span>
      {defaults.length === 0 ? (
        <p className="text-sq-micro text-sq-ink-muted">None — the visitor adds their own.</p>
      ) : null}
      {defaults.map((opening, index) => {
        const rule = rules.find((r) => r.type === opening.type);
        return (
          <div key={index} className="flex flex-wrap items-end gap-sq-2 rounded-md border border-sq-line p-sq-2">
            <SelectField
              id={`guest-type-default-${index}-type`}
              label="Kind"
              value={opening.type}
              onChange={(value) => {
                const kind = value as GuestOpeningKind;
                const nextRule = rules.find((r) => r.type === kind);
                patch(index, {
                  type: kind,
                  wall: nextRule?.defaultWall ?? opening.wall,
                  size: nextRule?.sizes[0] ?? opening.size,
                });
              }}
              options={(rules.length > 0 ? rules.map((r) => r.type) : KINDS).map((kind) => ({
                value: kind,
                label: KIND_LABEL[kind],
              }))}
            />
            <SelectField
              id={`guest-type-default-${index}-wall`}
              label="Wall"
              value={opening.wall}
              onChange={(value) => patch(index, { wall: value as WallSide })}
              options={WALLS.map((wall) => ({ value: wall, label: wall }))}
            />
            <SelectField
              id={`guest-type-default-${index}-size`}
              label="Size"
              value={`${opening.size.width}x${opening.size.height}`}
              onChange={(value) => {
                const [width, height] = value.split('x').map(Number);
                patch(index, { size: { width: width!, height: height! } });
              }}
              options={(rule?.sizes ?? [opening.size]).map((size) => ({
                value: `${size.width}x${size.height}`,
                label: `${mmToMetres(size.width)} × ${mmToMetres(size.height)} m`,
              }))}
            />
            <MetreInput
              id={`guest-type-default-${index}-offset`}
              label="Offset from the left corner"
              mm={opening.offset}
              onChange={(offset) => patch(index, { offset })}
            />
            <Button
              variant="ghost"
              aria-label={`Remove the starting ${KIND_LABEL[opening.type]}`}
              onClick={() => onChange(defaults.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <div>
        <Button
          variant="secondary"
          disabled={rules.length === 0 || defaults.length >= 10}
          onClick={() => {
            const rule = rules[0];
            if (rule === undefined) return;
            onChange([
              ...defaults,
              {
                type: rule.type,
                wall: rule.defaultWall,
                offset: 0,
                size: { ...rule.sizes[0]! },
                ...(rule.type === 'roller_door' ? { motorised: false } : {}),
              },
            ]);
          }}
        >
          Add a starting door
        </Button>
      </div>
    </div>
  );
}

/** Which colours the visitor may pick, and the ones a design starts with. */
function ColoursEditor({
  colours,
  onChange,
}: {
  colours: GuestBuildingTypeConfigSpec['colours'];
  onChange: (patch: Partial<GuestBuildingTypeConfigSpec['colours']>) => void;
}) {
  const allowed = colours.allowed;
  const toggle = (name: string) =>
    onChange({
      allowed: allowed.includes(name) ? allowed.filter((c) => c !== name) : [...allowed, name],
    });

  const patchDefaults = (patch: Partial<GuestColourChoice>) =>
    onChange({ defaults: { ...colours.defaults, ...patch } });

  return (
    <div className="flex flex-col gap-sq-3">
      <div className="grid gap-sq-2 sm:grid-cols-3">
        <SelectField
          id="guest-type-colour-walls"
          label="Starting wall colour"
          value={colours.defaults.walls}
          onChange={(value) => patchDefaults({ walls: value })}
          options={COLOUR_NAMES.map((name) => ({ value: name, label: name }))}
        />
        <SelectField
          id="guest-type-colour-roof"
          label="Starting roof colour"
          value={colours.defaults.roof}
          onChange={(value) => patchDefaults({ roof: value })}
          options={COLOUR_NAMES.map((name) => ({ value: name, label: name }))}
        />
        <SelectField
          id="guest-type-colour-trim"
          label="Starting trim colour"
          value={colours.defaults.trim.barge}
          onChange={(value) =>
            patchDefaults({ trim: { barge: value, gutter: value, downpipe: value } })
          }
          options={COLOUR_NAMES.map((name) => ({ value: name, label: name }))}
        />
      </div>

      <fieldset>
        <legend className="text-sq-micro font-medium text-sq-ink">
          Colours offered ({allowed.length})
        </legend>
        <ul className="mt-sq-1 grid max-h-64 grid-cols-2 gap-x-sq-3 gap-y-1 overflow-y-auto sm:grid-cols-3">
          {COLOUR_NAMES.map((name) => (
            <li key={name}>
              <label className="flex items-center gap-sq-2 text-sq-micro text-sq-ink">
                <input
                  type="checkbox"
                  checked={allowed.includes(name)}
                  onChange={() => toggle(name)}
                  className="h-4 w-4"
                />
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-sm border border-sq-line"
                  style={{ backgroundColor: COLORBOND[name] }}
                />
                {name}
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-sq-1 text-sq-micro text-sq-ink-muted">
          At least one colour is required; the starting colours above must be among them.
        </p>
      </fieldset>

      {allowed.length < 1 ? (
        <p className="text-sq-micro text-sq-danger">Choose at least one colour.</p>
      ) : null}
    </div>
  );
}
