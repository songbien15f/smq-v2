'use client';

/**
 * The 2D plan view.
 *
 * Owns the camera (scale + pixel translation) and the Konva stage ref; the
 * drawing itself lives in `PlanCanvas`, which receives plain `PlanGeometry`.
 * Geometry comes from `src/domain/plan.ts` and is memoised on the config, so a
 * store change redraws and nothing else recomputes.
 *
 * Interaction (spec §7.1):
 *   - wheel / trackpad: zoom toward the pointer;
 *   - single-pointer drag: pan (Konva `draggable` stage reports `onDragEnd`);
 *   - two-touch move: pinch-zoom about the touch midpoint;
 *   - right-click (desktop) or long-press (touch): a context menu at the pointer
 *     to add a door on the nearest wall, duplicate, or delete (spec §5.4).
 *
 * The camera is expressed in CSS pixels. Millimetres become pixels through a
 * fit-to-container factor derived from the outline and the measured container,
 * multiplied by the user's zoom. `exportPng()` hands Task 18 a data URL straight
 * from the Konva stage.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type Konva from 'konva';
import { useShedStore } from '@/store/useShedStore';
import { buildPlanGeometry } from '@sq/core/domain';
import {
  constrainOpeningU,
  constrainOptionDrag,
  displacementToDu,
  dragGuide,
  moveOpeningTo,
  moveOptionTo,
  nearestWall,
  openingAtPlanPoint,
  openingAtPoint,
  optionAtPlanPoint,
  placementToPlanRect,
  planPointToWallU,
  pointInFootprint,
  resolveOpeningPlacement,
  wallDisplacement,
} from '@sq/core/domain';
import { canDuplicate, resolveOption } from '@sq/core/domain';
import {
  OPENING_TYPE_OPTIONS,
  OPTION_KIND_OPTIONS,
  affordancePositions,
  popoverPosition,
  selectionAnchor,
} from '@sq/core/domain';
import { DEFAULT_OPENING_BY_TYPE } from '@sq/core/domain';
import type { Opening, OpeningType, OptionKind, ShedConfig, ShedOption } from '@sq/core/domain';
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { PlanCanvas, type DoorGhost } from './PlanCanvas';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { SelectionPopover } from './SelectionPopover';
/** Handle exposed to Task 18 through a ref. */
export interface Render2DHandle {
  /** The current stage as a PNG data URL, or `null` before the stage mounts. */
  exportPng(): string | null;
}

/** Fraction of the container the fitted plan fills. */
const FIT_PADDING = 0.82;

/** Zoom limits, as a multiplier on the fitted scale. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 12;

/**
 * Stage size used before the container reports its real size (first paint and
 * jsdom, where `clientWidth`/`clientHeight` are 0). Without a positive fallback
 * the canvas would never mount and `exportPng()` could never be wired up.
 */
const FALLBACK_WIDTH = 800;
const FALLBACK_HEIGHT = 600;

/** How far a duplicate is placed from its source along the wall, mm. */
const DUPLICATE_STEP_MM = 1000;

/**
 * Assumed on-screen size of the context menu, for viewport-safe placement. The
 * tallest list is the option-kind submenu: a Back row plus the eleven kinds,
 * each row `min-h-10` (40 px), plus the list's `py-1` padding — 12 × 40 + 8 = 488.
 * `popoverPosition` only uses this to keep the menu on screen, so an upper bound
 * is what matters.
 */
const MENU_WIDTH = 200;
const MENU_HEIGHT = 520;

interface Point {
  x: number;
  y: number;
}

/**
 * The in-flight drag: which door, its clamped displacement from rest in
 * stage-local millimetres, and its live clamped wall offset `u` (mm). `null`
 * when no drag is running. The `u` is carried so the display-only drag guide can
 * be derived from it without a store read or write per frame.
 */
interface OpeningDrag {
  id: string;
  x: number;
  y: number;
  u: number;
}

/** The in-flight option drag: which option and its clamped plan-mm displacement. */
interface OptionDrag {
  id: string;
  x: number;
  y: number;
}

/** The open context menu: its container-relative screen position and plan point. */
interface MenuState {
  x: number;
  y: number;
  planPoint: Point;
  /** The opening the menu opened on, or `null` when it opened on empty space. */
  hitId: string | null;
  /**
   * Which rows to show. `canvas` is the context-sensitive right-click menu
   * (door → Duplicate/Delete, empty space → Add door / Add option submenus).
   * `add` is the floating Add button's chooser (the four opening types directly,
   * plus an Add-option submenu). `door` is the selected door's ⋮ button
   * (Duplicate/Delete), which keeps those actions reachable on touch now that the
   * long press is gone.
   */
  kind: 'canvas' | 'add' | 'door';
}

/** The id prefix of an Add-door submenu row; the suffix is the `OpeningType`. */
const ADD_TYPE_PREFIX = 'add:';

/** The id prefix of an Add-option submenu row; the suffix is the `OptionKind`. */
const ADD_OPTION_PREFIX = 'add-option:';

/**
 * The id prefix of a "place on the plan" row; the suffix is the `OpeningType`.
 *
 * Separate from `ADD_TYPE_PREFIX` because the two gestures are different: `add:` drops a
 * door at the point the menu was opened on (one press, no aim), `place:` arms the canvas so
 * the operator aims. Both are worth keeping — a quick add is right when the exact position
 * does not matter yet, and aiming is right when it does.
 */
const PLACE_TYPE_PREFIX = 'place:';

/** The floating Add button's box, container-relative, and its touch size (px). */
const ADD_BUTTON_LEFT = 8;
const ADD_BUTTON_TOP = 8;
const ADD_BUTTON_SIZE = 44;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * True when two options would draw in the same place, so a drag that resolved to
 * where it started writes nothing.
 *
 * Compared on the **resolved rect**, not on the anchor fields: a drag always
 * forces `align: 'custom'` and can leave a sub-millimetre `alongBay`, so the
 * anchors differ even when the shape has not moved. The rect is what the user
 * sees, so it is the honest test — and it is rounded to whole millimetres, which
 * is the canonical unit.
 */
function sameAnchor(shed: ShedConfig, a: ShedOption, b: ShedOption): boolean {
  const before = resolveOption(a, shed).rect;
  const after = resolveOption(b, shed).rect;
  return (
    Math.round(before.x) === Math.round(after.x) &&
    Math.round(before.y) === Math.round(after.y)
  );
}

/**
 * `Render2D` takes no props — it reads the config from the store — but the props
 * type must still be an open object so a `ref` can be passed by the page. A
 * `Record<string, never>` index signature rejects `ref`; `Record<never, never>`
 * is an empty object type with no index signature and accepts it.
 */
export type Render2DProps = Record<never, never>;

export const Render2D = forwardRef<Render2DHandle, Render2DProps>(function Render2D(_props, ref) {
  const config = useShedStore((s) => s.config);
  const selection = useShedStore((s) => s.selection);
  const editorOpen = useShedStore((s) => s.editorOpen);
  const select = useShedStore((s) => s.select);
  const setEditorOpen = useShedStore((s) => s.setEditorOpen);
  const patchOpening = useShedStore((s) => s.patchOpening);
  const patchOption = useShedStore((s) => s.patchOption);
  const removeOption = useShedStore((s) => s.removeOption);
  const duplicateOption = useShedStore((s) => s.duplicateOption);
  const addOpening = useShedStore((s) => s.addOpening);
  const addOption = useShedStore((s) => s.addOption);
  const removeOpening = useShedStore((s) => s.removeOpening);
  const applyPartial = useShedStore((s) => s.applyPartial);
  const setObjectDragging = useShedStore((s) => s.setObjectDragging);
  // The floating editor is desktop-only; on mobile the `ControlSheet` drawer
  // owns object editing (spec §5.6), so the two never stack.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const geometry = useMemo(() => buildPlanGeometry(config), [config]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  // The in-flight door drag, or `null`. Held in component state so the door
  // follows the pointer without a store write per frame (spec §5.3, R3); the
  // store is written exactly once, on release.
  const [drag, setDrag] = useState<OpeningDrag | null>(null);
  // The in-flight option drag, or `null`. Same rule as a door drag: per-frame
  // position in component state, one store write on release.
  const [optionDrag, setOptionDrag] = useState<OptionDrag | null>(null);
  // The open context menu, or `null`. `x`/`y` are container-relative screen
  // pixels for placement; `planPoint` is the stage-local plan point (mm) the
  // menu's actions work from, captured when it opened.
  const [menu, setMenu] = useState<MenuState | null>(null);
  /**
   * Add mode: the opening type being placed on the plan, or `null`.
   *
   * Arming a type turns the canvas into a placement surface — a ghost follows the pointer,
   * a click places the door exactly where the rules would put it, and Escape leaves without
   * adding anything. It exists because the desktop lets an operator pick a wall and put a
   * door on it, and the only way to do that here was to add at the default position and
   * then drag; that is two gestures and a guess where one press will do.
   */
  const [placing, setPlacing] = useState<OpeningType | null>(null);
  /** The ghost's last known position, updated on pointer move. */
  const [ghostAt, setGhostAt] = useState<Point | null>(null);

  // Mirror the camera in refs so pointer handlers can compute the next camera
  // from the current one without nesting a `setPosition` inside a `setZoom`
  // updater (a side effect there would run twice under StrictMode).
  const zoomRef = useRef(zoom);
  const positionRef = useRef(position);
  zoomRef.current = zoom;
  positionRef.current = position;

  // Keep the latest pinch distance between renders without triggering one.
  const pinchDistance = useRef<number | null>(null);

  /**
   * A drag can end without `dragend` ever firing: Konva listens for the release
   * on `window`, so a pointer released over browser chrome or outside the window
   * leaves the drag flag set. On mobile that flag collapses the drawer and
   * swallows its next dismissal, which makes the object editor unreachable until
   * a reload. Clearing it on any pointer release is a cheap safety net; the
   * normal `dragend` path still does the real commit.
   */
  useEffect(() => {
    const clear = () => setObjectDragging(false);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    window.addEventListener('touchend', clear);
    window.addEventListener('touchcancel', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
      window.removeEventListener('touchend', clear);
      window.removeEventListener('touchcancel', clear);
      // Unmounting mid-drag must not leave the flag set for the next mount.
      setObjectDragging(false);
    };
  }, [setObjectDragging]);

  // Measure the container; the plan fits to whatever space it is given.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const outline = geometry.outline;

  // Pixels per millimetre when the whole plan just fits the container. Falls
  // back to a fixed viewport until the container is measured.
  const viewWidth = width > 0 ? width : FALLBACK_WIDTH;
  const viewHeight = height > 0 ? height : FALLBACK_HEIGHT;

  const fitScale = useMemo(() => {
    if (outline.width <= 0 || outline.height <= 0) return 0;
    return Math.min(viewWidth / outline.width, viewHeight / outline.height) * FIT_PADDING;
  }, [viewWidth, viewHeight, outline.width, outline.height]);

  const scale = fitScale * zoom;

  /**
   * The camera that makes the whole plan fit the container, centred (spec §5.3:
   * "Reset view"). Shared by the recentre effect and the reset control so both
   * land on exactly the same fitted scale and position.
   */
  const fitView = useCallback(
    (): { zoom: number; position: Point } => ({
      zoom: 1,
      position: {
        x: (viewWidth - outline.width * fitScale) / 2,
        y: (viewHeight - outline.height * fitScale) / 2,
      },
    }),
    [viewWidth, viewHeight, fitScale, outline.width, outline.height],
  );

  // Recentre whenever the fitted scale or the viewport changes, so a new shed
  // or a resize lands centred rather than drifting off-screen.
  useEffect(() => {
    const fitted = fitView();
    setZoom(fitted.zoom);
    setPosition(fitted.position);
  }, [fitView]);

  /** Restore the initial fit — the corner button and the canvas double-tap. */
  const resetView = useCallback(() => {
    const fitted = fitView();
    setZoom(fitted.zoom);
    setPosition(fitted.position);
  }, [fitView]);

  /** Zoom by `factor` about the stage-local screen point `pivot`. */
  const zoomAbout = useCallback((factor: number, pivot: Point) => {
    const previous = zoomRef.current;
    const next = clamp(previous * factor, MIN_ZOOM, MAX_ZOOM);
    const applied = next / previous;
    if (applied === 1) return;
    const current = positionRef.current;
    setZoom(next);
    setPosition({
      x: pivot.x - (pivot.x - current.x) * applied,
      y: pivot.y - (pivot.y - current.y) * applied,
    });
  }, []);

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const pointer = stageRef.current?.getPointerPosition();
      const pivot = pointer ?? { x: viewWidth / 2, y: viewHeight / 2 };
      // Trackpads report small deltas; the exponential keeps zoom smooth.
      zoomAbout(Math.exp(-event.evt.deltaY * 0.0015), pivot);
    },
    [zoomAbout, viewWidth, viewHeight],
  );

  const handleDragEnd = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      // A door group's `dragend` bubbles to the Stage (Konva fires it with
      // `bubble: true` and it is not a non-bubbling event), so without this
      // guard a door drag would set the camera to the group's position. Only the
      // Stage's own drag moves the camera.
      if (event.target !== stageRef.current) return;
      const stage = event.target;
      setPosition({ x: stage.x(), y: stage.y() });
    },
    [],
  );

  /**
   * Clamp a door drag, called by Konva's `dragBoundFunc` on every frame.
   *
   * Konva hands us the group's proposed *absolute* (container-pixel) position;
   * the stage is scaled so 1 Konva unit = 1 mm, so `(pos − stage position) /
   * scale` is the pointer's plan-mm displacement since the drag began. Adding
   * that to the door's current offset gives the candidate `u`, which
   * `constrainOpeningU` clamps into the wall. We return the clamped absolute
   * position and mirror the clamped displacement into component state so the
   * door follows the pointer. No store write happens here (spec §5.3, R3): this
   * runs ~60×/s and must not touch history.
   */
  const handleConstrainOpeningDrag = useCallback(
    (id: string, pos: Point): Point => {
      const opening = config.openings.find((o) => o.id === id);
      if (!opening) return pos;
      const origin = positionRef.current;
      const s = scale > 0 ? scale : 1;
      const rawDu = displacementToDu(config, opening.wall, {
        x: (pos.x - origin.x) / s,
        y: (pos.y - origin.y) / s,
      });
      const startU = resolveOpeningPlacement(opening, config).u;
      const clampedU = constrainOpeningU(config, opening, startU + rawDu);
      const d = wallDisplacement(config, opening.wall, clampedU - startU);
      setDrag({ id, x: d.x, y: d.y, u: clampedU });
      return { x: origin.x + d.x * s, y: origin.y + d.y * s };
    },
    [config, scale],
  );

  /**
   * Commit a finished door drag: one `patchOpening`, therefore exactly one
   * history entry (Review Focus #1). The group's local `x`/`y` at drag end is
   * the cumulative plan-mm displacement, which maps back to a wall offset via
   * `displacementToDu`. A drag that ends where it started (the rounded offset is
   * unchanged) writes nothing, so it adds no undo step.
   */
  const handleOpeningDragEnd = useCallback(
    (id: string, event: Konva.KonvaEventObject<DragEvent>) => {
      setDrag(null);
      const opening = config.openings.find((o) => o.id === id);
      if (!opening) return;
      const target = event.target;
      const d = { x: target.x(), y: target.y() };
      const startU = resolveOpeningPlacement(opening, config).u;
      const finalU = startU + displacementToDu(config, opening.wall, d);
      // Canonical offsets are integer millimetres, so compare rounded: a sub-mm
      // drift from the drag maths is not a move.
      if (Math.round(constrainOpeningU(config, opening, finalU)) === Math.round(startU)) return;
      const move = moveOpeningTo(config, id, finalU);
      if (move !== null) patchOpening(move.id, move.patch);
    },
    [config, patchOpening],
  );

  /**
   * Clamp an option drag on every frame. The proposed absolute position is
   * converted to a plan point (`(pos − stage position) / scale`), the kind's own
   * anchor rule turns that into a candidate option, and the clamped result is
   * mirrored into component state so the shape follows the pointer. No store
   * write: this runs ~60×/s and must not create history.
   */
  const handleConstrainOptionDrag = useCallback(
    (id: string, pos: Point): Point => {
      const option = config.options.find((o) => o.id === id);
      if (option === undefined) return pos;
      const origin = positionRef.current;
      const s = scale > 0 ? scale : 1;
      // The group rests at its local origin, so Konva's proposed absolute
      // position minus the stage's is the pointer's **displacement** since the
      // drag began — not a plan coordinate. Add it to the option's rest centre to
      // get the plan point the pointer is over; treating the displacement as a
      // coordinate would teleport the shape to the front of the shed.
      const delta = { x: (pos.x - origin.x) / s, y: (pos.y - origin.y) / s };
      const original = resolveOption(option, config);
      const planPoint = {
        x: original.rect.x + original.rect.width / 2 + delta.x,
        y: original.rect.y + original.rect.height / 2 + delta.y,
      };
      const moved = constrainOptionDrag(config, option, planPoint);
      const resolved = resolveOption(moved, config);
      // The displacement is the clamped rect's move, so a snapped anchor (a bay
      // line, a corner) shows as the shape jumping to where it will land.
      const d = {
        x: resolved.rect.x - original.rect.x,
        y: resolved.rect.y - original.rect.y,
      };
      setOptionDrag({ id, x: d.x, y: d.y });
      // Collapse the mobile drawer while the shape moves, so the plan is not
      // covered by the editor the user is dragging under.
      setObjectDragging(true);
      return { x: origin.x + d.x * s, y: origin.y + d.y * s };
    },
    [config, scale, setObjectDragging],
  );

  /**
   * Commit a finished option drag: one `patchOption`, therefore exactly one
   * history entry. A drag that resolves to the option's current anchor writes
   * nothing, so it adds no undo step.
   */
  const handleOptionDragEnd = useCallback(
    (id: string, event: Konva.KonvaEventObject<DragEvent>) => {
      setOptionDrag(null);
      setObjectDragging(false);
      const option = config.options.find((o) => o.id === id);
      if (option === undefined) return;
      const target = event.target;
      // The group sits at the origin at rest and its local x/y is the cumulative
      // plan-mm displacement of the drag (the stage is scaled so 1 unit = 1 mm),
      // so the pointer's plan point is the option's rest centre plus that.
      const original = resolveOption(option, config);
      const planPoint = {
        x: original.rect.x + original.rect.width / 2 + target.x(),
        y: original.rect.y + original.rect.height / 2 + target.y(),
      };
      const moved = constrainOptionDrag(config, option, planPoint);
      if (sameAnchor(config, option, moved)) return;
      const move = moveOptionTo(config, id, planPoint);
      if (move !== null) patchOption(move.id, move.patch);
    },
    [config, patchOption, setObjectDragging],
  );

  const handleTouchMove = useCallback(
    (event: Konva.KonvaEventObject<TouchEvent>) => {
      const touches = event.evt.touches;
      if (touches.length !== 2) {
        pinchDistance.current = null;
        return;
      }
      const [a, b] = touches;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const previous = pinchDistance.current;
      pinchDistance.current = distance;
      if (previous === null || previous === 0) return;

      const rect = containerRef.current?.getBoundingClientRect();
      const pivot = rect
        ? {
            x: (a.clientX + b.clientX) / 2 - rect.left,
            y: (a.clientY + b.clientY) / 2 - rect.top,
          }
        : { x: viewWidth / 2, y: viewHeight / 2 };
      zoomAbout(distance / previous, pivot);
    },
    [zoomAbout, viewWidth, viewHeight],
  );

  const handleTouchEnd = useCallback(() => {
    pinchDistance.current = null;
  }, []);

  /**
   * Place the armed door at a plan point.
   *
   * The pointer only decides **which wall and where along it** — `openingAtPoint`'s job. The
   * rules that decide whether it lands, and the "GO WITH …" that fixes a near miss, belong to
   * the store's `addOpening`, which is the same path the form uses. Duplicating them here
   * would give the canvas a second rulebook that could disagree with the form's.
   *
   * Add mode **stays armed** after a placement: two windows on one wall should not need
   * re-arming between them. Escape, or the Done button, leaves.
   */
  const placeAt = useCallback(
    (planPoint: Point) => {
      if (placing === null) return;
      const size = DEFAULT_OPENING_BY_TYPE[placing];
      const { wall, candidate } = openingAtPoint(
        config,
        { type: placing, width: size.width, height: size.height, sill: size.sill },
        planPoint,
      );
      addOpening({
        type: placing,
        wall,
        align: 'custom',
        offset: candidate.offset ?? 0,
        width: size.width,
        height: size.height,
        sill: size.sill,
      });
    },
    [placing, config, addOpening],
  );

  /**
   * The ghost under the pointer, in the state the rules would put it in.
   *
   * Derived here rather than drawn from the pointer: the footprint has to show where the
   * door would **actually land** (possibly moved by a rule), not where the finger is.
   */
  const doorGhost = useMemo((): DoorGhost | null => {
    if (placing === null || ghostAt === null) return null;
    const size = DEFAULT_OPENING_BY_TYPE[placing];
    const result = openingAtPoint(
      config,
      { type: placing, width: size.width, height: size.height, sill: size.sill },
      ghostAt,
    );

    const accepted = result.outcome.ok
      ? result.outcome.opening
      : 'proposals' in result.outcome
        ? result.outcome.proposals[0]?.opening
        : undefined;
    // A refusal with no proposal has nothing to draw where: show the raw candidate, so
    // the operator can see the thing that does not fit rather than nothing at all.
    const drawn = accepted ?? result.candidate;
    const state: DoorGhost['state'] = result.outcome.ok
      ? 'ok'
      : accepted === undefined
        ? 'refused'
        : 'move';

    return {
      rect: placementToPlanRect(drawn, config),
      at: ghostAt,
      state,
      label:
        state === 'ok'
          ? `${placing.replace('_', ' ')} on the ${result.wall} wall`
          : state === 'move'
            ? 'Would move here — click to accept'
            : 'Does not fit here',
    };
  }, [placing, ghostAt, config]);

  /**
   * Leave add mode.
   *
   * Escape is the universal "cancel" on a canvas, and a mode with no keyboard exit traps a
   * keyboard user in it. Bound to the window while armed so it works wherever focus is.
   */
  useEffect(() => {
    if (placing === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlacing(null);
        setGhostAt(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing]);

  /**
   * A click/tap on the plan: hit-test the pointer against the openings and
   * select the door under it, or the building when the point is inside its
   * footprint, or clear the selection when it is outside (spec §5.1).
   *
   * `getRelativePointerPosition()` inverts the stage transform (pan and zoom
   * already divided out), so its result is in the stage's own units — and
   * because the stage is scaled so 1 Konva unit = 1 mm, those units are already
   * millimetres. Do not multiply by `scale` again. Guarded with `?.` because the
   * mocked stage in tests does not implement it.
   *
   * The opening hit tolerance is `openingAtPlanPoint`'s own domain default, so
   * the click path and the context-menu path share one spec constant (§4.3).
   * `pointInFootprint` has no halo: a click just outside a wall reads as
   * "clicked away" and clears the selection, which also closes the editor (the
   * store keeps `editorOpen ⇒ selection ≠ none`).
   */
  const handleCanvasPointer = useCallback(() => {
    const planPoint = stageRef.current?.getRelativePointerPosition?.();
    if (!planPoint) return;

    // In add mode a click places; it never selects. A ghost under the pointer is
    // not listening, so this branch is the only thing a click can do.
    if (placing !== null) {
      placeAt(planPoint);
      return;
    }

    // Openings first: a door is a finer target and sits on the wall the user is
    // pointing at, so where a door and an option overlap the door is what was
    // meant (spec §5.4).
    const hit = openingAtPlanPoint(geometry, planPoint);
    if (hit) {
      select({ kind: 'opening', id: hit.id });
      return;
    }
    const optionHit = optionAtPlanPoint(geometry, planPoint);
    if (optionHit) {
      select({ kind: 'option', id: optionHit.id });
      return;
    }
    select(pointInFootprint(geometry, planPoint) ? { kind: 'building' } : { kind: 'none' });
  }, [geometry, select, placing, placeAt]);

  /** Track the pointer while a door is being placed, so the ghost follows it. */
  const handleCanvasMove = useCallback(() => {
    if (placing === null) return;
    const planPoint = stageRef.current?.getRelativePointerPosition?.();
    if (!planPoint) return;
    setGhostAt(planPoint);
  }, [placing]);

  /**
   * Open the context menu at a client point (the pointer for a right-click, the
   * press origin for a long press).
   *
   * `getRelativePointerPosition()` gives the stage-local plan point in mm (pan
   * and zoom already divided out; see `handleCanvasPointer`), which is what the
   * actions work from. The point is hit-tested with the same tolerance the click
   * path uses: a door under the pointer is selected and recorded on the menu, so
   * the rows offer Duplicate/Delete on *that* door; empty space clears the
   * selection and leaves only "Add door" with its type submenu (spec §5.4). The
   * menu is placed with `popoverPosition` so it flips and clamps to stay on
   * screen (spec §5.6), then converted from viewport to container coordinates for
   * the absolutely-positioned element.
   */
  const openMenu = useCallback(
    (clientPoint: Point) => {
      const planPoint = stageRef.current?.getRelativePointerPosition?.();
      if (!planPoint) return;
      // Same priority as a plain click: a door first, then an option, then
      // nothing. `hitId` records whichever was hit; the menu rows are chosen
      // from the selection kind below.
      const openingHit = openingAtPlanPoint(geometry, planPoint);
      const optionHit = openingHit === null ? optionAtPlanPoint(geometry, planPoint) : null;
      if (openingHit !== null) {
        select({ kind: 'opening', id: openingHit.id });
      } else if (optionHit !== null) {
        select({ kind: 'option', id: optionHit.id });
      } else {
        select({ kind: 'none' });
      }

      const viewport = {
        width: typeof window === 'undefined' ? MENU_WIDTH : window.innerWidth,
        height: typeof window === 'undefined' ? MENU_HEIGHT : window.innerHeight,
      };
      const placed = popoverPosition(
        clientPoint,
        { width: MENU_WIDTH, height: MENU_HEIGHT },
        viewport,
        0,
      );
      const rect = containerRef.current?.getBoundingClientRect();
      setMenu({
        x: rect ? placed.x - rect.left : placed.x,
        y: rect ? placed.y - rect.top : placed.y,
        planPoint,
        hitId: openingHit?.id ?? optionHit?.id ?? null,
        kind: 'canvas',
      });
    },
    [geometry, select],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  /**
   * Open the type chooser from the floating Add button. It shares the menu
   * machinery with the right-click menu but lists the four opening types directly
   * (no "Add door" parent row) plus an "Add option" submenu (the eleven kinds,
   * placed at their legal defaults), and targets the plan point at the **centre
   * of the current view**, so the new object lands on the wall the user is
   * looking at.
   */
  const openAddMenu = useCallback(() => {
    if (scale <= 0) return;
    const planPoint = {
      x: (viewWidth / 2 - position.x) / scale,
      y: (viewHeight / 2 - position.y) / scale,
    };
    setMenu({ x: ADD_BUTTON_LEFT, y: ADD_BUTTON_TOP + ADD_BUTTON_SIZE + 4, planPoint, hitId: null, kind: 'add' });
  }, [scale, viewWidth, viewHeight, position.x, position.y]);

  /**
   * Open the selected door's actions (Duplicate / Delete) from the ⋮ button. This
   * is what keeps those actions reachable on touch now that the long press is
   * gone. The menu anchors beside the object; its actions work on the selected
   * door via `menuDoor` (set from `hitId`).
   */
  const openDoorMenu = useCallback(
    (clientX: number, clientY: number) => {
      if (selection.kind !== 'opening') return;
      const rect = containerRef.current?.getBoundingClientRect();
      const placed = popoverPosition(
        { x: clientX, y: clientY },
        { width: MENU_WIDTH, height: MENU_HEIGHT },
        { width: typeof window === 'undefined' ? MENU_WIDTH : window.innerWidth, height: typeof window === 'undefined' ? MENU_HEIGHT : window.innerHeight },
        0,
      );
      setMenu({
        x: rect ? placed.x - rect.left : placed.x,
        y: rect ? placed.y - rect.top : placed.y,
        planPoint: { x: 0, y: 0 },
        hitId: selection.id,
        kind: 'door',
      });
    },
    [selection],
  );

  /** The door the menu opened on, or `null` when it opened on empty space. */
  const menuDoor =
    menu !== null && menu.hitId !== null
      ? (config.openings.find((opening) => opening.id === menu.hitId) ?? null)
      : null;

  /** The option the menu opened on, or `null` when it opened on a door/empty space. */
  const menuOption =
    menu !== null && menu.hitId !== null
      ? (config.options.find((option) => option.id === menu.hitId) ?? null)
      : null;

  /**
   * Duplicate / Remove for an option; the same actions the tab's ⋮ offers.
   * Duplicate is dropped for a kind that spans its whole wall, where a copy
   * would land on top of the original and be invisible.
   */
  const optionRows: ContextMenuItem[] = [
    ...(menuOption !== null && !canDuplicate(menuOption)
      ? []
      : [{ id: 'option-duplicate', label: 'Duplicate', enabled: menuOption !== null }]),
    { id: 'option-delete', label: 'Remove', enabled: menuOption !== null },
  ];

  /**
   * The context menu's rows, derived from what the menu was opened on (spec
   * §5.4). `canvas` is the right-click menu: a door hit offers Duplicate/Delete
   * on that door (plus Delete all doors when any exist), a miss offers a single
   * Add door row whose submenu lists the four opening types. `add` (the floating
   * Add button) lists the four types directly. `door` (the selected door's ⋮
   * button) offers Duplicate/Delete — the actions the long press used to reach
   * on touch. Nothing is written to the store until a row is actually picked.
   */
  const doorRows: ContextMenuItem[] = [
    { id: 'duplicate', label: 'Duplicate', enabled: menuDoor !== null },
    { id: 'delete', label: 'Delete', enabled: menuDoor !== null },
    {
      id: 'delete-all',
      label: 'Delete all doors',
      enabled: config.openings.length > 0,
    },
  ];

  const typeRows: ContextMenuItem[] = OPENING_TYPE_OPTIONS.map(({ value, label }) => ({
    id: `${ADD_TYPE_PREFIX}${value}`,
    label,
    enabled: true,
  }));

  /**
   * The same four types, but arming add mode rather than dropping a door at the menu's
   * point. Kept beside `typeRows` so a new opening type appears in both lists without
   * anybody remembering to add it twice.
   */
  const placeTypeRows: ContextMenuItem[] = OPENING_TYPE_OPTIONS.map(({ value, label }) => ({
    id: `${PLACE_TYPE_PREFIX}${value}`,
    label: `Place ${label} on the plan`,
    enabled: true,
  }));

  /**
   * The eleven option kinds as menu rows. Derived from `OPTION_KIND_OPTIONS`, the
   * same catalogue the place-option buttons use, so the menu can never offer a
   * kind the panel does not, or vice versa.
   */
  const optionKindRows: ContextMenuItem[] = OPTION_KIND_OPTIONS.map(({ value, label }) => ({
    id: `${ADD_OPTION_PREFIX}${value}`,
    label,
    enabled: true,
  }));

  /**
   * The row that opens the option-kind chooser. Unlike a door, an option needs no
   * plan point: `addOption` places it at a legal default for the current shed
   * (`defaultOptionsFor`), which is where the desktop's per-category Add put it.
   */
  const addOptionRow: ContextMenuItem = {
    id: 'add-option',
    label: 'Add option',
    enabled: true,
    submenu: optionKindRows,
  };

  const menuItems: ContextMenuItem[] =
    menu === null
      ? []
      : menu.kind === 'add'
        ? [...placeTypeRows, addOptionRow]
        : menu.kind === 'door'
          ? doorRows
          : menuOption !== null
            ? optionRows
            : menu.hitId !== null
              ? doorRows
              : [
                  {
                    id: 'add',
                    label: 'Add door',
                    enabled: true,
                    // Rows come from the same list the popover's Type field uses
                    // (`OPENING_TYPE_OPTIONS`), so the menu and the editor cannot
                    // drift apart.
                    submenu: typeRows,
                  },
                  {
                    id: 'place',
                    label: 'Place on the plan',
                    enabled: true,
                    submenu: placeTypeRows,
                  },
                  addOptionRow,
                ];

  /**
   * Add a door of the chosen `type` on the wall nearest the plan point the menu
   * opened at, clamped by the same domain functions the drag uses — so a door
   * added from the menu lands exactly where a dragged one would (spec §5.4). The
   * size and sill come from the per-type defaults, and the same values feed the
   * clamp probe, so the probe can never drift from what is minted (a window is
   * 900×900 at sill 900, not a door-sized opening).
   */
  const addDoorAtMenuPoint = useCallback(
    (planPoint: Point, type: OpeningType) => {
      const size = DEFAULT_OPENING_BY_TYPE[type];
      const wall = nearestWall(config, planPoint);
      const rawU = planPointToWallU(config, wall, planPoint);
      // `constrainOpeningU` needs the opening's width, so clamp against a
      // throwaway opening carrying the very size `addOpening` is about to mint.
      const probe: Opening = {
        id: '',
        type,
        width: size.width,
        height: size.height,
        sill: size.sill,
        wall,
        align: 'custom',
        offset: null,
        swing: null,
        track: null,
      };
      addOpening({
        type,
        wall,
        align: 'custom',
        offset: constrainOpeningU(config, probe, rawU),
        width: size.width,
        height: size.height,
        sill: size.sill,
      });
    },
    [config, addOpening],
  );

  /**
   * Run the picked action against the plan point the menu opened at (spec §5.4).
   * `ContextMenu` calls `onClose` right after `onPick`, so every action closes
   * the menu without this handler doing it again. A parent row with a submenu
   * never reaches here: `ContextMenu` opens the submenu instead of picking.
   */
  const handleMenuPick = useCallback(
    (id: string) => {
      const menuPoint = menu?.planPoint ?? null;
      if (menuPoint === null) return;

      if (id.startsWith(ADD_TYPE_PREFIX)) {
        const type = id.slice(ADD_TYPE_PREFIX.length) as OpeningType;
        addDoorAtMenuPoint(menuPoint, type);
        return;
      }

      if (id.startsWith(PLACE_TYPE_PREFIX)) {
        // Arm add mode instead of adding at the menu's point: the operator chose a type,
        // so now they choose where, with the ghost showing whether it lands.
        setPlacing(id.slice(PLACE_TYPE_PREFIX.length) as OpeningType);
        setGhostAt(null);
        return;
      }

      if (id.startsWith(ADD_OPTION_PREFIX)) {
        // An option needs no plan point: it lands at its kind's legal default and
        // is dragged from there, exactly as the place-option buttons do it.
        const kind = id.slice(ADD_OPTION_PREFIX.length) as OptionKind;
        addOption(kind);
        return;
      }

      if (id === 'duplicate') {
        if (menuDoor === null) return;
        const startU = resolveOpeningPlacement(menuDoor, config).u;
        const offset = constrainOpeningU(config, menuDoor, startU + DUPLICATE_STEP_MM);
        // Drop the source id so the store mints a fresh one and selects it; copy
        // every other field, and force custom align so the offset actually lands
        // (a `center`/`left`/`right` align would ignore it).
        const { id: _sourceId, ...rest } = menuDoor;
        addOpening({ ...rest, align: 'custom', offset });
        return;
      }

      if (id === 'delete') {
        if (menuDoor === null) return;
        removeOpening(menuDoor.id);
        return;
      }

      if (id === 'delete-all') {
        if (config.openings.length === 0) return;
        if (typeof window !== 'undefined' && !window.confirm('Delete all doors?')) return;
        applyPartial({ openings: [] });
        return;
      }

      if (id === 'option-duplicate') {
        if (menuOption === null) return;
        duplicateOption(menuOption.id);
        return;
      }

      if (id === 'option-delete') {
        if (menuOption === null) return;
        removeOption(menuOption.id);
      }
    },
    [
      config,
      menu,
      menuDoor,
      menuOption,
      addDoorAtMenuPoint,
      addOpening,
      addOption,
      removeOpening,
      duplicateOption,
      removeOption,
      applyPartial,
    ],
  );

  const handleContextMenu = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      // Suppress the browser's own context menu so ours is the only one shown.
      event.evt.preventDefault?.();
      openMenu({ x: event.evt.clientX, y: event.evt.clientY });
    },
    [openMenu],
  );

  useImperativeHandle(
    ref,
    () => ({
      exportPng: () => {
        const stage = stageRef.current;
        if (stage === null) return null;
        return stage.toDataURL({ pixelRatio: 2 });
      },
    }),
    [],
  );

  // The popover anchor: the selected object's plan point (spec §5.2, §5.6),
  // converted to **container-relative** pixels with the same transform
  // `PlanCanvas` gives the stage (`screen = position + plan * scale`; the stage
  // sits inside this container, so its translation is already container-relative
  // — no viewport→container subtraction is needed, unlike `openMenu`'s
  // viewport-space `clientPoint`). `undefined` when nothing is selected, which is
  // also when `SelectionPopover` renders nothing.
  const planAnchor = selectionAnchor(geometry, selection);
  const popoverAnchor =
    planAnchor === null
      ? undefined
      : { x: position.x + planAnchor.x * scale, y: position.y + planAnchor.y * scale };

  /**
   * The selected door's on-screen rect, in container pixels, and where its
   * affordance buttons (wrench + ⋮) belong. The buttons are pushed outward along
   * the wall's normal so they can never sit on the door: a door is a thin line
   * in plan, and a centre-anchored button overlaps any door wider than the
   * button — a press meant to start a drag would land on the button and do
   * nothing. `undefined` for a building/none selection, which show no buttons.
   */
  const affordances = useMemo(() => {
    if (selection.kind !== 'opening') return undefined;
    const opening = geometry.openings.find((o) => o.id === selection.id);
    if (opening === undefined) return undefined;
    const { rect } = opening;
    const door = {
      x: position.x + rect.x * scale,
      y: position.y + rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    };
    return { door, ...affordancePositions(door, opening.wall) };
  }, [selection, geometry, position.x, position.y, scale]);

  // The display-only drag overlay, derived per frame from the live clamped `u`
  // the drag bound func already carries. `null` when no drag is in flight (or the
  // door vanished mid-drag), so `PlanCanvas` draws nothing. No store read or
  // write happens here.
  const dragGuideOverlay = useMemo(() => {
    if (drag === null) return null;
    const opening = config.openings.find((o) => o.id === drag.id);
    return opening === undefined ? null : dragGuide(config, opening, drag.u);
  }, [config, drag]);

  return (
    <div ref={containerRef} className="plan-canvas relative" style={{ width: '100%', height: '100%' }}>
      <PlanCanvas
        geometry={geometry}
        width={viewWidth}
        height={viewHeight}
        scale={scale}
        position={position}
        selection={selection}
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onCanvasPointer={handleCanvasPointer}
        onCanvasMove={handleCanvasMove}
        onContextMenu={handleContextMenu}
        onResetView={resetView}
        onConstrainOpeningDrag={handleConstrainOpeningDrag}
        onOpeningDragEnd={handleOpeningDragEnd}
        onConstrainOptionDrag={handleConstrainOptionDrag}
        onOptionDragEnd={handleOptionDragEnd}
        optionDrag={optionDrag}
        openingDrag={drag}
        dragGuide={dragGuideOverlay}
        doorGhost={doorGhost}
        stageRef={stageRef}
      />
      {/* The wrench affordance: shown whenever something is selected but its
          editor is closed. Selecting an object only raises this button; the
          editor opens when it is clicked, so the plan is never covered the
          moment a door is tapped (spec: "selection shows an affordance, the
          editor opens on demand"). A selected door's buttons sit *outside* the
          door (see `affordancePositions`) so they never swallow a drag; the
          building has no such button placement, so it falls back to the popover
          anchor. */}
      {selection.kind !== 'none' && !editorOpen && (affordances !== undefined || popoverAnchor !== undefined) && (
        <button
          type="button"
          aria-label="Edit selected object"
          onClick={() => setEditorOpen(true)}
          className="absolute z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-lg hover:bg-slate-50"
          style={(() => {
            if (affordances !== undefined) {
              return { left: affordances.wrench.x, top: affordances.wrench.y };
            }
            const viewport = {
              width: typeof window === 'undefined' ? FALLBACK_WIDTH : window.innerWidth,
              height: typeof window === 'undefined' ? FALLBACK_HEIGHT : window.innerHeight,
            };
            const { x, y } = popoverPosition(popoverAnchor!, { width: 44, height: 44 }, viewport);
            return { left: x, top: y };
          })()}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3z" />
            <path d="M14.7 6.3 18 3l3 3-3.3 3.3" />
          </svg>
        </button>
      )}
      {/* The popover hides while a door is being dragged (spec §5.3), so it
          cannot cover the wall the user is dragging along. Its anchor is the
          selected object's screen position, so it sits beside what is edited.
          Desktop only: on mobile the bottom-sheet editor in `ControlSheet`
          edits the selected object instead. Gated on `editorOpen` so it appears
          only once the wrench has been clicked. */}
      {isDesktop && editorOpen && drag === null && <SelectionPopover anchor={popoverAnchor} />}
      {/* The context menu: opened by a right-click, the floating Add button, or
          the selected door's ⋮ button. It closes itself on Escape / outside
          click and after any pick (spec §5.4). */}
      {menu !== null && (
        <ContextMenu
          items={menuItems}
          onPick={handleMenuPick}
          onClose={closeMenu}
          position={{ x: menu.x, y: menu.y }}
        />
      )}
      {/* The ⋮ actions button: shown beside the wrench when a door is selected,
          so Duplicate/Delete stay reachable on touch (the long press that used
          to open them is gone). Opens the `door` menu. */}
      {affordances !== undefined && !editorOpen && (
        <button
          type="button"
          aria-label="Door actions"
          onClick={(event) => openDoorMenu(event.clientX, event.clientY)}
          className="absolute z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-lg hover:bg-slate-50"
          style={{ left: affordances.dots.x, top: affordances.dots.y }}
        >
          <span aria-hidden="true" className="text-lg leading-none">⋮</span>
        </button>
      )}
      {/* The floating Add button: replaces the long-press-to-add gesture. It
          opens the four-door-type chooser plus an Add-option submenu, and drops a
          new door on the wall at the centre of the current view. Always visible so
          adding an object is a one-tap action on both desktop and touch. */}
      <button
        type="button"
        aria-label="Add a door or option on the plan"
        onClick={openAddMenu}
        className="absolute z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-lg hover:bg-slate-50"
        style={{ left: ADD_BUTTON_LEFT, top: ADD_BUTTON_TOP }}
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        onClick={resetView}
        className="reset-view absolute right-2 top-2 rounded-md border border-slate-300 bg-white/90 px-2 py-1 text-xs text-slate-700 shadow-sm"
      >
        Reset view
      </button>

      {/*
        Add mode's banner. A canvas mode with no visible sign is a canvas that appears to
        have stopped responding to clicks, so the mode states itself and carries its own
        exit. It sits at the bottom so it cannot cover the wall under the pointer.
      */}
      {placing !== null && (
        <div
          role="status"
          className="absolute inset-x-2 bottom-2 z-20 flex flex-wrap items-center gap-2 rounded-md border border-teal-700/30 bg-white/95 px-3 py-2 text-xs text-slate-800 shadow-lg"
        >
          <span className="font-medium">
            Click the plan to place a {placing.replace('_', ' ')}.
          </span>
          <span className="text-slate-500">
            The wall nearest the pointer is used, and the same rules as the form apply.
          </span>
          <button
            type="button"
            onClick={() => {
              setPlacing(null);
              setGhostAt(null);
            }}
            className="ml-auto rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
});
