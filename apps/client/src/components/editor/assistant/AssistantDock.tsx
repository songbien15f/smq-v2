'use client';

/**
 * Where the Assistant lives at each width. `QuoteEditor` owns the booleans; this decides what to draw.
 *
 * - **`xl` (≥1280):** a column beside the plan (`AssistantColumn`), open by default, collapsible to a 48 px
 *   rail. The column is a grid child, so its width is decided in `editorLayout`.
 * - **`lg` (1024–1279):** a non-modal 380 px drawer from the right, opened by the "Assistant" button in the
 *   price strip or `Ctrl+/`.
 * - **below `lg`:** a 56 px button bottom-right and an 85 dvh sheet.
 *
 * The drawer and the column never show together: the drawer is `xl:hidden`, the column `hidden xl:block`.
 */

import { useRef } from 'react';
import { ChevronIcon, SparkleIcon } from '@sq/ui';
import { AssistantPanel } from './AssistantPanel';
import { Drawer } from './Drawer';
import type { EditorStep } from '../StepRail';

export function AssistantColumn({ step, collapsed, onToggle }: { step: EditorStep; collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="hidden min-w-0 xl:block">
      {/* Same offsets as the plan box: the strip is 61 px and sticky above this at every width. */}
      <div className="sticky top-[4.5rem] mb-sq-3 h-[calc(100dvh-5.5rem)] overflow-hidden rounded-lg border border-sq-line bg-sq-surface">
        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Open assistant"
            aria-expanded="false"
            className="flex h-full w-full cursor-pointer flex-col items-center gap-sq-2 pt-sq-3 text-sq-ink-muted transition-colors duration-sq-fast hover:bg-sq-ground hover:text-sq-ink"
          >
            <ChevronIcon direction="left" size={18} />
            <SparkleIcon size={20} className="text-sq-gold-deep" />
          </button>
        ) : (
          <AssistantPanel step={step} onCollapse={onToggle} />
        )}
      </div>
    </div>
  );
}

export function AssistantOverlay({
  step,
  open,
  onOpen,
  onClose,
}: {
  step: EditorStep;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const fabRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      {!open && (
        <button
          ref={fabRef}
          type="button"
          onClick={onOpen}
          aria-label="Open assistant"
          aria-keyshortcuts="Control+/"
          className="fixed bottom-24 right-sq-3 z-30 grid h-14 w-14 cursor-pointer place-items-center rounded-full bg-sq-brand text-white shadow-lg transition-colors duration-sq-fast hover:bg-sq-brand-hover lg:hidden"
        >
          <SparkleIcon size={24} />
        </button>
      )}
      <Drawer open={open} onClose={onClose} label="Assistant" modalAtLg={false} hideFrom="xl" fallbackFocus={fabRef}>
        <AssistantPanel step={step} onClose={onClose} headingId="assistant-drawer-heading" />
      </Drawer>
    </>
  );
}
