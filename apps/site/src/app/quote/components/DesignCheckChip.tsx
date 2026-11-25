'use client';

/**
 * "Design check" as a chip on the stage's summary row.
 *
 * ## Why a chip
 *
 * The findings belong to different groups (a bay width to Size, a corner window to Doors), so they cannot
 * be a tab of the controls card and they are not a step. A chip next to Ridge / Bays / Roof / Walls keeps
 * them one press away without spending a third of the card on a list that is usually empty.
 *
 * ## Two shapes, one list
 *
 * From 768 px up the list is a popover anchored to the chip; on a phone it expands **under the chip row**
 * as a full-width row, because a popover floating over a small screen is a thing to chase. Both close on
 * Escape, on a press outside, and put focus back on the chip; a press on a finding closes the list and
 * takes the guest to that control (`focusSelector` opens the group too).
 *
 * The list shows `review` items first, then `note`; `ok` items are hidden — "Nothing to flag" is the
 * sentence that covers them.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { usePanels } from '../panels';
import { CheckItem, useAssessment } from './DesignCheck';
import { IconAlert, IconCheck, IconInfo } from './icons';

export function DesignCheckChip({ design, type }: { design: Parameters<typeof useAssessment>[0]; type: Parameters<typeof useAssessment>[1] }) {
  const items = useAssessment(design, type);
  const bp = usePanels((s) => s.bp);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  /** Placement of the popover relative to the chip, measured: it opens upwards and stays in the stage. */
  const [place, setPlace] = useState<{ left: number; maxHeight: number } | null>(null);

  const reviews = items.filter((item) => item.level === 'review');
  const notes = items.filter((item) => item.level === 'note');
  // Reviews first: an issue that changes the quote outranks a remark that explains it.
  const shown = [...reviews, ...notes];
  const phone = bp === 'phone';

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) chipRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (chipRef.current?.contains(target) === true) return;
      if (popRef.current?.contains(target) === true) return;
      close(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  /*
   * One sentence, used as both the visible label and the accessible name, so they cannot drift apart.
   * "to check" does not change with the number ("1 to check", "2 to check"); a note does ("1 note",
   * "2 notes") — which is exactly the bug this replaced, a chip reading "1 notes".
   */
  /*
   * Where the popover goes.
   *
   * The chip row sits at the **bottom** of the stage (it is the summary strip), so a popover opening
   * downwards fell outside the clipped workspace and showed as a thin white strip (review, round 5b).
   * It opens upwards instead, with two numbers measured rather than guessed:
   *
   *   maxHeight — the gap between the chip's top and the stage's top, less the 8 px anchor gap, so it
   *               scrolls inside instead of growing past the stage on a short screen (1024×600);
   *   left      — the chip's left edge clamped so the panel stays inside the stage horizontally, which
   *               matters because the card opening moves the chip row.
   *
   * Re-measured on resize: the workspace moves when the assistant column or the card opens.
   */
  useLayoutEffect(() => {
    if (!open || phone) return undefined;
    const measure = () => {
      const chip = chipRef.current?.getBoundingClientRect();
      const stage = chipRef.current?.closest('.g-design-stage')?.getBoundingClientRect();
      if (chip === undefined || stage === undefined) return;
      // The same 420 as `.g-check-pop`'s width: two numbers here would clamp against the wrong box.
      const width = Math.min(420, stage.width - 16);
      const left = Math.min(Math.max(chip.left - stage.left, 8), Math.max(8, stage.width - width - 8));
      const maxHeight = Math.max(140, Math.round(chip.top - stage.top - 8));
      setPlace({ left: Math.round(left - (chip.left - stage.left)), maxHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, phone]);

  /*
   * On a phone the list is a row inside the scrolling page, and the summary bar is fixed to the bottom:
   * opening it under the fold is the same as not opening it. `scrollIntoView` with `block: 'nearest'`
   * keeps the movement small, the CSS `scroll-margin-bottom` reserves the bar's height, and a person who
   * asked for reduced motion gets no smooth scrolling.
   */
  useEffect(() => {
    if (!open || !phone) return;
    const sheet = popRef.current;
    if (sheet === null) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /*
     * `block: 'end'`, not `'nearest'`: a row that is technically inside the viewport can still be under
     * the fixed summary bar, and `'nearest'` does not move it. Aligning the bottom is what makes the
     * row's `scroll-margin-bottom` (the bar's height) do its job.
     */
    sheet.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
  }, [open, phone]);

  const label =
    reviews.length > 0
      ? `${reviews.length} to check`
      : notes.length === 0
        ? 'Nothing to flag'
        : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;

  const Icon = reviews.length > 0 ? IconAlert : notes.length > 0 ? IconInfo : IconCheck;
  const tone = reviews.length > 0 ? 'review' : notes.length > 0 ? 'note' : 'ok';

  const list =
    shown.length === 0 ? (
      <p className="g-check-none">
        Nothing needs your attention. An estimator checks every design before quoting.
      </p>
    ) : (
      <ul className="g-check-list">
        {shown.map((item) => (
          <CheckItem key={`${item.level}:${item.title}`} item={item} onGo={() => close(false)} />
        ))}
      </ul>
    );

  return (
    <>
      <li className="g-stat g-stat-check">
        <button
          ref={chipRef}
          type="button"
          className={`g-check-chip g-check-chip-${tone}`}
          aria-label={`Design check — ${label}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            if (open) close(true);
            else setOpen(true);
          }}
        >
          <Icon />
          <span>{label}</span>
        </button>

        {open && !phone ? (
          <div
            ref={popRef}
            id={panelId}
            className="g-check-pop"
            role="dialog"
            aria-label="Design check"
            style={
              place === null
                ? undefined
                : { left: place.left, right: 'auto', maxHeight: place.maxHeight }
            }
          >
            <h3 className="g-check-pop-title">Design check</h3>
            {list}
            <p className="g-hint">Rules, not a guess. An estimator checks every design before quoting.</p>
          </div>
        ) : null}
      </li>

      {open && phone ? (
        /* A full-width row under the chips: nothing floats over a 390 px screen. */
        <li className="g-stat g-check-sheet">
          <div ref={popRef} id={panelId} className="g-check-sheet-inner" role="region" aria-label="Design check">
            {list}
            <p className="g-hint">Rules, not a guess. An estimator checks every design before quoting.</p>
          </div>
        </li>
      ) : null}
    </>
  );
}
