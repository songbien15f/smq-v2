'use client';

import { useEffect, useId, useState } from 'react';
import {
  addBay,
  guestLengthMm,
  removeBay,
  setBayWidth,
  setRoof,
  type GuestBuildingSpec,
  type GuestBuildingTypeSpec,
  type GuestCladding,
  type GuestDesignInput,
  type GuestDesignIssue,
  type GuestKneeBrace,
  type GuestOpeningKind,
  type GuestRange,
  type GuestRoof,
  type GuestSlab,
  type WallSide,
} from '@sq/core/domain';
import {
  OPENING_NAMES,
  OPENING_SHORT,
  WALLS,
  WALL_NAMES,
  addOpening,
  countOf,
  metresLabel,
  positionOf,
  positionOpening,
  refitOpenings,
  removeLastOf,
  removeOpening,
  ruleFor,
  setMotorised,
  setOpeningSize,
  setOpeningWall,
  sizeLabel,
  type Fit,
  type Position,
} from '../designOps';
import { updateDesign } from '../store';
import type { ToolsGroupId } from '../panels';
import { IconLock, IconMinus, IconPlus, IconTrash } from './icons';
import { SwatchGrid } from './SwatchGrid';

/**
 * Tab ③'s controls (plan G-a S6, spec ③ "Khối điều khiển"): **one group at a time**, as a tab set.
 *
 * ## Why not an accordion
 *
 * It was three `<details>` with one open, which left three headings stacked above each other and made the
 * card look like a form twice its height. The client asked for the panel to show one group; a tab set is
 * also what a screen reader expects when the rail beside it is a strip of choices (2026-11-25).
 *
 * ## One store field
 *
 * The selected group is `panels.ts`' `group`, so the rail (`role="tablist"`, desktop/tablet) and the
 * drawer's word tabs (phone) drive the same state and cannot disagree. Every group's panel stays in the
 * DOM with `hidden` on the others: focus and `focusSelector` need to *find* a control that belongs to a
 * tab that is not showing (select it, then focus), and `hidden` still keeps it out of the tab order.
 *
 * Every size the guest can reach is inside the building type's limits — the slider cannot leave them
 * and the number box clamps on blur — and every door position is one core's `placeOpening` accepts
 * (`designOps`). A group the type switches off stays selectable, locked, with the admin's reason.
 * Extras (group 4) is slice G-h.
 */

/** The three groups, in the order the card and both tab strips show them. */
export const GROUP_TABS = [
  { id: 'g-group-size', title: 'Size & structure', short: 'Size', name: 'Size and structure' },
  { id: 'g-group-colours', title: 'Colours — Colorbond®', short: 'Colours', name: 'Colours' },
  { id: 'g-group-doors', title: 'Doors & windows', short: 'Doors', name: 'Doors and windows' },
] as const;

/** The panel id for a group (`g-group-size` → `g-tools-panel-size`). */
export function panelIdFor(groupId: ToolsGroupId): string {
  return groupId.replace('g-group-', 'g-tools-panel-');
}

/** Which group a `validateGuestDesign` path belongs to. */
export function groupForIssuePath(path: string): ToolsGroupId {
  if (path.startsWith('colours.')) return 'g-group-colours';
  if (path.startsWith('openings')) return 'g-group-doors';
  return 'g-group-size';
}

export function ControlAccordion({
  design,
  type,
  issues,
  group,
}: {
  design: GuestDesignInput;
  type: GuestBuildingTypeSpec;
  issues: readonly GuestDesignIssue[];
  group: ToolsGroupId;
}) {
  const buildIssues = issues.filter((i) => i.path.startsWith('building.'));
  const openingIssues = issues.filter((i) => i.path.startsWith('openings'));
  const colourIssues = issues.filter((i) => i.path.startsWith('colours.'));
  const locked = type.config.openings.rules.length === 0;
  const panels: Record<ToolsGroupId, React.ReactNode> = {
    'g-group-size': (
      <>
        <SizeControls design={design} type={type} />
        <IssueList issues={buildIssues} />
      </>
    ),
    'g-group-colours': (
      <>
        <SwatchGrid colours={design.colours} allowed={type.config.colours.allowed} />
        <IssueList issues={colourIssues} />
      </>
    ),
    'g-group-doors': locked ? (
      <>
        <p className="g-locked">
          <IconLock />
          {type.config.openings.lockedReason ?? 'This building type takes no doors or windows.'}
        </p>
        <IssueList issues={openingIssues} />
      </>
    ) : (
      <>
        <OpeningControls design={design} type={type} />
        <IssueList issues={openingIssues} />
      </>
    ),
  };

  return (
    <div className="g-single">
      {GROUP_TABS.map((tab) => (
        <div
          key={tab.id}
          id={panelIdFor(tab.id)}
          role="tabpanel"
          data-group={tab.id}
          aria-label={tab.title}
          hidden={group !== tab.id}
          className="g-group-body"
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}

function IssueList({ issues }: { issues: readonly GuestDesignIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="g-issues" role="status">
      {issues.map((issue) => (
        <li key={`${issue.path}:${issue.message}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- group 1: size & structure

function SizeControls({ design, type }: { design: GuestDesignInput; type: GuestBuildingTypeSpec }) {
  const { limits } = type.config;
  const { building } = design;
  /** Any change to the building re-fits the openings, so a door is never left hanging off a wall. */
  const setBuilding = (patch: Partial<GuestBuildingSpec>) =>
    updateDesign((d) => refitOpenings({ ...d, building: { ...d.building, ...patch } }, type));

  const pitches = limits.pitchesByRoof[building.roof] ?? [];

  return (
    <>
      <SizeField
        id="g-span"
        label="Width (span)"
        value={building.span}
        range={limits.span}
        onChange={(span) => setBuilding({ span })}
      />
      <SizeField
        id="g-height"
        label="Height (eave)"
        value={building.height}
        range={limits.height}
        onChange={(height) => setBuilding({ height })}
      />
      <Readout
        id="g-length"
        label="Length"
        value={metresLabel(guestLengthMm(building))}
        note={`sum of ${building.bayWidths.length} ${building.bayWidths.length === 1 ? 'bay' : 'bays'} — edit the bays below`}
        href="#g-bays"
      />

      <ChipRadios
        legend="Roof"
        name="g-roof"
        options={type.config.roofs.map((r) => ({ id: r, label: r === 'gable' ? 'Gable' : 'Skillion' }))}
        value={building.roof}
        onPick={(id) => updateDesign((d) => refitOpenings(setRoof(d, type, id as GuestRoof), type))}
      />
      {type.config.roofs.length === 1 ? <p className="g-hint">This building comes with a {building.roof} roof.</p> : null}

      <ChipRadios
        legend="Roof pitch"
        name="g-pitch"
        options={pitches.map((p) => ({ id: String(p), label: `${p}°` }))}
        value={String(building.pitchDeg)}
        onPick={(id) => setBuilding({ pitchDeg: Number(id) })}
      />
      {building.roof === 'skillion' && building.pitchDeg < 7.5 ? (
        <p className="g-hint">A 5° skillion is below the book&rsquo;s minimum — an estimator will confirm it.</p>
      ) : null}

      <ChipRadios
        legend="Slab connection"
        name="g-slab"
        options={SLAB_OPTIONS}
        value={building.slab}
        onPick={(id) => setBuilding({ slab: id as GuestSlab })}
      />
      <p className="g-hint">Footing Only is recorded for the estimator, who sets the footing on your quote.</p>

      <ChipRadios
        legend="Knee brace"
        name="g-knee"
        options={KNEE_OPTIONS}
        value={building.kneeBrace}
        onPick={(id) => setBuilding({ kneeBrace: id as GuestKneeBrace })}
      />
      <p className="g-hint">Final bracing is set by engineering.</p>

      <ChipRadios
        legend="Cladding"
        name="g-cladding"
        options={CLADDING_OPTIONS}
        value={building.cladding}
        onPick={(id) => setBuilding({ cladding: id as GuestCladding })}
      />

      <fieldset id="g-bays" className="g-chip-set g-bays">
        <legend className="g-chip-legend">Bay spacing</legend>
        <ul className="g-bay-list">
          {building.bayWidths.map((w, i) => (
            <li key={i} className="g-bay">
              <label className="g-label" htmlFor={`g-bay-${i}`}>
                Bay {i + 1}
              </label>
              <span className="g-size-box">
                <input
                  id={`g-bay-${i}`}
                  className="g-input g-size-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-describedby={`g-bay-${i}-note`}
                  defaultValue={(w / 1000).toFixed(2)}
                  key={`${i}-${w}`}
                  onBlur={(e) => {
                    const m = Number(e.target.value.replace(',', '.'));
                    if (!Number.isFinite(m) || m <= 0) {
                      e.target.value = (w / 1000).toFixed(2);
                      return;
                    }
                    const mm = Math.round((m * 1000) / 10) * 10;
                    if (mm === w) return;
                    updateDesign((d) => refitOpenings(setBayWidth(d, i, mm), type));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
                <span className="g-size-unit" aria-hidden="true">
                  m
                </span>
              </span>
              <span id={`g-bay-${i}-note`} className="g-hint">
                {w > 4000 ? 'Wider than the book — an estimator will confirm it.' : ''}
              </span>
              <button
                type="button"
                className="g-icon-btn"
                aria-label={`Remove bay ${i + 1}`}
                disabled={building.bayWidths.length <= limits.bays.min}
                onClick={() => updateDesign((d) => refitOpenings(removeBay(d, i), type))}
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="g-btn g-btn-outline"
          disabled={building.bayWidths.length >= limits.bays.max}
          onClick={() => updateDesign((d) => refitOpenings(addBay(d, type), type))}
        >
          <IconPlus />
          Add bay
        </button>
      </fieldset>
    </>
  );
}

const SLAB_OPTIONS = [
  { id: 'in_slab', label: 'In Slab' },
  { id: 'on_slab', label: 'On Slab' },
  { id: 'footing_only', label: 'Footing Only' },
];

const KNEE_OPTIONS = [
  { id: 'standard', label: 'Knee Brace' },
  { id: 'none_if_possible', label: 'No Knee Brace – If Possible' },
];

const CLADDING_OPTIONS = [
  { id: 'vertical', label: 'Vertical' },
  { id: 'horizontal', label: 'Horizontal' },
];

/** A read-only measurement, with a link to the group that changes it. */
function Readout({ id, label, value, note, href }: { id: string; label: string; value: string; note: string; href: string }) {
  return (
    <p id={id} className="g-readout">
      <span className="g-label">{label}</span>
      <span className="g-readout-value">
        {value}
        <span className="g-readout-note"> ({note})</span>
      </span>
      <a className="g-link-btn" href={href}>
        Edit bays
      </a>
    </p>
  );
}

const STEP_MM = 100;
const toMetres = (mm: number) => (mm / 1000).toFixed(1);

/**
 * A slider paired with a number box (spec: a slider alone is too coarse on a phone). Metres in the
 * box, millimetres in the design, 0.1 m steps. The box commits while what is typed is inside the
 * range, and clamps on blur or Enter; past the top it says where a bigger building goes.
 */
function SizeField({
  id,
  label,
  value,
  range,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  range: GuestRange;
  onChange: (mm: number) => void;
}) {
  const [text, setText] = useState(toMetres(value));
  const [out, setOut] = useState<'above' | 'below' | null>(null);
  const labelId = `${id}-label`;
  const noteId = `${id}-note`;

  // The design changed elsewhere (the slider, a type switch): show it, unless the box holds the same value.
  useEffect(() => {
    setText((t) => (Math.round(Number(t) * 1000) === value ? t : toMetres(value)));
  }, [value]);

  const parse = (t: string): number | null => {
    const n = Number(t.replace(',', '.'));
    return t.trim() === '' || !Number.isFinite(n) ? null : Math.round((n * 1000) / STEP_MM) * STEP_MM;
  };

  const commit = () => {
    const mm = parse(text);
    if (mm === null) {
      setText(toMetres(value));
      return;
    }
    const clamped = Math.min(Math.max(mm, range.min), range.max);
    setOut(mm > range.max ? 'above' : mm < range.min ? 'below' : null);
    setText(toMetres(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="g-control">
      <div className="g-size-head">
        <label id={labelId} className="g-label" htmlFor={id}>
          {label}
        </label>
        <span className="g-size-box">
          <input
            id={id}
            className="g-input g-size-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={noteId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const mm = parse(e.target.value);
              if (mm === null) return;
              if (mm > range.max) setOut('above');
              else if (mm < range.min) setOut(null);
              else {
                setOut(null);
                if (mm !== value) onChange(mm);
              }
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
          />
          <span className="g-size-unit" aria-hidden="true">
            m
          </span>
        </span>
      </div>
      <input
        className="g-range"
        type="range"
        aria-labelledby={labelId}
        aria-valuetext={`${toMetres(value)} metres`}
        min={range.min}
        max={range.max}
        step={STEP_MM}
        value={Math.min(Math.max(value, range.min), range.max)}
        onChange={(e) => {
          setOut(null);
          onChange(Number(e.target.value));
        }}
      />
      <p id={noteId} className={out === null ? 'g-hint g-range-ends' : 'g-hint g-range-note'} aria-live="polite">
        {out === 'above' ? (
          <>Need something bigger? Add it to your notes when you send the request.</>
        ) : out === 'below' ? (
          <>The smallest this building comes in is {toMetres(range.min)} m.</>
        ) : (
          <>
            <span>{toMetres(range.min)} m</span>
            <span>{toMetres(range.max)} m</span>
          </>
        )}
      </p>
    </div>
  );
}

function Stepper({
  id,
  label,
  value,
  range,
  fewer,
  more,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  range: GuestRange;
  fewer: string;
  more: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="g-control g-stepper-row">
      <span id={`${id}-label`} className="g-label">
        {label}
      </span>
      <span className="g-stepper" role="group" aria-labelledby={`${id}-label`}>
        <button
          type="button"
          className="g-step-btn"
          aria-label={fewer}
          disabled={value <= range.min}
          onClick={() => onChange(value - 1)}
        >
          <IconMinus />
        </button>
        <output className="g-step-value" aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className="g-step-btn"
          aria-label={more}
          disabled={value >= range.max}
          onClick={() => onChange(value + 1)}
        >
          <IconPlus />
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- group 3: doors & windows

const POSITIONS: { id: Position; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'centre', label: 'Centre' },
  { id: 'right', label: 'Right' },
];

function OpeningControls({ design, type }: { design: GuestDesignInput; type: GuestBuildingTypeSpec }) {
  const [message, setMessage] = useState<string | null>(null);
  const apply = (fit: Fit) => {
    if (fit.ok) {
      updateDesign(() => fit.design);
      setMessage(null);
    } else {
      setMessage(fit.reason);
    }
  };
  const { rules } = type.config.openings;
  // A running number per kind, so two roller doors read "Roller door 1" and "Roller door 2".
  const seen = new Map<GuestOpeningKind, number>();

  return (
    <>
      <p className="g-hint">Add doors and windows here, then drag them along the walls on the plan.</p>
      <ul className="g-kinds">
        {rules.map((rule) => {
          const n = countOf(design, rule.type);
          const labelId = `g-kind-${rule.type}`;
          return (
            <li key={rule.type} className="g-kind">
              <span id={labelId} className="g-kind-name">
                {OPENING_NAMES[rule.type]}
                <span className="g-kind-max">up to {rule.max}</span>
              </span>
              <span className="g-stepper" role="group" aria-labelledby={labelId}>
                <button
                  type="button"
                  className="g-step-btn"
                  aria-label={`Remove a ${OPENING_SHORT[rule.type].toLowerCase()}`}
                  disabled={n === 0}
                  onClick={() => {
                    updateDesign((d) => removeLastOf(d, rule.type));
                    setMessage(null);
                  }}
                >
                  <IconMinus />
                </button>
                <output className="g-step-value" aria-live="polite">
                  {n}
                </output>
                <button
                  type="button"
                  className="g-step-btn"
                  aria-label={`Add a ${OPENING_SHORT[rule.type].toLowerCase()}`}
                  disabled={n >= rule.max}
                  onClick={() => apply(addOpening(design, type, rule.type))}
                >
                  <IconPlus />
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {message === null ? null : (
        <p className="g-field-error" role="alert">
          {message}
        </p>
      )}

      {design.openings.length === 0 ? null : (
        <ol className="g-openings">
          {design.openings.map((o, i) => {
            const k = (seen.get(o.type) ?? 0) + 1;
            seen.set(o.type, k);
            const rule = ruleFor(type, o.type);
            const name = `${OPENING_SHORT[o.type]} ${k}`;
            const at = positionOf(design, type, i);
            return (
              <li key={`${o.type}-${i}`} className="g-opening">
                <div className="g-opening-head">
                  <span className="g-opening-name">{name}</span>
                  <span className="g-opening-size">{sizeLabel(o.size)}</span>
                  <button
                    type="button"
                    className="g-icon-btn"
                    aria-label={`Remove ${name}`}
                    onClick={() => {
                      updateDesign((d) => removeOpening(d, i));
                      setMessage(null);
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>

                {rule !== undefined && rule.sizes.length > 1 ? (
                  <ChipRadios
                    legend="Size"
                    name={`g-size-${i}`}
                    options={rule.sizes.map((s) => ({ id: `${s.width}x${s.height}`, label: sizeLabel(s) }))}
                    value={`${o.size.width}x${o.size.height}`}
                    onPick={(id) => {
                      const s = rule.sizes.find((x) => `${x.width}x${x.height}` === id);
                      if (s !== undefined) apply(setOpeningSize(design, type, i, s));
                    }}
                    ownerName={name}
                  />
                ) : null}

                <ChipRadios
                  legend="Wall"
                  name={`g-wall-${i}`}
                  options={WALLS.map((w) => ({ id: w, label: WALL_NAMES[w] }))}
                  value={o.wall}
                  onPick={(w) => apply(setOpeningWall(design, type, i, w as WallSide))}
                  ownerName={name}
                />

                <fieldset className="g-chip-set">
                  <legend className="g-chip-legend">
                    Position <span className="g-sr-only">of {name}</span>
                  </legend>
                  <div className="g-chips">
                    {POSITIONS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="g-chip"
                        aria-pressed={at === p.id}
                        onClick={() => apply(positionOpening(design, type, i, p.id))}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {o.type === 'roller_door' ? (
                  <label className="g-switch">
                    <input
                      type="checkbox"
                      className="g-switch-input"
                      checked={o.motorised === true}
                      onChange={(e) => updateDesign((d) => setMotorised(d, i, e.target.checked))}
                    />
                    <span className="g-switch-track" aria-hidden="true" />
                    <span>
                      Motorised <span className="g-sr-only">{name}</span>
                    </span>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/** A row of chips that behave as radio buttons (arrow keys move the choice, as native radios do). */
export function ChipRadios({
  legend,
  name,
  options,
  value,
  onPick,
  ownerName,
}: {
  legend: string;
  name: string;
  options: { id: string; label: string }[];
  value: string;
  onPick: (id: string) => void;
  ownerName?: string;
}) {
  const uid = useId();
  return (
    /*
     * `id` is the group's stable name (`g-roof`, `g-pitch`, …) and the only way to address a chip by
     * selector: the radios' own `name` carries `uid` so two groups never fight, which is also why
     * `input[name="g-roof"]` matched nothing. Every "Edit" link and Design-check finding points here.
     */
    <fieldset id={name} data-chip-group={name} className="g-chip-set">
      <legend className="g-chip-legend">
        {legend}
        {ownerName === undefined ? null : <span className="g-sr-only"> of {ownerName}</span>}
      </legend>
      <div className="g-chips">
        {options.map((option) => (
          <label key={option.id} className="g-chip">
            <input
              type="radio"
              name={`${name}-${uid}`}
              className="g-chip-input"
              checked={option.id === value}
              onChange={() => onPick(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
