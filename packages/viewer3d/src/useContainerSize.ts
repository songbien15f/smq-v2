'use client';

/**
 * The container's size, measured the way a canvas actually needs it.
 *
 * **Why this is not left to `<Canvas>`.** R3F sizes its canvas from `react-use-measure`, which
 * reads `getBoundingClientRect` only when `ResizeObserver` tells it to — and `ResizeObserver`
 * is not always delivered. Measured in an embedded pane: a plain observed `<div>` never fired,
 * so the canvas stayed at the HTML default of **300 × 150** while its container was 655 × 839.
 *
 * `react-use-measure` also listens on `window` for `resize` — its own escape hatch for exactly
 * this — so one dispatched event after layout is enough to make R3F take a reading. That is a
 * smaller and more honest fix than re-implementing R3F's sizing: nothing here duplicates its
 * renderer.
 *
 * Shared by the quote editor's 3D view and the `/demo` page: both hit the same default size
 * after a reload, and a second copy of this workaround would be a second thing to keep right.
 */

import { useEffect, useState } from 'react';

export function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const measure = (): void => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
      // Tell R3F to re-read. Harmless if it already knows; essential if no observer fired.
      window.dispatchEvent(new Event('resize'));
    };

    measure();
    // One more after the first paint, in case the container had no height when this effect ran.
    const timer = setTimeout(measure, 0);

    if (typeof ResizeObserver === 'undefined') return () => clearTimeout(timer);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref]);

  return size;
}
