'use client';

/**
 * Step 2 — the plan, with the options on it.
 *
 * The 2D canvas is the geometry editor from the domain layer, unchanged: it draws from
 * `buildPlanGeometry` and writes selections back, so it has no opinion about pricing. What this
 * screen adds is the frame around it — where the operator picks a tool, sees what is placed, and
 * reaches the next step.
 *
 * ## Accessibility, which a canvas cannot provide on its own
 *
 * `ui-ux-pro-max` is explicit that dragging must not be the only way to do something. So the plan
 * is backed by **lists**: every opening and every option is also a row with its own controls, and
 * every placement that can be dragged can also be selected and removed from that list. A person who
 * cannot use a mouse can place a door or a mezzanine; they just do it from the buttons and lists
 * rather than by dragging on the canvas.
 *
 * The canvas itself is `aria-hidden` and described by a summary, because a screen reader has
 * nothing useful to say about a `<canvas>` — the lists are the accessible representation.
 *
 * ## Why every option kind has a button
 *
 * The domain, the schema and the BOM have supported all eleven option kinds from the start, and the
 * canvas could already draw, hit-test, drag and edit one — but nothing could **create** one, so a
 * quote could only contain an option that arrived some other way. The buttons below close that gap:
 * each kind is one press away, and the store places it at a legal default (`defaultOptionsFor`)
 * exactly as the desktop's "Add" per category did.
 */

import { useMemo, useState } from 'react';
import {
  OPENING_TYPE_OPTIONS,
  OPTION_GROUP_LABELS,
  OPTION_KIND_OPTIONS,
  canDuplicate,
  describeSelection,
} from '@sq/core/domain';
import type { OpeningType, ShedOption } from '@sq/core/domain';
import { Button, Panel, StatusPill } from '@sq/ui';
import { Render2D } from './Render2D';
import { Render3D } from './Render3D';
import { useShedStore } from '@/store/useShedStore';

/** The tools the operator can place. Windows and doors are the ones a quote is built from. */
const PLACEABLE: { type: OpeningType; label: string }[] = [
  { type: 'roller_door', label: 'Roller door' },
  { type: 'pa_door', label: 'PA door' },
  { type: 'sliding_door', label: 'Sliding door' },
  { type: 'window', label: 'Window' },
];

/**
 * A short line describing one option, for its row in the list.
 *
 * Derived from the same fields the popover edits, so a row and its editor never disagree about
 * where the object is. Deliberately terse: the popover is where the numbers are changed, this is
 * just enough to tell two rows of the same kind apart.
 */
function optionSummary(option: ShedOption): string {
  switch (option.kind) {
    case 'skylight':
      return `bay ${option.bay + 1}, ${option.width} × ${option.height} mm`;
    case 'mezzanine':
      return `${option.width} × ${option.depth} mm at ${option.level} mm`;
    case 'awning':
      return `${option.width} mm on the ${option.wall} wall`;
    case 'outrigger':
      return `bay ${option.bay + 1} on the ${option.wall} wall`;
    case 'dividing_wall':
      return `${option.height} mm tall across the ${option.axis === 'x' ? 'width' : 'length'}`;
    case 'gable_infill':
      return `${option.end} gable end`;
    case 'stable':
      return `${option.width} × ${option.depth} mm on the ${option.wall} wall`;
    case 'carry_beam':
      return `bay ${option.beginBay + 1} on the ${option.wall} wall`;
    case 'horizontal_cladding':
      return `${option.from}–${option.to} mm on the ${option.wall} wall`;
    case 'overhang':
      return `${option.depth} mm on the ${option.wall} wall`;
    case 'cantilever':
      return `bay ${option.bay + 1} on the ${option.wall} wall`;
  }
}

export function PlanPanel() {
  const config = useShedStore((state) => state.config);
  const selection = useShedStore((state) => state.selection);
  const addOpening = useShedStore((state) => state.addOpening);
  const patchOpening = useShedStore((state) => state.patchOpening);
  const removeOpening = useShedStore((state) => state.removeOpening);
  const addOption = useShedStore((state) => state.addOption);
  const duplicateOption = useShedStore((state) => state.duplicateOption);
  const removeOption = useShedStore((state) => state.removeOption);
  const select = useShedStore((state) => state.select);
  const undo = useShedStore((state) => state.undo);
  const redo = useShedStore((state) => state.redo);
  const view = useShedStore((state) => state.view);
  const setView = useShedStore((state) => state.setView);
  const past = useShedStore((state) => state.history.length);
  const future = useShedStore((state) => state.future.length);
  const notices = useShedStore((state) => state.notices);

  const [pendingType, setPendingType] = useState<OpeningType | null>(null);

  const selectedId = selection.kind === 'opening' ? selection.id : null;
  const selectedOptionId = selection.kind === 'option' ? selection.id : null;
  const selectedLabel = useMemo(() => {
    const description = describeSelection(config, selection);
    return description.title === '' ? 'nothing' : description.title;
  }, [selection, config]);

  return (
    <div className="flex flex-col gap-sq-3">
      <Panel
        title="Building"
        description={`${config.span} mm span × ${config.length} mm long, ${config.height} mm walls, ${config.bays} bays`}
        actions={
          <div className="flex items-center gap-sq-1">
            <Button
              variant="ghost"
              disabled={past === 0}
              onClick={undo}
              aria-label="Undo the last change"
              title="Undo (Ctrl+Z)"
            >
              Undo
            </Button>
            <Button
              variant="ghost"
              disabled={future === 0}
              onClick={redo}
              aria-label="Redo the last undone change"
              title="Redo (Ctrl+Shift+Z)"
            >
              Redo
            </Button>
          </div>
        }
      >
        {/* ---------------------------------------------------------------- tools */}
        <div className="flex flex-wrap items-center gap-sq-2">
          <span className="text-sq-micro font-medium text-sq-ink-muted" id="place-tools-label">
            Place
          </span>
          <div role="group" aria-labelledby="place-tools-label" className="flex flex-wrap gap-sq-1">
            {PLACEABLE.map((tool) => {
              const active = pendingType === tool.type;
              return (
                <button
                  key={tool.type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (active) {
                      setPendingType(null);
                      return;
                    }
                    setPendingType(tool.type);
                    // Adding through the store rather than waiting for a click on the canvas: the
                    // store places it at a legal position and raises a notice if it cannot, which
                    // is the same rule the drag path uses.
                    addOpening({ type: tool.type });
                    setPendingType(null);
                  }}
                  className={[
                    'min-h-11 cursor-pointer rounded-md border px-sq-2 text-sq-body font-medium transition-colors duration-sq-fast',
                    active
                      ? 'border-sq-brand bg-sq-brand text-white'
                      : 'border-sq-line bg-sq-surface text-sq-ink hover:bg-sq-ground',
                  ].join(' ')}
                >
                  {tool.label}
                </button>
              );
            })}
          </div>
        </div>

        {/*
          The eleven option kinds, one button each, grouped by where the object sits. Every kind the
          domain knows is reachable here — the canvas can place openings only, so without these the
          options the BOM already prices could never be added.
        */}
        <div className="mt-sq-2 flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink-muted" id="place-options-label">
            Place option
          </span>
          <div
            role="group"
            aria-labelledby="place-options-label"
            className="flex flex-col gap-sq-1"
          >
            {OPTION_GROUP_LABELS.map((group) => (
              <div
                key={group.value}
                role="group"
                aria-label={`Place option: ${group.label}`}
                className="flex flex-wrap items-center gap-sq-1"
              >
                <span className="w-16 shrink-0 text-sq-micro text-sq-ink-muted">
                  {group.label}
                </span>
                {OPTION_KIND_OPTIONS.filter((option) => option.group === group.value).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => addOption(option.value)}
                    className="min-h-11 cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body font-medium text-sq-ink transition-colors duration-sq-fast hover:bg-sq-ground"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {notices.length > 0 && (
          <ul className="mt-sq-2 flex flex-col gap-1" aria-live="polite">
            {notices.map((notice, index) => (
              <li key={index} className="flex items-start gap-1 text-sq-micro text-sq-attention">
                <StatusPill tone="attention" label="Note" />
                <span>{notice}</span>
              </li>
            ))}
          </ul>
        )}

        {/* ---------------------------------------------------------------- canvas */}
        <div className="mt-sq-3">
          {/*
            The view toggle. 2D is where you place and drag; 3D is where a customer sees what they
            are buying. Both read the same config, so the model is never a second drawing that can
            disagree with the plan.

            A toggle rather than two panes: the plan is the working surface and the model is the
            check, and splitting a 380 px column in two would make both unusable.
          */}
          <div className="mb-sq-2 flex items-center gap-sq-1" role="group" aria-label="View">
            {(['2d', '3d'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={[
                  'min-h-11 cursor-pointer rounded-md border px-sq-2 text-sq-body font-medium transition-colors duration-sq-fast',
                  view === mode
                    ? 'border-sq-brand bg-sq-brand text-white'
                    : 'border-sq-line bg-sq-surface text-sq-ink hover:bg-sq-ground',
                ].join(' ')}
              >
                {mode === '2d' ? 'Plan' : '3D'}
              </button>
            ))}
          </div>

          {/*
            The canvas is decorative to a screen reader: everything it shows is in the lists below,
            with real controls. This is the pattern the UX guidance requires for a drag surface —
            the lists are the accessible interface, the canvas is the convenience.
          */}
          <div
            className="overflow-hidden rounded-md border border-sq-line bg-white"
            role="img"
            aria-label={
              view === '2d'
                ? `Plan of a ${config.span} by ${config.length} millimetre shed with ${config.openings.length} openings and ${config.options.length} options`
                : `3D view of a ${config.span} by ${config.length} millimetre shed`
            }
            style={{ height: view === '3d' ? '420px' : undefined }}
          >
            {view === '2d' ? <Render2D /> : <Render3D />}
          </div>
          <p className="mt-sq-1 text-sq-micro text-sq-ink-muted">
            {view === '2d' ? (
              <>
                Drag a door or an option to move it, or use the lists below. Selected:{' '}
                <strong className="text-sq-ink">{selectedLabel}</strong>
              </>
            ) : (
              <>Drag to orbit, scroll or pinch to zoom. The model is built from the plan, so the two cannot disagree.</>
            )}
          </p>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- the list */}
      <Panel
        title="Openings"
        description="Every door and window on the building, in the order they were added."
        padded={false}
      >
        {config.openings.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            No openings yet. A shed with no doors is a valid building but a rare quote — add one
            with the buttons above.
          </p>
        ) : (
          <ul className="flex flex-col">
            {config.openings.map((opening) => {
              const isSelected = opening.id === selectedId;
              const label =
                OPENING_TYPE_OPTIONS.find((option) => option.value === opening.type)?.label ??
                opening.type;

              return (
                <li
                  key={opening.id}
                  className={[
                    'flex flex-wrap items-center gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2 last:border-0',
                    isSelected ? 'bg-sq-brand/5' : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => select({ kind: 'opening', id: opening.id })}
                    aria-pressed={isSelected}
                    className="min-h-11 min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <span className="text-sq-body font-medium text-sq-ink">{label}</span>
                    <span className="ml-sq-2 sq-numeric text-sq-micro text-sq-ink-muted">
                      {opening.width} × {opening.height} mm on the {opening.wall} wall
                    </span>
                  </button>

                  {/*
                    Per-item controls rather than a drag-only affordance. These are the same
                    operations the canvas offers, which is what makes the canvas optional.
                  */}
                  <div className="flex items-center gap-sq-1">
                    <Button
                      variant="ghost"
                      onClick={() => patchOpening(opening.id, { width: Math.max(300, opening.width - 100) })}
                      aria-label={`Make the ${label} narrower`}
                      title="Narrower by 100 mm"
                    >
                      −
                    </Button>
                    <span className="sq-numeric w-16 text-center text-sq-micro text-sq-ink-muted">
                      {opening.width} mm
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => patchOpening(opening.id, { width: opening.width + 100 })}
                      aria-label={`Make the ${label} wider`}
                      title="Wider by 100 mm"
                    >
                      +
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => removeOpening(opening.id)}
                      aria-label={`Remove the ${label}`}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Options"
        description="Everything added beyond the walls and openings — skylights, awnings, mezzanines and the rest."
        padded={false}
      >
        {config.options.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            No options yet. Add a skylight, a mezzanine or an awning with the option buttons above;
            it appears here and on the plan, where it can be dragged and adjusted.
          </p>
        ) : (
          <ul className="flex flex-col">
            {config.options.map((option) => {
              const isSelected = option.id === selectedOptionId;
              const label =
                OPTION_KIND_OPTIONS.find((entry) => entry.value === option.kind)?.label ??
                option.kind;

              return (
                <li
                  key={option.id}
                  className={[
                    'flex flex-wrap items-center gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2 last:border-0',
                    isSelected ? 'bg-sq-brand/5' : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => select({ kind: 'option', id: option.id })}
                    aria-pressed={isSelected}
                    className="min-h-11 min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <span className="text-sq-body font-medium text-sq-ink">{label}</span>
                    <span className="ml-sq-2 sq-numeric text-sq-micro text-sq-ink-muted">
                      {optionSummary(option)}
                    </span>
                  </button>

                  <div className="flex items-center gap-sq-1">
                    {/* An overhang and a cladding band span their whole wall, so a copy would land
                        on top of the original — `canDuplicate` says which kinds a copy makes sense
                        for, the same rule the canvas menu follows. */}
                    {canDuplicate(option) && (
                      <Button
                        variant="ghost"
                        onClick={() => duplicateOption(option.id)}
                        aria-label={`Duplicate the ${label}`}
                      >
                        Duplicate
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      onClick={() => removeOption(option.id)}
                      aria-label={`Remove the ${label}`}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
