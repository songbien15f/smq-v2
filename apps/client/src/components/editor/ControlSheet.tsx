'use client';

/**
 * The mobile object editor: a bottom sheet over the plan.
 *
 * ## Why this exists
 *
 * Below 1024 px the plan could place and drag a door, and the wrench appeared when one was
 * selected — but tapping it did nothing, because `SelectionPopover` renders only on desktop and the
 * sheet it was meant to hand over to was never written. Three files' worth of comments described
 * this component; none of them described code. A control that acknowledges a tap and then does
 * nothing is worse than no control, because the operator concludes the feature is missing rather
 * than that they missed it.
 *
 * ## Why a bottom sheet and not a centred dialog
 *
 * The plan is the thing being edited, so the editor must leave as much of it visible as it can, and
 * what it covers should be the bottom — where a thumb rests and where nothing important is drawn.
 * A centred modal on a 375 px screen covers the building and the sheet's own controls fight for the
 * same space.
 *
 * ## Why it shares `SelectionFields` rather than re-implementing the controls
 *
 * Two editors for one object is two places for a field to be written differently. `SelectionFields`
 * already owns the mapping from a `FieldSpec` back to `patchOpening` / `patchOption` /
 * `applyPartial` — including the dotted `panels.left` key and the carry beam's empty-string
 * "open" — so this component supplies only the chrome: where it sits, how it dismisses, and what
 * happens to the selection when it does.
 *
 * ## Accessibility, which a sheet cannot inherit
 *
 * - `role="dialog"` + `aria-modal`, labelled by what is being edited.
 * - **Focus moves in** on open and **returns to the trigger** on close. Without both, a keyboard or
 *   switch user is pressing into the page behind the sheet, then loses their place when it shuts.
 * - Escape closes, and so does the backdrop: a phone has no Escape key, and a sheet with only a
 *   small Close button is a sheet people get stuck in.
 * - Every control is at least 44 px in both directions. WCAG's web target is 24 px, and this
 *   product already uses 44 for the wrench and the plan's buttons; a 20 px Close button is the
 *   detail that makes a mobile editor feel broken.
 *
 * ## Why a drag hides it rather than closing it
 *
 * A door is moved by dragging it on the canvas, and the sheet covers most of a phone's screen. A
 * drag therefore collapses the sheet and brings it back afterwards, leaving `editorOpen` and the
 * selection alone — `objectDragging` exists for exactly this and was, like this component, declared
 * and never read.
 */

import { useEffect, useRef } from 'react';
import { describeSelection } from '@sq/core/domain';
import { useMediaQuery, DESKTOP_QUERY } from '@/hooks/useMediaQuery';
import { useShedStore } from '@/store/useShedStore';
import { SelectionFields } from './SelectionPopover';

/**
 * The control that opens this editor, by its accessible name.
 *
 * Focus goes back here when the sheet closes. It cannot be a remembered **element**: the wrench is
 * rendered only while the editor is *closed*, so React removes it in the very commit that opens the
 * sheet — and removing the focused element is what moves focus to `<body>`. By the time this
 * component's effect runs, `document.activeElement` is already `<body>`, so there is nothing to
 * remember. Measured in a browser; the jsdom test passed because its trigger never unmounted.
 *
 * A name is stable across that re-render, which is what makes it the right handle.
 */
const EDIT_TRIGGER = '[aria-label="Edit selected object"]';

export function ControlSheet() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const config = useShedStore((state) => state.config);
  const selection = useShedStore((state) => state.selection);
  const editorOpen = useShedStore((state) => state.editorOpen);
  const objectDragging = useShedStore((state) => state.objectDragging);
  const setSheetOpen = useShedStore((state) => state.setSheetOpen);

  const description = describeSelection(config, selection);
  const hasFields = description.fields.length > 0;

  /*
   * Open while an object's editor is up, on a phone, and nothing is being dragged. All three are
   * read from the store rather than held locally: the wrench, the plan and this sheet must agree,
   * and a local `open` would be a fourth opinion.
   */
  const open = !isDesktop && editorOpen && hasFields && !objectDragging;

  /*
   * Keep the store's `sheetOpen` in step with what is rendered. The store's own close path clears
   * the selection, so it has to be told when the sheet is up; deriving it here rather than storing
   * a second source of truth is what keeps the two from disagreeing.
   */
  useEffect(() => {
    if (open && !useShedStore.getState().sheetOpen) setSheetOpen(true);
  }, [open, setSheetOpen]);

  const sheetRef = useRef<HTMLDivElement | null>(null);

  /*
   * Move focus into the sheet, and put it back on the control that opened it when the sheet goes.
   *
   * **Nothing is remembered at open time, and that is the whole point.** The wrench is rendered only
   * while the editor is *closed*, so React removes it in the same commit that opens this sheet — and
   * removing the focused element moves focus to `<body>` before this effect ever runs. Remembering
   * `document.activeElement` here would remember `<body>`. The control is found again by its
   * accessible name instead, which survives the re-render.
   *
   * **The restore is deferred by one task**, because the replacement wrench is not in the tree until
   * the rest of that commit has painted. And it is a `setTimeout`, not a `requestAnimationFrame`: a
   * frame callback does not run while the document lacks OS focus (`document.hasFocus()` is false in
   * a background window or an embedded pane), which was measured here — rAF never fired and focus
   * stayed on `<body>`.
   *
   * The restore lives in the *cleanup* so it also runs on unmount. An effect keyed on `open ===
   * false` never runs then, because the page it rendered into is gone.
   *
   * `focus()` on the container rather than the first input: focusing an input on a phone raises the
   * keyboard, which covers the plan the sheet was moved to the bottom to reveal.
   */
  useEffect(() => {
    if (!open) return;

    sheetRef.current?.focus();

    return () => {
      const restore = (): void => {
        const trigger = document.querySelector<HTMLElement>(EDIT_TRIGGER);
        if (trigger !== null) trigger.focus();
      };

      if (typeof setTimeout === 'function') setTimeout(restore, 0);
      else restore();
    };
  }, [open]);

  const close = (): void => {
    /*
     * One call, because `setSheetOpen(false)` owns the whole mobile "out focus": it closes the
     * sheet, closes the editor, and clears the selection when it was the editor showing. Every
     * dismissal below goes through it, so there is no second implementation to drift.
     */
    setSheetOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // `close` closes over `setSheetOpen`, which is stable for the store's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
      {/*
        The backdrop. A tap anywhere on the plan half dismisses, which is the gesture a thumb
        expects; it is a real button so a screen reader can reach it too, and it is not focusable by
        Tab because the sheet itself must be the first stop — otherwise the first Tab press lands on
        "close" from behind, which is confusing.
      */}
      <button
        type="button"
        data-testid="control-sheet-backdrop"
        aria-label="Close the editor"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 cursor-default bg-sq-ink/30"
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={description.title}
        tabIndex={-1}
        className="relative max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-xl border-t border-sq-line bg-sq-surface px-sq-3 pb-[calc(var(--spacing-sq-4)+env(safe-area-inset-bottom,0px))] pt-sq-2 shadow-lg outline-none"
      >
        {/*
          The grab handle. Decorative: dragging it is a convenience on a touch screen, and the Close
          control is the reliable path, so it carries no semantics a screen reader would need.
        */}
        <div aria-hidden="true" className="mx-auto mb-sq-2 h-1 w-10 rounded-full bg-sq-line" />

        <SelectionFields onDone={close} />
      </div>
    </div>
  );
}
