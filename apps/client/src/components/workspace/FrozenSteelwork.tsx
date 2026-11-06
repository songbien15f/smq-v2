import type { FrameMemberView, PunchPageView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { SteelworkPanel } from '@/components/editor/SteelworkPanel';
import { PunchingPanel } from '@/components/editor/PunchingPanel';

/**
 * The workshop sheets of a **saved** revision: the steelwork schedule and the punching detail.
 *
 * ## Why this reads routes and not the editor's evaluation
 *
 * The editor's two panels show the *draft* — what the building would cost if it were saved now. A
 * revision is what the workshop will actually cut from, and it was frozen against the price book of
 * the day. Recomputing here would show a section the customer was never quoted the moment the book
 * moved, which is the one thing a frozen revision exists to prevent. So the two routes read
 * `members_json` and `punchings_json` off the revision row, and this component only renders them.
 *
 * ## Why a refusal is not an error box
 *
 * Both documents are behind `cost:read`: the section sizes and hole positions are the factory's
 * design, and a viewer reads a quote, not how it is framed. A viewer reaching this page is the
 * normal case, not a fault, so `forbidden` renders nothing at all rather than a red panel that
 * looks like something broke.
 */
export async function FrozenSteelwork({
  quoteId,
  revision,
}: {
  quoteId: string;
  /** The revision **number**, because that is what both routes address. */
  revision: number;
}) {
  const [members, punchings] = await Promise.all([
    serverFetch<{ members: FrameMemberView[] }>(`/quotes/${quoteId}/revisions/${revision}/members`),
    serverFetch<{ pages: PunchPageView[] }>(`/quotes/${quoteId}/revisions/${revision}/punchings`),
  ]);

  if (!members.ok && !punchings.ok) {
    if (members.code === 'forbidden') return null;
    return (
      <Panel title="Workshop sheets" description="Cut list and punching detail for this revision.">
        <p className="text-sq-body text-sq-danger">{members.message}</p>
      </Panel>
    );
  }

  return (
    <>
      {members.ok && <SteelworkPanel members={members.data.members} />}
      {punchings.ok && <PunchingPanel pages={punchings.data.pages} />}
    </>
  );
}
