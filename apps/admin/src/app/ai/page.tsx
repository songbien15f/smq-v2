import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import type { AiSettingsView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { AiSettingsForm } from '@/components/AiSettingsForm';

export const metadata: Metadata = { title: 'AI assistant' };

/**
 * Which model answers the Guest assistant.
 *
 * Server-rendered like the other platform screens: the settings are three selects and five text fields,
 * and the first paint should show the values in force rather than a spinner. The form is a client
 * component because the save happens in the browser.
 *
 * **No key is shown here.** The view this page reads carries `geminiKeySet` / `vilaoKeySet` as booleans;
 * the keys themselves live in `.env` and never leave the API process (migration 008's rule).
 */
export default async function AiSettingsPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const allowed = session.data.capabilities.includes('platform:ai');
  const settings = allowed ? await serverFetch<AiSettingsView>('/admin/ai-settings') : null;

  return (
    <ShellFrame session={session.data} current="/ai">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">AI assistant</h1>
          <p className="text-sq-body text-sq-ink-muted">
            Which provider answers the Guest page&rsquo;s assistant — the chat turn, the transcript repair and
            speech to text — and which one catches a failure. Changes are audited and apply to every company.
          </p>
        </div>

        {settings === null ? (
          <Panel title="Not available to your role">
            <p className="text-sq-body text-sq-ink-muted">The AI provider settings need the platform:ai capability.</p>
          </Panel>
        ) : !settings.ok ? (
          <Panel title="Could not load the AI settings">
            <p role="alert" className="text-sq-body text-sq-danger">
              {settings.message}
            </p>
          </Panel>
        ) : (
          <AiSettingsForm initial={settings.data} />
        )}
      </div>
    </ShellFrame>
  );
}
