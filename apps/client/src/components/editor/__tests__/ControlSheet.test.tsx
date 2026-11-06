import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ControlSheet } from '../ControlSheet';
import { useShedStore } from '@/store/useShedStore';
import { DEFAULT_SHED } from '@sq/core/domain';

/**
 * The mobile object editor.
 *
 * ## The defect these tests exist for
 *
 * Below 1024 px the plan could place and drag a door but **not edit it**: `SelectionPopover` renders
 * only when `isDesktop`, and the bottom sheet it was supposed to hand over to did not exist. The
 * wrench button still appeared, so tapping it set `editorOpen` and nothing happened — the worst kind
 * of broken control, one that acknowledges the tap.
 *
 * ## Why the store is reset rather than mocked
 *
 * The behaviour under test is partly the store's: closing the sheet clears the selection (the mobile
 * "out focus"), and a drag collapses the sheet without closing the editor. Mocking the store would
 * test the mock. So each test installs a real config and asserts on the real store.
 */

/**
 * Wait for the deferred focus restore.
 *
 * The sheet restores focus one task after it closes — `setTimeout(0)`, not `requestAnimationFrame`,
 * because a frame callback does not run while the document lacks OS focus, which is exactly the case
 * the browser check hit. jsdom's timers are real, so this waits for the actual restore rather than
 * sleeping for a guess.
 */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** jsdom has no `matchMedia`, so `useMediaQuery` reports false — which is the mobile layout. */
function setDesktop(isDesktop: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: isDesktop && query === '(min-width: 1024px)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** A shed with one roller door, selected with its editor open. */
function selectDoor(editorOpen = true): string {
  const store = useShedStore.getState();
  store.applyConfig({
    ...DEFAULT_SHED,
    structureType: 'gable',
    span: 9000,
    length: 18000,
    height: 3000,
    bays: 3,
    openings: [{ id: 'door-1', type: 'roller_door', wall: 'front', u: 3000, width: 3000, height: 2400 }],
  });
  useShedStore.getState().select({ kind: 'opening', id: 'door-1' });
  useShedStore.getState().setEditorOpen(editorOpen);
  return 'door-1';
}

beforeEach(() => {
  cleanup();
  useShedStore.setState({
    config: DEFAULT_SHED,
    selection: { kind: 'none' },
    editorOpen: false,
    sheetOpen: false,
    objectDragging: false,
    notices: [],
    history: [],
    future: [],
  });
  setDesktop(false);
});

describe('ControlSheet', () => {
  it('opens on a phone when the wrench is tapped', () => {
    selectDoor(true);
    render(<ControlSheet />);

    const sheet = screen.getByRole('dialog');
    expect(sheet).toBeDefined();
    // It names what is being edited, so a person knows which door they opened.
    expect(sheet.getAttribute('aria-label')).toMatch(/roller|door/i);
    expect(sheet.getAttribute('aria-modal')).toBe('true');
  });

  it('stays out of the way on a desktop, where the floating card is used', () => {
    setDesktop(true);
    selectDoor(true);
    render(<ControlSheet />);

    // Two editors for one object would both write the same store field.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open merely because something is selected', () => {
    // Selecting raises the wrench only; the editor opens on demand so the plan is not covered
    // the moment a door is tapped.
    selectDoor(false);
    render(<ControlSheet />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('edits the door through the same controls the desktop card uses', () => {
    selectDoor(true);
    render(<ControlSheet />);

    /*
     * The width field shows the **display unit**, which is metres by default (`DEFAULT_SHED`), and
     * stores millimetres. So "3.6" is 3600 mm — a first version of this test typed "3600" and got
     * 3 600 000 mm, which is the control working correctly and the test being wrong.
     */
    const width = screen.getByLabelText(/width/i) as HTMLInputElement;
    fireEvent.change(width, { target: { value: '3.6' } });

    const door = useShedStore.getState().config.openings.find((o) => o.id === 'door-1');
    expect(door?.width).toBe(3600);
  });

  it('closes on the Close control and keeps the object selected', () => {
    selectDoor(true);
    render(<ControlSheet />);

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));

    /*
     * The editor closes; the **selection stays**, exactly as closing the desktop card does. A first
     * version cleared it too, which made one gesture mean two things on two screens — and left focus
     * nowhere to return to, because the wrench it came from had vanished with the selection.
     */
    expect(useShedStore.getState().sheetOpen).toBe(false);
    expect(useShedStore.getState().editorOpen).toBe(false);
    expect(useShedStore.getState().selection.kind).toBe('opening');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the backdrop is tapped, which is the gesture a thumb expects', () => {
    selectDoor(true);
    render(<ControlSheet />);

    const backdrop = screen.getByTestId('control-sheet-backdrop');
    fireEvent.click(backdrop);
    expect(useShedStore.getState().editorOpen).toBe(false);
    expect(useShedStore.getState().selection.kind).toBe('opening');
  });

  it('closes on Escape', () => {
    selectDoor(true);
    render(<ControlSheet />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShedStore.getState().editorOpen).toBe(false);
  });

  it('collapses while an object is being dragged, without ending the edit', () => {
    /*
     * On a phone the sheet covers most of the screen. Dragging a door underneath it must be
     * possible, and the edit must survive — so a drag hides the sheet and nothing else.
     */
    selectDoor(true);
    const { rerender } = render(<ControlSheet />);
    expect(screen.queryByRole('dialog')).not.toBeNull();

    useShedStore.getState().setObjectDragging(true);
    rerender(<ControlSheet />);

    expect(screen.queryByRole('dialog')).toBeNull();
    // Still editing: the editor flag and the selection are untouched.
    expect(useShedStore.getState().editorOpen).toBe(true);
    expect(useShedStore.getState().selection.kind).toBe('opening');
  });

  it('gives every control a touch-sized target', () => {
    /*
     * The web target is 24 CSS px (WCAG 2.5.8) and this product's rule for a phone is 44 px, which
     * is what the wrench and the plan's buttons already use. A 20 px Close button is the detail that
     * makes a mobile editor feel broken.
     */
    selectDoor(true);
    render(<ControlSheet />);

    const close = screen.getByRole('button', { name: /^close$/i });
    expect(close.className).toMatch(/min-h-11|min-h-\[44px\]/);
    expect(close.className).toMatch(/min-w-11|min-w-\[44px\]/);
  });

  it('moves focus into the sheet when it opens', () => {
    // A dialog that opens without moving focus leaves a keyboard or switch user pressing into the
    // page behind it.
    selectDoor(true);
    render(<ControlSheet />);

    const sheet = screen.getByRole('dialog');
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to the wrench when it closes, never to <body>', async () => {
    /*
     * `EDIT_TRIGGER` is found by **name**, not remembered as an element — and that distinction is
     * the bug. The wrench is rendered only while the editor is *closed*, so React removes it in the
     * same commit that opens the sheet. Removing the focused element moves focus to `<body>` before
     * the sheet's effect runs, so a remembered `document.activeElement` would remember `<body>`.
     * Measured in a browser; a test holding its own button cannot show it.
     *
     * The restore is also deferred to a `setTimeout` rather than a frame callback, because a frame
     * callback does not run while the document lacks OS focus — also measured, also not visible here.
     */
    const wrench = document.createElement('button');
    wrench.setAttribute('aria-label', 'Edit selected object');
    document.body.appendChild(wrench);
    wrench.focus();

    selectDoor(true);
    const { unmount } = render(<ControlSheet />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    // React replaces the control: the old node is gone, and a new one with the same name is what
    // the operator sees once the sheet closes.
    wrench.remove();
    const replacement = document.createElement('button');
    replacement.setAttribute('aria-label', 'Edit selected object');
    document.body.appendChild(replacement);

    unmount();
    await nextTask();
    expect(document.activeElement).toBe(replacement);
    replacement.remove();
  });
});
