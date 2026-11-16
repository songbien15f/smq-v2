/**
 * `DataTable` — the one table every list screen draws.
 *
 * MASTER "Tables": sticky header, 36 px rows, right-aligned tabular numerics, zebra rows on
 * `--sq-ground` at 40 % rather than a border per row. Eight screens each wrote their own `<table>`,
 * and each got a different subset of that right; one component is how the rule stays true.
 *
 * ## Why the table scrolls inside its own box
 *
 * A `sticky` header sticks to its nearest scrolling ancestor. The usual `overflow-x-auto` wrapper
 * (needed so a wide table does not push the page sideways) is such an ancestor, but it never
 * scrolls vertically, so the header scrolled away with the page. Capping the wrapper's height makes
 * it the vertical scroller too, and the header then stays in view on a 200-row log.
 *
 * ## Why zebra is computed, not `even:`
 *
 * A row can carry an expansion row beneath it (a template's file history). `:nth-child(even)` would
 * count that extra row and flip the stripes below it; striping by data index keeps a row and its
 * expansion the same colour.
 *
 * Not a client component: cells are plain render functions, so a server page can use it as well.
 */

import { Fragment, type ReactNode } from 'react';

export interface DataColumn<Row> {
  /** Stable id for React and for the header cell. */
  key: string;
  header: ReactNode;
  /** Keep the header for screen readers only — an actions column whose buttons name themselves. */
  hideHeader?: boolean;
  /** A figure that is compared down the column: right-aligned, tabular, monospaced. */
  numeric?: boolean;
  render: (row: Row) => ReactNode;
  /** Extra classes for this column's cells, or per row (a saturated seat count, say). */
  cellClassName?: string | ((row: Row) => string);
}

export interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: readonly DataColumn<Row>[];
  rowKey: (row: Row) => string;
  /** What the table is, for a screen reader. Shown to nobody else. */
  caption: string;
  /** Shown instead of the table when there are no rows. Say what to do next, not "no data". */
  empty?: ReactNode;
  /**
   * `viewport` (default): the table scrolls inside a box sized to the screen, so the header sticks.
   * `none`: no height cap — for a short table nested inside another one.
   */
  height?: 'viewport' | 'none';
  /** Tighter cells, for a table nested inside a row. */
  dense?: boolean;
  /** A full-width row under a data row, or `null` for none. */
  expansion?: (row: Row) => ReactNode | null;
}

function cellClass<Row>(column: DataColumn<Row>, row: Row): string {
  const extra = typeof column.cellClassName === 'function' ? column.cellClassName(row) : column.cellClassName;
  return extra ?? '';
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  caption,
  empty,
  height = 'viewport',
  dense = false,
  expansion,
}: DataTableProps<Row>) {
  if (rows.length === 0 && empty !== undefined) {
    return <div className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">{empty}</div>;
  }

  const pad = dense ? 'px-sq-2 py-1' : 'px-sq-3 py-1.5';
  const headPad = dense ? 'px-sq-2 py-1' : 'px-sq-3 py-sq-2';

  return (
    // `relative` so the box is the containing block of `sr-only` (absolutely positioned) text in a
    // cell; otherwise that text escapes the scroll clip and widens the page on a phone.
    <div className={`relative ${height === 'viewport' ? 'max-h-[calc(100dvh-14rem)] overflow-auto' : 'overflow-x-auto'}`}>
      <table className="w-full border-collapse text-sq-body">
        <caption className="sr-only">{caption}</caption>
        <thead
          className={
            height === 'viewport'
              ? 'sticky top-0 z-10 bg-sq-surface shadow-[inset_0_-1px_0_var(--color-sq-line)]'
              : 'shadow-[inset_0_-1px_0_var(--color-sq-line)]'
          }
        >
          <tr className="text-sq-micro text-sq-ink-muted">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`${headPad} whitespace-nowrap font-medium ${column.numeric === true ? 'text-right' : 'text-left'}`}
              >
                {column.hideHeader === true ? <span className="sr-only">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const stripe = index % 2 === 1 ? 'bg-sq-ground/40' : '';
            const extra = expansion?.(row) ?? null;
            return (
              <Fragment key={rowKey(row)}>
                <tr className={`${dense ? '' : 'h-9'} ${stripe} hover:bg-sq-brand/5`}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`${pad} align-middle ${column.numeric === true ? 'sq-numeric text-right' : ''} ${cellClass(column, row)}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
                {extra !== null && (
                  <tr className={stripe}>
                    <td colSpan={columns.length} className={pad}>
                      {extra}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
