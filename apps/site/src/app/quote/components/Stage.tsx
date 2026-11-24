'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  COLORBOND,
  configFromGuestDesign,
  ridgeHeightMm,
  withDimensions,
  type GuestBuildingTypeSpec,
  type GuestDesignInput,
} from '@sq/core/domain';
import { metresLabel, shedOf } from '../designOps';
import { closeTools, openTools, usePanels } from '../panels';
import { GuestPlan } from './GuestPlan';
import { IconList, IconWind } from './icons';

type View = '2d' | '3d';

const VIEWS: { id: View; label: string }[] = [
  { id: '2d', label: '2D plan' },
  { id: '3d', label: '3D model' },
];

/**
 * The 3D model, loaded only when a 3D tab is actually opened.
 *
 * `ssr: false` and a dynamic import because three.js is the largest dependency this page can pull:
 * a visitor who only reads the page and presses Send should not download it. `@sq/viewer3d` is the
 * same renderer the staff editor uses (plan G-f S7), so the guest sees exactly the model an
 * estimator sees.
 */
const ShedViewer = dynamic(() => import('@sq/viewer3d').then((m) => m.ShedViewer), {
  ssr: false,
  loading: () => <p className="g-stage-3d-loading">Loading the model…</p>,
});

/** True when this browser can actually create a WebGL context. */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return (
      canvas.getContext('webgl2') !== null ||
      canvas.getContext('webgl') !== null ||
      canvas.getContext('experimental-webgl') !== null
    );
  } catch {
    return false;
  }
}

/**
 * Step ②'s stage: the 2D plan or the 3D model, and a row of chips that sum the design up.
 *
 * ## 3D is the default tab when the machine supports it (plan S8)
 *
 * The camera and the plan show the same building, so the model is the honest default. A browser
 * without WebGL gets the 2D tab — which is a complete drawing, not a degraded one — plus one line
 * saying why, rather than a blank canvas.
 *
 * ## One state, two views
 *
 * `configFromGuestDesign` is memoised on the *design*, so any control on the left, or a drag on the
 * plan, rebuilds the model from the same numbers the summary and the 2D view read. The 3D view has no
 * store of its own and no way to disagree with the quote.
 *
 * ## Reduced motion
 *
 * Nothing spins. The model only moves when a person drags it, and `ShedViewer`'s `frameloop="demand"`
 * means a still picture costs no frames at all.
 */
export function Stage({ design, type }: { design: GuestDesignInput; type: GuestBuildingTypeSpec }) {
  /*
   * The first render happens on the server, where there is no canvas to probe, so the opening view is
   * the 2D plan; the effect then switches to 3D once it knows WebGL works. Starting from '3d' would
   * hydrate into a canvas that cannot exist yet.
   */
  const [view, setView] = useState<View>('2d');
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [showRoof, setShowRoof] = useState(true);
  const [resetView, setResetView] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const bp = usePanels((s) => s.bp);
  const leftOpen = usePanels((s) => s.leftOpen);

  useEffect(() => {
    const ok = webglAvailable();
    setWebgl(ok);
    if (ok) setView('3d');
  }, []);

  /** Model numbers, rebuilt only when the design changes — not on every render of this component. */
  const config = useMemo(() => withDimensions(configFromGuestDesign(design, type)), [design, type]);

  const shed = shedOf(design, type);
  const ridge = shed === null ? null : ridgeHeightMm(shed);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = VIEWS.length;
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setView(VIEWS[next]!.id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="g-stage">
      <div className="g-stage-tabs" role="tablist" aria-label="View">
        {VIEWS.map((v, i) => (
          <button
            key={v.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`g-view-${v.id}`}
            aria-selected={view === v.id}
            aria-controls={`g-view-${v.id}-panel`}
            tabIndex={view === v.id ? 0 : -1}
            className="g-stage-tab"
            onClick={() => setView(v.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {v.label}
          </button>
        ))}
        {view === '3d' && config !== null ? (
          <div className="g-stage-tools">
            <button type="button" className="g-btn g-btn-ghost" aria-pressed={showRoof} onClick={() => setShowRoof((r) => !r)}>
              {showRoof ? 'Hide roof' : 'Show roof'}
            </button>
            <button type="button" className="g-btn g-btn-ghost" onClick={() => setResetView((n) => n + 1)}>
              Reset view
            </button>
          </div>
        ) : null}

        {/*
          "Tools" only exists on a phone, where the tools are a drawer with no rail to reopen them.
          The assistant has one way in at every width: the "AI Assistant" dock, bottom-right.
        */}
        {bp === 'phone' ? (
          <button
            type="button"
            id="g-tools-btn"
            className="g-stage-btn"
            aria-label={leftOpen ? 'Hide tools panel' : 'Show tools panel'}
            aria-expanded={leftOpen}
            aria-controls="g-tools"
            onClick={() => (leftOpen ? closeTools() : openTools())}
          >
            <IconList />
            Tools
          </button>
        ) : null}
      </div>

      <div
        className="g-stage-view"
        role="tabpanel"
        id={`g-view-${view}-panel`}
        aria-labelledby={`g-view-${view}`}
        /* A drag on the model must orbit it, not scroll the page underneath. */
        style={view === '3d' ? { touchAction: 'none' } : undefined}
      >
        {view === '2d' ? (
          <GuestPlan design={design} type={type} />
        ) : config === null ? (
          <p className="g-hint">
            The model appears once the size is within the building&rsquo;s range — the 2D plan shows what is wrong.
          </p>
        ) : (
          <div className="g-stage-3d">
            <ShedViewer config={config} showRoof={showRoof} resetView={resetView} />
          </div>
        )}
      </div>

      {webgl === false ? (
        <p className="g-hint g-stage-3d-note">This browser cannot show the 3D model, so the plan is shown instead.</p>
      ) : null}

      <ul className="g-stage-chips" aria-label="Design summary">
        <li className="g-stat">
          <span className="g-stat-label">Ridge</span>
          <span className="g-stat-value">{ridge === null ? '—' : metresLabel(ridge)}</span>
        </li>
        <li className="g-stat">
          <span className="g-stat-label">Bays</span>
          <span className="g-stat-value">
            {design.building.bayWidths.length} × ({design.building.bayWidths.map((w) => metresLabel(w)).join(' + ')})
          </span>
        </li>
        <li className="g-stat">
          <span className="g-stat-swatch" style={{ backgroundColor: COLORBOND[design.colours.roof] }} aria-hidden="true" />
          <span className="g-stat-label">Roof</span>
          <span className="g-stat-value">{design.colours.roof}</span>
        </li>
        <li className="g-stat">
          <span className="g-stat-swatch" style={{ backgroundColor: COLORBOND[design.colours.walls] }} aria-hidden="true" />
          <span className="g-stat-label">Walls</span>
          <span className="g-stat-value">{design.colours.walls}</span>
        </li>
        <li className="g-stat g-stat-wind">
          <IconWind />
          <span className="g-stat-value">Wind: confirmed in your quote</span>
        </li>
      </ul>
    </div>
  );
}
