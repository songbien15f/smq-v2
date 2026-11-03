/**
 * The quote document: what a customer reads.
 *
 * Two layers, deliberately separate:
 *
 * - `projection.ts` decides **what a customer may know** — no cost, no margin, no internal code.
 * - `html.ts` and `pdf.ts` decide how it looks, and never see a figure the projection removed.
 *
 * The separation is what makes the leak check possible: a test can assert the projection's output
 * contains no cost without reading a line of markup.
 */

export * from './types';
export * from './assumptions';
export * from './colours';
export * from './projection';
export * from './html';
export * from './pdf';
export * from './bomSheet';
