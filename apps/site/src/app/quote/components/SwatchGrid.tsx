'use client';

import { useId, useState } from 'react';
import { COLORBOND, type GuestColourChoice } from '@sq/core/domain';
import { updateDesign } from '../store';
import { IconCheck } from './icons';

/**
 * Colour choice for tab ③ (plan G-a S6, spec ③ group 2). The guest picks a part, then a swatch.
 *
 * - Parts: Walls / Roof / Trim. "Choose trim parts separately" splits Trim into barge, gutter and
 *   downpipe; while it is off, a Trim pick paints all three.
 * - Swatches are native radios (arrow keys move the choice), 40px, the name written under each,
 *   and the selected one carries a check as well as a border, so colour is never the only signal.
 * - Only the names the building type allows *and* the palette knows are offered (`allowed ∩
 *   COLORBOND`). The unpainted finishes (galvanised, zinc) are a group of their own.
 */

type Part = 'walls' | 'roof' | 'trim' | 'barge' | 'gutter' | 'downpipe';

const PART_NAMES: Record<Part, string> = {
  walls: 'Walls',
  roof: 'Roof',
  trim: 'Trim',
  barge: 'Barge',
  gutter: 'Gutter',
  downpipe: 'Downpipe',
};

const UNPAINTED = new Set(['Z450 Galv', 'Z600 Galv', 'Zinc']);

function colourOf(colours: GuestColourChoice, part: Part): string {
  switch (part) {
    case 'walls':
      return colours.walls;
    case 'roof':
      return colours.roof;
    case 'trim':
    case 'barge':
      return colours.trim.barge;
    case 'gutter':
      return colours.trim.gutter;
    case 'downpipe':
      return colours.trim.downpipe;
  }
}

function withColour(colours: GuestColourChoice, part: Part, name: string): GuestColourChoice {
  switch (part) {
    case 'walls':
      return { ...colours, walls: name };
    case 'roof':
      return { ...colours, roof: name };
    case 'trim':
      return { ...colours, trim: { barge: name, gutter: name, downpipe: name } };
    default:
      return { ...colours, trim: { ...colours.trim, [part]: name } };
  }
}

export function SwatchGrid({ colours, allowed }: { colours: GuestColourChoice; allowed: readonly string[] }) {
  const { barge, gutter, downpipe } = colours.trim;
  const [separate, setSeparate] = useState(barge !== gutter || barge !== downpipe);
  const [part, setPart] = useState<Part>('walls');
  const uid = useId();

  const parts: Part[] = separate ? ['walls', 'roof', 'barge', 'gutter', 'downpipe'] : ['walls', 'roof', 'trim'];
  // A part that the toggle just removed falls back to its neighbour.
  const shown: Part = parts.includes(part) ? part : separate ? 'barge' : 'trim';
  const current = colourOf(colours, shown);

  const names = allowed.filter((n) => COLORBOND[n] !== undefined);
  const painted = names.filter((n) => !UNPAINTED.has(n));
  const unpainted = names.filter((n) => UNPAINTED.has(n));

  const pick = (name: string) => updateDesign((d) => ({ ...d, colours: withColour(d.colours, shown, name) }));

  const grid = (list: string[], heading: string) =>
    list.length === 0 ? null : (
      <fieldset className="g-swatch-set">
        <legend className="g-chip-legend">
          {heading} <span className="g-sr-only">for the {PART_NAMES[shown].toLowerCase()}</span>
        </legend>
        <div className="g-swatches">
          {list.map((name) => {
            const selected = name === current;
            return (
              <label key={name} className="g-swatch" data-selected={selected || undefined}>
                <input
                  type="radio"
                  name={`g-swatch-${uid}`}
                  className="g-swatch-input"
                  aria-label={name}
                  checked={selected}
                  onChange={() => pick(name)}
                />
                <span className="g-swatch-chip" style={{ backgroundColor: COLORBOND[name] }} aria-hidden="true">
                  {selected ? <IconCheck className="g-swatch-check" /> : null}
                </span>
                <span className="g-swatch-name" aria-hidden="true">
                  {name}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );

  return (
    <div className="g-colours">
      <fieldset className="g-chip-set">
        <legend className="g-chip-legend">Part</legend>
        <div className="g-chips">
          {parts.map((p) => (
            <label key={p} className="g-chip g-chip-part">
              <input
                type="radio"
                name={`g-part-${uid}`}
                className="g-chip-input"
                checked={p === shown}
                onChange={() => setPart(p)}
              />
              <span className="g-chip-dot" style={{ backgroundColor: COLORBOND[colourOf(colours, p)] ?? 'transparent' }} aria-hidden="true" />
              <span>{PART_NAMES[p]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="g-switch">
        <input
          type="checkbox"
          className="g-switch-input"
          checked={separate}
          onChange={(e) => {
            const on = e.target.checked;
            setSeparate(on);
            // Joining the trim back up paints it all in the barge colour, so what is shown is what is saved.
            if (!on) updateDesign((d) => ({ ...d, colours: withColour(d.colours, 'trim', d.colours.trim.barge) }));
          }}
        />
        <span className="g-switch-track" aria-hidden="true" />
        <span>Choose trim parts separately</span>
      </label>

      <p className="g-colour-current" aria-live="polite">
        {PART_NAMES[shown]}: <strong>{current}</strong>
      </p>

      {grid(painted, 'Colorbond® colours')}
      {grid(unpainted, 'Unpainted')}
    </div>
  );
}
