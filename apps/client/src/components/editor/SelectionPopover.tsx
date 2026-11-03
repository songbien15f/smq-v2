'use client';

/**
 * The selection editor (spec §5.6).
 *
 * `SelectionFields` is the shared body: the title row plus one control per
 * `FieldSpec` from `describeSelection`, with no positioning or chrome. The
 * floating `SelectionPopover` (desktop) and the mobile bottom sheet in
 * `ControlSheet` both render it, so the two layouts edit through exactly the
 * same controls and the same store calls.
 *
 * Editing writes straight through the store (`patchOpening` for a door,
 * `applyPartial` for the building), so the popover, the canvas, and the form all
 * share one config and one selection.
 *
 * When the description has no fields (nothing selected, or a dangling id) the
 * body renders nothing rather than an empty card.
 */

import { useEffect, useRef, useState } from 'react';
import { describeSelection, popoverPosition, type FieldSpec } from '@sq/core/domain';
import { formatDimension, parseDimension, toDisplayUnit } from '@sq/core/domain';
import type { DisplayUnit, Opening, ShedConfig, ShedOption } from '@sq/core/domain';
import { useShedStore } from '@/store/useShedStore';

/** The card's on-screen size, used for viewport-safe placement. */
const CARD_WIDTH = 256;
const CARD_HEIGHT = 320;

export interface SelectionPopoverProps {
  /** Screen-pixel anchor to sit beside; omitted, the card uses its CSS default. */
  anchor?: { x: number; y: number };
}

export interface SelectionFieldsProps {
  /**
   * Invoked by the Close control. Defaults to closing the editor while keeping
   * the selection, so the wrench affordance stays on the plan (the floating
   * card's behaviour); the mobile drawer passes its own handler so Close
   * dismisses the sheet and releases the object.
   */
  onDone?: () => void;
  /**
   * Suppress the in-body title row's heading. The mobile drawer sets this
   * because its own `Drawer.Title` already names what is being edited, so the
   * two do not stack. The Close control is always rendered.
   */
  hideTitle?: boolean;
}

/** Parse a plain number, returning `null` for empty/unreadable input. */
function parseNumberSafe(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Parse a dimension in `unit` to millimetres, `null` when unreadable. */
function parseDimensionSafe(raw: string, unit: DisplayUnit): number | null {
  try {
    return parseDimension(raw, unit);
  } catch {
    return null;
  }
}

/**
 * A numeric input backed by a local draft, so a partial entry survives even
 * though it cannot yet be parsed. An unreadable value is skipped, leaving the
 * store untouched — the same guard `InputForm` uses.
 *
 * A **dimension** field (`spec.unit` present) stores millimetres but shows and
 * accepts the display unit, so it matches the form exactly: a 12000 mm span
 * reads "12.00" and typing "15" writes 15000 mm. Its bounds are converted to the
 * display unit too, so `min` is not read as 1000 metres. A non-dimension number
 * (bays, roof pitch) is shown verbatim.
 */
function PopoverNumberField({
  id,
  spec,
  onCommit,
}: {
  id: string;
  spec: FieldSpec;
  onCommit: (value: number) => void;
}) {
  const unit = spec.unit;
  const isDimension = unit !== undefined;
  const stored = typeof spec.value === 'number' ? spec.value : 0;
  const formatted = isDimension ? formatDimension(stored, unit) : String(stored);
  const [draft, setDraft] = useState(formatted);
  const committed = useRef<number | null>(null);

  useEffect(() => {
    const expected = committed.current === null ? null : isDimension ? formatDimension(committed.current, unit) : String(committed.current);
    if (formatted !== expected) {
      setDraft(formatted);
      committed.current = null;
    }
    // `unit`/`isDimension` are derived from the spec; `formatted` covers every
    // case in which the displayed text can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatted]);

  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className="text-xs font-medium text-slate-600">{spec.label}</span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={spec.min === undefined ? undefined : isDimension ? toDisplayUnit(spec.min, unit) : spec.min}
        max={spec.max === undefined ? undefined : isDimension ? toDisplayUnit(spec.max, unit) : spec.max}
        step={spec.step === undefined ? undefined : isDimension ? toDisplayUnit(spec.step, unit) : spec.step}
        value={draft}
        disabled={spec.disabled}
        className="h-11 w-full rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const parsed = isDimension ? parseDimensionSafe(raw, unit) : parseNumberSafe(raw);
          if (parsed === null) return;
          committed.current = parsed;
          onCommit(parsed);
        }}
      />
    </label>
  );
}

/** A select backed by the spec's options; the `''` sentinel maps back to null. */
function PopoverSelectField({
  id,
  spec,
  onCommit,
}: {
  id: string;
  spec: FieldSpec;
  onCommit: (value: string | null) => void;
}) {
  const options = spec.options ?? [];
  const current = typeof spec.value === 'string' ? spec.value : String(spec.value ?? '');
  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className="text-xs font-medium text-slate-600">{spec.label}</span>
      <select
        id={id}
        value={current}
        disabled={spec.disabled}
        className="h-11 w-full rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
        onChange={(event) => {
          const raw = event.target.value;
          const match = options.find((option) => option.value === raw);
          if (match === undefined) return;
          onCommit(match.value === '' ? null : match.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The shared editor body: the title row and one control per `FieldSpec`, with
 * no positioning or chrome of its own. It renders `null` when the description
 * has no fields, so both hosts (the floating card and the mobile drawer) can
 * render it unconditionally.
 */
export function SelectionFields({ onDone, hideTitle = false }: SelectionFieldsProps) {
  const config = useShedStore((s) => s.config);
  const selection = useShedStore((s) => s.selection);
  const setEditorOpen = useShedStore((s) => s.setEditorOpen);
  const patchOpening = useShedStore((s) => s.patchOpening);
  const patchOption = useShedStore((s) => s.patchOption);
  const applyPartial = useShedStore((s) => s.applyPartial);

  const description = describeSelection(config, selection);
  if (description.fields.length === 0) return null;

  /**
   * Write one field through the store: patch a door, patch an option, or apply
   * to the building.
   *
   * The option branch is load-bearing: without it every option field (`height`,
   * `width`, `bay`, …) falls through to `applyPartial` and is written as a
   * *building* field — editing a skylight's height would resize the shed and
   * leave the skylight untouched.
   */
  function writeField(key: string, value: number | string | null): void {
    // A dotted key names a nested field: `panels.left` is the stable's left
    // panel. Building `{ [key]: value }` for it would create a literal
    // "panels.left" property that the normaliser strips, so the toggle would
    // silently do nothing.
    if (description.kind === 'option' && description.id !== undefined && key.startsWith('panels.')) {
      const panel = key.slice('panels.'.length) as 'left' | 'right' | 'front' | 'back';
      const option = config.options.find((entry) => entry.id === description.id);
      if (option === undefined || option.kind !== 'stable') return;
      patchOption(option.id, {
        panels: { ...option.panels, [panel]: value === 'true' },
      } as Partial<ShedOption>);
      return;
    }
    // The key is a `FieldSpec.key`, so it names a real config/opening/option
    // field; the computed-key object needs a cast because TypeScript cannot know
    // which one.
    if (description.kind === 'opening' && description.id !== undefined) {
      patchOpening(description.id, { [key]: value } as Partial<Opening>);
      return;
    }
    if (description.kind === 'option' && description.id !== undefined) {
      // A carry beam's "Spans" select uses the empty string for "open", because
      // a `<select>` value cannot be `null`; the model wants `null`.
      const patch =
        key === 'openingId'
          ? ({ openingId: value === '' || value === null ? null : String(value) } as Partial<ShedOption>)
          : ({ [key]: value } as Partial<ShedOption>);
      patchOption(description.id, patch);
      return;
    }
    applyPartial({ [key]: value } as Partial<ShedConfig>);
  }

  return (
    <>
      <div
        className={`mb-2 flex items-center ${
          hideTitle ? 'justify-end' : 'justify-between'
        }`}
      >
        {!hideTitle && (
          <span className="text-sm font-semibold text-slate-700">{description.title}</span>
        )}
        <button
          type="button"
          aria-label="Close"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50"
          onClick={() => (onDone === undefined ? setEditorOpen(false) : onDone())}
        >
          Close
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {description.fields.map((spec) => {
          const id = `popover-${description.id ?? 'building'}-${spec.key}`;
          return spec.type === 'number' ? (
            <PopoverNumberField
              key={spec.key}
              id={id}
              spec={spec}
              onCommit={(value) => writeField(spec.key, value)}
            />
          ) : (
            <PopoverSelectField
              key={spec.key}
              id={id}
              spec={spec}
              onCommit={(value) => writeField(spec.key, value)}
            />
          );
        })}
      </div>
    </>
  );
}

/**
 * The floating desktop card. A thin wrapper: it computes the anchor position,
 * owns the card chrome (`role="dialog"`, the title `aria-label`) and the Escape
 * handler, and renders the shared `SelectionFields` body inside.
 */
export function SelectionPopover({ anchor }: SelectionPopoverProps) {
  const config = useShedStore((s) => s.config);
  const selection = useShedStore((s) => s.selection);
  const setEditorOpen = useShedStore((s) => s.setEditorOpen);

  const description = describeSelection(config, selection);
  const open = description.fields.length > 0;

  // Escape closes the popover while it is open, keeping the selection so the
  // wrench stays on the plan. The handler is registered unconditionally (hooks
  // are not conditional) but no-ops when closed.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setEditorOpen]);

  if (!open) return null;

  const style =
    anchor === undefined
      ? undefined
      : (() => {
          const viewport = {
            width: typeof window === 'undefined' ? CARD_WIDTH : window.innerWidth,
            height: typeof window === 'undefined' ? CARD_HEIGHT : window.innerHeight,
          };
          const { x, y } = popoverPosition(anchor, { width: CARD_WIDTH, height: CARD_HEIGHT }, viewport);
          return { left: x, top: y };
        })();

  return (
    <div
      className="absolute z-10 w-64 rounded-lg border border-slate-300 bg-white p-3 shadow-lg"
      style={style}
      role="dialog"
      aria-label={description.title}
    >
      <SelectionFields />
    </div>
  );
}
