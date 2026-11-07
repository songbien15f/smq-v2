'use client';

/**
 * The quote editor: one screen, three steps, the price always beside it.
 *
 * ## Layout
 *
 * ```
 * ┌────────────────────────────── three steps ──────────────────────────────┐
 * │ Details  /  Options  /  Cost                                            │
 * ├────────────────────────────── price (one line) ─────────────────────────┤  ← below 1280 px only
 * ├───────────────┬─────────────────────────────┬───────────────────────────┤
 * │ the step      │ the plan (every step)       │ price — always visible    │
 * └───────────────┴─────────────────────────────┴───────────────────────────┘
 * ```
 *
 * Three columns above 1280 px, because a salesperson needs the plan and the price at once. Between
 * 1024 and 1279 there is room for two, and below 1024 for one — so in both of those the price is
 * pinned as a **single line under the workspace bar** (`PriceSummary`), and the full panel with the
 * payment stages and the allowances stays at the end of the column. It is not merely "at the top":
 * it is sticky, because the form beside it is thousands of pixels tall.
 *
 * This paragraph described that behaviour before the code had it. Measured on 2026-11-08: at 1279 px
 * the panel's top edge sat at 5 092 px and on a phone at 5 996 px, off screen while the operator was
 * typing the building. A comment here is read as a specification — that is why it is worth keeping
 * exactly true.
 *
 * ## The one rule this screen exists to enforce
 *
 * **The price on screen is the price that gets saved.** Two mechanisms, and both are needed:
 *
 * 1. The API returns an evaluation id with the price, and Save sends it back. If the building or
 *    the money changed in between, the server refuses and this screen re-prices rather than saving
 *    a figure the operator did not see.
 * 2. This screen marks its own price stale the moment anything changes, so the operator knows
 *    before they press Save — a refusal at the end would be technically correct and useless.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { EvaluationView, PriceView, SessionView } from '@sq/contracts';
import { StatusPill } from '@sq/ui';
import { STEP_LABEL } from './steps';
import type { EditorStep } from './StepRail';
import { StepRail } from './StepRail';
import { QuoteDetailsPanel } from './QuoteDetailsPanel';
import { PlanPanel } from './PlanPanel';
import { PlanView } from './PlanView';
import { CostPanel } from './CostPanel';
import { SteelworkPanel } from './SteelworkPanel';
import { PunchingPanel } from './PunchingPanel';
import { SiteCheckPanel } from './SiteCheckPanel';
import { PricePanel, PriceSummary } from './PricePanel';
import { ErrorSummary, focusErrorSummary } from './ErrorSummary';
import { deriveStages } from './stages';
import { evaluateGate, validateDraft } from './validation';
import type { DraftIssue } from './validation';
import { useShedStore } from '@/store/useShedStore';
import { useDraftStore, NEW_DRAFT, STARTING_BUILDING } from '@/store/useDraftStore';
import { customerFromFragment, templateFromFragment } from './fragment';
import { api, newIdempotencyKey } from '@/lib/sq';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { navFor } from '@/components/ShellFrame';
import type { DisplayUnit } from '@sq/core/domain';
import { normaliseShedConfig } from '@sq/core/domain';

export interface QuoteEditorProps {
  session: SessionView;
  /** An existing quote to open, when editing rather than creating. */
  initial?: {
    quoteId: string;
    quoteNumber: string;
    revision: number;
    customer: ReturnType<typeof useDraftStore.getState>['customer'];
    site: ReturnType<typeof useDraftStore.getState>['site'];
    pricing: ReturnType<typeof useDraftStore.getState>['pricing'];
    /**
     * The building the revision was priced from.
     *
     * Required for an edit: without it the editor would open on the default shed and a save would
     * write a revision that silently replaced the real building. The route refuses to render the
     * editor when the server did not supply one.
     */
    config: unknown;
  };
}

export function QuoteEditor({ session, initial }: QuoteEditorProps) {
  const router = useRouter();
  const config = useShedStore((state) => state.config);
  const applyConfig = useShedStore((state) => state.applyConfig);
  const applyPartial = useShedStore((state) => state.applyPartial);

  const customer = useDraftStore((state) => state.customer);
  const site = useDraftStore((state) => state.site);
  const pricing = useDraftStore((state) => state.pricing);
  const loadDraft = useDraftStore((state) => state.load);
  const setPriced = useDraftStore((state) => state.setPriced);
  const markClean = useDraftStore((state) => state.markClean);
  const quoteId = useDraftStore((state) => state.quoteId);
  const quoteNumber = useDraftStore((state) => state.quoteNumber);
  const expectedRev = useDraftStore((state) => state.expectedRev);
  const siteCheckId = useDraftStore((state) => state.siteCheckId);

  const [step, setStep] = useState<EditorStep>('details');
  const [unit, setUnit] = useState<DisplayUnit>('mm');
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDetails, setSaveDetails] = useState<{ path: string; message: string }[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [saved, setSaved] = useState<{ number: string; revision: number } | null>(null);
  const [, startTransition] = useTransition();

  /** The idempotency key for the *next* save, so a double-click cannot make two revisions. */
  const idempotency = useRef(newIdempotencyKey());

  // Open an existing quote, or start from the default building. Runs once.
  const opened = useRef(false);
  /**
   * True once the store holds the draft this screen is about.
   *
   * A new quote is ready immediately; opening a saved one is not, because the building arrives from
   * the store in the same commit that loads it. Pricing before that would price the **default** shed
   * and print a number that belongs to no quote.
   */
  const [draftReady, setDraftReady] = useState(initial === undefined);

  /**
   * The building as it was when the screen opened or last saved, so an edit can be told apart.
   *
   * `useDraftStore.isDirty()` fingerprints only the customer, the site and the money — the building
   * lives in `useShedStore` and the draft store never sees it. So an edit that moved a span or added
   * an option left the draft "clean", and the save gate refused with "nothing has been changed yet"
   * while the plan plainly showed the change.
   *
   * Set by the open effect below for **both** cases. A new quote's baseline is the building it
   * opened with; leaving it `''` made every new quote dirty before anything was typed.
   */
  const buildingBaseline = useRef<string | null>(null);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;

    if (initial !== undefined) {
      loadDraft({
        customer: initial.customer,
        site: initial.site,
        pricing: initial.pricing,
        quoteId: initial.quoteId,
        quoteNumber: initial.quoteNumber,
        expectedRev: initial.revision,
      });
      // The building, from the revision the customer actually received. `applyConfig` normalises
      // and starts a fresh history, so the first Undo cannot step back into a different quote.
      applyConfig(initial.config);
    } else {
      /*
       * A new quote, which may have arrived from a template or from a legacy `.sqd` file.
       *
       * The building and the customer travel in the URL **fragment**, so they never reach a server or
       * a proxy log — and they are read here rather than fetched, so the editor opens with the
       * building already in place instead of flashing the default shed first.
       *
       * A fragment that does not parse is ignored: the operator gets the default building, which is
       * what they would have had anyway. A malformed link must not stop them quoting.
       */
      const fromTemplate = templateFromFragment();
      /*
       * Reset the draft first. This store is a module singleton, so arriving here from a saved quote
       * leaves that quote's `quoteId` behind — and a save would then append this building as a
       * revision of it. `load` also takes the snapshot, so an imported customer counts as the
       * baseline rather than as an unsaved change.
       */
      const imported = customerFromFragment();
      loadDraft({
        ...NEW_DRAFT,
        ...(imported === null ? {} : { customer: imported.customer, site: imported.site }),
      });
      applyConfig(fromTemplate ?? STARTING_BUILDING);
      /*
       * A new quote's baseline is the building it opened with, not `''`.
       *
       * Leaving it empty made `buildingDirty` true on the first render — every new quote was "dirty"
       * before anything was typed, so "leave and lose your changes" fired for an empty form and the
       * warning would have taught an operator to dismiss it without reading. Found by opening
       * `/quotes/new` and dispatching `beforeunload`: it was cancelled with nothing changed.
       */
      buildingBaseline.current = JSON.stringify(normaliseShedConfig(fromTemplate ?? STARTING_BUILDING));
    }
    setDraftReady(true);
  }, [initial, loadDraft, applyConfig]);

  /*
   * Opening a saved quote sets its baseline, and so does a later `initial` — the server re-render
   * after a save carries the revision it just wrote.
   *
   * **Normalised, not raw.** `applyConfig` runs the config through `normaliseShedConfig`, so comparing
   * the live config against the *stored* JSON compared two different representations. They differ
   * whenever the store repairs anything the snapshot left alone — and the symptom was a saved quote
   * that was "dirty" the moment it opened: the unsaved-changes guard fired on a page nobody had
   * touched, which is how a warning stops being read.
   */
  useEffect(() => {
    if (initial !== undefined && opened.current) {
      buildingBaseline.current = JSON.stringify(normaliseShedConfig(initial.config));
    }
  }, [initial]);

  const issues = useMemo(
    () => validateDraft({ config, customer, site }),
    // `config` is replaced wholesale by the store on every change, so identity is the right key.
    [config, customer, site],
  );

  const issuesByPath = useMemo(() => {
    const map = new Map<string, DraftIssue>();
    for (const issue of issues) if (!map.has(issue.path)) map.set(issue.path, issue);
    return map;
  }, [issues]);

  /**
   * The inputs a price is a fact about: the building and the money.
   *
   * Not the customer and not the site. Keying staleness on "the draft is dirty" made typing a
   * customer's name report "the building changed", which is both wrong and the kind of wrong that
   * teaches an operator to ignore a warning.
   *
   * The building and the money are tracked **separately** because they mean different things. A
   * negotiated contract changes the figure the server will freeze, so the preview has to be
   * refreshed — but it does not change one purlin, and making a salesperson press "calculate again"
   * after typing a discount reads as the tool arguing with them.
   */
  const buildingInputs = useMemo(() => JSON.stringify(config), [config]);
  const moneyInputs = useMemo(() => JSON.stringify(pricing), [pricing]);
  const priceInputs = useMemo(
    () => JSON.stringify({ building: buildingInputs, money: moneyInputs }),
    [buildingInputs, moneyInputs],
  );

  /** What the last successful evaluation was priced from, so a change can be classified. */
  const pricedInputs = useRef({ building: '', money: '' });

  const calculate = useCallback(async () => {
    setCalculating(true);
    setPriceError(null);

    const result = await api<EvaluationView>('evaluate', {
      method: 'POST',
      body: { config, pricing },
    });

    setCalculating(false);

    if (!result.ok) {
      setEvaluation(null);
      setPriceError(result.message);
      return;
    }

    setEvaluation(result.data);
    pricedInputs.current = { building: buildingInputs, money: moneyInputs };
    setPriced({
      kind: 'current',
      evaluationId: result.data.evaluationId,
      contractCents: result.data.price.contractCents,
      expiresAt: result.data.expiresAt,
      inputs: priceInputs,
    });
    // A fresh price means a fresh key: the previous one may have been spent by a save that failed
    // halfway, and reusing it would make the retry look like a replay.
    idempotency.current = newIdempotencyKey();
  }, [config, pricing, buildingInputs, moneyInputs, priceInputs, setPriced, pricedInputs]);

  /**
   * Price the building as soon as the draft it belongs to is in the store.
   *
   * Doing it here rather than behind a button means a salesperson sees a number from the start —
   * the whole point of the screen. It used to be skipped when opening a saved quote, which left an
   * operator on an existing quote looking at "No price yet" and pressing Calculate before they could
   * reach the plan; the building was already known, so the click bought nothing.
   *
   * Gated on `draftReady` rather than firing on mount: opening a quote applies its building in the
   * same commit, and pricing a render earlier would price the default shed.
   */
  const autoPriced = useRef(false);
  useEffect(() => {
    if (autoPriced.current || !draftReady) return;
    autoPriced.current = true;
    void calculate();
  }, [calculate, draftReady]);

  const dirty = useDraftStore((state) => state.isDirty());
  const pricedStale = useDraftStore((state) => state.priceIsStale(priceInputs));

  const buildingDirty = buildingBaseline.current !== JSON.stringify(config);

  /** A save is meaningful when the building or the draft moved. */
  const anyChange = dirty || buildingDirty;

  /*
   * Warn before a refresh, a closed tab, or a link out of the editor takes unsaved work with it.
   * The editor is one page with the quote list one click away, so both paths matter.
   */
  useUnsavedChangesWarning(anyChange);

  /**
   * Only the money moved; the building is untouched.
   *
   * A negotiated contract does change the figure the server will freeze, so the preview has to be
   * refreshed — but it changes no material at all. Making a salesperson press "calculate again"
   * after typing a discount read as the tool arguing with the negotiation, so this case refreshes on
   * its own and the price is never shown as out of date for it.
   */
  const moneyOnly =
    evaluation !== null &&
    pricedInputs.current.building === buildingInputs &&
    pricedInputs.current.money !== moneyInputs;

  /**
   * A refresh is in flight for a money-only change.
   *
   * Tracked so the Save button waits for it rather than sending an evaluation whose id is about to
   * be replaced. Saving in that window would freeze a preview the operator never saw — the exact
   * failure the evaluation exists to prevent.
   */
  const [refreshingMoney, setRefreshingMoney] = useState(false);

  // Debounced, because the operator is typing a figure: a request per keystroke would be a dozen
  // evaluations of a half-typed number, and only the last would matter.
  useEffect(() => {
    if (!moneyOnly) return;
    setRefreshingMoney(true);
    const timer = setTimeout(() => {
      void calculate().finally(() => setRefreshingMoney(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [moneyOnly, moneyInputs, calculate]);

  const pricedAt: 'none' | 'stale' | 'current' =
    evaluation === null
      ? 'none'
      : priceError !== null || pricedStale
        ? 'stale'
        : 'current';

  // A refresh in flight is a blocked save: the evaluation id is about to change under it.
  const gate = evaluateGate({ dirty: anyChange, issues, pricedAt, saving: saving || refreshingMoney });

  const goTo = (next: EditorStep): void => {
    startTransition(() => setStep(next));
    // Move focus to the step's heading so a keyboard user does not start from the top of the page.
    requestAnimationFrame(() => {
      document.getElementById('editor-step-heading')?.focus();
    });
  };

  /** Save: freeze the price that is on screen. */
  const save = async (): Promise<void> => {
    if (evaluation === null) return;
    setSaving(true);
    setSaveError(null);
    setSaveDetails([]);
    setShowIssues(true);

    const result = await api<{
      quoteId: string;
      quoteNumber: string;
      revision: number;
      revisionId: string;
      contractCents: number;
      replayed: boolean;
    }>('quotes', {
      method: 'POST',
      body: {
        ...(quoteId === null ? {} : { quoteId }),
        ...(siteCheckId === null ? {} : { siteCheckId }),
        evaluationId: evaluation.evaluationId,
        idempotencyKey: idempotency.current,
        expectedRev,
        customer,
        site,
        config,
        pricing,
      },
    });

    setSaving(false);

    if (!result.ok) {
      /*
       * A refusal from the server has to be **visible**, even when the form itself is valid.
       *
       * The summary was rendered only for client-side issues, so a 409 or a 422 with a valid form
       * produced nothing on screen: the button appeared to do nothing. Found by saving in a browser;
       * no amount of type-checking finds a message that is never rendered.
       */
      setSaveError(result.message);
      setSaveDetails(result.details ?? []);
      setShowIssues(true);

      // The server refused because something moved. Re-price so the operator sees what is current,
      // rather than pressing Save repeatedly against a figure that no longer exists.
      if (result.code === 'conflict') {
        setEvaluation(null);
        setPriceError(null);
        void calculate();
      }

      // The summary may not have existed a moment ago; wait for it to be in the DOM, then focus it.
      requestAnimationFrame(() => focusErrorSummary());
      return;
    }

    markClean({
      quoteId: result.data.quoteId,
      quoteNumber: result.data.quoteNumber,
      revision: result.data.revision,
    });
    // The building's baseline moves with the save too, or the next render would still call the
    // quote dirty and offer to save a revision identical to the one just written.
    buildingBaseline.current = JSON.stringify(config);
    setSaved({ number: result.data.quoteNumber, revision: result.data.revision });

    /*
     * A **first** save moves the screen to the quote's own address.
     *
     * It used to stay on `/quotes/new`, with the id only in memory — so a refresh, a Back, or the
     * browser being closed dropped the operator onto a blank form, and the quote they had just
     * saved looked lost. Found by saving one and pressing F5: empty form, no quote number. The
     * editor was working the whole time; the address bar was lying about what was on screen.
     *
     * `replace`, not `push`: the blank new-quote form must not be a Back target once the quote
     * exists, or Back means "throw away what I just saved". A later save of an amendment keeps the
     * address it already has, and only refreshes the server data behind it.
     */
    if (quoteId === null) {
      router.replace(`/quotes/${result.data.quoteId}/edit`);
    }
    router.refresh();
  };

  /**
   * The line under the button.
   *
   * Three states, each saying something different. A single "the building changed" line under a
   * **working** button was the defect the browser check found: it read as a warning about a disabled
   * save while the save was available. A save that can proceed gets a sentence about what it will
   * do, not a caveat.
   */
  const gateMessage =
    pricedAt === 'stale'
      ? gate.blocked
        ? 'Calculate the price again before saving — the building or the money changed.'
        : undefined
      : pricedAt === 'current'
        ? quoteId === null
          ? 'Saves revision 1 and freezes the price shown on the right.'
          : `Saves revision ${expectedRev + 1} and freezes the price on the right. Revision ${expectedRev} stays as it was sent.`
        : gate.reasons[0];

  /*
   * The staged figures, computed **once** and handed to both places that show the price.
   *
   * The strip below `xl` and the full panel must read the same number; two calls to `deriveStages`
   * with one of them drifting is exactly the "two answers on one screen" the panel's own doc warns
   * about. `pricing` carries the operator's overrides, so this is the figure that will be frozen.
   */
  const stages =
    evaluation === null
      ? { contractCents: 0, depositCents: 0, progressCents: 0, balanceCents: 0 }
      : deriveStages(evaluation.price, pricing);

  /*
   * `data-dirty` is what the unsaved-changes guard is about to decide, on the element it protects.
   *
   * The guard is a `window.confirm` on the way out — invisible until somebody tries to leave, which
   * made "the warning fired on a page I only looked at" unfalsifiable from outside the component. Two
   * flags because the halves are independent: a change to the building is a different bug from a
   * change to the draft, and only the pair says which one moved.
   */
  return (
    <div
      className="flex min-h-dvh flex-col bg-sq-ground"
      data-dirty={anyChange ? 'true' : 'false'}
      data-dirty-building={buildingDirty ? 'true' : 'false'}
    >
      {/*
        The editor's own shortcuts, above the steps.

        The editor does not use `ShellFrame`: its 232 px rail would take the width the plan needs,
        and the product's working surface is a drawing. But building its own chrome meant it offered
        **no way out** — a person who opened `/quotes/new` had no link back to the quote list, to
        Settings, or to sign out, and had to edit the address bar. This strip is the missing exit,
        and it takes its links from `navFor` so the set is the same one the rest of the workspace
        shows rather than a second list that can drift.
      */}
      <div className="border-b border-sq-line bg-sq-brand text-white">
        <div className="mx-auto flex min-h-11 max-w-[1400px] flex-wrap items-center gap-sq-3 px-sq-3 py-sq-1">
          <a href="/quotes" className="flex min-h-11 items-center gap-sq-2 no-underline">
            <span className="text-sq-body font-semibold text-white">SmartQuote</span>
          </a>
          <nav aria-label="Workspace" className="flex flex-wrap items-center gap-sq-1">
            {navFor(session.capabilities).map((link) => {
              const here = link.href === '/quotes';
              return (
                <a
                  key={link.href}
                  href={link.href}
                  aria-current={here ? 'page' : undefined}
                  className={[
                    'inline-flex min-h-11 items-center rounded-md px-sq-2 text-sq-body no-underline transition-colors duration-sq-fast',
                    here ? 'bg-white/15 font-medium text-white' : 'text-white/85 hover:bg-white/10',
                  ].join(' ')}
                >
                  {link.label}
                </a>
              );
            })}
          </nav>
          <span className="ml-auto flex items-center gap-sq-2 text-sq-micro text-white/80">
            {session.currentTenantName ?? 'No company'}
          </span>
          <a
            href="/change-password"
            className="inline-flex min-h-11 items-center rounded-md px-sq-2 text-sq-micro text-white/85 no-underline hover:bg-white/10"
          >
            Password
          </a>
        </div>
      </div>

      <StepRail
        current={step}
        reachable={(target) => (target === 'details' ? true : evaluation !== null)}
        blockedReason={(target) =>
          target === 'details' || evaluation !== null
            ? undefined
            : 'Calculate the price first — there is nothing to place or negotiate yet.'
        }
        onSelect={goTo}
        noticeCount={issues.length}
      />

      {/*
        The price, pinned under the workspace bar, at every width where the panel has nowhere to live.

        Above 1280 px it is the third column and this strip does not render. Below that the panel is
        the last child of a page that measured 6 515 px at 1279 and 7 528 px on a phone, so the number
        being quoted was **off screen while the form was being filled** — measured 2026-11-08: top edge
        at 5 092 px and 5 996 px respectively. This is the "sticky summary at the top" the module
        header has claimed since the screen was written.

        `sticky top-0` on the page rather than inside the grid: the grid is one row per column count
        and the form decides the height, so a sticky child of it would be constrained to its own cell.
      */}
      <div className="sticky top-0 z-20 border-b border-sq-line bg-sq-ground/95 backdrop-blur xl:hidden">
        <div className="mx-auto max-w-[1400px] px-sq-3 py-sq-2">
          <PriceSummary
            evaluation={evaluation}
            stale={pricedAt === 'stale'}
            stages={stages}
            onOpenCost={step === 'cost' ? undefined : () => goTo('cost')}
          />
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1400px] flex-1 gap-sq-3 px-sq-3 py-sq-3 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,300px)]">
        {/* ------------------------------------------------------------ left: the step */}
        <div className="flex min-w-0 flex-col gap-sq-3">
          <div className="flex flex-wrap items-baseline justify-between gap-sq-2">
            <h1 id="editor-step-heading" tabIndex={-1} className="text-sq-title font-semibold outline-none">
              {STEP_LABEL[step]}
            </h1>
            <span className="text-sq-micro text-sq-ink-muted">
              {quoteNumber === null ? 'New quote' : `${quoteNumber} · revision ${expectedRev}`}
            </span>
          </div>

          <ErrorSummary
            issues={issues}
            /*
             * Visible once a save has been attempted — and always when the server has said
             * something, because a refusal with a valid form is exactly the case that must not be
             * silent. `visible` was gated on `issues.length > 0`, which made a server-side refusal
             * invisible.
             */
            visible={saveError !== null || (showIssues && issues.length > 0)}
            {...(saveError === null ? {} : { serverMessage: saveError })}
            {...(saveDetails.length === 0 ? {} : { serverDetails: saveDetails })}
          />

          {step === 'details' && (
            <div className="flex flex-col gap-sq-3">
              <div className="rounded-lg border border-sq-line bg-sq-surface">
                <QuoteDetailsPanel issuesByPath={issuesByPath} unit={unit} onUnitChange={setUnit} />
              </div>
              {/*
                The site check sits under the design fields because that is what it fills. It needs a
                saved quote — a check belongs to one — so it says so rather than offering a button
                that would fail.
              */}
              <SiteCheckPanel
                quoteId={quoteId}
                site={{
                  address: site.address,
                  suburb: site.suburb,
                  state: site.state,
                  postcode: site.postcode,
                }}
                client={{ firstName: customer.firstName, lastName: customer.lastName, email: customer.email }}
                heightMm={config.height}
                spanMm={config.span}
                lengthMm={config.length}
                importanceLevel={config.importanceLevel}
                // ShedSafe refuses an empty salesman, and the person at the keyboard is the honest
                // default. They can still type somebody else's name.
                defaultSalesman={session.displayName !== '' ? session.displayName : session.email}
                canWrite={session.capabilities.includes('quote:write')}
                onImported={(values) => {
                  // The certified values replace what was typed. Only the ones ShedSafe actually
                  // returned: a null is "not calculated", and writing it would blank a real value.
                  if (values.windRegion !== null) applyPartial({ windRegion: values.windRegion as never });
                  if (values.terrainCategory !== null) {
                    applyPartial({ terrainCategory: values.terrainCategory as never });
                  }
                  if (values.importanceLevel !== null) {
                    applyPartial({ importanceLevel: values.importanceLevel as never });
                  }
                  if (values.buildingClass !== null) {
                    applyPartial({ buildingClass: values.buildingClass });
                  }
                  if (values.snowLoad !== null) applyPartial({ snowLoad: values.snowLoad });
                  if (values.designWindSpeed !== null) {
                    applyPartial({ designWindSpeed: values.designWindSpeed });
                  }
                }}
              />
            </div>
          )}

          {step === 'options' && <PlanPanel />}

          {step === 'cost' && (
            <>
              <CostPanel
                price={evaluation === null ? null : evaluation.price}
                stale={pricedAt === 'stale'}
                calculating={calculating}
                onRecalculate={() => void calculate()}
                canSeeMargin={session.capabilities.includes('cost:margin')}
              />
              <SteelworkPanel members={evaluation === null ? [] : evaluation.members} />
              <PunchingPanel pages={evaluation === null ? [] : evaluation.punchings} />
            </>
          )}

          {/* -------------------------------------------------------- the gate */}
          <div className="sticky bottom-0 -mx-sq-3 border-t border-sq-line bg-sq-surface/95 px-sq-3 py-sq-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-sq-2">
              {step !== 'details' && (
                <button
                  type="button"
                  onClick={() => goTo(step === 'cost' ? 'options' : 'details')}
                  className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-3 text-sq-body font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
                >
                  Back
                </button>
              )}

              {step !== 'cost' ? (
                /*
                 * A **navigation** button, not a save — and it used to say "Save & next".
                 *
                 * That one word cost a real operator the whole feature: the button was labelled
                 * "Save & next" while it only moved to the next step, and its adjacent line
                 * announced "Saves revision 1 and freezes the price" because that line describes
                 * the *gate*, not this control. Pressing it, seeing the step change with nothing
                 * saved, and then opening the quote list to find no quote is a reasonable
                 * conclusion that saving does not work. The label now says what it does, and the
                 * reason it is disabled says which fields are missing.
                 */
                <button
                  type="button"
                  onClick={() => goTo(step === 'details' ? 'options' : 'cost')}
                  disabled={issues.length > 0 || evaluation === null}
                  className="min-h-11 cursor-pointer rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white transition-colors duration-sq-fast hover:bg-sq-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {step === 'details' ? 'Next: the plan' : 'Next: cost'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={gate.blocked}
                  className="min-h-11 cursor-pointer rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white transition-colors duration-sq-fast hover:bg-sq-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {saving ? 'Saving…' : quoteId === null ? 'Save quote' : 'Save revision'}
                </button>
              )}

              {/*
                The line under the buttons explains whichever one is showing. On the first two
                steps that is the navigation button, so it names the fields still needed rather
                than describing a save that cannot happen there.
              */}
              {step !== 'cost' ? (
                <span className="text-sq-micro text-sq-ink-muted" aria-live="polite">
                  {issues.length > 0
                    ? issues.length === 1
                      ? 'One field still needs attention before the next step.'
                      : `${issues.length} fields still need attention before the next step.`
                    : evaluation === null
                      ? 'Calculate the price first.'
                      : `The quote is saved on the last step — step 3, Cost and price.`}
                </span>
              ) : (
                gateMessage !== undefined && (
                  <span className="text-sq-micro text-sq-ink-muted" aria-live="polite">
                    {gateMessage}
                  </span>
                )
              )}

              {saved !== null && (
                <span className="ml-auto flex items-center gap-sq-2" role="status">
                  <StatusPill tone="ok" label={`Saved ${saved.number} · rev ${saved.revision}`} />
                  <a
                    href={`/quotes/${quoteId}`}
                    className="text-sq-micro font-medium text-sq-brand underline underline-offset-2"
                  >
                    Open the quote
                  </a>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* -------------------------------------------------- middle: the plan */}
        {/*
          The plan is on every step, not only the Options step. Step 1 changes the
          building's dimensions and Step 3 negotiates its price; both need the building
          visible. On Options it is the working surface; elsewhere it is a live preview
          with pointer events off.

          **Pinned to the viewport on desktop.** A CSS grid row is as tall as its tallest
          cell, and the step form beside this one is thousands of pixels tall — so this
          column was stretched to match it and the canvas inside grew to 934 × 6112.
          A 3D model drawn into a sheet twelve screens tall is one nobody can see: the
          camera frames the middle of it and the shed sits in a corner. Sticky plus a
          viewport height makes the drawing the size of a drawing, and keeps it in view
          while the form scrolls. Below `lg` the columns stack, so it stays in flow.

          **The offset is not `12px` below `xl`.** The price summary above is sticky too and measured
          61 px tall; with both pinned at `top: 12px` the plan slid underneath it and its top 49 px —
          the dimensions along the top edge — were hidden. `4.5rem` clears the strip, and `xl` returns
          to `sq-3` where the strip does not render.
        */}
        <div className="min-h-[320px] min-w-0 lg:sticky lg:top-[4.5rem] lg:mb-sq-3 lg:h-[calc(100dvh-5.5rem)] lg:min-h-0 xl:top-sq-3 xl:h-[calc(100dvh-2rem)]">
          <PlanView interactive={step === 'options'} />
        </div>

        {/* -------------------------------------------------- right: the price */}
        <div className="min-w-0">
          <div className="sticky top-sq-3">
            <PricePanel
              evaluation={evaluation}
              stages={stages}
              stale={pricedAt === 'stale'}
              calculating={calculating}
              error={priceError}
              onCalculate={() => void calculate()}
              saving={saving}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
