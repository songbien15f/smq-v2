'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  buildPlanGeometry,
  planPointToWallU,
  type GuestBuildingTypeSpec,
  type GuestDesignInput,
  type PlanGeometry,
  type WallSide,
  wallLength,
} from '@sq/core/domain';
import {
  OPENING_SHORT,
  WALLS,
  WALL_NAMES,
  addOpening,
  countOf,
  metresLabel,
  moveOpening,
  positionOf,
  positionOpening,
  removeOpening,
  ruleFor,
  setMotorised,
  setOpeningSize,
  setOpeningWall,
  shedOf,
  sizeLabel,
  snap,
  SNAP_MM,
  type Fit,
  type Position,
} from '../designOps';
import { updateDesign } from '../store';
import { ChipRadios } from './ControlAccordion';
import { IconFit, IconPlus, IconTrash, IconZoomIn, IconZoomOut } from './icons';

/**
 * Tab ③'s 2D plan (plan G-a S6, spec ③ "Mặt bằng 2D"): core's `buildPlanGeometry` drawn as SVG.
 *
 * - Plan millimetres are the SVG's user units (front wall at the top, y down), so nothing here
 *   converts geometry; only text sizes and hit areas are divided by the current scale, so they stay
 *   the same size on screen at every zoom.
 * - Tap a wall: a popover adds a door or window there. Tap a door: change its size or remove it.
 *   Drag a door: it slides along its own wall, 50 mm snaps, and only to spots core's `placeOpening`
 *   accepts, so two openings can never overlap.
 * - Zoom: the buttons, a pinch, or Ctrl + wheel. Two fingers pan; one finger drags a door. At zoom 1
 *   a one-finger swipe off the doors scrolls the page (`touch-action: pan-y`).
 * - Keyboard: each door is a tab stop. Enter opens it, the arrow keys move it 100 mm along its wall.
 */

/** Room around the building, in plan mm: the dimension strings sit left of and above it. */
const MM = { left: 1800, top: 900, right: 1000, bottom: 1000 };
/** And in screen px, for the labels and wall names outside that. */
const PX = 48;
const HANDLE_PX = 44;
const WALL_HIT_PX = 32;
const TAP_SLOP_PX = 6;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const KEY_STEP_MM = 100;

type Point = { x: number; y: number };
type Size = { w: number; h: number };

type Popover =
  | { kind: 'wall'; wall: WallSide; u: number; at: Point }
  | { kind: 'opening'; index: number; at: Point };

type Gesture =
  | { kind: 'drag'; index: number; grab: number; start: Point; moved: boolean }
  | { kind: 'pan'; wall: WallSide | null; start: Point; panStart: Point; moved: boolean }
  | { kind: 'pinch'; startDist: number; startZoom: number; startPan: Point; startMid: Point }
  | { kind: 'idle' };

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function GuestPlan({ design, type }: { design: GuestDesignInput; type: GuestBuildingTypeSpec }) {
  const shed = useMemo(() => shedOf(design, type), [design, type]);
  const geo = useMemo<PlanGeometry | null>(() => (shed === null ? null : buildPlanGeometry(shed)), [shed]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [popover, setPopover] = useState<Popover | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  // The latest values, for pointer handlers that outlive a render.
  const latest = useRef({ design, type, shed, zoom, pan, size });
  latest.current = { design, type, shed, zoom, pan, size };
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const returnFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const span = shed?.span ?? 1;
  const length = shed?.length ?? 1;
  const worldW = span + MM.left + MM.right;
  const worldH = length + MM.top + MM.bottom;
  const centre: Point = { x: (span + MM.right - MM.left) / 2, y: (length + MM.bottom - MM.top) / 2 };
  /** Screen px per plan mm at zoom 1. */
  const base = size.w > 0 && size.h > 0 ? Math.max(Math.min((size.w - 2 * PX) / worldW, (size.h - 2 * PX) / worldH), 1e-4) : 1;
  const k = base * zoom;
  const vbW = size.w / k;
  const vbH = size.h / k;
  const vbX = centre.x + pan.x - vbW / 2;
  const vbY = centre.y + pan.y - vbH / 2;
  /** Plan mm that cover `n` screen px. */
  const px = (n: number) => n / k;

  /** Keep the building on screen however far the guest pans. */
  const clampPan = (p: Point, z: number): Point => {
    if (z <= 1) return { x: 0, y: 0 };
    const limX = (worldW * (1 - 1 / z)) / 2;
    const limY = (worldH * (1 - 1 / z)) / 2;
    return { x: clamp(p.x, -limX, limX), y: clamp(p.y, -limY, limY) };
  };

  /** Zoom to `z`, keeping the plan point under `screen` (px from the box's top-left) where it is. */
  const zoomAt = (z: number, screen: Point, from = { zoom, pan }) => {
    const next = clamp(z, ZOOM_MIN, ZOOM_MAX);
    const kFrom = base * from.zoom;
    const kTo = base * next;
    const worldX = centre.x + from.pan.x - size.w / (2 * kFrom) + screen.x / kFrom;
    const worldY = centre.y + from.pan.y - size.h / (2 * kFrom) + screen.y / kFrom;
    const p = {
      x: worldX - screen.x / kTo - centre.x + size.w / (2 * kTo),
      y: worldY - screen.y / kTo - centre.y + size.h / (2 * kTo),
    };
    setZoom(next);
    setPan(clampPan(p, next));
  };

  const toPlan = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (svg === null || svg === undefined || m === null || m === undefined) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const toBox = (clientX: number, clientY: number): Point => {
    const r = wrapRef.current?.getBoundingClientRect();
    return r === undefined ? { x: 0, y: 0 } : { x: clientX - r.left, y: clientY - r.top };
  };

  const apply = (fit: Fit, done?: string) => {
    if (fit.ok) {
      updateDesign(() => fit.design);
      setMessage(null);
      if (done !== undefined) setAnnounce(done);
      return true;
    }
    setMessage(fit.reason);
    return false;
  };

  // Ctrl + wheel zooms (a trackpad pinch arrives this way too). Non-passive, so the page does not zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const { zoom: z, pan: p } = latest.current;
      zoomAt(z * Math.exp(-e.deltaY / 300), toBox(e.clientX, e.clientY), { zoom: z, pan: p });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  // Esc or a press outside closes the popover.
  useEffect(() => {
    if (popover === null) return;
    const close = () => {
      setPopover(null);
      setMessage(null);
      returnFocus.current?.focus();
      returnFocus.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || svgRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [popover]);

  // A popover that opens takes focus, so a keyboard user lands on its first control.
  useEffect(() => {
    if (popover === null) return;
    popRef.current?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }, [popover?.kind, popover?.kind === 'opening' ? popover.index : popover?.wall]);

  // An opening that no longer exists (removed from the accordion) takes its popover with it.
  useEffect(() => {
    if (popover?.kind === 'opening' && popover.index >= design.openings.length) setPopover(null);
  }, [design.openings.length, popover]);

  if (shed === null || geo === null) {
    return (
      <div className="g-plan g-plan-empty">
        <p>Fix the building size to see the plan.</p>
      </div>
    );
  }

  // ------------------------------------------------------------ pointers

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = {
        kind: 'pinch',
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startZoom: zoom,
        startPan: pan,
        startMid: toBox((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
      return;
    }
    if (pointers.current.size > 2) return;

    const el = e.target as Element;
    const openingEl = el.closest<SVGElement>('[data-opening]');
    const start = { x: e.clientX, y: e.clientY };
    if (openingEl !== null) {
      const index = Number(openingEl.dataset.opening);
      const spec = design.openings[index];
      const pt = toPlan(e.clientX, e.clientY);
      if (spec === undefined || pt === null) return;
      gesture.current = { kind: 'drag', index, grab: planPointToWallU(shed, spec.wall, pt) - spec.offset, start, moved: false };
      return;
    }
    const wallEl = el.closest<SVGElement>('[data-wall]');
    gesture.current = {
      kind: 'pan',
      wall: wallEl === null ? null : (wallEl.dataset.wall as WallSide),
      start,
      panStart: pan,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;

    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toBox((a.x + b.x) / 2, (a.y + b.y) / 2);
      const z = clamp(g.startZoom * (dist / g.startDist), ZOOM_MIN, ZOOM_MAX);
      // Zoom about where the fingers started, then pan by how far their midpoint has travelled.
      const kTo = base * z;
      const kFrom = base * g.startZoom;
      const wx = centre.x + g.startPan.x - size.w / (2 * kFrom) + g.startMid.x / kFrom;
      const wy = centre.y + g.startPan.y - size.h / (2 * kFrom) + g.startMid.y / kFrom;
      const p = {
        x: wx - mid.x / kTo - centre.x + size.w / (2 * kTo),
        y: wy - mid.y / kTo - centre.y + size.h / (2 * kTo),
      };
      setZoom(z);
      setPan(clampPan(p, z));
      return;
    }

    if (g.kind === 'drag') {
      if (!g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < TAP_SLOP_PX) return;
      g.moved = true;
      const { design: d, type: t, shed: s } = latest.current;
      const spec = d.openings[g.index];
      const pt = toPlan(e.clientX, e.clientY);
      if (spec === undefined || pt === null || s === null) return;
      const wanted = snap(planPointToWallU(s, spec.wall, pt) - g.grab);
      if (wanted === spec.offset) return;
      const fit = moveOpening(d, t, g.index, wanted);
      if (fit.ok && fit.design.openings[g.index]!.offset !== spec.offset) {
        updateDesign(() => fit.design);
        setMessage(null);
      }
      return;
    }

    if (g.kind === 'pan') {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
      g.moved = true;
      if (zoom > 1) setPan(clampPan({ x: g.panStart.x - dx / k, y: g.panStart.y - dy / k }, zoom));
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (e.type === 'pointercancel') {
      gesture.current = { kind: 'idle' };
      return;
    }

    if (g.kind === 'drag') {
      gesture.current = { kind: 'idle' };
      const spec = design.openings[g.index];
      if (spec === undefined) return;
      if (g.moved) {
        setAnnounce(`${OPENING_SHORT[spec.type]} moved to ${metresLabel(spec.offset)} from the left corner of the ${WALL_NAMES[spec.wall].toLowerCase()} wall.`);
        return;
      }
      returnFocus.current = null;
      setMessage(null);
      setPopover({ kind: 'opening', index: g.index, at: toBox(e.clientX, e.clientY) });
      return;
    }
    if (g.kind === 'pan') {
      gesture.current = { kind: 'idle' };
      if (g.moved) return;
      const pt = toPlan(e.clientX, e.clientY);
      if (g.wall === null || pt === null) {
        setPopover(null);
        return;
      }
      returnFocus.current = null;
      setMessage(null);
      setPopover({ kind: 'wall', wall: g.wall, u: planPointToWallU(shed, g.wall, pt), at: toBox(e.clientX, e.clientY) });
      return;
    }
    // A pinch ends when its fingers lift; a finger left on the glass does nothing until it lifts too.
    if (pointers.current.size === 0) gesture.current = { kind: 'idle' };
  };

  // ------------------------------------------------------------ keyboard on a door

  const onOpeningKey = (e: React.KeyboardEvent<SVGElement>, index: number) => {
    const spec = design.openings[index];
    if (spec === undefined) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const r = (e.currentTarget as Element).getBoundingClientRect();
      returnFocus.current = e.currentTarget as unknown as HTMLElement;
      setMessage(null);
      setPopover({ kind: 'opening', index, at: toBox(r.left + r.width / 2, r.top + r.height / 2) });
      return;
    }
    const d: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const step = d[e.key];
    if (step === undefined) return;
    e.preventDefault();
    // The arrow is a direction on screen; turn it into a distance along this door's wall.
    const du =
      planPointToWallU(shed, spec.wall, { x: step.x * KEY_STEP_MM, y: step.y * KEY_STEP_MM }) -
      planPointToWallU(shed, spec.wall, { x: 0, y: 0 });
    if (du === 0) return;
    const fit = moveOpening(design, type, index, spec.offset + du);
    if (fit.ok) {
      const moved = fit.design.openings[index]!;
      apply(fit, `${metresLabel(moved.offset)} from the left corner.`);
    } else {
      setMessage(fit.reason);
    }
  };

  // ------------------------------------------------------------ drawing

  const fs = px(12);
  const wallNameFs = px(12);
  const tick = px(5);
  const seen = new Map<string, number>();
  const openingNames = design.openings.map((o) => {
    const n = (seen.get(o.type) ?? 0) + 1;
    seen.set(o.type, n);
    return `${OPENING_SHORT[o.type]} ${n}`;
  });

  const walls: { wall: WallSide; x1: number; y1: number; x2: number; y2: number }[] = [
    { wall: 'front', x1: 0, y1: 0, x2: span, y2: 0 },
    { wall: 'right', x1: span, y1: 0, x2: span, y2: length },
    { wall: 'back', x1: 0, y1: length, x2: span, y2: length },
    { wall: 'left', x1: 0, y1: 0, x2: 0, y2: length },
  ];

  const svgStyle: CSSProperties = { touchAction: zoom > 1 ? 'none' : 'pan-y' };
  const openPopIndex = popover?.kind === 'opening' ? popover.index : -1;

  return (
    <div className="g-plan" ref={wrapRef}>
      {size.w > 0 ? (
        <svg
          ref={svgRef}
          className="g-plan-svg"
          width={size.w}
          height={size.h}
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          style={svgStyle}
          role="group"
          aria-label={`Floor plan, ${metresLabel(span)} wide and ${metresLabel(length)} long. The front wall is at the top.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <rect className="g-plan-floor" x={0} y={0} width={span} height={length} />
          {geo.bayLines.map((b, i) => (
            <line key={`bay-${i}`} className="g-plan-bay" x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} vectorEffect="non-scaling-stroke" />
          ))}
          <rect className="g-plan-outline" x={0} y={0} width={span} height={length} vectorEffect="non-scaling-stroke" />

          {/* Dimension strings: exact values from core, written in metres. */}
          <g className="g-plan-dims">
            {geo.dims.map((dim, i) => {
              const vertical = dim.axis === 'y';
              const nx = vertical ? tick : 0;
              const ny = vertical ? 0 : tick;
              return (
                <g key={`dim-${i}`}>
                  {[dim.witnessStart, dim.witnessEnd].map((w, j) => (
                    <line key={j} className="g-plan-witness" x1={w[0].x} y1={w[0].y} x2={w[1].x} y2={w[1].y} vectorEffect="non-scaling-stroke" />
                  ))}
                  <line className="g-plan-dimline" x1={dim.dimStart.x} y1={dim.dimStart.y} x2={dim.dimEnd.x} y2={dim.dimEnd.y} vectorEffect="non-scaling-stroke" />
                  {[dim.dimStart, dim.dimEnd].map((p, j) => (
                    <line key={`t${j}`} className="g-plan-dimline" x1={p.x - nx} y1={p.y - ny} x2={p.x + nx} y2={p.y + ny} vectorEffect="non-scaling-stroke" />
                  ))}
                  <text
                    className="g-plan-dimtext"
                    x={dim.textAt.x}
                    y={dim.textAt.y}
                    fontSize={fs}
                    dy={-px(5)}
                    textAnchor="middle"
                    transform={vertical ? `rotate(-90 ${dim.textAt.x} ${dim.textAt.y})` : undefined}
                  >
                    {metresLabel(dim.value)}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Wall names, outside the walls and the dimension strings. */}
          <g className="g-plan-wallnames" fontSize={wallNameFs}>
            <text x={span / 2} y={-MM.top - px(26)} textAnchor="middle">
              FRONT
            </text>
            <text x={span / 2} y={length + px(24)} textAnchor="middle" dominantBaseline="hanging">
              BACK
            </text>
            <text x={span + px(22)} y={length / 2} textAnchor="middle" transform={`rotate(90 ${span + px(22)} ${length / 2})`}>
              RIGHT
            </text>
            <text x={-MM.left - px(22)} y={length / 2} textAnchor="middle" transform={`rotate(-90 ${-MM.left - px(22)} ${length / 2})`}>
              LEFT
            </text>
          </g>

          {/* Tap targets along the walls. */}
          {walls.map((w) => (
            <line
              key={`hit-${w.wall}`}
              className="g-plan-wallhit"
              data-wall={w.wall}
              x1={w.x1}
              y1={w.y1}
              x2={w.x2}
              y2={w.y2}
              strokeWidth={WALL_HIT_PX}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Openings: core's symbol primitives, then a 44px handle over each. */}
          {geo.openings.map((o, i) => {
            const spec = design.openings[i];
            if (spec === undefined) return null;
            const horizontal = o.wall === 'front' || o.wall === 'back';
            const len = horizontal ? o.rect.width : o.rect.height;
            const reach = Math.max(len, px(HANDLE_PX));
            const extra = (reach - len) / 2;
            const hx1 = horizontal ? o.rect.x - extra : o.rect.x;
            const hy1 = horizontal ? o.rect.y : o.rect.y - extra;
            const hx2 = horizontal ? o.rect.x + o.rect.width + extra : o.rect.x;
            const hy2 = horizontal ? o.rect.y : o.rect.y + o.rect.height + extra;
            const active = i === openPopIndex;
            return (
              <g key={o.id} className={active ? 'g-plan-opening is-active' : 'g-plan-opening'}>
                {o.symbol.rects.map((r, j) => (
                  <rect
                    key={`r${j}`}
                    className={r.role === 'track' ? 'g-plan-sym g-plan-track' : r.filled ? 'g-plan-sym g-plan-fill' : 'g-plan-sym'}
                    x={r.x}
                    y={r.y}
                    width={Math.max(r.width, 0)}
                    height={Math.max(r.height, 0)}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {o.symbol.lines.map((l, j) => (
                  <line key={`l${j}`} className="g-plan-sym" x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} vectorEffect="non-scaling-stroke" />
                ))}
                {o.symbol.arc === undefined ? null : <path className="g-plan-sym g-plan-arc" d={arcPath(o.symbol.arc)} vectorEffect="non-scaling-stroke" />}
                <line
                  className="g-plan-handle"
                  data-opening={i}
                  x1={hx1}
                  y1={hy1}
                  x2={hx2}
                  y2={hy2}
                  strokeWidth={HANDLE_PX}
                  vectorEffect="non-scaling-stroke"
                  tabIndex={0}
                  role="button"
                  aria-label={`${openingNames[i]}, ${sizeLabel(spec.size)}, ${WALL_NAMES[spec.wall].toLowerCase()} wall, ${metresLabel(spec.offset)} from the left corner. Enter to change, arrow keys to move.`}
                  onKeyDown={(e) => onOpeningKey(e, i)}
                />
              </g>
            );
          })}
        </svg>
      ) : null}

      <div className="g-plan-zoom" role="group" aria-label="Zoom the plan">
        <button type="button" className="g-icon-btn" aria-label="Zoom in" title="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => zoomAt(zoom * 1.5, { x: size.w / 2, y: size.h / 2 })}>
          <IconZoomIn />
        </button>
        <button
          type="button"
          className="g-icon-btn"
          aria-label="Zoom out"
          /* At the minimum the whole plan is already on screen; say so rather than just going dead. */
          title={zoom <= ZOOM_MIN ? 'Already showing the whole plan' : 'Zoom out'}
          disabled={zoom <= ZOOM_MIN}
          onClick={() => zoomAt(zoom / 1.5, { x: size.w / 2, y: size.h / 2 })}
        >
          <IconZoomOut />
        </button>
        <button
          type="button"
          className="g-icon-btn"
          aria-label="Fit the whole plan"
          disabled={zoom === 1}
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <IconFit />
        </button>
      </div>

      {popover === null ? null : (
        <PlanPopover
          ref={popRef}
          popover={popover}
          box={size}
          design={design}
          type={type}
          names={openingNames}
          message={message}
          onApply={(fit, done) => {
            if (apply(fit, done)) {
              setPopover(null);
              returnFocus.current = null;
            }
          }}
          onChange={(fit, done) => {
            apply(fit, done);
          }}
          onClose={() => {
            setPopover(null);
            setMessage(null);
          }}
        />
      )}

      <p className="g-sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {popover === null && message !== null ? (
        <p className="g-plan-message" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Core's arc (Konva semantics: degrees, clockwise from +x) as an SVG path along the swing. */
function arcPath(arc: { x: number; y: number; radius: number; rotation: number; sweep: number }): string {
  const a0 = (arc.rotation * Math.PI) / 180;
  const a1 = ((arc.rotation + arc.sweep) * Math.PI) / 180;
  const p0 = { x: arc.x + arc.radius * Math.cos(a0), y: arc.y + arc.radius * Math.sin(a0) };
  const p1 = { x: arc.x + arc.radius * Math.cos(a1), y: arc.y + arc.radius * Math.sin(a1) };
  const large = Math.abs(arc.sweep) > 180 ? 1 : 0;
  const sweepFlag = arc.sweep >= 0 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${arc.radius} ${arc.radius} 0 ${large} ${sweepFlag} ${p1.x} ${p1.y}`;
}

// ---------------------------------------------------------------- popovers

const POP_W = 288;
const POP_MIN_H = 260;

const POP_POSITIONS: { id: Position; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'centre', label: 'Centre' },
  { id: 'right', label: 'Right' },
];

/**
 * Distance from the wall's left corner (seen from outside), typed in metres. It commits on Enter or
 * when focus leaves, and the placement rules pick the nearest legal spot; a key per offset resets it.
 */
function OffsetInput({
  id,
  offset,
  run,
  width,
  onCommit,
}: {
  id: string;
  offset: number;
  run: number | null;
  width: number;
  onCommit: (mm: number) => void;
}) {
  const shown = (offset / 1000).toFixed(2);
  const [text, setText] = useState(shown);
  const max = run === null ? null : Math.max(0, run - width);
  const commit = () => {
    const m = Number(text.replace(',', '.'));
    if (!Number.isFinite(m) || text.trim() === '') {
      setText(shown);
      return;
    }
    const mm = Math.round(m * 1000);
    if (mm === offset) return;
    onCommit(max === null ? Math.max(0, mm) : clamp(mm, 0, max));
  };
  return (
    <div className="g-popover-offset">
      <label htmlFor={id} className="g-chip-legend">
        From left corner
      </label>
      <div className="g-popover-offset-row">
        <input
          id={id}
          className="g-input"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          aria-describedby={`${id}-hint`}
        />
        <span id={`${id}-hint`} className="g-popover-sub">
          m{max === null ? '' : ` (0 – ${(max / 1000).toFixed(2)})`}
        </span>
      </div>
    </div>
  );
}

function PlanPopover({
  ref,
  popover,
  box,
  design,
  type,
  names,
  message,
  onApply,
  onChange,
  onClose,
}: {
  ref: React.Ref<HTMLDivElement>;
  popover: Popover;
  box: Size;
  design: GuestDesignInput;
  type: GuestBuildingTypeSpec;
  names: string[];
  message: string | null;
  onApply: (fit: Fit, done?: string) => void;
  /** Like `onApply`, but the popover stays open: size, wall and position are tried one after another. */
  onChange: (fit: Fit, done?: string) => void;
  onClose: () => void;
}) {
  const left = clamp(popover.at.x - POP_W / 2, 8, Math.max(8, box.w - POP_W - 8));
  const below = popover.at.y < box.h / 2;
  // Room left between the anchor and the plan's edge. Too little (a short plan on a small screen)
  // and the popover pins to the plan's top and scrolls inside, rather than running past the edge.
  const room = below ? box.h - popover.at.y - 24 : popover.at.y - 24;
  const style: CSSProperties =
    room < POP_MIN_H
      ? { left, top: 8, width: POP_W, maxHeight: Math.max(0, box.h - 16) }
      : below
        ? { left, top: popover.at.y + 16, width: POP_W, maxHeight: room }
        : { left, bottom: box.h - popover.at.y + 16, width: POP_W, maxHeight: room };

  if (popover.kind === 'wall') {
    const { rules, lockedReason } = type.config.openings;
    const wallName = WALL_NAMES[popover.wall];
    return (
      <div ref={ref} className="g-popover" style={style} role="dialog" aria-label={`Add to the ${wallName.toLowerCase()} wall`}>
        <p className="g-popover-title">{wallName} wall</p>
        {rules.length === 0 ? (
          <p className="g-popover-note">{lockedReason ?? 'This building type takes no doors or windows.'}</p>
        ) : (
          <div className="g-popover-actions">
            {rules.map((rule) => {
              const full = countOf(design, rule.type) >= rule.max;
              return (
                <button
                  key={rule.type}
                  type="button"
                  className="g-btn g-btn-outline g-popover-btn"
                  disabled={full}
                  onClick={() => onApply(addOpening(design, type, rule.type, popover.wall, popover.u), `${OPENING_SHORT[rule.type]} added to the ${wallName.toLowerCase()} wall.`)}
                >
                  <IconPlus />
                  {OPENING_SHORT[rule.type]}
                  {full ? <span className="g-popover-max">max {rule.max}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        {message === null ? null : (
          <p className="g-field-error" role="alert">
            {message}
          </p>
        )}
        <button type="button" className="g-btn g-btn-ghost g-popover-close" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  const spec = design.openings[popover.index];
  if (spec === undefined) return null;
  const rule = ruleFor(type, spec.type);
  const name = names[popover.index] ?? OPENING_SHORT[spec.type];
  const shed = shedOf(design, type);
  return (
    <div ref={ref} className="g-popover g-popover-opening" style={style} role="dialog" aria-label={name}>
      <p className="g-popover-title">
        {name} <span className="g-popover-sub">{WALL_NAMES[spec.wall]} wall</span>
      </p>
      {rule !== undefined && rule.sizes.length > 1 ? (
        <ChipRadios
          legend="Size"
          name={`g-pop-size-${popover.index}`}
          options={rule.sizes.map((s) => ({ id: `${s.width}x${s.height}`, label: sizeLabel(s) }))}
          value={`${spec.size.width}x${spec.size.height}`}
          onPick={(id) => {
            const s = rule.sizes.find((x) => `${x.width}x${x.height}` === id);
            if (s !== undefined) onChange(setOpeningSize(design, type, popover.index, s), `${name} is now ${sizeLabel(s)}.`);
          }}
        />
      ) : (
        <p className="g-popover-note">{sizeLabel(spec.size)}</p>
      )}
      <ChipRadios
        legend="Wall"
        name={`g-pop-wall-${popover.index}`}
        options={WALLS.map((w) => ({ id: w, label: WALL_NAMES[w] }))}
        value={spec.wall}
        onPick={(w) =>
          onChange(setOpeningWall(design, type, popover.index, w as WallSide), `${name} moved to the ${WALL_NAMES[w as WallSide].toLowerCase()} wall.`)
        }
      />
      <fieldset className="g-chip-set">
        <legend className="g-chip-legend">Position</legend>
        <div className="g-chips">
          {POP_POSITIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="g-chip"
              aria-pressed={positionOf(design, type, popover.index) === p.id}
              onClick={() => onChange(positionOpening(design, type, popover.index, p.id), `${name} moved to the ${p.label.toLowerCase()}.`)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>
      <OffsetInput
        key={`${popover.index}-${spec.wall}-${spec.offset}`}
        id={`g-pop-offset-${popover.index}`}
        offset={spec.offset}
        run={shed === null ? null : wallLength(shed, spec.wall)}
        width={spec.size.width}
        onCommit={(mm) => {
          const fit = moveOpening(design, type, popover.index, snap(mm));
          const landed = fit.ok ? fit.design.openings[popover.index]?.offset : undefined;
          onChange(
            fit,
            landed === undefined
              ? undefined
              : `${name} moved to ${metresLabel(landed)} from the left corner${Math.abs(landed - mm) > SNAP_MM ? ', the nearest free spot' : ''}.`,
          );
        }}
      />
      {spec.type === 'roller_door' ? (
        <label className="g-switch">
          <input
            type="checkbox"
            className="g-switch-input"
            checked={spec.motorised === true}
            onChange={(e) => onChange({ ok: true, design: setMotorised(design, popover.index, e.target.checked) })}
          />
          <span className="g-switch-track" aria-hidden="true" />
          <span>Motorised</span>
        </label>
      ) : null}
      {message === null ? null : (
        <p className="g-field-error" role="alert">
          {message}
        </p>
      )}
      <div className="g-popover-row">
        <button
          type="button"
          className="g-btn g-btn-danger g-popover-btn"
          onClick={() => onApply({ ok: true, design: removeOpening(design, popover.index) }, `${name} removed.`)}
        >
          <IconTrash />
          Remove
        </button>
        <button type="button" className="g-btn g-btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
