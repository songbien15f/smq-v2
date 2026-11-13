'use client';

/**
 * The plan and the 3D model, in one reusable view.
 *
 * This is the working surface of every step, not of Step 2 alone: a salesperson
 * typing a span needs to see the shed change, and a person negotiating a price
 * needs to confirm which building that price belongs to. Keeping the view mounted
 * on all three steps is what makes those two things true.
 *
 * `interactive` is the only difference between the steps. On the Options step the
 * canvas places and drags; on Quote details and Cost it is a live preview, with
 * pointer events disabled so a stray click cannot move a door while someone is
 * typing a customer's name.
 *
 * The canvas is decorative to a screen reader — every object on it is also a row in
 * the lists beside it, with real controls.
 */

import { useMemo, useRef, useState } from 'react';
import { describeSelection } from '@sq/core/domain';
import type { FrameRowLayout } from '@sq/core/domain';
import { Render2D } from './Render2D';
import type { Render2DHandle } from './Render2D';
import { Render3D } from './Render3D';
import { ControlSheet } from './ControlSheet';
import { withDimensions } from '@sq/core/domain';
import { useShedStore } from '@/store/useShedStore';

export interface PlanViewProps {
  /** True on the Options step, where the canvas is the editor's working surface. */
  interactive?: boolean;
  /**
   * Purlin and girt rows from the last evaluation, or `null` before there is one.
   *
   * Passed down rather than read from the store because the evaluation is the editor's transient
   * state: it is not part of the quote, and a stale copy saved into the config would outlive the
   * price it belongs to.
   */
  frameLayout?: FrameRowLayout | null;
}

export function PlanView({ interactive = true, frameLayout = null }: PlanViewProps) {
  const config = useShedStore((state) => state.config);
  const selection = useShedStore((state) => state.selection);
  const view = useShedStore((state) => state.view);
  const setView = useShedStore((state) => state.setView);

  /**
   * Whether the 3D model is drawn with its roof.
   *
   * Local to this view and not in the store: it is a way of looking at the drawing, not a property
   * of the quote, so it must not reach the saved config, the history stack or the `.sqd`. A person
   * lifting the roof off to show a customer the frame should not create an undo step.
   */
  const [showRoof, setShowRoof] = useState(true);

  /**
   * The 2D canvas, so its picture can be saved.
   *
   * `exportPng()` has existed on `Render2D`'s imperative handle since the plan was built and
   * **nothing ever passed a ref**, so "copy the plan as an image" — a thing the desktop offered and
   * a thing a salesperson does to paste a plan into an email — was unreachable. A handle nobody
   * holds is dead code that looks like a feature.
   */
  const render2d = useRef<Render2DHandle | null>(null);

  const saveAsImage = (): void => {
    const url = render2d.current?.exportPng() ?? null;
    if (url === null) return;
    // A real `<a download>` rather than `window.open`: a data URL opened in a tab is a page the
    // person then has to save by hand, and some browsers refuse to open one at all.
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plan.png';
    link.click();
  };

  const selectedLabel = useMemo(() => {
    /*
     * Nothing can be selected on a building that does not exist yet, so the empty answer is the
     * closed sheet's own label rather than a call that needs dimensions.
     */
    const building = withDimensions(config);
    if (building === null) return 'nothing';
    const description = describeSelection(building, selection);
    return description.title === '' ? 'nothing' : description.title;
  }, [selection, config]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-sq-2">
      <div className="flex items-center gap-sq-1" role="group" aria-label="View">
        {(['2d', '3d'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            onClick={() => setView(mode)}
            className={[
              'min-h-11 cursor-pointer rounded-md border px-sq-2 text-sq-body font-medium transition-colors duration-sq-fast',
              view === mode
                ? // Selected, not primary: a solid fill is reserved for the one action (Save) per screen.
                  'border-sq-brand bg-sq-brand/10 text-sq-brand'
                : 'border-sq-line bg-sq-surface text-sq-ink hover:bg-sq-ground',
            ].join(' ')}
          >
            {mode === '2d' ? 'Plan' : '3D'}
          </button>
        ))}
        {/*
          Save the plan as a picture. Only meaningful in 2D — the 3D view is a canvas the user orbits,
          and there is no exporter for it — so the button appears with the 2D plan rather than sitting
          disabled in 3D with no explanation.
        */}
        {view === '2d' && (
          <button
            type="button"
            onClick={saveAsImage}
            className="min-h-11 cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body font-medium text-sq-ink transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            Save image
          </button>
        )}
        {/*
          Lift the roof off. In 3D only, because that is the only view with a roof to remove, and
          because the plan is a drawing of the building rather than a picture of it.
        */}
        {view === '3d' && (
          <button
            type="button"
            aria-pressed={showRoof}
            onClick={() => setShowRoof((current) => !current)}
            className={[
              'min-h-11 cursor-pointer rounded-md border px-sq-2 text-sq-body font-medium transition-colors duration-sq-fast',
              showRoof
                ? 'border-sq-line bg-sq-surface text-sq-ink hover:bg-sq-ground'
                : 'border-sq-brand bg-sq-brand/10 text-sq-brand',
            ].join(' ')}
          >
            Roof
          </button>
        )}
      </div>

      <div
        className={[
          'min-h-0 flex-1 overflow-hidden rounded-md border border-sq-line bg-white',
          interactive ? '' : 'pointer-events-none',
          /*
           * The 3D view keeps a fixed height on a phone — the container there is in flow and
           * has no height of its own — but on desktop it fills the column, which is now pinned
           * to the viewport. A fixed 420 px inside a 900 px column would leave the model in a
           * letterbox with dead space above and below it.
           */
          view === '3d' ? 'h-[420px] lg:h-auto' : '',
        ].join(' ')}
        role="img"
        aria-label={
          view === '2d'
            ? `Plan of a ${config.span} by ${config.length} millimetre shed with ${config.openings.length} openings and ${config.options.length} options`
            : `3D view of a ${config.span} by ${config.length} millimetre shed`
        }
      >
        {view === '2d' ? <Render2D ref={render2d} /> : <Render3D showRoof={showRoof} frameRows={frameLayout} />}
      </div>

      {/*
        The phone's object editor. It renders nothing above the `lg` breakpoint — the floating card
        on the canvas is that layout's editor — so mounting it here unconditionally is what keeps
        the two from ever being decided by different conditions.

        Mounted on the view rather than inside `Render2D` because the sheet is `position: fixed`:
        inside the canvas's `overflow-hidden` wrapper it would be clipped to the plan, which is the
        one place it must not be confined to.
      */}
      <ControlSheet />

      <p className="text-sq-micro text-sq-ink-muted">
        {!interactive ? (
          <>This is the building as it stands. Place doors and options on the Options step.</>
        ) : view === '2d' ? (
          <>
            Drag a door or an option to move it, or use the lists beside the plan. Selected:{' '}
            <strong className="text-sq-ink">{selectedLabel}</strong>
          </>
        ) : (
          <>Drag to orbit, scroll or pinch to zoom. The model is built from the plan, so the two cannot disagree.</>
        )}
      </p>
    </div>
  );
}
