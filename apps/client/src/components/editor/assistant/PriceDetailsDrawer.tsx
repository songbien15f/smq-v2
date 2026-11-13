'use client';

/**
 * The full price breakdown, on demand.
 *
 * With the Assistant taking the third column the breakdown no longer sits beside the work; the strip above
 * keeps the contract price on screen and this opens everything else. It is the same `PricePanel` the
 * column used to hold, so nothing about the figures is recomputed here.
 */

import { CloseIcon } from '@sq/ui';
import type { ComponentProps } from 'react';
import { PricePanel } from '../PricePanel';
import { Drawer } from './Drawer';

export function PriceDetailsDrawer({
  open,
  onClose,
  ...panel
}: { open: boolean; onClose: () => void } & ComponentProps<typeof PricePanel>) {
  return (
    <Drawer open={open} onClose={onClose} label="Price details" modalAtLg>
      <header className="flex items-center justify-between border-b border-sq-line px-sq-3 py-sq-1">
        <h2 className="text-sq-body font-semibold text-sq-ink">Price details</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close price details"
          className="grid h-11 w-11 cursor-pointer place-items-center rounded-md text-sq-ink-muted transition-colors duration-sq-fast hover:bg-sq-ground hover:text-sq-ink"
        >
          <CloseIcon size={18} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-sq-3">
        <PricePanel {...panel} />
      </div>
    </Drawer>
  );
}
