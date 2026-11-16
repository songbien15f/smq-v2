import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { TemplateCatalogue, type CompanyOption, type TemplateRow } from '@/components/TemplateCatalogue';

export const metadata: Metadata = { title: 'Templates' };

/**
 * The template catalogue: buildings a company can start a quote from.
 *
 * Every template route needs `platform:templates`. The company list feeds the author form's "Company"
 * choice and needs `platform:companies`; without it the form cannot name an owner, so it says so
 * instead of offering an empty choice.
 */
export default async function TemplatesPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const can = (capability: string) => session.data.capabilities.includes(capability);
  const allowed = can('platform:templates');
  const [templates, companies] = allowed
    ? await Promise.all([
        serverFetch<{ items: TemplateRow[] }>('/admin/templates'),
        can('platform:companies')
          ? serverFetch<{ items: CompanyOption[] }>('/admin/companies?limit=200')
          : Promise.resolve(null),
      ])
    : [null, null];

  return (
    <ShellFrame session={session.data} current="/templates">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Templates</h1>
          <p className="text-sq-body text-sq-ink-muted">
            Buildings a company can start a quote from. Each belongs to one company.
          </p>
        </div>

        {templates === null ? (
          <Panel title="Not available to your role">
            <p className="text-sq-body text-sq-ink-muted">The template catalogue needs the templates capability.</p>
          </Panel>
        ) : !templates.ok ? (
          <Panel title="Could not load templates">
            <p role="alert" className="text-sq-body text-sq-danger">
              {templates.message}
            </p>
          </Panel>
        ) : (
          <TemplateCatalogue
            initial={templates.data.items}
            companies={companies !== null && companies.ok ? companies.data.items : []}
          />
        )}
      </div>
    </ShellFrame>
  );
}
