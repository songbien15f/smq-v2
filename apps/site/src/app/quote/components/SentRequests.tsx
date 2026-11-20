'use client';

import type { GuestBuildingTypeSpec } from '@sq/core/domain';
import { clearSent, forgetSent, useSentRequests, type SentRequest } from '../sentHistory';
import { reopenSent } from '../store';

const metres = (mm: number) => `${(mm / 1000).toLocaleString('en-AU', { maximumFractionDigits: 2 })} m`;

function sizeOf(request: SentRequest): string {
  const b = request.design.building;
  const length = b.bayWidths.reduce((sum, w) => sum + w, 0);
  return `${metres(b.span)} × ${metres(length)} × ${metres(b.height)} high`;
}

function dateOf(request: SentRequest): string {
  return new Date(request.sentAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * "Your recent requests" at the top of ①: the last five this browser sent (`sentHistory.ts`).
 * Open puts that design back as a revision of its number; a type the vendor has since switched off
 * cannot be opened, and the row says so. Hidden when there is nothing to show.
 */
export function SentRequests({ types }: { types: readonly GuestBuildingTypeSpec[] | null }) {
  const requests = useSentRequests();
  if (requests.length === 0) return null;

  return (
    <section className="g-card g-recent" aria-labelledby="g-recent-title">
      <div className="g-recent-head">
        <h3 id="g-recent-title" className="g-card-title">
          Your recent requests
        </h3>
        <button type="button" className="g-link-btn" onClick={clearSent}>
          Clear list
        </button>
      </div>
      <p className="g-hint">Saved on this device only. Open one to change it and send a revised design.</p>
      <ul className="g-recent-list">
        {requests.map((request) => {
          const type = types?.find((t) => t.id === request.design.typeId);
          const site = request.design.site;
          return (
            <li key={request.number} className="g-recent-row">
              <div className="g-recent-text">
                <span className="g-recent-number">{request.number}</span>
                <span>
                  {request.typeName || type?.name || 'Building'} · {sizeOf(request)}
                </span>
                <span className="g-recent-meta">
                  {site === undefined ? '' : `${site.suburb} ${site.state} · `}Sent {dateOf(request)}
                </span>
              </div>
              <div className="g-recent-actions">
                {type === undefined ? (
                  <span className="g-recent-meta">{types === null ? '' : 'No longer available'}</span>
                ) : (
                  <button
                    type="button"
                    className="g-link-btn"
                    onClick={() => reopenSent(request.number, request.design, type)}
                  >
                    Open<span className="g-sr-only"> request {request.number}</span>
                  </button>
                )}
                <button type="button" className="g-link-btn" onClick={() => forgetSent(request.number)}>
                  Remove<span className="g-sr-only"> request {request.number}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
