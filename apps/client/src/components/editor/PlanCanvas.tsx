'use client';

/**
 * The 2D plan canvas — a `react-konva` `Stage` that draws one shed plan.
 *
 * This component is presentation only. Every coordinate it draws comes from the
 * `PlanGeometry` built by `src/domain/plan.ts`; it performs no domain maths and
 * reads no store. Its job is to map that plain data onto Konva nodes and to
 * report raw pointer interactions (wheel, drag, pinch) back to its parent.
 *
 * Drawing order, bottom to top (spec §7.1): grid → outline → bay lines → options
 * → roof arrow → openings → dimensions → selection overlay. Options sit under the
 * openings so a door drawn on a wall stays on top of an awning or outrigger that
 * happens to overlap it.
 *
 * Units: the stage is scaled so that one Konva unit is one millimetre. The
 * parent passes `scale` (pixels per millimetre) and a pixel `position`; stroke
 * and font sizes are divided by `scale` so they stay constant on screen.
 */

import React from 'react';
import { Arc, Arrow, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { OpeningSymbol, PlanDimension, PlanGeometry, PlacedOption } from '@sq/core/domain';
import { openingGrabRect, type DragGuide } from '@sq/core/domain';
import type { Selection } from '@sq/core/domain';

/** Padding around a selected opening's rect for its amber selection ring, mm. */
const SELECT_PAD_MM = 180;
/** Dimension arrowhead, in on-screen pixels (divided by scale when drawn). */
const ARROW_PX = 9;
const ARROW_WIDTH_PX = 7;
/** Grid spacing, mm. */
const GRID_STEP = 1000;
/** Padding added around the outline for the selection frame, mm. */
const SELECT_PAD = 150;

const OUTLINE_COLOR = '#1f2933';
const GRID_COLOR = '#e2e6ea';
const BAY_COLOR = '#b6bec7';
const DIM_COLOR = '#52606d';
/** Roof orientation arrow — the blue technical-drawing accent. */
export const ROOF_COLOR = '#2b6cb0';
const OPENING_COLOR = '#3e4c59';
/** Roller-door side tracks — the desktop app's track grey. */
const TRACK_COLOR = '#808080';
/** Active-selection overlay (spec §5.4: amber, distinct from the roof blue). */
export const SELECT_COLOR = '#d97706';
/** Live drag guide line + readout — a teal distinct from the dimension grey and
 * the selection amber, so it reads as transient feedback rather than geometry. */
export const GUIDE_COLOR = '#0e7490';

/**
 * The stroke colour of each option role. Roof fixtures share the roof-direction
 * blue, concealed structure is a neutral dark grey, and exterior projections a
 * mid grey — so the three families are distinguishable at a glance.
 */
export const OPTION_ROLE_COLOR: Record<PlacedOption['role'], string> = {
  roof: ROOF_COLOR,
  structure: '#4a5568',
  exterior: '#718096',
};

/** Extra (non-Konva) attribute placed on each per-opening group. */
type OpeningGroupProps = React.ComponentProps<typeof Group> & { 'data-opening'?: string };
const OpeningGroup = Group as unknown as React.ComponentType<OpeningGroupProps>;

/** Extra (non-Konva) attribute placed on each per-option group. */
type OptionGroupProps = React.ComponentProps<typeof Group> & { 'data-option'?: string };
const OptionGroup = Group as unknown as React.ComponentType<OptionGroupProps>;

export interface PlanCanvasProps {
  geometry: PlanGeometry;
  /** Stage width in CSS pixels. */
  width: number;
  /** Stage height in CSS pixels. */
  height: number;
  /** Pixels per millimetre (already includes the fit-to-container factor). */
  scale: number;
  /** Stage translation in pixels. */
  position: { x: number; y: number };
  /** What is currently selected; drives the amber selection ring. */
  selection: Selection;
  onWheel: (event: Konva.KonvaEventObject<WheelEvent>) => void;
  onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onTouchMove: (event: Konva.KonvaEventObject<TouchEvent>) => void;
  onTouchEnd?: (event: Konva.KonvaEventObject<TouchEvent>) => void;
  /**
   * A raw click/tap on the stage, reported verbatim. The parent converts it to
   * plan millimetres and hit-tests it: hit-testing and the pointer→mm transform
   * are the parent's job, so this component stays free of domain maths.
   */
  onCanvasPointer?: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  /**
   * A raw context-menu event (right-click on desktop, or the browser's own
   * long-press menu) on the stage, reported verbatim. The parent reads the
   * pointer's client position for menu placement and the stage-local plan point
   * for hit-testing, so this component computes no coordinates of its own.
   */
  onContextMenu?: (event: Konva.KonvaEventObject<PointerEvent>) => void;
  /** Restore the initial fit; fired by a double-tap/double-click (spec §5.3). */
  onResetView?: () => void;
  /**
   * Clamp a door being dragged, called by Konva's `dragBoundFunc` on every drag
   * frame. `pos` is the raw absolute (canvas-pixel) position Konva proposes; the
   * parent converts it to plan millimetres, clamps it, and returns the absolute
   * position Konva should use. This component performs no domain maths — it
   * forwards the raw position and returns whatever the parent gives back.
   */
  onConstrainOpeningDrag: (id: string, pos: { x: number; y: number }) => { x: number; y: number };
  /** A door drag ended; the parent commits it to the store exactly once. */
  onOpeningDragEnd: (id: string, event: Konva.KonvaEventObject<DragEvent>) => void;
  /**
   * Clamp an option being dragged, called by Konva's `dragBoundFunc` on every
   * frame. Same contract as `onConstrainOpeningDrag`: the parent converts the
   * proposed absolute position to plan millimetres, applies the kind's anchor
   * rule, and returns the position Konva should use.
   */
  onConstrainOptionDrag: (id: string, pos: { x: number; y: number }) => { x: number; y: number };
  /** An option drag ended; the parent commits it to the store exactly once. */
  onOptionDragEnd: (id: string, event: Konva.KonvaEventObject<DragEvent>) => void;
  /** The in-flight option drag, or `null`. Per-frame state, never a store write. */
  optionDrag?: { id: string; x: number; y: number } | null;
  /**
   * The in-flight drag, if any: which door, its clamped plan-mm offset from
   * rest, and the live clamped wall offset `u` (mm). While set, that group is
   * positioned at the offset so the door follows the pointer without a store
   * write; at rest every group sits at the origin. Only `id`/`x`/`y` are read
   * here — `u` is what `Render2D` turns into the `dragGuide` overlay.
   */
  openingDrag?: { id: string; x: number; y: number; u: number } | null;
  /**
   * The live drag overlay for the door being dragged, or `null`/absent when no
   * drag is in flight. Every coordinate comes from `src/domain/placement.ts`'s
   * `dragGuide`; this component only maps the line to a dashed `<Line>` and the
   * label to a `<Text>`, so it performs no domain maths of its own.
   */
  dragGuide?: DragGuide | null;
  stageRef?: React.Ref<Konva.Stage>;
}

/**
 * One dimension string: both extension lines, the dimension line with an arrow
 * at each end, and a centred label. Every coordinate is supplied by
 * `src/domain/plan.ts`; this component computes no offsets.
 */
function Dimension({ dim, scale }: { dim: PlanDimension; scale: number }) {
  const strokeWidth = 1.1 / scale;
  const fontSize = 13 / scale;
  const { dimStart, dimEnd, witnessStart, witnessEnd, textAt, label } = dim;
  // Konva takes a flat `[x0, y0, x1, y1]` array; the domain supplies points.
  const flat = (line: [{ x: number; y: number }, { x: number; y: number }]) => [
    line[0].x,
    line[0].y,
    line[1].x,
    line[1].y,
  ];

  return (
    <Group>
      <Line points={flat(witnessStart)} stroke={DIM_COLOR} strokeWidth={strokeWidth} />
      <Line points={flat(witnessEnd)} stroke={DIM_COLOR} strokeWidth={strokeWidth} />
      <Arrow
        points={[dimStart.x, dimStart.y, dimEnd.x, dimEnd.y]}
        stroke={DIM_COLOR}
        fill={DIM_COLOR}
        strokeWidth={strokeWidth}
        pointerLength={ARROW_PX / scale}
        pointerWidth={ARROW_WIDTH_PX / scale}
        pointerAtBeginning
        pointerAtEnding
      />
      <Text
        text={label}
        x={textAt.x}
        y={textAt.y}
        fontSize={fontSize}
        fill={DIM_COLOR}
        offsetX={(label.length * fontSize) / 2}
        offsetY={fontSize / 2}
      />
    </Group>
  );
}

/**
 * One opening's technical-drawing symbol. Every primitive comes from
 * `opening.symbol`, computed in `src/domain/plan.ts`; this maps `lines` to
 * `<Line>`, `rects` to `<Rect>` (filled or stroked), and `arc` to `<Arc>`, and
 * computes no geometry of its own.
 */
function OpeningSymbolMark({ symbol, scale }: { symbol: OpeningSymbol; scale: number }) {
  const strokeWidth = 1.4 / scale;
  return (
    <Group>
      {symbol.rects.map((rect, index) => (
        <Rect
          key={`rect-${index}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill={rect.filled ? OPENING_COLOR : undefined}
          stroke={rect.role === 'track' ? TRACK_COLOR : OPENING_COLOR}
          strokeWidth={strokeWidth}
        />
      ))}
      {symbol.lines.map((points, index) => (
        <Line key={`line-${index}`} points={points} stroke={OPENING_COLOR} strokeWidth={strokeWidth} />
      ))}
      {symbol.arc !== undefined && (
        <Arc
          x={symbol.arc.x}
          y={symbol.arc.y}
          innerRadius={0}
          outerRadius={symbol.arc.radius}
          angle={symbol.arc.sweep}
          rotation={symbol.arc.rotation}
          stroke={OPENING_COLOR}
          strokeWidth={1 / scale}
        />
      )}
    </Group>
  );
}

/**
 * One option's plan symbol. Every primitive comes from `option` (built in
 * `src/domain/plan.ts`); this maps `rect` to `<Rect>`, `lines` to `<Line>`, and
 * `triangle` to a closed `<Line>`, and computes no geometry of its own.
 */
function OptionSymbolMark({ option, scale }: { option: PlacedOption; scale: number }) {
  const strokeWidth = 1.3 / scale;
  const color = OPTION_ROLE_COLOR[option.role];
  const dash = option.dashed ? [300 / scale, 180 / scale] : undefined;
  const { rect } = option;

  return (
    <Group>
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        stroke={color}
        strokeWidth={strokeWidth}
        dash={dash}
      />
      {option.lines.map((points, index) => (
        <Line key={`line-${index}`} points={points} stroke={color} strokeWidth={strokeWidth} dash={dash} />
      ))}
      {option.triangle !== undefined && (
        <Line
          points={option.triangle.points.flatMap((point) => [point.x, point.y])}
          stroke={color}
          strokeWidth={strokeWidth}
          closed
        />
      )}
    </Group>
  );
}

/**
 * The live drag overlay: a dashed guide line along the wall from its `u = 0`
 * corner to the dragged opening, and the millimetre readout at its midpoint.
 * Both coordinates come from `dragGuide` in `src/domain/placement.ts`; this
 * maps them to Konva nodes and computes nothing itself.
 */
function DragGuideMark({ guide, scale }: { guide: DragGuide; scale: number }) {
  const s = scale > 0 ? scale : 1;
  const fontSize = 13 / s;
  return (
    <Group>
      <Line
        points={guide.line}
        stroke={GUIDE_COLOR}
        strokeWidth={1.4 / s}
        dash={[260 / s, 160 / s]}
      />
      <Text
        text={guide.label}
        x={guide.textAt.x}
        y={guide.textAt.y}
        fontSize={fontSize}
        fill={GUIDE_COLOR}
        offsetX={(guide.label.length * fontSize) / 2}
        offsetY={fontSize / 2}
      />
    </Group>
  );
}

export function PlanCanvas({
  geometry,
  width,
  height,
  scale,
  position,
  selection,
  onWheel,
  onDragEnd,
  onTouchMove,
  onTouchEnd,
  onCanvasPointer,
  onContextMenu,
  onResetView,
  onConstrainOpeningDrag,
  onOpeningDragEnd,
  onConstrainOptionDrag,
  onOptionDragEnd,
  optionDrag,
  openingDrag,
  dragGuide,
  stageRef,
}: PlanCanvasProps) {
  const { outline, bayLines, dims, roofArrow, openings, options } = geometry;
  const s = scale > 0 ? scale : 1;
  const hairline = 1 / s;

  const gridLines: number[][] = [];
  for (let x = outline.x; x <= outline.x + outline.width; x += GRID_STEP) {
    gridLines.push([x, outline.y, x, outline.y + outline.height]);
  }
  for (let y = outline.y; y <= outline.y + outline.height; y += GRID_STEP) {
    gridLines.push([outline.x, y, outline.x + outline.width, y]);
  }

  const selectedId = selection.kind === 'opening' ? selection.id : null;
  const selected = openings.find((opening) => opening.id === selectedId) ?? null;
  const selectedOptionId = selection.kind === 'option' ? selection.id : null;
  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? null;

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      scaleX={s}
      scaleY={s}
      x={position.x}
      y={position.y}
      draggable
      onWheel={onWheel}
      onDragEnd={onDragEnd}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={onCanvasPointer}
      onTap={onCanvasPointer}
      onDblClick={onResetView}
      onDblTap={onResetView}
      onContextMenu={onContextMenu}
    >
      <Layer listening={false}>
        {gridLines.map((points, index) => (
          <Line
            key={`grid-${index}`}
            points={points}
            stroke={GRID_COLOR}
            strokeWidth={hairline}
          />
        ))}
      </Layer>

      <Layer>
        <Rect
          x={outline.x}
          y={outline.y}
          width={outline.width}
          height={outline.height}
          stroke={OUTLINE_COLOR}
          strokeWidth={2 / s}
        />

        {bayLines.map((line, index) => (
          <Line
            key={`bay-${index}`}
            points={[line.x1, line.y1, line.x2, line.y2]}
            stroke={BAY_COLOR}
            strokeWidth={hairline}
            dash={[250 / s, 150 / s]}
          />
        ))}

        {options.map((option) => {
          const dragged =
            optionDrag !== null && optionDrag !== undefined && optionDrag.id === option.id
              ? optionDrag
              : null;
          // A gable infill has no position to drag: its end is its identity, and
          // the symbol fills a strip the user cannot move.
          const movable = option.kind !== 'gable_infill';
          return (
            <OptionGroup
              key={option.id}
              {...({ 'data-option': option.id } as Record<string, string>)}
              x={dragged ? dragged.x : 0}
              y={dragged ? dragged.y : 0}
              draggable={movable}
              dragBoundFunc={
                movable
                  ? (pos: { x: number; y: number }) => onConstrainOptionDrag(option.id, pos)
                  : undefined
              }
              onDragEnd={
                movable
                  ? (event: Konva.KonvaEventObject<DragEvent>) => onOptionDragEnd(option.id, event)
                  : undefined
              }
            >
              <OptionSymbolMark option={option} scale={s} />
              {/* An invisible grab area over the footprint, for the same reason a
                  door has one: Konva hit-tests drawn geometry, so a press inside
                  an outlined (hollow) rect would fall through to the Stage and pan
                  the camera instead of dragging the option. */}
              <Rect
                x={option.rect.x}
                y={option.rect.y}
                width={option.rect.width}
                height={option.rect.height}
                fill="transparent"
                listening
              />
            </OptionGroup>
          );
        })}

        <Line
          points={[roofArrow.x1, roofArrow.y1, roofArrow.x2, roofArrow.y2]}
          stroke={ROOF_COLOR}
          strokeWidth={1.6 / s}
        />

        {openings.map((opening) => {
          const dragged = openingDrag !== null && openingDrag !== undefined && openingDrag.id === opening.id ? openingDrag : null;
          return (
            <OpeningGroup
              key={opening.id}
              {...({ 'data-opening': opening.id } as Record<string, string>)}
              x={dragged ? dragged.x : 0}
              y={dragged ? dragged.y : 0}
              draggable
              dragBoundFunc={(pos: { x: number; y: number }) => onConstrainOpeningDrag(opening.id, pos)}
              onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => onOpeningDragEnd(opening.id, event)}
            >
              <OpeningSymbolMark symbol={opening.symbol} scale={s} />
              {/* An invisible grab area over the symbol's footprint. A wall
                  opening is a line segment in plan, so its symbol is thin
                  strokes with a hollow middle; Konva hit-tests drawn geometry,
                  so without this a press on the door's interior falls through to
                  the draggable Stage and pans the camera instead of dragging the
                  door. `fill` is required for Konva to draw the shape into its
                  hit canvas (the hit colour comes from the shape's key, not the
                  fill), and `listening` keeps it interactive. It is drawn after
                  the symbol so its hit key wins. */}
              {(() => {
                const grab = openingGrabRect(opening.rect);
                return (
                  <Rect
                    x={grab.x}
                    y={grab.y}
                    width={grab.width}
                    height={grab.height}
                    fill="transparent"
                    listening
                  />
                );
              })()}
            </OpeningGroup>
          );
        })}

        {dims.map((dim, index) => (
          <Dimension key={`dim-${index}`} dim={dim} scale={s} />
        ))}

        {/* The live drag overlay, above the geometry so it is never hidden by a
            symbol; only present while a drag is in flight. */}
        {dragGuide !== null && dragGuide !== undefined && (
          <DragGuideMark guide={dragGuide} scale={s} />
        )}
      </Layer>

      <Layer listening={false}>
        {/* The dashed footprint frame signals the *building* selection; it is
            drawn only then, so selecting the building changes the canvas. */}
        {selection.kind === 'building' && (
          <Rect
            x={outline.x - SELECT_PAD}
            y={outline.y - SELECT_PAD}
            width={outline.width + SELECT_PAD * 2}
            height={outline.height + SELECT_PAD * 2}
            stroke={SELECT_COLOR}
            strokeWidth={1.4 / s}
            dash={[300 / s, 200 / s]}
            opacity={0.5}
          />
        )}
        {selected !== null && (
          <Rect
            x={selected.rect.x - SELECT_PAD_MM}
            y={selected.rect.y - SELECT_PAD_MM}
            width={Math.max(selected.rect.width, SELECT_PAD_MM * 2) + SELECT_PAD_MM * 2}
            height={Math.max(selected.rect.height, SELECT_PAD_MM * 2) + SELECT_PAD_MM * 2}
            stroke={SELECT_COLOR}
            strokeWidth={2 / s}
          />
        )}
        {selectedOption !== null && (
          <Rect
            x={selectedOption.rect.x - SELECT_PAD_MM}
            y={selectedOption.rect.y - SELECT_PAD_MM}
            width={Math.max(selectedOption.rect.width, SELECT_PAD_MM * 2) + SELECT_PAD_MM * 2}
            height={Math.max(selectedOption.rect.height, SELECT_PAD_MM * 2) + SELECT_PAD_MM * 2}
            stroke={SELECT_COLOR}
            strokeWidth={2 / s}
          />
        )}
      </Layer>
    </Stage>
  );
}
