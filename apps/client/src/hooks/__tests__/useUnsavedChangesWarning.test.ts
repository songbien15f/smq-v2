import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useUnsavedChangesWarning,
  UNSAVED_MESSAGE,
  ALLOW_NAVIGATION,
} from '../useUnsavedChangesWarning';

/**
 * The unsaved-changes guard.
 *
 * ## The bug this covers
 *
 * The editor is one page with the quote list one click away. `beforeunload` alone does not fire for
 * a client-side navigation, so typing a customer's name and then clicking "Quotes" lost it with no
 * warning — the one case the browser cannot protect on its own.
 */

/** Dispatch a real click on a temporary anchor and report whether navigation was cancelled. */
function clickLink(
  href: string,
  options: { attributes?: Record<string, string>; modifiers?: MouseEventInit } = {},
): boolean {
  const anchor = document.createElement('a');
  anchor.href = href;
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    anchor.setAttribute(name, value);
  }
  // `href` set through the property resolves against the current origin, like a real link.
  document.body.appendChild(anchor);

  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ...options.modifiers,
  });
  const notCancelled = anchor.dispatchEvent(event);
  // A cancelled event is the guard saying "you are not going".
  const navigates = notCancelled && !event.defaultPrevented;
  anchor.remove();
  return navigates;
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('useUnsavedChangesWarning', () => {
  it('says nothing about navigation while the draft is clean', () => {
    renderHook(() => useUnsavedChangesWarning(false));

    expect(clickLink('/settings')).toBe(true);
    // No dialog was raised, so nothing was asked.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('asks before an in-app link takes unsaved work away', () => {
    renderHook(() => useUnsavedChangesWarning(true));

    // The operator says "stay".
    confirmSpy.mockReturnValue(false);

    expect(clickLink('/settings')).toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_MESSAGE);
  });

  it('lets the navigation through when the operator agrees to lose it', () => {
    renderHook(() => useUnsavedChangesWarning(true));
    confirmSpy.mockReturnValue(true);

    expect(clickLink('/settings')).toBe(true);
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('ignores a link in another tab, which does not leave the page', () => {
    renderHook(() => useUnsavedChangesWarning(true));
    confirmSpy.mockReturnValue(false);

    // ctrl-click: the current page stays exactly where it is.
    expect(clickLink('/settings', { modifiers: { ctrlKey: true } })).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('ignores links that do not navigate away', () => {
    renderHook(() => useUnsavedChangesWarning(true));
    confirmSpy.mockReturnValue(false);

    expect(clickLink('#plan')).toBe(true);
    expect(clickLink('mailto:someone@example.com')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('ignores a download, which leaves the page in place', () => {
    renderHook(() => useUnsavedChangesWarning(true));
    confirmSpy.mockReturnValue(false);

    expect(clickLink('/api/sq/quotes/x/bom', { attributes: { download: '' } })).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('ignores an external link, where the browser’s own guard applies', () => {
    renderHook(() => useUnsavedChangesWarning(true));
    confirmSpy.mockReturnValue(false);

    expect(clickLink('https://example.com/')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('lets a link opt out explicitly', () => {
    /*
     * A screen may need one link that really does leave — signing out, for instance. An attribute
     * rather than a hardcoded path keeps the hook from knowing about routes.
     */
    renderHook(() => useUnsavedChangesWarning(true));
    confirmSpy.mockReturnValue(false);

    expect(clickLink('/sign-out', { attributes: { [ALLOW_NAVIGATION]: '' } })).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('arms the browser’s own dialog while dirty, and drops it when clean', () => {
    const { rerender, unmount } = renderHook(
      ({ dirty }: { dirty: boolean }) => useUnsavedChangesWarning(dirty),
      { initialProps: { dirty: true } },
    );

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    // `preventDefault` is what makes the browser ask.
    expect(dirtyEvent.defaultPrevented).toBe(true);

    rerender({ dirty: false });
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    unmount();
  });
});
