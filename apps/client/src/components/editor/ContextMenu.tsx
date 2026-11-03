'use client';

/**
 * The 2D plan context menu (spec §5.4).
 *
 * A small positioned list of actions opened at the pointer by a right-click on
 * desktop or a long press on touch. It renders only — what each row *does* is
 * the parent's business, because the actions need the plan point and the store.
 * The parent supplies the rows, their enabled state, and an `onPick` callback;
 * this component reports a pick by id and closes itself.
 *
 * Rows are touch-sized (40 px minimum) and a disabled row is announced with
 * `aria-disabled` and does nothing when clicked. A row may carry a `submenu`,
 * in which case picking it swaps the visible rows for that submenu (with a
 * "Back" row to return) instead of closing the menu — this is how "Add door"
 * offers the four opening types before anything is added.
 */

import { useEffect, useRef, useState } from 'react';

/** One row of the menu. */
export interface ContextMenuItem {
  id: string;
  label: string;
  /** A disabled row is shown but cannot be picked. */
  enabled: boolean;
  /**
   * When present, picking this row replaces the visible rows with these instead
   * of closing the menu — used to choose a door type before adding it. One level
   * deep is enough for the plan's menu (spec §5.4).
   */
  submenu?: ContextMenuItem[];
}

/** The reserved id of the row that returns from a submenu to the parent list. */
const BACK_ID = '__back__';

/** The row shown at the top of a submenu, to return to the parent list. */
const BACK_ITEM: ContextMenuItem = { id: BACK_ID, label: 'Back', enabled: true };

export interface ContextMenuProps {
  items: ContextMenuItem[];
  /** Called with the picked item's id, before `onClose`. */
  onPick: (id: string) => void;
  onClose: () => void;
  /** Screen-pixel position for the menu; omitted, it uses its CSS default. */
  position?: { x: number; y: number };
}

export function ContextMenu({ items, onPick, onClose, position }: ContextMenuProps) {
  const menuRef = useRef<HTMLUListElement | null>(null);
  // The parent row whose submenu is open, or `null` for the top-level list.
  const [submenuId, setSubmenuId] = useState<string | null>(null);

  // Escape closes, and a pointer press outside the menu closes. The outside
  // check compares against the menu's own element, so pressing a row (which
  // happens inside) does not close the menu before the row's click fires.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu !== null && event.target instanceof Node && menu.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  // The rows actually shown: a submenu's rows (with a Back row on top) once one
  // is open, otherwise the top-level items. A row's own `submenu` is not shown
  // until it is picked.
  const parent = submenuId === null ? null : (items.find((item) => item.id === submenuId) ?? null);
  const rows: ContextMenuItem[] =
    parent?.submenu !== undefined ? [BACK_ITEM, ...parent.submenu] : items;

  const pick = (item: ContextMenuItem) => {
    if (!item.enabled) return;
    if (item.id === BACK_ID) {
      setSubmenuId(null);
      return;
    }
    if (item.submenu !== undefined && item.submenu.length > 0) {
      setSubmenuId(item.id);
      return;
    }
    onPick(item.id);
    onClose();
  };

  const style =
    position === undefined ? undefined : { left: position.x, top: position.y };

  return (
    <ul
      ref={menuRef}
      role="menu"
      style={style}
      className="absolute z-20 min-w-[180px] rounded-md border border-slate-300 bg-white py-1 shadow-lg"
    >
      {rows.map((item) => {
        const opensSubmenu = item.submenu !== undefined && item.submenu.length > 0;
        return (
          <li
            key={item.id}
            role="menuitem"
            aria-disabled={item.enabled ? undefined : true}
            aria-haspopup={opensSubmenu ? 'menu' : undefined}
            className={
              item.enabled
                ? 'flex min-h-10 cursor-pointer items-center justify-between gap-4 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100'
                : 'flex min-h-10 cursor-not-allowed items-center justify-between gap-4 px-3 py-2 text-sm text-slate-400'
            }
            onClick={() => pick(item)}
          >
            <span>{item.label}</span>
            {opensSubmenu && <span aria-hidden="true">›</span>}
          </li>
        );
      })}
    </ul>
  );
}
