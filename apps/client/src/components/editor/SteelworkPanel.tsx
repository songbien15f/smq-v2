'use client';

/**
 * The steelwork schedule: what the workshop cuts.
 *
 * The desktop prints this as "Steelwork Schedule / Member Size" — one row per frame member with the
 * section the design chose, the cut length and how many the building has. It is the sheet that
 * turns a priced quote into an order, so it sits in Step 3 beside the cost: by then the building is
 * settled and the numbers are what the shop will work from.
 *
 * ## Why the section is the interesting column
 *
 * A quote that prices every member as one 100 × 100 SHS is a quote for a different shed. The
 * section here comes from the price book's own structure table for this span, and when the book has
 * no such table the row says so — `assumed` — rather than presenting a default as a design.
 *
 * ## Not a punch list
 *
 * Hole positions belong to the factory's punching detail, which this build does not model. Showing
 * a length and a count is what a steel order needs; inventing hole offsets would put a number on a
 * drawing that nobody calculated.
 */

import type { FrameMemberView } from '@sq/contracts';
import { Panel } from '@sq/ui';

export interface SteelworkPanelProps {
  members: FrameMemberView[];
}

/** Metres, to one decimal, from millimetres. */
function metres(mm: number): string {
  return (mm / 1000).toFixed(2);
}

export function SteelworkPanel({ members }: SteelworkPanelProps) {
  if (members.length === 0) {
    return (
      <Panel title="Steelwork schedule" description="The frame members the workshop cuts.">
        <p className="text-sq-body text-sq-ink-muted">
          Calculate the price to see the schedule. It needs the price book&rsquo;s structure table.
        </p>
      </Panel>
    );
  }

  const anyAssumed = members.some((member) => member.assumed);

  return (
    <Panel
      title="Steelwork schedule"
      description="Sections from the price book’s structure table for this span, with the cut length and count."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sq-body">
          <thead>
            <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wide text-sq-ink-muted">
              <th scope="col" className="py-sq-1 pr-sq-2 font-medium">
                Member
              </th>
              <th scope="col" className="py-sq-1 pr-sq-2 font-medium">
                Section
              </th>
              <th scope="col" className="py-sq-1 pr-sq-2 text-right font-medium">
                Length
              </th>
              <th scope="col" className="py-sq-1 text-right font-medium">
                Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.item} className="border-b border-sq-line/60 last:border-0">
                <td className="py-sq-1 pr-sq-2 text-sq-ink">{member.label}</td>
                <td className="py-sq-1 pr-sq-2 font-mono text-sq-micro text-sq-ink">
                  {member.section}
                  {member.assumed && (
                    <span className="ml-sq-1 text-sq-ink-muted" title="No structure table in this price book">
                      (assumed)
                    </span>
                  )}
                </td>
                <td className="py-sq-1 pr-sq-2 text-right tabular-nums text-sq-ink">
                  {metres(member.lengthMm)} m
                </td>
                <td className="py-sq-1 text-right tabular-nums text-sq-ink">{member.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {anyAssumed && (
        <p className="mt-sq-2 text-sq-micro text-sq-ink-muted">
          This price book carries no structure-to-section table, so every member is shown in one
          section. The quote says the same in its assumptions.
        </p>
      )}
    </Panel>
  );
}
