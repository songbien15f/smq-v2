/**
 * The application state store.
 *
 * Every mutation of `config` routes through `normaliseShedConfig`, so a config
 * that arrives from the AI gateway, from a preset, or from a form field can
 * never put an invalid value into the store (spec §8.1). Undo/redo operates on
 * whole configs, capped at `HISTORY_LIMIT` entries so a long editing session
 * cannot grow without bound.
 *
 * This module lives outside `src/domain/` and is the only place in the state
 * layer that may import Zustand. It must not import React, Konva, or three.
 */

import { create } from 'zustand';
import { DEFAULT_OPENING_SIZE, DEFAULT_SHED } from '@sq/core/domain';
import { newCharge } from '@sq/core/domain';
import { defaultOptionsFor, normaliseOption, refusePlacement } from '@sq/core/domain';
import { clampNotices, normaliseShedConfig, placeOpening } from '@sq/core/domain';
import type { Selection } from '@sq/core/domain';
import type { Charge, Opening, OpeningType, OptionKind, ShedConfig, ShedOption } from '@sq/core/domain';

/** Which renderer the user is looking at. */
export type ViewMode = '2d' | '3d';

/** A short status-bar state describing the last operation's outcome. */
export interface Status {
  kind: 'idle' | 'working' | 'ok' | 'warn' | 'error';
  message?: string;
}

/** Options accepted by `applyConfig`. */
export interface ApplyConfigOptions {
  /**
   * When `true` (the default) the previous config is pushed onto `history` and
   * `future` is cleared, so the change is undoable. When `false` the config is
   * replaced in place without touching either stack.
   */
  recordHistory?: boolean;
}

/**
 * A fresh opening id. Formatting matches what the form always minted; the store
 * is now the single owner of the generator so the form and the canvas share one.
 * `normaliseShedConfig` still repairs a blank or duplicated id regardless, so a
 * fallback is only a nicety, not a correctness requirement.
 */
function newOpeningId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `op-${crypto.randomUUID()}`;
  }
  return `op-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** The default opening `addOpening` appends when none is supplied. */
function defaultOpening(id: string): Opening {
  return {
    id,
    type: 'pa_door',
    width: DEFAULT_OPENING_SIZE.width,
    height: DEFAULT_OPENING_SIZE.height,
    sill: 0,
    wall: 'front',
    align: 'center',
    offset: null,
    swing: null,
    track: null,
  };
}

/** The id prefix each option kind uses, so a duplicated copy keeps its kind's tag. */
const OPTION_ID_PREFIX: Record<OptionKind, string> = {
  skylight: 'sk',
  mezzanine: 'mz',
  awning: 'aw',
  outrigger: 'og',
  dividing_wall: 'dw',
  gable_infill: 'gi',
  stable: 'st',
  carry_beam: 'cb',
  horizontal_cladding: 'hc',
  overhang: 'oh',
  cantilever: 'cl',
  misc_option: 'mo',
};

/** A fresh option id carrying `kind`'s prefix. */
function freshOptionId(kind: OptionKind): string {
  const unique =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return `${OPTION_ID_PREFIX[kind]}-${unique}`;
}

/** The next corner clockwise, so a duplicated mezzanine lands somewhere else. */
const NEXT_CORNER: Record<string, 'front_left' | 'front_right' | 'back_right' | 'back_left'> = {
  front_left: 'front_right',
  front_right: 'back_right',
  back_right: 'back_left',
  back_left: 'front_left',
};

/**
 * Move an option to its next anchor, for a duplicate.
 *
 * A verbatim copy sits exactly under the original: the plan shows one object,
 * the hit-test picks the copy, and the user sees "Duplicate" do nothing. Each
 * kind steps one position along its own axis instead — the next bay, the next
 * corner, the other end — and falls back to the original anchor when it is
 * already at the last one, where `normaliseOption` clamps it back into range.
 */
function nudgeOption(option: ShedOption): ShedOption {
  switch (option.kind) {
    case 'skylight':
      return { ...option, alongBay: option.alongBay < 0.5 ? 0.75 : 0.25 };
    case 'mezzanine':
      return { ...option, corner: NEXT_CORNER[option.corner] };
    case 'awning':
      // Along the wall by one awning width, as a custom offset so it lands.
      return {
        ...option,
        align: 'custom',
        offset: (option.offset ?? 0) + option.width,
      };
    case 'outrigger':
      return { ...option, bay: option.bay + 1 };
    case 'dividing_wall':
      return { ...option, at: option.at + 1000 };
    case 'gable_infill':
      return { ...option, end: option.end === 'front' ? 'back' : 'front' };
    case 'stable':
      return { ...option, align: 'custom', offset: (option.offset ?? 0) + option.width };
    case 'carry_beam':
      return { ...option, beginBay: option.beginBay + 1 };
    case 'horizontal_cladding':
      return { ...option, from: option.from + 500, to: option.to + 500 };
    case 'overhang':
      return { ...option, depth: option.depth + 200 };
    case 'cantilever':
      return { ...option, bay: option.bay + 1 };
    case 'misc_option':
      // Nothing to nudge: the line has no position. A duplicate is simply another
      // line the operator can set a different quantity on.
      return option;
  }
}

export interface ShedState {
  config: ShedConfig;
  history: ShedConfig[];
  future: ShedConfig[];
  view: ViewMode;
  sheetOpen: boolean;
  status: Status;
  /**
   * What is selected on the 2D plan, shared by the canvas popover and the left
   * form so both read one selection. Kept out of `config` and out of history:
   * selecting is a view concern, never an undoable edit.
   */
  selection: Selection;
  /**
   * Whether the selection's **editor** is showing. Selecting an object only
   * raises an affordance (the wrench button); the editor itself — the floating
   * card on desktop, the bottom sheet on mobile — opens on demand so it does not
   * cover the plan the moment something is clicked.
   *
   * Kept separate from `selection` so the two can differ: the wrench shows when
   * something is selected but the editor is closed. Never true with nothing
   * selected — the invariant `editorOpen ⇒ selection ≠ none` is maintained by
   * `setEditorOpen` and by every path that clears the selection.
   */
  editorOpen: boolean;
  /**
   * Whether an object is being dragged on the plan right now.
   *
   * Purely a presentation flag: on a phone the drawer covers most of the screen,
   * so it collapses while a drag is in flight and comes back when it ends. It is
   * deliberately separate from `editorOpen` — the editor stays open across the
   * drag, and only the drawer's visibility changes.
   */
  objectDragging: boolean;
  /**
   * User-facing notes about values the normaliser had to clamp on the way in
   * (spec §8.2). Recorded at the normalisation boundary because the fact is
   * destroyed by normalisation — a clamped `bays: 30` is indistinguishable from
   * a user who asked for 30. Purely a report of the last input; nothing reads it
   * back into the config, so there is no loop.
   */
  notices: string[];
  applyConfig(next: unknown, opts?: ApplyConfigOptions): void;
  applyPartial(partial: Partial<ShedConfig>): void;
  select(selection: Selection): void;
  /** Open or close the selection editor; opening is a no-op with no selection. */
  setEditorOpen(open: boolean): void;
  patchOpening(id: string, patch: Partial<Opening>): void;
  addOpening(opening?: Partial<Opening>): void;
  removeOpening(id: string): void;
  /**
   * Add the instance(s) `kind` creates — one, or two for a gable infill — and
   * select the first. One history entry per call, so a single Undo removes the
   * whole gable infill.
   */
  addOption(kind: OptionKind): void;
  /** Add a catalogue accessory, priced by the book, at a chosen quantity. */
  addMiscOption(input: { name: string; quantity: number; unit: string }): void;
  /** Add a mezzanine at a chosen design floor load. */
  addMezzanine(floorLoad: 1.5 | 3 | 5 | 7.5): void;
  /** Remove every opening of one type. */
  removeAllOpenings(type: OpeningType): void;
  /** Remove every option of one kind. */
  removeAllOptions(kind: OptionKind): void;
  /** Remove every option, as the desktop's dock-level Remove All does. */
  clearOptions(): void;
  patchOption(id: string, patch: Partial<ShedOption>): void;
  removeOption(id: string): void;
  duplicateOption(id: string): void;
  /** Append an empty charge line; the Charges panel focuses its name input. */
  addCharge(): void;
  patchCharge(id: string, patch: Partial<Charge>): void;
  removeCharge(id: string): void;
  undo(): void;
  redo(): void;
  setView(view: ViewMode): void;
  setSheetOpen(open: boolean): void;
  setStatus(status: Status): void;
  /** Report whether an object drag is in flight (presentation only). */
  setObjectDragging(dragging: boolean): void;
}

/** Maximum number of undoable configs kept; the oldest are dropped first. */
export const HISTORY_LIMIT = 50;

/**
 * Resolve a selection against a config: an `opening` selection whose id is not
 * present collapses to `{ kind: 'none' }`. Building and none selections pass
 * through unchanged. Keeps the invariant that the store never holds a dangling
 * opening selection, so the popover and form need no stale-id special case.
 */
function resolveSelection(selection: Selection, config: ShedConfig): Selection {
  if (selection.kind === 'none' || selection.kind === 'building') return selection;
  if (selection.kind === 'opening') {
    return config.openings.some((opening) => opening.id === selection.id)
      ? selection
      : { kind: 'none' };
  }
  return config.options.some((option) => option.id === selection.id)
    ? selection
    : { kind: 'none' };
}

/**
 * Enforce the `editorOpen ⇒ selection ≠ none` invariant. Any path that installs
 * a selection also writes `editorOpen` through here, so the editor can never
 * stay open over an empty selection (which would leave an orphan card after the
 * user clicks empty canvas, undoes an add, or the AI drops the selected door).
 * When a real object is selected the flag passes through unchanged, so the
 * editor *follows* from one object to another rather than snapping shut.
 */
function withEditor(selection: Selection, editorOpen: boolean): boolean {
  return selection.kind === 'none' ? false : editorOpen;
}

/** The initial state, used both to create the store and as a reset target. */
const INITIAL_STATE = {
  config: DEFAULT_SHED,
  history: [] as ShedConfig[],
  future: [] as ShedConfig[],
  view: '2d' as ViewMode,
  sheetOpen: false,
  status: { kind: 'idle' } as Status,
  selection: { kind: 'none' } as Selection,
  editorOpen: false,
  objectDragging: false,
  notices: [] as string[],
};

export const useShedStore = create<ShedState>()((set, get) => ({
  ...INITIAL_STATE,

  applyConfig(next, opts) {
    const recordHistory = opts?.recordHistory ?? true;
    const config = normaliseShedConfig(next);
    // Capture clamp notes from the raw input now; normalisation has already
    // destroyed the evidence. Replacing (not appending) keeps them tied to the
    // most recent input, so a later in-range change clears a stale note.
    const notices = clampNotices(next);
    // A whole-config replace (the AI path) can drop a door that is selected.
    // Resolve the selection against the *new* config here, so the dangling case
    // is written in the same `set` as the config and never renders in between.
    const selection = resolveSelection(get().selection, config);

    if (!recordHistory) {
      set({ config, notices, selection, editorOpen: withEditor(selection, get().editorOpen) });
      return;
    }

    const { history } = get();
    // Push the *previous* config, then drop the oldest so the stack never
    // exceeds HISTORY_LIMIT. Clearing `future` discards any redo branch.
    const nextHistory = [...history, get().config].slice(-HISTORY_LIMIT);
    set({
      config,
      history: nextHistory,
      future: [],
      notices,
      selection,
      editorOpen: withEditor(selection, get().editorOpen),
    });
  },

  applyPartial(partial) {
    // Merge over the current config and route through applyConfig so the merge
    // is normalised and recorded exactly like a whole-config change.
    get().applyConfig({ ...get().config, ...partial });
  },

  select(selection) {
    // Selecting is a view concern: it never touches the config or the history
    // stacks. An id with no matching opening resolves to `none`, so a caller
    // cannot install a dangling selection. Selecting does **not** open the
    // editor (the wrench affordance does that); but clearing the selection
    // closes it, via `withEditor`.
    const resolved = resolveSelection(selection, get().config);
    set({ selection: resolved, editorOpen: withEditor(resolved, get().editorOpen) });
  },

  setEditorOpen(open) {
    // Opening with nothing selected is a no-op: there is no object to edit, and
    // allowing it would break the invariant the popover relies on.
    if (open && get().selection.kind === 'none') {
      set({ editorOpen: false });
      return;
    }
    set({ editorOpen: open });
  },

  patchOpening(id, patch) {
    // One `applyPartial`, therefore exactly one history entry, normalised.
    get().applyPartial({
      openings: get().config.openings.map((opening) =>
        opening.id === id ? { ...opening, ...patch } : opening,
      ),
    });
  },

  addOpening(opening) {
    const id = opening?.id ?? newOpeningId();
    const next: Opening = { ...defaultOpening(id), ...opening, id };

    /*
     * Run the desktop's placement rules before the door enters the plan. A door the
     * rule says cannot sit there either moves to the position the rule prefers (the
     * same "GO WITH …" the desktop showed) or is refused with a sentence, so the
     * operator never finds a door on a wall the factory would not build.
     */
    const placement = placeOpening(next, get().config);
    if (!placement.ok) {
      if ('reason' in placement) {
        set((state) => ({ notices: [...state.notices, placement.reason] }));
        return;
      }
      const chosen = placement.proposals[0];
      if (chosen === undefined) return;
      const applied = { ...chosen.opening, id };
      get().applyPartial({ openings: [...get().config.openings, applied] });
      get().select({ kind: 'opening', id });
      set((state) => ({ notices: [...state.notices, `${chosen.label} — applied.`] }));
      return;
    }

    get().applyPartial({ openings: [...get().config.openings, placement.opening] });
    // Select the door the user just created, so the popover opens on it.
    get().select({ kind: 'opening', id });
  },

  removeOpening(id) {
    get().applyPartial({
      openings: get().config.openings.filter((opening) => opening.id !== id),
    });
    // `applyConfig` already cleared a selection pointing at the removed door;
    // this keeps the intent explicit and covers a selection set to `none` too.
    const { selection } = get();
    if (selection.kind === 'opening' && selection.id === id) {
      get().select({ kind: 'none' });
    }
  },

  addOption(kind) {
    const { config } = get();

    /*
     * Ask the rules first, and say why when they refuse.
     *
     * This used to be a silent no-op for a second gable infill: the button did nothing and nothing
     * said why. A refusal is a sentence in `notices`, which the panel already renders — so the
     * operator learns the rule instead of concluding the button is broken.
     */
    const refusal = refusePlacement(kind, config);
    if (refusal !== null) {
      set({ notices: [refusal.reason] });
      return;
    }

    const created = defaultOptionsFor(kind, config);
    // A gable end is either closed or open, so adding infill only fills the ends
    // that are still open. Without this, a second click silently doubles the
    // instances and stacks two coincident symbols on each end.
    const fresh =
      kind === 'gable_infill'
        ? created.filter(
            (candidate) =>
              !config.options.some(
                (existing) =>
                  existing.kind === 'gable_infill' &&
                  existing.end === (candidate as Extract<ShedOption, { kind: 'gable_infill' }>).end,
              ),
          )
        : created;
    if (fresh.length === 0) return;
    // One `applyPartial`, therefore one history entry: a gable infill creates
    // two instances and a single Undo must remove both.
    get().applyPartial({ options: [...config.options, ...fresh] });
    get().select({ kind: 'option', id: fresh[0].id });
  },

  patchOption(id, patch) {
    const { config } = get();
    const index = config.options.findIndex((option) => option.id === id);
    // A patch for an id that is no longer present is a no-op rather than a
    // history entry: the config did not change.
    if (index === -1) return;
    const current = config.options[index];
    // `kind` is the discriminant and cannot be patched: a patch that changed it
    // would produce an object whose other fields no longer match its shape.
    const merged = { ...current, ...patch, kind: current.kind, id: current.id } as ShedOption;
    const normalised = normaliseOption(merged, config);
    const options = config.options.map((option, i) => (i === index ? normalised : option));
    get().applyPartial({ options });
  },

  addMiscOption(input) {
    const option = normaliseOption(
      { id: freshOptionId('misc_option'), kind: 'misc_option', ...input },
      get().config,
    );
    get().applyPartial({ options: [...get().config.options, option] });
    get().select({ kind: 'option', id: option.id });
  },

  addMezzanine(floorLoad) {
    const { config } = get();
    const refusal = refusePlacement('mezzanine', config);
    if (refusal !== null) {
      set({ notices: [refusal.reason] });
      return;
    }
    const base = defaultOptionsFor('mezzanine', config)[0];
    if (base === undefined) return;
    const option = normaliseOption({ ...base, floorLoad } as ShedOption, config);
    get().applyPartial({ options: [...config.options, option] });
    get().select({ kind: 'option', id: option.id });
  },

  removeAllOpenings(type) {
    get().applyPartial({
      openings: get().config.openings.filter((opening) => opening.type !== type),
    });
  },

  removeAllOptions(kind) {
    get().applyPartial({
      options: get().config.options.filter((option) => option.kind !== kind),
    });
  },

  clearOptions() {
    get().applyPartial({ options: [] });
  },

  removeOption(id) {
    get().applyPartial({
      options: get().config.options.filter((option) => option.id !== id),
    });
    const { selection } = get();
    if (selection.kind === 'option' && selection.id === id) {
      get().select({ kind: 'none' });
    }
  },

  duplicateOption(id) {
    const { config } = get();
    const source = config.options.find((option) => option.id === id);
    if (source === undefined) return;
    // A duplicate needs its own id and a position the user can see: an exact
    // copy sits under the original, so the plan shows one object and "Duplicate"
    // looks like it did nothing. Each kind moves to its next anchor.
    const copy = { ...nudgeOption(source), id: freshOptionId(source.kind) } as ShedOption;
    get().applyPartial({ options: [...config.options, copy] });
    get().select({ kind: 'option', id: copy.id });
  },

  addCharge() {
    const { config } = get();
    get().applyPartial({ charges: [...config.charges, newCharge()] });
  },

  patchCharge(id, patch) {
    const { config } = get();
    const index = config.charges.findIndex((charge) => charge.id === id);
    // A patch for an id that is no longer present is a no-op rather than a
    // history entry: the config did not change.
    if (index === -1) return;
    const charges = config.charges.map((charge, i) =>
      i === index ? { ...charge, ...patch, id: charge.id } : charge,
    );
    get().applyPartial({ charges });
  },

  removeCharge(id) {
    get().applyPartial({
      charges: get().config.charges.filter((charge) => charge.id !== id),
    });
  },

  undo() {
    const { history, future, config } = get();
    const previous = history[history.length - 1];
    if (previous === undefined) return;
    const nextConfig = normaliseShedConfig(previous);
    const selection = resolveSelection(get().selection, nextConfig);
    set({
      config: nextConfig,
      history: history.slice(0, -1),
      // Keep the config we are leaving so redo can return to it.
      future: [...future, config],
      // The note described the input that produced the config we are leaving.
      notices: [],
      // The restored config may not contain the selected door (undoing an add,
      // say), so resolve against it in the same `set` as `applyConfig` does.
      selection,
      editorOpen: withEditor(selection, get().editorOpen),
    });
  },

  redo() {
    const { history, future, config } = get();
    const next = future[future.length - 1];
    if (next === undefined) return;
    const nextConfig = normaliseShedConfig(next);
    const selection = resolveSelection(get().selection, nextConfig);
    set({
      config: nextConfig,
      future: future.slice(0, -1),
      history: [...history, config].slice(-HISTORY_LIMIT),
      notices: [],
      selection,
      editorOpen: withEditor(selection, get().editorOpen),
    });
  },

  setView(view) {
    set({ view });
  },

  setSheetOpen(sheetOpen) {
    if (sheetOpen) {
      set({ sheetOpen: true });
      return;
    }
    // Closing the sheet also lets go of the edited object (the mobile "out
    // focus"): the editor closes and, when it was the *editor* that was showing,
    // the selection clears so the wrench goes away too. A sheet closed while
    // showing the plain form (opened via "Details") leaves the selection alone.
    // One choke point covers every dismissal — drag down, overlay tap, Escape,
    // and the Close control.
    const editing = get().editorOpen;
    set({
      sheetOpen: false,
      editorOpen: false,
      selection: editing ? { kind: 'none' } : get().selection,
    });
  },

  setStatus(status) {
    set({ status });
  },

  setObjectDragging(objectDragging) {
    // A presentation flag only: it never touches the config, history, or the
    // selection, so collapsing the drawer mid-drag cannot disturb the edit.
    set({ objectDragging });
  },
}));
