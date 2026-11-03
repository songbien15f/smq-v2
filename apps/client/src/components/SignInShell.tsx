import type { ReactNode } from 'react';
import { BrandMark } from '@sq/ui';

/**
 * The frame around the sign-in card.
 *
 * Two columns on a laptop, one on a phone. The navy panel is decoration and is **hidden below
 * `lg`** rather than stacked: on a phone it would push the form below the fold, and a sign-in
 * screen whose form is off-screen is a sign-in screen people think is broken.
 *
 * The panel repeats what the person already knows (the product's name) so it cannot be mistaken
 * for information they need to act on. Everything actionable is in the card.
 */
export function SignInShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-sq-ground lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden flex-col justify-between bg-sq-brand p-sq-8 lg:flex">
        <div className="flex items-center gap-2">
          <BrandMark size={28} tone="brand" title="" />
          <span className="text-sq-body-lg font-semibold text-white">SmartQuote</span>
        </div>

        <div className="max-w-md">
          <p className="text-sq-body-lg leading-relaxed text-white/80">
            Steel-shed quoting for Australian dealers — build the shed, price it against your own
            book, and send the customer a document they can act on.
          </p>
          {/* A short gold rule, the one brand accent the palette allows on navy. */}
          <div className="mt-sq-6 h-1 w-12 rounded-full bg-sq-gold" aria-hidden="true" />
        </div>

        <p className="text-sq-micro text-white/50">
          © {new Date().getFullYear()} SmartQuote
        </p>
      </aside>

      <main className="flex items-center justify-center p-sq-6">
        <div className="w-full max-w-sm rounded-sq-lg border border-sq-line bg-sq-surface p-sq-6">
          {children}
        </div>
      </main>
    </div>
  );
}
