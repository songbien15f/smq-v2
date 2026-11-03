/**
 * Step labels, in one place.
 *
 * The rail, the screen heading and anything that reports a step all read these. A second copy is
 * how a screen ends up titled "Cost" while the rail calls it "Pricing".
 */

import type { EditorStep } from './StepRail';

export const STEP_LABEL: Record<EditorStep, string> = {
  details: 'Quote details',
  options: 'Options on the plan',
  cost: 'Cost and price',
};

/** A sentence for each step, used as a sub-heading so a person knows what the step is for. */
export const STEP_PURPOSE: Record<EditorStep, string> = {
  details: 'Who the quote is for, where the shed goes, and what the building is.',
  options: 'Where the doors and windows go. The price follows the building, so this is the last step that changes it.',
  cost: 'The contract price, the deposit and the progress payment. Only these three can be typed.',
};
