'use client';

/**
 * Starting a quote from a template.
 *
 * ## What a clone copies, and what it must not
 *
 * The building and its options — nothing else. No customer, no site, no ShedSafe building id. A
 * template that carried a site's certificate would give every clone a wind rating for a site the new
 * quote is not on, which is a claim about a place nobody checked.
 *
 * ## Why the building is shown, not just the name
 *
 * "Gable 12 × 24" is the reason somebody picks a template; a list of names is a list of guesses. The
 * dimensions come from the stored config, so the two cannot disagree.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Panel } from '@sq/ui';
import { api } from '@/lib/sq';

interface TemplateItem {
  id: string;
  code: string;
  name: string;
  typeName: string;
  /** One line saying what the building is for, written by whoever authored it. */
  description: string | null;
  /** Whether the vendor attached a `.sqd` this company can download. */
  hasFile: boolean;
  config: {
    span?: number;
    length?: number;
    height?: number;
    bays?: number;
  } | null;
}

export function TemplatePicker({ templates }: { templates: TemplateItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (templates.length === 0) return null;

  const start = async (template: TemplateItem): Promise<void> => {
    setBusy(template.id);
    setError(null);

    // Count the clone before navigating: the count is about use, and a page that navigated away
    // would never send it.
    await api(`templates/${template.id}/cloned`, { method: 'POST' });

    // The building travels in the URL fragment so the editor can seed itself without a round trip,
    // and the fragment never reaches a server or a proxy log.
    const payload = template.config === null ? null : JSON.stringify(template.config);
    router.push(payload === null ? '/quotes/new' : `/quotes/new#template=${encodeURIComponent(payload)}`);
    setBusy(null);
  };

  return (
    <Panel
      title="Start from a template"
      description="A building someone already worked out. The customer and site are always blank."
      padded={false}
    >
      {error !== null && (
        <p role="alert" className="px-sq-3 py-sq-2 text-sq-body text-sq-danger">
          {error}
        </p>
      )}
      <ul className="flex flex-col">
        {templates.map((template) => {
          const config = template.config;
          const size =
            config?.span !== undefined && config.length !== undefined
              ? `${config.span / 1000} × ${config.length / 1000} m, ${config.height !== undefined ? config.height / 1000 : '?'} m walls`
              : 'No building saved with this template';

          return (
            <li
              key={template.id}
              className="flex flex-wrap items-center justify-between gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2 last:border-0"
            >
              <div className="min-w-0">
                <span className="text-sq-body font-medium text-sq-ink">{template.name}</span>
                <span className="ml-sq-2 text-sq-micro text-sq-ink-muted">{template.typeName}</span>
                {template.description !== null && template.description !== '' && (
                  <span className="block text-sq-micro text-sq-ink-muted">
                    {template.description}
                  </span>
                )}
                <span className="block sq-numeric text-sq-micro text-sq-ink-muted">{size}</span>
              </div>
              <div className="flex flex-wrap items-center gap-sq-2">
                {/*
                  The vendor's `.sqd`, when there is one. Cloning inside this product needs only the
                  stored config; the file is what a company needs to open the same building in the
                  desktop app, which is the transition path away from it. Offered only when it
                  exists — a link that answers 404 on half the rows reads as a broken catalogue.
                */}
                {template.hasFile && (
                  <a
                    href={`/api/sq/templates/${template.id}/file`}
                    className="inline-flex min-h-11 items-center rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-ink no-underline transition-colors duration-sq-fast hover:bg-sq-ground"
                  >
                    Download .sqd
                  </a>
                )}
                <Button loading={busy === template.id} onClick={() => void start(template)}>
                  Start a quote
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
