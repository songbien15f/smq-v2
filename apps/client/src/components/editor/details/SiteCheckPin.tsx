'use client';

/**
 * The desktop's PIN button beside the site address, and the one-line status under it.
 *
 * PIN **opens the Building parameters popover**; it does not pin. That is the desktop's order
 * (`QuoteDetailsView.Events.cs:2157` opens `UcShowBuildingParameterss`) — the button beside the address
 * is the way in, and GO TO SHEDSAFE inside the popover is the action.
 *
 * Two exports rather than one because the button rides in the address `Field`'s `suffix` slot, which
 * keeps it level with the input even when the field shows an error underneath; the status line sits
 * under the whole field.
 */

import { ExternalLinkIcon, PinIcon } from '@sq/ui';
import { useSiteCheckActions } from '../siteCheckActions';
import type { StatusTone } from '../siteCheckGates';

const DOT: Record<StatusTone, string> = {
  neutral: 'bg-sq-ink-muted/60',
  attention: 'bg-sq-attention',
  ok: 'bg-sq-ok',
  danger: 'bg-sq-danger',
};

const TEXT: Record<StatusTone, string> = {
  neutral: 'text-sq-ink-muted',
  attention: 'text-sq-attention',
  ok: 'text-sq-ok',
  danger: 'text-sq-danger',
};

/** `📍 PIN`. Disabled only by the quote's own fields; the account gate lives on GO, where it is explained. */
export function SiteCheckPin() {
  const { missingForPin, popoverOpen, openPopover, closePopover, pinButtonRef } = useSiteCheckActions();
  const blocked = missingForPin.length > 0;

  return (
    <button
      ref={pinButtonRef}
      id="sitecheck-pin"
      type="button"
      disabled={blocked}
      title={blocked ? `Needs: ${missingForPin.join(', ')}` : 'Building parameters for ShedSafe'}
      aria-expanded={popoverOpen}
      aria-controls="sitecheck-popover"
      onClick={() => (popoverOpen ? closePopover() : openPopover())}
      className={[
        'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-sq-2',
        'text-sq-body font-medium transition-colors duration-sq-fast',
        'disabled:cursor-not-allowed disabled:opacity-55',
        popoverOpen
          ? 'border-sq-brand bg-sq-brand/10 text-sq-brand'
          : 'border-sq-line bg-sq-surface text-sq-ink hover:bg-sq-ground',
      ].join(' ')}
    >
      <PinIcon />
      PIN
    </button>
  );
}

/** Where the site check stands, in one line. Pressing it opens the popover, where the details are. */
export function SiteCheckStatusLine() {
  const { status, check, openPopover } = useSiteCheckActions();
  const link = check?.siteLink ?? null;

  return (
    <div className="flex flex-wrap items-center gap-x-sq-2 gap-y-1">
      <button
        id="sitecheck-status"
        type="button"
        onClick={openPopover}
        className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md px-1 text-sq-micro font-medium hover:bg-sq-ground ${TEXT[status.tone]}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status.tone]}`} aria-hidden="true" />
        <span>ShedSafe: {status.label}</span>
      </button>
      {link !== null && link !== '' && (
        <a
          href={link}
          target="_blank"
          rel="noopener"
          className="text-sq-micro font-medium text-sq-brand underline underline-offset-2"
        >
          Open ShedSafe <ExternalLinkIcon size={12} className="inline align-[-1px]" />
        </a>
      )}
    </div>
  );
}
