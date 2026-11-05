'use client';

/**
 * The punching detail: what the punch is set to before a member is welded.
 *
 * The desktop prints this as "Punching Detail" — for each frame member, where the knee, haunch and
 * apex holes sit, the hole size, and the centre to set the tool to. It is the last sheet between a
 * priced quote and a workshop, so it lives in Step 3 with the steelwork schedule: by then the
 * building is settled.
 *
 * ## Why the offsets are read, not computed
 *
 * Every number here comes from the price book's connector tables — `kneeedge`, `cost_apex`,
 * `cost_haunch` — keyed by the section's web. There is no formula to apply: the plate that bolts a
 * 20 mm web rafter to its apex is `AP20-10`, and its hole spacings are whatever the factory
 * publishes. Inventing an offset would put a hole where no plate has one.
 *
 * ## Why there may be nothing to show
 *
 * A book without those tables cannot say where a hole goes. An empty panel is a sheet that is not
 * printed; it is not a sheet with guessed positions. The panel says which it is.
 */

import type { PunchColumnView, PunchPageView } from '@sq/contracts';
import { Panel } from '@sq/ui';

export interface PunchingPanelProps {
  pages: PunchPageView[];
}

/** One member's column as a small table: two hole groups and the run between them. */
function PunchColumn({ column }: { column: PunchColumnView }) {
  return (
    <div className="flex flex-col gap-sq-1">
      <div className="flex flex-wrap items-baseline gap-sq-2">
        <span className="text-sq-body font-medium text-sq-ink">{column.mark}</span>
        <span className="font-mono text-sq-micro text-sq-ink-muted">{column.section}</span>
        <span className="sq-numeric text-sq-micro text-sq-ink-muted">× {column.quantity}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-sq-2 text-sq-micro text-sq-ink-muted">
        <dt>Cut length</dt>
        <dd className="sq-numeric text-right text-sq-ink">{(column.lengthMm / 1000).toFixed(2)} m</dd>
        <dt>Hole size</dt>
        <dd className="sq-numeric text-right text-sq-ink">{column.holeSize}</dd>
        <dt>Punch centre</dt>
        <dd className="sq-numeric text-right text-sq-ink">{column.centreMm} mm</dd>
        <dt>Free run</dt>
        <dd className="sq-numeric text-right text-sq-ink">{column.remainingMm} mm</dd>
      </dl>

      <table className="w-full border-collapse text-sq-micro">
        <caption className="sr-only">
          {column.mark} holes: {column.titleTop} measured from the far end, {column.titleBottom} from
          the near end.
        </caption>
        <thead>
          <tr className="text-left text-sq-ink-muted">
            <th scope="col" className="py-0.5 pr-sq-2 font-medium">
              From
            </th>
            <th scope="col" className="py-0.5 pr-sq-2 text-right font-medium">
              At
            </th>
            <th scope="col" className="py-0.5 text-right font-medium">
              Spacing
            </th>
          </tr>
        </thead>
        <tbody>
          {column.top.map((hole, index) => (
            <tr key={`top-${index}`}>
              <td className="py-0.5 pr-sq-2 text-sq-ink-muted">{column.titleTop}</td>
              <td className="sq-numeric py-0.5 pr-sq-2 text-right text-sq-ink">
                {hole.positionMm}
              </td>
              <td className="sq-numeric py-0.5 text-right text-sq-ink-muted">{hole.spacingMm}</td>
            </tr>
          ))}
          {column.bottom.map((hole, index) => (
            <tr key={`bottom-${index}`}>
              <td className="py-0.5 pr-sq-2 text-sq-ink-muted">{column.titleBottom}</td>
              <td className="sq-numeric py-0.5 pr-sq-2 text-right text-sq-ink">
                {hole.positionMm}
              </td>
              <td className="sq-numeric py-0.5 text-right text-sq-ink-muted">{hole.spacingMm}</td>
            </tr>
          ))}
          {column.top.length === 0 && column.bottom.length === 0 && (
            <tr>
              <td colSpan={3} className="py-sq-1 text-sq-ink-muted">
                No holes in this member.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PunchingPanel({ pages }: PunchingPanelProps) {
  if (pages.length === 0) {
    return (
      <Panel title="Punching detail" description="Hole positions for each frame member.">
        <p className="text-sq-body text-sq-ink-muted">
          No punch sheet can be drawn for this building: a connector plate could not be named for
          its sections. That happens when the price book has no structure row for this span and bay,
          so the frame is priced from an assumed section that no plate in the book fits.
        </p>
        <p className="mt-sq-1 text-sq-micro text-sq-ink-muted">
          A sheet showing only the holes it could find would read as complete and be bolted with
          the haunch holes missing — so it is withheld instead.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Punching detail"
      description="Hole positions from the price book’s connector rows, in millimetres from each end of the member."
    >
      <div className="flex flex-col gap-sq-4">
        {pages.map((page, index) => (
          <div
            key={index}
            className="grid gap-sq-3 border-b border-sq-line pb-sq-3 last:border-0 last:pb-0 sm:grid-cols-2"
          >
            {page.left !== null ? (
              <PunchColumn column={page.left} />
            ) : (
              <p className="text-sq-micro text-sq-ink-muted">No member on this side.</p>
            )}
            {page.right !== null ? (
              <PunchColumn column={page.right} />
            ) : (
              <p className="text-sq-micro text-sq-ink-muted">No member on this side.</p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
