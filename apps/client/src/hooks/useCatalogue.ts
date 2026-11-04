'use client';

/**
 * The price book's dropdown lists, for the editor's forms.
 *
 * The lists live in the book, not in the client: a supplier adding a delivery scope or
 * renaming a profile must change the form without a deploy. This hook fetches them
 * once per mount and returns `null` until they arrive, so a form renders its fallback
 * (a free-text field) rather than inventing an empty dropdown.
 */

import { useEffect, useState } from 'react';
import type { Catalogue } from '@sq/core/pricing';
import { api } from '@/lib/sq';

export interface CatalogueState {
  catalogue: Catalogue | null;
  /** True once a fetch has finished, successfully or not. */
  settled: boolean;
}

export function useCatalogue(): CatalogueState {
  const [state, setState] = useState<CatalogueState>({ catalogue: null, settled: false });

  useEffect(() => {
    let alive = true;
    void api<{ bookHash: string; catalogue: Catalogue }>('price-books/active/catalogues').then(
      (result) => {
        if (!alive) return;
        setState({ catalogue: result.ok ? result.data.catalogue : null, settled: true });
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
