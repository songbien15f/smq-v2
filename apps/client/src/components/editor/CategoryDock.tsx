'use client';

/**
 * The Step 2 dock: one accordion per desktop category.
 *
 * Each row is a small parameter grid plus an **Add**. The Add runs the placement rules
 * in the store, so a door that cannot sit where the default puts it is either moved to
 * the position the rule prefers (the desktop's "GO WITH …") or refused with a sentence
 * in the notices — the operator never gets a door the factory would not build.
 *
 * Three rows are views over something that already exists rather than creators: a
 * track belongs to its sliding door, an extra charge is the charge table, and the
 * engineering fee is a cost-step field. Creating a second object for any of them would
 * be a second source of truth.
 */

import { useState } from 'react';
import type { AlignMode } from '@sq/core/domain';
import { Button, StatusPill } from '@sq/ui';
import { useCatalogue } from '@/hooks/useCatalogue';
import { useShedStore } from '@/store/useShedStore';
import { CATEGORY_DOCK, categoryCount, type DockCategory } from './categories';

/** A small labelled number input. */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-sq-1">
      <span className="text-sq-micro text-sq-ink">{label}</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-[38px] w-28 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body outline-none"
      />
    </label>
  );
}

export function CategoryDock() {
  const config = useShedStore((state) => state.config);
  const addOpening = useShedStore((state) => state.addOpening);
  const addOption = useShedStore((state) => state.addOption);
  const addMiscOption = useShedStore((state) => state.addMiscOption);
  const addCharge = useShedStore((state) => state.addCharge);
  const removeAllOpenings = useShedStore((state) => state.removeAllOpenings);
  const removeAllOptions = useShedStore((state) => state.removeAllOptions);
  const clearOptions = useShedStore((state) => state.clearOptions);
  const patchOpening = useShedStore((state) => state.patchOpening);
  const { catalogue } = useCatalogue();

  const [openId, setOpenId] = useState<string | null>('window');
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(2100);
  const [align, setAlign] = useState<AlignMode>('center');
  const [offset, setOffset] = useState(0);
  const [sill, setSill] = useState(1200);
  const [series, setSeries] = useState<'A' | 'AA' | 'B'>('B');
  const [windlock, setWindlock] = useState(false);
  const [prepOnly, setPrepOnly] = useState(false);
  const [miscName, setMiscName] = useState('');
  const [miscQty, setMiscQty] = useState(1);

  const slidingDoors = config.openings.filter((opening) => opening.type === 'sliding_door');

  const body = (category: DockCategory) => {
    if (category.kind === 'opening') {
      return (
        <div className="flex flex-col gap-sq-2">
          <div className="flex flex-wrap items-end gap-sq-2">
            <NumberField id={`add-${category.id}-width`} label="Width (mm)" value={width} min={300} max={12000} step={100} onChange={setWidth} />
            <NumberField id={`add-${category.id}-height`} label="Height (mm)" value={height} min={300} max={6000} step={100} onChange={setHeight} />
            {category.opening === 'window' && (
              <NumberField id={`add-${category.id}-sill`} label="FFL (mm)" value={sill} min={0} max={4000} step={50} onChange={setSill} />
            )}
            <label className="flex flex-col gap-sq-1">
              <span className="text-sq-micro text-sq-ink">Alignment</span>
              <select
                value={align}
                onChange={(event) => setAlign(event.target.value as AlignMode)}
                className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
              >
                <option value="center">Centre</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="custom">Custom distance</option>
              </select>
            </label>
            {align === 'custom' && (
              <NumberField id={`add-${category.id}-offset`} label="Distance (mm)" value={offset} min={0} max={50000} step={50} onChange={setOffset} />
            )}
            {category.opening === 'roller_door' && (
              <>
                <label className="flex flex-col gap-sq-1">
                  <span className="text-sq-micro text-sq-ink">Series</span>
                  <select
                    value={series}
                    onChange={(event) => setSeries(event.target.value as 'A' | 'AA' | 'B')}
                    className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
                  >
                    <option value="A">A</option>
                    <option value="AA">AA</option>
                    <option value="B">B</option>
                  </select>
                </label>
                <label className="flex min-h-[38px] cursor-pointer items-center gap-sq-2 text-sq-body">
                  <input
                    type="checkbox"
                    checked={windlock}
                    onChange={(event) => setWindlock(event.target.checked)}
                    className="h-4 w-4 accent-[var(--color-sq-brand)]"
                  />
                  Windlocks
                </label>
              </>
            )}
            <label className="flex min-h-[38px] cursor-pointer items-center gap-sq-2 text-sq-body">
              <input
                type="checkbox"
                checked={prepOnly}
                onChange={(event) => setPrepOnly(event.target.checked)}
                className="h-4 w-4 accent-[var(--color-sq-brand)]"
              />
              Opening Only
            </label>
            <Button
              variant="primary"
              onClick={() =>
                addOpening({
                  type: category.opening,
                  width,
                  height,
                  sill: category.opening === 'window' ? sill : 0,
                  align,
                  offset: align === 'custom' ? offset : null,
                  series: category.opening === 'roller_door' ? series : null,
                  windlock: category.opening === 'roller_door' ? windlock : false,
                  prepOnly,
                })
              }
            >
              Add {category.label}
            </Button>
          </div>
          <p className="text-sq-micro text-sq-ink-muted">
            Windlocks default on in wind regions C and D. Placement rules (100 mm margin,
            overlap, roller minimum) still apply to whatever is added here.
          </p>
        </div>
      );
    }

    if (category.kind === 'option') {
      if (category.option === 'misc_option') {
        const options = catalogue?.miscOptions ?? [];
        return (
          <div className="flex flex-col gap-sq-2">
            {options.length === 0 ? (
              <p className="text-sq-micro text-sq-ink-muted">
                No catalogue accessories loaded. Publish a price book to choose one.
              </p>
            ) : (
              <label className="flex flex-col gap-sq-1">
                <span className="text-sq-micro text-sq-ink">Catalogue item</span>
                <select
                  value={miscName}
                  onChange={(event) => setMiscName(event.target.value)}
                  className="min-h-[38px] w-full rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
                >
                  <option value="">Choose an item…</option>
                  {options.map((option) => (
                    <option key={option.name} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex flex-wrap items-end gap-sq-2">
              <NumberField id="add-misc-qty" label="Quantity" value={miscQty} min={1} max={999} step={1} onChange={setMiscQty} />
              <Button
                variant="primary"
                disabled={miscName === ''}
                onClick={() => {
                  const chosen = options.find((option) => option.name === miscName);
                  addMiscOption({ name: miscName, quantity: miscQty, unit: chosen?.unit ?? 'ea' });
                }}
              >
                Add item
              </Button>
            </div>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-sq-2">
          <Button variant="primary" onClick={() => addOption(category.option)}>
            Add {category.label}
          </Button>
          <span className="text-sq-micro text-sq-ink-muted">
            Placed at a legal default; drag it on the plan or edit it in the list below.
          </span>
        </div>
      );
    }

    switch (category.view) {
      case 'track':
        return slidingDoors.length === 0 ? (
          <p className="text-sq-micro text-sq-ink-muted">
            A track belongs to a sliding door. Add a sliding door first.
          </p>
        ) : (
          <ul className="flex flex-col gap-sq-1">
            {slidingDoors.map((door) => (
              <li key={door.id} className="flex items-center gap-sq-2 text-sq-body">
                <span className="min-w-0 flex-1 truncate">
                  {door.width} × {door.height} mm on the {door.wall} wall
                </span>
                <select
                  value={door.track ?? 'none'}
                  onChange={(event) =>
                    patchOpening(door.id, { track: event.target.value as 'none' | 'single' | 'double' })
                  }
                  className="min-h-9 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-micro"
                  aria-label="Track"
                >
                  <option value="none">No track</option>
                  <option value="single">Single</option>
                  <option value="double">Double</option>
                </select>
              </li>
            ))}
          </ul>
        );
      case 'charges':
        return (
          <div className="flex items-center gap-sq-2">
            <Button variant="primary" onClick={addCharge}>
              Add a charge
            </Button>
            <span className="text-sq-micro text-sq-ink-muted">
              Edited on the Cost step; added once to the contract, never through the margin.
            </span>
          </div>
        );
      case 'engineering':
        return (
          <div className="flex flex-col gap-sq-1">
            <p className="text-sq-micro text-sq-ink-muted">
              The engineering fee is a cost-step figure, added after the kit. Book forms:
            </p>
            <ul className="flex flex-wrap gap-sq-1">
              {(catalogue?.engineeringCharges ?? []).map((charge) => (
                <li key={charge.name} className="rounded-md border border-sq-line px-sq-2 py-1 text-sq-micro text-sq-ink">
                  {charge.name}
                </li>
              ))}
            </ul>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col">
      {config.options.length > 0 && (
        <div className="flex items-center justify-between gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2">
          <span className="text-sq-micro text-sq-ink-muted">
            {config.options.length} {config.options.length === 1 ? 'option' : 'options'} on the building
          </span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove all ${config.options.length} options?`)) clearOptions();
            }}
            className="min-h-9 cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium text-sq-danger transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            Remove all options
          </button>
        </div>
      )}
      {CATEGORY_DOCK.map((category) => {
        const count = categoryCount(config, category);
        const open = openId === category.id;
        const canRemoveAll = category.kind !== 'view' && count > 0;
        return (
          <section key={category.id} className="border-b border-sq-line last:border-0">
            <h4>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`dock-${category.id}`}
                onClick={() => setOpenId(open ? null : category.id)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-sq-2 px-sq-3 text-left transition-colors duration-sq-fast hover:bg-sq-ground/70"
              >
                <span className="flex-1 text-sq-body font-semibold text-sq-ink">{category.label}</span>
                {count > 0 && <StatusPill tone="ok" label={`${count}`} />}
              </button>
            </h4>
            {open && (
              <div id={`dock-${category.id}`} className="flex flex-col gap-sq-2 px-sq-3 pb-sq-3">
                <p className="text-sq-micro text-sq-ink-muted">{category.description}</p>
                {body(category)}
                {canRemoveAll && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Remove every ${category.label.toLowerCase()} from this building?`)) return;
                      if (category.kind === 'opening') removeAllOpenings(category.opening);
                      else if (category.kind === 'option') removeAllOptions(category.option);
                    }}
                    className="min-h-9 self-start cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium text-sq-danger transition-colors duration-sq-fast hover:bg-sq-ground"
                  >
                    Remove all {count}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
