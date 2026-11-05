'use client';

/**
 * The quote editor: one screen, three steps, the price always beside it.
 *
 * ## Layout
 *
 * ```
 * ┌────────────────────────────── three steps ──────────────────────────────┐
 * │ Details  /  Options  /  Cost                                            │
 * ├───────────────┬─────────────────────────────┬───────────────────────────┤
 * │ the step      │ the plan (steps 1–2 only)   │ price — always visible    │
 * └───────────────┴─────────────────────────────┴───────────────────────────┘
 * ```
 *
 * Three columns above 1280 px because a salesperson needs the plan and the price at once; one
 * column below 1024 px, with the price as a sticky summary at the top, because a phone has no room
 * for three and the price is the part that matters.
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
import { SiteCheckPanel } from './SiteCheckPanel';
import { PricePanel } from './PricePanel';
import { ErrorSummary, focusErrorSummary } from './ErrorSummary';
import { deriveStages } from './stages';
import { evaluateGate, validateDraft } from './validation';
import type { DraftIssue } from './validation';
import { useShedStore } from '@/store/useShedStore';
import { useDraftStore, STARTING_BUILDING } from '@/store/useDraftStore';
import { api, newIdempotencyKey } from '@/lib/sq';
import type { DisplayUnit } from '@sq/core/domain';

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

/**
 * The building a template link carried, or `null`.
 *
 * Read from `location.hash` rather than a query parameter: a fragment is never sent to a server, so a
 * building — which is a customer's specification — stays out of proxy logs and out of the `Referer` of
 * anything the page later loads.
 *
 * Every failure answers `null`. A malformed link must produce the default building, not a crash on the
 * one screen a salesperson opens in front of a customer.
 */
function templateFromFragment(): unknown | null {
  if (typeof window === 'undefined') return null;

  const match = /(?:^#|&)template=([^&]+)/.exec(window.location.hash);
  if (match === null || match[1] === undefined) return null;

  try {
    return JSON.parse(decodeURIComponent(match[1])) as unknown;
  } catch {
    return null;
  }
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
       * A new quote, which may have arrived from a template.
       *
       * The building travels in the URL **fragment**, so it never reaches a server or a proxy log —
       * and it is read here rather than fetched, so the editor opens with the building already in
       * place instead of flashing the default shed first.
       *
       * A fragment that does not parse is ignored: the operator gets the default building, which is
       * what they would have had anyway. A malformed link must not stop them quoting.
       */
      const fromTemplate = templateFromFragment();
      applyConfig(fromTemplate ?? STARTING_BUILDING);
    }
    setDraftReady(true);
  }, [initial, loadDraft, applyConfig]);

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

  /**
   * Whether the **building** has changed since the quote was opened or last saved.
   *
   * `useDraftStore.isDirty()` fingerprints only the customer, the site and the money — the building
   * lives in `useShedStore` and the draft store never sees it. So an edit that moved a span or added
   * an option left the draft "clean", and `evaluateGate` refused the save with "nothing has been
   * changed yet" while the plan plainly showed the change. A revision that can only be saved when
   * the customer's name changed is not an editor.
   *
   * Kept here rather than in the store because it is a comparison of two stores, and the editor is
   * the only place that owns both.
   */
  const buildingBaseline = useRef<string | null>(null);
  if (buildingBaseline.current === null) {
    // The first render after the open effect: the baseline is whatever the quote was opened with.
    // (`initial` is set before the effect runs, so this captures the saved building, not the default.)
    buildingBaseline.current = initial === undefined ? '' : JSON.stringify(initial.config);
  }
  useEffect(() => {
    if (initial !== undefined && opened.current) buildingBaseline.current = JSON.stringify(initial.config);
  }, [initial]);
  const buildingDirty = buildingBaseline.current !== JSON.stringify(config);

  /** A save is meaningful when the building or the draft moved. */
  const anyChange = dirty || buildingDirty;

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

  return (
    <div className="flex min-h-dvh flex-col bg-sq-ground">
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
            <CostPanel
              price={evaluation === null ? null : evaluation.price}
              stale={pricedAt === 'stale'}
              calculating={calculating}
              onRecalculate={() => void calculate()}
              canSeeMargin={session.capabilities.includes('cost:margin')}
            />
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
                <button
                  type="button"
                  onClick={() => goTo(step === 'details' ? 'options' : 'cost')}
                  disabled={issues.length > 0 || evaluation === null}
                  className="min-h-11 cursor-pointer rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white transition-colors duration-sq-fast hover:bg-sq-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {step === 'details' ? 'Save & next' : 'Next: cost'}
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

              {gateMessage !== undefined && (
                <span className="text-sq-micro text-sq-ink-muted" aria-live="polite">
                  {gateMessage}
                </span>
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
        */}
        <div className="min-h-[320px] min-w-0 lg:min-h-0">
          <PlanView interactive={step === 'options'} />
        </div>

        {/* -------------------------------------------------- right: the price */}
        <div className="min-w-0">
          <div className="sticky top-sq-3">
            <PricePanel
              evaluation={evaluation}
              stages={
                evaluation === null
                  ? { contractCents: 0, depositCents: 0, progressCents: 0, balanceCents: 0 }
                  : deriveStages(evaluation.price, pricing)
              }
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
