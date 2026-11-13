/**
 * Which editor columns show, how wide they are and where the sticky pieces sit, per step.
 *
 * Every decision of the form "this column at this width, this sticky offset" lives here as whole Tailwind
 * class strings — Tailwind v4 scans source text, so a class assembled with a template literal is never
 * generated. `QuoteEditor` calls this and does not build class names itself.
 *
 * ## The three layouts
 *
 * - **Details / Options:** form 380 | plan | price panel (300) at `xl`. The price strip is `xl:hidden`
 *   because the panel is on screen beside the work.
 * - **Cost:** form 640 | plan, no price panel. The Cost step *is* the full price (contract, deposit,
 *   charges), so a third column repeated the same figures while the tables were squeezed into 380 px.
 *   The strip therefore stays visible at `xl` — the number being quoted must never leave the screen.
 *
 * ## Sticky offsets move together
 *
 * When the strip shows at `xl` it is 61 px tall and sticky at `top-0`, so the form header (`3.9rem`) and
 * the plan box (`4.5rem`) must sit below it exactly as they do under `xl`. Dropping only the strip's
 * `xl:hidden` leaves both at their `xl` offsets and the plan slides under the strip, hiding its top 49 px
 * (the dimensions along the top edge) — a defect this screen has had once already.
 *
 * ## With the Assistant (`assistant.on`)
 *
 * The third column becomes the Assistant (340 px, or a 48 px rail when collapsed) on every step, and the
 * price panel moves into a drawer opened from the strip. Because the number being quoted must stay on
 * screen without the panel, the strip now shows at **every** width, so the `xl` overrides above (header
 * `xl:top-0`, plan box `xl:top-sq-3 xl:h-[calc(100dvh-2rem)]`) are dropped: header and plan sit below the
 * strip exactly as they do under `xl`. Cost keeps no price column either way; its form column is 560 px
 * (not 640) while the Assistant is open, so the plan keeps a usable width beside it; 640 again once it is
 * collapsed to the rail.
 */

import type { EditorStep } from './StepRail';

export interface EditorLayout {
  /** The full `PricePanel` is rendered as the third column at `xl`. */
  showPanel: boolean;
  /** The Assistant is the third column at `xl` (and a drawer / sheet below it). */
  showAssistant: boolean;
  /** Classes for the sticky one-line price strip, the grid, the sticky form header and the plan box. */
  stripClass: string;
  gridClass: string;
  formHeaderClass: string;
  planBoxClass: string;
}

const STRIP = 'sticky top-0 z-30 border-b border-sq-line bg-sq-ground/95 backdrop-blur';
const GRID = 'mx-auto grid w-full max-w-[1400px] flex-1 gap-sq-3 px-sq-3 py-sq-3';
const FORM_HEADER =
  'sticky top-[3.9rem] z-10 -mx-sq-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-sq-2 gap-y-sq-1 border-b border-sq-line bg-sq-ground/95 px-sq-1 pb-sq-2 backdrop-blur';
const PLAN_BOX = 'min-h-[320px] min-w-0 lg:sticky lg:top-[4.5rem] lg:mb-sq-3 lg:h-[calc(100dvh-5.5rem)] lg:min-h-0';

export interface AssistantLayout {
  on: boolean;
  /** Collapsed to the 48 px rail at `xl`. */
  collapsed: boolean;
}

export function editorLayout(step: EditorStep, assistant: AssistantLayout = { on: false, collapsed: false }): EditorLayout {
  // On a phone the columns stack and the plan comes after the whole form. On Options the plan is the
  // working surface (doors are placed on it), so it goes first there; `lg` and up is unchanged.
  const planOrder = step === 'options' ? ' order-first lg:order-none' : '';

  if (assistant.on) {
    // Whole class strings, written out: Tailwind only generates what it can read in the source.
    const grid =
      step === 'cost'
        ? assistant.collapsed
          ? 'xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)_minmax(0,48px)]'
          : 'xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)_minmax(0,340px)]'
        : assistant.collapsed
          ? 'xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,48px)]'
          : 'xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,340px)]';
    return {
      showPanel: false,
      showAssistant: true,
      stripClass: STRIP,
      gridClass: `${GRID} lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] ${grid}`,
      formHeaderClass: FORM_HEADER,
      planBoxClass: `${PLAN_BOX}${planOrder}`,
    };
  }

  if (step === 'cost') {
    return {
      showPanel: false,
      showAssistant: false,
      stripClass: STRIP,
      gridClass: `${GRID} lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]`,
      formHeaderClass: FORM_HEADER,
      planBoxClass: PLAN_BOX,
    };
  }

  return {
    showPanel: true,
    showAssistant: false,
    stripClass: `${STRIP} xl:hidden`,
    gridClass: `${GRID} lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,300px)]`,
    formHeaderClass: `${FORM_HEADER} xl:top-0`,
    planBoxClass: `${PLAN_BOX} xl:top-sq-3 xl:h-[calc(100dvh-2rem)]${planOrder}`,
  };
}
