'use client';

/**
 * Publishing a price book.
 *
 * ## Why the directory is typed rather than uploaded
 *
 * A published book is a SQLite file built from a supplier dump by `publishPriceBook`, which reads a
 * directory of JSON tables. That is a server-side operation on a path the operator controls, not a
 * browser upload — so the screen takes a path and says what it will do. Uploading a `.db` would skip
 * the build, and the build is what makes the book content-addressed and demo-safe.
 *
 * ## Why the sample-book refusal is shown as a refusal
 *
 * A book that calls itself a sample but still carries a distributor's codes is refused by the API.
 * That is the check that keeps a supplier's price list off a prospect's screen, and it is worth
 * showing as a distinct message rather than as a generic failure.
 */

import { useState } from 'react';
import { Button, count, DataTable, date, Field, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

export interface BookSummary {
  hash: string;
  kind: 'sample' | 'licensed';
  active: boolean;
  supplierCodeCount: number;
  publishedAt: string | null;
  note: string | null;
}

export function PriceBookManager({ initial, activeHash }: { initial: BookSummary[]; activeHash: string | null }) {
  const [books, setBooks] = useState(initial);
  const [active, setActive] = useState(activeHash);
  const [dumpDir, setDumpDir] = useState('tools/price-dump/out');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const publish = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);

    const result = await api<BookSummary>('admin/price-books', {
      method: 'POST',
      body: { dumpDir, ...(note.trim() === '' ? {} : { note: note.trim() }) },
    });

    setBusy(false);
    if (result.ok) {
      setMessage({
        tone: 'ok',
        text: `Published ${result.data.hash.slice(0, 12)}… and made it active. ${result.data.supplierCodeCount} supplier code(s) found.`,
      });
      setActive(result.data.hash);
      setBooks((current) => [result.data, ...current.filter((book) => book.hash !== result.data.hash)]);
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  return (
    <div className="flex flex-col gap-sq-4">
      <Panel
        title="Publish a price book"
        description="Build a book from a supplier dump and make it the active one."
      >
        <div className="flex flex-col gap-sq-3">
          <Field
            id="publish-dump"
            label="Dump directory"
            value={dumpDir}
            onChange={(event) => setDumpDir(event.target.value)}
            hint="A directory of JSON tables, on the server. A relative path resolves from the repository root."
          />
          <Field
            id="publish-note"
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Why this book exists. Shown in the list below."
          />

          {message !== null && (
            <p
              role={message.tone === 'danger' ? 'alert' : 'status'}
              className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
            >
              {message.text}
            </p>
          )}

          <div>
            <Button variant="primary" loading={busy} onClick={() => void publish()}>
              Publish and activate
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Books" description="Every book on this server. The active one prices every quote." padded={false}>
        <DataTable
          rows={books}
          rowKey={(book) => book.hash}
          caption="Price books on this server"
          empty="No books yet. Publish one above before any quote can be priced."
          columns={[
            {
              key: 'hash',
              header: 'Hash',
              render: (book) => <span title={book.hash}>{book.hash.slice(0, 12)}…</span>,
              cellClassName: 'font-mono',
            },
            {
              key: 'kind',
              header: 'Kind',
              render: (book) => (
                <StatusPill
                  tone={book.kind === 'licensed' ? 'info' : 'neutral'}
                  label={book.kind === 'licensed' ? 'Licensed' : 'Sample'}
                />
              ),
            },
            {
              key: 'codes',
              header: 'Supplier codes',
              numeric: true,
              render: (book) => (book.supplierCodeCount === 0 ? '—' : count(book.supplierCodeCount)),
            },
            {
              key: 'published',
              header: 'Published',
              render: (book) => (book.publishedAt === null ? '—' : date(book.publishedAt)),
              cellClassName: 'whitespace-nowrap text-sq-ink-muted',
            },
            { key: 'note', header: 'Note', render: (book) => book.note ?? '—', cellClassName: 'text-sq-ink-muted' },
            {
              key: 'state',
              header: 'State',
              render: (book) =>
                book.hash === active ? <StatusPill tone="ok" label="Active" /> : <span className="text-sq-ink-muted">Inactive</span>,
            },
          ]}
        />
      </Panel>
    </div>
  );
}
