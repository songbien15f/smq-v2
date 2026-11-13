import type { Metadata } from 'next';
import { DemoView } from '@/components/demo/DemoView';

/**
 * A public 3D reference page: one fixed building, no session, no data.
 *
 * It exists so the geometry can be judged (and screenshotted) before it is wired into the
 * quote editor. Kept outside the workspace routes on purpose — it is a demo, not a screen an
 * operator reaches from the app.
 */
export const metadata: Metadata = {
  title: 'SmartQuote — 3D demo',
  description: 'A detailed 3D shed: roller door, PA door, sliding door, window and roof.',
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <DemoView />;
}
